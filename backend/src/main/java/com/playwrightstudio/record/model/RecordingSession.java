package com.playwrightstudio.record.model;

import com.playwrightstudio.record.dto.RecordedActionDto;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Domain entity representing an active or completed recording session.
 */
public class RecordingSession {

    private final String sessionId;
    private final String targetUrl;
    private volatile Process process;
    private final Instant startedAt;
    private volatile Instant lastActivityAt;
    private volatile SessionStatus status;
    private final List<RecordedActionDto> events = Collections.synchronizedList(new ArrayList<>());
    private volatile String generatedTestScript = "";
    private volatile String failureReason;
    private volatile String browserStorageStateJson;

    public RecordingSession(String sessionId, String targetUrl) {
        this.sessionId = sessionId;
        this.targetUrl = targetUrl;
        this.startedAt = Instant.now();
        this.lastActivityAt = Instant.now();
        this.status = SessionStatus.RUNNING;
    }

    public RecordingSession(String sessionId, String targetUrl, Process process) {
        this(sessionId, targetUrl);
        this.process = process;
    }

    public String getSessionId() {
        return sessionId;
    }

    public String getTargetUrl() {
        return targetUrl;
    }

    public Process getProcess() {
        return process;
    }

    public void setProcess(Process process) {
        this.process = process;
    }

    public Instant getStartedAt() {
        return startedAt;
    }

    public Instant getLastActivityAt() {
        return lastActivityAt;
    }

    public void touch() {
        this.lastActivityAt = Instant.now();
    }

    public SessionStatus getStatus() {
        return status;
    }

    public void setStatus(SessionStatus status) {
        this.status = status;
        this.lastActivityAt = Instant.now();
    }

    public List<RecordedActionDto> getEvents() {
        return events;
    }

    public void addEvent(RecordedActionDto event) {
        this.events.add(event);
        this.lastActivityAt = Instant.now();
    }

    public String getGeneratedTestScript() {
        return generatedTestScript;
    }

    public void setGeneratedTestScript(String generatedTestScript) {
        this.generatedTestScript = generatedTestScript;
    }

    public String getFailureReason() {
        return failureReason;
    }

    public void setFailureReason(String failureReason) {
        this.failureReason = failureReason;
    }

    public String getBrowserStorageStateJson() {
        return browserStorageStateJson;
    }

    public void setBrowserStorageStateJson(String browserStorageStateJson) {
        this.browserStorageStateJson = browserStorageStateJson;
    }
}
