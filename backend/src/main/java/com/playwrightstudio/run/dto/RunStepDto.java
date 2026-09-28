package com.playwrightstudio.run.dto;

public class RunStepDto {
    private int id;
    private String title;
    private String category;
    private String status;
    private long durationMs;
    private String log;
    private String error;
    private String locator;
    private String sourceFile;
    private Integer sourceLine;

    public RunStepDto() {}

    public RunStepDto(int id, String title, String category, String status, long durationMs, String log,
                       String error, String locator, String sourceFile, Integer sourceLine) {
        this.id = id;
        this.title = title;
        this.category = category;
        this.status = status;
        this.durationMs = durationMs;
        this.log = log;
        this.error = error;
        this.locator = locator;
        this.sourceFile = sourceFile;
        this.sourceLine = sourceLine;
    }

    public int getId() { return id; }
    public void setId(int id) { this.id = id; }

    public String getTitle() { return title; }
    public void setTitle(String title) { this.title = title; }

    public String getCategory() { return category; }
    public void setCategory(String category) { this.category = category; }

    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }

    public long getDurationMs() { return durationMs; }
    public void setDurationMs(long durationMs) { this.durationMs = durationMs; }

    public String getLog() { return log; }
    public void setLog(String log) { this.log = log; }

    public String getError() { return error; }
    public void setError(String error) { this.error = error; }

    public String getLocator() { return locator; }
    public void setLocator(String locator) { this.locator = locator; }

    public String getSourceFile() { return sourceFile; }
    public void setSourceFile(String sourceFile) { this.sourceFile = sourceFile; }

    public Integer getSourceLine() { return sourceLine; }
    public void setSourceLine(Integer sourceLine) { this.sourceLine = sourceLine; }
}
