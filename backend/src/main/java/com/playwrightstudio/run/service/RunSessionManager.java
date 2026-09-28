package com.playwrightstudio.run.service;

import com.playwrightstudio.run.model.RunSession;
import com.playwrightstudio.run.model.RunStatus;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Thread-safe registry and lifecycle manager for real Playwright test-run
 * sessions. Unlike SessionManager (recordings), completed runs are kept for
 * the lifetime of the process rather than purged on a TTL, since the
 * Dashboard's run-history table reads from this same in-memory store.
 */
@Component
public class RunSessionManager {

    private static final Logger log = LoggerFactory.getLogger(RunSessionManager.class);

    private final ConcurrentHashMap<String, RunSession> sessions = new ConcurrentHashMap<>();

    // Continues the numbering from the frontend's mock run history (#409 was
    // the highest mocked run number), so real runs read as a natural
    // continuation of the existing demo data instead of restarting at #1.
    private final AtomicInteger runNumberSequence = new AtomicInteger(410);

    private static final Duration ORPHAN_RUNNING_TTL = Duration.ofMinutes(10);

    public int nextRunNumber() {
        return runNumberSequence.getAndIncrement();
    }

    public void registerSession(RunSession session) {
        sessions.put(session.getRunId(), session);
        log.info("[RunSessionManager] Registered run {} (#{}) for spec: {}", session.getRunId(), session.getRunNumber(), session.getSpecName());
    }

    public Optional<RunSession> getSession(String runId) {
        return Optional.ofNullable(sessions.get(runId));
    }

    /** Completed runs, most recent first, for the Dashboard's history table. */
    public List<RunSession> getCompletedRunsMostRecentFirst() {
        List<RunSession> completed = new ArrayList<>();
        sessions.forEach((id, session) -> {
            if (session.getStatus() != RunStatus.RUNNING) {
                completed.add(session);
            }
        });
        completed.sort((a, b) -> {
            Instant aTime = a.getFinishedAt() != null ? a.getFinishedAt() : a.getStartedAt();
            Instant bTime = b.getFinishedAt() != null ? b.getFinishedAt() : b.getStartedAt();
            return bTime.compareTo(aTime);
        });
        return Collections.unmodifiableList(completed);
    }

    public void removeSession(String runId) {
        RunSession session = sessions.remove(runId);
        if (session != null) {
            Process proc = session.getProcess();
            if (proc != null && proc.isAlive()) {
                try {
                    proc.destroyForcibly();
                } catch (Exception ignored) {
                }
            }
            log.info("[RunSessionManager] Removed run: {}", runId);
        }
    }

    /**
     * Scheduled background job: reaps runs whose child process died without
     * reporting a final status, or that have been RUNNING far longer than any
     * real test suite should take. Runs every 60 seconds.
     */
    @Scheduled(fixedRate = 60000)
    public void cleanupOrphanedRuns() {
        Instant now = Instant.now();

        sessions.forEach((runId, session) -> {
            if (session.getStatus() != RunStatus.RUNNING) {
                return;
            }

            Process proc = session.getProcess();
            if (proc != null && !proc.isAlive()) {
                log.warn("[RunSessionManager] Child process for run {} exited without a final status (exit code: {}). Marking FAILED.",
                        runId, proc.exitValue());
                session.setStatus(RunStatus.FAILED);
                session.setFailureReason("playwright test process exited unexpectedly with code: " + proc.exitValue());
            } else if (Duration.between(session.getLastActivityAt(), now).compareTo(ORPHAN_RUNNING_TTL) > 0) {
                log.warn("[RunSessionManager] Run {} exceeded orphan TTL with no activity. Terminating.", runId);
                if (proc != null && proc.isAlive()) {
                    proc.destroyForcibly();
                }
                session.setStatus(RunStatus.FAILED);
                session.setFailureReason("Run exceeded maximum allowed execution time with no activity.");
            }
        });
    }
}
