// Natural-language -> structured intent parsing for AI Gen.
//
// Deliberately rule-based, not an LLM call: this is the layer the user asked
// to be built first, with the LLM integration point identified for later
// rather than faked. A real model call can replace (or run ahead of) this
// module's pattern matching without touching anything downstream --
// resolveIntent() in engine.ts only depends on the ParsedIntent shape below,
// not on how it was produced.
//
// Each clause resolves to at most one intent. Clauses this module doesn't
// recognize are reported in `unparsed` rather than guessed at, so a caller
// can surface "couldn't understand this part" instead of silently acting on
// a misread instruction.

export interface ClickIntent {
  readonly kind: 'click';
  readonly target: string;
  readonly raw: string;
}

export interface SetIntent {
  readonly kind: 'set';
  readonly target: string;
  readonly value: string;
  readonly raw: string;
}

export type ParsedIntent = ClickIntent | SetIntent;

export interface IntentParseResult {
  readonly intents: readonly ParsedIntent[];
  readonly unparsed: readonly string[];
}

// Splits a compound instruction into clauses on top-level connectors.
// Deliberately naive (word-boundary split on "and"/"then"/","/";") -- a
// value that itself contains "and" (e.g. "set Notes to bread and butter")
// will be mis-split. Documented limitation of the rule-based layer, not
// hidden: see module header.
function splitClauses(input: string): string[] {
  return input
    .split(/\s*(?:,|;|\bthen\b|\band\b)\s*/i)
    .map((clause) => clause.trim())
    .filter((clause) => clause.length > 0);
}

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  const quoted = trimmed.match(/^["'](.*)["']$/);
  return (quoted ? quoted[1] : trimmed).trim();
}

// Ordered: first pattern to match a clause wins. "set X to Y" is checked
// before "click X" so "set Priority to 2" never gets misread as a click on
// "Priority to 2".
const SET_PATTERNS: RegExp[] = [
  /^(?:set|change|update)\s+(?:the\s+)?(.+?)\s+(?:field\s+)?to\s+(.+)$/i,
  /^fill\s+(?:the\s+)?(.+?)\s+with\s+(.+)$/i,
  /^(?:enter|type)\s+(.+?)\s+(?:in|into)\s+(?:the\s+)?(.+?)(?:\s+field)?$/i,
];

const CLICK_PATTERNS: RegExp[] = [
  /^(?:open|go\s+to|navigate\s+to)\s+(.+)$/i,
  /^(?:click|press|select|choose)\s+(?:on\s+)?(?:the\s+)?(.+?)(?:\s+button)?$/i,
];

function parseClause(clause: string): ParsedIntent | null {
  for (const pattern of SET_PATTERNS) {
    const match = clause.match(pattern);
    if (!match) continue;
    // The "enter X in Y" pattern reads value before target; every other
    // SET pattern reads target before value.
    const isValueFirst = pattern === SET_PATTERNS[2];
    const target = stripQuotes(isValueFirst ? match[2] : match[1]);
    const value = stripQuotes(isValueFirst ? match[1] : match[2]);
    if (!target || !value) continue;
    return { kind: 'set', target, value, raw: clause };
  }

  for (const pattern of CLICK_PATTERNS) {
    const match = clause.match(pattern);
    if (!match) continue;
    const target = stripQuotes(match[1]);
    if (!target) continue;
    return { kind: 'click', target, raw: clause };
  }

  return null;
}

export function parseNaturalLanguageIntent(input: string): IntentParseResult {
  const intents: ParsedIntent[] = [];
  const unparsed: string[] = [];

  for (const clause of splitClauses(input)) {
    const intent = parseClause(clause);
    if (intent) {
      intents.push(intent);
    } else {
      unparsed.push(clause);
    }
  }

  return { intents, unparsed };
}
