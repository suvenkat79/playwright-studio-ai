package com.playwrightstudio.common;

import java.io.File;

/**
 * Shared filesystem helpers for locating the Node/Playwright project root
 * from the Spring Boot backend's working directory. Used by both the
 * recorder (child-process launcher) and the test-run executor, since both
 * need to invoke Node/Playwright tooling that lives at the repo root.
 */
public final class ProjectPaths {

    private ProjectPaths() {}

    /**
     * Finds the root directory containing the `recorder/` folder (a stable
     * marker for the Node/Playwright project root), searching the current
     * working directory and its immediate parent.
     */
    public static File resolveProjectRoot() {
        File current = new File(".").getAbsoluteFile();
        if (new File(current, "recorder/dist/cli.js").exists() || new File(current, "recorder/cli.ts").exists()) {
            return current;
        }
        if (new File(current, "../recorder/dist/cli.js").exists() || new File(current, "../recorder/cli.ts").exists()) {
            return new File(current, "..");
        }
        return current;
    }
}
