package com.playwrightstudio.validate.controller;

import com.playwrightstudio.validate.dto.FrameworkValidationRequest;
import com.playwrightstudio.validate.dto.FrameworkValidationResponse;
import com.playwrightstudio.validate.service.FrameworkValidationService;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/api/framework")
@CrossOrigin(origins = "*", allowedHeaders = "*")
public class FrameworkValidationController {

    private final FrameworkValidationService validationService;

    public FrameworkValidationController(FrameworkValidationService validationService) {
        this.validationService = validationService;
    }

    /**
     * POST /api/framework/validate
     * Deterministic "Validate Framework" gate: runs tsc --noEmit against
     * the generated FrameworkProject's files and returns PASS/FAIL with
     * structural/type diagnostics. Never an LLM call -- that is the
     * separate, not-yet-implemented "AI Framework Review" step.
     */
    @PostMapping("/validate")
    public ResponseEntity<?> validate(@RequestBody FrameworkValidationRequest request) {
        if (request.getFiles() == null || request.getFiles().isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("message", "\"files\" is required."));
        }
        try {
            FrameworkValidationResponse response = validationService.validate(request);
            return ResponseEntity.ok(response);
        } catch (IllegalStateException e) {
            return ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of("message", e.getMessage()));
        } catch (RuntimeException e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(Map.of("message", e.getMessage()));
        }
    }
}
