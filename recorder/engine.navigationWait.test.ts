import assert from 'node:assert/strict';
import { test } from 'node:test';
import { navigationWaitCode } from './engine';

/**
 * Root-cause regression: a real Execute run against a real ServiceNow
 * instance timed out at "Wait for navigation" immediately after login --
 * the run's own log showed "navigated to [the Now Experience shell URL]"
 * (the URL predicate matched) followed by a full 30000ms TimeoutError.
 * Playwright's waitForURL defaults to waitUntil: 'load', and the shell
 * page never reaches that state (persistent background connections, not
 * unique to ServiceNow). Every recorded top-level navigation goes through
 * this one function, so the fix belongs here, not in a ServiceNow-specific
 * branch.
 */

test('generated navigation waits specify domcontentloaded, not the default load state', () => {
  assert.ok(
    navigationWaitCode('https://dev442568.service-now.com/incident_list.do').includes("waitUntil: 'domcontentloaded'")
  );
  assert.ok(
    navigationWaitCode('https://example.test/').includes("waitUntil: 'domcontentloaded'")
  );
  assert.ok(
    navigationWaitCode('not a valid url').includes("waitUntil: 'domcontentloaded'")
  );
});

test('still waits for the expected final path segment, unaffected by the waitUntil fix', () => {
  const code = navigationWaitCode('https://dev442568.service-now.com/now/nav/ui/classic/params/target/ui_page.do?sys_id=437934ae');
  assert.ok(code.includes('ui_page'));
  assert.ok(code.startsWith('await page.waitForURL('));
});
