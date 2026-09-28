import { RecordedAction } from '../types';

/**
 * AI Optimizer Engine
 *
 * Deterministic, rule-based transformation from raw captured browser events
 * (RecordedAction[], as streamed live from RecordingContext) into a cleaned,
 * quality-annotated action list (OptimizedAction[]) suitable for enterprise
 * Playwright code generation.
 *
 * No LLM call happens here — every rule below is a plain, explainable
 * transformation. This keeps the recorded-session -> generated-code path
 * auditable and fast, and gives a later LLM-authoring step a much smaller,
 * de-duplicated, quality-scored input instead of a noisy raw event stream.
 */

/**
 * How trustworthy/resilient a locator is, in descending order of preference
 * per Playwright's own recommended locator priority (role/label/placeholder/
 * text > explicit testid > raw CSS/id/class/attribute selectors).
 */
export type LocatorQuality = 'semantic' | 'testid' | 'css';

export interface OptimizedAction {
  id: string;
  type: RecordedAction['type'];
  selector: string;
  value?: string;
  timestamp: string;
  codeLine: string;
  url?: string;
  /** Playwright locator-strategy tier, derived from the selector string. */
  locatorQuality: LocatorQuality;
  /** How many raw RecordedAction events were collapsed into this one. */
  mergedFromCount: number;
  /** Human-readable, deterministic notices (e.g. brittle-locator warning). */
  warnings: string[];
}

const LOCATOR_QUALITY_RANK: Record<LocatorQuality, number> = {
  semantic: 3,
  testid: 2,
  css: 1
};

const SEMANTIC_LOCATOR_PATTERN = /\.getByRole\(|\.getByLabel\(|\.getByPlaceholder\(|\.getByText\(/;
const TESTID_LOCATOR_PATTERN = /\.getByTestId\(/;

const FILLABLE_TYPES = new Set<RecordedAction['type']>(['fill', 'select']);

/**
 * Classifies a Playwright selector string's locator strategy tier.
 * page.getByRole/getByLabel/getByPlaceholder/getByText -> 'semantic'
 * page.getByTestId                                     -> 'testid'
 * page.locator(...) (id/class/css/attribute fallbacks)  -> 'css'
 */
export function classifyLocatorQuality(selector: string): LocatorQuality {
  if (SEMANTIC_LOCATOR_PATTERN.test(selector)) return 'semantic';
  if (TESTID_LOCATOR_PATTERN.test(selector)) return 'testid';
  return 'css';
}

function warningsFor(quality: LocatorQuality, type: RecordedAction['type']): string[] {
  // 'navigation' events don't target an element (selector is just the 'page'
  // placeholder), so locator-quality warnings don't apply to them.
  if (quality === 'css' && type !== 'navigation') {
    return [
      'CSS/structural locator is brittle across UI changes — prefer a role, label, or data-testid locator.'
    ];
  }
  return [];
}

function toOptimized(action: RecordedAction): OptimizedAction {
  const locatorQuality = classifyLocatorQuality(action.selector);
  return {
    id: action.id,
    type: action.type,
    selector: action.selector,
    value: action.value,
    timestamp: action.timestamp,
    codeLine: action.codeLine,
    url: action.url,
    locatorQuality,
    mergedFromCount: 1,
    warnings: warningsFor(locatorQuality, action.type)
  };
}

function isSameTarget(a: OptimizedAction, b: OptimizedAction): boolean {
  return a.selector === b.selector;
}

/** When two representations of the same field/target disagree, keep the higher-quality one. */
function pickBetterLocator(a: OptimizedAction, b: OptimizedAction): OptimizedAction {
  return LOCATOR_QUALITY_RANK[b.locatorQuality] > LOCATOR_QUALITY_RANK[a.locatorQuality] ? b : a;
}

function rebuildFillCodeLine(selector: string, type: RecordedAction['type'], value?: string): string {
  const escaped = (value || '').replace(/'/g, "\\'");
  return type === 'select'
    ? `await ${selector}.selectOption('${escaped}');`
    : `await ${selector}.fill('${escaped}');`;
}

/**
 * Transforms a raw RecordedAction[] into a de-duplicated, quality-annotated
 * OptimizedAction[], applying (in a single linear pass):
 *
 *  1. Merge sequential FILL/SELECT events on the same field into one action
 *     carrying only the final value (keeping the better-quality locator of
 *     the two, per the semantic-over-CSS preference).
 *  2. Remove duplicate CLICK events on the same target.
 *  3. Collapse consecutive NAVIGATE (waitForURL) events into the final URL
 *     actually reached.
 *  4. Classify every remaining action's locator quality and attach a warning
 *     when it falls back to a brittle CSS/id/class selector.
 */
export function optimizeRecordedActions(actions: RecordedAction[]): OptimizedAction[] {
  const output: OptimizedAction[] = [];

  for (const raw of actions) {
    const next = toOptimized(raw);
    const last = output[output.length - 1];

    // Rule 1: merge sequential FILL/SELECT events on the same field
    if (last && FILLABLE_TYPES.has(next.type) && last.type === next.type && isSameTarget(last, next)) {
      const preferred = pickBetterLocator(last, next);
      output[output.length - 1] = {
        ...preferred,
        value: next.value,
        codeLine: rebuildFillCodeLine(preferred.selector, next.type, next.value),
        timestamp: next.timestamp,
        mergedFromCount: last.mergedFromCount + 1,
        warnings: preferred.warnings
      };
      continue;
    }

    // Rule 2: remove duplicate CLICK events on the same target
    if (last && next.type === 'click' && last.type === 'click' && isSameTarget(last, next)) {
      output[output.length - 1] = {
        ...last,
        timestamp: next.timestamp,
        mergedFromCount: last.mergedFromCount + 1
      };
      continue;
    }

    // Rule 3: collapse repeated NAVIGATE/waitForURL events into the final URL
    if (last && next.type === 'navigation' && last.type === 'navigation') {
      output[output.length - 1] = {
        ...next,
        mergedFromCount: last.mergedFromCount + 1
      };
      continue;
    }

    output.push(next);
  }

  return output;
}

/**
 * Renders a compact, deterministic plain-text summary of the optimized
 * action list — used as the (non-LLM) context fed into the AI Gen prompt.
 */
export function summarizeOptimizedActions(actions: OptimizedAction[]): string {
  return actions
    .map((a, idx) => {
      const merged = a.mergedFromCount > 1 ? ` (merged ${a.mergedFromCount} events)` : '';
      const warning = a.warnings.length > 0 ? ` [WARNING: ${a.warnings.join(' ')}]` : '';
      return `${idx + 1}. [${a.type.toUpperCase()}]${merged} ${a.codeLine}${warning}`;
    })
    .join('\n');
}
