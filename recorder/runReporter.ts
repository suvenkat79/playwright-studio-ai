import { basename } from 'path';
import type {
  Reporter,
  FullConfig,
  Suite,
  TestCase,
  TestResult,
  TestStep
} from 'playwright/types/testReporter';

/**
 * Custom Playwright Reporter for Playwright Studio AI's real test-execution
 * engine (Sprint 3).
 *
 * Loaded directly from a generated playwright.config.ts (`reporter: [[<abs
 * path to this file>]]`) for every real `npx playwright test` run the
 * backend spawns. Emits one Newline-Delimited JSON (NDJSON) record per line
 * to stdout, mirroring the protocol already used by recorder/cli.ts so the
 * Java backend can parse both with the same "one JSON object per line"
 * convention:
 *
 * - {"type":"RUN_STARTED","totalTests":N}
 * - {"type":"TEST_STARTED","testId":"...","title":"..."}
 * - {"type":"STEP_STARTED","stepId":N,"title":"...","category":"...","locator":"...","sourceFile":"...","sourceLine":N}
 * - {"type":"STEP_FINISHED","stepId":N,"title":"...","category":"...","status":"passed"|"failed","durationMs":N,"error":"...","locator":"...","sourceFile":"...","sourceLine":N}
 * - {"type":"TEST_FINISHED","testId":"...","status":"...","durationMs":N,"error":"...","attachments":[{"name":"trace"|"screenshot"|"video","path":"..."}]}
 * - {"type":"RUN_FINISHED","status":"passed"|"failed"|"timedout"|"interrupted","durationMs":N}
 *
 * Only step categories that correspond to meaningful, user-facing actions
 * are forwarded (test.step/pw:api/expect) — internal hook/fixture wrapper
 * steps are skipped to keep the stream focused, matching the level of
 * detail the Sandbox Runner UI already presents.
 */

const FORWARDED_STEP_CATEGORIES = new Set(['test.step', 'pw:api', 'expect']);

// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /[\u001B\u009B][[\]()#;?]*(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-ntqry=><~]/g;

/** Playwright formats error messages with terminal color codes — strip them so log lines render as plain text in the UI's Console tab. */
function stripAnsi(value: string | undefined): string | undefined {
  return value === undefined ? undefined : value.replace(ANSI_PATTERN, '');
}

function emitNDJSON(type: string, payload: Record<string, unknown>) {
  process.stdout.write(JSON.stringify({ type, ...payload }) + '\n');
}

/**
 * The real "locator used" / "source file and line" fields the failure panel
 * needs, taken straight from Playwright's own TestStep — never fabricated.
 * `step.subtitle` is Playwright's own user-friendly rendering of the step's
 * target (the locator string for pw:api calls, or the navigation URL for
 * page.goto) — see the TestStep.subtitle docs in playwright/types/testReporter.d.ts.
 */
function stepLocationFields(step: TestStep) {
  return {
    locator: step.subtitle,
    sourceFile: step.location ? basename(step.location.file) : undefined,
    sourceLine: step.location?.line
  };
}

class RunReporter implements Reporter {
  private stepIdByStep = new WeakMap<TestStep, number>();
  private stepCounter = 0;
  private runStartTime = 0;

  printsToStdio(): boolean {
    // Machine-readable NDJSON reporter — never suppress/interleave with
    // terminal progress indicators.
    return false;
  }

  onBegin(_config: FullConfig, suite: Suite) {
    this.runStartTime = Date.now();
    emitNDJSON('RUN_STARTED', { totalTests: suite.allTests().length });
  }

  onTestBegin(test: TestCase) {
    emitNDJSON('TEST_STARTED', { testId: test.id, title: test.title });
  }

  onStepBegin(_test: TestCase, _result: TestResult, step: TestStep) {
    if (!FORWARDED_STEP_CATEGORIES.has(step.category)) return;

    const stepId = ++this.stepCounter;
    this.stepIdByStep.set(step, stepId);

    emitNDJSON('STEP_STARTED', {
      stepId,
      title: step.title,
      category: step.category,
      ...stepLocationFields(step)
    });
  }

  onStepEnd(_test: TestCase, _result: TestResult, step: TestStep) {
    const stepId = this.stepIdByStep.get(step);
    if (stepId === undefined) return;

    emitNDJSON('STEP_FINISHED', {
      stepId,
      title: step.title,
      category: step.category,
      status: step.error ? 'failed' : 'passed',
      durationMs: Math.round(step.duration),
      error: stripAnsi(step.error?.message),
      ...stepLocationFields(step)
    });
  }

  onTestEnd(test: TestCase, result: TestResult) {
    const attachments = result.attachments
      .filter((a) => Boolean(a.path))
      .map((a) => ({ name: a.name, path: a.path }));

    emitNDJSON('TEST_FINISHED', {
      testId: test.id,
      title: test.title,
      status: result.status,
      durationMs: result.duration,
      error: stripAnsi(result.error?.message),
      attachments
    });
  }

  onEnd(result: { status: string }) {
    emitNDJSON('RUN_FINISHED', {
      status: result.status,
      durationMs: Date.now() - this.runStartTime
    });
  }
}

export default RunReporter;
