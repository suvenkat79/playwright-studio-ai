import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
import * as esbuild from 'esbuild';
import { chromium } from 'playwright';

// Bundled via esbuild, not imported raw: tsx's on-the-fly transform omits
// the __name helper esbuild injects for named functions passed into
// page.evaluate() (collectIframesDeep, below) -- same reason
// resolveIntent.test.ts bundles engine.ts instead of importing it raw.
// Production never hits this because the recorder always ships as the
// esbuild-bundled recorder/dist/cli.js.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const bundlePath = path.join(__dirname, 'dist', 'test-browserFacts-bundle.mjs');
let extractBrowserFacts: typeof import('./browserFacts')['extractBrowserFacts'];

before(async () => {
  await mkdir(path.dirname(bundlePath), { recursive: true });
  await esbuild.build({
    entryPoints: [path.join(__dirname, 'browserFacts.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: bundlePath,
    packages: 'external'
  });
  ({ extractBrowserFacts } = await import(`${bundlePath}?t=${Date.now()}`));
});

after(async () => {
  await rm(bundlePath, { force: true });
});

// Root-cause regression: a real ServiceNow Now Experience instance renders
// its Classic-compat content frame inside a custom element's shadow root,
// with the "gsft_main" id on the light-DOM wrapper custom element, not on
// the actual <iframe> tag. Confirmed live: for a real recorded session,
// facts.hasGsftMainFrame (document.getElementById, light DOM) correctly
// found "gsft_main", while facts.iframeHierarchy (previously
// document.querySelectorAll('iframe'), light DOM only -- never pierces
// shadow roots) came back completely empty on the exact same page,
// starving FrameDetector/PageDetector's route-evidence collection of any
// iframe data at all. Playwright's own Frame API is unaffected by this
// (tracks frames at the browser/CDP level), which is why engine.ts's
// getFrameSelector() still correctly resolved "#gsft_main" even while
// facts.iframeHierarchy saw nothing.

const SHADOW_HOST_HTML = `<!DOCTYPE html><html><body>
  <script>
    class GsftShell extends HTMLElement {
      connectedCallback() {
        const root = this.attachShadow({ mode: 'open' });
        const iframe = document.createElement('iframe');
        iframe.id = 'gsft_main_inner';
        iframe.src = '/incident.do?sys_id=record-1&sysparm_record_target=incident';
        root.appendChild(iframe);
      }
    }
    customElements.define('gsft-shell', GsftShell);
  </script>
  <gsft-shell id="gsft_main"></gsft-shell>
</body></html>`;

async function startShadowDomServer(): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    res.writeHead(200, { 'Content-Type': 'text/html' });
    if (pathname === '/incident.do') {
      res.end('<!DOCTYPE html><html><body>incident content</body></html>');
    } else {
      res.end(SHADOW_HOST_HTML);
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Failed to bind shadow DOM test server');
  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  };
}

test('extractBrowserFacts finds an iframe nested inside a custom element\'s shadow root', async () => {
  const server = await startShadowDomServer();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(server.url, { waitUntil: 'load' });
    // Let the nested iframe's own navigation to /incident.do settle.
    await page.waitForTimeout(200);

    const facts = await extractBrowserFacts(page);

    assert.equal(facts.hasGsftMainFrame, true, 'the light-DOM wrapper custom element with id="gsft_main" must still be found');
    assert.ok(facts.iframeCount > 0, 'the shadow-nested iframe must be counted');
    assert.ok(
      facts.iframeHierarchy.some((node) => node.id === 'gsft_main_inner'),
      `iframeHierarchy must include the shadow-nested iframe, got: ${JSON.stringify(facts.iframeHierarchy)}`
    );
    assert.ok(
      facts.frameUrls.some((url) => url.includes('/incident.do?sys_id=record-1')),
      'frameUrls (Playwright Frame API, unaffected by this bug) should already have shown this evidence even before the fix'
    );
  } finally {
    await browser.close();
    await server.close();
  }
});
