package com.playwrightstudio.record.controller;

import com.playwrightstudio.record.dto.RecordStartRequest;
import com.playwrightstudio.record.dto.RecordStartResponse;
import com.playwrightstudio.record.dto.RecordStopResponse;
import com.playwrightstudio.record.dto.RecordedActionDto;
import com.playwrightstudio.record.dto.SessionStatusResponse;
import com.playwrightstudio.record.service.RecordingService;
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
}
