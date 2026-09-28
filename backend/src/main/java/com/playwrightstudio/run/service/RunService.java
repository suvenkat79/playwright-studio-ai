package com.playwrightstudio.run.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.playwrightstudio.common.ProjectPaths;
import com.playwrightstudio.run.dto.*;
import com.playwrightstudio.run.model.RunReportPaths;
import com.playwrightstudio.run.model.RunSession;
import com.playwrightstudio.run.model.RunStatus;
import com.playwrightstudio.run.model.RunStepEvent;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.io.*;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/**
 * Executes real Playwright test suites as child processes ("Sprint 3: Real
 * Playwright Test Execution Engine"), replacing the client-side setTimeout
 * simulation that previously drove SandboxRunnerModal and DashboardView.
 *
 * Mirrors RecordingService's child-process architecture: a workspace is
 * materialized on disk, `npx playwright test` is spawned via ProcessBuilder,
 * and its NDJSON stdout (emitted by recorder/runReporter.ts) is parsed line
 * by line to update an in-memory RunSession that the frontend polls.
 */
@Service
public class RunService {

    private static final Logger log = LoggerFactory.getLogger(RunService.class);
    private static final Pattern SAFE_FILENAME = Pattern.compile("[A-Za-z0-9._-]+");
    private static final Pattern IMPORT_REWRITE = Pattern.compile("['\"]@playwright/test['\"]");

    private final ObjectMapper objectMapper = new ObjectMapper();
    private final RunSessionManager runSessionManager;

    public RunService(RunSessionManager runSessionManager) {
        this.runSessionManager = runSessionManager;
    }

    public RunExecuteResponse executeRun(RunExecuteRequest request) {
        String browser = normalizeBrowser(request.getBrowser());
        String specName = sanitizeFileName(request.getSpecName(), "suite.spec.ts");
        String pomName = request.getPomContent() != null && !request.getPomContent().isBlank()
                ? sanitizeFileName(request.getPomName(), "PageObject.ts")
                : null;

        String runId = "run_" + System.currentTimeMillis() + "_" + UUID.randomUUID().toString().substring(0, 5);
        int runNumber = runSessionManager.nextRunNumber();

        File projectRoot = ProjectPaths.resolveProjectRoot();
        File workspaceDir = new File(projectRoot, "run-workspace/" + runId);

        RunSession session = new RunSession(runId, runNumber, specName, browser, request.isHeadless(), workspaceDir);
        runSessionManager.registerSession(session);

        try {
            File testsDir = new File(workspaceDir, "tests");
            File resultsDir = new File(workspaceDir, "test-results");
            Files.createDirectories(testsDir.toPath());
            Files.createDirectories(resultsDir.toPath());

            if (pomName != null) {
                writeFile(new File(testsDir, pomName), rewriteImports(request.getPomContent()));
            }
            writeFile(new File(testsDir, specName), rewriteImports(request.getSpecContent()));

            File reporterScript = new File(projectRoot, "recorder/runReporter.ts");
            File configFile = new File(workspaceDir, "playwright.config.ts");
            writeFile(configFile, buildConfig(browser, request.isHeadless(), reporterScript));

            // Report paths are deterministic from the config we just wrote —
            // no need to wait for RUN_FINISHED to know where they'll land.
            RunReportPaths paths = session.getReportPaths();
            paths.setHtmlReportDir(new File(resultsDir, "html-report").getAbsolutePath());
            paths.setHtmlReportIndex(new File(resultsDir, "html-report/index.html").getAbsolutePath());
            paths.setJunitXmlPath(new File(resultsDir, "junit.xml").getAbsolutePath());

            log.info("[RunService] Spawning Playwright run {} (#{}) for spec: {} [{}, headless={}]",
                    runId, runNumber, specName, browser, request.isHeadless());

            ProcessBuilder pb = new ProcessBuilder(
                    "npx", "playwright", "test",
                    "--config=" + configFile.getAbsolutePath(),
                    "--project=" + browser
            );
            pb.directory(projectRoot);

            session.addLog("$ npx playwright test " + specName + " --project=" + browser
                    + (request.isHeadless() ? "" : " --headed"));
            session.addLog("[RUNNER] Workspace: " + workspaceDir.getAbsolutePath());

            Process process = pb.start();
            session.setProcess(process);

            Thread stdoutThread = new Thread(() -> readStdout(session, process), "Run-Stdout-" + runId);
            stdoutThread.setDaemon(true);
            stdoutThread.start();

            Thread stderrThread = new Thread(() -> readStderr(session, process), "Run-Stderr-" + runId);
            stderrThread.setDaemon(true);
            stderrThread.start();

            return new RunExecuteResponse(runId, session.getStatus().name(), runNumber);
        } catch (Exception e) {
            log.error("[RunService] Failed to launch Playwright test run", e);
            session.setStatus(RunStatus.ERROR);
            session.setFailureReason(e.getMessage());
            session.addLog("[ERROR] Failed to launch run: " + e.getMessage());
            return new RunExecuteResponse(runId, RunStatus.ERROR.name(), runNumber);
        }
    }

