// --- Sprint 5 Phase 1: Application Detection contracts/models only.
// Concrete logic (fact extraction, providers, orchestration) lives in
// browserFacts.ts / providers/*.ts / engine.ts — this file holds only the
// shapes those pieces agree on.

import type { PageMetadata } from './page-detector/types';
import type { FrameMetadata } from './frame-detector/types';
import type { IntentEntry, RecordedEvent } from './smart-recorder/types';
import type { SmartRecorderEngine } from './smart-recorder/engine';

/**
 * Immutable metadata identifying which application/platform a recording
 * session's page belongs to, captured once immediately after initial page
 * load. Confidence-based by design — never a single boolean "is this X"
 * check. `signals` lists exactly which ones fired, so a low-confidence
 * verdict is always explainable, never a black box. `readonly` throughout;
 * engine.ts also Object.freeze()s the actual instance for runtime
 * immutability, not just compile-time.
 */
export interface ApplicationMetadata {
  readonly application: string;
  readonly ui?: string;
  readonly confidence: number; // 0..1
  readonly instance?: string;
  readonly signals: readonly string[];
}

/**
 * One node of the recursive iframe tree captured in BrowserFacts.
 * `index` is the node's position among its sibling iframes at its level —
 * always available, so a positional selector (iframe:nth-of-type(n)) can be
 * constructed even when an iframe has neither id nor name.
 */
export interface IframeFact {
  readonly id: string;
  readonly name: string;
  readonly src: string;
  readonly index: number;
  readonly children: readonly IframeFact[];
}

/**
 * Provider-agnostic facts pulled from the page in the single
 * page.evaluate() boundary (browserFacts.ts#extractBrowserFacts).
 * Providers never touch the DOM directly — they only score this plain
 * data — so adding a new provider (Oracle, Workday, Jira, SAP Fiori,
 * Salesforce Lightning, Amazon, ...) never requires touching the
 * browser-evaluation boundary or engine.ts, only a new provider class plus,
 * if a genuinely new *category* of raw fact is needed, an addition here and
 * in extractBrowserFacts (never a per-app boolean — see field comments).
 *
 * Deliberately generic/structural, not per-application booleans: covers six
 * signal categories (URL, DOM structure, meta tags, root app containers,
 * ARIA/layout, frame structure) so a provider can be written for any
 * platform without any of these fields changing shape.
 */
export interface BrowserFacts {
  // --- URL ---
  readonly hostname: string;
  readonly href: string;
  readonly pathname: string;
  readonly title: string;

  // --- Meta tags ---
  readonly metaTags: Readonly<Record<string, string>>;

  // --- DOM structure ---
  /** Distinct custom-element tag prefixes found anywhere on the page (the
   * substring before the first "-" in any hyphenated tag name, e.g.
   * "macroponent" for <macroponent-f51912...>, "lightning" for
   * <lightning-button>). Generic replacement for a single hardcoded
   * "hasMacroponentElement" boolean — any provider greps this array for the
   * prefix(es) its platform is known to render. */
  readonly customElementTagPrefixes: readonly string[];

  // --- Root application containers ---
  /** ids of document.body's direct element children — the common mount
   * point for SPA frameworks (e.g. "root", "app", "gsft_main",
   * "workday-app"). A structural signal, not a hardcoded per-app id list. */
  readonly rootContainerIds: readonly string[];

  // --- ARIA / layout signatures ---
  /** Distinct values of every role="..." attribute present on the page
   * (e.g. "application", "navigation", "banner"). */
  readonly ariaLandmarkRoles: readonly string[];
  /** document.body's class list, split on whitespace. */
  readonly bodyClasses: readonly string[];

  // --- Frame structure ---
  readonly iframeCount: number;
  readonly iframeIds: readonly string[];
  readonly iframeSrcs: readonly string[];
  /** Flat, top-level iframe `name` attributes (Sprint 5 Phase 3). */
  readonly iframeNames: readonly string[];
  /** Recursive iframe tree, roots = top-level iframes (Sprint 5 Phase 3).
   * Same-origin nested iframes are walked recursively within this same
   * evaluate() call; a cross-origin iframe's `children` is always empty —
   * the Same-Origin Policy makes its content genuinely inaccessible from
   * here, not a bug to work around. Real payment iframes (Stripe, PayPal,
   * ...) are almost always cross-origin, so their `children` will
   * correctly be empty even though the iframe itself is still detected. */
  readonly iframeHierarchy: readonly IframeFact[];

  // --- ServiceNow-proven, cheap, kept as-is (Classic UI detection needs
  // the frame's presence specifically, and g_ck is a real, stable signal
  // observed on a live instance — narrowing these into the generic fields
  // above would lose information, not gain genericness) ---
  readonly hasGsftMainFrame: boolean;
  readonly hasGlideCk: boolean;

  // --- Page content (Sprint 5 Phase 2: added for PageDetector, same single
  // evaluate() boundary — no second page.evaluate() call anywhere. Generic
  // content signals, not page-type-specific: any PageDetector provider for
  // any application greps these for the labels/inputs/layout it cares
  // about, the same way application providers grep customElementTagPrefixes
  // for their own platform's prefix. ---
  /** Trimmed, deduped text of visible button-like elements (<button>,
   * [role="button"], input[type="submit"|"button"]), capped at 50. */
  readonly visibleButtonLabels: readonly string[];
  /** Trimmed, deduped text of visible <label> elements plus aria-label/
   * placeholder on visible inputs/textareas/selects, capped at 50. */
  readonly visibleFieldLabels: readonly string[];
  /** input[type="password"] present anywhere on the page. */
  readonly hasPasswordInput: boolean;
  /** A <table>, or an element with role="table"/"grid", is present —
   * generic tabular/list-layout signal. */
  readonly hasTableOrGridElement: boolean;
}

