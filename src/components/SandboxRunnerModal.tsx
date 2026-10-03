import React, { useState, useEffect, useRef } from 'react';
import { TestStep, SuiteFile, RunLifecycleStatus, RunReportPaths, RunStepDto } from '../types';
import { runService, RUN_API_BASE_URL } from '../services/runService';
import { CredentialManagerModal, CredentialManagerValues } from './CredentialManagerModal';

interface SandboxRunnerModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialUrl?: string;
  initialHeadless?: boolean;
  suiteFiles: SuiteFile[];
  /** The suite file currently selected/active elsewhere in the app (e.g.
   * App.tsx's activeFileId — whatever the user just added via "Add to
   * Suite Files", or has open in the Projects file tabs). When this points
   * at a real `category: 'test'` suite file, Run Test executes that file
   * instead of guessing one of the two hardcoded demo specs by URL. Falls
   * back to the original demo-preset behavior when unset or pointing at a
   * non-test file (a POM, config, etc.) — the Awwwards/Incident presets
   * keep working exactly as before. */
  preferredSpecId?: string;
}

/** Maps a backend RunStepDto onto the TestStep shape the existing Steps/Visual tabs already render. */
function toTestStep(step: RunStepDto): TestStep {
  return {
    id: step.id,
    title: step.title,
    action: step.category,
    target: step.title,
    durationMs: step.durationMs,
    status: step.status,
    log: step.log
  };
}

function buildReportLogLines(paths: RunReportPaths): string[] {
  const lines: string[] = [];
  if (paths.htmlReportIndex) lines.push(`[REPORT] HTML report: ${paths.htmlReportIndex}`);
  if (paths.junitXmlPath) lines.push(`[REPORT] JUnit XML: ${paths.junitXmlPath}`);
  paths.tracePaths.forEach((p) => lines.push(`[REPORT] Trace: ${p}`));
  paths.screenshotPaths.forEach((p) => lines.push(`[REPORT] Screenshot: ${p}`));
  paths.videoPaths.forEach((p) => lines.push(`[REPORT] Video: ${p}`));
  return lines;
}

const PRESET_URLS = [
  {
    name: 'Awwwards E-Commerce',
    url: 'https://www.awwwards.com/websites/e-commerce/',
    badge: 'Requested'
  },
  {
    name: 'Incidents CRM',
    url: 'https://core-e2e.internal.corp/incidents/dashboard',
    badge: 'Enterprise'
  },
  {
    name: 'E-Commerce Store',
    url: 'https://store.demo.cloud/cart/checkout',
    badge: 'Retail'
  },
  {
    name: 'SaaS Auth SSO',
    url: 'https://auth.company-cloud.io/login',
    badge: 'Security'
  }
];

