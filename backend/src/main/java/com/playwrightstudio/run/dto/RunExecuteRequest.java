package com.playwrightstudio.run.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import java.util.Map;

@JsonIgnoreProperties(ignoreUnknown = true)
public class RunExecuteRequest {
    // Legacy shape (Sandbox preset-demo flow, still supported).
    private String specName;
    private String specContent;
    private String pomName;
    private String pomContent;
    private boolean headless;

    // Sprint 4 Credential Manager payload shape (primary path going forward):
    // a single self-contained optimized spec string. When present, the
    // backend prefers it over specContent — see RunService#executeRun.
    private String spec;
    private String baseUrl;
    private String username;
    private String password;
    private Boolean headed;

    private String browser;
    // Execution-time only: variableName -> value (e.g. APP_USERNAME, APP_PASSWORD).
    // Injected directly into the Playwright child process's environment and
    // never persisted, logged, or echoed back in any response — see
    // RunService#executeRun.
    private Map<String, String> credentials;

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

    public Map<String, String> getCredentials() { return credentials; }
    public void setCredentials(Map<String, String> credentials) { this.credentials = credentials; }

    public String getSpec() { return spec; }
    public void setSpec(String spec) { this.spec = spec; }

    public String getBaseUrl() { return baseUrl; }
    public void setBaseUrl(String baseUrl) { this.baseUrl = baseUrl; }

    public String getUsername() { return username; }
    public void setUsername(String username) { this.username = username; }

    public String getPassword() { return password; }
    public void setPassword(String password) { this.password = password; }

    public Boolean getHeaded() { return headed; }
    public void setHeaded(Boolean headed) { this.headed = headed; }
}
