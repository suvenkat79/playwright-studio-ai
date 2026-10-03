import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import * as esbuild from 'esbuild';
import { chromium } from 'playwright';

// Regression test for: AI Gen must not start a new resolution flow while
// Smart Recorder is active. Renders the real view and context in a browser,
// and verifies the active-session gate prevents resolver API requests.

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const harnessSource = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { RecordingProvider, useRecording } from '../context/RecordingContext';
import { AIGeneratorView } from './AIGeneratorView';

function TestControls() {
  const {
    setSessionId,
    prepareFrameworkForAIGeneration,
    runFrameworkValidation,
    saveFrameworkProject,
    loadFrameworkProject,
    frameworkProjectId,
    preparedFrameworkContext,
    frameworkValidationState
  } = useRecording();
  const frameworkProject = () => ({
      files: {
          'tests/recorded.spec.ts': "import { test } from '@playwright/test';" + String.fromCharCode(10) + "test('recorded journey', async ({ page }) => { await page.goto('https://example.com/'); });"
      },
      metadata: {
        generatedFileCount: 0,
        pageObjectCount: 0,
        workflowFunctionCount: 0,
        testCount: 1,
        testDataFileCount: 0,
        fixtureCount: 0,
        files: ['tests/recorded.spec.ts']
      },
      recordedActions: [],
      actions: [],
      workflows: []
    });
  const prepareFramework = () => prepareFrameworkForAIGeneration(
    frameworkProject(),
    [],
    [],
    'https://example.com/'
  );
  const saveAndLoadFramework = async () => {
    const projectId = await saveFrameworkProject(
      frameworkProject(),
      'persisted-framework',
      null,
      'https://example.com/'
    );
    await loadFrameworkProject(projectId);
  };
  return React.createElement(
    'div',
    null,
    React.createElement('button', { 'data-testid': 'activate-session-a', onClick: () => setSessionId('session-a') }, 'Session A'),
    React.createElement('button', { 'data-testid': 'activate-session-b', onClick: () => setSessionId('session-b') }, 'Session B'),
    React.createElement('button', { 'data-testid': 'activate-stopped-session', onClick: () => setSessionId('session-stopped') }, 'Stopped session'),
    React.createElement('button', { 'data-testid': 'prepare-framework', onClick: prepareFramework }, 'Prepare framework'),
    React.createElement('button', { 'data-testid': 'run-validation', onClick: () => { void runFrameworkValidation(); } }, 'Validate'),
    React.createElement('button', { 'data-testid': 'save-load-framework', onClick: () => { void saveAndLoadFramework(); } }, 'Save and load'),
    React.createElement('output', { 'data-testid': 'loaded-framework-state' }, JSON.stringify({
      projectId: frameworkProjectId,
      sessionId: preparedFrameworkContext?.sessionId ?? null,
      validation: frameworkValidationState?.status ?? null
    }))
  );
}

function Harness() {
  return React.createElement(
    RecordingProvider,
    null,
    React.createElement(TestControls, null),
    React.createElement(AIGeneratorView, { onAddGeneratedFile: () => {} })
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

test('blocks AI Gen requests while recording is active', async () => {
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

  const bundledScript = bundle.outputFiles[0].text;

  const server = await startBlankPageServer();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    let resolveIntentRequests = 0;
    // Both sessions report RUNNING; the API is intercepted so no backend
    // process is required.
    await page.route('**/api/record/status**', (route) => {
      const url = new URL(route.request().url());
      const sessionId = url.searchParams.get('sessionId') ?? '';
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ sessionId, status: 'RUNNING', totalEvents: 0, targetUrl: 'https://example.com/' })
      });
    });
    await page.route('**/api/record/events**', (route) => {
      const url = new URL(route.request().url());
      const sessionId = url.searchParams.get('sessionId') ?? '';
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ sessionId, events: [], isRecording: true, totalEvents: 0 })
      });
    });
    await page.route('**/api/record/resolve-intent**', (route) => {
      resolveIntentRequests++;
      route.fulfill({ status: 500, body: 'Active recording must block resolution' });
      });

    await page.goto(server.url);
    await page.addScriptTag({ content: bundledScript });

    // Activate session A. Recording is active, so new GenAI execution
    // remains unavailable and no resolver endpoint is called.
    await page.click('[data-testid="activate-session-a"]');
    await page.getByText('Recording is active').waitFor();
    const generateButton = page.getByRole('button', { name: 'Match Workflow & Generate' });
    assert.equal(await generateButton.isDisabled(), true);
    await page.fill('textarea', 'Click Save');
    await generateButton.click({ force: true });
    await page.waitForTimeout(100);
    assert.equal(resolveIntentRequests, 0);

    // A session switch must not bypass the active-recording guard.
    await page.click('[data-testid="activate-session-b"]');
    await page.getByText('Recording is active').waitFor();
    assert.equal(await generateButton.isDisabled(), true);
    assert.equal(resolveIntentRequests, 0);
  } finally {
    await browser.close();
    await server.close();
  }
});

