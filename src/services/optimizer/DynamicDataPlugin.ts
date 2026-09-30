import { OptimizedAction, OptimizerPlugin } from './types';

/**
 * Two generic business-ID shapes, neither tied to any one vendor:
 *  1. Letter-prefix + digits: INC0010002, REQ0004567, TASK0000123,
 *     CHG0012345 — the ticketing/ITSM convention (ServiceNow, Jira, etc.).
 *  2. Hyphen-segmented all-numeric: 113-1234567-7654321 — the e-commerce/
 *     logistics convention (Amazon order numbers, many shipment/tracking
 *     IDs). No letter prefix exists in this shape, so it needs its own
 *     pattern rather than being a variant of #1.
 */
const PREFIXED_ID_PATTERN = /[A-Z]{2,6}\d{4,}/;
const SEGMENTED_NUMERIC_ID_PATTERN = /\d{3,}(?:-\d{3,}){1,}/;
const BUSINESS_ID_PATTERN = new RegExp(
  `(?:${PREFIXED_ID_PATTERN.source})|(?:${SEGMENTED_NUMERIC_ID_PATTERN.source})`
);

const REGEX_SPECIAL_CHARS = /[.*+?^${}()|[\]\\]/g;

function escapeRegex(text: string): string {
  return text.replace(REGEX_SPECIAL_CHARS, '\\$&');
}

/** Converts the matched ID substring itself into a regex fragment: for the
 * letter-prefix style, the letters stay literal and only the digits
 * generalize (INC0010002 -> INC\d+); for the segmented-numeric style, every
 * digit run generalizes and the hyphens stay literal (113-1234567-7654321
 * -> \d+-\d+-\d+), so the fragment still reflects the ID's real structure
 * instead of collapsing to a blanket wildcard. */
function idTextToRegexFragment(idText: string): string {
  const prefixed = /^([A-Z]{2,6})\d{4,}$/.exec(idText);
  if (prefixed) return `${prefixed[1]}\\d+`;
  return idText.replace(/\d+/g, '\\d+');
}

/**
 * Rule 1 — Dynamic Incident/Record/Order Numbers.
 *
 * Only ever touches selectors matching the exact
 * `page.getByRole('role', { name: '...' })` shape — i.e. selectors
 * LocatorPlugin already scores as high-confidence (role strategy,
 * confidence 96). A CSS/id fallback selector that happens to contain a
 * similar-looking numeric substring is never touched here (see Rule 3:
 * low-confidence locators are never rewritten, only flagged).
 *
 * Rewrites the locator's plain string match into a regex that generalizes
 * just the ID, keeping every other character of the accessible name
 * literal (and regex-escaped, so punctuation in the label can't be
 * misread as regex syntax).
 */
function toDynamicRoleLocator(selector: string): string | null {
  const match = /^page\.getByRole\('([a-zA-Z]+)',\s*\{\s*name:\s*'((?:[^'\\]|\\.)*)'\s*\}\)$/.exec(selector);
  if (!match) return null;

  const [, role, rawName] = match;
  const name = rawName.replace(/\\'/g, "'");

  const idMatch = BUSINESS_ID_PATTERN.exec(name);
  if (!idMatch) return null;

  const idText = idMatch[0];
  const before = name.slice(0, idMatch.index);
  const after = name.slice(idMatch.index + idText.length);
  const regexSource = `${escapeRegex(before)}${idTextToRegexFragment(idText)}${escapeRegex(after)}`;

  return `page.getByRole('${role}', {\n  name: /${regexSource}/\n})`;
}

/**
 * Rule 1b — Disambiguate overlapping accessible names with exact matching.
 *
 * Playwright's default (non-exact) getByLabel/getByText/getByPlaceholder/
 * getByRole({name}) matching is case-insensitive AND substring-based. That's
 * exactly what causes a real, common runtime failure: a password field
 * labeled "Password" sitting next to a "Show Password" visibility-toggle
 * button — non-exact getByLabel('Password') matches BOTH (the button's
 * accessible name contains "Password" as a substring), so Playwright throws
 * a strict-mode violation and refuses to act on either. This is a generic
 * Playwright pitfall, not specific to any one application.
 *
 * Since the recorder always captures an element's FULL exact accessible
 * name at record time (recorder/locatorGenerator.ts#getAccessibleName),
 * appending `{ exact: true }` still correctly re-matches the exact same
 * single element it already matched — it only prevents an accidental match
 * against a different, unrelated element whose name happens to overlap.
 * Never applied to regex-based names (Rule 1's business-ID rewrite), where
 * `exact` has no meaning — the regex pattern already matches exactly.
 */