export const SandboxRunnerModal: React.FC<SandboxRunnerModalProps> = ({
  isOpen,
  onClose,
  initialUrl = 'https://www.awwwards.com/websites/e-commerce/',
  initialHeadless = false,
  suiteFiles,
  preferredSpecId
}) => {
  const [runId, setRunId] = useState<string | null>(null);
  const [runStatus, setRunStatus] = useState<RunLifecycleStatus | null>(null);
  const [isPaused, setIsPaused] = useState(false);
  const [elapsedTimeMs, setElapsedTimeMs] = useState(0);
  const [reportPaths, setReportPaths] = useState<RunReportPaths | null>(null);
  const reportLinesLoggedForRunId = useRef<string | null>(null);
  const isRunning = runStatus === 'RUNNING';
  const [activeTab, setActiveTab] = useState<'visual' | 'console' | 'steps' | 'trace'>('visual');
  const [selectedBrowser, setSelectedBrowser] = useState<'chromium' | 'firefox' | 'webkit'>('chromium');
  const [targetUrl, setTargetUrl] = useState<string>(initialUrl);
  const [urlInput, setUrlInput] = useState<string>(initialUrl);
  const [headlessMode, setHeadlessMode] = useState<boolean>(initialHeadless);

  // Synchronize initial prop changes
  useEffect(() => {
    if (initialUrl) {
      setTargetUrl(initialUrl);
      setUrlInput(initialUrl);
    }
  }, [initialUrl]);

  const isAwwwards = targetUrl.includes('awwwards.com');

  // Whatever suite file is actually selected elsewhere in the app (e.g.
  // just added via "Add to Suite Files") wins whenever it's a real,
  // runnable test file — this is what actually executes, not a guess.
  const preferredSpec = preferredSpecId
    ? suiteFiles.find((f) => f.id === preferredSpecId && f.category === 'test')
    : undefined;

  // Fallback when nothing real is selected: the two demo specs already in
  // INITIAL_SUITE_FILES, matching the same isAwwwards branch the Visual
  // Preview tab's cosmetic reproduction keys off of. AI Gen/Recorder-
  // generated specs are fully self-contained (no separate POM import), so
  // a preferred spec never has a companion pomId.
  const fallbackSpecId = isAwwwards ? 'awwwards-ecommerce.spec.ts' : 'incident-e2e.spec.ts';
  const fallbackPomId = isAwwwards ? 'AwwwardsEcommercePage.ts' : 'IncidentManagementPage.ts';
  const specId = preferredSpec?.id ?? fallbackSpecId;
  const pomId = preferredSpec ? undefined : fallbackPomId;

  const [steps, setSteps] = useState<TestStep[]>([]);
  // Raw step DTOs alongside the TestStep-mapped `steps` above — kept
  // separately so the failure-detail panel can show the real locator/
  // source-location/exception fields without changing TestStep's shape
  // (which the existing Steps/Visual tabs already render as-is).
  const [rawSteps, setRawSteps] = useState<RunStepDto[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [isCredentialModalOpen, setIsCredentialModalOpen] = useState(false);

  // Reset live-run state when the target/browser/mode changes
  useEffect(() => {
    setSteps([]);
    setRawSteps([]);
    setLogs([]);
    setElapsedTimeMs(0);
    setReportPaths(null);
    setRunId(null);
    setRunStatus(null);
  }, [targetUrl, headlessMode, selectedBrowser]);

  // Live ticking clock while a real run is in progress — snapped to the
  // backend's authoritative totalDurationMs once the run finishes (below).
  useEffect(() => {
    if (!isRunning || isPaused) return;
    const startedAt = Date.now() - elapsedTimeMs;
    const interval = setInterval(() => setElapsedTimeMs(Date.now() - startedAt), 200);
    return () => clearInterval(interval);
  }, [isRunning, isPaused]);

  // Poll the real Playwright run's live step timeline / console logs / final
  // status every 450ms while it's active (see RunController#getRunEvents).
  useEffect(() => {
    if (!runId || runStatus !== 'RUNNING' || isPaused) return;
    let cancelled = false;

    const poll = async () => {
      try {
        const data = await runService.getRunEvents(runId);
        if (cancelled) return;

        setSteps(data.steps.map(toTestStep));
        setRawSteps(data.steps);
        setLogs(data.logs);
        setReportPaths(data.reportPaths);
        if (data.totalDurationMs > 0) setElapsedTimeMs(data.totalDurationMs);
        if (data.status !== 'RUNNING') setRunStatus(data.status);
      } catch (pollErr) {
        console.debug('[SandboxRunnerModal] Run poll debug:', pollErr);
      }
    };

    poll();
    const interval = setInterval(poll, 450);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [runId, runStatus, isPaused]);

  // Once a run reaches a terminal status, append its report artifact paths
  // (HTML report / JUnit XML / trace / screenshots) to the Console log tab —
  // exactly once per run, guarded by reportLinesLoggedForRunId.
  useEffect(() => {
    if (!runId || !reportPaths || runStatus === 'RUNNING' || runStatus === null) return;
    if (reportLinesLoggedForRunId.current === runId) return;
    reportLinesLoggedForRunId.current = runId;

    const extra = buildReportLogLines(reportPaths);
    if (extra.length > 0) {
      setLogs((prev) => [...prev, ...extra]);
    }
  }, [runId, runStatus, reportPaths]);

  /** Actually launches the run, using whatever the Credential Manager
   * modal was just confirmed with. */
  const runWithCredentials = async (values: CredentialManagerValues) => {
    const spec = suiteFiles.find((f) => f.id === specId);
    const pom = suiteFiles.find((f) => f.id === pomId);

    if (!spec) {
      setLogs([`[ERROR] Could not find suite file "${specId}" to execute.`]);
      return;
    }

    setSelectedBrowser(values.browser);
    setHeadlessMode(!values.headed);

    setSteps([]);
    setRawSteps([]);
    setElapsedTimeMs(0);
    setReportPaths(null);
    setIsPaused(false);
    setRunStatus('RUNNING');
    setLogs([
      `$ npx playwright test ${spec.name} --project=${values.browser}${values.headed ? ' --headed' : ''}`,
      `[PLAYWRIGHT] Execution Mode: ${values.headed ? 'HEADED (Visible Desktop Window)' : 'HEADLESS (No window)'}`,
      `[RUNNER] Launching ${values.browser} engine...`
    ]);

    try {
      const response = await runService.startRun({
        specName: spec.name,
        specContent: spec.content,
        pomName: pom?.name,
        pomContent: pom?.content,
        browser: values.browser,
        headless: !values.headed,
        headed: values.headed,
        baseUrl: values.baseUrl,
        username: values.username,
        password: values.password,
        credentials: {
          BASE_URL: values.baseUrl,
          APP_USERNAME: values.username,
          APP_PASSWORD: values.password
        }
      });
      setRunId(response.runId);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to start Playwright run';
      setRunStatus('ERROR');
      setLogs((prev) => [...prev, `[ERROR] ${message}`]);
    }
  };

  /** Execute entry point: always confirms credentials/environment via the
   * Credential Manager modal before launching a run. */
  const handleStartRun = () => {
    const spec = suiteFiles.find((f) => f.id === specId);
    if (!spec) {
      setLogs([`[ERROR] Could not find suite file "${specId}" to execute.`]);
      return;
    }
    setIsCredentialModalOpen(true);
  };

  const handleCredentialConfirm = (values: CredentialManagerValues) => {
    setIsCredentialModalOpen(false);
    runWithCredentials(values);
  };

  const handleCredentialCancel = () => {
    setIsCredentialModalOpen(false);
  };

  const handleReset = () => {
    if (runId && runStatus === 'RUNNING') {
      runService.cancelRun(runId).catch(() => {});
    }
    setRunId(null);
    setRunStatus(null);
    setSteps([]);
    setRawSteps([]);
    setLogs([]);
    setElapsedTimeMs(0);
    setReportPaths(null);
    setIsPaused(false);
  };

  // Real step statuses drive the cosmetic "Visual Preview" tab's progress
  // highlighting the same way the old simulated currentStepIndex did.
  const firstIncompleteIndex = steps.findIndex((s) => s.status === 'pending' || s.status === 'running');
  const currentStepIndex = firstIncompleteIndex === -1 ? steps.length : firstIncompleteIndex;

  // Failed steps, straight from the reporter's NDJSON (RunStepDto) — drives
  // the failure-detail panel below. Never mocked: empty whenever nothing
  // has actually failed.
  const failedSteps = rawSteps.filter((s) => s.status === 'failed');

  const openArtifact = (relativeUrl: string) => {
    window.open(`${RUN_API_BASE_URL}${relativeUrl}`, '_blank', 'noopener,noreferrer');
  };

  const handleApplyUrl = (newUrl: string) => {
    let formatted = newUrl.trim();
    if (!formatted.startsWith('http://') && !formatted.startsWith('https://')) {
      formatted = 'https://' + formatted;
    }
    setTargetUrl(formatted);
    setUrlInput(formatted);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/80 backdrop-blur-md animate-in fade-in">
      <div className="bg-[#181c24] border border-[#262a33] rounded-2xl shadow-2xl max-w-5xl w-full max-h-[94vh] flex flex-col overflow-hidden text-[#dfe2ee]">
        {/* Top Header */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-3 bg-[#1c2028] border-b border-[#262a33]">
          <div className="flex items-center gap-3">
            <span className="p-1.5 rounded-lg bg-[#0566d9]/20 text-[#4cd7f6] flex items-center justify-center">
              <span className="material-symbols-outlined text-[20px]">
                {headlessMode ? 'terminal' : 'desktop_windows'}
              </span>
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm sm:text-base font-semibold text-[#dfe2ee]">
                  Playwright Sandbox Runner
                </h2>
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold uppercase ${
                    headlessMode
                      ? 'bg-[#31353e] text-[#c7c4d7]'
                      : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                  }`}
                >
                  {headlessMode ? 'headless: true' : 'headless: false (Headed Window)'}
                </span>
              </div>
              <p className="text-[11px] font-mono text-[#908fa0]">
                {headlessMode
                  ? 'Fast headless test execution'
                  : 'Interactive headed browser window with live step inspection'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Headless Toggle Switch */}
            <button
              onClick={() => setHeadlessMode(!headlessMode)}
              title={headlessMode ? 'Switch to Headed Mode' : 'Switch to Headless Mode'}
              className={`px-3 py-1.5 rounded-lg text-xs font-mono font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                !headlessMode
                  ? 'bg-amber-500 text-black shadow-md shadow-amber-500/20'
                  : 'bg-[#262a33] text-[#c7c4d7] hover:text-[#dfe2ee]'
              }`}
            >
              <span className="material-symbols-outlined text-[16px]">
                {!headlessMode ? 'visibility' : 'visibility_off'}
              </span>
              <span>{!headlessMode ? 'Headed (Window ON)' : 'Headless (Fast)'}</span>
            </button>

            <button
              onClick={onClose}
              className="w-8 h-8 rounded-lg bg-[#262a33] flex items-center justify-center text-[#908fa0] hover:text-[#dfe2ee] hover:bg-[#31353e] transition-colors"
            >
              <span className="material-symbols-outlined text-[18px]">close</span>
            </button>
          </div>
        </div>

        {/* URL Target Bar & Presets */}
        <div className="px-4 sm:px-6 py-2.5 bg-[#141720] border-b border-[#262a33] flex flex-col gap-2">
          <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
            <div className="flex items-center gap-1 text-[11px] font-mono text-[#4cd7f6] flex-shrink-0">
              <span className="material-symbols-outlined text-[16px]">language</span>
              <span>Target URL:</span>
            </div>

            <div className="flex-1 flex items-center gap-2 min-w-[240px]">
              <input
                type="text"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleApplyUrl(urlInput)}
                placeholder="https://www.awwwards.com/websites/e-commerce/"
                className="flex-1 h-8 px-3 rounded-lg bg-[#1c2028] border border-[#262a33] focus:border-[#4cd7f6] text-xs font-mono text-[#dfe2ee] outline-none"
              />
              <button
                onClick={() => handleApplyUrl(urlInput)}
                className="h-8 px-3 rounded-lg bg-[#0566d9] hover:bg-[#0455b5] text-white text-xs font-mono font-medium transition-colors flex items-center gap-1 flex-shrink-0 cursor-pointer"
              >
                <span>Set Target</span>
              </button>
            </div>

            {/* Browser Selector */}
            <div className="flex items-center gap-1 bg-[#1c2028] p-1 rounded-lg border border-[#262a33] flex-shrink-0">
              {(['chromium', 'firefox', 'webkit'] as const).map((b) => (
                <button
                  key={b}
                  onClick={() => setSelectedBrowser(b)}
                  className={`px-2 py-0.5 rounded text-[11px] font-mono uppercase transition-colors cursor-pointer ${
                    selectedBrowser === b
                      ? 'bg-[#0566d9] text-white font-semibold'
                      : 'text-[#908fa0] hover:text-[#dfe2ee]'
                  }`}
                >
                  {b === 'chromium' ? 'CHR' : b === 'firefox' ? 'FFX' : 'WKT'}
                </button>
              ))}
            </div>
          </div>

          {/* Quick Preset Buttons */}
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pt-0.5">
            <span className="text-[10px] font-mono text-[#908fa0] flex-shrink-0">
              Presets:
            </span>
            {PRESET_URLS.map((p) => {
              const isSelected = targetUrl === p.url;
              return (
                <button
                  key={p.name}
                  onClick={() => handleApplyUrl(p.url)}
                  className={`px-2.5 py-1 rounded-md text-[10px] font-mono whitespace-nowrap transition-all flex items-center gap-1 cursor-pointer ${
                    isSelected
                      ? 'bg-[#0566d9]/30 text-[#4cd7f6] border border-[#4cd7f6]/50 font-semibold'
                      : 'bg-[#1c2028] text-[#908fa0] hover:text-[#dfe2ee] hover:bg-[#262a33] border border-[#262a33]'
                  }`}
                >
                  <span>{p.name}</span>
                  {p.badge && (
                    <span
                      className={`text-[9px] px-1 py-0.2 rounded font-semibold ${
                        p.badge === 'Requested'
                          ? 'bg-amber-500/20 text-amber-300'
                          : 'bg-[#31353e] text-[#c7c4d7]'
                      }`}
                    >
                      {p.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Playback Controls & Metrics Bar */}
        <div className="px-4 sm:px-6 py-2.5 bg-[#181c24] border-b border-[#262a33] flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            {!isRunning ? (
              <button
                onClick={handleStartRun}
                className="h-8 px-4 rounded-lg bg-[#c0c1ff] hover:bg-[#a9aaff] text-[#1000a9] text-xs font-semibold flex items-center gap-1.5 shadow-md active:scale-95 transition-all cursor-pointer"
              >
                <span className="material-symbols-outlined text-[16px]">play_arrow</span>
                <span>{elapsedTimeMs > 0 ? 'Re-run Test' : 'Run Test'}</span>
              </button>
            ) : (
              <button
                onClick={() => setIsPaused(!isPaused)}
                className="h-8 px-4 rounded-lg bg-[#31353e] text-[#dfe2ee] text-xs font-semibold flex items-center gap-1.5 hover:bg-[#3d424e] transition-all cursor-pointer"
              >
                <span className="material-symbols-outlined text-[16px]">
                  {isPaused ? 'play_arrow' : 'pause'}
                </span>
                <span>{isPaused ? 'Resume' : 'Pause'}</span>
              </button>
            )}

            <button
              onClick={handleReset}
              className="h-8 px-2.5 rounded-lg bg-[#262a33] text-[#908fa0] hover:text-[#dfe2ee] hover:bg-[#31353e] text-xs flex items-center gap-1 transition-colors cursor-pointer"
              title="Reset sandbox"
            >
              <span className="material-symbols-outlined text-[16px]">restart_alt</span>
            </button>

            {/* Execution status telemetry */}
            <div className="flex items-center gap-2 px-2.5 py-1 rounded bg-[#1c2028] text-xs font-mono">
              <span
                className={`w-2 h-2 rounded-full ${
                  isRunning
                    ? 'bg-amber-400 animate-pulse'
                    : runStatus === 'PASSED'
                    ? 'bg-emerald-400'
                    : runStatus === 'FAILED' || runStatus === 'ERROR'
                    ? 'bg-red-400'
                    : runStatus === 'CANCELLED'
                    ? 'bg-amber-400'
                    : 'bg-[#908fa0]'
                }`}
              />
              <span className="text-[#908fa0]">Status:</span>
              <span className="text-[#dfe2ee] font-medium">
                {isRunning
                  ? isPaused
                    ? 'Paused'
                    : `Running Step ${Math.min(currentStepIndex + 1, steps.length || 1)}/${steps.length}`
                  : runStatus === 'PASSED'
                  ? 'Passed'
                  : runStatus === 'FAILED'
                  ? 'Failed'
                  : runStatus === 'ERROR'
                  ? 'Error'
                  : runStatus === 'CANCELLED'
                  ? 'Cancelled'
                  : 'Ready'}
              </span>
              <span className="text-[#4cd7f6] font-bold">⏱ {elapsedTimeMs}ms</span>
            </div>
          </div>

          {/* View Tab Buttons */}
          <div className="flex items-center gap-1 bg-[#1c2028] p-0.5 rounded-lg border border-[#262a33]">
            <button
              onClick={() => setActiveTab('visual')}
              className={`px-3 py-1 rounded-md text-xs font-mono transition-colors flex items-center gap-1.5 cursor-pointer ${
                activeTab === 'visual'
                  ? 'bg-[#0566d9] text-white font-medium'
                  : 'text-[#908fa0] hover:text-[#dfe2ee]'
              }`}
            >
              <span className="material-symbols-outlined text-[14px]">
                {!headlessMode ? 'desktop_windows' : 'preview'}
              </span>
              <span>{!headlessMode ? 'Headed Window' : 'Visual Preview'}</span>
            </button>
            <button
              onClick={() => setActiveTab('steps')}
              className={`px-3 py-1 rounded-md text-xs font-mono transition-colors flex items-center gap-1.5 cursor-pointer ${
                activeTab === 'steps'
                  ? 'bg-[#0566d9] text-white font-medium'
                  : 'text-[#908fa0] hover:text-[#dfe2ee]'
              }`}
            >
              <span className="material-symbols-outlined text-[14px]">format_list_numbered</span>
              <span>Steps ({steps.length})</span>
            </button>
            <button
              onClick={() => setActiveTab('console')}
              className={`px-3 py-1 rounded-md text-xs font-mono transition-colors flex items-center gap-1.5 cursor-pointer ${
                activeTab === 'console'
                  ? 'bg-[#0566d9] text-white font-medium'
                  : 'text-[#908fa0] hover:text-[#dfe2ee]'
              }`}
            >
              <span className="material-symbols-outlined text-[14px]">terminal</span>
              <span>CLI Logs</span>
            </button>
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-[#0f131c]">
          {activeTab === 'visual' && (
            <div className="flex flex-col gap-4">
              {/* Headed Browser Window Frame Simulation */}
              <div className="relative rounded-xl overflow-hidden border border-[#31353e] bg-[#11141c] shadow-2xl">
                {/* OS Browser Title Bar */}
                <div className="flex items-center justify-between px-3 py-2 bg-[#1f242e] border-b border-[#2e3442]">
                  {/* macOS / Window Traffic Light Controls */}
                  <div className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-full bg-[#ff5f56] inline-block shadow-sm"></span>
                    <span className="w-3 h-3 rounded-full bg-[#ffbd2e] inline-block shadow-sm"></span>
                    <span className="w-3 h-3 rounded-full bg-[#27c93f] inline-block shadow-sm"></span>

                    {/* Browser Tab */}
                    <div className="ml-3 px-3 py-1 rounded-t-md bg-[#11141c] text-[11px] font-mono text-[#dfe2ee] flex items-center gap-2 border-t border-x border-[#31353e]">
                      <span className="material-symbols-outlined text-[13px] text-[#4cd7f6]">
                        public
                      </span>
                      <span className="max-w-[180px] sm:max-w-[280px] truncate">
                        {isAwwwards
                          ? 'Awwwards - E-Commerce Websites'
                          : 'Core E2E Incident Dashboard'}
                      </span>
                      <span className="text-[10px] text-[#908fa0]">×</span>
                    </div>
                  </div>

                  {/* Headed Window Indicator Badge */}
                  <div className="flex items-center gap-1.5 text-[10px] font-mono">
                    {!headlessMode ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-semibold border border-amber-500/30">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping"></span>
                        HEADED BROWSER (WINDOW VISIBLE)
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded bg-[#262a33] text-[#908fa0]">
                        HEADLESS (VIRTUAL DOM)
                      </span>
                    )}
                    <span className="text-[#908fa0] hidden sm:inline">1440 × 900</span>
                  </div>
                </div>

                {/* Browser Address & Navigation Row */}
                <div className="flex items-center gap-2 px-3 py-1.5 bg-[#181d26] border-b border-[#2e3442] text-xs font-mono text-[#c7c4d7]">
                  <div className="flex items-center gap-1 text-[#908fa0]">
                    <span className="material-symbols-outlined text-[16px] hover:text-[#dfe2ee] cursor-pointer">
                      arrow_back
                    </span>
                    <span className="material-symbols-outlined text-[16px] hover:text-[#dfe2ee] cursor-pointer">
                      arrow_forward
                    </span>
                    <span
                      onClick={handleStartRun}
                      className="material-symbols-outlined text-[16px] hover:text-[#dfe2ee] cursor-pointer"
                      title="Reload page"
                    >
                      refresh
                    </span>
                  </div>

                  {/* Browser URL Input Box */}
                  <div className="flex-1 flex items-center gap-2 px-2.5 py-1 rounded-md bg-[#11141c] border border-[#2e3442] text-xs font-mono">
                    <span className="material-symbols-outlined text-[14px] text-emerald-400">
                      lock
                    </span>
                    <span className="text-[#dfe2ee] truncate">{targetUrl}</span>
                    <span className="ml-auto text-[10px] text-[#908fa0]">
                      {isRunning ? 'Rendering...' : 'Complete'}
                    </span>
                  </div>
                </div>

                {/* Viewport Render Canvas */}
                <div className="relative min-h-[360px] max-h-[460px] overflow-y-auto p-4 sm:p-6 bg-[#0a0d14]">
                  {isAwwwards ? (
                    /* Awwwards E-Commerce Website Reproduction */
                    <div className="flex flex-col gap-4 font-sans text-[#dfe2ee]">
                      {/* Awwwards Navigation Header */}
                      <div className="flex items-center justify-between pb-3 border-b border-[#262a33]">
                        <div className="flex items-center gap-4">
                          <span className="text-lg font-black tracking-widest text-white">
                            W.
                          </span>
                          <span className="text-xs font-bold uppercase tracking-wider text-white hidden sm:inline">
                            Awwwards
                          </span>
                          <nav className="flex items-center gap-3 text-xs text-[#908fa0] font-medium">
                            <span className="text-white font-semibold">Nominees</span>
                            <span className="hover:text-white cursor-pointer">Directory</span>
                            <span className="hover:text-white cursor-pointer">Academy</span>
                          </nav>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            id="submitSiteBtn"
                            className="px-3 py-1 rounded-full bg-white text-black font-semibold text-xs hover:bg-[#eaeaea] transition-all flex items-center gap-1 cursor-pointer"
                          >
                            <span>Submit your Site</span>
                          </button>
                        </div>
                      </div>

                      {/* Category Banner */}
                      <div className="flex flex-col gap-1 pt-1">
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-amber-500/20 text-amber-300 font-bold">
                            COLLECTION
                          </span>
                          <span className="text-xs font-mono text-[#908fa0]">
                            32,480 Nominees
                          </span>
                        </div>
                        <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
                          E-Commerce Websites
                        </h1>
                        <p className="text-xs text-[#908fa0] max-w-xl">
                          The best e-commerce and retail website designs, evaluated for
                          design aesthetics, usability, creativity, and mobile commerce
                          performance.
                        </p>
                      </div>

                      {/* Filter Chips Bar */}
                      <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-1">
                        {[
                          'All Platforms',
                          'Shopify Plus',
                          'WooCommerce',
                          'Headless Commerce',
                          'Minimalist',
                          'Fashion & Apparel'
                        ].map((cat, idx) => (
                          <span
                            key={cat}
                            className={`px-2.5 py-1 rounded-full text-[11px] font-medium whitespace-nowrap cursor-pointer ${
                              idx === 0
                                ? 'bg-white text-black font-semibold'
                                : 'bg-[#1c2028] text-[#c7c4d7] hover:bg-[#262a33]'
                            }`}
                          >
                            {cat}
                          </span>
                        ))}
                      </div>

                      {/* E-Commerce Nominees Showcase Cards */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 pt-2">
                        {/* Card 1 */}
                        <div
                          className={`group relative rounded-xl bg-[#141822] border transition-all overflow-hidden p-3 flex flex-col gap-2 ${
                            currentStepIndex >= 4
                              ? 'border-[#4cd7f6] ring-2 ring-[#4cd7f6]/40 shadow-lg'
                              : 'border-[#262a33]'
                          }`}
                        >
                          <div className="relative h-32 rounded-lg bg-gradient-to-br from-[#1e2638] to-[#0f1420] overflow-hidden flex items-center justify-center">
                            <span className="material-symbols-outlined text-[42px] text-[#4cd7f6]/40">
                              storefront
                            </span>
                            <span className="absolute top-2 right-2 px-1.5 py-0.5 rounded text-[10px] font-mono bg-black/70 text-amber-300 font-bold">
                              8.74
                            </span>
                          </div>
                          <div className="flex items-center justify-between">
                            <div>
                              <div className="font-semibold text-xs text-white">
                                NIXON Minimalist Watches
                              </div>
                              <div className="text-[10px] text-[#908fa0]">
                                by Monopo London • Shopify Plus
                              </div>
                            </div>
                            <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-[#262a33] text-[#4cd7f6]">
                              NOMINEE
                            </span>
                          </div>
                        </div>

                        {/* Card 2 */}
                        <div className="group relative rounded-xl bg-[#141822] border border-[#262a33] overflow-hidden p-3 flex flex-col gap-2">
                          <div className="relative h-32 rounded-lg bg-gradient-to-br from-[#241d30] to-[#140f20] overflow-hidden flex items-center justify-center">
                            <span className="material-symbols-outlined text-[42px] text-[#8083ff]/40">
                              shopping_bag
                            </span>
                            <span className="absolute top-2 right-2 px-1.5 py-0.5 rounded text-[10px] font-mono bg-black/70 text-amber-300 font-bold">
                              8.62
                            </span>
                          </div>
                          <div className="flex items-center justify-between">
                            <div>
                              <div className="font-semibold text-xs text-white">
                                VELORETTI Electric Bikes
                              </div>
                              <div className="text-[10px] text-[#908fa0]">
                                by Media.Monks • Headless
                              </div>
                            </div>
                            <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-[#262a33] text-[#adc6ff]">
                              WINNER
                            </span>
                          </div>
                        </div>

                        {/* Card 3 */}
                        <div className="group relative rounded-xl bg-[#141822] border border-[#262a33] overflow-hidden p-3 flex flex-col gap-2">
                          <div className="relative h-32 rounded-lg bg-gradient-to-br from-[#1a2b2e] to-[#0f1c1e] overflow-hidden flex items-center justify-center">
                            <span className="material-symbols-outlined text-[42px] text-[#10b981]/40">
                              local_mall
                            </span>
                            <span className="absolute top-2 right-2 px-1.5 py-0.5 rounded text-[10px] font-mono bg-black/70 text-amber-300 font-bold">
                              8.91
                            </span>
                          </div>
                          <div className="flex items-center justify-between">
                            <div>
                              <div className="font-semibold text-xs text-white">
                                LE LABO Artisanal Perfumes
                              </div>
                              <div className="text-[10px] text-[#908fa0]">
                                by Immersive Paris • Custom
                              </div>
                            </div>
                            <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-[#262a33] text-emerald-400">
                              SOTD
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    /* Default Enterprise Incident App */
                    <div className="flex flex-col gap-4">
                      <div className="flex items-center justify-between pb-3 border-b border-[#262a33]">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono font-bold text-[#4cd7f6]">
                            INCIDENT-PORTAL-V2
                          </span>
                          <span className="text-xs text-[#908fa0]">
                            / Incidents Dashboard
                          </span>
                        </div>
                        <button className="px-3 py-1 rounded bg-[#0566d9] text-white text-xs font-medium">
                          New Incident
                        </button>
                      </div>

                      <div className="p-4 rounded-xl bg-[#181c24] border border-[#262a33] flex flex-col gap-3">
                        <div className="text-xs font-semibold text-white">
                          Create Incident Report
                        </div>
                        <input
                          type="text"
                          readOnly
                          value={
                            currentStepIndex >= 4
                              ? 'Database Latency Spike - Checkout Services Degraded'
                              : ''
                          }
                          placeholder="Short description..."
                          className="h-8 px-3 rounded bg-[#11141c] border border-[#31353e] text-xs font-mono text-white"
                        />
                        <div className="flex items-center justify-between pt-1">
                          <span className="text-xs font-mono text-[#908fa0]">
                            Urgency: High
                          </span>
                          <button className="px-3 py-1 rounded bg-[#c0c1ff] text-[#1000a9] text-xs font-semibold">
                            Submit Incident
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Live Animated Mouse Cursor for Headed Inspection */}
                  {!headlessMode && isRunning && (
                    <div
                      className="absolute z-30 pointer-events-none transition-all duration-300"
                      style={{
                        top: currentStepIndex <= 2 ? '60px' : currentStepIndex <= 4 ? '180px' : '260px',
                        left: currentStepIndex <= 2 ? '120px' : currentStepIndex <= 4 ? '280px' : '360px'
                      }}
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="material-symbols-outlined text-[20px] text-amber-400 drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)]">
                          near_me
                        </span>
                        <span className="px-2 py-0.5 rounded bg-black/90 text-amber-300 text-[10px] font-mono border border-amber-500/40">
                          {steps[currentStepIndex]?.action || 'cursor'}
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Bottom Status bar for headed window */}
                <div className="px-3 py-1.5 bg-[#181d26] border-t border-[#2e3442] flex items-center justify-between text-[11px] font-mono text-[#908fa0]">
                  <div className="flex items-center gap-2">
                    <span className="inline-block w-2 h-2 rounded-full bg-emerald-400"></span>
                    <span>
                      {headlessMode ? 'Headless Chromium Worker' : 'Chromium Headed Process (Window visible)'}
                    </span>
                  </div>
                  <span className="text-[#4cd7f6]">
                    Active Step: {steps[currentStepIndex]?.title || 'Completed'}
                  </span>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'steps' && (
            <div className="flex flex-col gap-2">
              {/* Failure Details — only rendered when a real step actually
                  failed, built entirely from the reporter's NDJSON fields
                  (never mocked). */}
              {failedSteps.length > 0 && (
                <div className="flex flex-col gap-2 mb-1">
                  {failedSteps.map((fs) => (
                    <div
                      key={fs.id}
                      className="p-3.5 rounded-xl bg-[#450a0a] border border-[#ef4444]/50 shadow-[0_4px_20px_rgba(239,68,68,0.15)] flex flex-col gap-2 font-mono text-xs"
                    >
                      <div className="flex items-center gap-2 text-[#fca5a5] font-semibold">
                        <span className="material-symbols-outlined text-[16px]">error</span>
                        <span>Step {fs.id} failed: {fs.title}</span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 text-[11px]">
                        <div>
                          <span className="text-[#908fa0]">Action: </span>
                          <span className="text-[#fca5a5]">{fs.category}</span>
                        </div>
                        {fs.locator && (
                          <div className="min-w-0">
                            <span className="text-[#908fa0]">Locator: </span>
                            <span className="text-[#fca5a5] break-all">{fs.locator}</span>
                          </div>
                        )}
                        {fs.sourceFile && (
                          <div>
                            <span className="text-[#908fa0]">Source: </span>
                            <span className="text-[#fca5a5]">
                              {fs.sourceFile}
                              {fs.sourceLine ? `:${fs.sourceLine}` : ''}
                            </span>
                          </div>
                        )}
                      </div>
                      {fs.error && (
                        <div className="mt-1 pt-2 border-t border-[#ef4444]/30">
                          <div className="text-[#908fa0] text-[11px] mb-1">Exception:</div>
                          <pre className="whitespace-pre-wrap break-words text-[#fca5a5] text-[11px] leading-relaxed">
                            {fs.error}
                          </pre>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <div className="text-xs font-mono text-[#908fa0] pb-2">
                Execution Pipeline ({steps.length} steps):
              </div>
              {steps.map((step, idx) => (
                <div
                  key={step.id}
                  className={`p-3 rounded-xl border flex items-center justify-between gap-3 font-mono text-xs transition-all ${
                    idx === currentStepIndex && isRunning
                      ? 'bg-[#1f2638] border-[#4cd7f6] ring-1 ring-[#4cd7f6]/50 shadow-md'
                      : step.status === 'passed'
                      ? 'bg-[#181c24] border-[#262a33]'
                      : 'bg-[#141720] border-[#262a33]/50 opacity-60'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span
                      className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold ${
                        step.status === 'passed'
                          ? 'bg-emerald-500/20 text-emerald-400'
                          : step.status === 'running'
                          ? 'bg-amber-500/20 text-amber-400 animate-spin'
                          : 'bg-[#262a33] text-[#908fa0]'
                      }`}
                    >
                      {step.status === 'passed' ? '✓' : step.id}
                    </span>
                    <div className="flex flex-col min-w-0">
                      <span className="text-[#dfe2ee] font-medium truncate">
                        {step.title}
                      </span>
                      <span className="text-[11px] text-[#4cd7f6] truncate">
                        {step.target}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="px-2 py-0.5 rounded bg-[#1c2028] text-[#908fa0] text-[10px]">
                      {step.durationMs}ms
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold ${
                        step.status === 'passed'
                          ? 'bg-emerald-500/20 text-emerald-400'
                          : step.status === 'running'
                          ? 'bg-amber-500/20 text-amber-400'
                          : 'bg-[#262a33] text-[#908fa0]'
                      }`}
                    >
                      {step.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {activeTab === 'console' && (
            <div className="flex flex-col gap-2 font-mono text-xs">
              <div className="flex items-center justify-between text-[#908fa0] text-[11px] pb-1">
                <span>Playwright CLI Terminal Log Output:</span>
                <button
                  onClick={() =>
                    navigator.clipboard.writeText(
                      `npx playwright test tests/${specId} ${headlessMode ? '' : '--headed'}`
                    )
                  }
                  className="hover:text-[#dfe2ee] text-[#4cd7f6] flex items-center gap-1 cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[14px]">content_copy</span>
                  <span>Copy Run Command</span>
                </button>
              </div>
              <div className="p-4 rounded-xl bg-black border border-[#262a33] text-emerald-400 leading-relaxed font-mono overflow-x-auto min-h-[300px]">
                {logs.length === 0 ? (
                  <div className="text-[#908fa0]">
                    Terminal idle. Click "Run Test" above to stream execution logs.
                  </div>
                ) : (
                  logs.map((log, idx) => <div key={idx}>{log}</div>)
                )}
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-4 sm:px-6 py-3 bg-[#1c2028] border-t border-[#262a33] flex items-center justify-between flex-wrap gap-2 text-xs font-mono text-[#908fa0]">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[16px] text-[#4cd7f6]">
              code
            </span>
            <span>CLI Command:</span>
            <code className="text-[#dfe2ee] bg-[#11141c] px-2 py-0.5 rounded border border-[#262a33]">
              npx playwright test tests/{specId} {!headlessMode ? '--headed' : ''}
            </code>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {reportPaths?.htmlReportUrl && (
              <button
                onClick={() => openArtifact(reportPaths.htmlReportUrl!)}
                className="px-3 py-1 rounded bg-[#262a33] hover:bg-[#31353e] text-[#4cd7f6] transition-colors cursor-pointer flex items-center gap-1.5"
                title="Open the generated Playwright HTML report"
              >
                <span className="material-symbols-outlined text-[14px]">description</span>
                <span>Open HTML Report</span>
              </button>
            )}
            {reportPaths?.traceUrls.map((traceUrl, idx) => (
              <button
                key={traceUrl}
                onClick={() => openArtifact(traceUrl)}
                className="px-3 py-1 rounded bg-[#262a33] hover:bg-[#31353e] text-[#4cd7f6] transition-colors cursor-pointer flex items-center gap-1.5"
                title="Download the trace.zip for viewing with `npx playwright show-trace`"
              >
                <span className="material-symbols-outlined text-[14px]">route</span>
                <span>Open Trace{reportPaths.traceUrls.length > 1 ? ` #${idx + 1}` : ''}</span>
              </button>
            ))}
            <button
              onClick={() => {
                navigator.clipboard.writeText(
                  `npx playwright test tests/${specId} ${!headlessMode ? '--headed' : ''}`
                );
              }}
              className="px-3 py-1 rounded bg-[#262a33] hover:bg-[#31353e] text-[#dfe2ee] transition-colors cursor-pointer"
            >
              Copy Command
            </button>
            <button
              onClick={onClose}
              className="px-4 py-1 rounded bg-[#0566d9] hover:bg-[#0455b5] text-white font-medium cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>
      </div>

      <CredentialManagerModal
        isOpen={isCredentialModalOpen}
        initialBaseUrl={targetUrl}
        initialBrowser={selectedBrowser}
        initialHeaded={!headlessMode}
        onCancel={handleCredentialCancel}
        onConfirm={handleCredentialConfirm}
      />
    </div>
  );
};
