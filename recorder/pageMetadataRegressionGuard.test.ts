import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
import * as esbuild from 'esbuild';

// Root-cause regression test for a REAL ServiceNow Classic recording
// producing Page=Unknown in the Prepared AI Context panel despite
// Application/Frame detecting correctly (ServiceNow / #gsft_main).
//
// PageDetector/FrameDetector re-run on every 'framenavigated'/'load' event
// (engine.ts's handleFrameNavigated) so that routing changes entirely
// inside #gsft_main can refine page metadata without a top-level
// navigation. #gsft_main re-navigating mid-session without a full page
// reload is a real, documented ServiceNow Classic behavior (a field-change
// UI-policy recalculation reloading the content iframe) -- and that
// re-navigation can legitimately land BrowserFacts on an interim
// bridge/loading page carrying none of the route evidence the prior,
// correct detection relied on. Before the fix, detectPage()'s "Unknown"
// fallback (page-detector/engine.ts: "no provider's candidates scored
// above 0") unconditionally overwrote the already-correct "Incident Form"
// verdict the moment that transient snapshot was read -- and if no further
// navigation happened to self-correct it before the next interaction,
// everything from that point on, including whichever event turns out to
// be last, was permanently stamped Unknown.
//
// engine.ts is imported from an esbuild bundle, not raw tsx, matching this
// project's established convention (tsx's on-the-fly transform omits the
// __name helper esbuild injects for class methods passed into
// page.evaluate()).

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const bundlePath = path.join(__dirname, 'dist', 'test-engine-bundle-page-regression.mjs');
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

/**
 * Same ServiceNow Classic choreography as workflowMatcher.test.ts's
 * startServiceNowClassicServer (nav_to.do -> frame-shell.do -> incident.do,
 * with #gsft_main's src attribute staying on the shell page while its real
 * navigated URL carries sys_id -- confirmed live), plus one addition this
 * file specifically needs: /dead-end-shell.do, a second bridge page
 * #gsft_main is sent through later in the session that deliberately never
 * redirects further, so the test can deterministically observe the
 * transient "no route evidence" detection snapshot without racing a
 * follow-up navigation that would otherwise self-correct it and mask the
 * bug.
 */
async function startServiceNowClassicServerWithDeadEndReload(): Promise<{
  url: string;
  close: () => Promise<void>;
}> {
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    res.writeHead(200, { 'Content-Type': 'text/html' });
    if (pathname === '/nav_to.do') {
      res.end(`<!DOCTYPE html><html><head><meta name="application-name" content="ServiceNow"></head><body>
        <iframe id="gsft_main" src="/frame-shell.do"></iframe>
      </body></html>`);
    } else if (pathname === '/frame-shell.do') {
      res.end(`<!DOCTYPE html><html><body>
        <script>location.replace('/incident.do?sys_id=record-1&sysparm_record_target=incident')</script>
      </body></html>`);
    } else if (pathname === '/dead-end-shell.do') {
      // An interim bridge/loading page #gsft_main re-navigates through
      // mid-session (e.g. a field-change UI-policy recalculation) that
      // never completes any further -- carries no route evidence at all.
      res.end('<!DOCTYPE html><html><body>Loading…</body></html>');
    } else if (pathname === '/incident.do') {
      res.end(`<!DOCTYPE html><html><head><meta name="application-name" content="ServiceNow"></head><body role="application">
        <macroponent-record-form></macroponent-record-form>
        <label for="priority">Priority</label>
        <select id="priority"><option value="1">1 - Critical</option><option value="2">2 - High</option></select>
        <button>Update</button>
      </body></html>`);
    } else {
      res.end(`<!DOCTYPE html><html><head><meta name="application-name" content="ServiceNow"></head><body>
        <macroponent-shell></macroponent-shell><iframe id="gsft_main" src="about:blank"></iframe>
        <table role="grid"><tr><td><a href="/nav_to.do">Open incident</a></td></tr></table>
      </body></html>`);
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Failed to bind ServiceNow test server');
  const url = `http://127.0.0.1:${address.port}`;
  return {
    url,
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  };
}

test('a mid-session #gsft_main reload through a dead-end interim page never regresses an already-correct PageMetadata to Unknown', async () => {
  const server = await startServiceNowClassicServerWithDeadEndReload();
  let sessionId: string | undefined;
  try {
    sessionId = await recordingEngine.startSession(server.url, true);
    const page = recordingEngine.getPage(sessionId)!;

    await page.getByRole('link', { name: 'Open incident' }).click();
    await page.frameLocator('#gsft_main').getByLabel('Priority').selectOption('1');

    assert.equal(
      recordingEngine.getPageMetadata(sessionId)?.pageType,
      'Incident Form',
      'detection must have correctly reached Incident Form before the mid-session reload'
    );

    // Simulate the mid-session #gsft_main reload (e.g. a real UI-policy
    // field recalculation) through the dead-end bridge page -- this alone,
    // with no further redirect, is the exact transient state that used to
    // overwrite a correct verdict.
    await page.evaluate(() => {
      (document.getElementById('gsft_main') as HTMLIFrameElement).src = '/dead-end-shell.do';
    });
    // Give the dead-end page's own detection cycle time to actually run
    // and (pre-fix) clobber session.pageMetadata -- it never redirects
    // further, so there is no risk of a follow-up navigation masking the
    // bug by self-correcting it. The navigation is inside #gsft_main, not
    // the top-level page, so poll the real child frame's url() directly
    // rather than page.waitForURL() (which only tracks the main frame).
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if (page.frames().some((frame) => frame.url().includes('/dead-end-shell.do'))) break;
      await page.waitForTimeout(25);
    }
    await page.waitForTimeout(300);

    assert.equal(
      recordingEngine.getPageMetadata(sessionId)?.pageType,
      'Incident Form',
      'a transient no-route-evidence detection snapshot must not erase the previously-established, specific PageMetadata'
    );
    assert.ok(
      !recordingEngine.getPageMetadataHistory(sessionId).some((entry) => entry.pageType === 'Unknown'),
      'Unknown must never be appended to pageMetadataHistory once a specific page has already been detected'
    );
  } finally {
    if (sessionId) await recordingEngine.stopSession(sessionId).catch(() => {});
    await server.close();
  }
});
