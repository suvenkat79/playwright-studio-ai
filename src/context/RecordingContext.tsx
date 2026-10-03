import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback, useRef } from 'react';
import { recordService } from '../services/recordService';
import { optimizeRecordedActions, summarizeOptimizedActions } from '../services/optimizerService';
import { frameworkContentKey, frameworkValidationService } from '../services/frameworkValidationService';
import type { FrameworkProject } from '../services/frameworkGenerator';
import {
  FrameworkProjectStorage,
  type FrameworkProjectReference
} from '../services/frameworkProjectPersistence';
import {
  createAccumulatedFramework,
  mergeIntoFramework,
  toFrameworkProject,
  type AccumulatedFramework,
  type AccumulatedTestFile
} from '../services/frameworkAccumulator';
import type { OptimizedAction } from '../services/optimizer/types';
import type { FrameworkValidationDiagnostic } from '../services/frameworkValidator';
import { StartRecordingResponse, StopRecordingResponse, RecordedAction, SessionLifecycleStatus } from '../types';

/**
 * Structured AI Gen context prepared by "Prepare for AI" (LiveRecorderView)
 * -- Context Engine facts (Application/Page/Frame) plus the optimized
 * journey, all read-only display data for the AI Gen screen. Deliberately
 * NOT a natural-language string: AI Gen's instruction textarea is a plain
 * user-typed field (see AIGeneratorView.tsx), and this context is never
 * written into it. resolveIntent() already derives its own
 * Application/Page/Frame metadata live, server-side, independent of this --
 * this is for the user to see what AI Gen is pointed at, not an input to
 * the resolver.
 */
export interface PreparedAIContext {
  readonly sessionId: string;
  readonly targetUrl: string;
  readonly preparedAt: number;
  readonly applicationMetadata?: RecordedAction['applicationMetadata'];
  readonly pageMetadata?: RecordedAction['pageMetadata'];
  readonly frameMetadata?: RecordedAction['frameMetadata'];
  readonly optimizedStepCount: number;
  readonly optimizedSummary: string;
}

export interface PreparedFrameworkContext {
  readonly project: FrameworkProject;
  readonly projectId: string | null;
  readonly recordedActions: RecordedAction[];
  readonly optimizedActions: OptimizedAction[];
  readonly targetUrl: string;
  readonly sessionId: string;
  readonly preparedAt: number;
}

/**
 * "AI Framework Review": UI/state plumbing only in this phase -- there is no
 * LLM integration yet, so the status never advances past 'pending'. Derived
 * from preparedFrameworkContext (see RecordingProvider below), so it is
 * automatically invalidated whenever the framework is regenerated.
 */
export type FrameworkReviewStatus = 'pending';

export interface FrameworkReviewState {
  readonly status: FrameworkReviewStatus;
}

/**
 * "Validate Framework": the deterministic (non-LLM) structural/build/type
 * gate. null means no validation has been run yet for the current
 * FrameworkProject -- regenerating the framework resets this to null (see
 * prepareFrameworkForAIGeneration), so a stale PASS/FAIL can never be shown
 * against a framework it did not actually check.
 */
export type FrameworkValidationRunStatus = 'running' | 'passed' | 'failed';

export interface FrameworkValidationState {
  readonly status: FrameworkValidationRunStatus;
  readonly diagnostics: FrameworkValidationDiagnostic[];
  readonly checkedAt: number | null;
  readonly error: string | null;
  readonly contentKey?: string;
}

