# Playwright Studio AI - Recording Engine (Child Process)

This package contains the compiled Playwright recording engine designed to run as a child process under the Spring Boot backend (`http://localhost:8099`).

## Architecture & Production Execution Model

```
+------------------------------------+
|   Playwright Studio React Web UI   |
+------------------------------------+
                  |
                  |  HTTP REST
                  v
+------------------------------------+
|  Spring Boot Backend (Port 8099)   |
+------------------------------------+
                  |
                  |  ProcessBuilder:
                  |  node recorder/dist/cli.js --url <url> --session <id>
                  v
+------------------------------------+
|   Child Process: Node Recorder     |
|   (recorder/dist/cli.js)           |
|                                    |
|   - Headless: false (Chromium)     |
|   - Injected Locator Generator     |
|   - Stdout: NDJSON stream          |
|   - Stdin: 'STOP' command listener |
+------------------------------------+
```

## Compilation

The recorder is compiled from TypeScript into `recorder/dist/cli.js` using `npm run build` (or `npm run build:recorder`):

```bash
# Compiles both Vite web app and recorder/dist/cli.js
npm run build

# Or compile only the recorder:
npm run build:recorder
```

## Protocol (Newline-Delimited JSON / NDJSON)

All events and lifecycle notifications emitted to `stdout` are single-line JSON objects:

1. **Session Started**:
   ```json
   {"type":"SESSION_STARTED","sessionId":"rec_123","url":"https://example.com"}
   ```

2. **Event Captured**:
   ```json
   {"type":"EVENT","sessionId":"rec_123","action":{"id":"evt_1","type":"click","selector":"page.getByRole('button', { name: 'Submit' })","codeLine":"await page.getByRole('button', { name: 'Submit' }).click();","timestamp":"00:01.20"}}
   ```
   Events captured inside an iframe also include its `frameSelector`; generated
   locators are then scoped with `page.frameLocator(frameSelector)`.
   Scrolls are coalesced while the page is moving and recorded as a final
   scroll-position action for the page or the specific scrollable container.

3. **Session Stopped**:
   ```json
   {"type":"SESSION_STOPPED","sessionId":"rec_123","actionCount":5,"testScript":"import { test, expect } from '@playwright/test'; ..."}
   ```

4. **Error**:
   ```json
   {"type":"ERROR","sessionId":"rec_123","message":"Error description"}
   ```

To stop the session cleanly, Spring Boot writes `STOP\n` to the child process's `stdin`.
