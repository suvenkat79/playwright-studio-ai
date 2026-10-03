import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { RecordedEvent } from './types';
import { classifyIntent } from './intentClassifier';

// Root-cause regression: a real ServiceNow Classic incident form's save
// button is labeled "Save", not "Update". The classifier only recognized
// "Update" before this fix, so clicking Save was classified "Unknown" --
// meaning the whole recorded session never crossed a WORKFLOW_BOUNDARIES
// intent (frameworkGenerator.ts) and Framework Generator produced one
// unnamed "runCapturedActions" workflow instead of "updateIncident",
// leaving Workflow Matcher nothing to match against regardless of which
// field was actually changed. Confirmed live: the existing "real
// ServiceNow recording" regression test (workflowMatcher.test.ts) never
// caught this because its own fixture's button is literally labeled
// "Update", masking the gap.

function clickEvent(text: string): RecordedEvent {
  return {
    id: 'evt-1',
    timestamp: 0,
    application: { application: 'ServiceNow', confidence: 1, signals: [] },
    page: { pageType: 'Incident Form', module: 'Incident', entity: 'Incident', confidence: 1, signals: [] },
    frame: { frameType: 'MainFrame', frameSelector: '#gsft_main', framePath: ['#gsft_main'], confidence: 1, signals: [] },
    type: 'click',
    locator: { strategy: 'role', tag: 'button', role: 'button', text }
  };
}

test('classifies a "Save" button click as UpdateRecord, same as "Update"', () => {
  assert.equal(classifyIntent(clickEvent('Save')).intent, 'UpdateRecord');
  assert.equal(classifyIntent(clickEvent('Update')).intent, 'UpdateRecord');
});

test('is case-insensitive and tolerates surrounding text', () => {
  assert.equal(classifyIntent(clickEvent('SAVE')).intent, 'UpdateRecord');
  assert.equal(classifyIntent(clickEvent('Save changes')).intent, 'UpdateRecord');
});

test('does not false-positive on unrelated button text', () => {
  assert.equal(classifyIntent(clickEvent('Cancel')).intent, 'Unknown');
  assert.equal(classifyIntent(clickEvent('Delete')).intent, 'Unknown');
});
