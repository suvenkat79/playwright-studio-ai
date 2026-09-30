import type { NavigationMetadata, RecordedEvent } from './types';

/** How recent the last user action must be for a navigation to be
 * attributed to it rather than treated as an automatic redirect. Chosen
 * generously — real ServiceNow navigations observed live took up to ~2s
 * between the triggering click and the resulting navigation. */
const RECENT_ACTION_WINDOW_MS = 5000;

const SUBMIT_LIKE_TEXT = /submit|update|save|log\s?in|login/;

/**
 * Tracks the most recent user action (click/press) so a subsequent
 * navigation can be attributed to what actually triggered it — captured
 * at the moment the navigation is observed, never reconstructed afterward
 * from a longer event history. One instance per recording session (holds
 * per-session state, not shared across sessions).
 */
export class NavigationTracker {
  private lastActionEvent: RecordedEvent | null = null;
  private lastActionAt = 0;

  /** Call for every interaction event (click/fill/select/press/...) as it's
   * recorded, so navigation attribution always reflects the truly most
   * recent action. Only click/press count as navigation triggers. */
  recordAction(event: RecordedEvent): void {
    if (event.type === 'click' || event.type === 'press') {
      this.lastActionEvent = event;
      this.lastActionAt = Date.now();
    }
  }

  buildNavigation(fromUrl: string, toUrl: string): NavigationMetadata {
    const elapsed = Date.now() - this.lastActionAt;

    if (!this.lastActionEvent || elapsed > RECENT_ACTION_WINDOW_MS) {
      return { fromUrl, toUrl, trigger: 'redirect' };
    }

    if (this.lastActionEvent.type === 'press') {
      return { fromUrl, toUrl, trigger: 'submit' };
    }

    const text = (this.lastActionEvent.locator.text || this.lastActionEvent.locator.label || '').toLowerCase();
    if (SUBMIT_LIKE_TEXT.test(text)) {
      return { fromUrl, toUrl, trigger: 'submit' };
    }

    return { fromUrl, toUrl, trigger: 'click' };
  }
}
