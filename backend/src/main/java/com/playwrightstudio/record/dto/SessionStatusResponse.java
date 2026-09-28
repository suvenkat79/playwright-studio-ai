package com.playwrightstudio.record.dto;

import com.playwrightstudio.record.model.SessionStatus;

import java.time.Instant;

public class SessionStatusResponse {

    private String sessionId;
    private SessionStatus status;
    private boolean isActive;
    private int totalEvents;
    private String targetUrl;
    private Instant startedAt;
    private String failureReason;

    public SessionStatusResponse() {
    }

    public SessionStatusResponse(String sessionId, SessionStatus status, int totalEvents, String targetUrl, Instant startedAt, String failureReason) {
        this.sessionId = sessionId;
        this.status = status;
        this.isActive = (status == SessionStatus.RUNNING);
        this.totalEvents = totalEvents;
        this.targetUrl = targetUrl;
        this.startedAt = startedAt;
        this.failureReason = failureReason;
    }

    public String getSessionId() {
        return sessionId;
    }

    public void setSessionId(String sessionId) {
        this.sessionId = sessionId;
    }

    public SessionStatus getStatus() {
        return status;
    }

    public void setStatus(SessionStatus status) {
        this.status = status;
        this.isActive = (status == SessionStatus.RUNNING);
    }

    public boolean isActive() {
        return isActive;
    }

    public void setActive(boolean active) {
        isActive = active;
    }

    public int getTotalEvents() {
        return totalEvents;
    }

    public void setTotalEvents(int totalEvents) {
        this.totalEvents = totalEvents;
    }

    public String getTargetUrl() {
        return targetUrl;
    }

    public void setTargetUrl(String targetUrl) {
        this.targetUrl = targetUrl;
    }

    public Instant getStartedAt() {
        return startedAt;
    }

    public void setStartedAt(Instant startedAt) {
        this.startedAt = startedAt;
    }

    public String getFailureReason() {
        return failureReason;
    }

    public void setFailureReason(String failureReason) {
        this.failureReason = failureReason;
    }
}
