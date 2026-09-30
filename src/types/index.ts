export type NavigationTab = 'dashboard' | 'recorder' | 'ai-gen' | 'projects';

export type CategorySubTab =
  | 'overview'
  | 'pom'
  | 'tests'
  | 'assertions'
  | 'api'
  | 'ci';

export interface SuiteFile {
  id: string;
  name: string;
  category: 'pom' | 'test' | 'config' | 'doc';
  description: string;
  locCount: number;
  content: string;
  healingActive?: boolean;
}

export interface TestStep {
  id: number;
  title: string;
  action: string;
  target: string;
  durationMs: number;
  status: 'pending' | 'running' | 'passed' | 'failed' | 'healed';
  log: string;
  traceSnapshotUrl?: string;
}

export interface TestRun {
  id: string;
  runNumber: number;
  suiteName: string;
  branch: string;
  commitSha: string;
  timestamp: string;
  status: 'passed' | 'failed' | 'flaky';
  durationMs: number;
  browser: 'chromium' | 'firefox' | 'webkit';
  totalSteps: number;
  healedCount: number;
}

export interface RecordedAction {
  id: string;
  type: 'click' | 'fill' | 'select' | 'assert' | 'navigation' | 'press' | 'scroll';
  selector: string;
  value?: string;
  timestamp: string;
  codeLine: string;
  url?: string;
  frameSelector?: string;
  isSensitive?: boolean;
  variableName?: string;
  identitySelector?: string;
  tabIndex?: number;
}

export interface DiagnosticsSummary {
  syntaxErrors: number;
  typesStatus: 'Safe' | 'Warning' | 'Error';
  locatorsStrategy: 'Auto-Wait' | 'Strict' | 'Dynamic';
  locatorsValidated: number;
  validationScorePercent: number;
}

export interface StartRecordingRequest {
  url: string;
}

export interface StartRecordingResponse {
  status: 'RECORDING_STARTED' | string;
  sessionId: string;
  targetUrl?: string;
}

export interface StopRecordingRequest {
  sessionId: string;
}

export interface StopRecordingResponse {
  status: 'RECORDING_STOPPED' | string;
  sessionId: string;
  totalEvents: number;
  testScript?: string;
}

export interface RecordingEventsResponse {
  sessionId: string;
  events: RecordedAction[];
  isRecording: boolean;
  totalEvents: number;
}

export type SessionLifecycleStatus = 'RUNNING' | 'STOPPING' | 'STOPPED' | 'FAILED';

export interface SessionStatusResponse {
  sessionId: string;
  status: SessionLifecycleStatus;
  totalEvents: number;
  targetUrl: string;
  startedAt?: string;
  failureReason?: string | null;
}

export interface ToastNotification {
  id: string;
  type: 'success' | 'error' | 'info';
  message: string;
}

// --- Real Playwright Test Execution Engine (Sprint 3) ---

export type RunLifecycleStatus = 'RUNNING' | 'PASSED' | 'FAILED' | 'CANCELLED' | 'ERROR';

export interface RunExecuteRequest {
  // Legacy shape (Sandbox preset-demo flow, still supported): a named spec
  // file + optional POM, materialized to disk under run-workspace/.
  specName?: string;
  specContent?: string;
  pomName?: string;
  pomContent?: string;
  headless: boolean;

  // Sprint 4 Credential Manager payload shape (primary path going forward):
  // a single self-contained optimized spec string — no separate POM, since
  // PlaywrightGenerator's output already inlines everything. When `spec` is
  // present the backend prefers it over specContent.
  spec?: string;
  baseUrl?: string;
  username?: string;
  password?: string;
  headed?: boolean;

  browser: 'chromium' | 'firefox' | 'webkit';
  // Execution-time only: variableName -> value (e.g. APP_USERNAME, APP_PASSWORD).
  // Never persisted or logged — see RunService#executeRun on the backend.
  credentials?: Record<string, string>;
}

export interface RunExecuteResponse {
  runId: string;
  status: RunLifecycleStatus;
  runNumber: number;
}

export interface RunStepDto {
  id: number;
  title: string;
  category: string;
  status: 'pending' | 'running' | 'passed' | 'failed';
  durationMs: number;
  log: string;
  error?: string | null;
  locator?: string | null;
  sourceFile?: string | null;
  sourceLine?: number | null;
}

export interface RunReportPaths {
  htmlReportIndex?: string;
  junitXmlPath?: string;
  tracePaths: string[];
  screenshotPaths: string[];
  videoPaths: string[];
  htmlReportUrl?: string | null;
  traceUrls: string[];
}

export interface RunEventsResponse {
  runId: string;
  status: RunLifecycleStatus;
  steps: RunStepDto[];
  logs: string[];
  totalDurationMs: number;
  reportPaths: RunReportPaths | null;
  failureReason?: string | null;
}

export interface RunHistoryEntry {
  id: string;
  runNumber: number;
  suiteName: string;
  branch: string;
  commitSha: string;
  timestamp: string;
  status: 'passed' | 'failed' | 'flaky';
  durationMs: number;
  browser: 'chromium' | 'firefox' | 'webkit';
  totalSteps: number;
  healedCount: number;
}
