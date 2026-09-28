package com.playwrightstudio.run.dto;

public class RunExecuteResponse {
    private String runId;
    private String status;
    private int runNumber;

    public RunExecuteResponse() {}

    public RunExecuteResponse(String runId, String status, int runNumber) {
        this.runId = runId;
        this.status = status;
        this.runNumber = runNumber;
    }

    public String getRunId() { return runId; }
    public void setRunId(String runId) { this.runId = runId; }

    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }

    public int getRunNumber() { return runNumber; }
    public void setRunNumber(int runNumber) { this.runNumber = runNumber; }
}