function addExactMatch(text: string): string {
  let result = text.replace(
    /\.(getByLabel|getByText|getByPlaceholder)\('((?:[^'\\]|\\.)*)'\)/g,
    ".$1('$2', { exact: true })"
  );
  result = result.replace(
    /\.getByRole\('([a-zA-Z]+)',\s*\{\s*name:\s*'((?:[^'\\]|\\.)*)'\s*\}\)/g,
    ".getByRole('$1', { name: '$2', exact: true })"
  );
  return result;
}

/**
 * Rule 2 — Clean waitForURL predicate.
 *
 * Computed straight from the action's own `url` field (independent of
 * whatever NavigationParamPlugin already generated for `codeLine`), so this
 * never needs to parse/reverse-engineer generated code.
 *
 * `new URL(url).pathname` only excludes a *real* `?` query separator. Some
 * applications (any application, not just one vendor) encode their own
 * separator as `%3F` instead of a literal `?` — the WHATWG URL parser then
 * has no delimiter to find, and the entire encoded query string survives
 * inside `pathname` itself. QUERY_ARTIFACT_PATTERN catches that generically:
 * whichever of a real `?`/`&`/`=` or its `%3F`/`%26`/`%3D` encoded form
 * appears first, everything from that point on is query-like noise and is
 * truncated — never emitted, encoded or not.
 */
const QUERY_ARTIFACT_PATTERN = /[?&=]|%3F|%26|%3D/i;

function stripQueryArtifacts(text: string): string {
  const match = QUERY_ARTIFACT_PATTERN.exec(text);
  return match ? text.slice(0, match.index) : text;
}

function cleanWaitForUrlCodeLine(url: string): string {
  try {
    const { pathname } = new URL(url);
    const cleanPathname = stripQueryArtifacts(pathname);
    const segments = cleanPathname.split('/').filter(Boolean);
    const last = segments[segments.length - 1];

    if (!last) {
      return `await page.waitForURL(url =>\n  url.pathname === '${cleanPathname}'\n);`;
    }
    return `await page.waitForURL(url =>\n  url.pathname.includes('${last}')\n);`;
  } catch {
    return `await page.waitForURL('${url}');`;
  }
}

/**
 * DynamicDataPlugin — order 42.
 *
 * NOTE on pipeline position: this story's diagram lists DynamicData between
 * NavigationParam and Locator, but states its order as 42 — numerically
 * *after* LocatorPlugin's order 40. Rather than reordering LocatorPlugin
 * (an existing, working plugin — "preserve the existing plugin
 * architecture"), this plugin honors order=42 literally and stays fully
 * order-independent: wherever it rewrites a selector, it also updates
 * `locatorCandidate` in lockstep, so nothing downstream (or upstream) can
 * observe stale metadata regardless of exactly where 42 lands relative to
 * 40 in a future reordering.
 *
 * Rule 1 (dynamic business IDs) and Rule 2 (clean waitForURL predicates)
 * both apply here; Rule 3 (never fabricate a locator below confidence 70)
 * requires no new code — LocatorPlugin already implements it, and Rule 1's
 * detection is scoped so it can never touch a low-confidence selector in
 * the first place (see toDynamicRoleLocator's doc comment).
 */
export class DynamicDataPlugin implements OptimizerPlugin {
  name = 'DynamicDataPlugin';
  order = 42;

  optimize(events: OptimizedAction[]): OptimizedAction[] {
    let sawFirstNavigation = false;

    return events.map((action) => {
      if (action.type === 'navigation' && action.url) {
        if (!sawFirstNavigation) {
          sawFirstNavigation = true; // the initial page.goto — leave to NavigationParamPlugin's output
          return action;
        }
        return { ...action, codeLine: cleanWaitForUrlCodeLine(action.url) };
      }

      const dynamicSelector = toDynamicRoleLocator(action.selector);
      if (dynamicSelector) {
        const prefix = `await ${action.selector}`;
        const suffix = action.codeLine.startsWith(prefix) ? action.codeLine.slice(prefix.length) : '.click();';

        return {
          ...action,
          selector: dynamicSelector,
          codeLine: `await ${dynamicSelector}${suffix}`,
          locatorCandidate: action.locatorCandidate
            ? { ...action.locatorCandidate, selector: dynamicSelector }
            : action.locatorCandidate
        };
      }

      // Rule 1b: not a dynamic-ID candidate, but still worth disambiguating
      // if it's a plain string-named getByLabel/getByText/getByPlaceholder/
      // getByRole locator.
      const exactSelector = addExactMatch(action.selector);
      if (exactSelector !== action.selector) {
        return {
          ...action,
          selector: exactSelector,
          codeLine: addExactMatch(action.codeLine),
          locatorCandidate: action.locatorCandidate
            ? { ...action.locatorCandidate, selector: exactSelector }
            : action.locatorCandidate
        };
      }

      return action;
    });
  }
}
