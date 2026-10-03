package com.playwrightstudio.record.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.playwrightstudio.common.ProjectPaths;
import com.playwrightstudio.record.dto.RecordStartResponse;
import com.playwrightstudio.record.dto.RecordStopResponse;
import com.playwrightstudio.record.dto.RecordedActionDto;
import com.playwrightstudio.record.dto.ResolveIntentResponse;
import com.playwrightstudio.record.dto.SessionStatusResponse;
import com.playwrightstudio.record.model.RecordingSession;
import com.playwrightstudio.record.model.SessionStatus;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;

@Service
public class RecordingService {

    private static final Logger log = LoggerFactory.getLogger(RecordingService.class);
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final SessionManager sessionManager;

    @Value("${playwright.recorder.script:recorder/dist/cli.js}")
    private String recorderScriptPath;

    @Value("${playwright.recorder.launchTimeoutSeconds:15}")
    private int launchTimeoutSeconds;

    @Value("${playwright.recorder.resolveIntentTimeoutSeconds:20}")
    private int resolveIntentTimeoutSeconds;

    // Latches for synchronizing browser start
    private final Map<String, CountDownLatch> sessionStartLatches = new ConcurrentHashMap<>();

    // AI Gen: futures for in-flight RESOLVE_INTENT stdin requests, keyed by
    // requestId. Mirrors sessionStartLatches' correlation idea, but with a
    // result to hand back (CompletableFuture) rather than a plain signal
    // (CountDownLatch) — RESOLVE_INTENT is the protocol's first stdin
    // command that needs an actual response, not just a "started" signal.
    private final Map<String, CompletableFuture<ResolveIntentResponse>> intentFutures = new ConcurrentHashMap<>();
    private final Map<String, ResolutionProcess> resolutionProcesses = new ConcurrentHashMap<>();

    private static final class ResolutionProcess {
        private final Process process;
        private final CountDownLatch startLatch = new CountDownLatch(1);
        private volatile String failure;

        private ResolutionProcess(Process process) {
            this.process = process;
        }
    }

    public RecordingService(SessionManager sessionManager) {
        this.sessionManager = sessionManager;
    }

