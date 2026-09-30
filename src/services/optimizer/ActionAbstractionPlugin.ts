import { OptimizedAction, OptimizerPlugin } from './types';

function extractTextFromGetByText(selector: string): string | null {
  const match = /\.getByText\('((?:[^'\\]|\\.)*)'\)/.exec(selector);
  return match ? match[1].replace(/\\'/g, "'") : null;
}

/**
 * ActionAbstractionPlugin — upgrades the locator strategy of a click that
 * immediately follows a "menu/overflow opener" click, from a brittle plain
 * getByText(...) fallback to the semantically correct ARIA role for an item
 * revealed inside an opened menu:
 *
 *   await page.getByRole('button', { name: 'Additional actions' }).click();
 *   await page.getByText('Save').click();
 *         becomes
 *   await page.getByRole('button', { name: 'Additional actions' }).click();
 *   await page.getByRole('menuitem', { name: 'Save' }).click();
 *
 * IMPORTANT: the opener click is always preserved, never dropped. An
 * earlier version of this plugin collapsed the two clicks into one and
 * removed the opener entirely — that broke in practice, because many
 * enterprise applications only render the menu item's DOM node after the
 * opener is actually clicked; skipping the click meant the target never
 * existed for Playwright to find. Only the locator *strategy* of the second
 * click changes here — the interaction sequence itself is untouched.
 *
 * Detection is fully generic — no hardcoded vendor vocabulary ("More",
 * "Menu", "Overflow", "ServiceNow", etc.) appears anywhere here; it never
 * inspects label text, only locator *strategy*, which LocatorPlugin (the
 * stage immediately before this one) has already scored for every action.
 *
 * Confidence gate (per "never fabricate roles if confidence is low"): the
 * upgrade only fires when the OPENER's own locator is itself high-confidence
 * (strategy 'role' or 'label' — i.e. not a css/text fallback). A
 * confidently-identified opener is strong, generic evidence that this really
 * is an intentional ARIA menu-trigger interaction (menu buttons are almost
 * always given a real accessible role/label), which is what justifies
 * assigning 'menuitem' to whatever follows it. If the opener itself is only
 * weakly identified, there's no reliable signal that this is a genuine
 * open-menu pattern at all — the getByText(...) selector is left exactly as
 * LocatorPlugin scored it, never guessed at.
 *
 * Runs after LocatorPlugin (order=40) so it can rely on locatorCandidate
 * already being scored; before PlaywrightGenerator, which isn't a plugin.
 */
export class ActionAbstractionPlugin implements OptimizerPlugin {
  name = 'ActionAbstractionPlugin';
  order = 45;

  optimize(events: OptimizedAction[]): OptimizedAction[] {
    return events.map((action, i) => {
      const opener = events[i - 1];

      const openerIsHighConfidence =
        opener?.type === 'click' &&
        (opener.locatorCandidate?.strategy === 'role' || opener.locatorCandidate?.strategy === 'label');

      if (
        action.type === 'click' &&
        action.locatorCandidate?.strategy === 'text' &&
        openerIsHighConfidence
      ) {
        const text = extractTextFromGetByText(action.selector);
        if (text) {
          const selector = `page.getByRole('menuitem', { name: '${text}' })`;
          return {
            ...action,
            selector,
            codeLine: `await ${selector}.click();`,
            locatorCandidate: { selector, strategy: 'role' as const, confidence: 90 },
            warnings: []
          };
        }
      }

      return action;
    });
  }
}
