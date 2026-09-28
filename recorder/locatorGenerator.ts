/**
 * Browser-injected locator generator
 * Computes resilient, user-first Playwright locators (Role, TestId, Label, Placeholder, Text, CSS)
 */
export const browserInjectionScript = `
(() => {
  if (window.__playwrightStudioInjected) return;
  window.__playwrightStudioInjected = true;

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
    if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim();

    const ariaLabelledBy = el.getAttribute('aria-labelledby');
    if (ariaLabelledBy) {
      const labelEl = document.getElementById(ariaLabelledBy);
      if (labelEl && labelEl.innerText.trim()) return labelEl.innerText.trim();
    }

    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      if (el.id) {
        const label = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
        if (label && label.innerText.trim()) return label.innerText.trim();
      }
      const parentLabel = el.closest('label');
      if (parentLabel && parentLabel.innerText.trim()) return parentLabel.innerText.trim();
    }

    if (el.innerText && el.innerText.trim().length <= 50) {
      return el.innerText.trim();
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

  function computePlaywrightLocator(el) {
    // 1. Test ID
    const testId = getTestId(el);
    if (testId) {
      return {
        strategy: 'testid',
        selector: "page.getByTestId('" + testId.val.replace(/'/g, "\\\\'") + "')",
        display: "[data-testid='" + testId.val + "']"
      };
    }

    const tag = el.tagName.toLowerCase();

    // 2. Role with accessible name
    const roleAttr = el.getAttribute('role');
    const accName = getAccessibleName(el);

    if (tag === 'button' || roleAttr === 'button') {
      if (accName) {
        return {
          strategy: 'role',
          selector: "page.getByRole('button', { name: '" + accName.replace(/'/g, "\\\\'") + "' })",
          display: "button '" + accName + "'"
        };
      }
      return {
        strategy: 'role',
        selector: "page.getByRole('button')",
        display: "button"
      };
    }

    if (tag === 'a' || roleAttr === 'link') {
      if (accName) {
        return {
          strategy: 'role',
          selector: "page.getByRole('link', { name: '" + accName.replace(/'/g, "\\\\'") + "' })",
          display: "link '" + accName + "'"
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
            display: inputRole + " '" + accName + "'"
          };
        }
        return {
          strategy: 'role',
          selector: "page.getByRole('" + inputRole + "')",
          display: inputRole
        };
      }

      const placeholder = el.getAttribute('placeholder');
      if (placeholder) {
        return {
          strategy: 'placeholder',
          selector: "page.getByPlaceholder('" + placeholder.replace(/'/g, "\\\\'") + "')",
          display: "placeholder '" + placeholder + "'"
        };
      }

      if (accName) {
        return {
          strategy: 'label',
          selector: "page.getByLabel('" + accName.replace(/'/g, "\\\\'") + "')",
          display: "label '" + accName + "'"
        };
      }

      if (el.name) {
        return {
          strategy: 'css',
          selector: "page.locator('input[name=\\"" + CSS.escape(el.name) + "\\"]')",
          display: "input[name='" + el.name + "']"
        };
      }
    }

    if (tag === 'select') {
      if (accName) {
        return {
          strategy: 'label',
          selector: "page.getByLabel('" + accName.replace(/'/g, "\\\\'") + "')",
          display: "select label '" + accName + "'"
        };
      }
    }

    // 3. ID selector
    if (el.id && !el.id.match(/[0-9]{4,}/)) {
      return {
        strategy: 'id',
        selector: "page.locator('#" + CSS.escape(el.id) + "')",
        display: "#" + el.id
      };
    }

    // 4. Text content for clicks
    if (accName && accName.length <= 40 && ['span', 'p', 'h1', 'h2', 'h3', 'h4', 'div', 'li'].includes(tag)) {
      return {
        strategy: 'text',
        selector: "page.getByText('" + accName.replace(/'/g, "\\\\'") + "')",
        display: "text '" + accName + "'"
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
      display: cssSelector
    };
  }

  // Intercept Clicks
  document.addEventListener('click', (e) => {
    // A click (e.g. a "Search" button) can submit a form and navigate the
    // page just like pressing Enter. Flush any debounced FILL first so it
    // isn't lost to the same context-destruction race described above.
    if (pendingFill) {
      flushPendingFill(pendingFill.el);
    }

    const el = e.target;
    if (!el || el === document.documentElement || el === document.body) return;

    const loc = computePlaywrightLocator(el);
    const codeLine = 'await ' + loc.selector + '.click();';

    if (typeof window.__playwrightStudioEmitEvent === 'function') {
      window.__playwrightStudioEmitEvent({
        type: 'click',
        selector: loc.selector,
        codeLine: codeLine,
        url: window.location.href
      });
    }
  }, true);

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

  function emitFillNow(el) {
    const val = el.value || '';
    if (lastFilledValue.get(el) === val) return; // avoid duplicate no-op fills
    const loc = computePlaywrightLocator(el);
    const codeLine = "await " + loc.selector + ".fill('" + val.replace(/'/g, "\\\\'") + "');";

    if (typeof window.__playwrightStudioEmitEvent === 'function') {
      window.__playwrightStudioEmitEvent({
        type: 'fill',
        selector: loc.selector,
        value: val,
        codeLine: codeLine,
        url: window.location.href
      });
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
    const el = e.target;
    if (!el || (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA')) return;

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

  // Intercept Select changes
  document.addEventListener('change', (e) => {
    const el = e.target;
    if (!el || el.tagName !== 'SELECT') return;

    const loc = computePlaywrightLocator(el);
    const val = el.value || '';
    const codeLine = "await " + loc.selector + ".selectOption('" + val.replace(/'/g, "\\\\'") + "');";

    if (typeof window.__playwrightStudioEmitEvent === 'function') {
      window.__playwrightStudioEmitEvent({
        type: 'select',
        selector: loc.selector,
        value: val,
        codeLine: codeLine,
        url: window.location.href
      });
    }
  }, true);

  // Intercept Enter keypress
  // Registered on the capture phase, which always runs before the browser's
  // default action (e.g. submitting the enclosing form / navigating) for this
  // event, so flushing + emitting here happens strictly before any navigation
  // this keypress might trigger.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const el = e.target;
      if (!el || (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA')) return;

      // Flush the debounced FILL synchronously first, so its emission is
      // issued (and correctly ordered before PRESS) before Enter can trigger
      // a page navigation that would otherwise destroy this JS context.
      flushPendingFill(el);

      const loc = computePlaywrightLocator(el);
      const codeLine = "await page.keyboard.press('Enter');";

      if (typeof window.__playwrightStudioEmitEvent === 'function') {
        window.__playwrightStudioEmitEvent({
          type: 'press',
          selector: loc.selector,
          value: 'Enter',
          codeLine: codeLine,
          url: window.location.href
        });
      }
    }
  }, true);

  console.log('[PlaywrightStudio] Live event recorder active in browser');
})();
`;
