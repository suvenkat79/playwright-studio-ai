/**
 * Browser-injected locator generator
 * Computes resilient, user-first Playwright locators (Role, TestId, Label, Placeholder, Text, CSS)
 */
export const browserInjectionScript = `
(() => {
  if (window.__playwrightStudioInjected) return;
  window.__playwrightStudioInjected = true;

  // For a listener attached to document, a shadow-DOM event's e.target is
  // retargeted (per the DOM spec) to the shadow HOST element as seen from
  // outside the shadow tree — not the actual element the user clicked/typed
  // into inside it. This is exactly what happens with any Shadow-DOM-based
  // web component (ServiceNow's Polymer "macroponent-*" elements, Lit,
  // Stencil, etc.): without this, the recorder captures a locator for the
  // whole opaque custom-element container instead of the real interactive
  // element, and replaying a click on that container does nothing useful.
  // composedPath()[0] returns the true innermost originally-clicked element,
  // piercing shadow boundaries (works for any app, not vendor-specific).
  function resolveEventTarget(e) {
    if (typeof e.composedPath === 'function') {
      const path = e.composedPath();
      if (path && path.length > 0) return path[0];
    }
    return e.target;
  }

  // A click frequently lands on a plain inline element (a <span> holding an
  // icon or label text) that's nested INSIDE the real interactive element —
  // e.g. <a href="..."><span class="label">Incidents</span></a>. Without
  // walking up, the recorder treats that inner <span> as if it were itself
  // the clickable thing, falling back to a bare getByText(el.innerText)
  // locator scoped to just that span's own text. That's frequently ambiguous
  // (the same label text often repeats in several places on a page) even
  // though the enclosing <a>/<button> itself has a unique accessible name.
  // This walks up to the nearest genuinely-interactive ancestor (including
  // the element itself, if it already is one) so the locator is computed
  // from the real clickable element instead. Standard DOM traversal — not
  // specific to any site; any page that wraps link/button text in inner
  // markup (which is nearly all of them) benefits from this.
  const INTERACTIVE_SELECTOR = 'a[href], button, [role="button"], [role="link"], [role="menuitem"], [role="tab"], [role="option"], [role="radio"], input, select, textarea, summary, label';

  function resolveInteractiveAncestor(el, e) {
    // el.closest() never crosses shadow-root boundaries -- it only walks
    // ancestors within the element's own shadow tree. Enterprise apps built
    // from Shadow-DOM web components (ServiceNow's Polymer macroponents,
    // Lit, Stencil, etc.) routinely nest an icon several shadow boundaries
    // below the real interactive element (e.g. a profile button's <svg>
    // <path> can sit inside its own shadow root, itself inside the
    // button's shadow root) -- closest() stops at the first boundary and
    // never reaches the button, so the recorder falls back to a bare
    // tag-name locator like page.locator('path'), which matches every path
    // on the page. The event's composedPath() already spans every shadow
    // boundary in order, innermost to outermost, so search that first when
    // available; closest() alone still covers the common light-DOM case.
    if (e && typeof e.composedPath === 'function') {
      const path = e.composedPath();
      for (const node of path) {
        if (node && node.nodeType === 1 && typeof node.matches === 'function' && node.matches(INTERACTIVE_SELECTOR)) {
          return node;
        }
      }
    }
    if (typeof el.closest !== 'function') return el;
    const ancestor = el.closest(INTERACTIVE_SELECTOR);
    return ancestor || el;
  }

  function emitScroll(target) {
    if (typeof window.__playwrightStudioEmitEvent !== 'function') return;

    const documentScrollTarget =
      target === document ||
      target === document.documentElement ||
      target === document.body ||
      target === document.scrollingElement;
    const element = documentScrollTarget ? document.scrollingElement : target;
    if (!element || typeof element.scrollTo !== 'function') return;

    const position = documentScrollTarget
      ? { x: window.scrollX, y: window.scrollY }
      : { x: element.scrollLeft, y: element.scrollTop };
    const selector = documentScrollTarget
      ? "page.locator('html')"
      : 'page.locator(' + JSON.stringify(getUniqueElementSelector(element)) + ')';
    const scrollExpression = documentScrollTarget
      ? 'element.ownerDocument.defaultView?.scrollTo(position.x, position.y)'
      : 'element.scrollTo(position.x, position.y)';
    const codeLine =
      'await ' + selector +
      '.evaluate((element, position) => ' + scrollExpression + ', ' +
      JSON.stringify(position) + ');';

    window.__playwrightStudioEmitEvent({
      type: 'scroll',
      selector: selector,
      value: JSON.stringify(position),
      codeLine: codeLine,
      url: window.location.href
    });
  }

  function getFrameSelector() {
    const frame = window.frameElement;
    if (!frame) return undefined;

    const doc = frame.ownerDocument;
    const tag = frame.tagName.toLowerCase();
    if (frame.id) return '#' + CSS.escape(frame.id);

    for (const attr of ['title', 'name', 'aria-label', 'data-testid']) {
      const value = frame.getAttribute(attr);
      if (!value) continue;
      const selector = tag + '[' + attr + '=' + CSS.escape(value) + ']';
      if (doc.querySelectorAll(selector).length === 1) return selector;
    }

    const classes = typeof frame.className === 'string'
      ? frame.className.split(/\\s+/).filter((name) => name && !/[0-9a-f]{8,}/i.test(name))
      : [];
    if (classes.length > 0) {
      const selector = tag + classes.map((name) => '.' + CSS.escape(name)).join('');
      if (doc.querySelectorAll(selector).length === 1) return selector;
    }

    const path = [];
    let current = frame;
    while (current && current.nodeType === 1 && current !== doc.documentElement) {
      let segment = current.tagName.toLowerCase();
      if (current.id) {
        path.unshift('#' + CSS.escape(current.id));
        break;
      }

      const parent = current.parentElement;
      if (parent) {
        const sameTagSiblings = Array.from(parent.children)
          .filter((sibling) => sibling.tagName === current.tagName);
        segment += ':nth-of-type(' + (sameTagSiblings.indexOf(current) + 1) + ')';
      }
      path.unshift(segment);

      const selector = path.join(' > ');
      if (doc.querySelectorAll(selector).length === 1) return selector;
      current = parent;
    }

    return path.join(' > ');
  }

  function frameAwareSelector(selector, frameSelector) {
    return frameSelector
      ? selector.replace(/^page\./, 'page.frameLocator(' + JSON.stringify(frameSelector) + ').')
      : selector;
  }

  function getUniqueElementSelector(el) {
    const doc = el.ownerDocument;
    if (el.id) {
      const idSelector = '#' + CSS.escape(el.id);
      if (doc.querySelectorAll(idSelector).length === 1) return idSelector;
    }

    const path = [];
    let current = el;
    while (current && current.nodeType === 1 && current !== doc.documentElement) {
      let segment = current.tagName.toLowerCase();
      const parent = current.parentElement;
      if (parent) {
        const sameTagSiblings = Array.from(parent.children)
          .filter((sibling) => sibling.tagName === current.tagName);
        segment += ':nth-of-type(' + (sameTagSiblings.indexOf(current) + 1) + ')';
      }
      path.unshift(segment);

      const selector = path.join(' > ');
      if (doc.querySelectorAll(selector).length === 1) return selector;
      current = parent;
    }

    return path.join(' > ');
  }

  function getTestId(el) {
    const testIdAttrs = ['data-testid', 'data-test-id', 'data-test', 'data-cy', 'data-qa'];
    for (const attr of testIdAttrs) {
      const val = el.getAttribute(attr);
      if (val) return { attr, val };
    }
    return null;
  }

  function getAccessibleName(el) {
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim().replace(/\\s+/g, ' ');

    const ariaLabelledBy = el.getAttribute('aria-labelledby');
    if (ariaLabelledBy) {
      const labelEl = document.getElementById(ariaLabelledBy);
      if (labelEl && labelEl.innerText.trim()) return labelEl.innerText.trim().replace(/\\s+/g, ' ');
    }

    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      if (el.id) {
        const label = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
        if (label && label.innerText.trim()) return label.innerText.trim().replace(/\\s+/g, ' ');
      }
      const parentLabel = el.closest('label');
      if (parentLabel && parentLabel.innerText.trim()) return parentLabel.innerText.trim().replace(/\\s+/g, ' ');
    }

    if (el.innerText && el.innerText.trim().length <= 50) {
      return el.innerText.trim().replace(/\\s+/g, ' ');
    }

    return null;
  }

  function getInputRole(el) {
    // Explicit ARIA role always wins (e.g. many search bars set role="searchbox"
    // on a plain <input type="text">).
    const explicitRole = el.getAttribute('role');
    if (explicitRole) return explicitRole;

    // Implicit role mapping per the HTML-AAM spec for <input type="...">
    if (el.tagName === 'INPUT') {
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      if (type === 'search') return 'searchbox';
    }
    return null;
  }

  function getStableLinkHref(el) {
    const href = el.getAttribute('href');
    if (!href || href === '#') return null;

    let destination;
    try {
      destination = new URL(href, el.ownerDocument.baseURI);
    } catch {
      return href;
    }

    // Redirect links often wrap the real destination in their pathname or
    // query string. Unwrap it so session-specific tracking tokens do not
    // become part of the replay locator.
    for (let depth = 0; depth < 3; depth++) {
      const nestedUrlStart = destination.pathname.lastIndexOf('https://') >= 0
        ? destination.pathname.lastIndexOf('https://')
        : destination.pathname.lastIndexOf('http://');
      let nestedDestination = nestedUrlStart >= 0
        ? destination.pathname.slice(nestedUrlStart)
        : null;

      if (!nestedDestination) {
        for (const value of destination.searchParams.values()) {
          if (/^https?:\\/\\//i.test(value)) {
            nestedDestination = value;
            break;
          }
        }
      }

      if (!nestedDestination) break;
      try {
        destination = new URL(nestedDestination);
      } catch {
        break;
      }
    }

    return destination.pathname && destination.pathname !== '/'
      ? destination.pathname
      : href;
  }

  // Generic fix for a link locator picking "whichever record is first"
  // instead of "the record that was actually recorded" — found live on a
  // real ServiceNow list->record flow: the same generic "any incident.do
  // link" locator matched a different record run to run, because each
  // successful run bumps that record's sys_updated_on, reshuffling the
  // list's sort order. Not ServiceNow-specific — detects the general
  // signature of a stable resource identifier in a link's href (a query
  // param named like an id, or a value shaped like one: a long hex/UUID
  // token or a multi-digit number) and, when present, surfaces it so the
  // generated test can prefer re-targeting that exact record on replay.
  function extractLinkIdentity(el) {
    const href = el.getAttribute('href');
    if (!href || href === '#') return null;
    let destination;
    try {
      destination = new URL(href, el.ownerDocument.baseURI);
    } catch {
      return null;
    }
    const idNamePattern = /(^|_)(id|pk|uuid|guid)$/i;
    const idValuePattern = /^[0-9a-f]{16,}$|^\\d{4,}$|^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    // A case-SENSITIVE opaque-code shape: all-caps-or-digit, with at least
    // one of each, no lowercase at all (e.g. Amazon's ASIN "B0HJB6KG27").
    // Deliberately case sensitive, unlike idValuePattern above, so an
    // ordinary lowercase URL slug/route segment is never mistaken for one
    // regardless of length -- real route segments are conventionally
    // lowercase-with-hyphens (e.g. "iPhone-18-Pro-Max-256", which fails
    // this on both counts: mixed case and a hyphen).
    const opaqueCodePattern = /^(?=.*[A-Z])(?=.*[0-9])[A-Z0-9]{6,14}$/;

    for (const [key, value] of destination.searchParams.entries()) {
      if (!value) continue;
      if (idNamePattern.test(key) || idValuePattern.test(value)) {
        return { matchText: key + '=' + value, fromPath: false };
      }
    }

    // Many REST-ful / SEO-friendly URLs embed the real resource identifier
    // directly in the path instead of a query param -- found live: a real
    // Amazon product link is exactly this shape,
    // /<product-title-slug>/dp/<ASIN>/ref=..., with the ASIN as the only
    // genuinely stable part. Without this, only the query-param case above
    // was ever checked, so a path-embedded identifier was silently missed
    // entirely and the link fell back to the fully generic pattern, which
    // breaks the moment Amazon's search ranking (the "ref=sr_1_1"-style
    // position suffix also baked into the same URL) reshuffles between
    // recording and replay -- an ever-present risk for organic search
    // results, not a one-off.
    const segments = destination.pathname.split('/').filter(Boolean);
    for (const segment of segments) {
      if (idValuePattern.test(segment) || opaqueCodePattern.test(segment)) {
        return { matchText: segment, fromPath: true };
      }
    }

    return null;
  }

  // Generic fix for ambiguous-accessible-name choice widgets (radio/
  // checkbox groups where two or more options compute to the identical
  // accessible name — found live on a real Amazon product page: every
  // color swatch's aria-labelledby pointed at an "announce" element whose
  // text was dominated by the shared price/delivery-estimate boilerplate,
  // not the color name, making every swatch in the group indistinguishable
  // by name. Not Amazon-specific — this detects the general signature (a
  // grouped-choice control whose name collides with a sibling's) and
  // applies on any site, any product, any radio/checkbox group.
  //
  // getChoiceGroupMembers finds the other options in the same logical
  // group: elements sharing the same "name" attribute is the standard
  // HTML mechanism for grouping radio/checkbox inputs (not scoped to a
  // parent — per spec, radio grouping by name is document/form-wide).
  // For ARIA-only widgets with no "name" (e.g. built from styled <button>
  // elements), falls back to same-role siblings within the nearest
  // conventional grouping container.
  function getChoiceGroupMembers(el) {
    const name = el.getAttribute('name');
    if (name) {
      return Array.from(document.querySelectorAll('[name="' + CSS.escape(name) + '"]'));
    }
    const role = el.getAttribute('role');
    if (role) {
      const container = el.closest('[role="radiogroup"], [role="group"], [role="listbox"]') || el.parentElement;
      return container ? Array.from(container.querySelectorAll('[role="' + role + '"]')) : [el];
    }
    // No name/explicit-role attribute to group by -- true for a plain
    // <button> or <a>, which get their interactive role implicitly from
    // the tag itself, with nothing to scope sibling candidates to. Found
    // live: a real ServiceNow "Delete" button and the confirm button
    // inside the modal it opens are different elements, both named
    // "Delete", with no shared name/role attribute connecting them --
    // only a document-wide same-tag scan (the same permissive scope the
    // name-attribute branch above already uses for radio/checkbox groups)
    // can catch it. hasAmbiguousAccessibleName still only flags a real
    // collision if another element computes to the exact same accessible
    // name, so this doesn't affect the overwhelming majority of buttons/
    // links whose names are already unique.
    const tag = el.tagName.toLowerCase();
    if (tag === 'button' || tag === 'a') {
      return Array.from(document.querySelectorAll(tag));
    }
    return [el];
  }

  // True when two or more members of the same choice group compute to the
  // exact same accessible name — the direct, generic signal that
  // role+name-based matching cannot reliably distinguish this option from
  // its siblings, regardless of why (price text, boilerplate, anything).
  function hasAmbiguousAccessibleName(el, name) {
    if (!name) return false;
    const group = getChoiceGroupMembers(el);
    if (group.length <= 1) return false;
    let matches = 0;
    for (const member of group) {
      if (getAccessibleName(member) === name) {
        matches += 1;
        if (matches > 1) return true;
      }
    }
    return false;
  }

  // Fallback locator for an ambiguous-name choice option. Prefers the
  // element's own name+value — the standard HTML mechanism for
  // distinguishing radio/checkbox options within a shared group — verified
  // unique the same way getUniqueElementSelector already verifies its own
  // selectors, so this never returns a selector that turns out to still be
  // ambiguous. Falls back to position when no usable value exists.
  function buildDisambiguatedChoiceLocator(el) {
    const tag = el.tagName.toLowerCase();
    const name = el.getAttribute('name');
    const value = el.getAttribute('value');
    if (name && value) {
      const cssSelector = tag + '[name="' + CSS.escape(name) + '"][value="' + CSS.escape(value) + '"]';
      if (document.querySelectorAll(cssSelector).length === 1) {
        return {
          strategy: 'css',
          selector: 'page.locator(' + JSON.stringify(cssSelector) + ')',
          display: cssSelector,
          tag: tag,
          cssSelector: cssSelector
        };
      }
    }

    const positionalSelector = getUniqueElementSelector(el);
    return {
      strategy: 'css',
      selector: 'page.locator(' + JSON.stringify(positionalSelector) + ')',
      display: positionalSelector,
      tag: tag,
      cssSelector: positionalSelector
    };
  }

  // Structured raw facts (Sprint 5.4 Smart Recorder), additive alongside
  // the existing prebuilt Playwright selector/display below — captured at
  // the same moment, from the same element, never derived afterward by
  // parsing the generated selector string. Every return branch below now
  // also carries these plain fields (strategy/tag always present; the
  // rest present only when that branch's strategy makes them meaningful).
  function computePlaywrightLocator(el) {
    // 1. Test ID
    const testId = getTestId(el);
    if (testId) {
      return {
        strategy: 'testid',
        selector: "page.getByTestId('" + testId.val.replace(/'/g, "\\\\'") + "')",
        display: "[data-testid='" + testId.val + "']",
        tag: el.tagName.toLowerCase(),
        testId: testId.val
      };
    }

    const tag = el.tagName.toLowerCase();

    // 2. Role with accessible name
    const roleAttr = el.getAttribute('role');
    const accName = getAccessibleName(el);

    if (roleAttr === 'radio' || roleAttr === 'checkbox') {
      // accName (computed above) already resolves aria-label, aria-labelledby
      // (the mechanism real-world grouped-choice widgets — e.g. Amazon's
      // color/size swatches — actually use), and innerText, in that order.
      if (accName && hasAmbiguousAccessibleName(el, accName)) {
        return buildDisambiguatedChoiceLocator(el);
      }
      if (accName) {
        return {
          strategy: 'role',
          selector: "page.getByRole('" + roleAttr + "', { name: " + JSON.stringify(accName) + ", exact: true })",
          display: roleAttr + " '" + accName + "'",
          tag: tag,
          role: roleAttr,
          text: accName
        };
      }
    }

    if (tag === 'button' || roleAttr === 'button') {
      if (accName && hasAmbiguousAccessibleName(el, accName)) {
        return buildDisambiguatedChoiceLocator(el);
      }
      if (accName) {
        return {
          strategy: 'role',
          selector: "page.getByRole('button', { name: '" + accName.replace(/'/g, "\\\\'") + "' })",
          display: "button '" + accName + "'",
          tag: tag,
          role: 'button',
          text: accName
        };
      }
      return {
        strategy: 'role',
        selector: "page.getByRole('button')",
        display: "button",
        tag: tag,
        role: 'button'
      };
    }

    if (tag === 'a' || roleAttr === 'link') {
      const stableHref = tag === 'a' ? getStableLinkHref(el) : null;
      if (stableHref) {
        const hrefPattern = stableHref.replace(/\\/+$/, '');
        const relativeHrefPattern = hrefPattern.replace(/^\\/+/, '');
        const hrefPatterns = [...new Set([
          hrefPattern,
          relativeHrefPattern,
          encodeURIComponent(hrefPattern),
          encodeURIComponent(relativeHrefPattern)
        ])];
        const hrefSelector = hrefPatterns
          .map((pattern) =>
            'a[href*=' + JSON.stringify(pattern) +
            (pattern.startsWith('%2F') || pattern.startsWith('%2f') ? ' i' : '') +
            ']'
          )
          .join(', ');
        const selector =
          "page.getByRole('link').and(page.locator(" +
          JSON.stringify(hrefSelector) +
          "))";

        // A query-param identity (e.g. ?sys_id=...) still gets AND'd with
        // the stable pathname, since the endpoint name itself is genuinely
        // stable and a meaningful extra scope. A path-embedded identity
        // (e.g. Amazon's ASIN) must stand alone instead -- it was found
        // *inside* the same path string hrefPatterns already represents in
        // full, so combining the two would require the surrounding,
        // frequently volatile part of that same path (a search-ranking
        // suffix, a title slug that can be A/B tested) to ALSO still
        // match, defeating the entire point of anchoring to the one part
        // that's actually durable.
        const identity = extractLinkIdentity(el);
        const identitySelector = identity
          ? identity.fromPath
            ? 'a[href*=' + JSON.stringify(identity.matchText) + ']'
            : hrefPatterns
                .map((pattern) =>
                  'a[href*=' + JSON.stringify(pattern) +
                  (pattern.startsWith('%2F') || pattern.startsWith('%2f') ? ' i' : '') +
                  '][href*=' + JSON.stringify(identity.matchText) + ']'
                )
                .join(', ')
          : undefined;

        return {
          strategy: 'role',
          selector,
          display: "link[href*='" + hrefPattern + "']",
          tag: tag,
          role: 'link',
          text: accName || undefined,
          identitySelector: identitySelector
        };
      }

      if (accName) {
        return {
          strategy: 'role',
          selector: "page.getByRole('link', { name: '" + accName.replace(/'/g, "\\\\'") + "' })",
          display: "link '" + accName + "'",
          tag: tag,
          role: 'link',
          text: accName
        };
      }
    }

    if (tag === 'input' || tag === 'textarea') {
      // Role-based locators (e.g. getByRole('searchbox')) take priority over
      // placeholder/label, matching Playwright's own recommended locator order.
      const inputRole = getInputRole(el);
      if (inputRole) {
        if (accName) {
          return {
            strategy: 'role',
            selector: "page.getByRole('" + inputRole + "', { name: '" + accName.replace(/'/g, "\\\\'") + "' })",
            display: inputRole + " '" + accName + "'",
            tag: tag,
            role: inputRole,
            text: accName
          };
        }
        return {
          strategy: 'role',
          selector: "page.getByRole('" + inputRole + "')",
          display: inputRole,
          tag: tag,
          role: inputRole
        };
      }

      const placeholder = el.getAttribute('placeholder');
      if (placeholder) {
        return {
          strategy: 'placeholder',
          selector: "page.getByPlaceholder('" + placeholder.replace(/'/g, "\\\\'") + "')",
          display: "placeholder '" + placeholder + "'",
          tag: tag,
          placeholder: placeholder
        };
      }

      if (accName) {
        return {
          strategy: 'label',
          selector: "page.getByLabel('" + accName.replace(/'/g, "\\\\'") + "')",
          display: "label '" + accName + "'",
          tag: tag,
          label: accName
        };
      }

      if (el.name) {
        return {
          strategy: 'css',
          selector: "page.locator('input[name=\\"" + CSS.escape(el.name) + "\\"]')",
          display: "input[name='" + el.name + "']",
          tag: tag,
          cssSelector: "input[name=\\"" + el.name + "\\"]"
        };
      }
    }

    if (tag === 'select') {
      if (accName) {
        return {
          strategy: 'label',
          selector: "page.getByLabel('" + accName.replace(/'/g, "\\\\'") + "')",
          display: "select label '" + accName + "'",
          tag: tag,
          label: accName
        };
      }
    }

    // 3. ID selector
    if (el.id && !el.id.match(/[0-9]{4,}/)) {
      return {
        strategy: 'id',
        selector: "page.locator('#" + CSS.escape(el.id) + "')",
        display: "#" + el.id,
        tag: tag,
        id: el.id
      };
    }

    // 4. Text content for clicks
    if (accName && accName.length <= 40 && ['span', 'p', 'h1', 'h2', 'h3', 'h4', 'div', 'li'].includes(tag)) {
      return {
        strategy: 'text',
        selector: "page.getByText('" + accName.replace(/'/g, "\\\\'") + "')",
        display: "text '" + accName + "'",
        tag: tag,
        text: accName
      };
    }

    // 5. CSS selector fallback
    let cssSelector = tag;
    if (el.className && typeof el.className === 'string') {
      const classes = el.className.split(/\\s+/).filter(c => c && !c.includes(':') && !c.startsWith('hover:') && !c.match(/^[0-9]/));
      if (classes.length > 0) {
        cssSelector += '.' + classes.slice(0, 2).map(c => CSS.escape(c)).join('.');
      }
    }

    return {
      strategy: 'css',
      selector: "page.locator('" + cssSelector.replace(/'/g, "\\\\'") + "')",
      display: cssSelector,
      tag: tag,
      cssSelector: cssSelector
    };
  }

  // Sprint 5.4: spreads a computePlaywrightLocator() result's structured
  // fields into an emit payload, additive alongside the existing selector/
  // codeLine fields every listener below already sends.
  function locatorFacts(loc) {
    return {
      strategy: loc.strategy,
      tag: loc.tag,
      role: loc.role,
      text: loc.text,
      label: loc.label,
      placeholder: loc.placeholder,
      testId: loc.testId,
      id: loc.id,
      cssSelector: loc.cssSelector,
      identitySelector: loc.identitySelector
    };
  }

  // Intercept Clicks
  document.addEventListener('click', (e) => {
    flushPendingScrolls();

    // A click (e.g. a "Search" button) can submit a form and navigate the
    // page just like pressing Enter. Flush any debounced FILL first so it
    // isn't lost to the same context-destruction race described above.
    if (pendingFill) {
      flushPendingFill(pendingFill.el);
    }

    let el = resolveEventTarget(e);
    if (!el || el === document.documentElement || el === document.body) return;
    el = resolveInteractiveAncestor(el, e);

    const loc = computePlaywrightLocator(el);
    const frameSelector = getFrameSelector();
    const codeLine = 'await ' + frameAwareSelector(loc.selector, frameSelector) + '.click();';

    if (typeof window.__playwrightStudioEmitEvent === 'function') {
      window.__playwrightStudioEmitEvent(Object.assign({
        type: 'click',
        selector: loc.selector,
        frameSelector: frameSelector,
        codeLine: codeLine,
        url: window.location.href
      }, locatorFacts(loc)));
    }
  }, true);

  function detectCredential(el) {
    const type = (el.getAttribute('type') || '').toLowerCase();
    const auto = (el.getAttribute('autocomplete') || '').toLowerCase();
    const name = (
      el.getAttribute('name') ||
      el.getAttribute('id') ||
      ''
    ).toLowerCase();

    if (
      type === 'password' ||
      auto.includes('password') ||
      name.includes('password') ||
      name.includes('pwd')
    ) {
      return { isSensitive: true, variableName: 'APP_PASSWORD' };
    }

    if (
      auto === 'username' ||
      type === 'email' ||
      name.includes('user') ||
      name.includes('email')
    ) {
      return { isSensitive: false, variableName: 'APP_USERNAME' };
    }

    return null;
  }

  // Intercept Input / Change
  // NOTE: a long debounce here is dangerous — many text inputs (like a search
  // box) are wired to submit-on-Enter, which navigates the page. Navigation
  // destroys the current JS context, so any debounce timer still pending at
  // that moment is silently dropped and its FILL event never reaches Node.
  // We keep a short debounce to coalesce rapid keystrokes into one FILL event,
  // but the 'keydown' handler below always flushes it synchronously first,
  // so the FILL is emitted (and its cross-process call issued) *before* the
  // Enter/PRESS event and before the browser can start navigating away.
  let pendingFill = null; // { el, timeoutId }
  const lastFilledValue = new WeakMap();
  const pendingScrolls = new Map();

  function flushPendingScrolls() {
    for (const [target, timer] of pendingScrolls) {
      clearTimeout(timer);
      pendingScrolls.delete(target);
      emitScroll(target);
    }
  }

  // Scroll events fire repeatedly during a gesture. Coalesce each scroll
  // target until it settles, then record its final position as one replay step.
  document.addEventListener('scroll', (e) => {
    const target = e.target;
    if (!target || (target !== document && target.nodeType !== 1)) return;

    const existingTimer = pendingScrolls.get(target);
    if (existingTimer) clearTimeout(existingTimer);
    pendingScrolls.set(target, setTimeout(() => {
      pendingScrolls.delete(target);
      emitScroll(target);
    }, 250));
  }, true);

  function emitFillNow(el) {
    const val = el.value || '';
    if (lastFilledValue.get(el) === val) return; // avoid duplicate no-op fills
    const loc = computePlaywrightLocator(el);
    const frameSelector = getFrameSelector();
    const locator = frameAwareSelector(loc.selector, frameSelector);
    const credential = detectCredential(el);
    const emittedValue = credential && credential.isSensitive ? '***MASKED***' : val;
    const codeLine = credential
      ? "await " + locator + ".fill(process.env." + credential.variableName + "!);"
      : "await " + locator + ".fill('" + emittedValue.replace(/'/g, "\\\\'") + "');";

    if (typeof window.__playwrightStudioEmitEvent === 'function') {
      window.__playwrightStudioEmitEvent(Object.assign({
        type: 'fill',
        selector: loc.selector,
        frameSelector: frameSelector,
        value: emittedValue,
        codeLine: codeLine,
        url: window.location.href
      }, locatorFacts(loc), credential || {}));
    }
    lastFilledValue.set(el, val);
  }

  function flushPendingFill(el) {
    if (pendingFill && pendingFill.el === el) {
      clearTimeout(pendingFill.timeoutId);
      pendingFill = null;
    }
    emitFillNow(el);
  }

  document.addEventListener('input', (e) => {
    const el = resolveEventTarget(e);
    if (!el || (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA')) return;

    // Checkbox/radio/file inputs are INPUT tagName but have no "fill"
    // semantics (Sprint 5.4: found live — a checkbox toggle was falling
    // through to here and emitting a nonsense fill with value "on", the
    // input's default .value attribute, alongside the correct 'check'
    // event from the change listener below). Those types have their own
    // dedicated handling; this listener is text-fill only.
    if (el.tagName === 'INPUT') {
      const inputType = (el.getAttribute('type') || '').toLowerCase();
      if (inputType === 'checkbox' || inputType === 'radio' || inputType === 'file') return;
    }

    if (pendingFill) {
      clearTimeout(pendingFill.timeoutId);
      pendingFill = null;
    }

    const timeoutId = setTimeout(() => {
      pendingFill = null;
      emitFillNow(el);
    }, 150);
    pendingFill = { el, timeoutId };
  }, true);

  // Intercept Select / Checkbox / File changes
  document.addEventListener('change', (e) => {
    const el = resolveEventTarget(e);
    if (!el) return;

    const inputType = el.tagName === 'INPUT' ? (el.getAttribute('type') || '').toLowerCase() : '';

    // Checkbox (Sprint 5.4) — additive branch, does not affect the SELECT
    // handling below at all.
    if (inputType === 'checkbox') {
      const loc = computePlaywrightLocator(el);
      const frameSelector = getFrameSelector();
      const checked = !!el.checked;
      const locator = frameAwareSelector(loc.selector, frameSelector);
      const codeLine = "await " + locator + (checked ? ".check();" : ".uncheck();");

      if (typeof window.__playwrightStudioEmitEvent === 'function') {
        window.__playwrightStudioEmitEvent(Object.assign({
          type: 'check',
          selector: loc.selector,
          frameSelector: frameSelector,
          value: String(checked),
          codeLine: codeLine,
          url: window.location.href
        }, locatorFacts(loc)));
      }
      return;
    }

    // File upload (Sprint 5.4) — additive branch.
    if (inputType === 'file') {
      const loc = computePlaywrightLocator(el);
      const frameSelector = getFrameSelector();
      const filenames = el.files ? Array.from(el.files).map((f) => f.name).join(', ') : '';
      const locator = frameAwareSelector(loc.selector, frameSelector);
      const codeLine = "await " + locator + ".setInputFiles(" + JSON.stringify(filenames) + ");";

      if (typeof window.__playwrightStudioEmitEvent === 'function') {
        window.__playwrightStudioEmitEvent(Object.assign({
          type: 'upload',
          selector: loc.selector,
          frameSelector: frameSelector,
          value: filenames,
          codeLine: codeLine,
          url: window.location.href
        }, locatorFacts(loc)));
      }
      return;
    }

    if (el.tagName !== 'SELECT') return;

    const loc = computePlaywrightLocator(el);
    const frameSelector = getFrameSelector();
    const val = el.value || '';
    const locator = frameAwareSelector(loc.selector, frameSelector);
    const codeLine = "await " + locator + ".selectOption('" + val.replace(/'/g, "\\\\'") + "');";

    if (typeof window.__playwrightStudioEmitEvent === 'function') {
      window.__playwrightStudioEmitEvent(Object.assign({
        type: 'select',
        selector: loc.selector,
        frameSelector: frameSelector,
        value: val,
        codeLine: codeLine,
        url: window.location.href
      }, locatorFacts(loc)));
    }
  }, true);

  // Intercept Enter keypress
  // Registered on the capture phase, which always runs before the browser's
  // default action (e.g. submitting the enclosing form / navigating) for this
  // event, so flushing + emitting here happens strictly before any navigation
  // this keypress might trigger.
  document.addEventListener('keydown', (e) => {
    flushPendingScrolls();
    if (e.key === 'Enter') {
      const el = resolveEventTarget(e);
      if (!el || (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA')) return;

      // Flush the debounced FILL synchronously first, so its emission is
      // issued (and correctly ordered before PRESS) before Enter can trigger
      // a page navigation that would otherwise destroy this JS context.
      flushPendingFill(el);

      const loc = computePlaywrightLocator(el);
      const frameSelector = getFrameSelector();
      const codeLine = "await page.keyboard.press('Enter');";

      if (typeof window.__playwrightStudioEmitEvent === 'function') {
        window.__playwrightStudioEmitEvent(Object.assign({
          type: 'press',
          selector: loc.selector,
          frameSelector: frameSelector,
          value: 'Enter',
          codeLine: codeLine,
          url: window.location.href
        }, locatorFacts(loc)));
      }
      return;
    }

    // Tab / Escape (Sprint 5.4) — "meaningful keys only, ignore noise":
    // unlike Enter, these aren't tied to the fill-flush/form-submit path,
    // and aren't restricted to input/textarea (Escape in particular is
    // commonly pressed with no specific element focused, e.g. to dismiss a
    // modal). Additive branch — does not affect Enter handling above.
    if (e.key === 'Tab' || e.key === 'Escape') {
      const el = resolveEventTarget(e);
      const loc = el && el.nodeType === 1 ? computePlaywrightLocator(el) : null;
      const frameSelector = getFrameSelector();
      const codeLine = "await page.keyboard.press('" + e.key + "');";

      if (typeof window.__playwrightStudioEmitEvent === 'function') {
        window.__playwrightStudioEmitEvent(Object.assign({
          type: 'press',
          selector: loc ? loc.selector : 'page',
          frameSelector: frameSelector,
          value: e.key,
          codeLine: codeLine,
          url: window.location.href
        }, loc ? locatorFacts(loc) : {}));
      }
    }
  }, true);

  console.log('[PlaywrightStudio] Live event recorder active in browser');
})();
`;
