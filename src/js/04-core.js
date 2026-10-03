/*
 * Core runtime: state store, events, module registry, hash router and the shared
 * UI toolkit (escaping, icons, announcements, dialogs, focus, copy, download).
 *
 * Modules never talk to each other's DOM. They call the public APIs documented
 * in docs/ARCHITECTURE.md (YES.explorer, YES.inquiry, YES.assistant, ...).
 * Each API has a safe stub here so a module can be built and tested alone.
 */
(function (root) {
  'use strict';
  var YES = (root.YES = root.YES || {});
  var doc = root.document;

  /* ------------------------------------------------------------------ */
  /* Events                                                              */
  /* ------------------------------------------------------------------ */
  var handlers = {};
  YES.on = function (evt, fn) {
    (handlers[evt] = handlers[evt] || []).push(fn);
    return function off() {
      handlers[evt] = (handlers[evt] || []).filter(function (h) {
        return h !== fn;
      });
    };
  };
  YES.emit = function (evt, payload) {
    (handlers[evt] || []).slice().forEach(function (fn) {
      try {
        fn(payload);
      } catch (e) {
        if (root.console) console.error('[YES] handler for "' + evt + '" failed', e);
      }
    });
  };

  /* ------------------------------------------------------------------ */
  /* State                                                               */
  /* ------------------------------------------------------------------ */
  YES.defaultFilters = function () {
    return {
      q: '', // free-text search
      from: '', // YYYY-MM-DD, inclusive, on the active date basis
      to: '', // YYYY-MM-DD, inclusive
      direction: 'all', // all | in | out
      types: [], // canonical types: deposit, transfer_in, transfer_out, redemption, fee
      statuses: [], // posted, pending, failed, unknown
      rails: [], // internal, onchain, other
      min: '', // absolute amount, major units as typed by the customer
      max: '',
      step: null, // balance-journey step id or group id (incoming/outgoing) that scoped the list
      ids: null // explicit transaction id list (e.g. "rows used" from an explanation)
    };
  };

  YES.state = {
    lang: 'en',
    view: 'overview', // overview | transactions | understand | help
    journeyStep: null, // selected balance-journey step id
    filters: YES.defaultFilters(),
    sort: { key: 'posted', dir: 'desc' }, // key: posted | initiated | amount
    selectedTx: null, // id of the transaction open in the detail view
    inquiry: null, // draft owned by the inquiry module
    assistant: null, // conversation owned by the assistant module
    feedback: {} // local-session-only feedback records
  };

  /**
   * Shallow-merge `patch` into state and emit 'state' with the changed keys.
   * Objects are replaced, not deep-merged: pass a full new object for nested keys.
   */
  YES.set = function (patch) {
    var changed = [];
    Object.keys(patch).forEach(function (k) {
      if (JSON.stringify(YES.state[k]) !== JSON.stringify(patch[k])) {
        YES.state[k] = patch[k];
        changed.push(k);
      }
    });
    if (changed.length) YES.emit('state', changed);
    return changed;
  };

  /* ------------------------------------------------------------------ */
  /* Module registry                                                     */
  /* ------------------------------------------------------------------ */
  var modules = [];
  /**
   * YES.register({ name, i18n, init(), render(), onState(changedKeys) })
   *   i18n    — { en: {...}, es: {...} } strings merged before boot
   *   init    — called once after the DOM is ready (bind events, first render)
   *   render  — full re-render; called on language change
   *   onState — optional; called with the list of changed state keys
   */
  YES.register = function (mod) {
    if (mod.i18n) YES.i18n.add(mod.i18n);
    modules.push(mod);
    return mod;
  };
  YES.modules = function () {
    return modules.slice();
  };
  YES.renderAll = function () {
    modules.forEach(function (m) {
      if (m.render) {
        try {
          m.render();
        } catch (e) {
          if (root.console) console.error('[YES] render failed in module ' + m.name, e);
        }
      }
    });
    YES.emit('rendered');
  };
  YES.on('state', function (keys) {
    modules.forEach(function (m) {
      if (m.onState) {
        try {
          m.onState(keys);
        } catch (e) {
          if (root.console) console.error('[YES] onState failed in module ' + m.name, e);
        }
      }
    });
  });

  /* ------------------------------------------------------------------ */
  /* Public API stubs (replaced by the owning modules)                   */
  /* ------------------------------------------------------------------ */
  function stub(owner, fn) {
    return function () {
      if (root.console) console.warn('[YES] ' + owner + '.' + fn + ' is not available yet');
    };
  }
  YES.overview = { selectStep: stub('overview', 'selectStep'), clearStep: stub('overview', 'clearStep') };
  YES.explorer = {
    applyFilter: stub('explorer', 'applyFilter'),
    clearFilters: stub('explorer', 'clearFilters'),
    showRows: stub('explorer', 'showRows'),
    openTx: stub('explorer', 'openTx'),
    closeTx: stub('explorer', 'closeTx'),
    exportCsv: stub('explorer', 'exportCsv'),
    filtered: function () {
      return [];
    }
  };
  YES.inquiry = { start: stub('inquiry', 'start'), resume: stub('inquiry', 'resume') };
  YES.assistant = { open: stub('assistant', 'open'), close: stub('assistant', 'close'), ask: stub('assistant', 'ask') };
  YES.understand = { openTopic: stub('understand', 'openTopic') };
  YES.help = { open: stub('help', 'open') };

  /* ------------------------------------------------------------------ */
  /* Router: #/view[/param][?key=value]                                  */
  /* ------------------------------------------------------------------ */
  var VIEWS = ['overview', 'transactions', 'understand', 'help'];
  YES.VIEWS = VIEWS;

  function parseHash() {
    var h = (root.location && root.location.hash) || '';
    h = h.replace(/^#\/?/, '');
    var q = '';
    var qi = h.indexOf('?');
    if (qi !== -1) {
      q = h.slice(qi + 1);
      h = h.slice(0, qi);
    }
    var parts = h.split('/').filter(Boolean).map(decodeURIComponent);
    var params = {};
    q.split('&')
      .filter(Boolean)
      .forEach(function (kv) {
        var i = kv.indexOf('=');
        params[decodeURIComponent(i === -1 ? kv : kv.slice(0, i))] = i === -1 ? '' : decodeURIComponent(kv.slice(i + 1));
      });
    var view = VIEWS.indexOf(parts[0]) !== -1 ? parts[0] : 'overview';
    return { view: view, param: parts[1] || null, params: params };
  }

  function buildHash(view, param, params) {
    var h = '#/' + view + (param ? '/' + encodeURIComponent(param) : '');
    var keys = Object.keys(params || {}).filter(function (k) {
      return params[k] != null && params[k] !== '';
    });
    if (keys.length) {
      h +=
        '?' +
        keys
          .map(function (k) {
            return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
          })
          .join('&');
    }
    return h;
  }

  var nav = (YES.nav = {
    current: parseHash,
    /**
     * Navigate to a view. opts.param — sub-route (e.g. a transaction id or topic),
     * opts.focus — move focus to the view heading (default true for user navigation),
     * opts.replace — replace history entry instead of pushing.
     */
    go: function (view, opts) {
      opts = opts || {};
      if (VIEWS.indexOf(view) === -1) view = 'overview';
      var params = {};
      var cur = parseHash();
      if (cur.params.simulate) params.simulate = cur.params.simulate;
      var hash = buildHash(view, opts.param || null, params);
      pendingFocus = opts.focus !== false;
      if (root.location.hash === hash) {
        applyRoute();
      } else if (root.history && root.history.pushState) {
        // Update the address synchronously so state, view and focus change in the
        // same tick as the click; back/forward still arrive via 'hashchange'.
        try {
          if (opts.replace) root.history.replaceState(null, '', hash);
          else root.history.pushState(null, '', hash);
          applyRoute();
        } catch (e) {
          root.location.hash = hash; // some file:// contexts refuse pushState
        }
      } else {
        root.location.hash = hash;
      }
    },
    /** Update the sub-route of the current view without moving focus. */
    setParam: function (param) {
      var cur = parseHash();
      var hash = buildHash(cur.view, param, cur.params.simulate ? { simulate: cur.params.simulate } : {});
      if (root.location.hash !== hash && root.history && root.history.replaceState) {
        root.history.replaceState(null, '', hash);
      }
    }
  });

  var pendingFocus = false;
  function applyRoute() {
    var r = parseHash();
    var changed = YES.set({ view: r.view });
    showView(r.view);
    YES.emit('route', r);
    if (pendingFocus) {
      pendingFocus = false;
      YES.ui.focusView(r.view);
      YES.ui.announce(YES.t('route.announce', { view: YES.t('nav.' + r.view) }));
    } else if (changed.length) {
      root.scrollTo && root.scrollTo(0, 0);
    }
  }
  nav.apply = applyRoute;

  function showView(view) {
    VIEWS.forEach(function (v) {
      var el = doc.getElementById('view-' + v);
      if (el) el.hidden = v !== view;
    });
    YES.emit('view', view);
  }
  nav.showView = showView;

  if (root.addEventListener) {
    root.addEventListener('hashchange', function () {
      applyRoute();
    });
  }

  /* ------------------------------------------------------------------ */
  /* Language                                                            */
  /* ------------------------------------------------------------------ */
  YES.setLang = function (lang, opts) {
    if (YES.config.languages.indexOf(lang) === -1) return;
    var activeKey = doc.activeElement && doc.activeElement.getAttribute && doc.activeElement.getAttribute('data-fk');
    YES.i18n.lang = lang;
    doc.documentElement.lang = lang;
    try {
      root.sessionStorage.setItem('yes.lang', lang);
    } catch (e) {
      /* storage unavailable: language still applies for this view */
    }
    YES.set({ lang: lang });
    YES.renderAll();
    YES.emit('lang', lang);
    if (activeKey) YES.ui.focusKey(activeKey);
    if (!(opts && opts.silent)) YES.ui.announce(YES.t('lang.changed'));
  };

  /* ------------------------------------------------------------------ */
  /* UI toolkit                                                          */
  /* ------------------------------------------------------------------ */
  var ui = (YES.ui = {});

  var ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  /** Escape any value for safe inclusion in HTML text or attribute values. */
  ui.esc = function (v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return ESC[c];
    });
  };

  ui.$ = function (sel, rootEl) {
    return (rootEl || doc).querySelector(sel);
  };
  ui.$$ = function (sel, rootEl) {
    return Array.prototype.slice.call((rootEl || doc).querySelectorAll(sel));
  };

  /** Run `fn` once per matching click/keyboard activation inside `rootEl` (event delegation). */
  ui.delegate = function (rootEl, evt, selector, fn) {
    rootEl.addEventListener(evt, function (e) {
      var target = e.target.closest ? e.target.closest(selector) : null;
      if (target && rootEl.contains(target)) fn(e, target);
    });
  };

  /**
   * Replace `el`'s content with `html`, restoring focus to the element carrying
   * the same data-fk ("focus key") afterwards. Give every interactive control a
   * stable data-fk so language switches and re-renders never drop focus.
   */
  ui.render = function (el, html) {
    if (!el) return;
    var active = doc.activeElement;
    var key = active && el.contains(active) && active.getAttribute('data-fk');
    var sel = null;
    if (key && typeof active.selectionStart === 'number') {
      try {
        sel = [active.selectionStart, active.selectionEnd];
      } catch (e) {
        sel = null;
      }
    }
    el.innerHTML = html;
    if (key) {
      var next = el.querySelector('[data-fk="' + key + '"]');
      if (next) {
        next.focus({ preventScroll: true });
        if (sel && typeof next.setSelectionRange === 'function') {
          try {
            next.setSelectionRange(sel[0], sel[1]);
          } catch (e2) {
            /* not a text control */
          }
        }
      }
    }
  };

  ui.focusKey = function (key) {
    var el = doc.querySelector('[data-fk="' + key + '"]');
    if (el && el.offsetParent !== null) el.focus({ preventScroll: true });
    return el;
  };

  /** Focus the heading of a view (each view root renders h1[data-view-heading]). */
  ui.focusView = function (view) {
    var el = doc.querySelector('#view-' + view + ' [data-view-heading]');
    if (el) {
      if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
      el.focus({ preventScroll: true });
      el.scrollIntoView && el.scrollIntoView({ block: 'start', behavior: ui.reducedMotion() ? 'auto' : 'smooth' });
    }
  };

  /** Screen-reader announcement via the shared live regions. */
  var announceTimer = null;
  ui.announce = function (msg, assertive) {
    var region = doc.getElementById(assertive ? 'live-assertive' : 'live-polite');
    if (!region) return;
    region.textContent = '';
    clearTimeout(announceTimer);
    announceTimer = setTimeout(function () {
      region.textContent = msg;
    }, 60);
  };

  ui.reducedMotion = function () {
    return !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
  };
  ui.isNarrow = function () {
    return !!(root.matchMedia && root.matchMedia('(max-width: 719px)').matches);
  };

  /** Short visual confirmation (also announced). */
  var toastTimer = null;
  ui.toast = function (msg) {
    var el = doc.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.classList.remove('is-visible');
    }, 2600);
    ui.announce(msg);
  };

  /** Copy text with a fallback for contexts without the async clipboard API. */
  ui.copy = function (text) {
    function fallback() {
      var ta = doc.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      doc.body.appendChild(ta);
      ta.select();
      var ok = false;
      try {
        ok = doc.execCommand('copy');
      } catch (e) {
        ok = false;
      }
      doc.body.removeChild(ta);
      ui.toast(YES.t(ok ? 'common.copied' : 'common.copyFailed'));
    }
    if (root.navigator && navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        ui.toast(YES.t('common.copied'));
      }, fallback);
    } else {
      fallback();
    }
  };

  /** Save a generated file locally (no network). */
  ui.download = function (filename, content, mime) {
    var blob = new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = doc.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    doc.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(url);
      a.remove();
    }, 1000);
  };

  /* ---------------------------- Dialogs ----------------------------- */
  ui.anyModalOpen = function () {
    try {
      return !!doc.querySelector('dialog[open]:modal');
    } catch (e) {
      return !!doc.querySelector('dialog[open]');
    }
  };

  /**
   * Open a native <dialog> as a modal with focus management.
   * opts.trigger — element to return focus to on close (defaults to the active element)
   * opts.initialFocus — selector inside the dialog to focus first
   * opts.onClose — callback after closing
   * Escape closes (native `cancel`), focus is trapped by the browser's modal
   * behaviour, and the page behind becomes inert.
   */
  ui.openDialog = function (dlg, opts) {
    if (!dlg) return;
    opts = opts || {};
    dlg._trigger = opts.trigger || doc.activeElement;
    dlg._onClose = opts.onClose || null;
    if (!dlg._yesBound) {
      dlg._yesBound = true;
      dlg.addEventListener('close', function () {
        doc.documentElement.classList.toggle('has-modal', ui.anyModalOpen());
        var t = dlg._trigger;
        var cb = dlg._onClose;
        dlg._trigger = null;
        dlg._onClose = null;
        if (cb) cb(dlg.returnValue);
        if (t && t.isConnected && !dlg._noReturnFocus) {
          t.focus({ preventScroll: true });
        } else if (t && !t.isConnected && t.getAttribute && t.getAttribute('data-fk')) {
          ui.focusKey(t.getAttribute('data-fk'));
        }
        dlg._noReturnFocus = false;
      });
      // Click on the backdrop (outside the dialog box) closes it.
      dlg.addEventListener('click', function (e) {
        if (e.target !== dlg) return;
        var r = dlg.getBoundingClientRect();
        var inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
        if (!inside) dlg.close('backdrop');
      });
    }
    if (!dlg.open) {
      if (typeof dlg.showModal === 'function') dlg.showModal();
      else dlg.setAttribute('open', '');
    }
    doc.documentElement.classList.add('has-modal');
    var first = opts.initialFocus ? dlg.querySelector(opts.initialFocus) : null;
    if (!first) first = dlg.querySelector('[autofocus]') || dlg.querySelector('h1, h2, [data-dialog-title]');
    if (first) {
      if (!first.hasAttribute('tabindex') && !/^(A|BUTTON|INPUT|SELECT|TEXTAREA)$/.test(first.tagName)) first.setAttribute('tabindex', '-1');
      first.focus({ preventScroll: true });
    }
  };

  /** Close a dialog. opts.returnFocus=false skips focus restoration (when handing off to another dialog). */
  ui.closeDialog = function (dlg, opts) {
    if (!dlg || !dlg.open) return;
    if (opts && opts.returnFocus === false) dlg._noReturnFocus = true;
    dlg.close(opts && opts.value);
  };

  /* ------------------------------ Icons ----------------------------- */
  /* 24×24 stroke icons; decorative unless a label is passed. */
  var ICONS = {
    'arrow-in': '<path d="M12 4v13"/><path d="m6 11 6 6 6-6"/><path d="M5 20h14"/>',
    'arrow-out': '<path d="M12 20V7"/><path d="m6 13 6-6 6 6"/><path d="M5 4h14"/>',
    'arrow-right': '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
    'arrow-left': '<path d="M19 12H5"/><path d="m11 18-6-6 6-6"/>',
    fee: '<circle cx="12" cy="12" r="8"/><path d="M9 15 15 9"/><circle cx="9.5" cy="9.5" r="1"/><circle cx="14.5" cy="14.5" r="1"/>',
    redeem: '<path d="M4 7h13l-3-3"/><path d="M20 17H7l3 3"/>',
    deposit: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M12 9v6"/><path d="m9 12 3 3 3-3"/>',
    balance: '<path d="M4 19V9"/><path d="M10 19V5"/><path d="M16 19v-7"/><path d="M3 19h18"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
    filter: '<path d="M4 6h16"/><path d="M7 12h10"/><path d="M10 18h4"/>',
    sort: '<path d="M8 4v16"/><path d="m4 8 4-4 4 4"/><path d="M16 20V4"/><path d="m12 16 4 4 4-4"/>',
    close: '<path d="M6 6l12 12"/><path d="M18 6 6 18"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    'check-circle': '<circle cx="12" cy="12" r="9"/><path d="m8 12.5 3 3 5-6"/>',
    alert: '<path d="M12 3 2.5 20h19z"/><path d="M12 10v4.5"/><path d="M12 17.5v.01"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 7.5v.01"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    question: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.5v.7"/><path d="M12 17v.01"/>',
    chat: '<path d="M4 5h16v11H9l-5 4z"/>',
    sparkle: '<path d="M12 3v4"/><path d="M12 17v4"/><path d="M3 12h4"/><path d="M17 12h4"/><path d="m6 6 2.5 2.5"/><path d="m15.5 15.5 2.5 2.5"/><path d="m18 6-2.5 2.5"/><path d="M8.5 15.5 6 18"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
    download: '<path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/>',
    print: '<path d="M7 9V4h10v5"/><rect x="4" y="9" width="16" height="7" rx="1.5"/><path d="M7 14h10v6H7z"/>',
    play: '<path d="M8 5.5v13l11-6.5z"/>',
    chevron: '<path d="m9 6 6 6-6 6"/>',
    'chevron-down': '<path d="m6 9 6 6 6-6"/>',
    external: '<path d="M14 4h6v6"/><path d="M20 4 11 13"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/>',
    lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z"/>',
    chain: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    bank: '<path d="M3 9 12 4l9 5"/><path d="M5 10v7"/><path d="M9.5 10v7"/><path d="M14.5 10v7"/><path d="M19 10v7"/><path d="M3 20h18"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 20c1.5-3.5 4.5-5 8-5s6.5 1.5 8 5"/>',
    phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1z"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    book: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5"/><path d="M19 19v2H6"/>',
    shield: '<path d="M12 3 5 6v5c0 4.5 3 8.3 7 10 4-1.7 7-5.5 7-10V6z"/>',
    thumbsUp: '<path d="M7 11v9H4v-9z"/><path d="M7 11l4-7c1.5 0 2.5 1 2.5 2.5V10H19a2 2 0 0 1 2 2.3l-1.2 6A2 2 0 0 1 17.8 20H7"/>',
    thumbsDown: '<path d="M7 13V4H4v9z"/><path d="M7 13l4 7c1.5 0 2.5-1 2.5-2.5V14H19a2 2 0 0 0 2-2.3l-1.2-6A2 2 0 0 0 17.8 4H7"/>',
    menu: '<path d="M4 7h16"/><path d="M4 12h16"/><path d="M4 17h16"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
    video: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3z"/>',
    accessibility: '<circle cx="12" cy="4.5" r="1.5"/><path d="M5 8.5 12 10l7-1.5"/><path d="M12 10v4"/><path d="m8.5 20 3.5-6 3.5 6"/>',
    calendar: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16"/><path d="M9 3v4"/><path d="M15 3v4"/>'
  };
  /**
   * Inline SVG icon. ui.icon('search') is decorative (aria-hidden);
   * ui.icon('alert', { label: 'Warning' }) is announced.
   */
  ui.icon = function (name, opts) {
    opts = opts || {};
    var body = ICONS[name] || ICONS.info;
    var size = opts.size || 20;
    var a11y = opts.label ? 'role="img" aria-label="' + ui.esc(opts.label) + '"' : 'aria-hidden="true" focusable="false"';
    return (
      '<svg class="icon' +
      (opts.cls ? ' ' + opts.cls : '') +
      '" width="' +
      size +
      '" height="' +
      size +
      '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ' +
      a11y +
      '>' +
      body +
      '</svg>'
    );
  };
  ui.ICONS = ICONS;

  /* -------------------- Shared statement renderers ------------------- */
  /** Icon name for a transaction type. */
  ui.typeIcon = function (type) {
    return { deposit: 'deposit', transfer_in: 'arrow-in', transfer_out: 'arrow-out', redemption: 'redeem', fee: 'fee' }[type] || 'question';
  };

  /**
   * Signed amount markup with direction carried by sign, icon and words — never
   * colour alone (PRD 5.8). opts.sign defaults to 'always'.
   */
  ui.amountHtml = function (minor, opts) {
    opts = opts || {};
    var dir = minor < 0 ? 'out' : minor > 0 ? 'in' : 'zero';
    var text = YES.fmt.amount(minor, { sign: opts.sign || 'always', unit: opts.unit !== false });
    var spoken = YES.fmt.amountSpoken(minor, { sign: opts.sign || 'always', unit: opts.unit !== false });
    return (
      '<span class="amount amount--' +
      dir +
      (opts.cls ? ' ' + opts.cls : '') +
      '"><span aria-hidden="true">' +
      ui.esc(text) +
      '</span><span class="sr-only">' +
      ui.esc(spoken) +
      '</span></span>'
    );
  };

  /** Status chip with icon + text (pending/failed/unknown always explicit). */
  ui.statusHtml = function (status) {
    var icon = { posted: 'check-circle', pending: 'clock', failed: 'alert' }[status] || 'question';
    var key = { posted: 1, pending: 1, failed: 1 }[status] ? 'status.' + status : 'status.unknown';
    return '<span class="status status--' + ui.esc(status || 'unknown') + '">' + ui.icon(icon, { size: 16 }) + '<span>' + ui.esc(YES.t(key)) + '</span></span>';
  };

  /** Customer-friendly type label; canonical type kept in data-type. */
  ui.typeLabel = function (type) {
    var k = 'type.' + type;
    return YES.i18n.dict[YES.i18n.lang][k] ? YES.t(k) : YES.t('type.unknown');
  };

  /** "Illustrative" tag used on fictional blockchain / reserve / rate content. */
  ui.illustrativeTag = function (textKey) {
    return '<span class="tag tag--illustrative">' + ui.icon('info', { size: 14 }) + '<span>' + ui.esc(YES.t(textKey || 'common.illustrative')) + '</span></span>';
  };

  /**
   * "Explain with AI" entry point. ctx = { topic, id } is passed to YES.assistant.open.
   * topicLabel is the human name of the fact being explained (for the accessible name).
   */
  ui.explainButton = function (ctx, topicLabel, opts) {
    opts = opts || {};
    return (
      '<button type="button" class="btn btn--ai' +
      (opts.compact ? ' btn--sm' : '') +
      '" data-explain="' +
      ui.esc(ctx.topic) +
      '"' +
      (ctx.id ? ' data-explain-id="' + ui.esc(ctx.id) + '"' : '') +
      ' data-fk="' +
      ui.esc(opts.fk || 'explain-' + ctx.topic + '-' + (ctx.id || 'all')) +
      '" aria-label="' +
      ui.esc(YES.t('explain.buttonFor', { topic: topicLabel })) +
      '">' +
      ui.icon('sparkle', { size: 16 }) +
      '<span>' +
      ui.esc(YES.t('explain.button')) +
      '</span></button>'
    );
  };

  /* Global delegation: any [data-explain] button opens the assistant with context. */
  if (doc) {
    doc.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-explain]');
      if (!b) return;
      e.preventDefault();
      YES.assistant.open({ topic: b.getAttribute('data-explain'), id: b.getAttribute('data-explain-id') || null, trigger: b });
    });
    // [data-nav] links/buttons navigate between views: data-nav="transactions" [data-nav-param]
    doc.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('[data-nav]');
      if (!a) return;
      e.preventDefault();
      YES.nav.go(a.getAttribute('data-nav'), { param: a.getAttribute('data-nav-param') || null });
    });
  }
})(typeof window !== 'undefined' ? window : globalThis);
