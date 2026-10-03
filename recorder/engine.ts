import { chromium, Browser, BrowserContext, Frame, Page } from 'playwright';
import type { StorageState } from 'playwright';
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
import { parseNaturalLanguageIntent, ParsedIntent } from './intentParser';

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

/**
 * True when `b` should replace `a` as session.pageMetadata — compares the
 * identity fields (pageType/module/entity), not confidence/signals, which
 * can legitimately fluctuate without the page itself having changed. `a`
 * undefined (nothing detected yet) always counts as a change.
 *
 * Root-cause fix (real ServiceNow Classic recording producing Page=Unknown
 * despite Application/Frame detecting correctly): detectPage()'s "Unknown"
 * result is PageDetector's fallback for "no provider's candidates scored
 * above 0" (page-detector/engine.ts), not a provider's considered verdict
 * that the page is actually unrecognized. PageDetector/FrameDetector
 * re-run on every 'framenavigated'/'load' event (handleFrameNavigated,
 * below) — and #gsft_main can legitimately re-navigate mid-session without
 * a full page reload (a field-change-triggered UI-policy recalculation
 * reloading the content iframe is a documented real ServiceNow Classic
 * behavior), briefly landing BrowserFacts on an interim bridge/loading
 * page that carries none of the route evidence (sys_id, etc.) the
 * previous, correct detection relied on. Confirmed live and reproduced
 * directly: without this guard, that transient snapshot unconditionally
 * overwrote the already-correct "Incident Form" verdict with "Unknown",
 * and if no further navigation happened to self-correct it before the
 * next interaction, every event from that point on — including the very
 * last one, which is what the "most recent" Prepared AI Context summary
 * displays — was permanently stamped Unknown. An absence of evidence
 * during a mid-session transition is not evidence that the page changed,
 * so a fallback "Unknown" verdict must never erase a previously
 * established, specific one; only another specific (non-fallback) verdict
 * can.
 */
function pageMetadataChanged(a: PageMetadata | undefined, b: PageMetadata): boolean {
  if (!a) return true;
  if (b.pageType === 'Unknown' && a.pageType !== 'Unknown') return false;
  return a.pageType !== b.pageType || a.module !== b.module || a.entity !== b.entity;
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
  return `[${event.type}] ${subject} — application: ${event.application.application}, ` +
    `page: ${event.page.pageType}/${event.page.entity ?? 'unknown'}, ` +
    `frame: ${event.frame.frameType}/${event.frame.frameSelector ?? 'top'}, ` +
    `locator: ${JSON.stringify(event.locator)}, intent: ${intent.intent} (${intent.confidence})`;
}

// waitUntil: 'domcontentloaded', not Playwright's default 'load' --
// root-cause fix for a real, reproducible Execute timeout: confirmed live
// against a real ServiceNow instance, the post-login top-level navigation
// lands on the Now Experience shell (nav/ui/classic/params/target/
// ui_page.do), whose URL matches immediately but whose 'load' event never
// fires within the 30s timeout (the shell keeps persistent background
// connections open -- e.g. real-time notification sockets -- which is
// common to any app with that shape, not unique to ServiceNow). The run's
// own log showed "navigated to [URL]" (the predicate matched) immediately
// followed by a full 30000ms TimeoutError, direct proof the URL wait
// itself was fine and the extra 'load'-state wait was what hung. Every
// later recorded action is scoped to the frame/content this DOM state
// already provides (Playwright locators auto-wait for actionability
// regardless), so there is no loss of correctness in no longer waiting for
// 'load' specifically.
const NAVIGATION_WAIT_OPTIONS = "{ waitUntil: 'domcontentloaded' }";

