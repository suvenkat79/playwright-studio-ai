import { ApplicationMetadata, BrowserFacts } from '../../types';
import { PageMetadata } from '../../page-detector/types';
import { FrameDetector, FrameMetadata } from '../types';
import { FlatFrameCandidate, flattenFrameHierarchy, framePathFor } from '../frameSelector';

/**
 * ServiceNow frame provider. Only meaningful once the application is
 * already known to be ServiceNow (see the gate in detect()) — that check is
 * necessarily app-specific, and it lives here, never in engine.ts, which
 * stays provider-agnostic.
 *
 * Recognizes two ServiceNow-specific frame situations:
 *  - #gsft_main — the Classic UI's content iframe. Same id Phase 1's
 *    hasGsftMainFrame already checks — confirmed live.
 *  - A "workspace" frame — id/name containing "workspace". Unconfirmed
 *    against a live instance, same caveat as PageDetector's Workspace
 *    signals; flagged here rather than silently presented as verified.
 *
 * Searches the WHOLE iframe tree via flattenFrameHierarchy/framePathFor
 * (frameSelector.ts — already built for exactly this, just not used here
 * before), not only the top level. Root-cause fix: a real ServiceNow
 * instance can render #gsft_main nested inside an outer wrapper/shell
 * iframe, not as a direct child of the top document. facts.iframeHierarchy
 * only lists document.querySelectorAll('iframe') results per level; the
 * previous implementation's plain .find() over that top-level array alone
 * never found #gsft_main at depth 2+, silently falling back to
 * MainFrame/frameSelector:null even though the interaction genuinely
 * happened inside #gsft_main. Confirmed live: for the same real recorded
 * event, this file's own session.frameMetadata came back
 * frameSelector:null while that event's independently-computed,
 * Playwright-Frame-API-based smartLocator.frameSelector (engine.ts's
 * getFrameSelector(), unrelated to this file) correctly resolved
 * "#gsft_main" — the same BrowserFacts snapshot, two different answers,
 * because only one of them searched the whole tree.
 */
export class ServiceNowFrameProvider implements FrameDetector {
  readonly providerName = 'ServiceNow';

  detect(facts: BrowserFacts, application: ApplicationMetadata, _page: PageMetadata): FrameMetadata | null {
    if (application.application !== 'ServiceNow') return null;

    const candidates = flattenFrameHierarchy(facts.iframeHierarchy);

    const gsftCandidate = candidates.find((candidate) => candidate.node.id === 'gsft_main');
    if (gsftCandidate) return this.toFrameMetadata(gsftCandidate, 'dom:#gsft_main');

    const workspaceCandidate = candidates.find((candidate) =>
      candidate.node.id.toLowerCase().includes('workspace') || candidate.node.name.toLowerCase().includes('workspace')
    );
    if (workspaceCandidate) {
      return this.toFrameMetadata(workspaceCandidate, 'dom:workspace-frame (unconfirmed live)', 0.75);
    }

    return null; // no recognized ServiceNow frame — let GenericFrameProvider decide
  }

  private toFrameMetadata(candidate: FlatFrameCandidate, signal: string, confidence = 0.99): FrameMetadata {
    const framePath = framePathFor(candidate);
    return {
      // "MainFrame" means "the primary interaction surface", not literally
      // "no iframe involved" (see FrameMetadata's doc comment) — only a
      // genuinely 2+-level-deep path becomes "NestedFrame".
      frameType: framePath.length > 1 ? 'NestedFrame' : 'MainFrame',
      frameSelector: framePath[framePath.length - 1],
      framePath,
      confidence,
      signals: [signal]
    };
  }
}
