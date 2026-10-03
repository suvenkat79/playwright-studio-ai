import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * Deterministic structural/build/type-safety gate for a generated
 * FrameworkProject -- "Validate Framework" in the product flow. This is the
 * single source of the tsc --noEmit check: frameworkGenerator.test.ts calls
 * it directly (Node), and recorder/validateFramework.ts wraps it in a
 * stdin/stdout CLI so the Java backend can spawn it for the live UI. Never
 * duplicate the tsc invocation elsewhere.
 */

export type FrameworkValidationStatus = 'PASS' | 'FAIL';

export interface FrameworkValidationDiagnostic {
  file: string;
  line?: number;
  column?: number;
  code?: string;
  message: string;
}

export interface FrameworkValidationResult {
  status: FrameworkValidationStatus;
  diagnostics: FrameworkValidationDiagnostic[];
  checkedAt: number;
}

const TSC_DIAGNOSTIC_PATTERN = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.+)$/;

const PLAYWRIGHT_AMBIENT_STUBS = `
declare module 'dotenv/config';
declare module '@playwright/test' {
  export interface LocatorTextOptions {
    exact?: boolean;
  }
  export interface Locator {
    click(): Promise<void>;
    fill(value: string): Promise<void>;
    selectOption(value: string): Promise<void>;
    first(): Locator;
    evaluate<Argument, Result>(callback: (element: HTMLElement, argument: Argument) => Result, argument: Argument): Promise<Result>;
    toBeVisible(): Promise<void>;
  }
  export interface FrameLocator {
    locator(selector: string): Locator;
    getByLabel(label: string | RegExp, options?: LocatorTextOptions): Locator;
    getByPlaceholder(text: string | RegExp, options?: LocatorTextOptions): Locator;
    getByRole(role: string, options?: object): Locator;
    getByText(text: string | RegExp, options?: LocatorTextOptions): Locator;
  }
  export interface Page {
    locator(selector: string): Locator;
    getByLabel(label: string | RegExp, options?: LocatorTextOptions): Locator;
    getByPlaceholder(text: string | RegExp, options?: LocatorTextOptions): Locator;
    getByRole(role: string, options?: object): Locator;
    getByText(text: string | RegExp, options?: LocatorTextOptions): Locator;
    frameLocator(selector: string): FrameLocator;
    keyboard: { press(key: string): Promise<void> };
    goto(url: string): Promise<void>;
    waitForURL(url: string, options?: { waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' | 'commit' }): Promise<void>;
  }
  export interface BrowserContext {
    waitForEvent(event: 'page', options?: { timeout?: number }): Promise<Page>;
  }
  interface TestType {
    (name: string, callback: (fixtures: { page: Page; context: BrowserContext; workflowData: any }) => Promise<void>): void;
    extend<T extends { workflowData: unknown }>(fixtures: {
      workflowData: (args: {}, use: (value: T['workflowData']) => Promise<void>) => Promise<void>
    }): TestType;
  }
  export const test: TestType;
  export function expect(value: unknown): {
    toHaveURL(expected: RegExp): Promise<void>;
    toBeVisible(): Promise<void>;
  };
  export function defineConfig(config: any): any;
  export const devices: Record<string, any>;
}
`;

/**
 * tsc reports file paths relative to its own process cwd, which (via the
 * temp directory this check compiles in) comes out as a long, meaningless
 * "../../../var/folders/..." string. Diagnostics are known to belong to one
 * of the project's own generated files, so resolve back to that clean
 * relative path (e.g. "pages/Broken.ts") instead of surfacing the temp path.
 */
function normalizeDiagnosticFilePath(rawPath: string, knownFiles: readonly string[]): string {
  const normalized = rawPath.replace(/\\/g, '/');
  return knownFiles.find((known) => normalized.endsWith(known)) ?? normalized;
}

function parseTscOutput(output: string, knownFiles: readonly string[]): FrameworkValidationDiagnostic[] {
  const diagnostics: FrameworkValidationDiagnostic[] = [];
  for (const rawLine of output.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = TSC_DIAGNOSTIC_PATTERN.exec(line);
    if (match) {
      diagnostics.push({
        file: normalizeDiagnosticFilePath(match[1], knownFiles),
        line: Number(match[2]),
        column: Number(match[3]),
        code: match[4],
        message: match[5]
      });
    }
  }
  return diagnostics;
}

/**
 * Writes the generated framework's files to a temp directory, injects the
 * same ambient @playwright/test type stub the test suite uses (so the
 * check runs without a real `npm install`), and runs `tsc --noEmit`
 * against the project's own generated tsconfig.json.
 */
export async function validateFrameworkProject(
  files: Record<string, string>
): Promise<FrameworkValidationResult> {
  const root = await mkdtemp(path.join(tmpdir(), 'framework-validate-'));

  try {
    for (const [filePath, content] of Object.entries(files)) {
      const absolutePath = path.join(root, filePath);
      await mkdir(path.dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, content);
    }

    const tsconfigPath = path.join(root, 'tsconfig.json');
    const tsconfig = JSON.parse(await readFile(tsconfigPath, 'utf8')) as Record<string, unknown>;
    tsconfig.compilerOptions = {
      ...(tsconfig.compilerOptions as Record<string, unknown>),
      typeRoots: [path.resolve('node_modules/@types')]
    };
    await writeFile(tsconfigPath, JSON.stringify(tsconfig));
    await writeFile(path.join(root, 'playwright-stubs.d.ts'), PLAYWRIGHT_AMBIENT_STUBS);

    const tscPath = path.resolve('node_modules/.bin/tsc');
    try {
      execFileSync(tscPath, ['--noEmit', '--project', tsconfigPath], { cwd: root, stdio: 'pipe' });
      return { status: 'PASS', diagnostics: [], checkedAt: Date.now() };
    } catch (error) {
      const output = error && typeof error === 'object' && 'stdout' in error
        ? String((error as { stdout: Buffer }).stdout)
        : String(error);
      const diagnostics = parseTscOutput(output, Object.keys(files));
      return {
        status: 'FAIL',
        diagnostics: diagnostics.length > 0
          ? diagnostics
          : [{ file: '', message: output.trim() || 'Unknown type-check failure' }],
        checkedAt: Date.now()
      };
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