export function navigationWaitCode(url: string): string {
  try {
    const { pathname } = new URL(url);
    const segments = pathname.split('/').filter(Boolean);
    const lastSegment = segments[segments.length - 1];
    const fragment = lastSegment?.replace(/\.[a-zA-Z0-9]+$/, '');

    if (fragment) {
      const expectedSegment = JSON.stringify(fragment);
      return `await page.waitForURL(url => url.pathname.split('/').some(segment => segment === ${expectedSegment} || segment.replace(/\\.[a-zA-Z0-9]+$/, '') === ${expectedSegment}), ${NAVIGATION_WAIT_OPTIONS});`;
    }

    return `await page.waitForURL(url => url.pathname === ${JSON.stringify(pathname)}, ${NAVIGATION_WAIT_OPTIONS});`;
  } catch {
    return `await page.waitForURL(${JSON.stringify(url)}, ${NAVIGATION_WAIT_OPTIONS});`;
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

/** mm:ss.ss elapsed since session start — shared by live event capture and
 * AI Gen's resolveIntent(), so both stamp events on the same clock. */
function formatElapsedTimestamp(startTime: number): string {
  const elapsedSeconds = ((Date.now() - startTime) / 1000).toFixed(2);
  const minutes = Math.floor(Number(elapsedSeconds) / 60);
  const seconds = (Number(elapsedSeconds) % 60).toFixed(2);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(5, '0')}`;
}

/** Shape returned by locatorGenerator.ts's browser-injected
 * resolveElementByText() (window.__playwrightStudioResolveElement) — a
 * computePlaywrightLocator() result (strategy/selector/display/tag/...)
 * plus the accessible name that was actually matched. */
interface ResolvedElementLocator {
  matchedText: string;
  strategy: string;
  selector: string;
  display: string;
  tag: string;
  [key: string]: unknown;
}

/** Builds the exact same style of Playwright code line the live recorder's
 * click/fill/select listeners emit (see locatorGenerator.ts) — selectOption
 * for a <select>, fill for any other field, click otherwise. Keeps AI Gen's
 * generated actions indistinguishable, at the codegen level, from ones a
 * human actually recorded. */
function actionCodeLineForIntent(intent: ParsedIntent, locatorSelector: string, tag: string): string {
  if (intent.kind === 'click') {
    return `await ${locatorSelector}.click();`;
  }
  const escapedValue = intent.value.replace(/'/g, "\\'");
  return tag === 'select'
    ? `await ${locatorSelector}.selectOption('${escapedValue}');`
    : `await ${locatorSelector}.fill('${escapedValue}');`;
}

/** 'set' intent resolved to a <select> emits a 'select' event (matching the
 * real recorder's own select-listener type); any other resolved element
 * emits 'fill'. A 'click' intent always emits 'click'. */
function eventTypeForIntent(intent: ParsedIntent, tag: string): RecordedBrowserEvent['type'] {
  if (intent.kind === 'click') return 'click';
  return tag === 'select' ? 'select' : 'fill';
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

      const timestamp = formatElapsedTimestamp(session.startTime);

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
        event.applicationMetadata = smartEvent.application;
        event.pageMetadata = smartEvent.page;
        event.frameMetadata = smartEvent.frame;
        event.smartLocator = smartEvent.locator;
        event.intent = intent;
        console.log(`[Session ${sessionId}] Event recorded: ${describeRecordedEvent(smartEvent, intent)}`);
        if (onEventRecorded) {
          onEventRecorded(smartEvent, intent);
        }
      }

      session.events.push(event);
      if (onEvent) {
        onEvent(event);
      }
      console.log(`[Session ${sessionId}] Captured [${event.type}]: ${event.codeLine}`);
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
      const frameSnapshots = await Promise.all(page.frames().map(async (frame) => {
        let frameSelector: string | undefined;
        try {
          frameSelector = await getFrameSelector(frame);
        } catch {
          // A frame may detach while the initial detection snapshot is read.
        }
        return {
          url: frame.url(),
          name: frame.name(),
          selector: frameSelector ?? null
        };
      }));
      console.log(
        `[Session ${sessionId}] Initial detection input: ` +
        JSON.stringify({
          topLevelUrl: page.url(),
          frames: frameSnapshots,
          iframeSrcs: facts.iframeSrcs,
          liveFrameUrls: facts.frameUrls
        })
      );

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
   * handleFrameNavigated on every subsequent frame navigation. ServiceNow
   * form routing can happen entirely inside #gsft_main without a top-level
   * navigation, so frame-source changes can refine PageMetadata too.
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
          navEvent.applicationMetadata = navigationEvent.application;
          navEvent.pageMetadata = navigationEvent.page;
          navEvent.frameMetadata = navigationEvent.frame;
          navEvent.smartLocator = navigationEvent.locator;
          navEvent.intent = intent;
          navEvent.navigation = navigationEvent.navigation;
          console.log(`[Session ${sessionId}] Event recorded: ${describeRecordedEvent(navigationEvent, intent)}`);
          if (onEventRecorded) {
            onEventRecorded(navigationEvent, intent);
          }
        }
        session.events.push(navEvent);
        if (onEvent) {
          onEvent(navEvent);
        }
        console.log(`[Session ${sessionId}] Navigated to: ${frame.url()}`);
        lastKnownUrl = frame.url();
      }
    });

    // Page/Frame re-detection lifecycle (Sprint 5 Phase 3 lifecycle patch).
    // ApplicationDetector remains one-time; PageDetector and FrameDetector
    // rerun for main- and sub-frame navigation so iframe route changes can
    // refine page metadata without changing event capture/codegen.
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
      // Accept, not dismiss: found live — a real ServiceNow "Delete" click
      // opens a native confirm() dialog, and dismissing it silently
      // cancels the very action the user just took, with no visible sign
      // anything went wrong. The user re-clicked "Delete" a second time,
      // 2 seconds later, on the exact same button — a real recording of
      // someone retrying because nothing appeared to happen. Accepting
      // matches the overwhelmingly common real intent for a
      // confirm-before-destructive-action dialog: the user already chose
      // to proceed by triggering it in the first place.
      await dialog.accept();
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
   * Re-runs PageDetector and FrameDetector on every navigation. An
   * application route can change inside an iframe without a top-level
   * navigation, and page providers can use the updated iframe source facts.
   * ApplicationDetector is deliberately never called from here — it runs
   * exactly once, in startSession. Best-effort, same as the initial
   * detection: a re-detection failure never aborts the session.
   */
  private async handleFrameNavigated(
    session: RecordingSession,
    sessionId: string,
    page: Page,
    navigatedFrame: Frame,
    onPageDetected?: (metadata: PageMetadata) => void,
    onFrameDetected?: (metadata: FrameMetadata) => void
  ): Promise<void> {
    if (!session.applicationMetadata) {
      console.log(`[Session ${sessionId}] Detection skipped before initial application detection completed.`);
      return;
    }

    try {
      let frameSelector: string | undefined;
      try {
        frameSelector = await getFrameSelector(navigatedFrame);
      } catch {
        // Navigation can detach the frame before its element selector is read.
      }
      const facts = await extractBrowserFacts(page);
      console.log(
        `[Session ${sessionId}] Navigation detection input: ` +
        JSON.stringify({
          topLevelUrl: page.url(),
          frameUrl: navigatedFrame.url(),
          frameName: navigatedFrame.name(),
          frameSelector: frameSelector ?? null,
          iframeSrcs: facts.iframeSrcs,
          liveFrameUrls: facts.frameUrls,
          application: session.applicationMetadata
        })
      );
      await this.runPageAndFrameDetection(
        session,
        sessionId,
        facts,
        session.applicationMetadata,
        onPageDetected,
        onFrameDetected
      );
      console.log(
        `[Session ${sessionId}] Navigation detection result: ` +
        JSON.stringify({
          application: session.applicationMetadata,
          page: session.pageMetadata,
          frame: session.frameMetadata
        })
      );
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
  /**
   * AI Gen's only entry point into a real browser. Resolves a natural-
   * language instruction against the live page of an active session,
   * reusing the same Context Engine metadata (Application/Page/Frame) and
   * the same computePlaywrightLocator() the live click/fill listeners use
   * — via resolveElementByText()/window.__playwrightStudioResolveElement
   * in locatorGenerator.ts — instead of inventing a selector. Requires an
   * active session; callers with no live session should show that state
   * rather than calling this.
   *
   * Returns one RecordedBrowserEvent per clause that resolved to a real
   * element — the exact same shape the live recorder emits, so it can be
   * handed straight to the existing optimizer/spec-generator pipeline
   * unchanged — plus the raw text of every clause that could not be parsed
   * or could not be matched to any element on the page, so a caller can be
   * honest about what AI Gen did not understand rather than silently
   * guessing.
   */
  async resolveIntent(sessionId: string, instruction: string): Promise<{
    actions: RecordedBrowserEvent[];
    unresolved: string[];
  }> {
    const session = this.sessions.get(sessionId);
    if (!session || !session.isActive) {
      throw new Error(`No active recording session "${sessionId}" to resolve intent against.`);
    }

    const context = this.getDetectionContext(session);
    const { intents, unparsed } = parseNaturalLanguageIntent(instruction);

    const actions: RecordedBrowserEvent[] = [];
    const unresolved: string[] = [...unparsed];

    for (const intent of intents) {
      const resolved = await this.resolveIntentAgainstPage(session.page, intent);
      if (!resolved) {
        unresolved.push(intent.raw);
        continue;
      }

      const { locator, frameSelector } = resolved;
      const type = eventTypeForIntent(intent, locator.tag);
      const codeLine = frameAwareCodeLine(
        actionCodeLineForIntent(intent, locator.selector, locator.tag),
        frameSelector,
        type
      );

      actions.push({
        id: `ai_${Date.now()}_${actions.length + 1}`,
        type,
        selector: locator.selector,
        value: intent.kind === 'set' ? intent.value : undefined,
        timestamp: formatElapsedTimestamp(session.startTime),
        codeLine,
        url: session.page.url(),
        frameSelector,
        tabIndex: 0,
        applicationMetadata: context?.application,
        pageMetadata: context?.page,
        frameMetadata: context?.frame
      });
    }

    return { actions, unresolved };
  }

  /**
   * Finds which real element (if any) a single parsed intent's target text
   * refers to, trying the main frame first and then every child frame in
   * turn (a ServiceNow-style app keeps its real fields inside an iframe
   * such as #gsft_main) — via the same injected
   * window.__playwrightStudioResolveElement() the browser-side locator
   * engine exposes, so there is no separate DOM-matching logic here.
   */
  private async resolveIntentAgainstPage(
    page: Page,
    intent: ParsedIntent
  ): Promise<{ locator: ResolvedElementLocator; frameSelector?: string } | undefined> {
    const tagFilter = intent.kind === 'set' ? 'input, select, textarea' : undefined;
    const mainFrame = page.mainFrame();
    const frames = [mainFrame, ...page.frames().filter((frame) => frame !== mainFrame)];

    for (const frame of frames) {
      if (frame.isDetached()) continue;

      let result: ResolvedElementLocator | null;
      try {
        result = await frame.evaluate(
          ({ searchText, tagFilter }) => (window as any).__playwrightStudioResolveElement(searchText, tagFilter),
          { searchText: intent.target, tagFilter }
        );
      } catch {
        continue; // cross-origin, detached mid-evaluate, or script not yet injected — try the next frame
      }
      if (!result) continue;

      const frameSelector = await getFrameSelector(frame);
      return { locator: result, frameSelector };
    }

    return undefined;
  }

  /**
   * Launches a short-lived, NON-recording browser purely for GenAI's live-
   * DOM resolution (Phase 1 of GenAI consuming Record/Optimize/Framework
   * Generator output — see project architecture notes). Reuses exactly the
   * same browser injection script and Context Engine (detectApplication/
   * runPageAndFrameDetection) startSession() uses, so resolveIntent() works
   * against the resulting session completely unchanged. Deliberately skips
   * everything that makes a session a *recording*: no
   * context.exposeBinding('__playwrightStudioEmitEvent', ...) (so the
   * injected script's own click/fill listeners have nothing to call into —
   * no human-interaction capture happens), no Smart Recorder interaction
   * recording, no attachPageListeners (no recorder dialog/download/
   * navigation capture).
   *
   * Refuses to launch while any real recording session is still active
   * (any active session whose `kind` is not 'resolution') — GenAI's own
   * browser must never run concurrently with a live recording.
   */
  async startResolutionSession(
    targetUrl: string,
    headless = true,
    requestedSessionId?: string,
    storageState?: StorageState
  ): Promise<string> {
    const activeRecording = [...this.sessions.values()]
      .find((session) => session.isActive && session.kind !== 'resolution');
    if (activeRecording) {
      throw new Error(
        `Cannot start a resolution session while recording session "${activeRecording.id}" is active. Stop the recording first.`
      );
    }

    const sessionId = requestedSessionId ??
      `res_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const formattedUrl = targetUrl.startsWith('http://') || targetUrl.startsWith('https://')
      ? targetUrl
      : `https://${targetUrl}`;

    console.log(`[PlaywrightRecordingEngine] Launching resolution browser for session: ${sessionId}`);
    console.log(`[PlaywrightRecordingEngine] Target URL: ${formattedUrl}`);

    const browser: Browser = await chromium.launch({
      headless,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
    });
    const context: BrowserContext = await browser.newContext({
      ...(storageState ? { storageState } : {}),
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    });
    const page: Page = await context.newPage();

    // Same browser-injected locator engine the recording session uses --
    // required for resolveIntent()'s window.__playwrightStudioResolveElement
    // to exist in this page. No exposeBinding alongside it, unlike
    // startSession(): the injected script's own DOM listeners call
    // window.__playwrightStudioEmitEvent when a human interacts with the
    // page, but that function is only ever defined by exposeBinding -- by
    // never calling it here, there is nothing for those listeners to call
    // into, so no interaction capture can happen in this browser.
    await context.addInitScript(browserInjectionScript);

    // Best-effort auto-cleanup if the browser closes/crashes on its own
    // (e.g. the process is killed externally) — not recorder dialog/
    // download capture (attachPageListeners), just housekeeping so a dead
    // session entry never lingers in the map.
    browser.on('disconnected', () => {
      const current = this.sessions.get(sessionId);
      if (current && current.kind === 'resolution') {
        current.isActive = false;
        this.sessions.delete(sessionId);
      }
    });

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
      smartRecorder: new SmartRecorderEngine(),
      kind: 'resolution'
    };
    this.sessions.set(sessionId, session);

    try {
      await page.goto(formattedUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    } catch (e: any) {
      console.warn(`[Session ${sessionId}] Resolution session navigation notice: ${e.message}`);
    }

    // Same one-time Application/Page/Frame detection startSession() runs --
    // no duplicate detection logic, no second ApplicationDetector/
    // PageDetector/FrameDetector.
    try {
      const facts = await extractBrowserFacts(page);
      const metadata = await this.detectApplication(facts);
      session.applicationMetadata = metadata;
      session.applicationMetadataHistory = Object.freeze([metadata]);
      console.log(
        `[Session ${sessionId}] Application detected: ${metadata.application}` +
        (metadata.ui ? ` (${metadata.ui})` : '') +
        ` — confidence ${metadata.confidence}`
      );
      await this.runPageAndFrameDetection(session, sessionId, facts, metadata);
    } catch (e: any) {
      console.warn(`[Session ${sessionId}] Resolution session detection notice: ${e.message}`);
    }

    return sessionId;
  }

  /** Direct Page access for a session — primarily for resolution sessions
   * (see startResolutionSession()), which have no event-stream callbacks to
   * observe state through otherwise. */
  getPage(sessionId: string): Page | undefined {
    return this.sessions.get(sessionId)?.page;
  }

  /**
   * Closes a resolution session's browser and removes it from the session
   * map. Resolution sessions are meant to be short-lived — callers should
   * close one as soon as whatever it was opened to resolve is done. A
   * no-op for anything that isn't an active resolution session (including
   * real recording sessions — use stopSession() for those).
   */
  async closeResolutionSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session || session.kind !== 'resolution') return;

    session.isActive = false;

    try {
      if (session.browser) {
        await session.browser.close();
      }
    } catch (err: any) {
      console.warn(`[Session ${sessionId}] Error closing resolution browser:`, err.message);
    }
    this.sessions.delete(sessionId);
  }

  async stopSession(sessionId: string): Promise<{
    testScript: string;
    totalEvents: number;
    storageState: StorageState;
  }> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    session.isActive = false;
    let storageState: StorageState;
    try {
      storageState = await session.context.storageState();
    } finally {
      try {
        if (session.browser) {
          await session.browser.close();
        }
      } catch (err: any) {
        console.warn(`[Session ${sessionId}] Error closing browser:`, err.message);
      }
    }

    const testScript = this.generatePlaywrightSpec(session);
    return {
      testScript,
      totalEvents: session.events.length,
      storageState
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
