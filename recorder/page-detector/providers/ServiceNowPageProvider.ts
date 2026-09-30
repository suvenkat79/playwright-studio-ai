import { ApplicationMetadata, BrowserFacts } from '../../types';
import { PageDetector, PageMetadata } from '../types';

function includesAny(haystack: readonly string[], needles: string[]): boolean {
  return haystack.some((item) => {
    const lower = item.toLowerCase();
    return needles.some((needle) => lower.includes(needle));
  });
}

interface PageCandidate {
  pageType: string;
  module: string | null;
  entity: string | null;
  score: number;
  maxScore: number;
  signals: string[];
}

/**
 * ServiceNow page provider. Only meaningful once the application is already
 * known to be ServiceNow (see the gate in detect()) — that check is
 * necessarily app-specific, and it lives here, never in engine.ts, which
 * stays provider-agnostic.
 *
 * Detects five page types, each independently weighted-scored against
 * BrowserFacts (no URL-only checks — every page type combines DOM/layout
 * signals with a URL hint, never the URL hint alone), then picks whichever
 * page type scores the highest normalized confidence. None of these
 * signals have been confirmed against a live instance the way Phase 1's
 * ServiceNowProvider signals were (macroponent-*, #gsft_main, g_ck) — they
 * are reasonable, documented guesses based on ServiceNow's known UI
 * conventions, flagged here rather than silently presented as verified.
 */
export class ServiceNowPageProvider implements PageDetector {
  readonly providerName = 'ServiceNow';

  detect(facts: BrowserFacts, application: ApplicationMetadata): PageMetadata | null {
    if (application.application !== 'ServiceNow') return null;

    const candidates: PageCandidate[] = [
      this.detectLogin(facts),
      this.detectIncidentList(facts),
      this.detectIncidentFormClassic(facts),
      this.detectIncidentFormNowExperience(facts),
      this.detectWorkspace(facts),
      this.detectServiceCatalog(facts)
    ];

    let best: PageCandidate | null = null;
    for (const candidate of candidates) {
      if (candidate.score > 0 && (!best || candidate.score / candidate.maxScore > best.score / best.maxScore)) {
        best = candidate;
      }
    }

    if (!best) return null;

    return {
      pageType: best.pageType,
      module: best.module,
      entity: best.entity,
      confidence: Number((best.score / best.maxScore).toFixed(2)),
      signals: best.signals
    };
  }

  private detectLogin(facts: BrowserFacts): PageCandidate {
    const fired: string[] = [];
    let score = 0;
    const maxScore = 7; // password:3, login button:2, url:2

    if (facts.hasPasswordInput) {
      score += 3;
      fired.push('dom:password-input');
    }
    if (includesAny(facts.visibleButtonLabels, ['log in', 'login', 'sign in'])) {
      score += 2;
      fired.push('dom:login-button');
    }
    if (facts.pathname.toLowerCase().includes('login')) {
      score += 2;
      fired.push('url:login');
    }

    return { pageType: 'Login', module: null, entity: null, score, maxScore, signals: fired };
  }

  private detectIncidentList(facts: BrowserFacts): PageCandidate {
    const fired: string[] = [];
    let score = 0;
    const maxScore = 5; // url:2, table/grid:2, new button:1

    if (facts.pathname.toLowerCase().includes('incident_list')) {
      score += 2;
      fired.push('url:incident_list');
    }
    if (facts.hasTableOrGridElement) {
      score += 2;
      fired.push('dom:table-or-grid');
    }
    if (includesAny(facts.visibleButtonLabels, ['new'])) {
      score += 1;
      fired.push('dom:new-button');
    }

    return { pageType: 'Incident List', module: 'Incident', entity: 'Incident', score, maxScore, signals: fired };
  }

