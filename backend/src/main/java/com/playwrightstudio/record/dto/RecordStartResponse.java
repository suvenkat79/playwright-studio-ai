package com.playwrightstudio.record.dto;

public class RecordStartResponse {
    private String status;
    private String sessionId;
    private String targetUrl;

    public RecordStartResponse() {}

    public RecordStartResponse(String status, String sessionId, String targetUrl) {
        this.status = status;
        this.sessionId = sessionId;
        this.targetUrl = targetUrl;
    }

    public String getStatus() {
        return status;
    }

    public void setStatus(String status) {
        this.status = status;
    }

    public String getSessionId() {
        return sessionId;
    }

    public void setSessionId(String sessionId) {
        this.sessionId = sessionId;
    }

    public String getTargetUrl() {
        return targetUrl;
    }

    public void setTargetUrl(String targetUrl) {
        this.targetUrl = targetUrl;
    }
}
