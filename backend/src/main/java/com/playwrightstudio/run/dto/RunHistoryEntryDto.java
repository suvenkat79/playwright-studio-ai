package com.playwrightstudio.run.dto;

public class RunHistoryEntryDto {
    private String id;
    private int runNumber;
    private String suiteName;
    private String branch;
    private String commitSha;
    private String timestamp;
    private String status;
    private long durationMs;
    private String browser;
    private int totalSteps;
    private int healedCount;

    public RunHistoryEntryDto() {}

    public RunHistoryEntryDto(String id, int runNumber, String suiteName, String branch, String commitSha,
                               String timestamp, String status, long durationMs, String browser,
                               int totalSteps, int healedCount) {
        this.id = id;
        this.runNumber = runNumber;
        this.suiteName = suiteName;
        this.branch = branch;
        this.commitSha = commitSha;
        this.timestamp = timestamp;
        this.status = status;
        this.durationMs = durationMs;
        this.browser = browser;
        this.totalSteps = totalSteps;
        this.healedCount = healedCount;
    }

    public String getId() { return id; }
    public void setId(String id) { this.id = id; }

    public int getRunNumber() { return runNumber; }
    public void setRunNumber(int runNumber) { this.runNumber = runNumber; }

    public String getSuiteName() { return suiteName; }
    public void setSuiteName(String suiteName) { this.suiteName = suiteName; }

    public String getBranch() { return branch; }
    public void setBranch(String branch) { this.branch = branch; }

    public String getCommitSha() { return commitSha; }
    public void setCommitSha(String commitSha) { this.commitSha = commitSha; }

    public String getTimestamp() { return timestamp; }
    public void setTimestamp(String timestamp) { this.timestamp = timestamp; }

    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }

    public long getDurationMs() { return durationMs; }
    public void setDurationMs(long durationMs) { this.durationMs = durationMs; }

    public String getBrowser() { return browser; }
    public void setBrowser(String browser) { this.browser = browser; }

    public int getTotalSteps() { return totalSteps; }
    public void setTotalSteps(int totalSteps) { this.totalSteps = totalSteps; }

    public int getHealedCount() { return healedCount; }
    public void setHealedCount(int healedCount) { this.healedCount = healedCount; }
}
