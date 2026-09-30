import { chromium, Browser, BrowserContext, Frame, Page } from 'playwright';
import { browserInjectionScript } from './locatorGenerator';
import { ApplicationDetector, ApplicationMetadata, BrowserFacts, RecordedBrowserEvent, RecordingSession } from './types';
import { extractBrowserFacts } from './browserFacts';
import { ServiceNowProvider } from './providers/ServiceNowProvider';
import { GenericWebProvider } from './providers/GenericWebProvider';
import { detectPage } from './page-detector/engine';
import { PageMetadata } from './page-detector/types';
import { detectFrame } from './frame-detector/engine';
import { FrameMetadata } from './frame-detector/types';
import { SmartRecorderEngine } from './smart-recorder/engine';
import { DetectionContext, IntentEntry, RawLocatorFact, RecordedEvent, RecordedEventType } from './smart-recorder/types';

/**
 * Registered application-detection providers, most-specific first.
 * GenericWebProvider always matches, so it stays last. Phase 2 adds
 * SAPFioriProvider, SalesforceLightningProvider, AmazonProvider — each its
 * own file under providers/ — and slots in here; nothing else in this file
 * needs to change to add one.
 */
const APPLICATION_PROVIDERS: ApplicationDetector[] = [
  new ServiceNowProvider(),
  new GenericWebProvider()
];

/** True when `b` represents no meaningful change from `a` — compares only
 * the identity fields (pageType/module/entity), not confidence/signals,
 * which can legitimately fluctuate without the page itself having changed.
 * `a` undefined (nothing detected yet) always counts as a change. */
function pageMetadataChanged(a: PageMetadata | undefined, b: PageMetadata): boolean {
  return !a || a.pageType !== b.pageType || a.module !== b.module || a.entity !== b.entity;
}

/** Same idea as pageMetadataChanged, for FrameMetadata's identity fields
 * (frameType/frameSelector/framePath), not confidence/signals. */
function frameMetadataChanged(a: FrameMetadata | undefined, b: FrameMetadata): boolean {
  if (!a) return true;
  if (a.frameType !== b.frameType || a.frameSelector !== b.frameSelector) return true;
  if (a.framePath.length !== b.framePath.length) return true;
  return a.framePath.some((selector, i) => selector !== b.framePath[i]);
}

/** Single-line, human-readable log for a Smart Recorder RecordedEvent +
 * its classified intent (Sprint 5.4) — one shared formatter so every
 * capture point (interaction/navigation/dialog/download) logs
 * consistently. */
function describeRecordedEvent(event: RecordedEvent, intent: IntentEntry): string {
  const subject = event.navigation
    ? `${event.navigation.fromUrl} → ${event.navigation.toUrl} (trigger: ${event.navigation.trigger})`
    : event.locator.text || event.locator.label || event.locator.placeholder || event.locator.id || event.locator.testId || event.value || '(no target)';
  return `[${event.type}] ${subject} — page: ${event.page.pageType}, frame: ${event.frame.frameType}, intent: ${intent.intent} (${intent.confidence})`;
}

function navigationWaitCode(url: string): string {
  try {
    const { pathname } = new URL(url);
    const segments = pathname.split('/').filter(Boolean);
    const lastSegment = segments[segments.length - 1];
    const fragment = lastSegment?.replace(/\.[a-zA-Z0-9]+$/, '');

    if (fragment) {
      const expectedSegment = JSON.stringify(fragment);
      return `await page.waitForURL(url => url.pathname.split('/').some(segment => segment === ${expectedSegment} || segment.replace(/\\.[a-zA-Z0-9]+$/, '') === ${expectedSegment}));`;
    }

    return `await page.waitForURL(url => url.pathname === ${JSON.stringify(pathname)});`;
  } catch {
    return `await page.waitForURL(${JSON.stringify(url)});`;
  }
}

