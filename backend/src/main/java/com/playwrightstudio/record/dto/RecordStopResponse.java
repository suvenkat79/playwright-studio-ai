package com.playwrightstudio.record.dto;

public class RecordStopResponse {
    private String status;
    private String sessionId;
    private int totalEvents;
    private String testScript;

    public RecordStopResponse() {}

    public RecordStopResponse(String status, String sessionId, int totalEvents, String testScript) {
        this.status = status;
        this.sessionId = sessionId;
        this.totalEvents = totalEvents;
        this.testScript = testScript;
    }

    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }

    public String getSessionId() { return sessionId; }
    public void setSessionId(String sessionId) { this.sessionId = sessionId; }

    public int getTotalEvents() { return totalEvents; }
    public void setTotalEvents(int totalEvents) { this.totalEvents = totalEvents; }

    public String getTestScript() { return testScript; }
    public void setTestScript(String testScript) { this.testScript = testScript; }
}
