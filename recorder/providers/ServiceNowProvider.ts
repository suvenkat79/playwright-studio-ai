import { ApplicationDetector, ApplicationMetadata, BrowserFacts } from '../types';

/**
 * ServiceNow provider. Weighted signals across all six BrowserFacts
 * categories — never relies on URL alone:
 *  - URL:              hostname ending in *.service-now.com
 *  - DOM structure:    a "macroponent" custom-element prefix — ServiceNow's
 *                       Polymer-based Now Experience UI web components.
 *                       Confirmed directly against a real ServiceNow
 *                       instance during this project's own recorder/
 *                       optimizer work (observed in actual Playwright
 *                       trace/ARIA snapshots), not a guessed signature.
 *  - Meta tags:         <meta name="application-name" content="ServiceNow">.
 *                       NOT yet confirmed against a live instance — unlike
 *                       the other signals below, add/adjust this one once
 *                       actually observed on a real page; until then it can
 *                       only ever help (extra signal), never hurt, since it
 *                       is one of seven and the others alone already
 *                       reliably identify a real instance.
 *  - Root container:    a "gsft_main" id among document.body's direct
 *                       children — the classic UI's content iframe mount,
 *                       same element as the frame-structure signal below,
 *                       observed via the same real-instance testing.
 *  - ARIA/layout:       an "application" ARIA landmark role. Also NOT yet
 *                       confirmed against a live instance — same caveat as
 *                       meta tags above.
 *  - Frame structure:   the classic UI's #gsft_main content iframe.
 *  - Global:            window.g_ck — ServiceNow's CSRF/session token.
 *                       Confirmed present even pre-authentication, on the
 *                       plain login.do page (live-verified below) — not
 *                       limited to authenticated sessions as originally
 *                       assumed.
 *
 * Confirmed on a real instance: URL and window.g_ck (both live-verified
 * against dev442568.service-now.com/login.do — a real, unauthenticated
 * page, scoring 5/13 = 0.38, comfortably above GenericWebProvider's 0.3
 * floor). DOM structure (macroponent-*) and frame structure (#gsft_main)
 * were confirmed separately, on an authenticated Now Experience page,
 * during this project's earlier recorder/optimizer work. Meta tags and
 * ARIA role remain unconfirmed — verified absent on the login page tested
 * above, still untested on an authenticated page.
 *
 * Pure — takes BrowserFacts, returns a verdict. No DOM/page access, so this
 * is trivially unit-testable with a plain BrowserFacts object.
 */
export class ServiceNowProvider implements ApplicationDetector {
  readonly application = 'ServiceNow';

  detect(facts: BrowserFacts): ApplicationMetadata | null {
    const fired: string[] = [];
    let score = 0;

    // Weights are not uniform: a near-unique signal (the *.service-now.com
    // host pattern) counts far more than a signal shared by countless
    // unrelated apps (a bare role="application" ARIA landmark — proven by
    // testing this against a deliberately generic, non-ServiceNow page,
    // which scored a false-positive-shaped signal on that one alone).
    // Weight reflects how specific to ServiceNow each signal actually is,
    // not merely whether it happened to be observed once.
    const SIGNAL_WEIGHTS = {
      url: 3, // hostname pattern is near-unique to ServiceNow-hosted instances
      dom: 2, // macroponent-* is ServiceNow's own Polymer component naming, confirmed live
      rootContainer: 2, // #gsft_main as a root mount id, confirmed live
      frame: 2, // #gsft_main iframe, confirmed live
      global: 2, // window.g_ck, confirmed live
      meta: 1, // plausible but not yet confirmed against a live instance
      aria: 1 // role="application" is a generic ARIA landmark many apps use; weak alone
    } as const;
    const maxScore = Object.values(SIGNAL_WEIGHTS).reduce((a, b) => a + b, 0);

    const hostMatch = /^([a-z0-9-]+)\.service-now\.com$/i.exec(facts.hostname);
    if (hostMatch) {
      score += SIGNAL_WEIGHTS.url;
      fired.push('url:*.service-now.com');
    }
    if (facts.customElementTagPrefixes.includes('macroponent')) {
      score += SIGNAL_WEIGHTS.dom;
      fired.push('dom:macroponent-* custom element');
    }
    if (facts.metaTags['application-name'] === 'ServiceNow') {
      score += SIGNAL_WEIGHTS.meta;
      fired.push('meta:application-name=ServiceNow');
    }
    if (facts.rootContainerIds.includes('gsft_main')) {
      score += SIGNAL_WEIGHTS.rootContainer;
      fired.push('root-container:#gsft_main');
    }
    if (facts.ariaLandmarkRoles.includes('application')) {
      score += SIGNAL_WEIGHTS.aria;
      fired.push('aria:role=application');
    }
    if (facts.hasGsftMainFrame) {
      score += SIGNAL_WEIGHTS.frame;
      fired.push('frame:#gsft_main');
    }
    if (facts.hasGlideCk) {
      score += SIGNAL_WEIGHTS.global;
      fired.push('global:window.g_ck');
    }

    if (score === 0) return null; // no ServiceNow signal at all — don't claim this page

    return {
      application: this.application,
      ui: facts.hasGsftMainFrame ? 'Classic' : 'Now Experience',
      confidence: Number((score / maxScore).toFixed(2)),
      instance: hostMatch ? hostMatch[1] : undefined,
      signals: fired
    };
  }
}
