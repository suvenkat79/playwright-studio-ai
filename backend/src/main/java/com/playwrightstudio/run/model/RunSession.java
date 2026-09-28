package com.playwrightstudio.run.model;

import java.io.File;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Domain entity representing an active or completed real Playwright
 * test-execution run, spawned as a child `npx playwright test` process.
 */
public class RunSession {

    private final String runId;
    private final int runNumber;
    private final String specName;
    private final String browser;
    private final boolean headless;
    private final File workspaceDir;
    private volatile Process process;
    private final Instant startedAt;
    private volatile Instant finishedAt;
    private volatile Instant lastActivityAt;
    private volatile RunStatus status = RunStatus.RUNNING;
    private volatile String failureReason;
    private volatile long totalDurationMs = 0;

    private final List<RunStepEvent> steps = Collections.synchronizedList(new ArrayList<>());
    private final Map<String, RunStepEvent> stepsByKey = new ConcurrentHashMap<>();
    private final List<String> logs = Collections.synchronizedList(new ArrayList<>());
    private final RunReportPaths reportPaths = new RunReportPaths();

    public RunSession(String runId, int runNumber, String specName, String browser, boolean headless, File workspaceDir) {
        this.runId = runId;
        this.runNumber = runNumber;
        this.specName = specName;
        this.browser = browser;
        this.headless = headless;
        this.workspaceDir = workspaceDir;
        this.startedAt = Instant.now();
        this.lastActivityAt = Instant.now();
    }

    public String getRunId() {
        return runId;
    }

    public int getRunNumber() {
        return runNumber;
    }

    public String getSpecName() {
        return specName;
    }

    public String getBrowser() {
        return browser;
    }

    public boolean isHeadless() {
        return headless;
    }

    public File getWorkspaceDir() {
        return workspaceDir;
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

    public Instant getFinishedAt() {
        return finishedAt;
    }

    public Instant getLastActivityAt() {
        return lastActivityAt;
    }

    public void touch() {
        this.lastActivityAt = Instant.now();
    }

    public RunStatus getStatus() {
        return status;
    }

    public void setStatus(RunStatus status) {
        this.status = status;
        this.lastActivityAt = Instant.now();
        if (status != RunStatus.RUNNING) {
            this.finishedAt = Instant.now();
        }
    }

    public String getFailureReason() {
        return failureReason;
    }

    public void setFailureReason(String failureReason) {
        this.failureReason = failureReason;
    }

    public long getTotalDurationMs() {
        return totalDurationMs;
    }

    public void setTotalDurationMs(long totalDurationMs) {
        this.totalDurationMs = totalDurationMs;
    }

    public List<RunStepEvent> getSteps() {
        return steps;
    }

    /** Creates (if absent) and returns the step tracked under this reporter-assigned key. */
    public RunStepEvent getOrCreateStep(String stepKey, String title, String category) {
        return stepsByKey.computeIfAbsent(stepKey, k -> {
            RunStepEvent step = new RunStepEvent(steps.size() + 1, stepKey, title, category);
            steps.add(step);
            return step;
        });
    }

    public RunStepEvent findStep(String stepKey) {
        return stepsByKey.get(stepKey);
    }

    public List<String> getLogs() {
        return logs;
    }

    public void addLog(String line) {
        this.logs.add(line);
        touch();
    }

    public RunReportPaths getReportPaths() {
        return reportPaths;
    }
}
