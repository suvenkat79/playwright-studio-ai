import type { RecordedAction } from '../types';
import type { OptimizedAction } from './optimizer/types';
import {
  computeFrameworkMetadata,
  type FrameworkFileSet,
  type FrameworkProject,
  type FrameworkWorkflowMetadata
} from './frameworkGenerator';

/**
 * Add to Suite's structural-merge model: FrameworkProject is the single
 * source of truth (per the product requirement), but generateFrameworkProject
 * itself only ever emits ONE test file per call. AccumulatedFramework is the
 * thin wrapper that lets MULTIPLE tests (the original recording's, plus one
 * per "Add to Suite" call) coexist on top of ONE shared, continuously
 * regenerated set of Page Objects / workflow functions / test-data --
 * never a second framework. See mergeIntoFramework for why replacing
 * sharedFiles wholesale on every merge is still correct incremental reuse.
 */
export interface AccumulatedTestFile {
  readonly fileName: string;
  readonly title: string;
  readonly content: string;
  /** null for the original recorded test (frozen the moment the framework
   * was first generated); the natural-language instruction that produced
   * every AI-added test afterwards. */
  readonly instruction: string | null;
  readonly addedAt: number;
}

export interface AccumulatedFramework {
  readonly sharedFiles: FrameworkFileSet;
  readonly tests: AccumulatedTestFile[];
  readonly recordedActions: RecordedAction[];
  readonly actions: OptimizedAction[];
  readonly workflows: FrameworkWorkflowMetadata[];
  readonly targetUrl: string;
}

const TEST_FILE_PATTERN = /^tests\/.+\.spec\.ts$/;
const ORIGINAL_TEST_TITLE = 'complete the recorded user journey';

function splitOutTestFile(files: FrameworkFileSet): { shared: FrameworkFileSet; testPath: string; testContent: string } {
  const shared: FrameworkFileSet = {};
  let testPath = '';
  let testContent = '';
  for (const [path, content] of Object.entries(files)) {
    if (TEST_FILE_PATTERN.test(path)) {
      testPath = path;
      testContent = content;
    } else {
      shared[path] = content;
    }
  }
  if (!testPath) {
    throw new Error('Generated framework project did not contain a test file to accumulate.');
  }
  return { shared, testPath, testContent };
}