/**
 * Contract every application provider implements. Pure: takes
 * already-extracted BrowserFacts, returns a verdict or null (does not
 * recognize this page at all). No DOM access, no page/browser reference —
 * this is what makes every provider trivially unit-testable with a plain
 * BrowserFacts object, no real browser required.
 */
export interface ApplicationDetector {
  readonly application: string;
  detect(facts: BrowserFacts): ApplicationMetadata | null;
}

export interface RecordedBrowserEvent {
  id: string;
  type: 'click' | 'fill' | 'select' | 'assert' | 'navigation' | 'press' | 'check' | 'upload' | 'scroll';
  selector: string;
  value?: string;
  timestamp: string;
  codeLine: string;
  url: string;
  frameSelector?: string;
  isSensitive?: boolean;
  variableName?: string;
  /** Raw CSS attribute selector anchored to a stable resource identifier
   * (e.g. an `id`/`sys_id`/`pk` query param) captured from a link's href at
   * record time — set only when computePlaywrightLocator found one. Lets
   * replay re-target the exact same record instead of "whichever matches
   * the generic pattern first," while still degrading to the generic
   * selector if that specific record is gone by replay time. */
  identitySelector?: string;
}

export interface RecordingSession {
  id: string;
  targetUrl: string;
  startTime: number;
  browser: any;
  context: any;
  page: any;
  events: RecordedBrowserEvent[];
  isActive: boolean;
  /** Captured once, immediately after initial page load, and never again
   * — see engine.ts's detectApplication(). Optional so existing session
   * objects (and anything constructing one without it) remain valid. */
  applicationMetadata?: ApplicationMetadata;
  /** Append-only immutable record of applicationMetadata (always length 0
   * or 1, since ApplicationDetector runs exactly once — see lifecycle
   * patch below). Always initialized, never undefined. */
  applicationMetadataHistory: readonly ApplicationMetadata[];
  /** Latest PageMetadata. Re-evaluated on every successful navigation
   * (Sprint 5 Phase 3 lifecycle patch — see engine.ts's
   * runPageAndFrameDetection()), but this field only changes, and
   * PAGE_DETECTED only fires, when the new verdict actually differs
   * (pageType/module/entity) from the previous one. Optional so existing
   * session objects remain valid. */
  pageMetadata?: PageMetadata;
  /** Append-only immutable history of every distinct PageMetadata value
   * observed — a new entry is added exactly when pageMetadata changes,
   * mirroring every PAGE_DETECTED emission 1:1. Always initialized, never
   * undefined. */
  pageMetadataHistory: readonly PageMetadata[];
  /** Latest FrameMetadata. Re-evaluated whenever PageDetector runs, or
   * whenever a non-main frame navigates on its own (Sprint 5 Phase 3
   * lifecycle patch), but this field only changes, and FRAME_DETECTED only
   * fires, when the new verdict actually differs (frameType/frameSelector/
   * framePath) from the previous one. Distinct from the per-event
   * `frameSelector` already computed live on each RecordedBrowserEvent (via
   * getFrameSelector/Playwright's real Frame API) — this is session-level
   * classification metadata, not part of the event-capture/codegen path,
   * which is unchanged. */
  frameMetadata?: FrameMetadata;
  /** Append-only immutable history of every distinct FrameMetadata value
   * observed — a new entry is added exactly when frameMetadata changes,
   * mirroring every FRAME_DETECTED emission 1:1. Always initialized, never
   * undefined. */
  frameMetadataHistory: readonly FrameMetadata[];

  // --- Sprint 5.4: Smart Recorder. Consumes applicationMetadata/
  // pageMetadata/frameMetadata above as-is (a DetectionContext snapshot at
  // the moment each event was captured) — the Context Engine itself is
  // untouched. ---
  /** Every user interaction/navigation/dialog/download captured this
   * session, in order. Individual events are frozen at construction
   * (immutable); this array is append-only, mirroring session.events'
   * existing pattern. */
  recordedEvents: RecordedEvent[];
  /** Business-meaning classification for each entry in recordedEvents,
   * same order, stored separately from the events themselves. */
  intentTimeline: IntentEntry[];
  /** Per-session Smart Recorder facade — holds this session's
   * NavigationTracker state, so it must never be shared across sessions.
   * Constructed once, at session creation. */
  smartRecorder: SmartRecorderEngine;
}

export interface RecordStartRequest {
  url: string;
}

export interface RecordStartResponse {
  status: 'RECORDING_STARTED';
  sessionId: string;
  targetUrl: string;
}

export interface RecordStopRequest {
  sessionId: string;
}

export interface RecordStopResponse {
  status: 'RECORDING_STOPPED';
  sessionId: string;
  totalEvents: number;
  generatedCode: string;
}

export interface RecordEventsResponse {
  sessionId: string;
  events: RecordedBrowserEvent[];
  isRecording: boolean;
  totalEvents: number;
}