export interface RecordingContextType {
  sessionId: string | null;
  status: string | null;
  sessionLifecycleStatus: SessionLifecycleStatus | null;
  recordedUrl: string;
  isStarting: boolean;
  isStopping: boolean;
  isLiveRecording: boolean;
  error: string | null;
  capturedEvents: RecordedAction[];
  lastGeneratedScript: string | null;
  preparedAIContext: PreparedAIContext | null;
  preparedFrameworkContext: PreparedFrameworkContext | null;
  frameworkProjectId: string | null;
  savedFrameworkProjects: FrameworkProjectReference[];
  refreshFrameworkProjects: () => Promise<void>;
  saveFrameworkProject: (project: FrameworkProject, name?: string, projectId?: string | null, targetUrl?: string) => Promise<string>;
  loadFrameworkProject: (projectId: string) => Promise<void>;
  frameworkReviewState: FrameworkReviewState | null;
  frameworkValidationState: FrameworkValidationState | null;
  runFrameworkValidation: () => Promise<void>;
  sessionStartedAt: number | null;
  elapsedSeconds: number;
  // Derived action-bar state (single source of truth — do not re-derive
  // these independently in components):
  // IDLE (sessionId == null or STOPPED): canStart=true, canStop=false
  // RUNNING: canStart=false, canStop=true
  // STOPPING: canStart=false, canStop=false
  // FAILED: canStart=true, canStop=false
  canStart: boolean;
  canStop: boolean;
  startRecording: (targetUrl: string) => Promise<StartRecordingResponse>;
  stopRecording: () => Promise<StopRecordingResponse | null>;
  clearSession: () => void;
  setSessionId: (id: string | null) => void;
  prepareForAIGeneration: (events: RecordedAction[], url: string) => void;
  prepareFrameworkForAIGeneration: (
    project: FrameworkProject,
    recordedActions: RecordedAction[],
    optimizedActions: OptimizedAction[],
    url: string
  ) => void;
  /**
   * "Add to Suite": structurally merges an AI Gen result's generatedProject
   * into the SAME accumulated FrameworkProject (requirement: FrameworkProject
   * stays the single source of truth; never a second framework). Updates
   * preparedFrameworkContext.project in place so the next AI Gen request
   * matches/reuses against the newly accumulated state, and automatically
   * re-runs Validate Framework against the merged result. Throws if no
   * framework has been generated yet.
   */
  addGeneratedProjectToSuite: (
    generatedProject: FrameworkProject,
    instruction: string
  ) => Promise<AccumulatedTestFile>;
}

const RecordingContext = createContext<RecordingContextType | undefined>(undefined);
const SESSION_ID_STORAGE_KEY = 'playwright-studio-recording-session-id';
const frameworkProjectStorage = new FrameworkProjectStorage();

function projectTargetUrl(project: FrameworkProject): string {
  return project.actions.find((action) => action.url)?.url ??
    project.recordedActions.find((action) => action.url)?.url ?? '';
}

