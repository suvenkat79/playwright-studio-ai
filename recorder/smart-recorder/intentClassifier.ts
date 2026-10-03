import type { Intent, IntentEntry, RecordedEvent } from './types';

function textOf(event: RecordedEvent): string {
  return (event.locator.text || event.locator.label || '').toLowerCase();
}

interface Rule {
  intent: Intent;
  signal: string;
  matches(event: RecordedEvent): boolean;
}

/**
 * Ordered, first-match-wins rules — deliberately simple pattern matching,
 * not weighted scoring like the Context Engine's detectors. Intent
 * classification here is a direct mapping from an already-captured fact
 * (event type + locator text/role) to a business label, per the sprint's
 * own example table; it is not inferring anything not already present in
 * the RecordedEvent.
 */
const RULES: Rule[] = [
  {
    intent: 'Login',
    signal: 'click:text~login',
    matches: (e) => e.type === 'click' && /\blog\s?in\b/.test(textOf(e))
  },
  {
    intent: 'Logout',
    signal: 'click:text~logout',
    matches: (e) => e.type === 'click' && /\blog\s?out\b/.test(textOf(e))
  },
  {
    intent: 'CreateRecord',
    signal: 'click:text=new',
    matches: (e) => e.type === 'click' && /^new$/.test(textOf(e).trim())
  },
  {
    intent: 'OpenRecord',
    signal: 'click:text~open record',
    // Matches the real captured ServiceNow pattern: "Open record: INC0010006"
    matches: (e) => e.type === 'click' && textOf(e).includes('open record')
  },
  {
    intent: 'UpdateRecord',
    // Root cause of Workflow Matcher NOT_MATCHED on a real recording
    // whose own save action is labeled "Save", not "Update": confirmed
    // live — a real ServiceNow Classic incident form's save button reads
    // "Save", and no rule here recognized it, so the whole session never
    // crossed a WORKFLOW_BOUNDARIES intent (frameworkGenerator.ts) and
    // collapsed into one unnamed "runCapturedActions" workflow instead of
    // "updateIncident" — Workflow Matcher had nothing to match against,
    // regardless of which field was actually changed. "Save" on an
    // already-open record is an update completion the same way "Update"
    // is; generic across any app, not ServiceNow- or field-specific.
    signal: 'click:text~update-or-save',
    matches: (e) => e.type === 'click' && /\b(?:update|save)\b/.test(textOf(e))
  },
  {
    intent: 'SubmitRecord',
    signal: 'click:text~submit',
    matches: (e) => e.type === 'click' && /\bsubmit\b/.test(textOf(e))
  },
  {
    intent: 'Search',
    signal: 'fill:placeholder~search-or-filter',
    matches: (e) => e.type === 'fill' && /search|filter/.test((e.locator.placeholder || '').toLowerCase())
  },
  {
    intent: 'Navigate',
    signal: 'event:type=navigation',
    matches: (e) => e.type === 'navigation'
  }
];

export function classifyIntent(event: RecordedEvent): IntentEntry {
  for (const rule of RULES) {
    if (rule.matches(event)) {
      return { eventId: event.id, intent: rule.intent, confidence: 1, signals: [rule.signal] };
    }
  }
  return { eventId: event.id, intent: 'Unknown', confidence: 0, signals: [] };
}
