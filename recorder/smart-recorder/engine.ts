import { buildDialogEvent, buildDownloadEvent, buildInteractionEvent, buildLocatorMetadata, buildNavigationEvent } from './eventBuilder';
import { classifyIntent } from './intentClassifier';
import { NavigationTracker } from './navigationTracker';
import type { DetectionContext, IntentEntry, RawLocatorFact, RecordedEvent, RecordedEventType } from './types';

/**
 * Smart Recorder orchestrator (Sprint 5.4): one instance per recording
 * session (holds per-session NavigationTracker state, so it must not be
 * shared across sessions). Wires eventBuilder + intentClassifier +
 * navigationTracker together into the small pipeline every capture point
 * in the main recorder/engine.ts calls into: build an immutable
 * RecordedEvent from the raw captured fact, classify its business intent,
 * feed the navigation tracker so later navigations can be attributed
 * correctly. Consumes ApplicationMetadata/PageMetadata/FrameMetadata as
 * given (a DetectionContext snapshot) — never recomputes or redesigns the
 * Context Engine that produced them.
 */
export class SmartRecorderEngine {
  private readonly navigationTracker = new NavigationTracker();

  recordInteraction(
    type: Exclude<RecordedEventType, 'navigation' | 'dialog' | 'download'>,
    raw: RawLocatorFact,
    frameSelector: string | undefined,
    value: string | undefined,
    context: DetectionContext
  ): { event: RecordedEvent; intent: IntentEntry } {
    const locator = buildLocatorMetadata(raw, frameSelector);
    const event = buildInteractionEvent({ type, locator, value, context });
    this.navigationTracker.recordAction(event);
    const intent = classifyIntent(event);
    return { event, intent };
  }

  recordNavigation(fromUrl: string, toUrl: string, context: DetectionContext): { event: RecordedEvent; intent: IntentEntry } {
    const navigation = this.navigationTracker.buildNavigation(fromUrl, toUrl);
    const event = buildNavigationEvent(navigation, context);
    const intent = classifyIntent(event);
    return { event, intent };
  }

  recordDialog(dialogType: string, message: string, context: DetectionContext): { event: RecordedEvent; intent: IntentEntry } {
    const event = buildDialogEvent(dialogType, message, context);
    return { event, intent: classifyIntent(event) };
  }

  recordDownload(filename: string, context: DetectionContext): { event: RecordedEvent; intent: IntentEntry } {
    const event = buildDownloadEvent(filename, context);
    return { event, intent: classifyIntent(event) };
  }
}
