import { OptimizedAction, OptimizerPlugin } from './types';

function isSameTarget(a: OptimizedAction, b: OptimizedAction): boolean {
  return a.selector === b.selector;
}

/** Accessible name from any of the selector shapes the recorder/LocatorPlugin
 * produce — role, label, or plain text. Generic across strategies, not tied
 * to any one of them. */
function extractAccessibleName(selector: string): string | null {
  const roleMatch = /\.getByRole\('[a-zA-Z]+',\s*\{\s*name:\s*'((?:[^'\\]|\\.)*)'\s*\}\)/.exec(selector);
  if (roleMatch) return roleMatch[1];
  const labelMatch = /\.getByLabel\('((?:[^'\\]|\\.)*)'\)/.exec(selector);
  if (labelMatch) return labelMatch[1];
  const textMatch = /\.getByText\('((?:[^'\\]|\\.)*)'\)/.exec(selector);
  if (textMatch) return textMatch[1];
  return null;
}

const PASSWORD_MENTION_PATTERN = /password/i;
const VISIBILITY_ACTION_PATTERN = /show|hide|toggle|visib/i;

/**
 * True for a click on a password show/hide/toggle-visibility control — a
 * UI-only affordance, not a business action, and not meaningful to assert
 * or replay in a test. Requires BOTH a "password" mention AND a
 * show/hide/toggle/visibility word in the same accessible name, so a
 * genuine "Reset password" button (no visibility word) or an unrelated
 * "Hide advanced filters" button (no password mention) are never dropped.
 * Generic across any application — no vendor-specific label text.
 */
function isPasswordVisibilityToggle(action: OptimizedAction): boolean {
  if (action.type !== 'click') return false;
  const name = extractAccessibleName(action.selector);
  if (!name) return false;
  return PASSWORD_MENTION_PATTERN.test(name) && VISIBILITY_ACTION_PATTERN.test(name);
}

/**
 * Removes noise around navigation/interaction timing:
 *  1. A CLICK immediately followed by a FILL on the same target is redundant
 *     (Playwright's .fill() already auto-focuses the element) — drop the
 *     click, keep the fill. Deliberately excludes SELECT: a click before a
 *     dropdown/combobox/date-picker's selectOption() is frequently the thing
 *     that actually opens the widget, so removing it can break the test —
 *     only FILL-follow-ups are treated as redundant.
 *  2. Duplicate consecutive CLICK events on the same target collapse to one.
 *  3. Consecutive NAVIGATE (waitForURL) events collapse to the final URL
 *     actually reached — only meaningful navigation waits survive.
 *  4. A keyboard PRESS('Enter') immediately followed by a CLICK is redundant
 *     — both are alternate ways of submitting the same action (e.g. Enter in
 *     a password field vs. clicking "Log in"), and keeping both risks the
 *     click firing against an element the Enter-triggered submit already
 *     navigated away from. The click is the more reliable of the two, so it
 *     wins — the press is dropped.
 *  5. A click on a password show/hide/toggle-visibility control is dropped
 *     entirely — it's a UI-only affordance, not a business action.
 */
export class SmartWaitPlugin implements OptimizerPlugin {
  name = 'SmartWaitPlugin';
  order = 30;

  optimize(events: OptimizedAction[]): OptimizedAction[] {
    const businessEventsOnly = events.filter((action) => !isPasswordVisibilityToggle(action));

    const redundantInteractionsDropped: OptimizedAction[] = [];
    for (let i = 0; i < businessEventsOnly.length; i++) {
      const current = businessEventsOnly[i];
      const upcoming = businessEventsOnly[i + 1];
      if (
        current.type === 'click' &&
        upcoming &&
        upcoming.type === 'fill' &&
        isSameTarget(current, upcoming)
      ) {
        continue; // drop the redundant click; the fill itself is kept on the next iteration
      }
      if (current.type === 'press' && upcoming && upcoming.type === 'click') {
        continue; // drop the redundant Enter; the click is the more reliable action
      }
      redundantInteractionsDropped.push(current);
    }

    const output: OptimizedAction[] = [];
    for (const next of redundantInteractionsDropped) {
      const last = output[output.length - 1];

      if (last && next.type === 'click' && last.type === 'click' && isSameTarget(last, next)) {
        output[output.length - 1] = {
          ...last,
          timestamp: next.timestamp,
          mergedFromCount: last.mergedFromCount + 1
        };
        continue;
      }

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
}
