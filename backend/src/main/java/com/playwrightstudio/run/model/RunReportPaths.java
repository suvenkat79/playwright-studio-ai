package com.playwrightstudio.run.model;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Filesystem paths to the artifacts a completed run produced: the Playwright
 * HTML report, the JUnit XML (for CI ingestion), and every trace/screenshot/
 * video attachment collected across the run's tests.
 */
public class RunReportPaths {

    private volatile String htmlReportDir;
    private volatile String htmlReportIndex;
    private volatile String junitXmlPath;
    private final List<String> tracePaths = Collections.synchronizedList(new ArrayList<>());
    private final List<String> screenshotPaths = Collections.synchronizedList(new ArrayList<>());
    private final List<String> videoPaths = Collections.synchronizedList(new ArrayList<>());

    public String getHtmlReportDir() {
        return htmlReportDir;
    }

    public void setHtmlReportDir(String htmlReportDir) {
        this.htmlReportDir = htmlReportDir;
    }

    public String getHtmlReportIndex() {
        return htmlReportIndex;
    }

    public void setHtmlReportIndex(String htmlReportIndex) {
        this.htmlReportIndex = htmlReportIndex;
    }

    public String getJunitXmlPath() {
        return junitXmlPath;
    }

    public void setJunitXmlPath(String junitXmlPath) {
        this.junitXmlPath = junitXmlPath;
    }

    public List<String> getTracePaths() {
        return tracePaths;
    }

    public List<String> getScreenshotPaths() {
        return screenshotPaths;
    }

    public List<String> getVideoPaths() {
        return videoPaths;
    }
}
