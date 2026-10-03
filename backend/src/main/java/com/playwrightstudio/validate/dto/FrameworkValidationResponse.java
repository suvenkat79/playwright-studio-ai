package com.playwrightstudio.validate.dto;

import java.util.List;

/**
 * Result of the deterministic "Validate Framework" gate: PASS/FAIL plus
 * structural/type-safety diagnostics when FAIL, exactly as produced by
 * recorder/validateFramework.js (a thin CLI wrapper around the frontend's
 * own validateFrameworkProject() -- the tsc --noEmit check is never
 * duplicated here).
 */
public class FrameworkValidationResponse {
    private String status;
    private List<FrameworkValidationDiagnosticDto> diagnostics;
    private long checkedAt;

    public FrameworkValidationResponse() {}

    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }

    public List<FrameworkValidationDiagnosticDto> getDiagnostics() { return diagnostics; }
    public void setDiagnostics(List<FrameworkValidationDiagnosticDto> diagnostics) { this.diagnostics = diagnostics; }

    public long getCheckedAt() { return checkedAt; }
    public void setCheckedAt(long checkedAt) { this.checkedAt = checkedAt; }
}
