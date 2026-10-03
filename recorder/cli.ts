#!/usr/bin/env node
import { recordingEngine } from './engine';
import { ApplicationMetadata, RecordedBrowserEvent } from './types';
import { PageMetadata } from './page-detector/types';
import { FrameMetadata } from './frame-detector/types';
import { IntentEntry, RecordedEvent } from './smart-recorder/types';
import * as readline from 'readline';
import type { StorageState } from 'playwright';

/**
 * Playwright Studio Recorder CLI
 * Executed as a child process via Spring Boot ProcessBuilder.
 *
 * Protocol: Newline-Delimited JSON (NDJSON) via stdout:
 * - {"type":"SESSION_STARTED","sessionId":"...","url":"..."}
 * - {"type":"APPLICATION_DETECTED","sessionId":"...","metadata":{...}}
 * - {"type":"PAGE_DETECTED","sessionId":"...","metadata":{...}}
 * - {"type":"FRAME_DETECTED","sessionId":"...","metadata":{...}}
 * - {"type":"EVENT","sessionId":"...","action":{...}}
 * - {"type":"EVENT_RECORDED","sessionId":"...","event":{...}}
 * - {"type":"NAVIGATION_RECORDED","sessionId":"...","event":{...}}
 * - {"type":"INTENT_CLASSIFIED","sessionId":"...","eventId":"...","intent":{...}}
 * - {"type":"SESSION_STOPPED","sessionId":"...","actionCount":N,"testScript":"..."}
 * - {"type":"INTENT_RESOLVED","sessionId":"...","requestId":"...","actions":[...],"unresolved":[...]}
 * - {"type":"INTENT_ERROR","sessionId":"...","requestId":"...","message":"..."}
 * - {"type":"ERROR","sessionId":"...","message":"..."}
 *
 * APPLICATION_DETECTED (Sprint 5 Phase 1), PAGE_DETECTED (Sprint 5 Phase 2),
 * FRAME_DETECTED (Sprint 5 Phase 3), EVENT_RECORDED/NAVIGATION_RECORDED/
 * INTENT_CLASSIFIED (Sprint 5.4 Smart Recorder), and INTENT_RESOLVED/
 * INTENT_ERROR (AI Gen) are purely additive — an unrecognized NDJSON `type`
 * is already safely ignored by the backend's existing switch/default
 * (RecordingService#handleProcessStdoutLine), so no backend change was
 * needed for any of them to be backward compatible on their own; wiring up
 * a *response* to RESOLVE_INTENT does need a backend change, since STOP is
 * currently the only correlated stdin command — see RecordingService's
 * sessionStartLatches for the pattern INTENT_RESOLVED/INTENT_ERROR mirrors.
 * EVENT (the pre-existing, Playwright-codeLine-carrying record) and
 * EVENT_RECORDED (the new, framework-agnostic RecordedEvent) both fire for
 * the same underlying interaction — separate, parallel streams, neither
 * replacing the other.
 *
 * Input Commands (via stdin):
 * - STOP: Gracefully stops recording, compiles script, and exits
 * - RESOLVE_INTENT <json>: Resolves one natural-language instruction (AI
 *   Gen) against the session's live page. <json> is a single-line
 *   {"requestId":"...","instruction":"..."} object; the response is
 *   emitted as INTENT_RESOLVED or INTENT_ERROR carrying the same
 *   requestId, so the backend can correlate it to the caller that asked.
 * - RESOLUTION_STORAGE_STATE <json>: one-time authentication state sent
 *   over stdin before a non-recording resolution browser is launched.
 */

interface CliArgs {
  targetUrl: string;
  sessionId?: string;
  headless: boolean;
  resolution: boolean;
  help: boolean;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let targetUrl = 'https://www.awwwards.com/websites/e-commerce/';
  let sessionId: string | undefined;
  let headless = false;
  let resolution = false;
  let help = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      help = true;
    } else if (arg === '--url' && args[i + 1]) {
      targetUrl = args[++i];
    } else if (arg === '--session' && args[i + 1]) {
      sessionId = args[++i];
    } else if (arg === '--headless') {
      headless = true;
    } else if (arg === '--resolution') {
      resolution = true;
    } else if (!arg.startsWith('--')) {
      if (!sessionId && targetUrl !== 'https://www.awwwards.com/websites/e-commerce/') {
        sessionId = arg;
      } else {
        targetUrl = arg;
      }
    }
  }

  return { targetUrl, sessionId, headless, resolution, help };
}

