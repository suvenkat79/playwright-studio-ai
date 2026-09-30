import { ApplicationDetector, ApplicationMetadata, BrowserFacts } from '../types';

/**
 * Fallback of last resort — always matches, at a low fixed confidence, so
 * every recording session ends up with SOME ApplicationMetadata rather than
 * none. Whichever specific provider scores highest wins over this one (see
 * engine.ts's orchestration); this only surfaces when nothing else
 * recognized the page at all.
 */
export class GenericWebProvider implements ApplicationDetector {
  readonly application = 'Generic Web';

  detect(_facts: BrowserFacts): ApplicationMetadata {
    return {
      application: this.application,
      confidence: 0.3,
      signals: ['fallback:no-specific-provider-matched']
    };
  }
}
