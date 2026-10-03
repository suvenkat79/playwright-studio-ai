package com.playwrightstudio.record.controller;

import com.playwrightstudio.record.dto.RecordStartRequest;
import com.playwrightstudio.record.dto.RecordStartResponse;
import com.playwrightstudio.record.dto.RecordStopResponse;
import com.playwrightstudio.record.dto.RecordedActionDto;
import com.playwrightstudio.record.dto.ResolveIntentRequest;
import com.playwrightstudio.record.dto.ResolveIntentResponse;
import com.playwrightstudio.record.dto.SessionStatusResponse;
import com.playwrightstudio.record.service.RecordingService;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/record")
@CrossOrigin(origins = "*", allowedHeaders = "*")
public class RecordingController {

    private final RecordingService recordingService;

    public RecordingController(RecordingService recordingService) {
        this.recordingService = recordingService;
    }

    /**
     * POST /api/record/start
     * Starts a new recording session on target URL
     */
    @PostMapping("/start")
    public ResponseEntity<RecordStartResponse> startRecording(@RequestBody RecordStartRequest request) {
        if (request.getUrl() == null || request.getUrl().trim().isEmpty()) {
            return ResponseEntity.badRequest().build();
        }

        RecordStartResponse response = recordingService.startRecordingSession(request.getUrl().trim());
        return ResponseEntity.ok(response);
    }

    /**
     * GET /api/record/status?sessionId={id}
     * Returns session status (RUNNING, STOPPED, FAILED) and metadata
     */
    @GetMapping("/status")
    public ResponseEntity<SessionStatusResponse> getSessionStatus(@RequestParam String sessionId) {
        SessionStatusResponse status = recordingService.getSessionStatus(sessionId);
        if (status == null) {
            return ResponseEntity.notFound().build();
        }
        return ResponseEntity.ok(status);
    }

    /**
     * GET /api/record/events?sessionId={id}
     * Polls captured actions and locators in real-time
     */
    @GetMapping("/events")
    public ResponseEntity<Map<String, Object>> getRecordedEvents(@RequestParam String sessionId) {
        List<RecordedActionDto> events = recordingService.getSessionEvents(sessionId);
        boolean isRecording = recordingService.isSessionActive(sessionId);

        return ResponseEntity.ok(Map.of(
            "sessionId", sessionId,
            "events", events,
            "isRecording", isRecording,
            "totalEvents", events.size()
        ));
    }

    /**
     * POST /api/record/stop
     * Stops recording session and returns compiled Playwright test script
     */
    @PostMapping("/stop")
    public ResponseEntity<RecordStopResponse> stopRecording(@RequestBody Map<String, String> body) {
        String sessionId = body.get("sessionId");
        if (sessionId == null) {
            return ResponseEntity.badRequest().build();
        }

        RecordStopResponse result = recordingService.stopRecordingSession(sessionId);
        return ResponseEntity.ok(result);
    }

    /**
     * Starts a non-recording browser for stopped-session workflow resolution.
     */
    @PostMapping("/resolution/start")
    public ResponseEntity<?> startResolutionSession(@RequestBody RecordStartRequest request) {
        if (request.getUrl() == null || request.getUrl().trim().isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("message", "\"url\" is required."));
        }
        try {
            return ResponseEntity.ok(recordingService.startResolutionSession(
                    request.getUrl().trim(),
                    request.getSourceSessionId() == null ? null : request.getSourceSessionId().trim()));
        } catch (IllegalStateException e) {
            return ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of("message", e.getMessage()));
        }
    }

    /**
     * Closes a non-recording AI Gen resolution browser.
     */
    @PostMapping("/resolution/stop")
    public ResponseEntity<Void> closeResolutionSession(@RequestBody Map<String, String> body) {
        String sessionId = body.get("sessionId");
        if (sessionId == null || sessionId.trim().isEmpty()) {
            return ResponseEntity.badRequest().build();
        }
        recordingService.closeResolutionSession(sessionId);
        return ResponseEntity.noContent().build();
    }

    /**
     * POST /api/record/resolve-intent
     * AI Gen: resolves one natural-language instruction against the live
     * page of an active recording session — returns real, replayable
     * actions (RecordedActionDto), never a fabricated result. 409 when
     * there is no active session to resolve against, since that is a
     * client-state problem, not a server error.
     */
    @PostMapping("/resolve-intent")
    public ResponseEntity<?> resolveIntent(@RequestBody ResolveIntentRequest request) {
        if (request.getSessionId() == null || request.getSessionId().trim().isEmpty()
                || request.getInstruction() == null || request.getInstruction().trim().isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("message", "\"sessionId\" and \"instruction\" are required."));
        }

        try {
            ResolveIntentResponse response = recordingService.resolveIntent(request.getSessionId(), request.getInstruction());
            return ResponseEntity.ok(response);
        } catch (IllegalStateException e) {
            return ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of("message", e.getMessage()));
        } catch (RuntimeException e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(Map.of("message", e.getMessage()));
        }
    }
}
