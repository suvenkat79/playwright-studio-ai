import { RecordedAction } from '../types';
import { OptimizedAction } from './optimizer/types';
import { classifyLocatorQuality } from './optimizer/LocatorPlugin';
import { defaultOptimizerPipeline } from './optimizer/OptimizerPipeline';

/**
 * Optimizer Pipeline — public entry point.
 *
 * The actual pipeline stages (TypingMergePlugin, CredentialPlugin,
 * SmartWaitPlugin, NavigationParamPlugin, LocatorPlugin, DynamicDataPlugin,
 * ActionAbstractionPlugin) live in ./optimizer/ as a true plugin-based
 * framework: each implements the shared OptimizerPlugin interface (name,
 * order, optimize()) and is discovered/ordered by OptimizerPipeline. See
 * ./optimizer/OptimizerPipeline.ts for the discovery/execution mechanics
 * and ./optimizer/types.ts for the OptimizerPlugin contract.
 *
 *   Recorded Events -> TypingMergePlugin -> CredentialPlugin -> SmartWaitPlugin
 *                    -> NavigationParamPlugin -> LocatorPlugin -> DynamicDataPlugin
 *                    -> ActionAbstractionPlugin -> PlaywrightGenerator
 *
 * This file stays the stable public surface (optimizeRecordedActions,
 * generateOptimizedSpec, summarizeOptimizedActions) that RecordingContext
 * and LiveRecorderView import — internal restructuring into ./optimizer/
 * plugin classes does not change any of these signatures.
 *
 * No LLM call happens anywhere in this pipeline — every stage is a plain,
 * explainable, deterministic transformation.
 */
export type { LocatorQuality, LocatorCandidate, OptimizedAction, OptimizerPlugin } from './optimizer/types';
export { classifyLocatorQuality } from './optimizer/LocatorPlugin';
export { OptimizerPipeline, defaultOptimizerPipeline } from './optimizer/OptimizerPipeline';

function toOptimized(action: RecordedAction): OptimizedAction {
  const selector = action.selector.replace(/[\r\n\t]+/g, ' ');
  return {
    id: action.id,
    type: action.type,
    selector,
    value: action.value,
    timestamp: action.timestamp,
    codeLine: action.codeLine.replace(/[\r\n\t]+/g, ' '),
    url: action.url,
    frameSelector: action.frameSelector,
    isSensitive: action.isSensitive,
    variableName: action.variableName,
    identitySelector: action.identitySelector,
    // Computed here (not deferred to LocatorPlugin) because TypingMergePlugin
    // needs quality ranking *during* merge to keep the better of two
    // representations of the same field. LocatorPlugin still owns the final
    // warnings/locatorCandidate annotation.
    locatorQuality: classifyLocatorQuality(selector),
    mergedFromCount: 1,
    warnings: []
  };
}

