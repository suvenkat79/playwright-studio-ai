#!/usr/bin/env node
import { recordingEngine } from './engine';
import { RecordedBrowserEvent } from './types';
import * as readline from 'readline';

/**
 * Playwright Studio Recorder CLI
 * Executed as a child process via Spring Boot ProcessBuilder.
 *
 * Protocol: Newline-Delimited JSON (NDJSON) via stdout:
 * - {"type":"SESSION_STARTED","sessionId":"...","url":"..."}
 * - {"type":"EVENT","sessionId":"...","action":{...}}
 * - {"type":"SESSION_STOPPED","sessionId":"...","actionCount":N,"testScript":"..."}
 * - {"type":"ERROR","sessionId":"...","message":"..."}
 *
 * Input Commands (via stdin):
 * - STOP: Gracefully stops recording, compiles script, and exits
 */

interface CliArgs {
  targetUrl: string;
  sessionId?: string;
  headless: boolean;
  help: boolean;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let targetUrl = 'https://www.awwwards.com/websites/e-commerce/';
  let sessionId: string | undefined;
  let headless = false;
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
    } else if (!arg.startsWith('--')) {
      if (!sessionId && targetUrl !== 'https://www.awwwards.com/websites/e-commerce/') {
        sessionId = arg;
      } else {
        targetUrl = arg;
      }
    }
  }

  return { targetUrl, sessionId, headless, help };
}

/**
 * Emits a single newline-delimited JSON (NDJSON) record to stdout
 */
function emitNDJSON(type: string, payload: Record<string, unknown>) {
  const record = JSON.stringify({ type, ...payload });
  process.stdout.write(record + '\n');
}

async function main() {
  const { targetUrl, sessionId: requestedSessionId, headless, help } = parseArgs();

  if (help) {
    console.error('Usage: node recorder/dist/cli.js --url <targetUrl> --session <sessionId> [--headless]');
    process.exit(0);
  }

  // Diagnostic log to stderr (does not pollute stdout NDJSON protocol)
  console.error(`[Playwright CLI] Initializing visible Chromium recorder for: ${targetUrl}`);

  let activeSessionId: string | null = null;
  let isStopping = false;

  const handleStop = async () => {
    if (isStopping) return;
    isStopping = true;

    try {
      if (activeSessionId) {
        console.error(`[Playwright CLI] Stopping session ${activeSessionId}...`);
        const result = await recordingEngine.stopSession(activeSessionId);
        emitNDJSON('SESSION_STOPPED', {
          sessionId: activeSessionId,
          actionCount: result.totalEvents,
          testScript: result.testScript
        });
      }
    } catch (err: any) {
      console.error(`[Playwright CLI] Error during session stop: ${err?.message || err}`);
    } finally {
      process.exit(0);
    }
  };

  // Listen to stdin for "STOP" command from Spring Boot ProcessBuilder
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false
  });

  rl.on('line', (line: string) => {
    const trimmed = line.trim().toUpperCase();
    if (trimmed === 'STOP' || trimmed === 'QUIT' || trimmed === 'EXIT') {
      handleStop();
    }
  });

  // Handle OS process signals
  process.on('SIGINT', handleStop);
  process.on('SIGTERM', handleStop);

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