    /**
     * Spawns Node Playwright recorder child process via ProcessBuilder:
     * node recorder/dist/cli.js --url <url> --session <sessionId>
     */
    public RecordStartResponse startRecordingSession(String url) {
        String sessionId = "rec_" + System.currentTimeMillis() + "_" + UUID.randomUUID().toString().substring(0, 5);
        log.info("[RecordingService] Initiating Playwright recorder process for session: {} on url: {}", sessionId, url);

        RecordingSession session = new RecordingSession(sessionId, url);
        sessionManager.registerSession(session);

        CountDownLatch startLatch = new CountDownLatch(1);
        sessionStartLatches.put(sessionId, startLatch);

        // Determine working directory where recorder/dist/cli.js resides
        File workingDir = resolveProjectRoot();
        log.info("[RecordingService] Using working directory: {}", workingDir.getAbsolutePath());

        // Validate that recorder/dist/cli.js exists
        File scriptFile = new File(workingDir, recorderScriptPath);
        if (!scriptFile.exists()) {
            log.warn("[RecordingService] Compiled recorder not found at: {}. Please run 'npm run build'", scriptFile.getAbsolutePath());
        }

        try {
            // Build child process to run: node recorder/dist/cli.js --url <url> --session <sessionId>
            List<String> command = new ArrayList<>(List.of(
                "node", recorderScriptPath,
                "--url", url,
                "--session", sessionId
            ));
            if (shouldRunHeadless()) {
                log.info("[RecordingService] No display detected on this Linux host; launching recorder with --headless");
                command.add("--headless");
            }

            ProcessBuilder pb = new ProcessBuilder(command);
            pb.directory(workingDir);

            // Set environment to ensure visible display / PATH
            Map<String, String> env = pb.environment();
            if (!env.containsKey("DISPLAY") && System.getenv("DISPLAY") != null) {
                env.put("DISPLAY", System.getenv("DISPLAY"));
            }

            Process process = pb.start();
            session.setProcess(process);

            // Read child process stdout asynchronously (Newline-Delimited JSON)
            Thread stdoutThread = new Thread(() -> {
                try (BufferedReader reader = new BufferedReader(new InputStreamReader(process.getInputStream(), StandardCharsets.UTF_8))) {
                    String line;
                    while ((line = reader.readLine()) != null) {
                        handleProcessStdoutLine(sessionId, line);
                    }
                } catch (IOException e) {
                    log.debug("[RecordingService][{}] Stdout stream closed: {}", sessionId, e.getMessage());
                } finally {
                    sessionStartLatches.remove(sessionId);
                    startLatch.countDown();
                }
            }, "Recorder-Stdout-" + sessionId);
            stdoutThread.setDaemon(true);
            stdoutThread.start();

            // Read child process stderr asynchronously for diagnostic logging
            Thread stderrThread = new Thread(() -> {
                try (BufferedReader reader = new BufferedReader(new InputStreamReader(process.getErrorStream(), StandardCharsets.UTF_8))) {
                    String line;
                    while ((line = reader.readLine()) != null) {
                        log.info("[Playwright CLI][{}] {}", sessionId, line);
                    }
                } catch (IOException e) {
                    log.debug("[RecordingService][{}] Stderr stream closed: {}", sessionId, e.getMessage());
                }
            }, "Recorder-Stderr-" + sessionId);
            stderrThread.setDaemon(true);
            stderrThread.start();

            // Wait for SESSION_STARTED signal from child process
            boolean startedInTime = startLatch.await(launchTimeoutSeconds, TimeUnit.SECONDS);
            if (!startedInTime) {
                log.warn("[RecordingService][{}] Recorder did not emit SESSION_STARTED within {}s, proceeding with active process",
                        sessionId, launchTimeoutSeconds);
            }

            if (!process.isAlive()) {
                sessionManager.markFailed(sessionId, "Recorder process exited prematurely with exit code: " + process.exitValue());
                throw new IllegalStateException("Recorder process exited prematurely with exit code: " + process.exitValue());
            }

            return new RecordStartResponse("RECORDING_STARTED", sessionId, url);

        } catch (Exception e) {
            log.error("[RecordingService] Failed to start Playwright recording process", e);
            sessionManager.markFailed(sessionId, e.getMessage());
            throw new RuntimeException("Failed to launch visible Playwright browser: " + e.getMessage(), e);
        } finally {
            sessionStartLatches.remove(sessionId);
        }
    }