/**
 * Emits a single newline-delimited JSON (NDJSON) record to stdout
 */
function emitNDJSON(type: string, payload: Record<string, unknown>, onFlushed?: () => void) {
  const record = JSON.stringify({ type, ...payload });
  process.stdout.write(record + '\n', () => onFlushed?.());
}

async function main() {
  const { targetUrl, sessionId: requestedSessionId, headless, resolution, help } = parseArgs();

  if (help) {
    console.error('Usage: node recorder/dist/cli.js --url <targetUrl> --session <sessionId> [--headless]');
    process.exit(0);
  }

  // Diagnostic log to stderr (does not pollute stdout NDJSON protocol)
  console.error(`[Playwright CLI] Initializing visible Chromium recorder for: ${targetUrl}`);

  let activeSessionId: string | null = null;
  let isStopping = false;
  let isResolutionSession = false;
  let provideResolutionStorageState: ((state: StorageState) => void) | undefined;
  let rejectResolutionStorageState: ((error: Error) => void) | undefined;
  const resolutionStorageState = new Promise<StorageState>((resolve, reject) => {
    provideResolutionStorageState = resolve;
    rejectResolutionStorageState = reject;
  });

  const handleStop = async () => {
    if (isStopping) return;
    isStopping = true;
    let stoppedMessage: { type: string; payload: Record<string, unknown> } | undefined;

    try {
      if (activeSessionId) {
        if (isResolutionSession) {
          console.error(`[Playwright CLI] Closing resolution session ${activeSessionId}...`);
          await recordingEngine.closeResolutionSession(activeSessionId);
          stoppedMessage = {
            type: 'RESOLUTION_STOPPED',
            payload: { sessionId: activeSessionId }
          };
        } else {
          console.error(`[Playwright CLI] Stopping session ${activeSessionId}...`);
          const result = await recordingEngine.stopSession(activeSessionId);
          stoppedMessage = {
            type: 'SESSION_STOPPED',
            payload: {
              sessionId: activeSessionId,
              actionCount: result.totalEvents,
              testScript: result.testScript,
              storageState: result.storageState
            }
          };
        }
      }
    } catch (err: any) {
      console.error(`[Playwright CLI] Error during session stop: ${err?.message || err}`);
    } finally {
      if (stoppedMessage) {
        emitNDJSON(stoppedMessage.type, stoppedMessage.payload, () => process.exit(0));
      } else {
        process.exit(0);
      }
    }
  };

  // Listen to stdin for "STOP" command from Spring Boot ProcessBuilder
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false
  });

  rl.on('line', (line: string) => {
    const trimmed = line.trim();
    const upper = trimmed.toUpperCase();
    if (upper === 'STOP' || upper === 'QUIT' || upper === 'EXIT') {
      handleStop();
      return;
    }
    if (upper.startsWith('RESOLVE_INTENT ')) {
      handleResolveIntent(trimmed.slice('RESOLVE_INTENT '.length));
      return;
    }
    if (trimmed.startsWith('RESOLUTION_STORAGE_STATE ')) {
      try {
        const state = JSON.parse(trimmed.slice('RESOLUTION_STORAGE_STATE '.length)) as StorageState;
        if (!state || !Array.isArray(state.cookies) || !Array.isArray(state.origins)) {
          throw new Error('Resolution storage state must contain cookies and origins arrays.');
        }
        provideResolutionStorageState?.(state);
      } catch (error) {
        rejectResolutionStorageState?.(
          error instanceof Error ? error : new Error('Invalid resolution storage state.')
        );
      }
    }
  });

  const handleResolveIntent = async (rawPayload: string) => {
    let requestId: string | undefined;
    try {
      const parsed = JSON.parse(rawPayload) as { requestId?: string; instruction?: string };
      requestId = parsed.requestId;
      if (!requestId || !parsed.instruction) {
        throw new Error('RESOLVE_INTENT payload requires both "requestId" and "instruction".');
      }
      if (!activeSessionId) {
        throw new Error('No active recording session to resolve intent against.');
      }

      const result = await recordingEngine.resolveIntent(activeSessionId, parsed.instruction);
      emitNDJSON('INTENT_RESOLVED', {
        sessionId: activeSessionId,
        requestId,
        actions: result.actions,
        unresolved: result.unresolved
      });
    } catch (err: any) {
      emitNDJSON('INTENT_ERROR', {
        sessionId: activeSessionId,
        requestId: requestId ?? null,
        message: err?.message || 'Failed to resolve intent'
      });
    }
  };

  process.on('SIGINT', handleStop);
  process.on('SIGTERM', handleStop);

  if (resolution) {
    try {
      const storageState = await resolutionStorageState;
      activeSessionId = await recordingEngine.startResolutionSession(
        targetUrl,
        headless,
        requestedSessionId,
        storageState
      );
      isResolutionSession = true;
      emitNDJSON('RESOLUTION_STARTED', {
        sessionId: activeSessionId,
        url: targetUrl
      });
      console.error(`[Playwright CLI] Resolution browser active. Session ID: ${activeSessionId}`);
    } catch (error: any) {
      emitNDJSON('RESOLUTION_ERROR', {
        sessionId: requestedSessionId ?? null,
        message: error?.message || 'Failed to start resolution browser'
      });
      process.exit(1);
    }
    return;
  }

  try {
    // Declare before startSession so the onEvent callback can reference it
    // safely. startSession emits the initial navigation event synchronously
    // during the await, before it returns — a const declaration here would
    // trigger a Temporal Dead Zone ReferenceError.
    let resolvedSessionId: string = requestedSessionId || '';

    resolvedSessionId = await recordingEngine.startSession(
      targetUrl,
      headless,
      requestedSessionId,
      (event: RecordedBrowserEvent) => {
        // Stream every captured browser event immediately as NDJSON
        emitNDJSON('EVENT', {
          sessionId: resolvedSessionId,
          action: event
        });
      },
      () => {
        // Chromium window closed by user
        console.error(`[Playwright CLI] Browser window closed by user.`);
        handleStop();
      },
      (metadata: ApplicationMetadata) => {
        emitNDJSON('APPLICATION_DETECTED', {
          sessionId: resolvedSessionId,
          metadata
        });
      },
      (metadata: PageMetadata) => {
        emitNDJSON('PAGE_DETECTED', {
          sessionId: resolvedSessionId,
          metadata
        });
      },
      (metadata: FrameMetadata) => {
        emitNDJSON('FRAME_DETECTED', {
          sessionId: resolvedSessionId,
          metadata
        });
      },
      (event: RecordedEvent, intent: IntentEntry) => {
        emitNDJSON(event.type === 'navigation' ? 'NAVIGATION_RECORDED' : 'EVENT_RECORDED', {
          sessionId: resolvedSessionId,
          event
        });
        emitNDJSON('INTENT_CLASSIFIED', {
          sessionId: resolvedSessionId,
          eventId: event.id,
          intent
        });
      }
    );

    activeSessionId = resolvedSessionId;

    // Emit confirmation that session is live and visible Chromium has started
    emitNDJSON('SESSION_STARTED', {
      sessionId: resolvedSessionId,
      url: targetUrl
    });

    console.error(`[Playwright CLI] Recorder active and ready. Session ID: ${resolvedSessionId}`);
  } catch (error: any) {
    console.error('[Playwright CLI] Fatal error:', error);
    emitNDJSON('ERROR', {
      sessionId: requestedSessionId || null,
      message: error?.message || 'Failed to start Playwright browser recording session'
    });
    process.exit(1);
  }
}

main();
