package com.playwrightstudio.run.dto;

import java.util.List;

public class RunEventsResponse {
    private String runId;
    private String status;
    private List<RunStepDto> steps;
    private List<String> logs;
    private long totalDurationMs;
    private RunReportPathsDto reportPaths;
    private String failureReason;

    public RunEventsResponse() {}

    public RunEventsResponse(String runId, String status, List<RunStepDto> steps, List<String> logs,
                              long totalDurationMs, RunReportPathsDto reportPaths, String failureReason) {
        this.runId = runId;
        this.status = status;
        this.steps = steps;
        this.logs = logs;
        this.totalDurationMs = totalDurationMs;
        this.reportPaths = reportPaths;
        this.failureReason = failureReason;
    }

    public String getRunId() { return runId; }
    public void setRunId(String runId) { this.runId = runId; }

    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }

    public List<RunStepDto> getSteps() { return steps; }
    public void setSteps(List<RunStepDto> steps) { this.steps = steps; }

    public List<String> getLogs() { return logs; }
    public void setLogs(List<String> logs) { this.logs = logs; }

    public long getTotalDurationMs() { return totalDurationMs; }
    public void setTotalDurationMs(long totalDurationMs) { this.totalDurationMs = totalDurationMs; }

    public RunReportPathsDto getReportPaths() { return reportPaths; }
    public void setReportPaths(RunReportPathsDto reportPaths) { this.reportPaths = reportPaths; }

    public String getFailureReason() { return failureReason; }
    public void setFailureReason(String failureReason) { this.failureReason = failureReason; }
}