function isSubmitButton(action: OptimizedAction): boolean {
  return action.type === 'click' &&
    /getByRole\(\s*['"]button['"]\s*,\s*\{\s*name:\s*['"](?:submit|update|save)['"]/i
      .test(action.selector);
}

function disambiguateSubmitLocator(action: OptimizedAction, locator: string): string {
  return isSubmitButton(action) ? `${locator}.first()` : locator;
}

function visibleFirstLocator(action: OptimizedAction, locator: string): string {
  if (!/\.getBy(?:Role|Label|Placeholder|Text)\(/.test(action.selector)) {
    return locator;
  }
  return /\.first\(\)$/.test(locator)
    ? locator
    : `${locator}.filter({ visible: true }).first()`;
}

function visibleFirstAction(action: OptimizedAction, codeLine: string): string {
  if (
    action.type === 'navigation' ||
    !/\.getBy(?:Role|Label|Placeholder|Text)\(/.test(action.selector)
  ) {
    return codeLine;
  }

  return codeLine.replace(/\.(click|fill|selectOption|check|uncheck)\(/, (match, method: string, offset: number, source: string) => {
    const locatorExpression = source.slice(0, offset);
    if (/\.filter\(\{\s*visible:\s*true\s*\}\)\.first\(\)$/.test(locatorExpression)) {
      return match;
    }
    if (/\.first\(\)$/.test(locatorExpression)) {
      return match;
    }
    return `.filter({ visible: true }).first().${method}(`;
  });
}

function isNewButton(action: OptimizedAction): boolean {
  return action.type === 'click' &&
    /getByRole\(\s*['"]button['"]\s*,\s*\{\s*name:\s*['"]new['"]/i
      .test(action.selector);
}

/**
 * Searches for a matching action within the current "flow" only — a New ->
 * fill -> Submit sequence spans exactly one navigation (the blank form's
 * own page load after clicking New), so scanning must tolerate crossing
 * that one boundary — but not further, rather than scanning the rest of
 * the whole recording. Found live in a real, richer ServiceNow recording
 * (create one incident, then separately open and edit a second): the
 * previous unbounded search for a "submit button ahead" crossed three
 * navigation boundaries and picked up an Update click that belonged to
 * editing the *second*, unrelated incident, producing a readiness check
 * for a button that was nowhere near the page the script had actually
 * just landed on (that record has no "Update" button at all — it's the
 * list page). Allowing exactly one crossing keeps the legitimate New ->
 * Submit case working while still stopping well before a second,
 * unrelated record's own open/edit/save cycle.
 */
function findInSegment(
  actions: OptimizedAction[],
  fromIndex: number,
  direction: 1 | -1,
  predicate: (action: OptimizedAction) => boolean,
  maxNavigationsCrossed: number = 1
): OptimizedAction | undefined {
  let navigationsCrossed = 0;
  for (let i = fromIndex; i >= 0 && i < actions.length; i += direction) {
    const item = actions[i];
    if (item.type === 'navigation') {
      navigationsCrossed += 1;
      if (navigationsCrossed > maxNavigationsCrossed) return undefined;
      continue;
    }
    if (predicate(item)) return item;
  }
  return undefined;
}

function isRedundantClickBeforeFrameNavigation(
  actions: OptimizedAction[],
  index: number
): boolean {
  const action = actions[index];
  const navigation = actions[index + 1];
  const nextAction = actions.slice(index + 2).find((item) => item.type !== 'navigation');

  return action.type === 'click' &&
    navigation?.type === 'navigation' &&
    nextAction?.type === 'fill' &&
    action.selector === nextAction.selector &&
    Boolean(action.frameSelector) &&
    action.frameSelector === nextAction.frameSelector;
}

function toFrameAliasedLocator(
  selector: string,
  frameSelector: string | undefined,
  frameAliases: Map<string, string>
): string {
  if (!frameSelector) return selector;
  const alias = frameAliases.get(frameSelector);
  if (!alias) return selector;
  const frameLocator = `page.frameLocator(${JSON.stringify(frameSelector)})`;
  return selector.startsWith(`${frameLocator}.`)
    ? selector.replace(`${frameLocator}.`, `${alias}.`)
    : selector.replace(/^page\./, `${alias}.`);
}

/**
 * Opener-resilience: a click whose real job is to reveal something (a menu,
 * dropdown, panel) is, to Playwright, indistinguishable from any other
 * click — .click() only confirms the click was dispatched, never that the
 * expected UI effect actually happened. Found live: a real ServiceNow run
 * clicked "additional actions" successfully, but the resulting menu never
 * opened (confirmed via the actual failure screenshot — no menu visible
 * anywhere), and the very next click ("Save", meant to be inside that menu)
 * timed out waiting for a target that was never there to begin with.
 *
 * Generic, not menu-specific and not tied to any one button/site: applies
 * to any click immediately followed (no navigation in between) by another
 * interaction on a *different* target in the *same* frame — the same
 * structural shape as "click something, then interact with whatever it
 * revealed," regardless of what that something is. Verifies the next
 * target is visible first; if it isn't, retries the previous click once
 * (self-healing a timing/event-binding race — the most common real cause),
 * then lets the actual action below proceed either way. Bounded and safe:
 * when the target was already visible (the overwhelmingly common case —
 * most consecutive actions have nothing to do with each other), the
 * waitFor resolves immediately at negligible cost. When the target
 * genuinely never becomes available (not a timing issue — the action truly
 * isn't offered), this adds one harmless extra click before the real
 * action's own click/fill surfaces the same clear timeout it would have
 * anyway — the retry never hides or changes the final failure.
 */
function buildOpenerResilienceSnippet(
  actions: OptimizedAction[],
  index: number,
  frameAliases: Map<string, string>
): string {
  const action = actions[index];
  const prior = actions[index - 1];

  const targetIsInteraction = action.type === 'click' || action.type === 'fill' || action.type === 'select';
  if (!targetIsInteraction || !prior || prior.type !== 'click') return '';
  if (prior.selector === action.selector) return '';
  if (prior.frameSelector !== action.frameSelector) return '';

  const openerLocator = toFrameAliasedLocator(prior.selector, prior.frameSelector, frameAliases);
  const targetLocator = toFrameAliasedLocator(action.selector, action.frameSelector, frameAliases);

  return (
    `  await ${targetLocator}.waitFor({ state: 'visible', timeout: 5000 }).catch(async () => {\n` +
    `    await ${openerLocator}.click();\n` +
    `    await ${targetLocator}.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});\n` +
    `  });\n`
  );
}

/**
 * Identity-anchored replay: a link captured with a stable resource
 * identifier (see recorder/locatorGenerator.ts#extractLinkIdentity) should
 * re-target that exact record on replay rather than "whichever record the
 * generic pattern matches first" — found live: a real ServiceNow run
 * clicked a different incident than the one recorded, because the list is
 * sorted by last-updated and every successful run reshuffles it. Tries the
 * identity-anchored selector first (matches what was actually recorded);
 * if that record is gone by replay time (deleted, different environment,
 * different test data), falls back to the existing generic selector rather
 * than failing outright — so this never makes replay *more* brittle than
 * it already was, only more precise when the exact record is still there.
 */
function buildIdentityAnchoredSnippet(
  action: OptimizedAction,
  frameAliases: Map<string, string>
): string | null {
  if (action.type !== 'click' || !action.identitySelector) return null;

  const identityLocator = toFrameAliasedLocator(
    `page.locator(${JSON.stringify(action.identitySelector)})`,
    action.frameSelector,
    frameAliases
  );
  const fallbackLocator = visibleFirstLocator(
    action,
    toFrameAliasedLocator(action.selector, action.frameSelector, frameAliases)
  );
  const varName = `identityTarget_${action.id.replace(/[^a-zA-Z0-9_]/g, '_')}`;

  return (
    `  const ${varName} = (await ${identityLocator}.count()) > 0\n` +
    `    ? ${identityLocator}.first()\n` +
    `    : ${fallbackLocator};\n` +
    `  await ${varName}.click();`
  );
}

/**
 * Extracts the actual classic-UI resource name (e.g. "incident.do") a URL
 * ultimately points at, unwrapping ServiceNow's own redirector shape first
 * when present: `.../now/nav/ui/classic/params/target/<url-encoded target>`
 * embeds the real destination URL-encoded *inside the path*, not as a
 * normal query string — so a raw `new URL(...).pathname` comparison never
 * matches a plain `incident.do?...` URL against its own wrapped form even
 * when they're the identical destination (confirmed live: this is exactly
 * why the first version of isSameUrlReload below never fired for a real
 * Save click, despite Save and its resulting reload genuinely being the
 * same page). Decoding first and pulling out the last `something.do`
 * segment sidesteps the wrapper entirely — not ServiceNow-specific in
 * mechanism, just tolerant of a URL whose real target is itself encoded
 * inside it, which redirector-style navigations commonly do.
 */
function extractResourceName(url: string): string | null {
  let decoded = url;
  try {
    for (let i = 0; i < 3; i++) {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    }
  } catch {
    // Malformed percent-encoding — fall back to whatever decoded so far.
  }
  const match = /([a-zA-Z0-9_]+\.do)(?:[?/&]|$)/.exec(decoded);
  return match ? match[1] : null;
}

/**
 * True when a captured navigation's resulting URL points at the same
 * classic-UI resource as the URL the browser was already on before the
 * triggering click — i.e. no real cross-page navigation happened at all.
 * Found live on a real ServiceNow instance: its "Save" menu item
 * (title="Save record and remain here") submits via gsftSubmit() through
 * the #gsft_main iframe's own hidden form post — the resource never
 * changes (still incident.do), so this is exactly the signature it leaves
 * behind, regardless of which app or button produces it.
 */
function isSameUrlReload(action: OptimizedAction, previousAction: OptimizedAction | undefined): boolean {
  if (!action.url || !previousAction?.url) return false;
  const after = extractResourceName(action.url);
  const before = extractResourceName(previousAction.url);
  return Boolean(after && before && after === before);
}

/**
 * A same-URL, iframe-scoped reload (see isSameUrlReload) has no top-level
 * navigation and no new 'load' event for action.codeLine's waitForURL to
 * catch — confirmed live: Playwright's own trace shows "waiting for
 * scheduled navigations to finish" resolving in ~15ms with "not waiting,
 * load event already fired" right after that click, because the URL
 * pattern it checks was already true before the click happened. A generic
 * network-quiescence check doesn't fix this either — also tried and also
 * confirmed ineffective live: ServiceNow's own cancel_my_transaction.do
 * call fired for that exact submission's interaction_id immediately after
 * the *next* action started, direct proof the server-side transaction the
 * reload represents was still in flight when we moved on, even though the
 * browser's network had already gone idle.
 *
 * The real completion signal is the iframe's own next 'load' event — the
 * same technique already used for the very first list -> record
 * transition — so wait for that instead when this shape is detected.
 * Scoped narrowly to same-URL reloads specifically (not every
 * frame-scoped click) because a click that *does* lead to a genuine
 * cross-page navigation can remove the iframe from the DOM entirely
 * (e.g. Update replacing the whole page with the incident list); attaching
 * a 'load' listener to a frame about to be detached is unreliable, and
 * that case already has a real, working waitForURL to rely on instead.
 */
function buildUrlWait(action: OptimizedAction, previousAction: OptimizedAction | undefined): string {
  if (!action.codeLine) return '';

  if (isSameUrlReload(action, previousAction) && previousAction?.frameSelector) {
    return (
      `  await page.locator(${JSON.stringify(previousAction.frameSelector)}).evaluate((element) => new Promise<void>((resolve) => {\n` +
      `    const frame = element as HTMLIFrameElement;\n` +
      `    frame.addEventListener('load', () => resolve(), { once: true });\n` +
      `  }));\n`
    );
  }

  return `  ${action.codeLine}\n`;
}

/**
 * Converts raw recorded events into optimized ones by running the full
 * Optimizer Pipeline. Never mutates `actions` or its elements — the
 * original recorded events the caller passed in are left untouched.
 */
export function optimizeRecordedActions(actions: RecordedAction[]): OptimizedAction[] {
  const initial = actions.map(toOptimized);
  return defaultOptimizerPipeline.run(initial);
}

/**
 * PlaywrightGenerator — the final pipeline stage: renders an optimized
 * action list into a ready-to-run Playwright spec, mirroring the same
 * template shape recorder/engine.ts#generatePlaywrightSpec uses for raw
 * recordings, so optimized and raw output stay visually consistent.
 */
export function generateOptimizedSpec(actions: OptimizedAction[], targetUrl: string): string {
  const frameSelectors = [...new Set(actions
    .map((action) => action.frameSelector)
    .filter((selector): selector is string => Boolean(selector)))];
  const frameAliases = new Map(frameSelectors.map((selector, index) => [
    selector,
    selector === '#gsft_main' ? 'main' : `frame${index + 1}`
  ]));
  const frameDeclarations = frameSelectors
    .map((selector) => {
      const quotedSelector = `'${selector.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
      return `    const ${frameAliases.get(selector)} = page.frameLocator(${quotedSelector});`;
    })
    .join('\n');

  const actionsCode = actions.map((action, index) => {
    if (isRedundantClickBeforeFrameNavigation(actions, index)) {
      return '';
    }

    if (action.type === 'navigation') {
      const previousAction = actions.slice(0, index).reverse().find((item) => item.type !== 'navigation');
      const nextAction = actions.slice(index + 1).find((item) => item.type !== 'navigation');
      const frameSelector = previousAction?.frameSelector;
      const frameAlias = frameSelector ? frameAliases.get(frameSelector) : undefined;

      if (!frameSelector && action.codeLine && nextAction?.frameSelector) {
        const nextFrameAlias = frameAliases.get(nextAction.frameSelector);
        if (nextFrameAlias) {
          const frameLocator = `page.frameLocator(${JSON.stringify(nextAction.frameSelector)})`;
          const locator = nextAction.selector.startsWith(`${frameLocator}.`)
            ? nextAction.selector.replace(`${frameLocator}.`, `${nextFrameAlias}.`)
            : nextAction.selector.replace(/^page\./, `${nextFrameAlias}.`);
          const visibleLocator = visibleFirstLocator(nextAction, locator);
          const iframeLoadWait =
            `  await page.locator(${JSON.stringify(nextAction.frameSelector)}).evaluate((element) => new Promise<void>((resolve) => {\n` +
            `    const frame = element as HTMLIFrameElement;\n` +
            `    if (frame.contentDocument?.readyState === 'complete') {\n` +
            `      resolve();\n` +
            `      return;\n` +
            `    }\n` +
            `    frame.addEventListener('load', () => resolve(), { once: true });\n` +
            `  }));`;
          const clickHandlerReadyWait = nextAction.type === 'click'
            ? `\n  await expect.poll(async () => ${visibleLocator}.evaluate((element) => {\n` +
              `    const handler = element.getAttribute('onclick') ?? '';\n` +
              `    const globalName = /(?:^|;|\\breturn\\s+)([A-Za-z_$][\\w$]*)\\s*\\./.exec(handler)?.[1];\n` +
              `    return !globalName || typeof Reflect.get(window, globalName) !== 'undefined';\n` +
              `  }), { timeout: 10000 }).toBe(true);`
            : '';
          return `  ${action.codeLine}\n${iframeLoadWait}\n  await expect(${visibleLocator}).toBeVisible();${clickHandlerReadyWait}`;
        }
      }

      if (frameSelector && frameAlias && previousAction?.type === 'click') {
        const priorNewButton = findInSegment(
          actions, index - 1, -1,
          (item) => item.frameSelector === frameSelector && isNewButton(item)
        );
        if (priorNewButton) {
          const capturedSubmitButton = findInSegment(
            actions, index + 1, 1,
            (item) => item.frameSelector === frameSelector && isSubmitButton(item)
          );
          if (capturedSubmitButton) {
            const frameLocator = `page.frameLocator(${JSON.stringify(frameSelector)})`;
            const locator = capturedSubmitButton.selector.startsWith(`${frameLocator}.`)
              ? capturedSubmitButton.selector.replace(`${frameLocator}.`, `${frameAlias}.`)
              : capturedSubmitButton.selector.replace(/^page\./, `${frameAlias}.`);
            // Keep the real URL wait (action.codeLine) ahead of the
            // readiness assertion — see the note on the incident_list.do
            // branch below for why: an assertion alone doesn't confirm we
            // actually arrived at the expected page, only that the target
            // eventually became visible, which can pass even when the
            // "right page" checked is actually stale/wrong.
            const urlWait = buildUrlWait(action, previousAction);
            return `${urlWait}  await expect(${visibleFirstLocator(capturedSubmitButton, disambiguateSubmitLocator(capturedSubmitButton, locator))}).toBeVisible();`;
          }
        }

        if (isSubmitButton(previousAction)) {
          const capturedNewButton = findInSegment(
            actions, index - 1, -1,
            (item) => item.frameSelector === frameSelector && isNewButton(item)
          );

          if (capturedNewButton) {
            const frameLocator = `page.frameLocator(${JSON.stringify(frameSelector)})`;
            const locator = capturedNewButton.selector.startsWith(`${frameLocator}.`)
              ? capturedNewButton.selector.replace(`${frameLocator}.`, `${frameAlias}.`)
              : capturedNewButton.selector.replace(/^page\./, `${frameAlias}.`);
            const urlWait = buildUrlWait(action, previousAction);
            return `${urlWait}  await expect(${locator}).toBeVisible();`;
          }
        }

        const navigationTarget = `${action.url ?? ''} ${action.codeLine}`;
        let readinessAssertion = 'toBeVisible';
        const targetSelector = nextAction?.frameSelector === frameSelector
          ? nextAction.type === 'fill'
            ? (() => {
              // Reuse the fill action's own already-proven locator for the
              // readiness check, rather than transforming it into a
              // different strategy (e.g. getByLabel -> getByRole('textbox'))
              // that was never actually confirmed to resolve on the real
              // page — found live: that transformation, and an earlier
              // hardcoded CSS-ID guess before it, both failed with
              // "element(s) not found" against a real ServiceNow instance,
              // while the untouched fill locator below has always
              // succeeded. Same locator for both means the readiness check
              // can never disagree with the fill it's guarding.
              readinessAssertion = 'toBeEditable';
              return nextAction.selector;
            })()
            : nextAction.selector
          : /incident_list\.do/i.test(navigationTarget)
            ? "page.getByRole('button', { name: 'New' })"
            : undefined;

        if (targetSelector) {
          const frameLocator = `page.frameLocator(${JSON.stringify(frameSelector)})`;
          const locator = targetSelector.startsWith(`${frameLocator}.`)
            ? targetSelector.replace(`${frameLocator}.`, `${frameAlias}.`)
            : targetSelector.replace(/^page\./, `${frameAlias}.`);
          const readinessLocator = nextAction
            ? visibleFirstLocator(
                nextAction,
                disambiguateSubmitLocator(nextAction, locator)
              )
            : locator;
          // Keep the real URL wait (action.codeLine, already generated by
          // NavigationParamPlugin/DynamicDataPlugin) ahead of the readiness
          // assertion rather than replacing it — found live against a real
          // ServiceNow instance twice now: after a click that triggers a
          // genuine server round-trip (a form-submit button's gsftSubmit(),
          // or a GlideList2 action), Playwright's own "waiting for
          // scheduled navigations to finish" can resolve before the real
          // navigation actually completes, so an element-readiness check
          // alone starts polling too early — it can find *some* matching
          // element and pass without us actually having arrived at the
          // expected page. Waiting for the real URL first, the same way
          // every other navigation in the script already does, confirms
          // we're genuinely on the right page before checking anything on
          // it; the readiness assertion after it is a real extra safety
          // layer, not the only check.
          const urlWait = buildUrlWait(action, previousAction);
          if (readinessAssertion === 'toBeEditable') {
            return `${urlWait}  await expect(\n    ${locator}\n  ).toBeEditable();`;
          }
          return `${urlWait}  await expect(${readinessLocator}).toBeVisible();`;
        }
      }
    }

    const identitySnippet = buildIdentityAnchoredSnippet(action, frameAliases);
    if (identitySnippet) {
      const openerResilience = buildOpenerResilienceSnippet(actions, index, frameAliases);
      return `${openerResilience}${identitySnippet}`;
    }

    let codeLine = action.codeLine;
    if (action.frameSelector && action.type !== 'press') {
      const frameLocator = `page.frameLocator(${JSON.stringify(action.frameSelector)})`;
      if (!codeLine.startsWith(`await ${frameLocator}.`)) {
        codeLine = codeLine.replace(/^(\s*await )page\./, (_match, prefix: string) => `${prefix}${frameLocator}.`);
      }
      codeLine = codeLine.replace(`await ${frameLocator}.`, `await ${frameAliases.get(action.frameSelector)}.`);

      if (action.type === 'click' && /name:\s*\//.test(codeLine)) {
        codeLine = codeLine.replace(/\.click\(\);?$/, '.first().click();');
      }
    }
    if (isSubmitButton(action)) {
      codeLine = codeLine.replace(/\.click\(\);?$/, '.first().click();');
    }
    codeLine = visibleFirstAction(action, codeLine);
    const openerResilience = buildOpenerResilienceSnippet(actions, index, frameAliases);
    return `${openerResilience}  ${codeLine}`;
  }).join('\n');

  return `import { test, expect } from '@playwright/test';

test.describe('Optimized User Journey: ${targetUrl}', () => {
  test('Execute optimized actions', async ({ page }) => {
    // Generated by the Optimizer Pipeline: TypingMerge -> Credential -> SmartWait -> Locator -> PlaywrightGenerator.
    // Derived from the recorded session — the original recorded events are never modified.

${frameDeclarations ? `${frameDeclarations}\n\n` : ''}${actionsCode || '    // No actions were recorded.'}

    // Post-execution assertion
    await expect(page).toHaveURL(/.+/);
  });
});
`;
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
