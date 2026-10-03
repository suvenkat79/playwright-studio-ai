package com.playwrightstudio.record.dto;

import java.util.List;

/**
 * Response for one AI Gen resolve-intent call. `actions` uses the exact
 * same RecordedActionDto shape as GET /api/record/events, so the frontend
 * can feed it straight into the existing optimizer/spec-generator pipeline.
 * `unresolved` carries the raw text of every clause that could not be
 * parsed or could not be matched to a real element, so the caller can show
 * honestly what AI Gen did not understand rather than silently dropping it.
 */
public class ResolveIntentResponse {
    private String sessionId;
    private List<RecordedActionDto> actions;
    private List<String> unresolved;

    public ResolveIntentResponse() {}

    public ResolveIntentResponse(String sessionId, List<RecordedActionDto> actions, List<String> unresolved) {
        this.sessionId = sessionId;
        this.actions = actions;
        this.unresolved = unresolved;
    }

    public String getSessionId() { return sessionId; }
    public void setSessionId(String sessionId) { this.sessionId = sessionId; }

    public List<RecordedActionDto> getActions() { return actions; }
    public void setActions(List<RecordedActionDto> actions) { this.actions = actions; }

    public List<String> getUnresolved() { return unresolved; }
    public void setUnresolved(List<String> unresolved) { this.unresolved = unresolved; }
}
