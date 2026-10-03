package com.playwrightstudio.validate.service;

import com.playwrightstudio.validate.dto.FrameworkValidationRequest;
import com.playwrightstudio.validate.dto.FrameworkValidationResponse;
import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Exercises the real child process: node recorder/dist/validateFramework.js
 * running the real tsc --noEmit, same convention as the frontend's own test
 * suite (no mocking the system under test). Requires 'npm run build' to have
 * produced recorder/dist/validateFramework.js before this test runs.
 */
class FrameworkValidationServiceTest {

    private final FrameworkValidationService service = new FrameworkValidationService();

    private static final String BASE_TSCONFIG = "{\"compilerOptions\":{\"target\":\"ES2022\",\"module\":\"ESNext\","
            + "\"moduleResolution\":\"Bundler\",\"strict\":true,\"skipLibCheck\":true,\"types\":[\"node\"]}}";

    @Test
    void passesForWellTypedGeneratedFiles() {
        FrameworkValidationRequest request = new FrameworkValidationRequest(Map.of(
                "tsconfig.json", BASE_TSCONFIG,
                "pages/Home.ts", "export const ok: number = 1;"
        ));

        FrameworkValidationResponse response = service.validate(request);

        assertEquals("PASS", response.getStatus());
        assertTrue(response.getDiagnostics().isEmpty());
    }

    @Test
    void failsAndReportsDiagnosticsForATypeError() {
        FrameworkValidationRequest request = new FrameworkValidationRequest(Map.of(
                "tsconfig.json", BASE_TSCONFIG,
                "pages/Broken.ts", "export const broken: number = \"not a number\";"
        ));

        FrameworkValidationResponse response = service.validate(request);

        assertEquals("FAIL", response.getStatus());
        assertFalse(response.getDiagnostics().isEmpty());
    }
}