async function getFrameSelector(frame: Frame): Promise<string | undefined> {
  if (frame === frame.page().mainFrame()) return undefined;

  const frameElement = await frame.frameElement();
  return frameElement.evaluate((element) => {
    if (!(element instanceof Element)) return undefined;
    const doc = element.ownerDocument;
    const tag = element.tagName.toLowerCase();
    if (element.id) return `#${CSS.escape(element.id)}`;

    for (const attr of ['title', 'name', 'aria-label', 'data-testid']) {
      const value = element.getAttribute(attr);
      if (!value) continue;
      const selector = `${tag}[${attr}=${CSS.escape(value)}]`;
      if (doc.querySelectorAll(selector).length === 1) return selector;
    }

    const path: string[] = [];
    let current: Element | null = element;
    while (current && current !== doc.documentElement) {
      const currentElement: Element = current;
      let segment = currentElement.tagName.toLowerCase();
      if (currentElement.id) {
        path.unshift(`#${CSS.escape(currentElement.id)}`);
        break;
      }

      const parentElement: Element | null = currentElement.parentElement;
      if (parentElement) {
        const sameTagSiblings = Array.from(parentElement.children)
          .filter((sibling: Element) => sibling.tagName === currentElement.tagName);
        segment += `:nth-of-type(${sameTagSiblings.indexOf(currentElement) + 1})`;
      }
      path.unshift(segment);

      const selector = path.join(' > ');
      if (doc.querySelectorAll(selector).length === 1) return selector;
      current = parentElement;
    }

    return path.join(' > ');
  });
}

