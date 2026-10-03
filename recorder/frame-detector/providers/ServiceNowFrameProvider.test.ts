import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ApplicationMetadata, BrowserFacts, IframeFact } from '../../types';
import { ServiceNowFrameProvider } from './ServiceNowFrameProvider';

// Root-cause regression: a real ServiceNow instance can render #gsft_main
// nested inside an outer wrapper/shell iframe rather than as a direct
// child of the top document. Confirmed live: for one real recorded click
// on INC0010021, session.frameMetadata (this provider's output) came back
// frameSelector:null while the SAME event's independently-computed,
// Playwright-Frame-API-based smartLocator.frameSelector correctly
// resolved to "#gsft_main" -- the previous implementation only searched
// facts.iframeHierarchy's top level via .find(), never recursing into
// .children, so a nested #gsft_main was invisible to it even though
// GenericFrameProvider (frame-detector/providers/GenericFrameProvider.ts)
// already used the depth-agnostic flattenFrameHierarchy/framePathFor
// helpers from frameSelector.ts for exactly this. This file now does too.

const SERVICE_NOW_APP: ApplicationMetadata = {
  application: 'ServiceNow',
  confidence: 1,
  signals: []
};

function baseFacts(iframeHierarchy: readonly IframeFact[]): BrowserFacts {
  return {
    hostname: 'dev442568.service-now.com',
    href: 'https://dev442568.service-now.com/incident.do',
    pathname: '/incident.do',
    title: 'Incident',
    metaTags: {},
    customElementTagPrefixes: [],
    rootContainerIds: [],
    ariaLandmarkRoles: [],
    bodyClasses: [],
    iframeCount: iframeHierarchy.length,
    iframeIds: [],
    iframeSrcs: [],
    iframeNames: [],
    frameUrls: [],
    iframeHierarchy,
    hasGsftMainFrame: false,
    hasGlideCk: false,
    visibleButtonLabels: [],
    visibleFieldLabels: [],
    hasPasswordInput: false,
    hasTableOrGridElement: false
  };
}

test('detects a top-level #gsft_main exactly as before (no behavior change for the common case)', () => {
  const facts = baseFacts([
    { id: 'gsft_main', name: '', src: '/incident.do', index: 0, children: [] }
  ]);

  const result = new ServiceNowFrameProvider().detect(facts, SERVICE_NOW_APP, {} as never);

  assert.deepEqual(result, {
    frameType: 'MainFrame',
    frameSelector: '#gsft_main',
    framePath: ['#gsft_main'],
    confidence: 0.99,
    signals: ['dom:#gsft_main']
  });
});

test('detects #gsft_main nested inside an outer wrapper iframe, with the full chain in framePath', () => {
  const facts = baseFacts([
    {
      id: 'outer_shell',
      name: '',
      src: '/shell.do',
      index: 0,
      children: [
        { id: 'gsft_main', name: '', src: '/incident.do', index: 0, children: [] }
      ]
    }
  ]);

  const result = new ServiceNowFrameProvider().detect(facts, SERVICE_NOW_APP, {} as never);

  assert.deepEqual(result, {
    frameType: 'NestedFrame',
    frameSelector: '#gsft_main',
    framePath: ['#outer_shell', '#gsft_main'],
    confidence: 0.99,
    signals: ['dom:#gsft_main']
  });
});

test('returns null (no false positive) when no gsft_main or workspace frame exists anywhere in the tree', () => {
  const facts = baseFacts([
    { id: 'unrelated', name: '', src: '/other.do', index: 0, children: [] }
  ]);

  assert.equal(new ServiceNowFrameProvider().detect(facts, SERVICE_NOW_APP, {} as never), null);
});

test('finds a nested workspace frame too, at reduced confidence', () => {
  const facts = baseFacts([
    {
      id: 'outer_shell',
      name: '',
      src: '/shell.do',
      index: 0,
      children: [
        { id: 'workspace-frame', name: '', src: '/workspace.do', index: 0, children: [] }
      ]
    }
  ]);

  const result = new ServiceNowFrameProvider().detect(facts, SERVICE_NOW_APP, {} as never);

  assert.deepEqual(result, {
    frameType: 'NestedFrame',
    frameSelector: '#workspace-frame',
    framePath: ['#outer_shell', '#workspace-frame'],
    confidence: 0.75,
    signals: ['dom:workspace-frame (unconfirmed live)']
  });
});
