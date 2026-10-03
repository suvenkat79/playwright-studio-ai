package com.playwrightstudio.record.dto;

public class ResolveIntentRequest {
    private String sessionId;
    private String instruction;

    public ResolveIntentRequest() {}

    public ResolveIntentRequest(String sessionId, String instruction) {
        this.sessionId = sessionId;
        this.instruction = instruction;
    }

    public String getSessionId() { return sessionId; }
    public void setSessionId(String sessionId) { this.sessionId = sessionId; }

    public String getInstruction() { return instruction; }
    public void setInstruction(String instruction) { this.instruction = instruction; }
}
