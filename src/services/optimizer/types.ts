import { RecordedAction } from '../../types';

/**
 * How trustworthy/resilient a locator is, in descending order of preference
 * per Playwright's own recommended locator priority (role/label/placeholder/
 * text > explicit testid > raw CSS/id/class/attribute selectors).
 */
export type LocatorQuality = 'semantic' | 'testid' | 'css';

/**
 * A scored assessment of an action's current selector, produced by
 * LocatorPlugin. Not a choice between multiple captured alternatives — the
 * recorder stores exactly one selector per element at record time (see
 * recorder/locatorGenerator.ts), so `selector` here is always that same
 * string, scored on how resilient it already is.
 */
export interface LocatorCandidate {
  selector: string;
  strategy: 'role' | 'label' | 'text' | 'css';
  confidence: number;
}

export interface OptimizedAction {
  id: string;
  type: RecordedAction['type'];
  selector: string;
  value?: string;
  timestamp: string;
  codeLine: string;
  url?: string;
  frameSelector?: string;
  /** Carried through from the recorder's credential detection (see
   * recorder/locatorGenerator.ts#detectCredential) so CredentialPlugin can
   * re-enforce process.env masking even if upstream data is ever stale. */
  isSensitive?: boolean;
  variableName?: string;
  /** Raw CSS attribute selector anchored to a stable resource identifier
   * captured from a link's href at record time (see
   * recorder/locatorGenerator.ts#extractLinkIdentity). When present,
   * PlaywrightGenerator prefers re-targeting this exact record on replay,
   * falling back to `selector` if it's no longer there. */
  identitySelector?: string;
  /** 0 for the original recording tab, 1/2/... for each subsequent tab or
   * popup the browser context opened (see recorder/types.ts's
   * RecordedBrowserEvent.tabIndex) — PlaywrightGenerator uses this to
   * detect a tab switch and generate a context.waitForEvent('page') plus a
   * page-aliased locator, the same way frameSelector drives frameLocator
   * aliasing for iframes. */
  tabIndex: number;
  locatorQuality: LocatorQuality;
  /** Set by LocatorPlugin — the scored assessment of this action's selector. */
  locatorCandidate?: LocatorCandidate;
  /** How many raw RecordedAction events were collapsed into this one. */
  mergedFromCount: number;
  /** Human-readable, deterministic notices (brittle-locator warnings, or
   * lower-confidence-tier suggestions). */
  warnings: string[];
}

/**
 * Common contract every Optimizer stage implements.
 *
 * OptimizerPipeline (see OptimizerPipeline.ts) discovers all registered
 * plugins and runs them in ascending `order`, each stage receiving the full
 * OptimizedAction[] output of the previous one and returning a new array —
 * no stage mutates its input or reaches back into the original recorded
 * events.
 *
 * Adding a future AI feature (e.g. an AssertionPlugin, a RetryPlugin) means
 * writing one new class implementing this interface and registering it with
 * the pipeline — nothing in the recorder, or any existing plugin, changes.
 */
export interface OptimizerPlugin {
  name: string;
  order: number;
  optimize(events: OptimizedAction[]): OptimizedAction[];
}