function frameAwareCodeLine(codeLine: string, frameSelector?: string, type?: RecordedBrowserEvent['type']): string {
  if (!frameSelector || type === 'press') return codeLine;

  const frameLocator = `page.frameLocator(${JSON.stringify(frameSelector)})`;
  if (codeLine.startsWith(`await ${frameLocator}.`)) return codeLine;
  return codeLine.replace(/^(\s*await )page\./, (_match, prefix: string) => `${prefix}${frameLocator}.`);
}

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
    onClose?: () => void,
    onApplicationDetected?: (metadata: ApplicationMetadata) => void,
    onPageDetected?: (metadata: PageMetadata) => void,
    onFrameDetected?: (metadata: FrameMetadata) => void,
    onEventRecorded?: (event: RecordedEvent, intent: IntentEntry) => void
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

    // Assigns each Page object in this context a stable, open-order index
    // (0 = the original tab) so every emitted event can be stamped with
    // which tab it actually happened in — see RecordedBrowserEvent.tabIndex.
    const pageIndices = new Map<Page, number>();
    pageIndices.set(page, 0);

    const session: RecordingSession = {
      id: sessionId,
      targetUrl: formattedUrl,
      startTime: Date.now(),
      browser,
      context,
      page,
      events: [],
      isActive: true,
      applicationMetadataHistory: [],
      pageMetadataHistory: [],
      frameMetadataHistory: [],
      recordedEvents: [],
      intentTimeline: [],
      smartRecorder: new SmartRecorderEngine()
    };

    this.sessions.set(sessionId, session);

    // Initial navigation event
    const initNavEvent: RecordedBrowserEvent = {
      id: 'nav_init',
      type: 'navigation',
      selector: 'page',
      url: formattedUrl,
      timestamp: '00:00.00',
      codeLine: `await page.goto('${formattedUrl}');`,
      tabIndex: 0
    };
    session.events.push(initNavEvent);
    if (onEvent) {
      onEvent(initNavEvent);
    }

    // Expose binding to receive live DOM events from browser. Registered on
    // the *context*, not the page: Playwright applies a context-level
    // exposeBinding to every page in the context, including ones opened
    // later (a target="_blank" link, window.open()) — a page-level one
    // only ever covered the single page it was called on. Found live: a
    // real Amazon sponsored-product link opens its target page in a brand
    // new tab, and every interaction after that click was silently
    // uncaptured, because nothing was listening on that tab at all.
    await context.exposeBinding('__playwrightStudioEmitEvent', async ({ frame }, rawEvent: {
      type: 'click' | 'fill' | 'select' | 'assert' | 'press' | 'check' | 'upload' | 'scroll';
      selector: string;
      value?: string;
      codeLine: string;
      url: string;
      frameSelector?: string;
      isSensitive?: boolean;
      variableName?: string;
      strategy?: 'testid' | 'role' | 'label' | 'placeholder' | 'id' | 'text' | 'css';
      tag?: string;
      role?: string;
      text?: string;
      label?: string;
      placeholder?: string;
      testId?: string;
      id?: string;
      cssSelector?: string;
      identitySelector?: string;
    }) => {
      let frameSelector = rawEvent.frameSelector;
      if (!frameSelector && frame !== frame.page().mainFrame()) {
        frameSelector = await getFrameSelector(frame);
      }

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
        codeLine: frameAwareCodeLine(rawEvent.codeLine, frameSelector, rawEvent.type),
        url: rawEvent.url,
        frameSelector,
        isSensitive: rawEvent.isSensitive,
        variableName: rawEvent.variableName,
        identitySelector: rawEvent.identitySelector,
        tabIndex: pageIndices.get(frame.page()) ?? 0
      };

      session.events.push(event);
      if (onEvent) {
        onEvent(event);
      }
      console.log(`[Session ${sessionId}] Captured [${event.type}]: ${event.codeLine}`);

      // Smart Recorder (Sprint 5.4) — parallel, additive: records the same
      // interaction as an immutable, framework-agnostic RecordedEvent,
      // stamped with the session's current Context Engine metadata. Never
      // touches session.events/codeLine above. Skipped if initial
      // detection hasn't completed yet (shouldn't happen for a real user
      // interaction, but defensive: there is no meaningful
      // ApplicationMetadata/PageMetadata/FrameMetadata to stamp an event
      // with before then).
      const context = this.getDetectionContext(session);
      if (context && rawEvent.type !== 'assert') {
        const raw: RawLocatorFact = {
          strategy: rawEvent.strategy || 'css',
          tag: rawEvent.tag || '',
          role: rawEvent.role,
          text: rawEvent.text,
          label: rawEvent.label,
          placeholder: rawEvent.placeholder,
          testId: rawEvent.testId,
          id: rawEvent.id,
          cssSelector: rawEvent.cssSelector
        };
        const { event: smartEvent, intent } = session.smartRecorder.recordInteraction(
          rawEvent.type as Exclude<RecordedEventType, 'navigation' | 'dialog' | 'download'>,
          raw,
          frameSelector,
          rawEvent.value,
          context
        );
        session.recordedEvents.push(smartEvent);
        session.intentTimeline.push(intent);
        console.log(`[Session ${sessionId}] Event recorded: ${describeRecordedEvent(smartEvent, intent)}`);
        if (onEventRecorded) {
          onEventRecorded(smartEvent, intent);
        }
      }
    });

    // Inject locator generator & event interceptors on every navigation, in
    // every page the context ever opens (see exposeBinding note above for
    // why context-level, not page-level).
    await context.addInitScript(browserInjectionScript);

    // Every tab/popup the context opens — the original page and any later
    // one from a target="_blank" link or window.open() — gets the same
    // navigation/dialog/download/close capture wired up via this one
    // shared setup, so a flow that continues in a new tab is no longer
    // silently invisible to the recorder.
    this.attachPageListeners(session, sessionId, page, formattedUrl, 0, onEvent, onClose, onPageDetected, onFrameDetected, onEventRecorded);
    context.on('page', (newPage) => {
      const tabIndex = pageIndices.size;
      pageIndices.set(newPage, tabIndex);
      console.log(`[Session ${sessionId}] New tab/popup opened (tabIndex ${tabIndex}): ${newPage.url()}`);
      this.attachPageListeners(session, sessionId, newPage, newPage.url(), tabIndex, onEvent, onClose, onPageDetected, onFrameDetected, onEventRecorded);
    });

    // Navigate to initial target URL
    try {
      await page.goto(formattedUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    } catch (e: any) {
      console.warn(`[Session ${sessionId}] Initial navigation notice: ${e.message}`);
    }

    // Application + page + frame detection — immediately after initial
    // page load. The single page.evaluate() boundary (extractBrowserFacts)
    // runs once here and the resulting BrowserFacts feeds detectApplication
    // (Sprint 5 Phase 1), detectPage (Sprint 5 Phase 2), and detectFrame
    // (Sprint 5 Phase 3). ApplicationDetector runs exactly this one time
    // for the whole session (Sprint 5 Phase 3 lifecycle patch); Page/Frame
    // detection re-runs later via the navigation listeners above, through
    // runPageAndFrameDetection, which is also used here to keep the
    // change-detection/history/emit logic in exactly one place. Best-effort:
    // a detection failure (e.g. the page navigated away again before
    // evaluate() could run) never aborts the recording session itself, it
    // just leaves applicationMetadata/pageMetadata/frameMetadata unset.
    try {
      const facts = await extractBrowserFacts(page);

      const metadata = await this.detectApplication(facts);
      session.applicationMetadata = metadata;
      session.applicationMetadataHistory = Object.freeze([metadata]);
      console.log(
        `[Session ${sessionId}] Application detected: ${metadata.application}` +
        (metadata.ui ? ` (${metadata.ui})` : '') +
        ` — confidence ${metadata.confidence}` +
        (metadata.instance ? `, instance "${metadata.instance}"` : '')
      );
      if (onApplicationDetected) {
        onApplicationDetected(metadata);
      }

      await this.runPageAndFrameDetection(session, sessionId, facts, metadata, onPageDetected, onFrameDetected);
    } catch (e: any) {
      console.warn(`[Session ${sessionId}] Application/page/frame detection notice: ${e.message}`);
    }

    return sessionId;
  }

  /**
   * Smart Recorder (Sprint 5.4): the DetectionContext an event should be
   * stamped with right now — the session's current applicationMetadata/
   * pageMetadata/frameMetadata as-is. Returns undefined until initial
   * detection has completed, since there is no honest context to stamp an
   * event with before then.
   */
  private getDetectionContext(session: RecordingSession): DetectionContext | undefined {
    if (!session.applicationMetadata || !session.pageMetadata || !session.frameMetadata) return undefined;
    return { application: session.applicationMetadata, page: session.pageMetadata, frame: session.frameMetadata };
  }

  /**
   * Returns every RecordedEvent captured so far for a session (Sprint 5.4
   * Smart Recorder) — immutable facts, never Playwright/framework code.
   */
  getRecordedEvents(sessionId: string): readonly RecordedEvent[] {
    return [...(this.sessions.get(sessionId)?.recordedEvents ?? [])];
  }

  /** Business-intent classification for every RecordedEvent, same order. */
  getIntentTimeline(sessionId: string): readonly IntentEntry[] {
    return [...(this.sessions.get(sessionId)?.intentTimeline ?? [])];
  }

  /**
   * Full Smart Recorder export for a session: every RecordedEvent plus its
   * classified intent, in capture order. Still just facts — no Playwright
   * code is generated here; that's a future sprint's Framework Generator.
   */
  exportEvents(sessionId: string): { recordedEvents: readonly RecordedEvent[]; intentTimeline: readonly IntentEntry[] } {
    const session = this.sessions.get(sessionId);
    return {
      recordedEvents: [...(session?.recordedEvents ?? [])],
      intentTimeline: [...(session?.intentTimeline ?? [])]
    };
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
   * Returns the ApplicationMetadata captured for a session immediately
   * after its initial page load, if detection has completed.
   */
  getApplicationMetadata(sessionId: string): ApplicationMetadata | undefined {
    return this.sessions.get(sessionId)?.applicationMetadata;
  }

  /** Immutable history of applicationMetadata (length 0 or 1 — runs once). */
  getApplicationMetadataHistory(sessionId: string): readonly ApplicationMetadata[] {
    return this.sessions.get(sessionId)?.applicationMetadataHistory ?? [];
  }

  /**
   * Returns the latest PageMetadata for a session, re-evaluated on every
   * successful navigation (Sprint 5 Phase 3 lifecycle patch).
   */
  getPageMetadata(sessionId: string): PageMetadata | undefined {
    return this.sessions.get(sessionId)?.pageMetadata;
  }

  /** Immutable history of every distinct PageMetadata this session produced. */
  getPageMetadataHistory(sessionId: string): readonly PageMetadata[] {
    return this.sessions.get(sessionId)?.pageMetadataHistory ?? [];
  }

  /**
   * Returns the latest FrameMetadata for a session, re-evaluated whenever
   * PageDetector runs or the active frame changes (Sprint 5 Phase 3
   * lifecycle patch).
   */
  getFrameMetadata(sessionId: string): FrameMetadata | undefined {
    return this.sessions.get(sessionId)?.frameMetadata;
  }

  /** Immutable history of every distinct FrameMetadata this session produced. */
  getFrameMetadataHistory(sessionId: string): readonly FrameMetadata[] {
    return this.sessions.get(sessionId)?.frameMetadataHistory ?? [];
  }

  /**
   * Application-detection orchestration (Sprint 5 Phase 1): every
   * registered provider scores the already-extracted facts — pure, no DOM
   * access — and the highest-confidence verdict wins. GenericWebProvider
   * always matches, so this never returns "nothing detected." The result
   * is frozen for genuine runtime immutability, not just compile-time
   * `readonly`.
   */
  private async detectApplication(facts: BrowserFacts): Promise<ApplicationMetadata> {
    let best: ApplicationMetadata | null = null;
    for (const provider of APPLICATION_PROVIDERS) {
      const result = provider.detect(facts);
      if (result && (!best || result.confidence > best.confidence)) {
        best = result;
      }
    }

    return Object.freeze(best ?? { application: 'Generic Web', confidence: 0, signals: [] });
  }

  /**
   * Page + frame detection (Sprint 5 Phase 3 lifecycle patch). Called once
   * from startSession right after the initial page load, and again from
   * handleFrameNavigated on every subsequent main-frame navigation.
   * detectPage/detectFrame themselves are unchanged (never redesigned) —
   * this only adds change-detection so pageMetadata/frameMetadata (and the
   * PAGE_DETECTED/FRAME_DETECTED callbacks) only update when the verdict
   * actually differs, plus appending to the immutable history arrays.
   */
  private async runPageAndFrameDetection(
    session: RecordingSession,
    sessionId: string,
    facts: BrowserFacts,
    application: ApplicationMetadata,
    onPageDetected?: (metadata: PageMetadata) => void,
    onFrameDetected?: (metadata: FrameMetadata) => void
  ): Promise<void> {
    const pageMetadata = detectPage(facts, application);
    if (pageMetadataChanged(session.pageMetadata, pageMetadata)) {
      session.pageMetadata = pageMetadata;
      session.pageMetadataHistory = Object.freeze([...session.pageMetadataHistory, pageMetadata]);
      console.log(
        `[Session ${sessionId}] Page detected: ${pageMetadata.pageType}` +
        (pageMetadata.module ? ` (module: ${pageMetadata.module})` : '') +
        ` — confidence ${pageMetadata.confidence}`
      );
      if (onPageDetected) {
        onPageDetected(pageMetadata);
      }
    }

    const frameMetadata = detectFrame(facts, application, session.pageMetadata!);
    if (frameMetadataChanged(session.frameMetadata, frameMetadata)) {
      session.frameMetadata = frameMetadata;
      session.frameMetadataHistory = Object.freeze([...session.frameMetadataHistory, frameMetadata]);
      console.log(
        `[Session ${sessionId}] Frame detected: ${frameMetadata.frameType}` +
        (frameMetadata.frameSelector ? ` (${frameMetadata.frameSelector})` : '') +
        ` — confidence ${frameMetadata.confidence}`
      );
      if (onFrameDetected) {
        onFrameDetected(frameMetadata);
      }
    }
  }

  /**
   * Frame-only re-detection (Sprint 5 Phase 3 lifecycle patch), for when a
   * non-main frame navigates on its own — "the active frame changes"
   * without a page-level navigation having happened, so PageDetector does
   * not re-run, only FrameDetector does.
   */
  private runFrameDetectionOnly(
    session: RecordingSession,
    sessionId: string,
    facts: BrowserFacts,
    application: ApplicationMetadata,
    onFrameDetected?: (metadata: FrameMetadata) => void
  ): void {
    if (!session.pageMetadata) return; // initial detection hasn't completed yet — nothing to re-check against

    const frameMetadata = detectFrame(facts, application, session.pageMetadata);
    if (frameMetadataChanged(session.frameMetadata, frameMetadata)) {
      session.frameMetadata = frameMetadata;
      session.frameMetadataHistory = Object.freeze([...session.frameMetadataHistory, frameMetadata]);
      console.log(
        `[Session ${sessionId}] Frame detected (sub-frame navigation): ${frameMetadata.frameType}` +
        (frameMetadata.frameSelector ? ` (${frameMetadata.frameSelector})` : '') +
        ` — confidence ${frameMetadata.confidence}`
      );
      if (onFrameDetected) {
        onFrameDetected(frameMetadata);
      }
    }
  }

  /**
   * Wires up navigation-tracking, Context Engine re-detection, dialog,
   * download, and close capture for one page — the original tab, or any
   * later tab/popup the browser context opens. Extracted from what used to
   * be inline-only logic for the single original page, so every page gets
   * identical treatment: a flow that continues in a new tab (a
   * target="_blank" link, window.open()) is captured exactly as
   * completely as one that stays in the original tab. `lastKnownUrl` is
   * scoped to this one page's own closure, not shared across pages, so
   * each tab's Smart Recorder navigation history (fromUrl/toUrl) reflects
   * only its own navigations.
   */
  private attachPageListeners(
    session: RecordingSession,
    sessionId: string,
    page: Page,
    initialUrl: string,
    tabIndex: number,
    onEvent?: (event: RecordedBrowserEvent) => void,
    onClose?: () => void,
    onPageDetected?: (metadata: PageMetadata) => void,
    onFrameDetected?: (metadata: FrameMetadata) => void,
    onEventRecorded?: (event: RecordedEvent, intent: IntentEntry) => void
  ): void {
    let lastKnownUrl = initialUrl; // Sprint 5.4: fromUrl for Smart Recorder navigation tracking

    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame() && frame.url() !== initialUrl && !frame.url().startsWith('about:')) {
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
          codeLine: navigationWaitCode(frame.url()),
          tabIndex
        };

        session.events.push(navEvent);
        if (onEvent) {
          onEvent(navEvent);
        }
        console.log(`[Session ${sessionId}] Navigated to: ${frame.url()}`);

        // Smart Recorder (Sprint 5.4) — captured at the moment the
        // navigation is observed, per "do not infer later". Uses the
        // Context Engine metadata as it stood just before this navigation
        // (the re-detection triggered by this same 'framenavigated' event,
        // below, hasn't run yet at this point in the listener order).
        const context = this.getDetectionContext(session);
        if (context) {
          const { event: navigationEvent, intent } = session.smartRecorder.recordNavigation(lastKnownUrl, frame.url(), context);
          session.recordedEvents.push(navigationEvent);
          session.intentTimeline.push(intent);
          console.log(`[Session ${sessionId}] Event recorded: ${describeRecordedEvent(navigationEvent, intent)}`);
          if (onEventRecorded) {
            onEventRecorded(navigationEvent, intent);
          }
        }
        lastKnownUrl = frame.url();
      }
    });

    // Page/Frame re-detection lifecycle (Sprint 5 Phase 3 lifecycle patch).
    // Separate listeners from the event-capture one above — deliberately
    // not merged into it, so the existing recording/codegen path is
    // untouched. ApplicationDetector never re-runs (ApplicationMetadata is
    // captured once, in startSession, and reused as-is here). PageDetector
    // re-runs on every successful main-frame navigation (URL change, frame
    // navigation, or document load — 'framenavigated' and 'load' together
    // cover all three; re-detection is idempotent since it only emits/
    // records on an actual change, so both listeners firing for the same
    // navigation is harmless). FrameDetector re-runs whenever PageDetector
    // runs, or on its own when a non-main frame navigates.
    page.on('framenavigated', (frame) => {
      if (frame.url().startsWith('about:')) return;
      void this.handleFrameNavigated(session, sessionId, page, frame, onPageDetected, onFrameDetected);
    });
    page.on('load', () => {
      void this.handleFrameNavigated(session, sessionId, page, page.mainFrame(), onPageDetected, onFrameDetected);
    });

    // Dialog / Download capture (Sprint 5.4). Playwright auto-dismisses
    // dialogs when no listener is registered — attaching one makes this
    // code responsible for that same dismissal (otherwise the dialog would
    // block the page indefinitely), so dialog.dismiss() below preserves
    // the pre-existing no-hang behavior while adding capture on top of it.
    page.on('dialog', async (dialog) => {
      const context = this.getDetectionContext(session);
      if (context) {
        const { event, intent } = session.smartRecorder.recordDialog(dialog.type(), dialog.message(), context);
        session.recordedEvents.push(event);
        session.intentTimeline.push(intent);
        console.log(`[Session ${sessionId}] Event recorded: ${describeRecordedEvent(event, intent)}`);
        if (onEventRecorded) {
          onEventRecorded(event, intent);
        }
      } else {
        console.log(`[Session ${sessionId}] Dialog: ${dialog.type()} — ${dialog.message()}`);
      }
      await dialog.dismiss();
    });

    page.on('download', (download) => {
      const context = this.getDetectionContext(session);
      if (context) {
        const { event, intent } = session.smartRecorder.recordDownload(download.suggestedFilename(), context);
        session.recordedEvents.push(event);
        session.intentTimeline.push(intent);
        console.log(`[Session ${sessionId}] Event recorded: ${describeRecordedEvent(event, intent)}`);
        if (onEventRecorded) {
          onEventRecorded(event, intent);
        }
      } else {
        console.log(`[Session ${sessionId}] Download: ${download.suggestedFilename()}`);
      }
    });

    // Handle this page/tab closing. Only the original page closing ends
    // the whole recording session (onClose) — closing a secondary tab the
    // flow opened along the way (e.g. closing a popup after using it) is
    // normal mid-session behavior, not the user ending the recording.
    page.on('close', () => {
      if (page === session.page) {
        console.log(`[Session ${sessionId}] Browser page closed by user`);
        session.isActive = false;
        if (onClose) {
          onClose();
        }
      } else {
        console.log(`[Session ${sessionId}] Secondary tab closed: ${page.url()}`);
      }
    });
  }

  /**
   * Dispatches a 'framenavigated'/'load' event to the right re-detection
   * path: main-frame navigation re-runs PageDetector (which in turn always
   * re-runs FrameDetector too, per runPageAndFrameDetection above); a
   * non-main frame navigating on its own re-runs only FrameDetector.
   * ApplicationDetector is deliberately never called from here — it runs
   * exactly once, in startSession. Best-effort, same as the initial
   * detection: a re-detection failure never aborts the session.
   */
  private async handleFrameNavigated(
    session: RecordingSession,
    sessionId: string,
    page: Page,
    frame: Frame,
    onPageDetected?: (metadata: PageMetadata) => void,
    onFrameDetected?: (metadata: FrameMetadata) => void
  ): Promise<void> {
    if (!session.applicationMetadata) return; // initial detection hasn't completed yet

    try {
      const facts = await extractBrowserFacts(page);
      if (frame === page.mainFrame()) {
        await this.runPageAndFrameDetection(session, sessionId, facts, session.applicationMetadata, onPageDetected, onFrameDetected);
      } else {
        this.runFrameDetectionOnly(session, sessionId, facts, session.applicationMetadata, onFrameDetected);
      }
    } catch (e: any) {
      console.warn(`[Session ${sessionId}] Re-detection notice: ${e.message}`);
    }
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
    const actionsCode = session.events
      .map((event) => `  ${frameAwareCodeLine(event.codeLine, event.frameSelector, event.type)}`)
      .join('\n');

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
