package com.playwrightstudio.record.service;

import com.playwrightstudio.record.model.RecordingSession;
import com.playwrightstudio.record.model.SessionStatus;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Thread-safe session persistence and lifecycle manager for Playwright recording sessions.
 */
@Component
public class SessionManager {

    private static final Logger log = LoggerFactory.getLogger(SessionManager.class);

    // Thread-safe session store
    private final ConcurrentHashMap<String, RecordingSession> sessions = new ConcurrentHashMap<>();

    // Retention limits
    private static final Duration COMPLETED_SESSION_TTL = Duration.ofMinutes(30);
    private static final Duration ORPHAN_SESSION_TTL = Duration.ofHours(1);

    /**
     * Registers a new session
     */
    public void registerSession(RecordingSession session) {
        sessions.put(session.getSessionId(), session);
        log.info("[SessionManager] Registered session {} for URL: {}", session.getSessionId(), session.getTargetUrl());
    }

    /**
     * Retrieves a session by ID
     */
    public Optional<RecordingSession> getSession(String sessionId) {
        return Optional.ofNullable(sessions.get(sessionId));
    }

    /**
     * Returns an unmodifiable collection of all sessions
     */
    public Collection<RecordingSession> getAllSessions() {
        return Collections.unmodifiableCollection(sessions.values());
    }

    /**
     * Updates session status
     */
    public void updateStatus(String sessionId, SessionStatus status) {
        RecordingSession session = sessions.get(sessionId);
        if (session != null) {
            session.setStatus(status);
        }
    }

    /**
     * Marks a session as FAILED with an explanatory reason and stops any underlying process
     */
    public void markFailed(String sessionId, String reason) {
        RecordingSession session = sessions.get(sessionId);
        if (session != null) {
            session.setStatus(SessionStatus.FAILED);
            session.setFailureReason(reason);
            log.warn("[SessionManager] Marked session {} as FAILED: {}", sessionId, reason);

            Process proc = session.getProcess();
            if (proc != null && proc.isAlive()) {
                proc.destroyForcibly();
            }
        }
    }

    /**
     * Removes a session and terminates its process if alive
     */
    public void removeSession(String sessionId) {
        RecordingSession session = sessions.remove(sessionId);
        if (session != null) {
            Process proc = session.getProcess();
            if (proc != null && proc.isAlive()) {
                try {
                    proc.destroyForcibly();
                } catch (Exception ignored) {
                }
            }
            log.info("[SessionManager] Removed session: {}", sessionId);
        }
    }

    /**
     * Scheduled background job: cleans up completed, stopped, or orphaned sessions.
     * Runs every 60 seconds.
     */
    @Scheduled(fixedRate = 60000)
    public void cleanupSessions() {
        Instant now = Instant.now();
        List<String> toRemove = new ArrayList<>();

        sessions.forEach((sessionId, session) -> {
            Process proc = session.getProcess();

            if (session.getStatus() == SessionStatus.RUNNING) {
                // If child process died unexpectedly without sending STOP
                if (proc != null && !proc.isAlive()) {
                    log.warn("[SessionManager] Child process for session {} exited unexpectedly (exit code: {}). Transitioning to FAILED.",
                            sessionId, proc.exitValue());
                    session.setStatus(SessionStatus.FAILED);
                    session.setFailureReason("Recorder process terminated unexpectedly with code: " + proc.exitValue());
                } else if (Duration.between(session.getLastActivityAt(), now).compareTo(ORPHAN_SESSION_TTL) > 0) {
                    // Orphaned session with no activity for over an hour
                    log.warn("[SessionManager] Orphan session {} exceeded TTL. Cleaning up.", sessionId);
                    if (proc != null && proc.isAlive()) {
                        proc.destroyForcibly();
                    }
                    toRemove.add(sessionId);
                }
            } else if (session.getStatus() == SessionStatus.STOPPED || session.getStatus() == SessionStatus.FAILED) {
                // Completed sessions older than COMPLETED_SESSION_TTL are purged
                if (Duration.between(session.getLastActivityAt(), now).compareTo(COMPLETED_SESSION_TTL) > 0) {
                    log.info("[SessionManager] Purging expired completed session: {}", sessionId);
                    toRemove.add(sessionId);
                }
            }
        });

        for (String id : toRemove) {
            removeSession(id);
        }
    }
}
