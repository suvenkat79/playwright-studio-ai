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
    signal: 'click:text~update',
    matches: (e) => e.type === 'click' && /\bupdate\b/.test(textOf(e))
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
