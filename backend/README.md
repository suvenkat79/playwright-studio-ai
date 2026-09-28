# Playwright Studio AI - Spring Boot Backend (Port 8099)

This is the production Spring Boot backend service for **Playwright Studio AI**. It is the single backend service listening on `http://localhost:8099`.

## Architecture

```
React Frontend (Vite, port 3000)
    │
    │ HTTP REST (http://localhost:8099/api/record/*)
    ▼
Spring Boot Backend (Port 8099)
    │
    ├── SessionManager (Thread-safe ConcurrentHashMap<String, RecordingSession>)
    │   ├── Lifecycle tracking: RUNNING, STOPPED, FAILED
    │   └── Scheduled cleanup of completed / orphaned sessions
    │
    └── ProcessBuilder (launches node recorder/dist/cli.js)
        ▼
Child Process: Node Playwright CLI (`recorder/dist/cli.js`)
    │
    │ Launches visible Chromium window (headless: false)
    ▼
Target Web Application (e.g. https://www.awwwards.com/websites/e-commerce/)
```

## Prerequisites

1. **Java 17+** and **Maven 3.8+**
2. **Node.js 18+**
3. Chromium browser installed (via `npx playwright install chromium`)

## Quick Start

### 1. Compile the Node Recorder and Frontend
In the project root directory:
```bash
npm run build
```

### 2. Start the Spring Boot Backend (Port 8099)
From the `/backend` directory:
```bash
mvn clean spring-boot:run
```
Or build the JAR:
```bash
mvn clean package -DskipTests
java -jar target/playwright-studio-backend-1.0.0.jar
```

The service will start and listen on:
`http://localhost:8099`

---

## REST Endpoints

### 1. `POST /api/record/start`
Starts a recording session by launching `recorder/dist/cli.js` as a child process with a visible Chromium window.
- **Request Body**:
  ```json
  {
    "url": "https://www.awwwards.com/websites/e-commerce/"
  }
  ```
- **Response**:
  ```json
  {
    "status": "RECORDING_STARTED",
    "sessionId": "rec_1727421899123_8a9bc",
    "targetUrl": "https://www.awwwards.com/websites/e-commerce/"
  }
  ```

### 2. `GET /api/record/status?sessionId={sessionId}`
Returns session lifecycle status managed by `SessionManager`.
- **Response**:
  ```json
  {
    "sessionId": "rec_1727421899123_8a9bc",
    "status": "RUNNING",
    "isActive": true,
    "totalEvents": 4,
    "targetUrl": "https://www.awwwards.com/websites/e-commerce/",
    "startedAt": "2026-09-27T07:35:00Z",
    "failureReason": null
  }
  ```
- **Status values**: `RUNNING`, `STOPPED`, `FAILED`

### 3. `GET /api/record/events?sessionId={sessionId}`
Streams actions and locators captured in real-time from the visible Chromium window.
- **Response**:
  ```json
  {
    "sessionId": "rec_1727421899123_8a9bc",
    "isRecording": true,
    "totalEvents": 4,
    "events": [
      {
        "id": "evt_1",
        "type": "click",
        "selector": "getByRole('button', { name: 'Add to Cart' })",
        "timestamp": "00:04.12",
        "codeLine": "await page.getByRole('button', { name: 'Add to Cart' }).click();"
      }
    ]
  }
  ```

### 4. `POST /api/record/stop`
Sends a graceful `STOP` signal through the child process stdin, closes the Chromium window, and generates the final `@playwright/test` script.
- **Request Body**:
  ```json
  {
    "sessionId": "rec_1727421899123_8a9bc"
  }
  ```
- **Response**:
  ```json
  {
    "status": "RECORDING_STOPPED",
    "sessionId": "rec_1727421899123_8a9bc",
    "totalEvents": 4,
    "testScript": "import { test, expect } from '@playwright/test';..."
  }
  ```
