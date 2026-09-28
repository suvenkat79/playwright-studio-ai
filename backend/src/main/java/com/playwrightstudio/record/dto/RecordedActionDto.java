package com.playwrightstudio.record.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

@JsonIgnoreProperties(ignoreUnknown = true)
public class RecordedActionDto {
    private String id;
    private String type;
    private String selector;
    private String value;
    private String timestamp;
    private String codeLine;
    private String url;

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
}
