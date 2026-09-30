import { ApplicationMetadata, BrowserFacts } from '../../types';
import { PageMetadata } from '../../page-detector/types';
import { FrameDetector, FrameMetadata } from '../types';
import { flattenFrameHierarchy, framePathFor, selectorForFrameNode, FlatFrameCandidate } from '../frameSelector';

/**
 * Generic content keywords for a "this iframe is probably the meaningful
 * interaction target" signal — not tied to any one named provider (Stripe,
 * PayPal, ...), just common semantic terms real third-party content iframes
 * use in their id/name/src. Works for any application, using only
 * BrowserFacts.
 */
const GENERIC_FRAME_KEYWORDS = ['payment', 'checkout', 'pay', 'document', 'viewer'];

/**
 * Fallback of last resort — always matches, so every recording session
 * ends up with SOME FrameMetadata rather than none:
 *  - No iframes at all → confidently MainFrame (the top document), 1.0.
 *  - Iframes present, one scores against the generic keyword/uniqueness
 *    heuristics below → that candidate wins, confidence reflects how many
 *    signals fired.
 *  - Iframes present but none match anything → still MainFrame, but at a
 *    low fixed confidence (0.3, the same "we don't actually know" floor
 *    used by GenericWebProvider/GenericPageProvider) — this is the SAFE
 *    default: guessing the wrong frame would silently corrupt recorded
 *    interactions, so "assume main frame" is the conservative choice under
 *    genuine uncertainty, not a cop-out.
 */
export class GenericFrameProvider implements FrameDetector {
  readonly providerName = 'Generic';

  detect(facts: BrowserFacts, _application: ApplicationMetadata, _page: PageMetadata): FrameMetadata {
    const candidates = flattenFrameHierarchy(facts.iframeHierarchy);

    if (candidates.length === 0) {
      return {
        frameType: 'MainFrame',
        frameSelector: null,
        framePath: [],
        confidence: 1,
        signals: ['no-iframes-present']
      };
    }

    const maxScore = 4;
    let best: { candidate: FlatFrameCandidate; score: number; signals: string[] } | null = null;

    for (const candidate of candidates) {
      const fired: string[] = [];
      let score = 0;
      const combined = `${candidate.node.id} ${candidate.node.name} ${candidate.node.src}`.toLowerCase();

      if (GENERIC_FRAME_KEYWORDS.some((keyword) => combined.includes(keyword))) {
        score += 2;
        fired.push('keyword-match');
      }
      if (candidates.length === 1) {
        score += 1;
        fired.push('only-iframe-on-page');
      }
      if (candidate.node.id || candidate.node.name) {
        score += 1;
        fired.push('has-stable-identifier');
      }

      if (score > 0 && (!best || score > best.score)) {
        best = { candidate, score, signals: fired };
      }
    }

    if (!best) {
      return {
        frameType: 'MainFrame',
        frameSelector: null,
        framePath: [],
        confidence: 0.3,
        signals: ['iframes-present-but-unrecognized']
      };
    }

    const framePath = framePathFor(best.candidate);
    const frameSelector = selectorForFrameNode(best.candidate.node);
    const frameType: FrameMetadata['frameType'] = framePath.length >= 2 ? 'NestedFrame' : 'MainFrame';

    return {
      frameType,
      frameSelector,
      framePath,
      confidence: Number((best.score / maxScore).toFixed(2)),
      signals: best.signals
    };
  }
}
