import { ApplicationMetadata, BrowserFacts } from '../types';

// --- Sprint 5 Phase 2: Page Detection contracts/models only. Mirrors the
// Phase 1 ApplicationDetector pattern exactly — concrete logic (providers,
// orchestration) lives in engine.ts / providers/*.ts, this file holds only
// the shapes those pieces agree on.

/**
 * Immutable metadata identifying which page, within an already-detected
 * application, the current session is on. Confidence-based by design, same
 * as ApplicationMetadata — never a single boolean "is this X" check.
 * `signals` lists exactly which ones fired, so a low-confidence verdict is
 * always explainable. `readonly` throughout; engine.ts also Object.freeze()s
 * the actual instance for runtime immutability, not just compile-time.
 */
export interface PageMetadata {
  readonly pageType: string;
  readonly module: string | null;
  readonly entity: string | null;
  readonly confidence: number; // 0..1
  readonly signals: readonly string[];
}

/**
 * Contract every page provider implements. Pure: takes the already-extracted
 * BrowserFacts (the same single page.evaluate() result Phase 1 collected —
 * no second evaluate() boundary) plus the already-detected ApplicationMetadata,
 * returns a verdict or null (does not recognize this page at all). No DOM
 * access, no page/browser reference — trivially unit-testable with plain
 * objects, no real browser required.
 *
 * A provider is free to use `application` to gate itself (e.g. a ServiceNow
 * page provider returning null immediately when `application.application !==
 * 'ServiceNow'`) — that judgment belongs inside the provider, never inside
 * engine.ts, which stays application-agnostic.
 */
export interface PageDetector {
  readonly providerName: string;
  detect(facts: BrowserFacts, application: ApplicationMetadata): PageMetadata | null;
}
