import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
import * as esbuild from 'esbuild';
import { chromium } from 'playwright';
import { browserInjectionScript } from './locatorGenerator';
import { parseNaturalLanguageIntent } from './intentParser';

// engine.ts is imported from an esbuild-bundled copy, not directly via tsx,
// because tsx's on-the-fly TS transform does not emit the `__name` helper
// esbuild's own bundler injects for class methods passed into
// page.evaluate() (extractBrowserFacts) -- under raw tsx execution that
// throws "__name is not defined" inside the real browser, purely a tsx
// quirk unrelated to this code. Production never hits this: the recorder
// always runs as the esbuild-bundled recorder/dist/cli.js (see
// package.json's build:recorder script). Bundling the same way here tests
// the code path that actually ships, not an artifact of the test runner.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const bundlePath = path.join(__dirname, 'dist', 'test-engine-bundle.mjs');
let recordingEngine: typeof import('./engine')['recordingEngine'];

before(async () => {
  await mkdir(path.dirname(bundlePath), { recursive: true });
  await esbuild.build({
    entryPoints: [path.join(__dirname, 'engine.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: bundlePath,
    packages: 'external'
  });
  ({ recordingEngine } = await import(`${bundlePath}?t=${Date.now()}`));
});

after(async () => {
  await rm(bundlePath, { force: true });
});

// Real HTML, real headless Chromium, real Context Engine — no mocks. Matches
// the pattern user-validated this session: resolve NL -> real DOM element ->
// existing computePlaywrightLocator() -> RecordedBrowserEvent, through the
// actual browser-injected script and the actual recording engine, not a
// stand-in for either.
const TEST_HTML = `<!DOCTYPE html><html><body>
  <label for="priority-select">Priority</label>
  <select id="priority-select">
    <option value="1">1 - Critical</option>
    <option value="2">2 - High</option>
  </select>
  <button>Update</button>
  <button>Save</button>
</body></html>`;

async function startTestServer(): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(TEST_HTML);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Failed to bind test server');
  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  };
}

// --- Point 1 & 2: natural-language target -> real DOM element -> the same
// Playwright locator computePlaywrightLocator() already produces for the
// Recorder's own click/fill listeners. Exercises the actual injected
// browser script, not a reimplementation of its logic. ---
test('resolveElementByText resolves a natural-language field name to the real element and its Playwright locator', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.route('https://ai-gen-test.local/', (route) =>
      route.fulfill({ contentType: 'text/html', body: TEST_HTML })
    );
    await page.goto('https://ai-gen-test.local/');
    await page.addScriptTag({ content: browserInjectionScript });

    const priorityResult = await page.evaluate(() =>
      (window as any).__playwrightStudioResolveElement('Priority')
    );
    assert.equal(priorityResult.tag, 'select');
    assert.match(priorityResult.selector, /getByLabel\('Priority'\)/);

    // Exact accessible-name match beats a substring collision.
    const updateResult = await page.evaluate(() =>
      (window as any).__playwrightStudioResolveElement('Update')
    );
    assert.equal(updateResult.matchedText, 'Update');
    assert.match(updateResult.selector, /getByRole\('button', \{ name: 'Update' \}\)/);

    // No element on the page matches -> null, never a fabricated locator.
    const noneResult = await page.evaluate(() =>
      (window as any).__playwrightStudioResolveElement('Nonexistent Field')
    );
    assert.equal(noneResult, null);
  } finally {
    await browser.close();
  }
});

// --- Point 3: an AI-Gen-resolved action carries the same Application/Page/
// Frame context a live-recorded action would, and produces the exact
// RecordedBrowserEvent shape the optimizer/spec-generator pipeline expects. ---
test('resolveIntent resolves a real session\'s live page and stamps actions with Application/Page/Frame metadata', async () => {
  const server = await startTestServer();
  let sessionId: string | undefined;
  try {
    sessionId = await recordingEngine.startSession(server.url, true);

    const result = await recordingEngine.resolveIntent(
      sessionId,
      'change Priority to 2 and click Update'
    );

    assert.deepEqual(result.unresolved, []);
    assert.equal(result.actions.length, 2);

    const [setAction, clickAction] = result.actions;
    assert.equal(setAction.type, 'select');
    assert.equal(setAction.codeLine, "await page.getByLabel('Priority').selectOption('2');");
    assert.equal(clickAction.type, 'click');
    assert.equal(clickAction.codeLine, "await page.getByRole('button', { name: 'Update' }).click();");

    for (const action of result.actions) {
      assert.ok(action.applicationMetadata, 'expected applicationMetadata on a resolved action');
      assert.ok(action.pageMetadata, 'expected pageMetadata on a resolved action');
      assert.ok(action.frameMetadata, 'expected frameMetadata on a resolved action');
    }

    // A target that matches nothing on the live page is reported, not guessed at.
    const noMatch = await recordingEngine.resolveIntent(sessionId, 'click Nonexistent Button');
    assert.equal(noMatch.actions.length, 0);
    assert.deepEqual(noMatch.unresolved, ['click Nonexistent Button']);

    // A clause the deterministic parser cannot read is reported verbatim too.
    const unparsed = await recordingEngine.resolveIntent(sessionId, 'frobnicate the widget');
    assert.deepEqual(unparsed.unresolved, ['frobnicate the widget']);
  } finally {
    if (sessionId) await recordingEngine.stopSession(sessionId).catch(() => {});
    await server.close();
  }
});

// --- Point 5: no live session -> a clear, honest failure, never a
// fabricated result. ---
test('resolveIntent refuses to resolve against a session that is not active', async () => {
  await assert.rejects(
    () => recordingEngine.resolveIntent('does-not-exist', 'click Save'),
    /No active recording session/
  );
});

// --- The deterministic intent parser feeding all of the above: a compound
// instruction splits into the right clauses, and phrasing it cannot read is
// reported rather than misread. ---
test('parseNaturalLanguageIntent splits a compound instruction into set/click intents', () => {
  const { intents, unparsed } = parseNaturalLanguageIntent(
    'Open incident INC0012345, change Priority to 2, then click Update'
  );
  assert.deepEqual(unparsed, []);
  assert.equal(intents.length, 3);
  assert.deepEqual(intents[0], { kind: 'click', target: 'incident INC0012345', raw: 'Open incident INC0012345' });
  assert.deepEqual(intents[1], { kind: 'set', target: 'Priority', value: '2', raw: 'change Priority to 2' });
  assert.deepEqual(intents[2], { kind: 'click', target: 'Update', raw: 'click Update' });
});

test('parseNaturalLanguageIntent reports an unrecognized clause instead of guessing', () => {
  const { intents, unparsed } = parseNaturalLanguageIntent('frobnicate the widget');
  assert.deepEqual(intents, []);
  assert.deepEqual(unparsed, ['frobnicate the widget']);
});
