import type { ApplicationMetadata } from '../types';
import type { PageMetadata } from '../page-detector/types';
import type { FrameMetadata } from '../frame-detector/types';

// --- Sprint 5.4: Smart Recorder contracts/models only. Concrete logic
// (locator construction, intent classification, navigation tracking,
// orchestration) lives in eventBuilder.ts / intentClassifier.ts /
// navigationTracker.ts / engine.ts — this file holds only the shapes those
// pieces agree on.
//
// Core principle: record facts, never reconstruct later. Nothing in this
// schema carries a pre-built Playwright (or any framework's) code string —
// LocatorMetadata is a structured, framework-agnostic description of the
// element captured at the moment of interaction. Framework code generation
// is explicitly out of scope for this sprint.

export type RecordedEventType =
  | 'click'
  | 'fill'
  | 'select'
  | 'check'
  | 'press'
  | 'scroll'
  | 'upload'
  | 'navigation'
  | 'dialog'
  | 'download';

/**
 * Structured, framework-agnostic description of how the target element was
 * identified — captured directly at the moment of interaction (in the
 * browser), not derived afterward by parsing a generated selector string.
 * `strategy` names which field(s) are meaningful for this locator; the
 * others are omitted, not merely empty.
 */
export interface LocatorMetadata {
  readonly strategy: 'testid' | 'role' | 'label' | 'placeholder' | 'id' | 'text' | 'css';
  readonly tag: string;
  readonly role?: string;
  readonly text?: string;
  readonly label?: string;
  readonly placeholder?: string;
  readonly testId?: string;
  readonly id?: string;
  readonly cssSelector?: string;
  readonly frameSelector?: string;
}

/**
 * Captured at the moment a navigation is observed — never inferred after
 * the fact from a sequence of other events. `trigger` reflects what the
 * user most recently did immediately before the navigation: an explicit
 * click, a form/keyboard submit, or no preceding user action at all
 * (`redirect` — e.g. an automatic server-side redirect chain).
 */
export interface NavigationMetadata {
  readonly fromUrl: string;
  readonly toUrl: string;
  readonly trigger: 'click' | 'submit' | 'redirect';
}

/**
 * Every user interaction becomes exactly one of these. Immutable —
 * engine.ts freezes each instance at construction; nothing downstream
 * (Optimizer, a future Framework Generator) may mutate a recorded event,
 * only read it. `application`/`page`/`frame` are the exact Context Engine
 * metadata in effect at the moment this event was captured (a reference to
 * whatever RecordingSession.applicationMetadata/pageMetadata/frameMetadata
 * held then) — consumed as-is, never recomputed here.
 */
export interface RecordedEvent {
  readonly id: string;
  readonly timestamp: number;
  readonly application: ApplicationMetadata;
  readonly page: PageMetadata;
  readonly frame: FrameMetadata;
  readonly type: RecordedEventType;
  readonly locator: LocatorMetadata;
  readonly value?: string;
  readonly navigation?: NavigationMetadata;
}

/** Business-meaning classification of a RecordedEvent — stored separately
 * from the event itself, never blended into it. Classification is a
 * judgment call layered on top of a fact, not a fact itself. */
export type Intent =
  | 'Login'
  | 'Logout'
  | 'CreateRecord'
  | 'OpenRecord'
  | 'Search'
  | 'UpdateRecord'
  | 'SubmitRecord'
  | 'Navigate'
  | 'Unknown';

export interface IntentEntry {
  readonly eventId: string;
  readonly intent: Intent;
  readonly confidence: number;
  readonly signals: readonly string[];
}

/** The Context Engine snapshot a RecordedEvent is stamped with — always
 * the session's current applicationMetadata/pageMetadata/frameMetadata at
 * the moment of capture. */
export interface DetectionContext {
  readonly application: ApplicationMetadata;
  readonly page: PageMetadata;
  readonly frame: FrameMetadata;
}

/**
 * Raw structured locator facts as captured directly in the browser
 * (locatorGenerator.ts), before any Node-side processing. Mirrors
 * LocatorMetadata's fields exactly minus `frameSelector`, which is
 * resolved on the Node side (same as the existing RecordedBrowserEvent
 * path) since it sometimes requires an async Frame API call.
 */
export interface RawLocatorFact {
  readonly strategy: LocatorMetadata['strategy'];
  readonly tag: string;
  readonly role?: string;
  readonly text?: string;
  readonly label?: string;
  readonly placeholder?: string;
  readonly testId?: string;
  readonly id?: string;
  readonly cssSelector?: string;
}
