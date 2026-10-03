package com.playwrightstudio.validate.dto;

import java.util.Map;

/**
 * "Validate Framework": the generated FrameworkProject's files, keyed by
 * their relative path (e.g. "pages/IncidentFormPage1.ts"), exactly as
 * produced by the frontend's generateFrameworkProject().
 */
public class FrameworkValidationRequest {
    private Map<String, String> files;

    public FrameworkValidationRequest() {}

    public FrameworkValidationRequest(Map<String, String> files) {
        this.files = files;
    }

    public Map<String, String> getFiles() { return files; }
    public void setFiles(Map<String, String> files) { this.files = files; }
}
