import { ApplicationMetadata, BrowserFacts } from '../../types';
import { PageDetector, PageMetadata } from '../types';

/**
 * Fallback of last resort — always matches, at a low fixed confidence, so
 * every recording session ends up with SOME PageMetadata rather than none.
 * Whichever specific provider scores highest wins over this one (see
 * engine.ts's orchestration); this only surfaces when nothing else
 * recognized the page at all. Guarantees Amazon, Oracle, Workday, or any
 * other application with no dedicated page provider yet still records
 * successfully.
 */
export class GenericPageProvider implements PageDetector {
  readonly providerName = 'Generic';

  detect(_facts: BrowserFacts, _application: ApplicationMetadata): PageMetadata {
    return {
      pageType: 'Unknown',
      module: null,
      entity: null,
      confidence: 0.3,
      signals: ['fallback:no-specific-page-provider-matched']
    };
  }
}
