import { ApplicationMetadata, BrowserFacts } from '../../types';
import { PageMetadata } from '../../page-detector/types';
import { FrameDetector, FrameMetadata } from '../types';
import { selectorForFrameNode } from '../frameSelector';

/**
 * ServiceNow frame provider. Only meaningful once the application is
 * already known to be ServiceNow (see the gate in detect()) — that check is
 * necessarily app-specific, and it lives here, never in engine.ts, which
 * stays provider-agnostic.
 *
 * Recognizes two ServiceNow-specific frame situations, both top-level (not
 * nested inside another iframe in real ServiceNow instances):
 *  - #gsft_main — the Classic UI's content iframe. Same id Phase 1's
 *    hasGsftMainFrame already checks — confirmed live.
 *  - A "workspace" frame — id/name containing "workspace". Unconfirmed
 *    against a live instance, same caveat as PageDetector's Workspace
 *    signals; flagged here rather than silently presented as verified.
 */
export class ServiceNowFrameProvider implements FrameDetector {
  readonly providerName = 'ServiceNow';

  detect(facts: BrowserFacts, application: ApplicationMetadata, _page: PageMetadata): FrameMetadata | null {
    if (application.application !== 'ServiceNow') return null;

    const gsftNode = facts.iframeHierarchy.find((node) => node.id === 'gsft_main');
    if (gsftNode) {
      return {
        frameType: 'MainFrame',
        frameSelector: '#gsft_main',
        framePath: ['#gsft_main'],
        confidence: 0.99,
        signals: ['dom:#gsft_main']
      };
    }

    const workspaceNode = facts.iframeHierarchy.find(
      (node) => node.id.toLowerCase().includes('workspace') || node.name.toLowerCase().includes('workspace')
    );
    if (workspaceNode) {
      const selector = selectorForFrameNode(workspaceNode);
      return {
        frameType: 'MainFrame',
        frameSelector: selector,
        framePath: [selector],
        confidence: 0.75,
        signals: ['dom:workspace-frame (unconfirmed live)']
      };
    }

    return null; // no recognized ServiceNow frame — let GenericFrameProvider decide
  }
}