    /**
     * Parses messages emitted by recorder/dist/cli.js on stdout.
     * Expects Newline-Delimited JSON (NDJSON) records.
     */
    private void handleProcessStdoutLine(String sessionId, String line) {
        if (line == null || line.trim().isEmpty()) return;

        try {
            String trimmed = line.trim();
            JsonNode root;
            String type = null;

            // Pure Newline-Delimited JSON (NDJSON) record: {"type":"...","sessionId":"...",...}
            if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
                root = objectMapper.readTree(trimmed);
                if (root.has("type")) {
                    type = root.get("type").asText();
                }
            } else if (trimmed.contains(":{")) {
                // Backward-compatible fallback for PREFIX:{...}
                int colonIndex = trimmed.indexOf(":{");
                String prefix = trimmed.substring(0, colonIndex);
                String jsonPart = trimmed.substring(colonIndex + 1);
                root = objectMapper.readTree(jsonPart);
                type = prefix;
            } else {
                log.debug("[RecordingService][{}] Non-JSON stdout: {}", sessionId, trimmed);
                return;
            }

            if (type == null) return;

            Optional<RecordingSession> sessionOpt = sessionManager.getSession(sessionId);

            switch (type) {
                case "SESSION_STARTED":
                    String targetUrl = root.has("url") ? root.get("url").asText() : "";
                    log.info("[RecordingService][{}] Browser session verified active on URL: {}", sessionId, targetUrl);
                    CountDownLatch latch = sessionStartLatches.get(sessionId);
                    if (latch != null) {
                        latch.countDown();
                    }
                    break;

                case "RESOLUTION_STARTED": {
                    ResolutionProcess resolution = resolutionProcesses.get(sessionId);
                    if (resolution != null) resolution.startLatch.countDown();
                    log.info("[RecordingService][{}] Resolution browser started on URL: {}",
                            sessionId, root.path("url").asText(""));
                    break;
                }

                case "RESOLUTION_ERROR": {
                    ResolutionProcess resolution = resolutionProcesses.get(sessionId);
                    String message = root.path("message").asText("Failed to start resolution browser");
                    if (resolution != null) {
                        resolution.failure = message;
                        resolution.startLatch.countDown();
                    }
                    log.error("[RecordingService][{}] Resolution browser startup failed: {}", sessionId, message);
                    break;
                }

                case "EVENT":
                    JsonNode actionNode = root.get("action");
                    if (actionNode != null && sessionOpt.isPresent()) {
                        RecordedActionDto action = objectMapper.treeToValue(actionNode, RecordedActionDto.class);
                        sessionOpt.get().addEvent(action);
                        log.info("[RecordingService][{}] Event captured: [{}] {}", sessionId, action.getType(), action.getCodeLine());
                    }
                    break;

                case "SESSION_STOPPED":
                    String script = root.has("testScript") ? root.get("testScript").asText() : "";
                    if (sessionOpt.isPresent()) {
                        RecordingSession sess = sessionOpt.get();
                        sess.setGeneratedTestScript(script);
                        JsonNode storageState = root.get("storageState");
                        if (storageState != null && storageState.isObject()) {
                            sess.setBrowserStorageStateJson(storageState.toString());
                        }
                        if (sess.getStatus() != SessionStatus.FAILED) {
                            sess.setStatus(SessionStatus.STOPPED);
                        }
                    }
                    log.info("[RecordingService][{}] Browser session stopped gracefully. Script compiled ({} chars)", sessionId, script.length());
                    break;

                case "INTENT_RESOLVED": {
                    String requestId = root.has("requestId") ? root.get("requestId").asText() : null;
                    CompletableFuture<ResolveIntentResponse> future = requestId != null ? intentFutures.get(requestId) : null;
                    if (future != null) {
                        List<RecordedActionDto> actions = new ArrayList<>();
                        JsonNode actionsNode = root.get("actions");
                        if (actionsNode != null && actionsNode.isArray()) {
                            for (JsonNode resolvedActionNode : actionsNode) {
                                actions.add(objectMapper.treeToValue(resolvedActionNode, RecordedActionDto.class));
                            }
                        }
                        List<String> unresolved = new ArrayList<>();
                        JsonNode unresolvedNode = root.get("unresolved");
                        if (unresolvedNode != null && unresolvedNode.isArray()) {
                            for (JsonNode clauseNode : unresolvedNode) {
                                unresolved.add(clauseNode.asText());
                            }
                        }
                        future.complete(new ResolveIntentResponse(sessionId, actions, unresolved));
                    }
                    log.info("[RecordingService][{}] Intent resolved (requestId {}): {} action(s), {} unresolved",
                            sessionId, requestId, root.has("actions") ? root.get("actions").size() : 0,
                            root.has("unresolved") ? root.get("unresolved").size() : 0);
                    break;
                }

                case "INTENT_ERROR": {
                    String requestId = root.has("requestId") ? root.get("requestId").asText() : null;
                    String intentErrorMsg = root.has("message") ? root.get("message").asText() : "AI Gen failed to resolve intent";
                    CompletableFuture<ResolveIntentResponse> future = requestId != null ? intentFutures.get(requestId) : null;
                    if (future != null) {
                        future.completeExceptionally(new IllegalStateException(intentErrorMsg));
                    }
                    log.warn("[RecordingService][{}] Intent resolution error (requestId {}): {}", sessionId, requestId, intentErrorMsg);
                    break;
                }

                case "ERROR":
                    String errorMsg = root.has("message") ? root.get("message").asText() : "Unknown error in recorder";
                    log.error("[RecordingService][{}] Error reported by recorder: {}", sessionId, errorMsg);
                    sessionManager.markFailed(sessionId, errorMsg);
                    CountDownLatch errLatch = sessionStartLatches.get(sessionId);
                    if (errLatch != null) {
                        errLatch.countDown();
                    }
                    break;

                default:
                    log.debug("[RecordingService][{}] Unhandled record type: {}", sessionId, type);
            }
        } catch (Exception e) {
            log.warn("[RecordingService][{}] Could not parse child process output: {}", sessionId, line, e);
        }
    }

    /**
     * Stops the child recorder process cleanly by sending 'STOP\n' command to stdin
     */
    public RecordStopResponse stopRecordingSession(String sessionId) {
        log.info("[RecordingService] Requesting stop for recording session: {}", sessionId);

        Optional<RecordingSession> sessionOpt = sessionManager.getSession(sessionId);
        if (sessionOpt.isPresent()) {
            RecordingSession session = sessionOpt.get();
            Process process = session.getProcess();

            if (session.getStatus() == SessionStatus.FAILED) {
                return new RecordStopResponse(
                    "RECORDING_FAILED",
                    sessionId,
                    session.getEvents().size(),
                    session.getGeneratedTestScript()
                );
            }

            session.setStatus(SessionStatus.STOPPING);

            if (process != null && process.isAlive()) {
                try {
                    // Send graceful STOP command to child process stdin
                    BufferedWriter writer = new BufferedWriter(new OutputStreamWriter(process.getOutputStream(), StandardCharsets.UTF_8));
                    writer.write("STOP\n");
                    writer.flush();

                    // Wait up to 5 seconds for clean Playwright spec compilation and exit
                    boolean finished = process.waitFor(5, TimeUnit.SECONDS);
                    if (!finished) {
                        log.warn("[RecordingService][{}] Process did not exit after STOP command. Destroying...", sessionId);
                        process.destroy();
                    }
                } catch (Exception e) {
                    log.warn("[RecordingService][{}] Error sending STOP to child process: {}", sessionId, e.getMessage());
                    process.destroy();
                }
            }

            if (session.getStatus() != SessionStatus.FAILED) {
                session.setStatus(SessionStatus.STOPPED);
            }

            return new RecordStopResponse(
                session.getStatus() == SessionStatus.FAILED ? "RECORDING_FAILED" : "RECORDING_STOPPED",
                sessionId,
                session.getEvents().size(),
                session.getGeneratedTestScript()
            );
        }

        // Return empty stopped response if session wasn't tracked
        return new RecordStopResponse("RECORDING_STOPPED", sessionId, 0, "");
    }

    /**
     * AI Gen: resolves one natural-language instruction against an active
     * session's live browser page, by sending a correlated RESOLVE_INTENT
     * command to the recorder child process over stdin and waiting for the
     * matching INTENT_RESOLVED/INTENT_ERROR on stdout (handleProcessStdoutLine
     * above). Requires a session with a live recorder process — never
     * fabricates a result for a session that has none.
     */
    public ResolveIntentResponse resolveIntent(String sessionId, String instruction) {
        ResolutionProcess resolution = resolutionProcesses.get(sessionId);
        if (resolution != null) {
            if (!resolution.process.isAlive()) {
                throw new IllegalStateException("Resolution browser \"" + sessionId + "\" is no longer active.");
            }
            return resolveIntentAgainstProcess(sessionId, instruction, resolution.process);
        }

        RecordingSession session = sessionManager.getSession(sessionId)
                .orElseThrow(() -> new IllegalStateException("No recording session \"" + sessionId + "\" found."));

        Process process = session.getProcess();
        if (session.getStatus() != SessionStatus.RUNNING || process == null || !process.isAlive()) {
            throw new IllegalStateException("Recording session \"" + sessionId + "\" has no active live browser to resolve intent against.");
        }

        return resolveIntentAgainstProcess(sessionId, instruction, process);
    }

    public RecordStartResponse startResolutionSession(String targetUrl, String sourceSessionId) {
        boolean recordingActive = sessionManager.getAllSessions().stream()
                .anyMatch(session -> session.getStatus() == SessionStatus.RUNNING
                        && session.getProcess() != null && session.getProcess().isAlive());
        if (recordingActive) {
            throw new IllegalStateException("Stop the active recording session before starting AI Gen resolution.");
        }

        String storageStateJson = "{\"cookies\":[],\"origins\":[]}";
        if (sourceSessionId != null && !sourceSessionId.isBlank()) {
            RecordingSession sourceSession = sessionManager.getSession(sourceSessionId)
                .orElseThrow(() -> new IllegalStateException(
                    "Source recording session \"" + sourceSessionId + "\" is unavailable."));
            storageStateJson = sourceSession.getBrowserStorageStateJson();
            if (storageStateJson == null || storageStateJson.isBlank()) {
            throw new IllegalStateException(
                "Authentication state is unavailable for the stopped recording. Start a fresh resolution session and authenticate again.");
            }
        }

        String sessionId = "res_" + System.currentTimeMillis() + "_" + UUID.randomUUID().toString().substring(0, 5);
        File workingDir = resolveProjectRoot();
        File scriptFile = new File(workingDir, recorderScriptPath);
        if (!scriptFile.exists()) {
            throw new IllegalStateException("Compiled Playwright recorder not found: " + scriptFile.getAbsolutePath());
        }

        try {
            ProcessBuilder builder = new ProcessBuilder(
                    "node", recorderScriptPath,
                    "--url", targetUrl,
                    "--session", sessionId,
                    "--resolution",
                    "--headless");
            builder.directory(workingDir);
            Process process = builder.start();
            ResolutionProcess resolution = new ResolutionProcess(process);
            resolutionProcesses.put(sessionId, resolution);

            try {
                BufferedWriter writer = new BufferedWriter(new OutputStreamWriter(
                        process.getOutputStream(), StandardCharsets.UTF_8));
                writer.write("RESOLUTION_STORAGE_STATE " + storageStateJson + "\n");
                writer.flush();
            } catch (IOException e) {
                closeResolutionSession(sessionId);
                throw new IllegalStateException("Failed to initialize authenticated AI Gen resolution browser.", e);
            }

            Thread stdoutThread = new Thread(() -> {
                try (BufferedReader reader = new BufferedReader(new InputStreamReader(
                        process.getInputStream(), StandardCharsets.UTF_8))) {
                    String line;
                    while ((line = reader.readLine()) != null) {
                        handleProcessStdoutLine(sessionId, line);
                    }
                } catch (IOException e) {
                    log.debug("[ResolutionSession][{}] Stdout stream closed: {}", sessionId, e.getMessage());
                }
            }, "Resolution-Stdout-" + sessionId);
            stdoutThread.setDaemon(true);
            stdoutThread.start();

            Thread stderrThread = new Thread(() -> {
                try (BufferedReader reader = new BufferedReader(new InputStreamReader(
                        process.getErrorStream(), StandardCharsets.UTF_8))) {
                    String line;
                    while ((line = reader.readLine()) != null) {
                        log.info("[Playwright Resolution][{}] {}", sessionId, line);
                    }
                } catch (IOException e) {
                    log.debug("[ResolutionSession][{}] Stderr stream closed: {}", sessionId, e.getMessage());
                }
            }, "Resolution-Stderr-" + sessionId);
            stderrThread.setDaemon(true);
            stderrThread.start();

            boolean started = resolution.startLatch.await(launchTimeoutSeconds, TimeUnit.SECONDS);
            if (!started || resolution.failure != null || !process.isAlive()) {
                closeResolutionSession(sessionId);
                throw new IllegalStateException(resolution.failure != null
                        ? resolution.failure
                        : "Resolution browser did not start within " + launchTimeoutSeconds + " seconds.");
            }
            return new RecordStartResponse("RESOLUTION_STARTED", sessionId, targetUrl);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            closeResolutionSession(sessionId);
            throw new IllegalStateException("Interrupted while starting AI Gen resolution browser.", e);
        } catch (IOException e) {
            resolutionProcesses.remove(sessionId);
            throw new IllegalStateException("Failed to start AI Gen resolution browser: " + e.getMessage(), e);
        }
    }

    public void closeResolutionSession(String sessionId) {
        ResolutionProcess resolution = resolutionProcesses.remove(sessionId);
        if (resolution == null) return;
        Process process = resolution.process;
        if (!process.isAlive()) return;

        try {
            BufferedWriter writer = new BufferedWriter(new OutputStreamWriter(
                    process.getOutputStream(), StandardCharsets.UTF_8));
            writer.write("STOP\n");
            writer.flush();
            if (!process.waitFor(5, TimeUnit.SECONDS)) {
                log.warn("[ResolutionSession][{}] Resolution process did not stop gracefully; terminating it.", sessionId);
                process.destroy();
                if (!process.waitFor(2, TimeUnit.SECONDS)) process.destroyForcibly();
            }
        } catch (Exception e) {
            log.warn("[ResolutionSession][{}] Failed to close resolution browser cleanly: {}", sessionId, e.getMessage());
            process.destroyForcibly();
        }
    }

    private ResolveIntentResponse resolveIntentAgainstProcess(String sessionId, String instruction, Process process) {
        String requestId = UUID.randomUUID().toString();
        CompletableFuture<ResolveIntentResponse> future = new CompletableFuture<>();
        intentFutures.put(requestId, future);

        try {
            Map<String, String> payload = Map.of("requestId", requestId, "instruction", instruction);
            String line = "RESOLVE_INTENT " + objectMapper.writeValueAsString(payload);
            BufferedWriter writer = new BufferedWriter(new OutputStreamWriter(process.getOutputStream(), StandardCharsets.UTF_8));
            writer.write(line);
            writer.newLine();
            writer.flush();

            return future.get(resolveIntentTimeoutSeconds, TimeUnit.SECONDS);
        } catch (TimeoutException e) {
            throw new RuntimeException("Timed out waiting for AI Gen to resolve \"" + instruction + "\" against the live page.", e);
        } catch (ExecutionException e) {
            Throwable cause = e.getCause() != null ? e.getCause() : e;
            throw new RuntimeException(cause.getMessage(), cause);
        } catch (RuntimeException e) {
            throw e;
        } catch (Exception e) {
            throw new RuntimeException("Failed to resolve intent: " + e.getMessage(), e);
        } finally {
            intentFutures.remove(requestId);
        }
    }

    /**
     * Returns the lifecycle status for a session: RUNNING, STOPPED, or FAILED
     */
    public SessionStatusResponse getSessionStatus(String sessionId) {
        Optional<RecordingSession> sessionOpt = sessionManager.getSession(sessionId);
        if (sessionOpt.isEmpty()) {
            return null;
        }

        RecordingSession session = sessionOpt.get();
        return new SessionStatusResponse(
            session.getSessionId(),
            session.getStatus(),
            session.getEvents().size(),
            session.getTargetUrl(),
            session.getStartedAt(),
            session.getFailureReason()
        );
    }

    public List<RecordedActionDto> getSessionEvents(String sessionId) {
        return sessionManager.getSession(sessionId)
                .map(RecordingSession::getEvents)
                .orElse(Collections.emptyList());
    }

    public boolean isSessionActive(String sessionId) {
        return sessionManager.getSession(sessionId)
                .map(s -> s.getStatus() == SessionStatus.RUNNING)
                .orElse(false);
    }

    public String getGeneratedScript(String sessionId) {
        return sessionManager.getSession(sessionId)
                .map(RecordingSession::getGeneratedTestScript)
                .orElse("");
    }

    /**
     * Finds the root directory containing recorder/dist/cli.js or recorder/cli.ts
     */
    private File resolveProjectRoot() {
        return ProjectPaths.resolveProjectRoot();
    }

    /**
     * True on a Linux host with no DISPLAY (e.g. a cloud VM), where a headed
     * Chromium launch would fail. macOS/Windows always have a native display,
     * so they stay headed for local debugging even though DISPLAY is unset there.
     */
    private boolean shouldRunHeadless() {
        String osName = System.getProperty("os.name", "").toLowerCase();
        boolean isLinux = osName.contains("nux") || osName.contains("nix");
        String display = System.getenv("DISPLAY");
        boolean hasDisplay = display != null && !display.isBlank();
        return isLinux && !hasDisplay;
    }
}
