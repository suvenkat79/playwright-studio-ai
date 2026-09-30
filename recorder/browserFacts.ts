import { Page } from 'playwright';
import { BrowserFacts } from './types';

/**
 * Extracts BrowserFacts from the live page. This is the ONE page.evaluate()
 * boundary for application detection — the only place that touches the DOM
 * directly. Every provider operates purely on the plain data this returns,
 * keeping providers pure/testable and the browser-evaluation boundary in
 * exactly one place, per the locked architecture.
 */
export async function extractBrowserFacts(page: Page): Promise<BrowserFacts> {
  return page.evaluate(() => {
    const metaTags: Record<string, string> = {};
    document.querySelectorAll('meta[name], meta[property]').forEach((meta) => {
      const key = meta.getAttribute('name') || meta.getAttribute('property');
      const content = meta.getAttribute('content');
      if (key && content) metaTags[key] = content;
    });

    const iframes = Array.from(document.querySelectorAll('iframe'));

    // Custom-element tag names (e.g. <macroponent-f51912...>,
    // <lightning-button>) can't be matched with a CSS attribute selector —
    // that only checks attributes, not the tag itself — so this walks all
    // elements once, at page load, checking the tag name directly. A
    // one-time O(n) pass, not a hot loop. Collects every distinct prefix
    // (substring before the first "-"), not just one hardcoded name, so any
    // provider can check for the prefix(es) its own platform renders.
    const customElementTagPrefixes = new Set<string>();
    const allElements = document.querySelectorAll('*');
    for (let i = 0; i < allElements.length; i++) {
      const tag = allElements[i].tagName.toLowerCase();
      const hyphenIndex = tag.indexOf('-');
      if (hyphenIndex > 0) {
        customElementTagPrefixes.add(tag.slice(0, hyphenIndex));
      }
    }

    // document.body can genuinely be null here: this now also runs on
    // 'framenavigated', which fires at navigation commit — sometimes before
    // the new document's <body> has been parsed yet, observed live during a
    // fast ServiceNow redirect chain (login_redirect.do -> ui_page.do).
    // Every document.body access below falls back to an empty/safe default
    // rather than throwing, so a mid-navigation re-detection never crashes.
    const rootContainerIds = document.body
      ? Array.from(document.body.children).map((el) => el.id).filter(Boolean)
      : [];

    const ariaLandmarkRoles = Array.from(
      new Set(
        Array.from(document.querySelectorAll('[role]'))
          .map((el) => el.getAttribute('role'))
          .filter((role): role is string => !!role)
      )
    );

    const bodyClasses = (document.body?.className || '')
      .split(/\s+/)
      .filter(Boolean);

    // Page-content facts (Sprint 5 Phase 2) — same evaluate() call, no new
    // boundary. "Visible" uses the offsetWidth/offsetHeight/getClientRects
    // heuristic (display:none and detached elements report 0/empty; this
    // deliberately does not try to detect off-screen-but-technically-
    // visible cases, that's not worth the cost here).
    const isVisible = (el: Element): boolean => {
      const rect = (el as HTMLElement).getClientRects();
      return (el as HTMLElement).offsetWidth > 0 || (el as HTMLElement).offsetHeight > 0 || rect.length > 0;
    };

    const clean = (text: string | null | undefined): string =>
      (text || '').trim().replace(/\s+/g, ' ');

    const buttonLabels = new Set<string>();
    document.querySelectorAll('button, [role="button"], input[type="submit"], input[type="button"]').forEach((el) => {
      if (!isVisible(el)) return;
      const label = el instanceof HTMLInputElement
        ? clean(el.value)
        : clean(el.textContent);
      if (label) buttonLabels.add(label);
    });

    const fieldLabels = new Set<string>();
    document.querySelectorAll('label').forEach((el) => {
      if (!isVisible(el)) return;
      const label = clean(el.textContent);
      if (label) fieldLabels.add(label);
    });
    document.querySelectorAll('input, textarea, select').forEach((el) => {
      if (!isVisible(el)) return;
      const label = clean(el.getAttribute('aria-label')) || clean(el.getAttribute('placeholder'));
      if (label) fieldLabels.add(label);
    });

    const hasPasswordInput = !!document.querySelector('input[type="password"]');
    const hasTableOrGridElement = !!document.querySelector('table, [role="table"], [role="grid"]');

    // Recursive iframe tree (Sprint 5 Phase 3) — still the same evaluate()
    // call, recursion happens entirely in this browser-side script, never a
    // second Playwright page.evaluate() boundary. Same-origin nested
    // iframes are walked via contentDocument; a cross-origin iframe's
    // contentDocument is null (or throws, guarded below) per the
    // Same-Origin Policy, so its children are always an empty array — a
    // real browser security boundary, not something to work around.
    type IframeNode = {
      id: string;
      name: string;
      src: string;
      index: number;
      children: IframeNode[];
    };
    const extractIframeNode: (el: HTMLIFrameElement, index: number) => IframeNode = (el, index) => {
      let children: IframeNode[] = [];
      try {
        const doc = el.contentDocument;
        if (doc) {
          children = Array.from(doc.querySelectorAll('iframe')).map((child, i) => extractIframeNode(child as HTMLIFrameElement, i));
        }
      } catch {
        // Cross-origin — inaccessible from here, children stays empty.
      }
      return {
        id: el.id || '',
        name: el.getAttribute('name') || '',
        src: el.getAttribute('src') || '',
        index,
        children
      };
    };
    const iframeHierarchy = iframes.map((el, i) => extractIframeNode(el as HTMLIFrameElement, i));

    return {
      hostname: window.location.hostname,
      href: window.location.href,
      pathname: window.location.pathname,
      title: document.title,
      metaTags,
      customElementTagPrefixes: Array.from(customElementTagPrefixes),
      rootContainerIds,
      ariaLandmarkRoles,
      bodyClasses,
      iframeCount: iframes.length,
      iframeIds: iframes.map((f) => f.id).filter(Boolean),
      iframeSrcs: iframes.map((f) => f.src).filter(Boolean),
      iframeNames: iframes.map((f) => f.getAttribute('name') || '').filter(Boolean),
      iframeHierarchy,
      hasGsftMainFrame: !!document.getElementById('gsft_main'),
      hasGlideCk: typeof (window as unknown as { g_ck?: unknown }).g_ck !== 'undefined',
      visibleButtonLabels: Array.from(buttonLabels).slice(0, 50),
      visibleFieldLabels: Array.from(fieldLabels).slice(0, 50),
      hasPasswordInput,
      hasTableOrGridElement
    };
  });
}
