package com.playwrightstudio.run.model;

/**
 * A single step in a test-execution run's timeline, as reported live by the
 * custom NDJSON Playwright reporter (recorder/runReporter.ts). Mutable: a
 * step is created in 'pending' status on STEP_STARTED and updated in place
 * when its matching STEP_FINISHED record arrives.
 */
public class RunStepEvent {

    private final int id;
    private final String stepKey;
    private volatile String title;
    private volatile String category;
    private volatile String status = "pending";
    private volatile long durationMs = 0;
    private volatile String log = "";
    private volatile String error;
    private volatile String locator;
    private volatile String sourceFile;
    private volatile Integer sourceLine;

    public RunStepEvent(int id, String stepKey, String title, String category) {
        this.id = id;
        this.stepKey = stepKey;
        this.title = title;
        this.category = category;
    }

    public int getId() {
        return id;
    }

    public String getStepKey() {
        return stepKey;
    }

    public String getTitle() {
        return title;
    }

    public void setTitle(String title) {
        this.title = title;
    }

    public String getCategory() {
        return category;
    }

    public String getStatus() {
        return status;
    }

    public void setStatus(String status) {
        this.status = status;
    }

    public long getDurationMs() {
        return durationMs;
    }

    public void setDurationMs(long durationMs) {
        this.durationMs = durationMs;
    }

    public String getLog() {
        return log;
    }

    public void setLog(String log) {
        this.log = log;
    }

    public String getError() {
        return error;
    }

    public void setError(String error) {
        this.error = error;
    }

    public String getLocator() {
        return locator;
    }

    public void setLocator(String locator) {
        this.locator = locator;
    }

    public String getSourceFile() {
        return sourceFile;
    }

    public void setSourceFile(String sourceFile) {
        this.sourceFile = sourceFile;
    }

    public Integer getSourceLine() {
        return sourceLine;
    }

    public void setSourceLine(Integer sourceLine) {
        this.sourceLine = sourceLine;
    }
}
