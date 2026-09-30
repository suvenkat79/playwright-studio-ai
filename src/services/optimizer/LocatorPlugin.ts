import { LocatorCandidate, LocatorQuality, OptimizedAction, OptimizerPlugin } from './types';

const REPLACE_THRESHOLD = 90;
const SUGGEST_THRESHOLD = 70;

/**
 * Generic signature of an auto-generated/opaque identifier — a long run of
 * hex-like characters, as produced by essentially every component
 * framework's generated IDs (e.g. a vendor's custom-element tag suffix, a
 * hashed CSS module class, a GUID-based id attribute). Deliberately matches
 * on shape, not any vendor's specific naming convention, so this works for
 * any application, not just one.
 */
const OPAQUE_HASH_PATTERN = /[0-9a-f]{8,}/i;

/**
 * Classifies a Playwright selector string's locator strategy tier.
 * page.getByRole/getByLabel/getByPlaceholder/getByText -> 'semantic'
 * page.getByTestId                                     -> 'testid'
 * page.locator(...) (id/class/css/attribute fallbacks)  -> 'css'
 */
export function classifyLocatorQuality(selector: string): LocatorQuality {
  if (/\.getByRole\(|\.getByLabel\(|\.getByPlaceholder\(|\.getByText\(/.test(selector)) return 'semantic';
  if (/\.getByTestId\(/.test(selector)) return 'testid';
  return 'css';
}

/**
 * Scores the single selector the recorder captured for an action.
 *
 * This is deliberately NOT a choice between multiple candidate locators —
 * the recorder (recorder/locatorGenerator.ts) computes and stores exactly
 * one selector per element at record time, and no alternative strategies
 * survive once recording stops (deriving one would require re-querying a
 * DOM that no longer exists). So a confidence >=90 "replace automatically"
 * below is necessarily a no-op for an already-semantic selector: the
 * winning candidate *is* the current selector, never a guess. The real
 * value of this stage is the 70-89 and <70 tiers, where it surfaces a
 * suggestion/warning without ever fabricating a replacement it can't verify.
 *
 * Confidence values are a deterministic, explainable heuristic aligned with
 * Playwright's own documented locator-resilience guidance (role/label are
 * the most resilient; free text content is more likely to change; raw
 * CSS/id/class selectors are the most brittle) — not measured or learned
 * from real UI-change data, and not specific to any target site.
 *
 * Note: LocatorCandidate.strategy only has 'role' | 'label' | 'text' | 'css'
 * buckets (matching this story's stated priority order, which itself omits
 * testid). A getByTestId(...) selector is grouped under 'role': both are
 * explicit, intentional identifiers and sit in Playwright's top resilience
 * tier, even though "testid" isn't a literal strategy value here.
 */
export function scoreLocator(selector: string): LocatorCandidate {
  if (/\.getByTestId\(/.test(selector)) {
    return { selector, strategy: 'role', confidence: 97 };
  }
  if (/\.getByRole\(/.test(selector)) {
    return { selector, strategy: 'role', confidence: 96 };
  }
  if (/\.getByLabel\(/.test(selector)) {
    return { selector, strategy: 'label', confidence: 95 };
  }
  if (/\.getByPlaceholder\(/.test(selector)) {
    return { selector, strategy: 'label', confidence: 85 };
  }
  if (/\.getByText\(/.test(selector)) {
    return { selector, strategy: 'text', confidence: 80 };
  }
  // An opaque generated identifier (long hex/hash run) carries zero semantic
  // signal to extract a role/label/text from — score it lower than a plain
  // CSS selector that at least has a readable class/id name, and say so
  // specifically rather than the generic brittle-locator message.
  if (OPAQUE_HASH_PATTERN.test(selector)) {
    return { selector, strategy: 'css', confidence: 15 };
  }
  return { selector, strategy: 'css', confidence: 40 };
}

function warningsFor(candidate: LocatorCandidate, type: OptimizedAction['type']): string[] {
  // 'navigation' events don't target an element (selector is just the 'page'
  // placeholder), so locator warnings/suggestions don't apply to them.
  if (type === 'navigation') return [];

  if (candidate.confidence < SUGGEST_THRESHOLD) {
    if (OPAQUE_HASH_PATTERN.test(candidate.selector)) {
      return [
        'Opaque generated identifier — no semantic signal (role/label/text) available to suggest a replacement. Consider adding a stable data-testid attribute to this element.'
      ];
    }
    return [
      'CSS/structural locator is brittle across UI changes — prefer a role, label, or data-testid locator.'
    ];
  }
  if (candidate.confidence < REPLACE_THRESHOLD) {
    return [
      `Suggestion: ${candidate.strategy} locator is usable (confidence ${candidate.confidence}) but a role- or label-based locator would be more resilient.`
    ];
  }
  return [];
}

/**
 * Scores each action's current selector and attaches the result as
 * `locatorCandidate`. Per the confidence rules:
 *   >=90      -> "replace automatically" with the winning candidate (always
 *                the action's own selector — see scoreLocator's doc comment)
 *   70-89     -> keep the original selector, emit a suggestion
 *   <70       -> keep the original selector, emit the existing brittle warning
 *                (or a more specific opaque-identifier warning — see scoreLocator)
 * `selector` is never rewritten to a fabricated alternative at any tier.
 */
export class LocatorPlugin implements OptimizerPlugin {
  name = 'LocatorPlugin';
  order = 40;

  optimize(events: OptimizedAction[]): OptimizedAction[] {
    return events.map((action) => {
      const candidate = scoreLocator(action.selector);
      const selector = candidate.confidence >= REPLACE_THRESHOLD ? candidate.selector : action.selector;

      return {
        ...action,
        selector,
        locatorQuality: classifyLocatorQuality(action.selector),
        locatorCandidate: candidate,
        warnings: warningsFor(candidate, action.type)
      };
    });
  }
}