function testTitle(content: string, fallback: string): string {
  const match = /test\(\s*(['"])((?:\\.|(?!\1)[^\\])*)\1/.exec(content);
  return match?.[2]?.replace(/\\(['"\\])/g, '$1') ?? fallback;
}

function slugify(value: string, maxLength = 60): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '');
  return slug || 'ai-generated-test';
}

function uniqueTestFileName(instruction: string, existing: ReadonlySet<string>): string {
  const baseSlug = slugify(instruction);
  let candidate = `tests/${baseSlug}.spec.ts`;
  let ordinal = 2;
  while (existing.has(candidate)) {
    candidate = `tests/${baseSlug}-${ordinal}.spec.ts`;
    ordinal += 1;
  }
  return candidate;
}

/** Swaps the generated test's title for a business-intent one without
 * touching generateFrameworkProject's own rendering (its test title is
 * otherwise always the fixed 'complete the recorded user journey'). */
function withTitle(testContent: string, title: string): string {
  return testContent.replace(
    /test\(\s*(['"])(?:\\.|(?!\1)[^\\])*\1/,
    () => `test(${JSON.stringify(title)}`
  );
}

/** Called once, right after the Recorder's own "Generate Framework" produces
 * the first FrameworkProject -- establishes the original recorded test as
 * entry [0], frozen from this point on (requirement: never overwrite the
 * original recorded test when adding an AI-generated one). */
export function createAccumulatedFramework(initial: FrameworkProject, targetUrl: string): AccumulatedFramework {
  const shared: FrameworkFileSet = {};
  const testEntries: Array<[string, string]> = [];
  for (const [filePath, content] of Object.entries(initial.files)) {
    if (TEST_FILE_PATTERN.test(filePath)) testEntries.push([filePath, content]);
    else shared[filePath] = content;
  }
  if (testEntries.length === 0) {
    throw new Error('Generated framework project did not contain a test file to accumulate.');
  }

  return {
    sharedFiles: shared,
    tests: testEntries.map(([fileName, content], index) => ({
      fileName,
      title: index === 0 ? ORIGINAL_TEST_TITLE : testTitle(content, fileName),
      content,
      instruction: index === 0 ? null : testTitle(content, fileName),
      addedAt: Date.now()
    })),
    recordedActions: initial.recordedActions,
    actions: initial.actions,
    workflows: initial.workflows,
    targetUrl
  };
}

/**
 * Add to Suite: structurally merges a freshly matched/resolved
 * FrameworkProject into the accumulated one.
 *
 * generatedProject here is resolveWorkflowRequest's output, matched against
 * the CALLER'S current accumulated project (see RecordingContext's
 * addGeneratedProjectToSuite / AIGeneratorView) -- so it already reflects
 * the full union of actions: the original recording plus every capability
 * added by every prior Add to Suite call, plus whatever this request just
 * added. Because generateFrameworkProject deterministically derives every
 * Page Object method, workflow function name, and test-data key from
 * stable identifiers (application+pageType for Page Objects; intent+
 * entity+ordinal for workflow names; field label text for data keys -- see
 * frameworkGenerator.ts), regenerating the ENTIRE shared file set from that
 * union on every merge is equivalent to true incremental reuse: an action
 * that already existed reproduces the exact same method/function/key every
 * time (never duplicated), and only a genuinely new action ever produces a
 * new one. Wholesale replacement avoids the much larger risk of a hand-
 * rolled line-level diff/merge silently drifting from what
 * generateFrameworkProject actually emits.
 *
 * The one thing that must NEVER be regenerated is an already-added test
 * file's own content -- each is frozen the moment it is added (including
 * the original, by createAccumulatedFramework). This stays safe as later
 * merges grow a reused workflow's *Parameters interface (e.g. adding
 * `state` alongside `urgency`) because every one of those fields is
 * optional (see frameworkGenerator.ts) -- an older frozen test's call site,
 * which only ever supplies the fields that existed when IT was generated,
 * keeps type-checking against the newer, larger interface.
 */
export function mergeIntoFramework(
  accumulated: AccumulatedFramework,
  generatedProject: FrameworkProject,
  instruction: string
): AccumulatedFramework {
  const { shared, testContent } = splitOutTestFile(generatedProject.files);
  const existingFileNames = new Set(accumulated.tests.map((test) => test.fileName));
  const fileName = uniqueTestFileName(instruction, existingFileNames);
  const title = instruction.trim() || 'AI-generated test';
  const newTest: AccumulatedTestFile = {
    fileName,
    title,
    content: withTitle(testContent, title),
    instruction,
    addedAt: Date.now()
  };

  return {
    sharedFiles: shared,
    tests: [...accumulated.tests, newTest],
    recordedActions: generatedProject.recordedActions,
    actions: generatedProject.actions,
    workflows: generatedProject.workflows,
    targetUrl: accumulated.targetUrl
  };
}

/** Flattens the accumulated state back into a normal FrameworkProject --
 * Download ZIP, View Structure, and Validate Framework all consume this,
 * so they always see the exact same accumulated files Add to Suite
 * produced (never a second, divergent project). */
export function toFrameworkProject(accumulated: AccumulatedFramework): FrameworkProject {
  const files: FrameworkFileSet = { ...accumulated.sharedFiles };
  for (const test of accumulated.tests) {
    files[test.fileName] = test.content;
  }
  return {
    files,
    metadata: computeFrameworkMetadata(files),
    recordedActions: accumulated.recordedActions,
    actions: accumulated.actions,
    workflows: accumulated.workflows
  };
}
