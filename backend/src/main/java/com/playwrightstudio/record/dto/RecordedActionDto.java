package com.playwrightstudio.record.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.databind.JsonNode;

@JsonIgnoreProperties(ignoreUnknown = true)
public class RecordedActionDto {
    private String id;
    private String type;
    private String selector;
    private String value;
    private String timestamp;
    private String codeLine;
    private String url;
    private String frameSelector;
    private Boolean isSensitive;
    private String variableName;
    private String identitySelector;
    private int tabIndex;
    private JsonNode applicationMetadata;
    private JsonNode pageMetadata;
    private JsonNode frameMetadata;
    private JsonNode smartLocator;
    private JsonNode intent;
    private JsonNode navigation;

    public RecordedActionDto() {}

    public RecordedActionDto(String id, String type, String selector, String value, String timestamp, String codeLine, String url) {
        this.id = id;
        this.type = type;
        this.selector = selector;
        this.value = value;
        this.timestamp = timestamp;
        this.codeLine = codeLine;
        this.url = url;
    }

    public String getId() { return id; }
    public void setId(String id) { this.id = id; }

    public String getType() { return type; }
    public void setType(String type) { this.type = type; }

    public String getSelector() { return selector; }
    public void setSelector(String selector) { this.selector = selector; }

    public String getValue() { return value; }
    public void setValue(String value) { this.value = value; }

    public String getTimestamp() { return timestamp; }
    public void setTimestamp(String timestamp) { this.timestamp = timestamp; }

    public String getCodeLine() { return codeLine; }
    public void setCodeLine(String codeLine) { this.codeLine = codeLine; }

    public String getUrl() { return url; }
    public void setUrl(String url) { this.url = url; }

    public String getFrameSelector() { return frameSelector; }
    public void setFrameSelector(String frameSelector) { this.frameSelector = frameSelector; }

    public Boolean getIsSensitive() { return isSensitive; }
    public void setIsSensitive(Boolean isSensitive) { this.isSensitive = isSensitive; }

    public String getVariableName() { return variableName; }
    public void setVariableName(String variableName) { this.variableName = variableName; }

    public String getIdentitySelector() { return identitySelector; }
    public void setIdentitySelector(String identitySelector) { this.identitySelector = identitySelector; }

    public int getTabIndex() { return tabIndex; }
    public void setTabIndex(int tabIndex) { this.tabIndex = tabIndex; }

    public JsonNode getApplicationMetadata() { return applicationMetadata; }
    public void setApplicationMetadata(JsonNode applicationMetadata) { this.applicationMetadata = applicationMetadata; }

    public JsonNode getPageMetadata() { return pageMetadata; }
    public void setPageMetadata(JsonNode pageMetadata) { this.pageMetadata = pageMetadata; }

    public JsonNode getFrameMetadata() { return frameMetadata; }
    public void setFrameMetadata(JsonNode frameMetadata) { this.frameMetadata = frameMetadata; }

    public JsonNode getSmartLocator() { return smartLocator; }
    public void setSmartLocator(JsonNode smartLocator) { this.smartLocator = smartLocator; }

    public JsonNode getIntent() { return intent; }
    public void setIntent(JsonNode intent) { this.intent = intent; }

    public JsonNode getNavigation() { return navigation; }
    public void setNavigation(JsonNode navigation) { this.navigation = navigation; }
}
