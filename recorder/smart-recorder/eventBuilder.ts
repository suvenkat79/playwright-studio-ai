import type {
  DetectionContext,
  LocatorMetadata,
  NavigationMetadata,
  RawLocatorFact,
  RecordedEvent,
  RecordedEventType
} from './types';

/** No-op locator for event types that have no target element (navigation,
 * dialog, download) — an explicit, honest "not applicable" shape rather
 * than a fabricated/guessed one. */
const NO_TARGET_LOCATOR: LocatorMetadata = Object.freeze({ strategy: 'css', tag: '' });

export function buildLocatorMetadata(raw: RawLocatorFact, frameSelector?: string): LocatorMetadata {
  return Object.freeze({
    strategy: raw.strategy,
    tag: raw.tag,
    role: raw.role,
    text: raw.text,
    label: raw.label,
    placeholder: raw.placeholder,
    testId: raw.testId,
    id: raw.id,
    cssSelector: raw.cssSelector,
    frameSelector
  });
}

let sequence = 0;
function nextEventId(): string {
  sequence += 1;
  return `sevt_${Date.now()}_${sequence}`;
}

interface BuildInteractionParams {
  type: Exclude<RecordedEventType, 'navigation' | 'dialog' | 'download'>;
  locator: LocatorMetadata;
  value?: string;
  context: DetectionContext;
}

export function buildInteractionEvent(params: BuildInteractionParams): RecordedEvent {
  return Object.freeze({
    id: nextEventId(),
    timestamp: Date.now(),
    application: params.context.application,
    page: params.context.page,
    frame: params.context.frame,
    type: params.type,
    locator: params.locator,
    value: params.value
  });
}

export function buildNavigationEvent(navigation: NavigationMetadata, context: DetectionContext): RecordedEvent {
  return Object.freeze({
    id: nextEventId(),
    timestamp: Date.now(),
    application: context.application,
    page: context.page,
    frame: context.frame,
    type: 'navigation' as const,
    locator: NO_TARGET_LOCATOR,
    navigation
  });
}

export function buildDialogEvent(dialogType: string, message: string, context: DetectionContext): RecordedEvent {
  return Object.freeze({
    id: nextEventId(),
    timestamp: Date.now(),
    application: context.application,
    page: context.page,
    frame: context.frame,
    type: 'dialog' as const,
    locator: NO_TARGET_LOCATOR,
    value: `${dialogType}: ${message}`
  });
}

export function buildDownloadEvent(filename: string, context: DetectionContext): RecordedEvent {
  return Object.freeze({
    id: nextEventId(),
    timestamp: Date.now(),
    application: context.application,
    page: context.page,
    frame: context.frame,
    type: 'download' as const,
    locator: NO_TARGET_LOCATOR,
    value: filename
  });
}
