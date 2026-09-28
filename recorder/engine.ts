import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { browserInjectionScript } from './locatorGenerator';
import { RecordedBrowserEvent, RecordingSession } from './types';

export class PlaywrightRecordingEngine {
  private sessions = new Map<string, RecordingSession>();

  /**
   * Starts a live browser recording session on the given URL
   * Launches visible Chromium browser (headless: false)
   */
  async startSession(
    targetUrl: string,
    headless = false,
    customSessionId?: string,
    onEvent?: (event: RecordedBrowserEvent) => void,
    onClose?: () => void
  ): Promise<string> {
    const sessionId = customSessionId || `rec_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const formattedUrl = targetUrl.startsWith('http://') || targetUrl.startsWith('https://')
      ? targetUrl
      : `https://${targetUrl}`;

    console.log(`[PlaywrightRecordingEngine] Launching visible Chromium for session: ${sessionId}`);
    console.log(`[PlaywrightRecordingEngine] Target URL: ${formattedUrl}`);

    // Launch visible browser
    const browser: Browser = await chromium.launch({
      headless: headless,
      args: [
        '--start-maximized',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled'
      ]
    });

    const context: BrowserContext = await browser.newContext({
      viewport: null, // Full screen in headed mode
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    });

    const page: Page = await context.newPage();

    const session: RecordingSession = {
      id: sessionId,
      targetUrl: formattedUrl,
      startTime: Date.now(),
      browser,
      context,
      page,
      events: [],
      isActive: true
    };

    this.sessions.set(sessionId, session);

    // Initial navigation event
    const initNavEvent: RecordedBrowserEvent = {
      id: 'nav_init',
      type: 'navigation',
      selector: 'page',
      url: formattedUrl,
      timestamp: '00:00.00',
      codeLine: `await page.goto('${formattedUrl}');`
    };
    session.events.push(initNavEvent);
    if (onEvent) {
      onEvent(initNavEvent);
    }

    // Expose binding to receive live DOM events from browser
    await page.exposeFunction('__playwrightStudioEmitEvent', (rawEvent: {
      type: 'click' | 'fill' | 'select' | 'assert' | 'press';
      selector: string;
      value?: string;
      codeLine: string;
      url: string;
    }) => {
      const elapsedSeconds = ((Date.now() - session.startTime) / 1000).toFixed(2);
      const minutes = Math.floor(Number(elapsedSeconds) / 60);
      const seconds = (Number(elapsedSeconds) % 60).toFixed(2);
      const timestamp = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(5, '0')}`;

      const event: RecordedBrowserEvent = {
        id: `evt_${Date.now()}_${session.events.length + 1}`,
        type: rawEvent.type,
        selector: rawEvent.selector,
        value: rawEvent.value,
        timestamp,
        codeLine: rawEvent.codeLine,
        url: rawEvent.url
      };

      session.events.push(event);
      if (onEvent) {
        onEvent(event);
      }
      console.log(`[Session ${sessionId}] Captured [${event.type}]: ${event.codeLine}`);
    });

    // Inject locator generator & event interceptors on every navigation
    await page.addInitScript(browserInjectionScript);

    // Listen for subsequent page navigations
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame() && frame.url() !== formattedUrl && !frame.url().startsWith('about:')) {
        const elapsedSeconds = ((Date.now() - session.startTime) / 1000).toFixed(2);
        const minutes = Math.floor(Number(elapsedSeconds) / 60);
        const seconds = (Number(elapsedSeconds) % 60).toFixed(2);
        const timestamp = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(5, '0')}`;

        const navEvent: RecordedBrowserEvent = {
          id: `evt_nav_${Date.now()}`,
          type: 'navigation',
          selector: 'page',
          url: frame.url(),
          timestamp,
          codeLine: `await page.waitForURL('${frame.url()}');`
        };

        session.events.push(navEvent);
        if (onEvent) {
          onEvent(navEvent);
        }
        console.log(`[Session ${sessionId}] Navigated to: ${frame.url()}`);
      }
    });

    // Handle browser closure
    page.on('close', () => {
      console.log(`[Session ${sessionId}] Browser page closed by user`);
      session.isActive = false;
      if (onClose) {
        onClose();
      }
    });

    // Navigate to initial target URL
    try {
      await page.goto(formattedUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    } catch (e: any) {
      console.warn(`[Session ${sessionId}] Initial navigation notice: ${e.message}`);
    }

    return sessionId;
  }

  /**
   * Retrieves events recorded so far for an active session
   */
  getEvents(sessionId: string): RecordedBrowserEvent[] {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return [];
    }
    return [...session.events];
  }

  /**
   * Checks if session is active
   */
  isSessionActive(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    return session ? session.isActive : false;
  }

  /**
   * Stops recording session and closes Chromium browser
   */
  async stopSession(sessionId: string): Promise<{ testScript: string; totalEvents: number }> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    session.isActive = false;

    try {
      if (session.browser) {
        await session.browser.close();
      }
    } catch (err: any) {
      console.warn(`[Session ${sessionId}] Error closing browser:`, err.message);
    }

    const testScript = this.generatePlaywrightSpec(session);
    return {
      testScript,
      totalEvents: session.events.length
    };
  }

  /**
   * Generates production Playwright test spec from recorded actions
   */
  generatePlaywrightSpec(session: RecordingSession): string {
    const actionsCode = session.events.map((e) => `  ${e.codeLine}`).join('\n');

    return `import { test, expect } from '@playwright/test';

test.describe('Recorded User Journey: ${session.targetUrl}', () => {
  test('Execute recorded actions', async ({ page }) => {
    // Session: ${session.id}
    // Recorded on: ${new Date(session.startTime).toISOString()}
    
${actionsCode || "    // No actions were recorded."}

    // Post-execution assertion
    await expect(page).toHaveURL(/.+/);
  });
});
`;
  }
}

export const recordingEngine = new PlaywrightRecordingEngine();
