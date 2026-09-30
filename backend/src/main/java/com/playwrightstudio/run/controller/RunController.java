package com.playwrightstudio.run.controller;

import com.playwrightstudio.run.dto.*;
import com.playwrightstudio.run.service.RunService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.core.io.FileSystemResource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.HandlerMapping;

import java.io.File;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/run")
@CrossOrigin(origins = "*", allowedHeaders = "*")
public class RunController {

    private final RunService runService;

    public RunController(RunService runService) {
        this.runService = runService;
    }

    /**
     * POST /api/run/execute
     * Materializes the given spec (+ optional POM) to a real on-disk
     * workspace and spawns `npx playwright test` against it.
     */
    @PostMapping("/execute")
    public ResponseEntity<RunExecuteResponse> executeRun(@RequestBody RunExecuteRequest request) {
        boolean hasLegacyContent = request.getSpecContent() != null && !request.getSpecContent().isBlank();
        boolean hasDirectSpec = request.getSpec() != null && !request.getSpec().isBlank();
        if (!hasLegacyContent && !hasDirectSpec) {
            return ResponseEntity.badRequest().build();
        }

        RunExecuteResponse response = runService.executeRun(request);
        return ResponseEntity.ok(response);
    }

    /**
     * GET /api/run/events?runId={id}
     * Polls the live step timeline, console logs, and (once finished) report
     * artifact paths for a run.
     */
    @GetMapping("/events")
    public ResponseEntity<RunEventsResponse> getRunEvents(@RequestParam String runId) {
        RunEventsResponse response = runService.getRunEvents(runId);
        if (response == null) {
            return ResponseEntity.notFound().build();
        }
        return ResponseEntity.ok(response);
    }

    /**
     * POST /api/run/cancel
     * Terminates an in-progress run's child process.
     */
    @PostMapping("/cancel")
    public ResponseEntity<Map<String, Object>> cancelRun(@RequestBody Map<String, String> body) {
        String runId = body.get("runId");
        if (runId == null) {
            return ResponseEntity.badRequest().build();
        }
        boolean cancelled = runService.cancelRun(runId);
        return ResponseEntity.ok(Map.of("runId", runId, "cancelled", cancelled));
    }

    /**
     * GET /api/run/history
     * Recent completed runs (most recent first), for the Dashboard's
     * "Recent Pipeline Executions" table.
     */
    @GetMapping("/history")
    public ResponseEntity<List<RunHistoryEntryDto>> getRunHistory() {
        return ResponseEntity.ok(runService.getRunHistory());
    }

    /**
     * GET /api/run/artifact/{runId}/**
     * Serves a file from inside a run's workspace (HTML report, its assets,
     * JUnit XML, trace.zip, screenshots). Path-based rather than a `?path=`
     * query param so the Playwright HTML report's own relative asset links
     * (JS/CSS/data files alongside index.html) keep resolving correctly once
     * opened through this endpoint. RunService#resolveArtifactFile rejects
     * anything that would escape the run's workspace directory.
     */
    @GetMapping("/artifact/{runId}/**")
    public ResponseEntity<FileSystemResource> getArtifact(@PathVariable String runId, HttpServletRequest request) {
        String fullPath = (String) request.getAttribute(HandlerMapping.PATH_WITHIN_HANDLER_MAPPING_ATTRIBUTE);
        String prefix = "/api/run/artifact/" + runId + "/";
        if (fullPath == null || !fullPath.startsWith(prefix)) {
            return ResponseEntity.badRequest().build();
        }
        String relativePath = fullPath.substring(prefix.length());

        File file = runService.resolveArtifactFile(runId, relativePath);
        if (file == null) {
            return ResponseEntity.notFound().build();
        }

        MediaType contentType = guessContentType(file.getName());
        ResponseEntity.BodyBuilder response = ResponseEntity.ok().contentType(contentType);
        if (file.getName().endsWith(".zip")) {
            response.header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + file.getName() + "\"");
        }
        return response.body(new FileSystemResource(file));
    }

    private MediaType guessContentType(String fileName) {
        String lower = fileName.toLowerCase();
        if (lower.endsWith(".html")) return MediaType.TEXT_HTML;
        if (lower.endsWith(".js") || lower.endsWith(".mjs")) return MediaType.parseMediaType("application/javascript");
        if (lower.endsWith(".css")) return MediaType.parseMediaType("text/css");
        if (lower.endsWith(".json")) return MediaType.APPLICATION_JSON;
        if (lower.endsWith(".xml")) return MediaType.APPLICATION_XML;
        if (lower.endsWith(".zip")) return MediaType.parseMediaType("application/zip");
        if (lower.endsWith(".png")) return MediaType.IMAGE_PNG;
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return MediaType.IMAGE_JPEG;
        if (lower.endsWith(".webm")) return MediaType.parseMediaType("video/webm");
        if (lower.endsWith(".svg")) return MediaType.parseMediaType("image/svg+xml");
        if (lower.endsWith(".woff2")) return MediaType.parseMediaType("font/woff2");
        return MediaType.APPLICATION_OCTET_STREAM;
    }
}
