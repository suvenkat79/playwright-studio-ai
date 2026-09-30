import { ApplicationMetadata, BrowserFacts } from '../types';
import { PageMetadata } from '../page-detector/types';
import { FrameDetector, FrameMetadata } from './types';
import { ServiceNowFrameProvider } from './providers/ServiceNowFrameProvider';
import { GenericFrameProvider } from './providers/GenericFrameProvider';

/**
 * Registered frame-detection providers, most-specific first.
 * GenericFrameProvider always matches, so it stays last. Adding a new
 * provider (Oracle, Workday, Jira, ...) is a new file under providers/ that
 * slots in here — nothing else in this file needs to change.
 */
const FRAME_PROVIDERS: FrameDetector[] = [
  new ServiceNowFrameProvider(),
  new GenericFrameProvider()
];

/**
 * Frame-detection orchestration (Sprint 5 Phase 3): consumes the
 * BrowserFacts already collected by Phase 1's single page.evaluate()
 * boundary, plus the already-detected ApplicationMetadata and PageMetadata
 * — no new evaluate() call happens here or anywhere in this module. Every
 * registered provider scores the same facts — pure, no DOM access — and the
 * highest-confidence verdict wins. GenericFrameProvider always matches, so
 * this never returns "nothing detected." The result is frozen for genuine
 * runtime immutability, not just compile-time `readonly`. Provider-
 * agnostic: no application- or frame-specific logic appears in this file.
 */
export function detectFrame(facts: BrowserFacts, application: ApplicationMetadata, page: PageMetadata): FrameMetadata {
  let best: FrameMetadata | null = null;
  for (const provider of FRAME_PROVIDERS) {
    const result = provider.detect(facts, application, page);
    if (result && (!best || result.confidence > best.confidence)) {
      best = result;
    }
  }

  return Object.freeze(
    best ?? { frameType: 'MainFrame', frameSelector: null, framePath: [], confidence: 1, signals: ['no-iframes-present'] }
  );
}
