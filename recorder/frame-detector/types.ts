import type { ApplicationMetadata, BrowserFacts } from '../types';
import type { PageMetadata } from '../page-detector/types';

// --- Sprint 5 Phase 3: Frame Detection contracts/models only. Mirrors the
// Phase 1/2 provider pattern exactly — concrete logic (providers,
// orchestration) lives in engine.ts / providers/*.ts, this file holds only
// the shapes those pieces agree on.

/**
 * Immutable metadata identifying which frame, within an already-detected
 * page, is the primary surface for interaction. Confidence-based, same as
 * ApplicationMetadata/PageMetadata. `frameType` is "MainFrame" for both the
 * literal top document (framePath: [], frameSelector: null) AND a single
 * recognized primary content iframe one level deep (e.g. ServiceNow's
 * #gsft_main) — "MainFrame" means "the primary interaction surface",
 * not literally "no iframe involved". `frameType` becomes "NestedFrame"
 * only once framePath is genuinely 2+ levels deep. `framePath` lists every
 * selector from the outermost iframe down to the target, in order, with no
 * fixed depth limit. `readonly` throughout; engine.ts also Object.freeze()s
 * the actual instance for runtime immutability, not just compile-time.
 */
export interface FrameMetadata {
  readonly frameType: 'MainFrame' | 'NestedFrame';
  readonly frameSelector: string | null;
  readonly framePath: readonly string[];
  readonly confidence: number; // 0..1
  readonly signals: readonly string[];
}

/**
 * Contract every frame provider implements. Pure: takes the already-
 * extracted BrowserFacts (the same single page.evaluate() result Phase 1
 * collected — no second evaluate() boundary), plus the already-detected
 * ApplicationMetadata and PageMetadata, returns a verdict or null (does not
 * recognize a frame situation here at all). No DOM access, no page/browser
 * reference — trivially unit-testable with plain objects, no real browser
 * required.
 *
 * A provider is free to use `application`/`page` to gate itself (e.g. a
 * ServiceNow frame provider returning null immediately when
 * `application.application !== 'ServiceNow'`) — that judgment belongs
 * inside the provider, never inside engine.ts, which stays
 * application-agnostic.
 */
export interface FrameDetector {
  readonly providerName: string;
  detect(facts: BrowserFacts, application: ApplicationMetadata, page: PageMetadata): FrameMetadata | null;
}
