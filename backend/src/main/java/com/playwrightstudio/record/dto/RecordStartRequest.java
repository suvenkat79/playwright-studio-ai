package com.playwrightstudio.record.dto;

public class RecordStartRequest {
    private String url;

    public RecordStartRequest() {}

    public RecordStartRequest(String url) {
        this.url = url;
    }

    public String getUrl() {
        return url;
    }

    public void setUrl(String url) {
        this.url = url;
    }
}
