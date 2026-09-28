import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { recordService } from '../services/recordService';
import { optimizeRecordedActions, summarizeOptimizedActions } from '../services/optimizerService';
import { StartRecordingResponse, StopRecordingResponse, RecordedAction, SessionLifecycleStatus } from '../types';

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
  aiPromptPrefill: string | null;
  sessionStartedAt: number | null;
  elapsedSeconds: number;
  // Derived action-bar state (single source of truth — do not re-derive
  // these independently in components):
  // IDLE (sessionId == null or STOPPED): canStart=true, canStop=false
  // RUNNING: canStart=false, canStop=true
  // FAILED: canStart=true, canStop=false
  canStart: boolean;
  canStop: boolean;
  startRecording: (targetUrl: string) => Promise<StartRecordingResponse>;
  stopRecording: () => Promise<StopRecordingResponse | null>;
  clearSession: () => void;
  setSessionId: (id: string | null) => void;
  prepareForAIGeneration: (events: RecordedAction[], url: string) => void;
}

const RecordingContext = createContext<RecordingContextType | undefined>(undefined);

export const RecordingProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [sessionLifecycleStatus, setSessionLifecycleStatus] = useState<SessionLifecycleStatus | null>(null);
  const [recordedUrl, setRecordedUrl] = useState<string>('https://www.awwwards.com/websites/e-commerce/');
  const [isStarting, setIsStarting] = useState<boolean>(false);
  const [isStopping, setIsStopping] = useState<boolean>(false);
  const [isLiveRecording, setIsLiveRecording] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [capturedEvents, setCapturedEvents] = useState<RecordedAction[]>([]);
  const [lastGeneratedScript, setLastGeneratedScript] = useState<string | null>(null);
  const [aiPromptPrefill, setAiPromptPrefill] = useState<string | null>(null);
  const [sessionStartedAt, setSessionStartedAt] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);

  // Poll live events every 500ms while a real session is active.
  // Stops automatically when the backend reports the session is no longer
  // RUNNING (STOPPED/FAILED) or when this effect is torn down (unmount).
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

        if (!data.isRecording) {
          // Confirm the exact lifecycle status (STOPPED vs FAILED) via the
          // dedicated status endpoint before halting the poll.
          try {
            const statusData = await recordService.getStatus(sessionId);
            if (!cancelled) {
              setSessionLifecycleStatus(statusData.status);
              if (statusData.status === 'FAILED') {
                setError(statusData.failureReason || 'Recording session failed');
              }
            }
          } catch (statusErr) {
            console.debug('[RecordingContext] Status check debug:', statusErr);
          }
          if (!cancelled) {
            setIsLiveRecording(false);
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
  }, [sessionId, isLiveRecording]);

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
  const canStart = !isStarting && !isLiveRecording;
  const canStop = isLiveRecording && !isStopping;

  const startRecording = async (targetUrl: string): Promise<StartRecordingResponse> => {
    // Guard against duplicate calls even if a caller bypasses the disabled
    // button state (e.g. a race between click and re-render).
    if (isStarting || isLiveRecording) {
      throw new Error('A recording session is already starting or in progress.');
    }

    setIsStarting(true);
    setError(null);
    setCapturedEvents([]);
    setSessionLifecycleStatus(null);
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
    try {
      const response = await recordService.stopRecording(sessionId);
      setIsLiveRecording(false);
      setSessionLifecycleStatus('STOPPED');
      if (response.testScript) {
        setLastGeneratedScript(response.testScript);
      }
      return response;
    } catch (err: unknown) {
      console.warn('Failed to stop recording cleanly on backend:', err);
      setIsLiveRecording(false);
      setSessionLifecycleStatus('STOPPED');
      return null;
    } finally {
      setIsStopping(false);
    }
  };

  const clearSession = () => {
    setSessionId(null);
    setStatus(null);
    setSessionLifecycleStatus(null);
    setIsLiveRecording(false);
    setError(null);
    setCapturedEvents([]);
    setLastGeneratedScript(null);
    setSessionStartedAt(null);
    setElapsedSeconds(0);
  };

  const prepareForAIGeneration = useCallback((events: RecordedAction[], url: string) => {
    // Run the raw captured events through the deterministic AI Optimizer
    // Engine (merge sequential fills, dedupe clicks, collapse navigations,
    // annotate locator quality) before handing them to the AI Gen screen.
    const optimized = optimizeRecordedActions(events);
    const formattedEvents = summarizeOptimizedActions(optimized);

    const promptText = `Generate a robust Page Object Model and enterprise test spec based on this recorded browser session on ${url}:\n\nOptimized User Journey (${optimized.length} steps after deterministic dedup/merge):\n${formattedEvents}\n\nPlease generate:\n1. Dedicated Page Object class with clean getters and action methods\n2. Spec file with parameterized assertions, auto-waiting locators, and resilient error recovery.`;

    setAiPromptPrefill(promptText);
  }, []);

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
        aiPromptPrefill,
        sessionStartedAt,
        elapsedSeconds,
        canStart,
        canStop,
        startRecording,
        stopRecording,
        clearSession,
        setSessionId,
        prepareForAIGeneration
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
