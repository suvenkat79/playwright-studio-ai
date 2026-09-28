package com.playwrightstudio.run.dto;

import java.util.List;

public class RunReportPathsDto {
    private String htmlReportIndex;
    private String junitXmlPath;
    private List<String> tracePaths;
    private List<String> screenshotPaths;
    private List<String> videoPaths;

    // Browser-openable URLs (served via RunController's artifact endpoint) —
    // the raw filesystem paths above aren't directly navigable from the UI.
    private String htmlReportUrl;
    private List<String> traceUrls;

    public RunReportPathsDto() {}

    public RunReportPathsDto(String htmlReportIndex, String junitXmlPath, List<String> tracePaths,
                              List<String> screenshotPaths, List<String> videoPaths,
                              String htmlReportUrl, List<String> traceUrls) {
        this.htmlReportIndex = htmlReportIndex;
        this.junitXmlPath = junitXmlPath;
        this.tracePaths = tracePaths;
        this.screenshotPaths = screenshotPaths;
        this.videoPaths = videoPaths;
        this.htmlReportUrl = htmlReportUrl;
        this.traceUrls = traceUrls;
    }

    public String getHtmlReportIndex() { return htmlReportIndex; }
    public void setHtmlReportIndex(String htmlReportIndex) { this.htmlReportIndex = htmlReportIndex; }

    public String getJunitXmlPath() { return junitXmlPath; }
    public void setJunitXmlPath(String junitXmlPath) { this.junitXmlPath = junitXmlPath; }

    public List<String> getTracePaths() { return tracePaths; }
    public void setTracePaths(List<String> tracePaths) { this.tracePaths = tracePaths; }

    public List<String> getScreenshotPaths() { return screenshotPaths; }
    public void setScreenshotPaths(List<String> screenshotPaths) { this.screenshotPaths = screenshotPaths; }

    public List<String> getVideoPaths() { return videoPaths; }
    public void setVideoPaths(List<String> videoPaths) { this.videoPaths = videoPaths; }

    public String getHtmlReportUrl() { return htmlReportUrl; }
    public void setHtmlReportUrl(String htmlReportUrl) { this.htmlReportUrl = htmlReportUrl; }

    public List<String> getTraceUrls() { return traceUrls; }
    public void setTraceUrls(List<String> traceUrls) { this.traceUrls = traceUrls; }
}
