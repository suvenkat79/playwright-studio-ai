import { OptimizedAction, OptimizerPlugin } from './types';

/**
 * Extracts the actual classic-UI resource name (e.g. "incident.do") a URL
 * ultimately points at, unwrapping a redirector shape first when present
 * (`.../now/nav/ui/classic/params/target/<url-encoded target>` embeds the
 * real destination URL-encoded *inside the path*, not as a normal query
 * string). Mirrors optimizerService.ts's extractResourceName exactly —
 * duplicated here rather than imported so each optimizer plugin stays a
 * self-contained module, matching the rest of this pipeline's design.
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
 * Corrects a navigation event recorded "late" relative to the interaction
 * that actually came after it. Found live: a real ServiceNow "New" button
 * click, followed immediately by the user typing into the new record's
 * first field. The recorder captures interactions and navigations over two
 * separate async channels (an exposeBinding IPC round-trip for the
 * keystroke, a framenavigated listener for the URL change) with no
 * guaranteed relative ordering — the underlying browser-side navigation
 * genuinely happened first (confirmed by the fill's own recorded `url`
 * already being the new page), but the navigation *event* arrived at the
 * recorder after the fill event, purely because of which IPC message
 * happened to be processed first. Left as recorded, the generated script
 * fills the field before waiting for the real navigation, racing a
 * possibly-stale page during replay.
 *
 * Fixed by trusting each event's own recorded `url` — a fact captured at
 * the moment it happened, immune to the ordering race — over raw array
 * position: scanning forward, if an action's url reveals we've already
 * transitioned to a page nothing has accounted for yet, and a navigation
 * event shortly ahead resolves to that same page, that navigation is
 * moved to sit immediately before the action instead of wherever the race
 * left it. Runs before every other plugin (order 5) since correct
 * ordering is foundational to everything downstream.
 */
export class NavigationOrderPlugin implements OptimizerPlugin {
  name = 'NavigationOrderPlugin';
  order = 5;

  optimize(events: OptimizedAction[]): OptimizedAction[] {
    const result = [...events];
    let knownResource = result[0]?.url ? extractResourceName(result[0].url) : null;

    for (let i = 1; i < result.length; i++) {
      const action = result[i];
      if (action.type === 'navigation') {
        knownResource = action.url ? extractResourceName(action.url) : knownResource;
        continue;
      }

      const actionResource = action.url ? extractResourceName(action.url) : null;
      if (!actionResource || actionResource === knownResource) continue;

      const searchLimit = Math.min(result.length, i + 6);
      for (let j = i + 1; j < searchLimit; j++) {
        const candidate = result[j];
        if (candidate.type === 'navigation' && candidate.url && extractResourceName(candidate.url) === actionResource) {
          const [navEvent] = result.splice(j, 1);
          result.splice(i, 0, navEvent);
          knownResource = actionResource;
          break;
        }
      }
    }

    return result;
  }
}
