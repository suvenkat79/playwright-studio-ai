package com.playwrightstudio.run.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

@JsonIgnoreProperties(ignoreUnknown = true)
public class RunExecuteRequest {
    private String specName;
    private String specContent;
    private String pomName;
    private String pomContent;
    private String browser;
    private boolean headless;

    public RunExecuteRequest() {}

    public String getSpecName() { return specName; }
    public void setSpecName(String specName) { this.specName = specName; }

    public String getSpecContent() { return specContent; }
    public void setSpecContent(String specContent) { this.specContent = specContent; }

    public String getPomName() { return pomName; }
    public void setPomName(String pomName) { this.pomName = pomName; }

    public String getPomContent() { return pomContent; }
    public void setPomContent(String pomContent) { this.pomContent = pomContent; }

    public String getBrowser() { return browser; }
    public void setBrowser(String browser) { this.browser = browser; }

    public boolean isHeadless() { return headless; }
    public void setHeadless(boolean headless) { this.headless = headless; }
}
