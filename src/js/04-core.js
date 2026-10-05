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
      // YYYY-MM-DD, inclusive, on the statement's date basis
      // (YES.data.statement.dateBasis); sorting never changes it
      from: '',
      to: '',
      direction: 'all', // all | in | out
      types: [], // canonical types: deposit, transfer_in, transfer_out, redemption, fee
      statuses: [], // posted, pending, failed, unknown
      rails: [], // internal, onchain, other
      min: '', // absolute amount, major units as typed by the customer
      max: '',
      step: null, // balance-journey step id or group id (incoming/outgoing) that scoped the list
      ids: null, // explicit transaction id list (e.g. "rows used" from an explanation)
      idsLabel: null, // name of that list for its chip: a string or a localised { en, es } object
      amountLang: null // language min/max were typed in ("1,000" vs "1.000"); set by the explorer
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
  /**
   * Initialise the registered modules (boot calls this once). `allow(m)` can
   * leave a module out: it is then never initialised, rendered or told about
   * state changes — e.g. every feature module while a statement is withheld, so
   * a language switch cannot render withheld figures into the DOM.
   */
  YES.initModules = function (allow) {
    var list = modules.filter(function (m) {
      return !allow || allow(m);
    });
    // Mark the whole set first: modules may change state from their init, and
    // later modules in the set must still hear about it.
    list.forEach(function (m) {
      m._active = true;
    });
    list.forEach(function (m) {
      if (m.init) {
        try {
          m.init();
        } catch (e) {
          if (root.console) console.error('[YES] init failed in module ' + m.name, e);
        }
      }
    });
  };
  YES.renderAll = function () {
    modules.forEach(function (m) {
      if (m.render && m._active) {
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
      if (m.onState && m._active) {
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
  YES.inquiry = {
    start: stub('inquiry', 'start'),
    resume: stub('inquiry', 'resume'),
    draftFor: function () {
      return null;
    }
  };
  YES.assistant = { open: stub('assistant', 'open'), close: stub('assistant', 'close'), ask: stub('assistant', 'ask') };
  YES.understand = { openTopic: stub('understand', 'openTopic') };
  /* help.open('record') is also the masthead's "Download or print" destination. */
  YES.help = { open: stub('help', 'open'), downloadPdf: stub('help', 'downloadPdf') };

  /* ------------------------------------------------------------------ */
  /* Router: #/view[/param][?key=value]                                  */
  /* ------------------------------------------------------------------ */
  var VIEWS = ['overview', 'transactions', 'understand', 'help'];
  YES.VIEWS = VIEWS;

  /* A truncated or hand-edited link ("#/transactions/100%") must never throw:
     an undecodable piece is kept as typed and treated as an unknown param. */
  function safeDecode(s) {
    try {
      return decodeURIComponent(s);
    } catch (e) {
      return s;
    }
  }
  /** Routes look like "#/view…". Any other fragment ("#main") is an in-page anchor, not a route. */
  function isRouteHash(h) {
    return !h || h === '#' || h.charAt(1) === '/';
  }
  var lastRoute = null;
  function parseHash() {
    var raw = (root.location && root.location.hash) || '';
    if (!isRouteHash(raw)) {
      // Keep the current view: following an in-page anchor is not navigation.
      return lastRoute ? { view: lastRoute.view, param: lastRoute.param, params: JSON.parse(JSON.stringify(lastRoute.params)) } : { view: YES.state.view || 'overview', param: null, params: {} };
    }
    var h = raw.replace(/^#\/?/, '');
    var q = '';
    var qi = h.indexOf('?');
    if (qi !== -1) {
      q = h.slice(qi + 1);
      h = h.slice(0, qi);
    }
    var parts = h.split('/').filter(Boolean).map(safeDecode);
    var params = {};
    q.split('&')
      .filter(Boolean)
      .forEach(function (kv) {
        var i = kv.indexOf('=');
        params[safeDecode(i === -1 ? kv : kv.slice(0, i))] = i === -1 ? '' : safeDecode(kv.slice(i + 1));
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
    /**
     * Update the sub-route of the current view without moving focus. Never
     * overwrites an address the router has not applied yet: if the hash changed
     * and its 'hashchange' is still queued, that navigation wins and its route
     * handlers settle the param.
     */
    setParam: function (param) {
      if (appliedHash !== null && isRouteHash(root.location.hash) && root.location.hash !== appliedHash) return;
      var cur = parseHash();
      var hash = buildHash(cur.view, param, cur.params.simulate ? { simulate: cur.params.simulate } : {});
      if (root.location.hash !== hash && root.history && root.history.replaceState) {
        root.history.replaceState(null, '', hash);
        appliedHash = root.location.hash;
      }
    }
  });

  var pendingFocus = false;
  var appliedHash = null; // the address the router last applied
  /**
   * Show the view named by the address. opts.history — the change came from the
   * browser (Back/Forward, an edited address): like a click in the navigation,
   * a new view gets its heading focused and announced, so keyboard and
   * screen-reader users are never left on <body> or inside a hidden view.
   */
  function applyRoute(opts) {
    var r = parseHash();
    lastRoute = r;
    appliedHash = root.location.hash;
    var changed = YES.set({ view: r.view });
    showView(r.view);
    YES.emit('route', r);
    if (pendingFocus) {
      pendingFocus = false;
      YES.ui.focusView(r.view);
      YES.ui.announce(YES.t('route.announce', { view: YES.t('nav.' + r.view) }));
    } else if (changed.length) {
      root.scrollTo && root.scrollTo(0, 0);
      if (opts && opts.history) {
        focusHeadingAfterHistory(r.view);
        YES.ui.announce(YES.t('route.announce', { view: YES.t('nav.' + r.view) }));
      }
    }
  }
  nav.apply = applyRoute;

  function headingOf(view) {
    return doc.querySelector('#view-' + view + ' [data-view-heading]');
  }
  function strandedFocus() {
    var a = doc.activeElement;
    return !a || a === doc.body || a === doc.documentElement || !a.isConnected || (a.getClientRects && a.getClientRects().length === 0);
  }
  /* A dialog closed by the route change returns focus asynchronously (to a
     trigger that may now be hidden), so check again once that has settled. */
  function focusHeadingAfterHistory(view) {
    function attempt() {
      if (YES.state.view !== view || YES.ui.anyModalOpen()) return;
      var h = headingOf(view);
      if (h && (strandedFocus() || !doc.getElementById('view-' + view).contains(doc.activeElement))) h.focus({ preventScroll: true });
    }
    attempt();
    setTimeout(attempt, 0);
    setTimeout(attempt, 120);
  }

  function showView(view) {
    VIEWS.forEach(function (v) {
      var el = doc.getElementById('view-' + v);
      if (el) el.hidden = v !== view;
    });
    YES.emit('view', view);
  }
  nav.showView = showView;

  nav.isRouteHash = isRouteHash;
  if (root.addEventListener) {
    root.addEventListener('hashchange', function () {
      if (!isRouteHash(root.location.hash)) return; // in-page anchor, not navigation
      applyRoute({ history: true });
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
  /* Theme: light or dark                                                */
  /* ------------------------------------------------------------------ */
  /*
   * The page follows the device (prefers-color-scheme), live, until the visitor
   * chooses; the choice is remembered in this browser (localStorage 'yes.theme',
   * read again by a tiny script in <head> before the first paint). The effective
   * theme is mirrored into <html data-theme="light|dark">, which 00-tokens.css
   * reads. Print and the PDF are always light. Emits 'theme' (effective theme).
   */
  var THEME_KEY = 'yes.theme';
  var THEMES = ['light', 'dark'];
  var themeMq = null;
  var themeChoice = null; // 'light' | 'dark' | null (follow the device)
  var themeShown = null; // effective theme last applied
  var themeInited = false;
  function readThemeChoice() {
    try {
      var v = root.localStorage.getItem(THEME_KEY);
      return THEMES.indexOf(v) !== -1 ? v : null;
    } catch (e) {
      return null; // storage blocked (private mode, sandbox): follow the device
    }
  }
  function applyTheme() {
    var eff = theme.effective();
    var el = doc && doc.documentElement;
    if (el) el.setAttribute('data-theme', eff);
    if (eff !== themeShown) {
      var first = themeShown === null;
      themeShown = eff;
      if (!first) YES.emit('theme', eff);
    }
  }
  var theme = (YES.theme = {
    /** The visitor's explicit choice ('light' | 'dark'), or null while following the device. */
    get: function () {
      return themeChoice;
    },
    /** The device setting: 'dark' when prefers-color-scheme is dark. */
    device: function () {
      return themeMq && themeMq.matches ? 'dark' : 'light';
    },
    /** The theme on screen: the choice, else the device setting. */
    effective: function () {
      return themeChoice || theme.device();
    },
    /** Choose 'light' or 'dark' (remembered), or null / 'system' to follow the device again. */
    set: function (mode) {
      themeChoice = THEMES.indexOf(mode) !== -1 ? mode : null;
      try {
        if (themeChoice) root.localStorage.setItem(THEME_KEY, themeChoice);
        else root.localStorage.removeItem(THEME_KEY);
      } catch (e) {
        /* storage unavailable: the choice still applies to this page view */
      }
      applyTheme();
      return theme.effective();
    },
    /** Switch to the other theme (an explicit choice). Returns the new effective theme. */
    toggle: function () {
      return theme.set(theme.effective() === 'dark' ? 'light' : 'dark');
    },
    /** Apply the remembered choice and start following the device (idempotent; runs at load and boot). */
    init: function () {
      if (themeInited) return;
      themeInited = true;
      themeChoice = readThemeChoice();
      themeMq = root.matchMedia ? root.matchMedia('(prefers-color-scheme: dark)') : null;
      var onDevice = function () {
        if (!themeChoice) applyTheme();
      };
      if (themeMq && themeMq.addEventListener) themeMq.addEventListener('change', onDevice);
      else if (themeMq && themeMq.addListener) themeMq.addListener(onDevice);
      // A choice made in another tab of this statement applies here too.
      if (root.addEventListener) {
        root.addEventListener('storage', function (e) {
          if (e.key !== THEME_KEY && e.key !== null) return;
          themeChoice = readThemeChoice();
          applyTheme();
        });
      }
      applyTheme();
    }
  });
  if (doc && doc.documentElement) theme.init();

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
  /** Live region inside the topmost open modal dialog (the rest of the page is inert). */
  function modalLiveRegion(assertive) {
    var open;
    try {
      open = doc.querySelectorAll('dialog[open]:modal');
    } catch (e) {
      open = [];
    }
    var top = open.length ? open[open.length - 1] : null;
    if (!top) return null;
    var cls = assertive ? 'dlg-live--assertive' : 'dlg-live--polite';
    var region = top.querySelector(':scope > .' + cls);
    if (!region) {
      region = doc.createElement('div');
      region.className = 'sr-only ' + cls;
      region.setAttribute('aria-live', assertive ? 'assertive' : 'polite');
      region.setAttribute('aria-atomic', 'true');
      top.appendChild(region);
    }
    return region;
  }
  ui.announce = function (msg, assertive) {
    var region = modalLiveRegion(assertive) || doc.getElementById(assertive ? 'live-assertive' : 'live-polite');
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

  /** True when an element's text runs over more than one line. */
  function wrapsText(el) {
    var node = el.firstChild;
    if (!node || !doc.createRange) return false;
    var range = doc.createRange();
    range.selectNodeContents(el);
    var rects = range.getClientRects();
    for (var i = 1; i < rects.length; i++) {
      if (rects[i].top >= rects[0].bottom - 1) return true;
    }
    return false;
  }

  /**
   * Short visual confirmation (also announced). The toast is a manual popover:
   * re-showing it puts it at the top of the top layer, above any open modal
   * dialog or sheet, so a confirmation is never painted underneath one. One line
   * is a pill; a message that wraps (a long confirmation on a phone) becomes a
   * rounded rectangle, never a stretched pill.
   */
  var toastTimer = null;
  ui.toast = function (msg) {
    var el = doc.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.remove('is-multiline');
    if (typeof el.showPopover === 'function') {
      try {
        if (el.matches(':popover-open')) el.hidePopover();
        el.showPopover();
        void el.offsetWidth; // start the fade from the hidden state
      } catch (e) {
        /* popover unsupported in this context: the fixed toast still shows */
      }
    }
    el.classList.toggle('is-multiline', wrapsText(el));
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

  /**
   * Save a generated file locally (no network). `content` is a string or bytes
   * (e.g. a Uint8Array from YES.pdf's save()). The helper link is hidden and
   * removed at once, so it never sits in the page as an empty, focusable link.
   */
  ui.download = function (filename, content, mime) {
    var blob = new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = doc.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    a.hidden = true;
    a.tabIndex = -1;
    a.setAttribute('aria-hidden', 'true');
    doc.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () {
      URL.revokeObjectURL(url);
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
    dlg._noReturnFocus = false;
    if (!dlg._yesBound) {
      dlg._yesBound = true;
      dlg.addEventListener('close', function () {
        doc.documentElement.classList.toggle('has-modal', ui.anyModalOpen());
        // 'close' fires asynchronously: if the dialog was reopened in the meantime,
        // this event belongs to the previous opening and must not clear the new one.
        if (dlg.open) return;
        var t = dlg._trigger;
        var cb = dlg._onClose;
        var skipFocus = dlg._noReturnFocus;
        dlg._trigger = null;
        dlg._onClose = null;
        dlg._noReturnFocus = false;
        if (cb) cb(dlg.returnValue);
        if (skipFocus) return;
        if (t && t.isConnected) {
          t.focus({ preventScroll: true });
        } else if (t && t.getAttribute && t.getAttribute('data-fk')) {
          ui.focusKey(t.getAttribute('data-fk'));
        }
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

  /** The element focus returns to when `dlg` closes (null if none). */
  ui.dialogTrigger = function (dlg) {
    return (dlg && dlg._trigger) || null;
  };
  /** Change where focus returns when an open dialog closes (e.g. after previous/next). */
  ui.setDialogReturn = function (dlg, el) {
    if (dlg) dlg._trigger = el || null;
  };

  /** Close a dialog. opts.returnFocus=false skips focus restoration (when handing off to another dialog). */
  ui.closeDialog = function (dlg, opts) {
    if (!dlg || !dlg.open) return;
    if (opts && opts.returnFocus === false) dlg._noReturnFocus = true;
    dlg.close(opts && opts.value);
  };

  /* ------------------------------ Icons ----------------------------- */
  /* 24×24 stroke icons from Lucide (https://lucide.dev, lucide-static 1.52.0;
     ISC License, Copyright (c) Lucide Icons and Contributors): 2px stroke,
     round caps and joins. The keys are the statement's own names (the Lucide
     name follows each entry), so modules never name a Lucide icon directly.
     Decorative unless a label is passed. */
  var ICONS = {
    'arrow-in': '<path d="M12 17V3"/><path d="m6 11 6 6 6-6"/><path d="M19 21H5"/>', // arrow-down-to-line
    'arrow-out': '<path d="m18 9-6-6-6 6"/><path d="M12 3v14"/><path d="M5 21h14"/>', // arrow-up-from-line
    'arrow-right': '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>', // arrow-right
    'arrow-left': '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>', // arrow-left
    fee: '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="M9 9h.01"/><path d="M15 15h.01"/>', // circle-percent
    redeem: '<path d="m16 3 4 4-4 4"/><path d="M20 7H4"/><path d="m8 21-4-4 4-4"/><path d="M4 17h16"/>', // arrow-right-left
    deposit: '<path d="M12 18H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5"/><path d="m16 19 3 3 3-3"/><path d="M18 12h.01"/><path d="M19 16v6"/><path d="M6 12h.01"/><circle cx="12" cy="12" r="2"/>', // banknote-arrow-down
    balance: '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>', // chart-column
    search: '<path d="m21 21-4.34-4.34"/><circle cx="11" cy="11" r="8"/>', // search
    filter: '<path d="M2 5h20"/><path d="M6 12h12"/><path d="M9 19h6"/>', // list-filter
    sort: '<path d="m3 16 4 4 4-4"/><path d="M7 20V4"/><path d="m21 8-4-4-4 4"/><path d="M17 4v16"/>', // arrow-down-up
    close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>', // x
    check: '<path d="M20 6 9 17l-5-5"/>', // check
    'check-circle': '<circle cx="12" cy="12" r="10"/><path d="m16 9-5.5 5.5L8 12"/>', // circle-check
    alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>', // triangle-alert
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>', // info
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>', // clock
    question: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>', // circle-question-mark
    chat: '<path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z"/>', // message-square
    sparkle: '<path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"/><path d="M20 2v4"/><path d="M22 4h-4"/><circle cx="4" cy="20" r="2"/>', // sparkles
    copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>', // copy
    download: '<path d="M12 15V3"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/>', // download
    print: '<path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 9V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v6"/><rect x="6" y="14" width="12" height="8" rx="1"/>', // printer
    play: '<path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"/>', // play
    chevron: '<path d="m9 18 6-6-6-6"/>', // chevron-right
    'chevron-down': '<path d="m6 9 6 6 6-6"/>', // chevron-down
    external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>', // external-link
    lock: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>', // lock
    globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>', // globe
    chain: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>', // link
    bank: '<path d="M10 18v-7"/><path d="M11.119 2.205a2 2 0 0 1 1.762 0l7.84 3.846A.5.5 0 0 1 20.5 7h-17a.5.5 0 0 1-.22-.949z"/><path d="M14 18v-7"/><path d="M18 18v-7"/><path d="M3 22h18"/><path d="M6 18v-7"/>', // landmark
    user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>', // user
    phone: '<path d="M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384"/>', // phone
    mail: '<path d="m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7"/><rect x="2" y="4" width="20" height="16" rx="2"/>', // mail
    book: '<path d="M12 5v16"/><path d="M20.001 19A2 2 0 0022 17V5a2 2 0 00-1.999-2L16 3.002A5 5 0 0012 5a5 5 0 00-4-2H4a2 2 0 00-2 2v12a2 2 0 001.999 2H8a5 5 0 014 2 5 5 0 014-2z"/>', // book-open
    shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>', // shield
    thumbsUp: '<path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"/><path d="M7 10v12"/>', // thumbs-up
    thumbsDown: '<path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z"/><path d="M17 14V2"/>', // thumbs-down
    menu: '<path d="M4 5h16"/><path d="M4 12h16"/><path d="M4 19h16"/>', // menu
    moon: '<path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401"/>', // moon
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>', // sun
    'file-down': '<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/><path d="M12 18v-6"/><path d="m9 15 3 3 3-3"/>', // file-down
    eye: '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>', // eye
    video: '<path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5"/><rect x="2" y="6" width="14" height="12" rx="2"/>', // video
    accessibility: '<circle cx="16" cy="4" r="1"/><path d="m18 19 1-7-6 1"/><path d="m5 8 3-3 5.5 3-2.36 3.5"/><path d="M4.24 14.5a5 5 0 0 0 6.88 6"/><path d="M13.76 17.5a5 5 0 0 0-6.88-6"/>', // accessibility
    calendar: '<path d="M8 2v3"/><path d="M16 2v3"/><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/>' // calendar
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
      '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ' +
      a11y +
      '>' +
      body +
      '</svg>'
    );
  };
  ui.ICONS = ICONS;
  /** Add icons in the shared 24×24 stroke style: ui.registerIcons({ name: '<path d="…"/>' }). */
  ui.registerIcons = function (map) {
    Object.keys(map || {}).forEach(function (k) {
      ICONS[k] = map[k];
    });
  };

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

  /**
   * Customer-friendly type label; the canonical type stays in the data.
   *   ui.typeLabel(tx)            — preferred: status-aware, so a pending
   *                                 redemption reads "Redemption requested",
   *                                 never the completed "Redeemed"
   *   ui.typeLabel(type[, status]) — a bare type (e.g. a filter facet) gets the
   *                                 canonical label
   */
  ui.typeLabel = function (typeOrTx, status) {
    var type = typeOrTx && typeof typeOrTx === 'object' ? typeOrTx.type : typeOrTx;
    if (typeOrTx && typeof typeOrTx === 'object' && status === undefined) status = typeOrTx.status;
    var table = YES.i18n.dict[YES.i18n.lang] || {};
    var k = 'type.' + type;
    if (status && status !== 'posted' && table[k + '.notPosted']) return YES.t(k + '.notPosted');
    return table[k] ? YES.t(k) : YES.t('type.unknown');
  };

  /**
   * Text containing masked identifiers ("Debit card •••• 1190") as HTML: the
   * bullets stay visible but hidden from assistive technology, which hears
   * "Debit card ending in 1190" instead. For aria-labels use YES.fmt.maskedSpoken.
   */
  ui.maskedHtml = function (text) {
    var str = String(text == null ? '' : text);
    var out = '';
    var last = 0;
    str.replace(YES.fmt.MASK_RE, function (m, dots, tail, at) {
      out += ui.esc(str.slice(last, at));
      out += '<span aria-hidden="true">' + ui.esc(m) + '</span><span class="sr-only">' + ui.esc(YES.t('fmt.maskedEnding', { tail: tail })) + '</span>';
      last = at + m.length;
      return m;
    });
    return out + ui.esc(str.slice(last));
  };

  /**
   * Language switch markup, for the shell only: the masthead and the phone
   * menu. The masthead is the ONE place to change language; dialogs, sheets
   * and the assistant drawer do not carry a switch and keep the language
   * chosen before they opened (to change it, the visitor closes the dialog;
   * drafts and conversations are kept in YES.state). Each button's accessible
   * name is the language's own name ("English", "Español") at every width;
   * compact layouts show "EN"/"ES" and keep the name in the accessibility tree.
   *   opts.fk — focus-key prefix (default 'lang'); opts.compact — always show EN/ES
   * Clicks on any [data-lang] control are handled globally.
   */
  ui.langSwitchHtml = function (opts) {
    opts = opts || {};
    var prefix = opts.fk || 'lang';
    var buttons = YES.config.languages
      .map(function (l) {
        return (
          '<button type="button" class="seg__btn" lang="' +
          l +
          '" data-lang="' +
          l +
          '" data-fk="' +
          ui.esc(prefix) +
          '-' +
          l +
          '" aria-pressed="' +
          (l === YES.i18n.lang) +
          '"><span class="seg__long">' +
          ui.esc(YES.t('lang.' + l)) +
          '</span><span class="seg__short" aria-hidden="true">' +
          l.toUpperCase() +
          '</span></button>'
        );
      })
      .join('');
    return (
      '<div class="seg seg--lang' +
      (opts.compact ? ' seg--compact' : '') +
      '" role="group" aria-label="' +
      ui.esc(YES.t('lang.label')) +
      '">' +
      ui.icon('globe', { size: 18, cls: 'seg__icon' }) +
      buttons +
      '</div>'
    );
  };

  /**
   * The [YES_LOGO] brand slot (YES.config.slots.YES_LOGO) as one element, for
   * every place that shows the logo (masthead, video poster, print header):
   *   slot.svg — approved SVG markup (trusted configuration, inserted as is)
   *   slot.src — approved image as a data: URI (a URL that would fetch is ignored:
   *              the file makes no network request for its own assets)
   *   neither  — the text placeholder (slot.text), outlined as a placeholder
   * The element is an image named by 'brand.logoAlt' ("YES"), or hidden from
   * assistive technology with opts.decorative (when nearby text already names YES).
   *   opts.cls  — class name(s) to add; the first also gets the state modifier,
   *               like yes-logo itself: <cls>--art or <cls>--placeholder
   *   opts.size — height: a number (px) or a CSS length ('28pt', '2.5rem'); the
   *               placeholder lettering and the artwork scale with it
   */
  var LOGO_SRC_RE = /^data:image\/(?:png|jpeg|gif|webp|avif|svg\+xml)[;,]/i;
  var LOGO_SIZE_RE = /^\d+(?:\.\d+)?(?:px|pt|rem|em|mm)$/;
  ui.logoHtml = function (opts) {
    opts = opts || {};
    var slot = (YES.config && YES.config.slots && YES.config.slots.YES_LOGO) || {};
    var src = typeof slot.src === 'string' && LOGO_SRC_RE.test(slot.src) ? slot.src : null;
    var kind = slot.svg || src ? 'art' : 'placeholder';
    var extra = String(opts.cls || '')
      .split(/\s+/)
      .filter(Boolean);
    var classes = ['yes-logo', 'yes-logo--' + kind].concat(extra);
    if (extra.length) classes.push(extra[0] + '--' + kind);
    var size = typeof opts.size === 'number' && opts.size > 0 ? opts.size + 'px' : LOGO_SIZE_RE.test(String(opts.size || '')) ? String(opts.size) : '';
    var name = YES.t('brand.logoAlt');
    var html = '<span class="' + ui.esc(classes.join(' ')) + '" data-slot="YES_LOGO"' + (size ? ' style="--logo-h: ' + size + '"' : '');
    html += opts.decorative ? ' aria-hidden="true"' : ' role="img" aria-label="' + ui.esc(name) + '"';
    if (kind === 'placeholder' && !opts.decorative) html += ' title="' + ui.esc(YES.t('brand.logoPlaceholder')) + '"';
    html += '>';
    if (slot.svg) html += String(slot.svg);
    else if (src) html += '<img src="' + ui.esc(src) + '" alt="" />';
    else html += ui.esc(slot.text || name);
    return html + '</span>';
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
    // [data-lang] buttons switch language wherever they are (masthead or a dialog).
    doc.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-lang]');
      if (!b || b.tagName !== 'BUTTON') return;
      var l = b.getAttribute('data-lang');
      if (l !== YES.i18n.lang) YES.setLang(l);
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
