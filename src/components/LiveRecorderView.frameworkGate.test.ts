import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import * as esbuild from 'esbuild';
import { chromium } from 'playwright';

// Regression coverage for the Record -> ... -> Generate Framework -> AI
// Framework Review -> Validate Framework -> AI Test Generation -> Execute
// UI architecture change:
//   - "Prepare for AI" is no longer a standalone manual toolbar button.
//   - Generate Framework still prepares both preparedAIContext and
//     preparedFrameworkContext internally (unchanged plumbing).
//   - The Recorder tab's own Execute stays independent of Validate
//     Framework -- it must keep working exactly as before.

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const harnessSource = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { RecordingProvider, useRecording } from '../context/RecordingContext';
import { LiveRecorderView } from './LiveRecorderView';

function DebugPanel() {
  const { preparedAIContext, preparedFrameworkContext } = useRecording();
  return React.createElement(
    'div',
    null,
    React.createElement('span', { 'data-testid': 'has-ai-context' }, String(preparedAIContext !== null)),
    React.createElement('span', { 'data-testid': 'has-framework-context' }, String(preparedFrameworkContext !== null))
  );
}

function Harness() {
  return React.createElement(
    RecordingProvider,
    null,
    React.createElement(DebugPanel, null),
    React.createElement(LiveRecorderView, { onInsertIntoPOM: () => {} })
  );
}

createRoot(document.getElementById('root')).render(React.createElement(Harness));
`;

async function startBlankPageServer(): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<!DOCTYPE html><html><body><div id="root"></div></body></html>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Failed to bind test server');
  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  };
}

async function buildHarness() {
  const bundle = await esbuild.build({
    stdin: {
      contents: harnessSource,
      loader: 'tsx',
      resolveDir: path.join(__dirname),
      sourcefile: 'harness.tsx'
    },
    bundle: true,
    platform: 'browser',
    format: 'iife',
    write: false,
    define: {
      'process.env.NODE_ENV': '"production"',
      'import.meta.env.VITE_API_URL': 'undefined'
    }
  });
  return bundle.outputFiles[0].text;
}

test('the standalone "Prepare for AI" toolbar button no longer exists', async () => {
  const script = await buildHarness();
  const server = await startBlankPageServer();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(server.url);
    await page.addScriptTag({ content: script });

    await page.locator('#generateFrameworkBtn').waitFor();
    assert.equal(await page.getByText('Prepare for AI').count(), 0);
    // Sanity check the harness actually rendered the real toolbar.
    assert.ok(await page.getByText('Generate Framework').count() > 0);
  } finally {
    await browser.close();
    await server.close();
  }
});

test('Generate Framework still prepares both preparedAIContext and preparedFrameworkContext internally', async () => {
  const script = await buildHarness();
  const server = await startBlankPageServer();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(server.url);
    await page.addScriptTag({ content: script });

    assert.equal(await page.locator('[data-testid="has-ai-context"]').innerText(), 'false');
    assert.equal(await page.locator('[data-testid="has-framework-context"]').innerText(), 'false');

    // LiveRecorderView ships with two built-in demo recorded actions even
    // without a live session, so Generate Framework can run immediately.
    await page.click('#generateFrameworkBtn');
    await page.getByText('Framework Generated ✓').first().waitFor();

    assert.equal(await page.locator('[data-testid="has-ai-context"]').innerText(), 'true');
    assert.equal(await page.locator('[data-testid="has-framework-context"]').innerText(), 'true');
  } finally {
    await browser.close();
    await server.close();
  }
});

test('Recorder-tab Execute stays independent of Validate Framework (never gated on it)', async () => {
  const script = await buildHarness();
  const server = await startBlankPageServer();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(server.url);
    await page.addScriptTag({ content: script });

    // Execute without ever touching Generate Framework or Validate
    // Framework -- the original recorded/optimized execution path must
    // keep working exactly as before this change.
    await page.click('#executeBtn');
    await page.getByText('Credential Manager').waitFor();
  } finally {
    await browser.close();
    await server.close();
  }
});
