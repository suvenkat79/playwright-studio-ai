import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
import * as esbuild from 'esbuild';

// Phase 1: PlaywrightRecordingEngine.startResolutionSession() -- a short-
// lived, NON-recording browser for GenAI's live-DOM resolution. Tests run
// against an esbuild-bundled copy of engine.ts (not raw tsx execution) for
// the same reason resolveIntent.test.ts does: tsx's on-the-fly TS
// transform omits the __name helper esbuild injects for class methods
// passed into page.evaluate() (extractBrowserFacts), which throws under
// raw tsx but never happens in production -- the recorder always ships as
// the esbuild-bundled recorder/dist/cli.js.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const bundlePath = path.join(__dirname, 'dist', 'test-engine-bundle-resolution.mjs');
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

const TEST_HTML = `<!DOCTYPE html><html><body>
  <label for="priority-select">Priority</label>
  <select id="priority-select">
    <option value="1">1 - Critical</option>
    <option value="2">2 - High</option>
  </select>
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

test('startResolutionSession creates a real, usable session on the target page', async () => {
  const server = await startTestServer();
  let sessionId: string | undefined;
  try {
    sessionId = await recordingEngine.startResolutionSession(server.url, true);
    assert.ok(sessionId, 'expected a session id to be returned');

    const page = recordingEngine.getPage(sessionId);
    assert.ok(page, 'expected getPage() to return the resolution session\'s Page');
    assert.equal(page!.url(), server.url);

    // Requirement 6/8: reuses the existing injected locator engine and
    // resolveIntent() unchanged -- this is the same resolveIntent() the
    // live-session AI Gen resolver uses, now working against a session
    // that was never "recording".
    const result = await recordingEngine.resolveIntent(sessionId, 'click Save');
    assert.equal(result.unresolved.length, 0);
    assert.equal(result.actions.length, 1);
    assert.match(result.actions[0].codeLine, /getByRole\('button', \{ name: 'Save' \}\)\.click\(\)/);
  } finally {
    if (sessionId) await recordingEngine.closeResolutionSession(sessionId);
    await server.close();
  }
});

test('startResolutionSession runs the existing Application/Page/Frame detection once', async () => {
  const server = await startTestServer();
  let sessionId: string | undefined;
  try {
    sessionId = await recordingEngine.startResolutionSession(server.url, true);

    const applicationMetadata = recordingEngine.getApplicationMetadata(sessionId);
    const pageMetadata = recordingEngine.getPageMetadata(sessionId);
    const frameMetadata = recordingEngine.getFrameMetadata(sessionId);

    assert.ok(applicationMetadata, 'expected ApplicationDetector to have run');
    assert.ok(pageMetadata, 'expected PageDetector to have run');
    assert.ok(frameMetadata, 'expected FrameDetector to have run');
    assert.equal(applicationMetadata!.application, 'Generic Web');
    assert.equal(frameMetadata!.frameType, 'MainFrame');
  } finally {
    if (sessionId) await recordingEngine.closeResolutionSession(sessionId);
    await server.close();
  }
});

test('startResolutionSession installs no recorder interaction-capture binding', async () => {
  const server = await startTestServer();
  let sessionId: string | undefined;
  try {
    sessionId = await recordingEngine.startResolutionSession(server.url, true);
    const page = recordingEngine.getPage(sessionId)!;

    // __playwrightStudioEmitEvent only ever exists because startSession()
    // calls context.exposeBinding(...) for it -- startResolutionSession()
    // never does, so the injected script's own click/fill listeners have
    // nothing to call into.
    const bindingType = await page.evaluate(() => typeof (window as any).__playwrightStudioEmitEvent);
    assert.equal(bindingType, 'undefined');

    // A real click on the page must produce no captured event -- there is
    // no recording apparatus listening at all.
    await page.getByRole('button', { name: 'Save' }).click();
    const events = recordingEngine.getEvents(sessionId);
    assert.deepEqual(events, []);
  } finally {
    if (sessionId) await recordingEngine.closeResolutionSession(sessionId);
    await server.close();
  }
});

test('startResolutionSession never invokes Smart Recorder interaction recording', async () => {
  const server = await startTestServer();
  let sessionId: string | undefined;
  try {
    sessionId = await recordingEngine.startResolutionSession(server.url, true);

    // Drive an action through resolveIntent() -- the one thing this session
    // exists for -- and confirm it leaves no trace in the Smart Recorder's
    // own (separate, additive) event/intent streams, which only ever get
    // written to from inside the exposeBinding handler startSession()
    // installs and this method deliberately does not.
    await recordingEngine.resolveIntent(sessionId, 'click Save');

    assert.deepEqual(recordingEngine.getRecordedEvents(sessionId), []);
    assert.deepEqual(recordingEngine.getIntentTimeline(sessionId), []);
  } finally {
    if (sessionId) await recordingEngine.closeResolutionSession(sessionId);
    await server.close();
  }
});

test('startResolutionSession refuses to launch while a recording session is active', async () => {
  const server = await startTestServer();
  let recordingSessionId: string | undefined;
  try {
    recordingSessionId = await recordingEngine.startSession(server.url, true);

    await assert.rejects(
      () => recordingEngine.startResolutionSession(server.url, true),
      /Cannot start a resolution session while recording session .* is active/
    );
  } finally {
    if (recordingSessionId) await recordingEngine.stopSession(recordingSessionId).catch(() => {});
    await server.close();
  }
});

test('startResolutionSession does not block on a previous, already-closed resolution session', async () => {
  const server = await startTestServer();
  let firstSessionId: string | undefined;
  let secondSessionId: string | undefined;
  try {
    firstSessionId = await recordingEngine.startResolutionSession(server.url, true);
    await recordingEngine.closeResolutionSession(firstSessionId);

    // A closed resolution session must not be mistaken for "a recording is
    // active" -- this should succeed, not throw.
    secondSessionId = await recordingEngine.startResolutionSession(server.url, true);
    assert.ok(secondSessionId);
  } finally {
    if (secondSessionId) await recordingEngine.closeResolutionSession(secondSessionId);
    await server.close();
  }
});

test('closeResolutionSession cleans up the browser and removes the session', async () => {
  const server = await startTestServer();
  try {
    const sessionId = await recordingEngine.startResolutionSession(server.url, true);
    assert.ok(recordingEngine.getPage(sessionId), 'session should exist before close');

    await recordingEngine.closeResolutionSession(sessionId);

    assert.equal(recordingEngine.getPage(sessionId), undefined, 'session should be gone after close');
    await assert.rejects(
      () => recordingEngine.resolveIntent(sessionId, 'click Save'),
      /No active recording session/
    );
  } finally {
    await server.close();
  }
});

test('closeResolutionSession is a no-op for a real recording session (use stopSession instead)', async () => {
  const server = await startTestServer();
  let recordingSessionId: string | undefined;
  try {
    recordingSessionId = await recordingEngine.startSession(server.url, true);

    await recordingEngine.closeResolutionSession(recordingSessionId);

    // Still alive -- closeResolutionSession must not have touched it.
    assert.ok(recordingEngine.getPage(recordingSessionId), 'recording session should be unaffected');
  } finally {
    if (recordingSessionId) await recordingEngine.stopSession(recordingSessionId).catch(() => {});
    await server.close();
  }
});