  /**
   * Incident Form has two independently-scored candidates — Classic UI and
   * Now Experience — both always evaluated, never chosen via an if/else on
   * hasGsftMainFrame. That was tried first and found broken live:
   * hasGsftMainFrame is a snapshot of the DOM at the exact instant
   * extractBrowserFacts() ran, and #gsft_main can transiently be absent
   * right at 'framenavigated'-fires-at-commit time, before Classic UI has
   * re-attached it post-navigation (same class of timing issue as the
   * document.body-can-be-null fix from the lifecycle-patch sprint).
   * Branching on that snapshot picked the wrong candidate and scored 0.
   * Evaluating both unconditionally and letting detect()'s existing
   * highest-normalized-confidence loop choose is immune to that race —
   * exactly the same pattern already used to choose among Login/Incident
   * List/Workspace/Service Catalog above, just with two candidates sharing
   * one pageType instead of one candidate each.
   *
   * Classic UI: the form's actual content (Short Description, State,
   * Update button, ...) renders INSIDE the #gsft_main iframe's own
   * document. BrowserFacts' single evaluate() call only reaches the
   * top-level document, so visibleFieldLabels/visibleButtonLabels/
   * hasTableOrGridElement are structurally always empty here — not a wrong
   * guess, a different document entirely. Confirmed live: recording a real
   * incident.do visit captured
   * `page.frameLocator("#gsft_main").getByRole('button', {name:'Update'})`
   * — the Update button, and by construction the rest of the form, is
   * inside #gsft_main. Reaching into that iframe's content would require
   * extending BrowserFacts' extraction, out of scope for this
   * signal-validation sprint — so this candidate uses only top-level-
   * visible signals instead: the routing path's `sys_id` (a specific-
   * record identifier a list page never carries) and
   * `sysparm_record_target=incident` (an explicit statement of record
   * type), both confirmed present in the same real captured navigation
   * (.../params/target/incident.do%3Fsys_id%3D...%26sysparm_record_target%3Dincident...).
   * Honest limitation: these are URL/routing signals, not DOM-content
   * signals — properly fixing that requires a BrowserFacts change
   * (recursing extraction into #gsft_main's content document), deferred to
   * a future sprint.
   *
   * Now Experience: content renders directly in the top-level document, so
   * the original DOM-content checks apply and are left exactly as they
   * were — unconfirmed against a live instance (no Now Experience incident
   * form was captured this sprint), not touched, not re-guessed.
   */
  private detectIncidentFormClassic(facts: BrowserFacts): PageCandidate {
    const fired: string[] = [];
    let score = 0;
    const maxScore = 9; // sys_id:4, record-target:4, incident-non-list:1
    const pathLower = facts.pathname.toLowerCase();

    if (pathLower.includes('sys_id')) {
      score += 4;
      fired.push('url:sys_id-present');
    }
    if (pathLower.includes('sysparm_record_target') && pathLower.includes('incident')) {
      score += 4;
      fired.push('url:record-target-incident');
    }
    // Not a bare "list" substring check: the real captured pathname also
    // carries an unrelated `sysparm_record_list=...` query param, whose
    // name itself contains "list" and would false-negative a bare
    // `!pathLower.includes('list')` check (confirmed live — this cost 0.11
    // confidence before being caught). "incident_list" is the actual list
    // route name (see detectIncidentList above), so check for its absence
    // specifically, not any occurrence of the substring "list".
    if (pathLower.includes('incident') && !pathLower.includes('incident_list')) {
      score += 1;
      fired.push('url:incident-non-list');
    }

    return { pageType: 'Incident Form', module: 'Incident', entity: 'Incident', score, maxScore, signals: fired };
  }

  private detectIncidentFormNowExperience(facts: BrowserFacts): PageCandidate {
    const fired: string[] = [];
    let score = 0;
    const maxScore = 7; // short description field:3, submit/update:2, state field:1, url:1

    if (includesAny(facts.visibleFieldLabels, ['short description'])) {
      score += 3;
      fired.push('dom:short-description-field');
    }
    if (includesAny(facts.visibleButtonLabels, ['submit', 'update'])) {
      score += 2;
      fired.push('dom:submit-or-update-button');
    }
    if (includesAny(facts.visibleFieldLabels, ['state'])) {
      score += 1;
      fired.push('dom:state-field');
    }
    const pathLower = facts.pathname.toLowerCase();
    if (pathLower.includes('incident') && !pathLower.includes('list')) {
      score += 1;
      fired.push('url:incident-non-list');
    }

    return { pageType: 'Incident Form', module: 'Incident', entity: 'Incident', score, maxScore, signals: fired };
  }

  private detectWorkspace(facts: BrowserFacts): PageCandidate {
    const fired: string[] = [];
    let score = 0;
    const maxScore = 6; // workspace root container:3, url:2, macroponent:1

    if (facts.rootContainerIds.some((id) => id.toLowerCase().includes('workspace'))) {
      score += 3;
      fired.push('dom:workspace-root-container');
    }
    if (facts.pathname.toLowerCase().includes('workspace')) {
      score += 2;
      fired.push('url:workspace');
    }
    if (facts.customElementTagPrefixes.includes('macroponent')) {
      score += 1;
      fired.push('dom:macroponent-* custom element');
    }

    return { pageType: 'Workspace', module: null, entity: null, score, maxScore, signals: fired };
  }

  private detectServiceCatalog(facts: BrowserFacts): PageCandidate {
    const fired: string[] = [];
    let score = 0;
    const maxScore = 5; // url:2, order button:2, title:1

    const pathLower = facts.pathname.toLowerCase();
    if (pathLower.includes('catalog') || pathLower.includes('sc_cat')) {
      score += 2;
      fired.push('url:catalog');
    }
    if (includesAny(facts.visibleButtonLabels, ['order now', 'add to cart', 'order'])) {
      score += 2;
      fired.push('dom:order-button');
    }
    if (facts.title.toLowerCase().includes('catalog')) {
      score += 1;
      fired.push('meta:title-catalog');
    }

    return { pageType: 'Service Catalog', module: 'Service Catalog', entity: 'Catalog Item', score, maxScore, signals: fired };
  }
}