test('blocks AI Test Generation until the stored framework passes Validate Framework, then enables it', async () => {
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
  const server = await startBlankPageServer();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.route('**/api/record/status**', (route) => {
      const url = new URL(route.request().url());
      const sessionId = url.searchParams.get('sessionId') ?? '';
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          sessionId,
          status: 'STOPPED',
          totalEvents: 0,
          targetUrl: 'https://example.com/'
        })
      });
    });
    await page.route('**/api/framework/validate', (route) => {
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ status: 'PASS', diagnostics: [], checkedAt: Date.now() })
      });
    });

    await page.goto(server.url);
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.click('[data-testid="activate-stopped-session"]');
    await page.click('[data-testid="prepare-framework"]');
    await page.fill('textarea', 'Update incident INC0010021');

    const generateButton = page.getByRole('button', { name: 'Match Workflow & Generate' });
    await generateButton.waitFor({ state: 'visible' });
    assert.equal(await page.getByText('generate a framework in the Recorder tab').count(), 0);

    // A generated-but-not-yet-validated framework must still block AI Test
    // Generation -- Validate Framework is a required gate, not advisory.
    await page.getByText('Framework not validated yet').waitFor();
    assert.equal(await generateButton.isDisabled(), true, await page.locator('body').innerText());

    // Once Validate Framework reports PASS, AI Test Generation becomes ready.
    await page.click('[data-testid="run-validation"]');
    await page.getByText('Framework not validated yet').waitFor({ state: 'detached' });
    assert.equal(await generateButton.isDisabled(), false, await page.locator('body').innerText());
  } finally {
    await browser.close();
    await server.close();
  }
});

test('loads a persisted framework without a recording session and enables AI generation after validation', async () => {
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
  const server = await startBlankPageServer();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    let validationRequests = 0;
    await page.route('**/api/framework/validate', (route) => {
      validationRequests++;
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ status: 'PASS', diagnostics: [], checkedAt: Date.now() })
      });
    });

    await page.goto(server.url);
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.click('[data-testid="save-load-framework"]');
    await page.waitForFunction(() => {
      const state = document.querySelector('[data-testid="loaded-framework-state"]')?.textContent;
      return Boolean(state && JSON.parse(state).validation === 'passed');
    });

    const loadedState = JSON.parse(await page.locator('[data-testid="loaded-framework-state"]').innerText());
    assert.ok(loadedState.projectId);
    assert.equal(loadedState.sessionId, '');
    assert.equal(loadedState.validation, 'passed');
    assert.equal(validationRequests, 1);
    await page.fill('textarea', 'Click Save');
    assert.equal(await page.getByRole('button', { name: 'Match Workflow & Generate' }).isDisabled(), false);
  } finally {
    await browser.close();
    await server.close();
  }
});

test('a failed Validate Framework keeps AI Test Generation blocked', async () => {
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
  const server = await startBlankPageServer();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.route('**/api/record/status**', (route) => {
      const url = new URL(route.request().url());
      const sessionId = url.searchParams.get('sessionId') ?? '';
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ sessionId, status: 'STOPPED', totalEvents: 0, targetUrl: 'https://example.com/' })
      });
    });
    await page.route('**/api/framework/validate', (route) => {
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'FAIL',
          diagnostics: [{ file: 'pages/Broken.ts', line: 1, message: "Type 'string' is not assignable to type 'number'." }],
          checkedAt: Date.now()
        })
      });
    });

    await page.goto(server.url);
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.click('[data-testid="activate-stopped-session"]');
    await page.click('[data-testid="prepare-framework"]');
    await page.fill('textarea', 'Update incident INC0010021');

    const generateButton = page.getByRole('button', { name: 'Match Workflow & Generate' });
    await generateButton.waitFor({ state: 'visible' });
    await page.click('[data-testid="run-validation"]');
    await page.getByText('Framework not validated yet').waitFor();
    assert.equal(await generateButton.isDisabled(), true, await page.locator('body').innerText());
  } finally {
    await browser.close();
    await server.close();
  }
});

test('regenerating a framework clears a previously passed Validate Framework result', async () => {
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
  const server = await startBlankPageServer();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.route('**/api/record/status**', (route) => {
      const url = new URL(route.request().url());
      const sessionId = url.searchParams.get('sessionId') ?? '';
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ sessionId, status: 'STOPPED', totalEvents: 0, targetUrl: 'https://example.com/' })
      });
    });
    await page.route('**/api/framework/validate', (route) => {
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ status: 'PASS', diagnostics: [], checkedAt: Date.now() })
      });
    });

    await page.goto(server.url);
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.click('[data-testid="activate-stopped-session"]');
    await page.click('[data-testid="prepare-framework"]');
    await page.fill('textarea', 'Update incident INC0010021');

    const generateButton = page.getByRole('button', { name: 'Match Workflow & Generate' });
    await generateButton.waitFor({ state: 'visible' });
    await page.click('[data-testid="run-validation"]');
    await page.getByText('Framework not validated yet').waitFor({ state: 'detached' });
    assert.equal(await generateButton.isDisabled(), false, 'expected generation to be ready after a PASS');

    // Regenerating the framework (same action Generate Framework performs)
    // must invalidate the previous PASS -- it validated a now-superseded
    // FrameworkProject, not this one.
    await page.click('[data-testid="prepare-framework"]');
    await page.getByText('Framework not validated yet').waitFor({ state: 'attached' });
    assert.equal(await generateButton.isDisabled(), true, 'expected regeneration to re-block generation until re-validated');
  } finally {
    await browser.close();
    await server.close();
  }
});