async function waitForFinalSessionStatus(sessionId: string) {
  const deadline = Date.now() + 30000;

  while (Date.now() < deadline) {
    const status = await recordService.getStatus(sessionId);
    if (status.status === 'STOPPED' || status.status === 'FAILED' || status.failureReason) {
      return status;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error('Timed out waiting for the backend to finish stopping the recording session.');
}

export const RecordingProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [sessionId, setSessionId] = useState<string | null>(
    () => window.localStorage.getItem(SESSION_ID_STORAGE_KEY)
  );
  const [status, setStatus] = useState<string | null>(null);
  const [sessionLifecycleStatus, setSessionLifecycleStatus] = useState<SessionLifecycleStatus | null>(null);
  const [recordedUrl, setRecordedUrl] = useState<string>('https://www.awwwards.com/websites/e-commerce/');
  const [isStarting, setIsStarting] = useState<boolean>(false);
  const [isStopping, setIsStopping] = useState<boolean>(false);
  const [isLiveRecording, setIsLiveRecording] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [capturedEvents, setCapturedEvents] = useState<RecordedAction[]>([]);
  const [lastGeneratedScript, setLastGeneratedScript] = useState<string | null>(null);
  const [preparedAIContext, setPreparedAIContext] = useState<PreparedAIContext | null>(null);
  const [preparedFrameworkContext, setPreparedFrameworkContext] = useState<PreparedFrameworkContext | null>(null);
  const [frameworkProjectId, setFrameworkProjectId] = useState<string | null>(null);
  const [savedFrameworkProjects, setSavedFrameworkProjects] = useState<FrameworkProjectReference[]>([]);
  const [accumulatedFramework, setAccumulatedFramework] = useState<AccumulatedFramework | null>(null);
  const [frameworkValidationState, setFrameworkValidationState] = useState<FrameworkValidationState | null>(null);
  const validationRunId = useRef(0);
  const [sessionStartedAt, setSessionStartedAt] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);

  useEffect(() => {
    if (sessionId) {
      window.localStorage.setItem(SESSION_ID_STORAGE_KEY, sessionId);
    } else {
      window.localStorage.removeItem(SESSION_ID_STORAGE_KEY);
    }
  }, [sessionId]);

  const refreshFrameworkProjects = useCallback(async () => {
    setSavedFrameworkProjects(await frameworkProjectStorage.list());
  }, []);

  useEffect(() => {
    void refreshFrameworkProjects().catch((loadError: unknown) => {
      console.warn('Unable to list saved framework projects:', loadError);
    });
  }, [refreshFrameworkProjects]);

  const saveFrameworkProject = useCallback(async (
    project: FrameworkProject,
    name?: string,
    projectIdOverride?: string | null,
    targetUrl?: string
  ): Promise<string> => {
    const projectId = projectIdOverride === null
      ? undefined
      : projectIdOverride ?? frameworkProjectId ?? undefined;
    const saved = await frameworkProjectStorage.save(project, {
      projectId,
      name,
      targetUrl: targetUrl ?? preparedFrameworkContext?.targetUrl
    });
    setFrameworkProjectId(saved.projectId);
    // This save is now the project that should come back on next startup
    // -- never implicitly whichever project happens to sort newest.
    await frameworkProjectStorage.setActiveProjectId(saved.projectId);
    setSavedFrameworkProjects(await frameworkProjectStorage.list());
    return saved.projectId;
  }, [frameworkProjectId, preparedFrameworkContext?.targetUrl]);

  const loadFrameworkProject = useCallback(async (projectId: string) => {
    const currentRunId = ++validationRunId.current;
    const saved = await frameworkProjectStorage.load(projectId);
    const targetUrl = saved.targetUrl ?? projectTargetUrl(saved);
    const accumulated = createAccumulatedFramework(saved, targetUrl);
    setFrameworkProjectId(saved.projectId);
    await frameworkProjectStorage.setActiveProjectId(saved.projectId);
    setAccumulatedFramework(accumulated);
    setPreparedFrameworkContext({
      project: saved,
      projectId: saved.projectId,
      recordedActions: [...saved.recordedActions],
      optimizedActions: [...saved.actions],
      targetUrl,
      sessionId: '',
      preparedAt: Date.now()
    });
    setPreparedAIContext({
      sessionId: '',
      targetUrl,
      preparedAt: Date.now(),
      applicationMetadata: saved.recordedActions.find((action) => action.applicationMetadata)?.applicationMetadata,
      pageMetadata: saved.recordedActions.find((action) => action.pageMetadata)?.pageMetadata,
      frameMetadata: saved.recordedActions.find((action) => action.frameMetadata)?.frameMetadata,
      optimizedStepCount: saved.actions.length,
      optimizedSummary: summarizeOptimizedActions(saved.actions)
    });
    const contentKey = frameworkContentKey(saved.files);
    setFrameworkValidationState({ status: 'running', diagnostics: [], checkedAt: null, error: null, contentKey });
    try {
      const result = await frameworkValidationService.validate(saved.files);
      if (validationRunId.current !== currentRunId) return;
      setFrameworkValidationState({
        status: result.status === 'PASS' ? 'passed' : 'failed',
        diagnostics: result.diagnostics,
        checkedAt: result.checkedAt,
        error: null,
        contentKey
      });
    } catch (validationError: unknown) {
      if (validationRunId.current !== currentRunId) return;
      setFrameworkValidationState({
        status: 'failed',
        diagnostics: [],
        checkedAt: null,
        error: validationError instanceof Error ? validationError.message : 'Failed to validate loaded framework',
        contentKey
      });
    }
    setSavedFrameworkProjects(await frameworkProjectStorage.list());
  }, []);

  // Restores whichever FrameworkProject was last explicitly saved or
  // loaded (see FrameworkProjectStorage's getActiveProjectId/
  // setActiveProjectId), independent of the recording sessionId --
  // project identity is the projectId, never the recording session that
  // originally produced it. Mount-only: a project merely existing in
  // storage, even one with a newer timestamp from some other flow, must
  // never become active on its own -- only an explicit save()/load() ever
  // sets this. Reuses loadFrameworkProject exactly, so restoration behaves
  // identically to an explicit Load (including: validation failing or the
  // backend being unavailable never discards the restored project itself,
  // only its validation status).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const activeProjectId = await frameworkProjectStorage.getActiveProjectId();
      if (!activeProjectId || cancelled) return;
      try {
        await loadFrameworkProject(activeProjectId);
      } catch (restoreError: unknown) {
        if (cancelled) return;
        console.warn('Unable to restore the active framework project:', restoreError);
        await frameworkProjectStorage.setActiveProjectId(null);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!sessionId) return;

    let cancelled = false;
    recordService.getStatus(sessionId).then((statusData) => {
      if (!cancelled) {
        applyBackendStatus(statusData);
      }
    }).catch((statusErr: unknown) => {
      if (!cancelled) {
        console.warn('Unable to restore recording session status:', statusErr);
        setSessionLifecycleStatus(null);
        setIsLiveRecording(false);
        setError(statusErr instanceof Error ? statusErr.message : 'Unable to restore recording session status');
      }
    });

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const applyBackendStatus = (statusData: Awaited<ReturnType<typeof recordService.getStatus>>) => {
    const failed = statusData.status === 'FAILED' || Boolean(statusData.failureReason);
    const nextStatus: SessionLifecycleStatus = failed ? 'FAILED' : statusData.status;
    const isTerminal = nextStatus === 'STOPPED' || nextStatus === 'FAILED';

    setSessionLifecycleStatus(nextStatus);
    setError(failed ? statusData.failureReason || 'Recording session failed' : null);
    setIsLiveRecording(!isTerminal);
    if (isTerminal) {
      setIsStopping(false);
    }
  };

  // Poll live events every 500ms while a real session is active.
  // Continues until the backend reports a terminal session status or this
  // effect is torn down (unmount).
  useEffect(() => {
    if (!sessionId || !isLiveRecording) return;

    let cancelled = false;

    const poll = async () => {
      try {
        const data = await recordService.getRecordedEvents(sessionId);
        if (cancelled) return;

        if (data.events && Array.isArray(data.events)) {
          setCapturedEvents(data.events);
        }

        if (!data.isRecording && !isStopping) {
          // Confirm the exact lifecycle status (STOPPED vs FAILED) via the
          // dedicated status endpoint before halting the poll.
          try {
            const statusData = await recordService.getStatus(sessionId);
            if (!cancelled) {
              applyBackendStatus(statusData);
            }
          } catch (statusErr) {
            console.debug('[RecordingContext] Status check debug:', statusErr);
          }
        }
      } catch (pollErr) {
        // Backend or session might be busy or in transition
        console.debug('[RecordingContext] Event poll debug:', pollErr);
      }
    };

    const interval = setInterval(poll, 500);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [sessionId, isLiveRecording, isStopping]);

  // Tick session duration every second while a session is live
  useEffect(() => {
    if (!isLiveRecording || !sessionStartedAt) return;

    const tick = () => setElapsedSeconds(Math.floor((Date.now() - sessionStartedAt) / 1000));
    tick();
    const interval = setInterval(tick, 1000);

    return () => clearInterval(interval);
  }, [isLiveRecording, sessionStartedAt]);

  // Derived action-bar state, kept here so every button (across
  // ProjectHeader / StickyActionBar / LiveRecorderView) reads the exact same
  // computed value instead of re-deriving it from raw flags independently.
  const canStart = !isStarting && !isLiveRecording && !isStopping && sessionLifecycleStatus !== 'STOPPING';
  const canStop = isLiveRecording && !isStopping && sessionLifecycleStatus !== 'STOPPING';

  const startRecording = async (targetUrl: string): Promise<StartRecordingResponse> => {
    // Guard against duplicate calls even if a caller bypasses the disabled
    // button state (e.g. a race between click and re-render).
    if (isStarting || isLiveRecording || isStopping) {
      throw new Error('A recording session is already starting or in progress.');
    }

    setIsStarting(true);
    setError(null);
    setCapturedEvents([]);
    setPreparedAIContext(null);
    setPreparedFrameworkContext(null);
    setFrameworkProjectId(null);
    // A brand new recording has no active saved project of its own until
    // it is itself explicitly saved -- without this, refreshing mid-
    // recording would resurrect the PREVIOUS project over the new one.
    void frameworkProjectStorage.setActiveProjectId(null);
    setAccumulatedFramework(null);
    setFrameworkValidationState(null);
    setSessionLifecycleStatus(null);
    setIsStopping(false);
    setElapsedSeconds(0);

    try {
      const response = await recordService.startRecording(targetUrl);
      setSessionId(response.sessionId);
      setStatus(response.status);
      setSessionLifecycleStatus('RUNNING');
      setRecordedUrl(targetUrl);
      setSessionStartedAt(Date.now());
      setIsLiveRecording(true);
      return response;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to start recording';
      setError(message);
      throw err;
    } finally {
      setIsStarting(false);
    }
  };

  const stopRecording = async (): Promise<StopRecordingResponse | null> => {
    if (!sessionId) return null;

    setIsStopping(true);
    setSessionLifecycleStatus('STOPPING');
    try {
      const response = await recordService.stopRecording(sessionId);
      if (response.testScript) {
        setLastGeneratedScript(response.testScript);
      }

      const finalStatus = await waitForFinalSessionStatus(sessionId);
      applyBackendStatus(finalStatus);
      setIsStopping(false);

      if (finalStatus.status === 'FAILED' || finalStatus.failureReason) {
        throw new Error(finalStatus.failureReason || 'Recording session failed');
      }
      return response;
    } catch (err: unknown) {
      console.warn('Failed to stop recording cleanly on backend:', err);
      try {
        const finalStatus = await recordService.getStatus(sessionId);
        applyBackendStatus(finalStatus);
        setIsStopping(false);
      } catch (statusErr) {
        console.warn('Unable to confirm recording session status after stop error:', statusErr);
      }
      throw err;
    }
  };

  const clearSession = () => {
    setSessionId(null);
    setStatus(null);
    setSessionLifecycleStatus(null);
    setIsStopping(false);
    setIsLiveRecording(false);
    setError(null);
    setCapturedEvents([]);
    setLastGeneratedScript(null);
    setPreparedAIContext(null);
    setPreparedFrameworkContext(null);
    setFrameworkProjectId(null);
    void frameworkProjectStorage.setActiveProjectId(null);
    setAccumulatedFramework(null);
    setFrameworkValidationState(null);
    setSessionStartedAt(null);
    setElapsedSeconds(0);
  };

  const prepareForAIGeneration = useCallback((
    events: RecordedAction[],
    url: string,
    optimizedOverride?: OptimizedAction[]
  ) => {
    // Run the raw captured events through the deterministic AI Optimizer
    // Engine (merge sequential fills, dedupe clicks, collapse navigations,
    // annotate locator quality) -- the same pass AI Gen's own resolved
    // actions get run through, so the step count shown here matches what
    // AI Gen will actually produce.
    const optimized = optimizedOverride ?? optimizeRecordedActions(events);

    // Context Engine facts the Recorder already stamped on captured events
    // (see recorder/engine.ts's exposeBinding handler) -- most recent
    // non-empty value wins, since detection can refine over the session
    // (e.g. frame metadata changing after a sub-frame navigation).
    let applicationMetadata: RecordedAction['applicationMetadata'];
    let pageMetadata: RecordedAction['pageMetadata'];
    let frameMetadata: RecordedAction['frameMetadata'];
    for (let i = events.length - 1; i >= 0; i--) {
      applicationMetadata ??= events[i].applicationMetadata;
      pageMetadata ??= events[i].pageMetadata;
      frameMetadata ??= events[i].frameMetadata;
    }

    // Deliberately NOT a natural-language string: this is read-only display
    // context for the AI Gen screen, never written into its instruction
    // textarea. See PreparedAIContext's doc comment above.
    setPreparedAIContext({
      sessionId: sessionId ?? '',
      targetUrl: url,
      preparedAt: Date.now(),
      applicationMetadata,
      pageMetadata,
      frameMetadata,
      optimizedStepCount: optimized.length,
      optimizedSummary: summarizeOptimizedActions(optimized)
    });
  }, [sessionId]);

  const prepareFrameworkForAIGeneration = useCallback((
    project: FrameworkProject,
    events: RecordedAction[],
    optimized: OptimizedAction[],
    url: string,
    projectId: string | null = null
  ) => {
    validationRunId.current += 1;
    setPreparedFrameworkContext({
      project,
      projectId,
      recordedActions: [...events],
      optimizedActions: [...optimized],
      targetUrl: url,
      sessionId: sessionId ?? '',
      preparedAt: Date.now()
    });
    // A freshly (re)generated framework starts a brand new accumulation --
    // its one test becomes entry 0, frozen from here on (see
    // frameworkAccumulator.ts's createAccumulatedFramework).
    setAccumulatedFramework(createAccumulatedFramework(project, url));
    setFrameworkProjectId(projectId);
    // Regenerating the framework invalidates any previous Validate Framework
    // result -- it was a check against a now-superseded FrameworkProject.
    setFrameworkValidationState(null);
    prepareForAIGeneration(events, url, optimized);
  }, [prepareForAIGeneration, sessionId]);

  /**
   * "Add to Suite": see RecordingContextType's doc comment. Merges
   * generatedProject into accumulatedFramework, updates
   * preparedFrameworkContext.project so the next AI Gen request matches
   * against the newly accumulated state, and re-runs Validate Framework
   * against the merged result -- requirement: validate the accumulated
   * framework after every merge. Deliberately does NOT bump preparedAt:
   * AIGeneratorView's own result-reset effect is keyed on preparedAt
   * specifically so a successful Add to Suite doesn't immediately wipe the
   * confirmation/result it just produced -- preparedAt only changes when a
   * NEW framework is generated from a (re)recording, not when the existing
   * one is merely extended.
   */
  const addGeneratedProjectToSuite = useCallback(async (
    generatedProject: FrameworkProject,
    instruction: string
  ): Promise<AccumulatedTestFile> => {
    if (!accumulatedFramework || !preparedFrameworkContext) {
      throw new Error('Generate a framework from the stopped recording before adding an AI-generated test to it.');
    }

    const merged = mergeIntoFramework(accumulatedFramework, generatedProject, instruction);
    const mergedProject = toFrameworkProject(merged);
    const savedProjectId = await saveFrameworkProject(
      mergedProject,
      undefined,
      undefined,
      preparedFrameworkContext.targetUrl
    );
    setAccumulatedFramework(merged);
    setPreparedFrameworkContext({
      ...preparedFrameworkContext,
      project: mergedProject,
      projectId: savedProjectId,
      recordedActions: merged.recordedActions,
      optimizedActions: merged.actions
    });

    const contentKey = frameworkContentKey(mergedProject.files);
    setFrameworkValidationState({ status: 'running', diagnostics: [], checkedAt: null, error: null, contentKey });
    const currentRunId = ++validationRunId.current;
    try {
      const result = await frameworkValidationService.validate(mergedProject.files);
      if (validationRunId.current !== currentRunId) return merged.tests[merged.tests.length - 1];
      setFrameworkValidationState({
        status: result.status === 'PASS' ? 'passed' : 'failed',
        diagnostics: result.diagnostics,
        checkedAt: result.checkedAt,
        error: null,
        contentKey
      });
    } catch (err: unknown) {
      if (validationRunId.current !== currentRunId) return merged.tests[merged.tests.length - 1];
      const message = err instanceof Error ? err.message : 'Failed to validate framework';
      setFrameworkValidationState({ status: 'failed', diagnostics: [], checkedAt: null, error: message, contentKey });
    }

    return merged.tests[merged.tests.length - 1];
  }, [accumulatedFramework, preparedFrameworkContext, saveFrameworkProject]);

  /**
   * "Validate Framework": runs the deterministic tsc --noEmit gate against
   * the currently prepared FrameworkProject. No-op if no framework has been
   * generated yet.
   */
  const runFrameworkValidation = useCallback(async () => {
    if (!preparedFrameworkContext) return;

    const contentKey = frameworkContentKey(preparedFrameworkContext.project.files);
    setFrameworkValidationState({ status: 'running', diagnostics: [], checkedAt: null, error: null, contentKey });
    const currentRunId = ++validationRunId.current;
    try {
      const result = await frameworkValidationService.validate(preparedFrameworkContext.project.files);
      if (validationRunId.current !== currentRunId) return;
      setFrameworkValidationState({
        status: result.status === 'PASS' ? 'passed' : 'failed',
        diagnostics: result.diagnostics,
        checkedAt: result.checkedAt,
        error: null,
        contentKey
      });
    } catch (err: unknown) {
      if (validationRunId.current !== currentRunId) return;
      const message = err instanceof Error ? err.message : 'Failed to validate framework';
      setFrameworkValidationState({ status: 'failed', diagnostics: [], checkedAt: null, error: message, contentKey });
    }
  }, [preparedFrameworkContext]);

  // AI Framework Review has no LLM integration yet (see FrameworkReviewState
  // doc comment) -- its status is always 'pending' for as long as a
  // framework exists, and automatically disappears/resets whenever
  // preparedFrameworkContext is cleared or regenerated, since it is derived
  // rather than separately stored.
  const frameworkReviewState: FrameworkReviewState | null = preparedFrameworkContext
    ? { status: 'pending' }
    : null;

  return (
    <RecordingContext.Provider
      value={{
        sessionId,
        status,
        sessionLifecycleStatus,
        recordedUrl,
        isStarting,
        isStopping,
        isLiveRecording,
        error,
        capturedEvents,
        lastGeneratedScript,
        preparedAIContext,
        preparedFrameworkContext,
        frameworkProjectId,
        savedFrameworkProjects,
        refreshFrameworkProjects,
        saveFrameworkProject,
        loadFrameworkProject,
        frameworkReviewState,
        frameworkValidationState,
        runFrameworkValidation,
        sessionStartedAt,
        elapsedSeconds,
        canStart,
        canStop,
        startRecording,
        stopRecording,
        clearSession,
        setSessionId,
        prepareForAIGeneration,
        prepareFrameworkForAIGeneration,
        addGeneratedProjectToSuite
      }}
    >
      {children}
    </RecordingContext.Provider>
  );
};

export const useRecording = (): RecordingContextType => {
  const context = useContext(RecordingContext);
  if (!context) {
    throw new Error('useRecording must be used within a RecordingProvider');
  }
  return context;
};
