import { ApplicationMetadata, BrowserFacts } from '../types';
import { PageDetector, PageMetadata } from './types';
import { ServiceNowPageProvider } from './providers/ServiceNowPageProvider';
import { GenericPageProvider } from './providers/GenericPageProvider';

/**
 * Registered page-detection providers, most-specific first. GenericPageProvider
 * always matches, so it stays last. Adding a new provider (Oracle, Workday,
 * Jira, ...) is a new file under providers/ that slots in here — nothing
 * else in this file needs to change.
 */
const PAGE_PROVIDERS: PageDetector[] = [
  new ServiceNowPageProvider(),
  new GenericPageProvider()
];

/**
 * Page-detection orchestration (Sprint 5 Phase 2): consumes the BrowserFacts
 * already collected by Phase 1's single page.evaluate() boundary — no new
 * evaluate() call happens here or anywhere in this module. Every registered
 * provider scores the same facts (plus the already-detected
 * ApplicationMetadata) — pure, no DOM access — and the highest-confidence
 * verdict wins. GenericPageProvider always matches, so this never returns
 * "nothing detected." The result is frozen for genuine runtime immutability,
 * not just compile-time `readonly`. Provider-agnostic: no application- or
 * page-type-specific logic appears in this file.
 */
export function detectPage(facts: BrowserFacts, application: ApplicationMetadata): PageMetadata {
  let best: PageMetadata | null = null;
  for (const provider of PAGE_PROVIDERS) {
    const result = provider.detect(facts, application);
    if (result && (!best || result.confidence > best.confidence)) {
      best = result;
    }
  }

  return Object.freeze(best ?? { pageType: 'Unknown', module: null, entity: null, confidence: 0.3, signals: [] });
}
