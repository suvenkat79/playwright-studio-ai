package com.playwrightstudio.validate.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.playwrightstudio.common.ProjectPaths;
import com.playwrightstudio.validate.dto.FrameworkValidationRequest;
import com.playwrightstudio.validate.dto.FrameworkValidationResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.BufferedReader;
import java.io.File;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.TimeUnit;

/**
 * "Validate Framework": a deterministic, non-LLM gate. Spawns the compiled
 * recorder/dist/validateFramework.js as a short-lived (request/response,
 * not a long-running session) Node child process via ProcessBuilder --
 * the same pattern RecordingService uses to launch the recorder, minus the
 * session lifecycle. The actual tsc --noEmit check lives once, in the
 * frontend's src/services/frameworkValidator.ts; this service never
 * re-implements it.
 */
@Service
public class FrameworkValidationService {

    private static final Logger log = LoggerFactory.getLogger(FrameworkValidationService.class);
    private final ObjectMapper objectMapper = new ObjectMapper();

    @Value("${playwright.validator.script:recorder/dist/validateFramework.js}")
    private String validatorScriptPath = "recorder/dist/validateFramework.js";

    @Value("${playwright.validator.timeoutSeconds:60}")
    private int timeoutSeconds = 60;

    public FrameworkValidationResponse validate(FrameworkValidationRequest request) {
        File workingDir = ProjectPaths.resolveProjectRoot();
        File scriptFile = new File(workingDir, validatorScriptPath);
        if (!scriptFile.exists()) {
            throw new IllegalStateException(
                "Compiled framework validator not found: " + scriptFile.getAbsolutePath() + ". Run 'npm run build'.");
        }

        try {
            ProcessBuilder builder = new ProcessBuilder("node", validatorScriptPath);
            builder.directory(workingDir);
            Process process = builder.start();

            String payload = objectMapper.writeValueAsString(request);
            try (OutputStream stdin = process.getOutputStream()) {
                stdin.write(payload.getBytes(StandardCharsets.UTF_8));
            }

            StringBuilder stdout = new StringBuilder();
            Thread stdoutThread = new Thread(() -> {
                try (BufferedReader reader = new BufferedReader(
                        new InputStreamReader(process.getInputStream(), StandardCharsets.UTF_8))) {
                    String line;
                    while ((line = reader.readLine()) != null) {
                        stdout.append(line).append('\n');
                    }
                } catch (IOException e) {
                    log.debug("[FrameworkValidationService] Stdout stream closed: {}", e.getMessage());
                }
            }, "FrameworkValidate-Stdout");
            stdoutThread.setDaemon(true);
            stdoutThread.start();

            StringBuilder stderr = new StringBuilder();
            Thread stderrThread = new Thread(() -> {
                try (BufferedReader reader = new BufferedReader(
                        new InputStreamReader(process.getErrorStream(), StandardCharsets.UTF_8))) {
                    String line;
                    while ((line = reader.readLine()) != null) {
                        stderr.append(line).append('\n');
                        log.info("[FrameworkValidator] {}", line);
                    }
                } catch (IOException e) {
                    log.debug("[FrameworkValidationService] Stderr stream closed: {}", e.getMessage());
                }
            }, "FrameworkValidate-Stderr");
            stderrThread.setDaemon(true);
            stderrThread.start();

            boolean finished = process.waitFor(timeoutSeconds, TimeUnit.SECONDS);
            stdoutThread.join(2000);
            stderrThread.join(2000);

            if (!finished) {
                process.destroyForcibly();
                throw new IllegalStateException("Framework validation timed out after " + timeoutSeconds + " seconds.");
            }

            String output = stdout.toString().trim();
            if (output.isEmpty()) {
                throw new IllegalStateException("Framework validator produced no output. stderr: " + stderr);
            }

            // The CLI writes exactly one JSON object as its final line of
            // output; ignore any earlier diagnostic lines if present.
            String lastLine = output.lines().reduce((first, second) -> second).orElse(output);
            return objectMapper.readValue(lastLine, FrameworkValidationResponse.class);
        } catch (IOException e) {
            throw new RuntimeException("Failed to run framework validation: " + e.getMessage(), e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new RuntimeException("Interrupted while running framework validation.", e);
        }
    }
}
