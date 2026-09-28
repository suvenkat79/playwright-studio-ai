package com.playwrightstudio.record.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.playwrightstudio.common.ProjectPaths;
import com.playwrightstudio.record.dto.RecordStartResponse;
import com.playwrightstudio.record.dto.RecordStopResponse;
import com.playwrightstudio.record.dto.RecordedActionDto;
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

    // Latches for synchronizing browser start
    private final Map<String, CountDownLatch> sessionStartLatches = new ConcurrentHashMap<>();

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
            ProcessBuilder pb = new ProcessBuilder(
                "node", recorderScriptPath,
                "--url", url,
                "--session", sessionId
            );
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
                        sess.setStatus(SessionStatus.STOPPED);
                    }
                    log.info("[RecordingService][{}] Browser session stopped gracefully. Script compiled ({} chars)", sessionId, script.length());
                    break;

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

            session.setStatus(SessionStatus.STOPPED);

            return new RecordStopResponse(
                "RECORDING_STOPPED",
                sessionId,
                session.getEvents().size(),
                session.getGeneratedTestScript()
            );
        }

        // Return empty stopped response if session wasn't tracked
        return new RecordStopResponse("RECORDING_STOPPED", sessionId, 0, "");
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
}
