package com.playwrightstudio.run.model;

/**
 * Lifecycle status of a real Playwright test-execution run.
 */
public enum RunStatus {
    RUNNING,
    PASSED,
    FAILED,
    CANCELLED,
    ERROR
}
