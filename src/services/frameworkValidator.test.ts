import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateFrameworkProject } from './frameworkValidator';

const BASE_TSCONFIG = JSON.stringify({
  compilerOptions: {
    target: 'ES2022',
    module: 'ESNext',
    moduleResolution: 'Bundler',
    strict: true,
    esModuleInterop: true,
    skipLibCheck: true,
    types: ['node']
  }
});

test('validateFrameworkProject PASSes a well-typed generated project', async () => {
  const result = await validateFrameworkProject({
    'tsconfig.json': BASE_TSCONFIG,
    'pages/Home.ts': 'export const ok: number = 1;'
  });

  assert.equal(result.status, 'PASS');
  assert.deepEqual(result.diagnostics, []);
});

test('validateFrameworkProject accepts Playwright locator exact options on Page and FrameLocator', async () => {
  const result = await validateFrameworkProject({
    'tsconfig.json': BASE_TSCONFIG,
    'pages/LocatorOptions.ts': `
      import type { Page, FrameLocator } from '@playwright/test';

      export function usePageLocators(page: Page): void {
        page.getByLabel('User name', { exact: true });
        page.getByPlaceholder('Filter', { exact: true });
        page.getByText('All', { exact: true });
      }

      export function useFrameLocators(frame: FrameLocator): void {
        frame.getByLabel('State', { exact: true });
        frame.getByPlaceholder('Filter', { exact: true });
        frame.getByText('Save', { exact: true });
      }
    `
  });

  assert.equal(result.status, 'PASS', JSON.stringify(result.diagnostics, null, 2));
  assert.deepEqual(result.diagnostics, []);
});

test('validateFrameworkProject FAILs and reports a diagnostic for a real type error', async () => {
  const result = await validateFrameworkProject({
    'tsconfig.json': BASE_TSCONFIG,
    'pages/Broken.ts': 'export const broken: number = "not a number";'
  });

  assert.equal(result.status, 'FAIL');
  assert.ok(result.diagnostics.length > 0);
  assert.ok(result.diagnostics.some((d) => d.file.includes('Broken.ts') && d.message.includes('not assignable')));
});