    private void readStdout(RunSession session, Process process) {
        long startWallClock = System.currentTimeMillis();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(process.getInputStream(), StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) {
                handleReporterLine(session, line);
            }
        } catch (IOException e) {
            log.debug("[RunService][{}] Stdout stream closed: {}", session.getRunId(), e.getMessage());
        } finally {
            int exitCode = -1;
            try {
                exitCode = process.waitFor();
            } catch (InterruptedException ignored) {
                Thread.currentThread().interrupt();
            }

            // If the custom reporter's RUN_FINISHED line never arrived (crash,
            // config error, missing browsers, killed process), fall back to
            // the process exit code so the session doesn't hang as RUNNING.
            if (session.getStatus() == RunStatus.RUNNING) {
                RunStatus finalStatus = exitCode == 0 ? RunStatus.PASSED : RunStatus.FAILED;
                session.setTotalDurationMs(System.currentTimeMillis() - startWallClock);
                session.setStatus(finalStatus);
                session.addLog("[RUNNER] Process exited with code " + exitCode + " (no reporter summary received).");
                if (finalStatus == RunStatus.FAILED) {
                    session.setFailureReason("playwright test exited with code " + exitCode);
                }
            }
        }
    }

    private void readStderr(RunSession session, Process process) {
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(process.getErrorStream(), StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) {
                log.info("[Playwright Test][{}] {}", session.getRunId(), line);
                if (!line.isBlank()) {
                    session.addLog("[STDERR] " + line);
                }
            }
        } catch (IOException e) {
            log.debug("[RunService][{}] Stderr stream closed: {}", session.getRunId(), e.getMessage());
        }
    }

    /**
     * Parses one NDJSON line emitted by recorder/runReporter.ts and applies
     * it to the session's live step/log/report state.
     */
    private void handleReporterLine(RunSession session, String line) {
        if (line == null || line.isBlank()) return;
        String trimmed = line.trim();
        if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
            // Not one of our NDJSON records (shouldn't normally happen since
            // printsToStdio() is false on the reporter) — surface it as a
            // raw log line rather than silently dropping it.
            session.addLog(trimmed);
            return;
        }

        try {
            JsonNode root = objectMapper.readTree(trimmed);
            String type = root.has("type") ? root.get("type").asText() : null;
            if (type == null) return;

            switch (type) {
                case "RUN_STARTED": {
                    int totalTests = root.path("totalTests").asInt(0);
                    session.addLog("[RUNNER] Executing " + totalTests + " test(s)...");
                    break;
                }
                case "TEST_STARTED": {
                    String title = root.path("title").asText("");
                    session.addLog("[TEST] " + title + " started");
                    break;
                }
                case "STEP_STARTED": {
                    String stepKey = String.valueOf(root.path("stepId").asInt());
                    String title = root.path("title").asText("");
                    String category = root.path("category").asText("");
                    RunStepEvent step = session.getOrCreateStep(stepKey, title, category);
                    step.setStatus("running");
                    applyStepLocationFields(step, root);
                    break;
                }
                case "STEP_FINISHED": {
                    String stepKey = String.valueOf(root.path("stepId").asInt());
                    String title = root.path("title").asText("");
                    String category = root.path("category").asText("");
                    String status = root.path("status").asText("passed");
                    long durationMs = root.path("durationMs").asLong(0);
                    String error = root.hasNonNull("error") ? root.path("error").asText() : null;

                    RunStepEvent step = session.getOrCreateStep(stepKey, title, category);
                    step.setTitle(title);
                    step.setStatus(status);
                    step.setDurationMs(durationMs);
                    step.setError(error);
                    applyStepLocationFields(step, root);

                    String logLine = String.format("[%s] %s (%dms)", category.toUpperCase(Locale.ROOT), title, durationMs);
                    if (error != null) {
                        logLine += " [ERROR: " + error + "]";
                    }
                    step.setLog(logLine);
                    session.addLog(logLine);
                    break;
                }
                case "TEST_FINISHED": {
                    String title = root.path("title").asText("");
                    String status = root.path("status").asText("");
                    long durationMs = root.path("durationMs").asLong(0);
                    String error = root.hasNonNull("error") ? root.path("error").asText() : null;

                    String logLine = "[TEST] " + title + " -> " + status.toUpperCase(Locale.ROOT) + " (" + durationMs + "ms)";
                    if (error != null) {
                        logLine += " [ERROR: " + error + "]";
                    }
                    session.addLog(logLine);

                    if (root.has("attachments")) {
                        RunReportPaths paths = session.getReportPaths();
                        for (JsonNode attachment : root.get("attachments")) {
                            String name = attachment.path("name").asText("");
                            String path = attachment.path("path").asText(null);
                            if (path == null) continue;
                            switch (name) {
                                case "trace" -> paths.getTracePaths().add(path);
                                case "screenshot" -> paths.getScreenshotPaths().add(path);
                                case "video" -> paths.getVideoPaths().add(path);
                                default -> { /* ignore other attachment kinds */ }
                            }
                        }
                    }
                    break;
                }
                case "RUN_FINISHED": {
                    String status = root.path("status").asText("failed");
                    long durationMs = root.path("durationMs").asLong(0);
                    session.setTotalDurationMs(durationMs);
                    session.setStatus("passed".equals(status) ? RunStatus.PASSED : RunStatus.FAILED);
                    if (!"passed".equals(status)) {
                        session.setFailureReason("Playwright reported run status: " + status);
                    }
                    session.addLog("[RUNNER] Run finished: " + status.toUpperCase(Locale.ROOT) + " in " + durationMs + "ms");
                    break;
                }
                default:
                    log.debug("[RunService][{}] Unhandled reporter record type: {}", session.getRunId(), type);
            }
        } catch (Exception e) {
            log.warn("[RunService][{}] Could not parse reporter output line: {}", session.getRunId(), line, e);
        }
    }

    /** Copies the real locator/source-location fields (never fabricated — straight from the reporter's NDJSON) onto the step. */
    private void applyStepLocationFields(RunStepEvent step, JsonNode root) {
        if (root.hasNonNull("locator")) {
            step.setLocator(root.path("locator").asText());
        }
        if (root.hasNonNull("sourceFile")) {
            step.setSourceFile(root.path("sourceFile").asText());
        }
        if (root.hasNonNull("sourceLine")) {
            step.setSourceLine(root.path("sourceLine").asInt());
        }
    }

    public RunEventsResponse getRunEvents(String runId) {
        RunSession session = runSessionManager.getSession(runId).orElse(null);
        if (session == null) return null;

        List<RunStepDto> stepDtos = session.getSteps().stream()
                .map(s -> new RunStepDto(s.getId(), s.getTitle(), s.getCategory(), s.getStatus(), s.getDurationMs(),
                        s.getLog(), s.getError(), s.getLocator(), s.getSourceFile(), s.getSourceLine()))
                .collect(Collectors.toList());

        RunReportPaths rp = session.getReportPaths();
        String htmlReportUrl = rp.getHtmlReportIndex() != null
                ? toArtifactUrl(session, new File(rp.getHtmlReportIndex()))
                : null;
        List<String> traceUrls = rp.getTracePaths().stream()
                .map(p -> toArtifactUrl(session, new File(p)))
                .collect(Collectors.toList());

        RunReportPathsDto reportDto = new RunReportPathsDto(
                rp.getHtmlReportIndex(),
                rp.getJunitXmlPath(),
                List.copyOf(rp.getTracePaths()),
                List.copyOf(rp.getScreenshotPaths()),
                List.copyOf(rp.getVideoPaths()),
                htmlReportUrl,
                traceUrls
        );

        return new RunEventsResponse(
                session.getRunId(),
                session.getStatus().name(),
                stepDtos,
                List.copyOf(session.getLogs()),
                session.getTotalDurationMs(),
                reportDto,
                session.getFailureReason()
        );
    }

    public boolean cancelRun(String runId) {
        RunSession session = runSessionManager.getSession(runId).orElse(null);
        if (session == null) return false;

        Process process = session.getProcess();
        if (process != null && process.isAlive()) {
            process.destroyForcibly();
        }
        if (session.getStatus() == RunStatus.RUNNING) {
            session.setStatus(RunStatus.CANCELLED);
            session.setFailureReason("Cancelled by user");
            session.addLog("[RUNNER] Run cancelled by user.");
        }
        return true;
    }

    public List<RunHistoryEntryDto> getRunHistory() {
        return runSessionManager.getCompletedRunsMostRecentFirst().stream()
                .map(this::toHistoryEntry)
                .collect(Collectors.toList());
    }

    private RunHistoryEntryDto toHistoryEntry(RunSession session) {
        Instant reference = session.getFinishedAt() != null ? session.getFinishedAt() : session.getStartedAt();
        String status = session.getStatus() == RunStatus.PASSED ? "passed" : "failed";
        String suiteName = session.getSpecName().replace(".spec.ts", "").replace(".ts", "");

        return new RunHistoryEntryDto(
                session.getRunId(),
                session.getRunNumber(),
                suiteName,
                "local-run",
                "n/a",
                relativeTimestamp(reference),
                status,
                session.getTotalDurationMs(),
                session.getBrowser(),
                session.getSteps().size(),
                0
        );
    }

    private String relativeTimestamp(Instant reference) {
        Duration elapsed = Duration.between(reference, Instant.now());
        long seconds = Math.max(0, elapsed.getSeconds());
        if (seconds < 45) return "Just now";
        long minutes = seconds / 60;
        if (minutes < 60) return minutes + (minutes == 1 ? " min ago" : " mins ago");
        long hours = minutes / 60;
        if (hours < 24) return hours + (hours == 1 ? " hour ago" : " hours ago");
        long days = hours / 24;
        return days + (days == 1 ? " day ago" : " days ago");
    }

    /**
     * Builds a browser-openable URL for a file inside the run's workspace,
     * served by RunController's `/api/run/artifact/{runId}/**` endpoint.
     * Path-based (not a `?path=` query param) so relative asset references
     * inside the Playwright HTML report — which is a small multi-file app,
     * not a single static page — keep resolving correctly from the browser.
     */
    private String toArtifactUrl(RunSession session, File absoluteFile) {
        Path relative = session.getWorkspaceDir().toPath().toAbsolutePath()
                .relativize(absoluteFile.toPath().toAbsolutePath());

        StringBuilder encoded = new StringBuilder();
        for (Path segment : relative) {
            if (encoded.length() > 0) encoded.append('/');
            encoded.append(URLEncoder.encode(segment.toString(), StandardCharsets.UTF_8).replace("+", "%20"));
        }
        return "/api/run/artifact/" + session.getRunId() + "/" + encoded;
    }

    /**
     * Resolves a requested relative path to a real file inside the given
     * run's workspace, refusing anything that would escape it (e.g. `../`
     * traversal) via a canonical-path containment check.
     */
    public File resolveArtifactFile(String runId, String relativePath) {
        RunSession session = runSessionManager.getSession(runId).orElse(null);
        if (session == null) return null;

        try {
            File workspaceCanonical = session.getWorkspaceDir().getCanonicalFile();
            File requested = new File(session.getWorkspaceDir(), relativePath).getCanonicalFile();

            if (!requested.getPath().equals(workspaceCanonical.getPath())
                    && !requested.getPath().startsWith(workspaceCanonical.getPath() + File.separator)) {
                log.warn("[RunService][{}] Rejected artifact request outside workspace: {}", runId, relativePath);
                return null;
            }
            if (!requested.isFile()) return null;
            return requested;
        } catch (IOException e) {
            log.warn("[RunService][{}] Failed to resolve artifact path: {}", runId, relativePath, e);
            return null;
        }
    }

    private String normalizeBrowser(String browser) {
        if ("chromium".equals(browser) || "firefox".equals(browser) || "webkit".equals(browser)) {
            return browser;
        }
        return "chromium";
    }

    private String sanitizeFileName(String name, String fallback) {
        if (name == null || name.isBlank()) return fallback;
        String base = new File(name).getName(); // strip any path components
        return SAFE_FILENAME.matcher(base).matches() ? base : fallback;
    }

    /** The suite files import from '@playwright/test', which isn't installed here — only the merged 'playwright' package is. */
    private String rewriteImports(String content) {
        if (content == null) return "";
        return IMPORT_REWRITE.matcher(content).replaceAll("'playwright/test'");
    }

    private void writeFile(File file, String content) throws IOException {
        Files.writeString(file.toPath(), content, StandardCharsets.UTF_8);
    }

    private String buildConfig(String browser, boolean headless, File reporterScript) {
        String reporterPath = reporterScript.getAbsolutePath().replace("\\", "\\\\");
        String deviceName = switch (browser) {
            case "firefox" -> "Desktop Firefox";
            case "webkit" -> "Desktop Safari";
            default -> "Desktop Chrome";
        };

        return """
                import { defineConfig, devices } from 'playwright/test';

                // Generated by RunService for a single real test-execution run.
                // Not hand-edited — regenerated fresh on every run.
                export default defineConfig({
                  testDir: './tests',
                  timeout: 30 * 1000,
                  expect: { timeout: 5000 },
                  fullyParallel: false,
                  retries: 0,
                  workers: 1,
                  outputDir: './test-results/artifacts',
                  reporter: [
                    ['html', { outputFolder: './test-results/html-report', open: 'never' }],
                    ['junit', { outputFile: './test-results/junit.xml' }],
                    ['%s']
                  ],
                  use: {
                    headless: %s,
                    trace: 'on',
                    screenshot: 'on',
                    video: 'retain-on-failure'
                  },
                  projects: [
                    {
                      name: '%s',
                      use: {
                        ...devices['%s'],
                        headless: %s
                      }
                    }
                  ]
                });
                """.formatted(reporterPath, headless, browser, deviceName, headless);
    }
}
