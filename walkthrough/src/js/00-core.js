/*
 * 00-core.js — the WT runtime (SPEC section 3). Owner: foundation.
 *
 * Everything other modules share: escaping and rendering, events, the feature
 * list, the module registry and hash router, theme, reviewer identity, the API
 * client, answers with an offline-safe save queue, announcements, icons,
 * formatting, dialogs, toasts and small UI builders. The full reference with
 * one line per helper is docs/SPEC.md section 12.
 */
(function (WT) {
  'use strict';

  var doc = document;
  var win = window;
  WT.features = WT.features || []; // inlined by build.mjs
  WT.version = '1';

  /* ================================================================== */
  /* Escaping and rendering                                              */
  /* ================================================================== */

  var ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };
  /** HTML-escape any value for text or attribute positions. */
  WT.esc = function (v) {
    return String(v === null || v === undefined ? '' : v).replace(/[&<>"'`]/g, function (c) {
      return ESC[c];
    });
  };

  /** Marks a string as trusted HTML for WT.h (never wrap user text in it). */
  function Raw(html) {
    this.html = String(html);
  }
  Raw.prototype.toString = function () {
    return this.html;
  };
  WT.raw = function (html) {
    return new Raw(html);
  };

  function interp(v) {
    if (v instanceof Raw) return v.html;
    if (Array.isArray(v)) return v.map(interp).join('');
    if (v === null || v === undefined || v === false) return '';
    return WT.esc(v);
  }
  /**
   * Tagged template that escapes every value. Arrays are joined, WT.raw(html)
   * and nested WT.h results pass through, null/undefined/false render nothing.
   *   WT.render(el, WT.h`<p>${name}</p>${WT.raw(WT.icon('check'))}`)
   * Returns a Raw (use String(x) or `${x}` if you need the string).
   */
  WT.h = function (strings) {
    var out = strings[0];
    for (var i = 1; i < arguments.length; i++) out += interp(arguments[i]) + strings[i];
    return new Raw(out);
  };

  /**
   * Replace el's content with html (string or WT.h result) and restore focus,
   * and the text selection, to the element with the same data-fk.
   */
  WT.render = function (el, html) {
    if (!el) return;
    var active = doc.activeElement;
    var key = active && el.contains(active) && active.getAttribute && active.getAttribute('data-fk');
    var sel = null;
    var scroll = null;
    if (key) {
      try {
        if (typeof active.selectionStart === 'number') sel = [active.selectionStart, active.selectionEnd];
      } catch (e) {
        sel = null;
      }
      if (typeof active.scrollTop === 'number') scroll = active.scrollTop;
    }
    el.innerHTML = String(html);
    if (key) {
      var next = el.querySelector('[data-fk="' + cssEscape(key) + '"]');
      if (next) {
        next.focus({ preventScroll: true });
        if (sel && typeof next.setSelectionRange === 'function') {
          try {
            next.setSelectionRange(sel[0], sel[1]);
          } catch (e2) {
            /* not a text control */
          }
        }
        if (scroll !== null) next.scrollTop = scroll;
      }
    }
  };

  function cssEscape(s) {
    return win.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&');
  }
  WT.cssEscape = cssEscape;

  WT.$ = function (sel, root) {
    return (root || doc).querySelector(sel);
  };
  WT.$$ = function (sel, root) {
    return Array.prototype.slice.call((root || doc).querySelectorAll(sel));
  };
  /** Delegated listener: fn(event, matchedElement) for events inside root that match selector. */
  WT.delegate = function (root, evt, selector, fn, opts) {
    root.addEventListener(
      evt,
      function (e) {
        var t = e.target && e.target.closest ? e.target.closest(selector) : null;
        if (t && root.contains(t)) fn(e, t);
      },
      opts
    );
  };
  WT.debounce = function (fn, ms) {
    var t = null;
    var d = function () {
      var args = arguments;
      var self = this;
      clearTimeout(t);
      t = setTimeout(function () {
        fn.apply(self, args);
      }, ms);
    };
    d.cancel = function () {
      clearTimeout(t);
    };
    return d;
  };
  WT.reducedMotion = function () {
    return !!(win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches);
  };
  /** True below the phone breakpoint (720px). */
  WT.isNarrow = function () {
    return !!(win.matchMedia && win.matchMedia('(max-width: 719.98px)').matches);
  };
  /** Stable unique id for aria wiring: WT.uid('fld') → 'fld-3'. */
  var uidN = 0;
  WT.uid = function (prefix) {
    uidN += 1;
    return (prefix || 'wt') + '-' + uidN;
  };

  /* ================================================================== */
  /* Storage (never throws)                                              */
  /* ================================================================== */

  function makeStorage(kind) {
    function area() {
      try {
        return win[kind];
      } catch (e) {
        return null;
      }
    }
    return {
      get: function (key, fallback) {
        try {
          var raw = area().getItem(key);
          return raw === null ? fallback : JSON.parse(raw);
        } catch (e) {
          return fallback;
        }
      },
      getRaw: function (key) {
        try {
          return area().getItem(key);
        } catch (e) {
          return null;
        }
      },
      set: function (key, value) {
        try {
          area().setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
          return true;
        } catch (e) {
          return false;
        }
      },
      remove: function (key) {
        try {
          area().removeItem(key);
        } catch (e) {
          /* ignore */
        }
      }
    };
  }
  WT.storage = makeStorage('localStorage');
  WT.session = makeStorage('sessionStorage');

  /* ================================================================== */
  /* Events                                                              */
  /* ================================================================== */

  var listeners = {};
  /** Subscribe; returns an unsubscribe function. */
  WT.on = function (evt, fn) {
    (listeners[evt] = listeners[evt] || []).push(fn);
    return function () {
      WT.off(evt, fn);
    };
  };
  WT.off = function (evt, fn) {
    var l = listeners[evt];
    if (!l) return;
    var i = l.indexOf(fn);
    if (i !== -1) l.splice(i, 1);
  };
  WT.emit = function (evt, payload) {
    var l = (listeners[evt] || []).slice();
    for (var i = 0; i < l.length; i++) {
      try {
        l[i](payload);
      } catch (e) {
        if (win.console) console.error('[WT] ' + evt + ' listener failed', e);
      }
    }
  };

  /* ================================================================== */
  /* Features                                                            */
  /* ================================================================== */

  var featureMap = null;
  function fmap() {
    if (!featureMap) {
      featureMap = {};
      WT.features.forEach(function (f, i) {
        featureMap[f.id] = f;
        f.index = i;
      });
    }
    return featureMap;
  }
  /** The feature object for an id, or null. Each has id, order, section, title, short, index (0-based). */
  WT.feature = function (id) {
    return fmap()[id] || null;
  };
  /** 0-based position in tour order, or -1. */
  WT.featureIndex = function (id) {
    var f = WT.feature(id);
    return f ? f.index : -1;
  };
  WT.SECTIONS = {
    overview: 'Overview',
    transactions: 'Transactions',
    understand: 'Understand',
    help: 'Help',
    everywhere: 'Throughout the statement'
  };
  WT.sectionLabel = function (section) {
    return WT.SECTIONS[section] || section;
  };
  /** Paths to the screenshots of a feature (generated by scripts/shots.mjs). */
  WT.shot = function (id, thumb) {
    return 'assets/shots/' + encodeURIComponent(id) + (thumb ? '-thumb' : '') + '.jpg';
  };
  WT.ANONYMOUS = 'Anonymous reviewer';
  WT.LIMITS = { name: 60, reason: 500, comment: 2000 };

  /* ================================================================== */
  /* Module registry and router                                          */
  /* ================================================================== */

  var VIEW_TITLES = { start: 'Start', tour: 'Walkthrough', results: 'Results', data: 'Data requirements', admin: 'Admin' };
  WT.VIEWS = VIEW_TITLES;
  var modules = [];
  var viewModules = {};
  var booted = false;
  var current = null;

  /**
   * Register a module: { name, view?, init(), render(param, route), onRoute?(param, route), leave?() }.
   * A view module renders into <section id="view-<view>">. render() runs when the
   * view is entered; onRoute() (if given) runs instead when only the param changes
   * within the same view; leave() runs when another view takes over.
   */
  WT.register = function (mod) {
    if (!mod || !mod.name) throw new Error('WT.register: a module needs a name');
    modules.push(mod);
    if (mod.view) viewModules[mod.view] = mod;
    if (booted) {
      initModule(mod);
      if (current && mod.view === current.view) route({ force: true });
    }
    return mod;
  };
  WT.module = function (name) {
    for (var i = 0; i < modules.length; i++) if (modules[i].name === name) return modules[i];
    return null;
  };

  function initModule(mod) {
    if (mod._inited || typeof mod.init !== 'function') return;
    mod._inited = true;
    try {
      mod.init();
    } catch (e) {
      if (win.console) console.error('[WT] init failed: ' + mod.name, e);
    }
  }

  function safeDecode(s) {
    try {
      return decodeURIComponent(s);
    } catch (e) {
      return s;
    }
  }

  /** Parse '#/view/param' → { view, param, path }. Non-route hashes return null. */
  WT.parseRoute = function (hash) {
    var h = String(hash === undefined ? location.hash : hash).replace(/^#/, '');
    if (h === '' || h === '/') return { view: 'start', param: '', path: '/start' };
    if (h.charAt(0) !== '/') return null;
    var parts = h.split('?')[0].split('/').filter(Boolean).map(safeDecode);
    var view = parts[0] || 'start';
    var param = parts[1] || '';
    return { view: view, param: param, path: '/' + view + (param ? '/' + param : '') };
  };

  WT.route = function () {
    return current ? { view: current.view, param: current.param, path: current.path } : null;
  };

  /** Navigate: WT.go('/tour/journey') or WT.go('#/results'). Pushes history (opts.replace to replace). */
  WT.go = function (path, opts) {
    opts = opts || {};
    var p = String(path || '/start').replace(/^#/, '');
    if (p.charAt(0) !== '/') p = '/' + p;
    var r = WT.parseRoute('#' + p) || { path: '/start' };
    var hash = '#' + r.path.split('/').map(function (s, i) {
      return i ? encodeURIComponent(s) : s;
    }).join('/');
    if (location.hash !== hash) {
      try {
        if (opts.replace) history.replaceState(null, '', hash);
        else history.pushState(null, '', hash);
      } catch (e) {
        location.hash = hash;
        return;
      }
    }
    route({ force: !!opts.force });
  };

  /** Re-run the current route (e.g. after data arrives). */
  WT.refresh = function () {
    route({ force: true });
  };

  WT.setTitle = function (part) {
    doc.title = (part ? part + ' · ' : '') + 'YES statement review · InfoSlips';
  };

  /** Focus the view's h1 (adds tabindex=-1 if missing). */
  WT.focusView = function (view) {
    var sec = doc.getElementById('view-' + (view || (current && current.view)));
    var h1 = sec && sec.querySelector('h1');
    if (!h1) return false;
    if (!h1.hasAttribute('tabindex')) h1.setAttribute('tabindex', '-1');
    h1.focus({ preventScroll: true });
    return true;
  };

  function placeholder(section, view) {
    var title = VIEW_TITLES[view] || 'This page';
    WT.render(
      section,
      '<div class="wt-container wt-placeholder">' +
        '<h1 class="wt-title" tabindex="-1">' + WT.esc(title) + '</h1>' +
        '<p class="wt-lead">We’re still putting this page together. Please check back soon.</p>' +
        '<p><a class="wt-btn wt-btn--secondary" href="#/start">' + WT.icon('arrow-left') + '<span>Back to the start</span></a></p>' +
      '</div>'
    );
  }

  function failure(section, view, err) {
    if (win.console) console.error('[WT] could not show ' + view, err);
    WT.render(
      section,
      '<div class="wt-container wt-placeholder">' +
        '<h1 class="wt-title" tabindex="-1">' + WT.esc(VIEW_TITLES[view] || 'Something went wrong') + '</h1>' +
        WT.ui.notice({ kind: 'error', title: 'Something went wrong showing this page.', html: 'Please reload the page. Your answers are saved in this browser.' }) +
        '<p><button class="wt-btn wt-btn--secondary" type="button" data-wt-reload>' + WT.icon('refresh') + '<span>Reload</span></button></p>' +
      '</div>'
    );
  }

  function route(opts) {
    opts = opts || {};
    var r = WT.parseRoute(location.hash);
    if (r === null) {
      // An in-page anchor (e.g. #main): not a route. Keep the current view.
      if (current) return;
      r = { view: 'start', param: '', path: '/start' };
    }
    if (!VIEW_TITLES[r.view]) {
      try {
        history.replaceState(null, '', '#/start');
      } catch (e) {
        /* ignore */
      }
      r = { view: 'start', param: '', path: '/start' };
    }
    if (!opts.force && current && current.path === r.path) return;
    var prev = current;
    current = r;
    var sameView = !!(prev && prev.view === r.view);

    if (prev && !sameView) {
      var pm = viewModules[prev.view];
      if (pm && typeof pm.leave === 'function') {
        try {
          pm.leave();
        } catch (e) {
          if (win.console) console.error('[WT] leave failed: ' + pm.name, e);
        }
      }
    }

    WT.$$('.wt-view').forEach(function (s) {
      s.hidden = s.id !== 'view-' + r.view;
    });
    doc.documentElement.setAttribute('data-view', r.view);
    WT.setTitle(VIEW_TITLES[r.view]);

    var section = doc.getElementById('view-' + r.view);
    var mod = viewModules[r.view];
    var result = null;
    try {
      if (!mod) placeholder(section, r.view);
      else if (sameView && !opts.force && typeof mod.onRoute === 'function') result = mod.onRoute(r.param, r);
      else result = mod.render(r.param, r);
    } catch (e) {
      failure(section, r.view, e);
    }

    if (prev && !(mod && mod.keepScroll && sameView)) {
      try {
        win.scrollTo({ top: 0, left: 0, behavior: 'instant' });
      } catch (e) {
        win.scrollTo(0, 0);
      }
    }
    var manages = mod && mod.manageFocus;
    if (prev && !opts.force && !manages) WT.focusView(r.view);
    if (result && typeof result.then === 'function') {
      result.then(
        function () {
          if (prev && !opts.force && !manages && current === r && (doc.activeElement === doc.body || !doc.activeElement)) WT.focusView(r.view);
        },
        function (e) {
          if (current === r) failure(section, r.view, e);
        }
      );
    }
    WT.emit('route', { view: r.view, param: r.param, path: r.path, prev: prev ? prev.path : null });
  }

  /** Called once by 99-boot.js. */
  WT.boot = function () {
    if (booted) return;
    booted = true;
    try {
      history.scrollRestoration = 'manual';
    } catch (e) {
      /* ignore */
    }
    WT.theme.init();
    modules.forEach(initModule);
    win.addEventListener('popstate', function () {
      route();
    });
    win.addEventListener('hashchange', function () {
      route();
    });
    doc.addEventListener('click', function (e) {
      var t = e.target && e.target.closest && e.target.closest('[data-wt-reload]');
      if (t) location.reload();
    });
    if (!location.hash || location.hash === '#' || location.hash === '#/') {
      try {
        history.replaceState(null, '', '#/start');
      } catch (e) {
        /* ignore */
      }
    }
    route({ force: true });
    WT.answers.init();
    WT.ready = true;
    doc.documentElement.setAttribute('data-wt-ready', '1');
    WT.emit('ready');
  };

  /* ================================================================== */
  /* Theme                                                               */
  /* ================================================================== */

  var THEME_KEY = 'infoslips.wt.theme';
  var themeChoice = null;
  var themeMq = null;
  var themeShown = null;
  function readTheme() {
    var v = WT.storage.getRaw(THEME_KEY);
    return v === 'light' || v === 'dark' ? v : null;
  }
  function applyTheme() {
    var eff = WT.theme.effective();
    doc.documentElement.setAttribute('data-theme', eff);
    if (eff !== themeShown) {
      var first = themeShown === null;
      themeShown = eff;
      if (!first) WT.emit('theme', eff);
    }
  }
  WT.theme = {
    /** The saved choice ('light' | 'dark') or null while following the device. */
    get: function () {
      return themeChoice;
    },
    device: function () {
      return themeMq && themeMq.matches ? 'dark' : 'light';
    },
    /** The theme on screen. */
    effective: function () {
      return themeChoice || WT.theme.device();
    },
    /** 'light' | 'dark' saves a choice; null follows the device again. Emits 'theme' when the look changes. */
    set: function (mode) {
      themeChoice = mode === 'light' || mode === 'dark' ? mode : null;
      if (themeChoice) WT.storage.set(THEME_KEY, themeChoice);
      else WT.storage.remove(THEME_KEY);
      applyTheme();
      return WT.theme.effective();
    },
    toggle: function () {
      return WT.theme.set(WT.theme.effective() === 'dark' ? 'light' : 'dark');
    },
    init: function () {
      if (themeMq) return;
      themeChoice = readTheme();
      themeMq = win.matchMedia ? win.matchMedia('(prefers-color-scheme: dark)') : null;
      var onDevice = function () {
        if (!themeChoice) applyTheme();
      };
      if (themeMq && themeMq.addEventListener) themeMq.addEventListener('change', onDevice);
      else if (themeMq && themeMq.addListener) themeMq.addListener(onDevice);
      win.addEventListener('storage', function (e) {
        if (e.key !== THEME_KEY && e.key !== null) return;
        themeChoice = readTheme();
        applyTheme();
      });
      applyTheme();
    }
  };

  /* ================================================================== */
  /* Reviewer identity                                                   */
  /* ================================================================== */

  var REVIEWER_KEY = 'infoslips.wt.reviewer';
  var CONTROL_RE = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069\uFEFF]/g;

  function randomHex(bytes) {
    var a = new Uint8Array(bytes);
    win.crypto.getRandomValues(a);
    var s = '';
    for (var i = 0; i < a.length; i++) s += (a[i] < 16 ? '0' : '') + a[i].toString(16);
    return s;
  }

  function cleanName(name) {
    return String(name || '')
      .replace(CONTROL_RE, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, WT.LIMITS.name);
  }
  WT.cleanName = cleanName;

  var rec = null; // { secret, name, rid, answers, lastStep }
  function loadReviewer() {
    if (rec) return rec;
    var r = WT.storage.get(REVIEWER_KEY, null);
    if (!r || typeof r !== 'object') r = {};
    rec = {
      secret: typeof r.secret === 'string' && /^[0-9a-f]{64}$/.test(r.secret) ? r.secret : '',
      name: typeof r.name === 'string' ? cleanName(r.name) : '',
      rid: typeof r.rid === 'string' ? r.rid : '',
      answers: r.answers && typeof r.answers === 'object' ? r.answers : {},
      lastStep: typeof r.lastStep === 'string' ? r.lastStep : ''
    };
    return rec;
  }
  function saveReviewer() {
    WT.storage.set(REVIEWER_KEY, rec);
  }
  function ensureSecret() {
    loadReviewer();
    if (!rec.secret) {
      rec.secret = randomHex(32);
      rec.rid = '';
      saveReviewer();
    }
    return rec.secret;
  }

  WT.reviewer = {
    /** A copy of { secret, name, rid, answers, lastStep }. secret is '' until the first save. */
    get: function () {
      var r = loadReviewer();
      return JSON.parse(JSON.stringify(r));
    },
    /** The secret, created now if needed (32 random bytes as hex). */
    secret: ensureSecret,
    name: function () {
      return loadReviewer().name;
    },
    /** Name or "Anonymous reviewer". */
    displayName: function () {
      return loadReviewer().name || WT.ANONYMOUS;
    },
    /** Save a name (trimmed, max 60). Saves to the server in the background. Returns the cleaned name. */
    setName: function (name) {
      loadReviewer();
      var clean = cleanName(name);
      if (clean === rec.name) return clean;
      rec.name = clean;
      ensureSecret();
      saveReviewer();
      queueName(clean);
      WT.emit('reviewer', WT.reviewer.get());
      return clean;
    },
    lastStep: function () {
      var id = loadReviewer().lastStep;
      return WT.feature(id) ? id : '';
    },
    setLastStep: function (id) {
      loadReviewer();
      if (!WT.feature(id) || rec.lastStep === id) return;
      rec.lastStep = id;
      saveReviewer();
    },
    /** Promise of this browser's reviewer id (sha256(secret)[0:24]), or '' with no secret yet. */
    rid: function () {
      loadReviewer();
      if (rec.rid) return Promise.resolve(rec.rid);
      if (!rec.secret) return Promise.resolve('');
      var secret = rec.secret;
      return win.crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret)).then(function (buf) {
        var h = Array.prototype.map
          .call(new Uint8Array(buf), function (b) {
            return (b < 16 ? '0' : '') + b.toString(16);
          })
          .join('')
          .slice(0, 24);
        if (rec.secret === secret) {
          rec.rid = h;
          saveReviewer();
        }
        return h;
      });
    },
    /** True when this browser has answered anything or chosen a name. */
    hasProgress: function () {
      var r = loadReviewer();
      return !!(r.lastStep || Object.keys(r.answers).length);
    },
    /**
     * "Start as a new reviewer": tries to save anything still queued, then gives
     * this browser a fresh identity with no name, answers or progress. The old
     * answers stay in the shared results. Returns a promise.
     */
    reset: function () {
      var done = function () {
        clearPending();
        rec = { secret: randomHex(32), name: '', rid: '', answers: {}, lastStep: '' };
        saveReviewer();
        WT.emit('reviewer', WT.reviewer.get());
        WT.emit('answers', null);
        WT.emit('saved', { ok: true, pending: 0 });
      };
      return WT.answers.flush().then(done, done);
    }
  };

  /* ================================================================== */
  /* API client                                                          */
  /* ================================================================== */

  function ApiError(status, code, message) {
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.message = message;
    this.stack = new Error(message).stack;
  }
  ApiError.prototype = Object.create(Error.prototype);
  ApiError.prototype.constructor = ApiError;
  WT.ApiError = ApiError;

  var ADMIN_KEY = 'infoslips.wt.admin';

  function request(method, path, opts) {
    opts = opts || {};
    var headers = { Accept: 'application/json' };
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    if (opts.secret) headers['X-Reviewer-Secret'] = opts.secret;
    if (opts.admin) headers['X-Admin-Code'] = opts.admin;
    var ctrl = win.AbortController ? new AbortController() : null;
    var timer = ctrl
      ? setTimeout(function () {
          ctrl.abort();
        }, opts.timeout || 15000)
      : null;
    return fetch(path, {
      method: method,
      headers: headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      credentials: 'same-origin',
      cache: 'no-store',
      signal: ctrl ? ctrl.signal : undefined
    }).then(
      function (res) {
        clearTimeout(timer);
        if (res.status === 204) return null;
        return res.text().then(function (text) {
          var data = null;
          try {
            data = text ? JSON.parse(text) : null;
          } catch (e) {
            data = null;
          }
          if (!res.ok) {
            var err = data && data.error;
            if (opts.admin && res.status === 401) WT.api.admin.signOut();
            throw new ApiError(res.status, (err && err.code) || 'http_' + res.status, (err && err.message) || 'The server answered ' + res.status + '. Please try again.');
          }
          return data;
        });
      },
      function () {
        clearTimeout(timer);
        var offline = win.navigator && navigator.onLine === false;
        throw new ApiError(0, offline ? 'offline' : 'network', offline ? 'You’re offline. We’ll save when you’re back online.' : 'We couldn’t reach the server. Please try again.');
      }
    );
  }

  WT.api = {
    request: request,
    health: function () {
      return request('GET', '/api/health');
    },
    /** This browser's record; { rid, name: '', answers: {} } when nothing is saved yet. */
    me: function () {
      var r = loadReviewer();
      if (!r.secret) return Promise.resolve({ rid: '', name: '', answers: {} });
      return request('GET', '/api/me', { secret: r.secret });
    },
    /** PUT /api/me with { name?, answers? }. secret defaults to this browser's. */
    saveMe: function (body, secret) {
      return request('PUT', '/api/me', { secret: secret || ensureSecret(), body: body || {} });
    },
    deleteMe: function () {
      var r = loadReviewer();
      if (!r.secret) return Promise.resolve({ ok: true, deleted: false });
      return request('DELETE', '/api/me', { secret: r.secret });
    },
    /** Everyone's results. { admin: true } includes hidden text when an admin code is stored. */
    results: function (opts) {
      var code = WT.api.admin.code();
      if (opts && opts.admin && code) return request('GET', '/api/results?admin=1', { admin: code });
      return request('GET', '/api/results');
    },
    exportUrl: function (fmt) {
      return fmt === 'json' ? '/api/export.json' : '/api/export.csv';
    },
    admin: {
      /** The stored (verified) admin code, or ''. */
      code: function () {
        var c = WT.session.getRaw(ADMIN_KEY);
        return typeof c === 'string' ? c : '';
      },
      signedIn: function () {
        return !!WT.api.admin.code();
      },
      signOut: function () {
        var was = WT.api.admin.signedIn();
        WT.session.remove(ADMIN_KEY);
        if (was) WT.emit('admin', false);
      },
      /** Verify a code: resolves true (and stores it) or false. Rejects with ApiError 503 when admin isn't configured. */
      check: function (code) {
        code = String(code || '').trim();
        if (!code) return Promise.resolve(false);
        return request('GET', '/api/admin/check', { admin: code }).then(
          function () {
            WT.session.set(ADMIN_KEY, code);
            WT.emit('admin', true);
            return true;
          },
          function (e) {
            if (e && e.status === 401) return false;
            throw e;
          }
        );
      },
      hide: function (o) {
        return request('POST', '/api/admin/hide', { admin: WT.api.admin.code(), body: { rid: o.rid, featureId: o.featureId, field: o.field, hidden: !!o.hidden } });
      },
      deleteReviewer: function (rid) {
        return request('POST', '/api/admin/delete', { admin: WT.api.admin.code(), body: { rid: rid } });
      },
      reset: function () {
        return request('POST', '/api/admin/reset', { admin: WT.api.admin.code(), body: { confirm: 'RESET' } });
      }
    }
  };

  /* ================================================================== */
  /* Answers and the save queue                                          */
  /* ================================================================== */

  var PENDING_KEY = 'infoslips.wt.pending';
  var VOTES = ['include', 'exclude'];
  var PRIORITIES = ['high', 'medium', 'low'];
  var pending = null; // { secret, answers: { id: answer|null }, name?: string }
  var saveTimer = null;
  var retryTimer = null;
  var retryDelay = 0;
  var inFlight = null;
  var again = false;
  var saveState = { saving: false, ok: true, pending: 0, error: null, savedAt: null };

  function loadPending() {
    if (pending) return pending;
    var p = WT.storage.get(PENDING_KEY, null);
    pending = p && typeof p === 'object' && p.answers && typeof p.answers === 'object' ? p : null;
    return pending;
  }
  function persistPending() {
    if (pending && !pendingCount()) pending = null;
    if (pending) WT.storage.set(PENDING_KEY, pending);
    else WT.storage.remove(PENDING_KEY);
  }
  function clearPending() {
    pending = null;
    clearTimeout(saveTimer);
    clearTimeout(retryTimer);
    WT.storage.remove(PENDING_KEY);
  }
  function pendingCount() {
    var p = loadPending();
    if (!p) return 0;
    return Object.keys(p.answers).length + (typeof p.name === 'string' ? 1 : 0);
  }
  function ensurePending() {
    var secret = ensureSecret();
    loadPending();
    if (!pending || pending.secret !== secret) {
      if (pending && pending.secret !== secret) pending = null; // queued for an old identity
      pending = { secret: secret, answers: {} };
    }
    return pending;
  }
  function queueAnswer(id, value) {
    ensurePending().answers[id] = value;
    persistPending();
    scheduleSave(600);
  }
  function queueName(name) {
    ensurePending().name = name;
    persistPending();
    scheduleSave(600);
  }
  function scheduleSave(ms) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      WT.answers.flush();
    }, ms);
  }
  function scheduleRetry() {
    clearTimeout(retryTimer);
    retryDelay = Math.min(retryDelay ? retryDelay * 2 : 5000, 60000);
    retryTimer = setTimeout(function () {
      WT.answers.flush();
    }, retryDelay);
  }
  function emitSaved(ok, extra) {
    saveState.saving = false;
    saveState.ok = ok;
    saveState.pending = pendingCount();
    var payload = { ok: ok, pending: saveState.pending };
    if (extra) for (var k in extra) payload[k] = extra[k];
    WT.emit('saved', payload);
  }

  /** Split a body so no request exceeds ~60 KB (the API refuses over 64 KB). */
  function chunkBodies(snap) {
    var bodies = [];
    var body = {};
    if (typeof snap.name === 'string') body.name = snap.name;
    var size = JSON.stringify(body).length;
    Object.keys(snap.answers).forEach(function (id) {
      var piece = JSON.stringify(snap.answers[id]).length + id.length + 8;
      var bytes = piece * 3; // worst case UTF-8
      if (body.answers && size + bytes > 60000) {
        bodies.push(body);
        body = {};
        size = 2;
      }
      body.answers = body.answers || {};
      body.answers[id] = snap.answers[id];
      size += bytes;
    });
    bodies.push(body);
    return bodies;
  }

  function normalise(a) {
    a = a || {};
    return {
      vote: VOTES.indexOf(a.vote) !== -1 ? a.vote : null,
      priority: PRIORITIES.indexOf(a.priority) !== -1 ? a.priority : null,
      reason: typeof a.reason === 'string' ? a.reason.slice(0, WT.LIMITS.reason) : '',
      comment: typeof a.comment === 'string' ? a.comment.slice(0, WT.LIMITS.comment) : '',
      updatedAt: typeof a.updatedAt === 'string' ? a.updatedAt : new Date().toISOString()
    };
  }
  function isEmpty(a) {
    return !a || (!a.vote && !a.priority && !String(a.reason || '').trim() && !String(a.comment || '').trim());
  }
  function newer(a, b) {
    return Date.parse(a.updatedAt || 0) > Date.parse(b.updatedAt || 0);
  }

  /** Adopt server answers that are newer than ours (and not waiting to be sent). */
  function reconcile(server, authoritative) {
    if (!server || !server.answers) return false;
    loadReviewer();
    var p = loadPending();
    var queued = (p && p.secret === rec.secret && p.answers) || {};
    var changed = false;
    if (authoritative) {
      Object.keys(rec.answers).forEach(function (id) {
        if (!(id in server.answers) && !(id in queued)) {
          delete rec.answers[id];
          changed = true;
        }
      });
    }
    Object.keys(server.answers).forEach(function (id) {
      if (!WT.feature(id) || id in queued) return;
      var s = normalise(server.answers[id]);
      var mine = rec.answers[id];
      if (!mine || newer(s, mine) || (authoritative && JSON.stringify(s) !== JSON.stringify(normalise(mine)))) {
        rec.answers[id] = s;
        changed = true;
      }
    });
    if (server.rid && server.rid !== rec.rid) rec.rid = server.rid;
    if (authoritative && typeof server.name === 'string' && server.createdAt && !(p && typeof p.name === 'string') && server.name !== rec.name) {
      rec.name = server.name;
      WT.emit('reviewer', WT.reviewer.get());
    }
    saveReviewer();
    if (changed) WT.emit('answers', null);
    return changed;
  }

  WT.answers = {
    /** The saved answer for a feature: { vote, reason, priority, comment, updatedAt } or null. */
    get: function (id) {
      var a = loadReviewer().answers[id];
      return a ? JSON.parse(JSON.stringify(a)) : null;
    },
    /** All answers keyed by feature id (a copy). */
    all: function () {
      return JSON.parse(JSON.stringify(loadReviewer().answers));
    },
    /**
     * Merge a patch ({ vote?, reason?, priority?, comment? }) into a feature's
     * answer, save it locally now and to the server after 600 ms. An answer with
     * nothing in it is cleared. Emits 'answers' (id). Returns the answer or null.
     */
    set: function (id, patch) {
      if (!WT.feature(id)) throw new Error('WT.answers.set: unknown feature ' + id);
      loadReviewer();
      var cur = rec.answers[id] || {};
      var merged = {};
      ['vote', 'priority', 'reason', 'comment'].forEach(function (k) {
        merged[k] = patch && Object.prototype.hasOwnProperty.call(patch, k) ? patch[k] : cur[k];
      });
      merged.updatedAt = new Date().toISOString();
      var next = normalise(merged);
      if (isEmpty(next)) return WT.answers.clear(id);
      rec.answers[id] = next;
      saveReviewer();
      queueAnswer(id, next);
      WT.emit('answers', id);
      return JSON.parse(JSON.stringify(next));
    },
    /** Remove a feature's answer here and on the server. */
    clear: function (id) {
      loadReviewer();
      var had = !!rec.answers[id];
      delete rec.answers[id];
      saveReviewer();
      if (had || (loadPending() && id in pending.answers)) queueAnswer(id, null);
      WT.emit('answers', id);
      return null;
    },
    /** { total, answered, voted, include, exclude, prioritised, commented, firstUnanswered } */
    stats: function () {
      var a = loadReviewer().answers;
      var s = { total: WT.features.length, answered: 0, voted: 0, include: 0, exclude: 0, prioritised: 0, commented: 0, firstUnanswered: '' };
      WT.features.forEach(function (f) {
        var x = a[f.id];
        if (!x || isEmpty(x)) {
          if (!s.firstUnanswered) s.firstUnanswered = f.id;
          return;
        }
        s.answered++;
        if (x.vote) s.voted++;
        if (x.vote === 'include') s.include++;
        if (x.vote === 'exclude') s.exclude++;
        if (x.priority) s.prioritised++;
        if (x.comment && x.comment.trim()) s.commented++;
      });
      return s;
    },
    /** Number of changes waiting to reach the server. */
    pending: pendingCount,
    /** { saving, ok, pending, error, savedAt } for autosave status UIs. */
    status: function () {
      saveState.pending = pendingCount();
      return { saving: saveState.saving, ok: saveState.ok, pending: saveState.pending, error: saveState.error, savedAt: saveState.savedAt };
    },
    /** Send queued changes now. Resolves true when everything is saved. Emits 'saving' then 'saved'. */
    flush: function () {
      clearTimeout(saveTimer);
      if (inFlight) {
        again = true;
        return inFlight;
      }
      if (!pendingCount()) {
        return Promise.resolve(true);
      }
      var snap = JSON.parse(JSON.stringify(loadPending()));
      saveState.saving = true;
      WT.emit('saving', { pending: pendingCount() });
      var bodies = chunkBodies(snap);
      var last = null;
      var chain = bodies.reduce(function (p, body) {
        return p.then(function () {
          return WT.api.saveMe(body, snap.secret).then(function (r) {
            last = r;
          });
        });
      }, Promise.resolve());
      inFlight = chain.then(
        function () {
          var p = loadPending();
          if (p && p.secret === snap.secret) {
            Object.keys(snap.answers).forEach(function (id) {
              if (id in p.answers && JSON.stringify(p.answers[id]) === JSON.stringify(snap.answers[id])) delete p.answers[id];
            });
            if (typeof snap.name === 'string' && p.name === snap.name) delete p.name;
          }
          persistPending();
          if (loadReviewer().secret === snap.secret) reconcile(last, false);
          retryDelay = 0;
          clearTimeout(retryTimer);
          saveState.error = null;
          saveState.savedAt = new Date().toISOString();
          emitSaved(true, { savedAt: saveState.savedAt });
          return true;
        },
        function (e) {
          saveState.error = (e && e.message) || 'Not saved';
          emitSaved(false, { error: saveState.error, status: e && e.status });
          var status = e && e.status;
          if (!status || status >= 500 || status === 408 || status === 429) scheduleRetry();
          return false;
        }
      );
      var settle = function (ok) {
        inFlight = null;
        if (again) {
          again = false;
          if (pendingCount()) scheduleSave(0);
        }
        return ok;
      };
      inFlight = inFlight.then(settle);
      return inFlight;
    },
    /** Retry now (for a Retry button). */
    retry: function () {
      return WT.answers.flush();
    },
    /** Load-time sync (called by WT.boot): server answers win unless a change is queued. */
    sync: function () {
      return WT.api.me().then(
        function (server) {
          if (server && server.rid) reconcile(server, true);
          return true;
        },
        function () {
          return false;
        }
      );
    },
    init: function () {
      if (WT.answers._inited) return;
      WT.answers._inited = true;
      win.addEventListener('online', function () {
        WT.answers.flush();
      });
      win.addEventListener('offline', function () {
        emitSaved(false, { offline: true, error: 'You’re offline' });
      });
      win.addEventListener('storage', function (e) {
        if (e.key === REVIEWER_KEY) {
          rec = null;
          loadReviewer();
          WT.emit('reviewer', WT.reviewer.get());
          WT.emit('answers', null);
        }
        if (e.key === PENDING_KEY) pending = null;
      });
      // Best effort on the way out: send what is queued.
      doc.addEventListener('visibilitychange', function () {
        if (doc.visibilityState === 'hidden' && pendingCount()) WT.answers.flush();
      });
      if (pendingCount()) WT.answers.flush().then(WT.answers.sync);
      else if (loadReviewer().secret) WT.answers.sync();
    }
  };

  /* ================================================================== */
  /* Announcements, toasts                                               */
  /* ================================================================== */

  function topModal() {
    var open;
    try {
      open = doc.querySelectorAll('dialog[open]:modal');
    } catch (e) {
      open = doc.querySelectorAll('dialog[open]');
    }
    return open.length ? open[open.length - 1] : null;
  }

  var announceTimer = null;
  /** Screen-reader message (polite, or assertive). Goes inside the open modal dialog when there is one. */
  WT.announce = function (msg, assertive) {
    var region;
    var modal = topModal();
    if (modal) {
      var cls = assertive ? 'wt-dialog-live--assertive' : 'wt-dialog-live--polite';
      region = modal.querySelector(':scope > .' + cls);
      if (!region) {
        region = doc.createElement('div');
        region.className = 'wt-sr-only ' + cls;
        region.setAttribute('aria-live', assertive ? 'assertive' : 'polite');
        region.setAttribute('aria-atomic', 'true');
        modal.appendChild(region);
      }
    } else {
      region = doc.getElementById(assertive ? 'wt-alert' : 'wt-live');
    }
    if (!region) return;
    clearTimeout(announceTimer);
    region.textContent = '';
    announceTimer = setTimeout(function () {
      region.textContent = String(msg || '');
    }, 60);
  };

  var toastHost = null;
  /**
   * A short visual confirmation, also announced. opts: { kind: 'info' | 'success' | 'error', timeout }.
   * Toasts hold no controls (they vanish); put actions in the page. A manual
   * popover keeps them above open dialogs.
   */
  WT.toast = function (msg, opts) {
    opts = opts || {};
    if (!toastHost) {
      toastHost = doc.createElement('div');
      toastHost.className = 'wt-toasts';
      toastHost.setAttribute('aria-hidden', 'true');
      if ('popover' in toastHost) toastHost.setAttribute('popover', 'manual');
      doc.body.appendChild(toastHost);
    }
    var t = doc.createElement('div');
    t.className = 'wt-toast wt-toast--' + (opts.kind || 'info');
    t.innerHTML = WT.icon(opts.kind === 'error' ? 'alert' : opts.kind === 'success' ? 'check' : 'info') + '<span class="wt-toast__msg"></span>';
    t.querySelector('.wt-toast__msg').textContent = String(msg);
    toastHost.appendChild(t);
    if (toastHost.showPopover) {
      try {
        if (toastHost.matches(':popover-open')) toastHost.hidePopover();
        toastHost.showPopover();
      } catch (e) {
        /* ignore */
      }
    }
    WT.announce(msg, opts.kind === 'error');
    setTimeout(function () {
      t.classList.add('is-leaving');
      setTimeout(function () {
        t.remove();
        if (toastHost && !toastHost.children.length && toastHost.hidePopover) {
          try {
            toastHost.hidePopover();
          } catch (e) {
            /* ignore */
          }
        }
      }, WT.reducedMotion() ? 0 : 200);
    }, opts.timeout || 4000);
    return t;
  };

  /** Copy text to the clipboard. Resolves true/false. */
  WT.copy = function (text) {
    var fallback = function () {
      var ta = doc.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.className = 'wt-sr-only';
      doc.body.appendChild(ta);
      ta.select();
      var ok = false;
      try {
        ok = doc.execCommand('copy');
      } catch (e) {
        ok = false;
      }
      ta.remove();
      return ok;
    };
    if (win.navigator && navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(String(text)).then(
        function () {
          return true;
        },
        function () {
          return fallback();
        }
      );
    }
    return Promise.resolve(fallback());
  };

  /** Save a string or bytes as a file in the visitor's browser. */
  WT.download = function (filename, content, mime) {
    var blob = content instanceof Blob ? content : new Blob([content], { type: mime || 'application/octet-stream' });
    var url = URL.createObjectURL(blob);
    var a = doc.createElement('a');
    a.href = url;
    a.download = filename;
    a.hidden = true;
    doc.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(url);
      a.remove();
    }, 1000);
  };

  /* ================================================================== */
  /* Icons (inline SVG, 24×24 grid, stroke = currentColor)               */
  /* ================================================================== */

  var ICONS = {
    'arrow-left': '<path d="M19 12H5M11 6l-6 6 6 6"/>',
    'arrow-right': '<path d="M5 12h14M13 6l6 6-6 6"/>',
    'arrow-up': '<path d="M12 19V5M6 11l6-6 6 6"/>',
    'arrow-down': '<path d="M12 5v14M6 13l6 6 6-6"/>',
    restart: '<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1"/><path d="M3.5 4v5h5"/>',
    refresh: '<path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1"/><path d="M20.5 4v5h-5"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    'check-circle': '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.8 2.8L16.5 9.5"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    'x-circle': '<circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/>',
    minus: '<path d="M5 12h14"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    list: '<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 20c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c1-3.5 3.5-5.5 6.5-5.5s5.5 2 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.6c2 .7 3.2 2.6 3.7 5.4"/>',
    chart: '<path d="M4 4v16h16"/><path d="M8 16v-5M12 16V8M16 16v-3"/>',
    braces: '<path d="M8 4H7a2 2 0 0 0-2 2v3.5A2.5 2.5 0 0 1 2.5 12 2.5 2.5 0 0 1 5 14.5V18a2 2 0 0 0 2 2h1M16 4h1a2 2 0 0 1 2 2v3.5a2.5 2.5 0 0 0 2.5 2.5 2.5 2.5 0 0 0-2.5 2.5V18a2 2 0 0 1-2 2h-1"/>',
    download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
    upload: '<path d="M12 20V9M7 14l5-5 5 5M5 4h14"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
    'chevron-down': '<path d="M6 9l6 6 6-6"/>',
    'chevron-up': '<path d="M6 15l6-6 6 6"/>',
    'chevron-right': '<path d="M9 6l6 6-6 6"/>',
    'chevron-left': '<path d="M15 6l-6 6 6 6"/>',
    external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.6v.01"/>',
    alert: '<path d="M10.3 4.2L2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z"/><path d="M12 9.5v4M12 17v.01"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.3a2.6 2.6 0 0 1 5 .9c0 1.7-2.5 2.3-2.5 3.8M12 17v.01"/>',
    eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    'eye-off': '<path d="M3 3l18 18"/><path d="M10.6 5.1c.5-.1.9-.1 1.4-.1 6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6C3.8 8.4 2 12 2 12s3.6 7 10 7c2 0 3.8-.6 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    unlock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 7.7-1.5"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
    comment: '<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v9a1.5 1.5 0 0 1-1.5 1.5H9l-5 4z"/>',
    flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
    play: '<path d="M8 5v14l11-7z"/>',
    image: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.5"/><path d="M21 16l-5-5-8 8"/>',
    filter: '<path d="M4 5h16l-6 7.5V19l-4 1.5v-8z"/>',
    home: '<path d="M4 11l8-7 8 7M6 9.5V20h12V9.5"/>',
    logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 8l-4 4 4 4M6 12h10"/>',
    target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>',
    expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    collapse: '<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>',
    keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
    sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>',
    layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
    dot: '<circle cx="12" cy="12" r="3"/>'
  };
  WT.ICONS = Object.keys(ICONS);
  var warned = {};
  /**
   * Inline SVG icon, aria-hidden by default. opts: { size = 20, cls, label }.
   * With a label it becomes role="img" with that accessible name.
   */
  WT.icon = function (name, opts) {
    opts = opts || {};
    var body = ICONS[name];
    if (!body) {
      if (!warned[name] && win.console) console.warn('[WT] unknown icon ' + name);
      warned[name] = true;
      return '';
    }
    var size = opts.size || 20;
    var a11y = opts.label ? ' role="img" aria-label="' + WT.esc(opts.label) + '"' : ' aria-hidden="true"';
    return (
      '<svg class="wt-icon' + (opts.cls ? ' ' + WT.esc(opts.cls) : '') + '" width="' + size + '" height="' + size +
      '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"' +
      a11y + ' focusable="false">' + body + '</svg>'
    );
  };

  /* ================================================================== */
  /* Formatting (en-GB)                                                  */
  /* ================================================================== */

  var dtf = null;
  var dayf = null;
  var rtf = null;
  function toDate(iso) {
    var d = iso instanceof Date ? iso : new Date(iso);
    return isNaN(d.getTime()) ? null : d;
  }
  WT.fmt = {
    /** "4 Oct 2026, 18:40" */
    date: function (iso) {
      var d = toDate(iso);
      if (!d) return '';
      dtf = dtf || new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
      return dtf.format(d);
    },
    /** "4 Oct 2026" */
    day: function (iso) {
      var d = toDate(iso);
      if (!d) return '';
      dayf = dayf || new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
      return dayf.format(d);
    },
    /** "just now", "5 minutes ago", "yesterday", then the date. */
    relative: function (iso) {
      var d = toDate(iso);
      if (!d) return '';
      var s = (Date.now() - d.getTime()) / 1000;
      if (s < 45) return 'just now';
      rtf = rtf || new Intl.RelativeTimeFormat('en-GB', { numeric: 'auto' });
      if (s < 2700) return rtf.format(-Math.max(1, Math.round(s / 60)), 'minute');
      if (s < 79200) return rtf.format(-Math.round(s / 3600), 'hour');
      if (s < 6 * 86400) return rtf.format(-Math.round(s / 86400), 'day');
      return WT.fmt.day(d);
    },
    /** pct(0.667) → "67%"; pct(2, 3) → "67%"; "–" when there is nothing to divide. */
    pct: function (n, total) {
      var v = total === undefined ? n : total ? n / total : NaN;
      if (v === null || v === undefined || !isFinite(v)) return '–';
      return Math.round(v * 100) + '%';
    },
    /** 1234 → "1,234" */
    num: function (n) {
      return Number(n || 0).toLocaleString('en-GB');
    },
    /** plural(3, 'reviewer') → "3 reviewers"; plural(1, 'reply', 'replies') → "1 reply" */
    plural: function (n, one, many) {
      return WT.fmt.num(n) + ' ' + (n === 1 ? one : many || one + 's');
    }
  };

  /* ================================================================== */
  /* Dialogs                                                             */
  /* ================================================================== */

  function focusables(root) {
    return WT.$$('a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])', root).filter(function (el) {
      return el.offsetParent !== null || el.getClientRects().length;
    });
  }

  WT.dialog = {
    /**
     * Open a native <dialog> as a modal. opts: { trigger, initialFocus (el or selector),
     * lightDismiss (close on backdrop click), onClose(returnValue) }. Focus returns
     * to the trigger (or the element focused before) when it closes.
     */
    open: function (el, opts) {
      if (!el) return;
      opts = opts || {};
      el._wtReturn = opts.trigger || doc.activeElement;
      el._wtOnClose = opts.onClose || null;
      el._wtLight = !!opts.lightDismiss;
      if (!el._wtBound) {
        el._wtBound = true;
        el.addEventListener('close', function () {
          if (!topModal()) doc.documentElement.classList.remove('wt-modal-open');
          var ret = el._wtReturn;
          el._wtReturn = null;
          if (ret && ret.isConnected && typeof ret.focus === 'function') {
            ret.focus({ preventScroll: true });
          } else if (!topModal()) {
            WT.focusView();
          }
          var cb = el._wtOnClose;
          el._wtOnClose = null;
          if (cb) {
            try {
              cb(el.returnValue);
            } catch (e) {
              if (win.console) console.error(e);
            }
          }
        });
        el.addEventListener('click', function (e) {
          if (e.target === el && el._wtLight) {
            var r = el.getBoundingClientRect();
            var inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
            if (!inside) el.close('cancel');
          }
          var closer = e.target.closest && e.target.closest('[data-wt-close]');
          if (closer && el.contains(closer)) el.close(closer.getAttribute('data-wt-close') || 'cancel');
        });
      }
      el.returnValue = '';
      if (!el.open) {
        if (typeof el.showModal === 'function') el.showModal();
        else el.setAttribute('open', '');
      }
      doc.documentElement.classList.add('wt-modal-open');
      var target = typeof opts.initialFocus === 'string' ? el.querySelector(opts.initialFocus) : opts.initialFocus;
      if (!target) target = el.querySelector('[autofocus]');
      if (!target) {
        var f = focusables(el.querySelector('.wt-dialog__body') || el);
        target = f[0] || el.querySelector('.wt-dialog__close') || el;
      }
      if (target === el && !el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
      if (target && target.focus) target.focus();
      return el;
    },
    close: function (el, value) {
      if (el && el.open) el.close(value || '');
    },
    /** Change where focus returns when the dialog closes (null: the view heading). */
    setReturn: function (el, target) {
      if (el) el._wtReturn = target || null;
    },
    /**
     * Build a standard dialog and append it to <body> (once per id).
     * { id, title, body, foot, wide, size: 'sm'|'md'|'lg', closeLabel }. body and foot are HTML.
     * Returns the <dialog>; its parts are .wt-dialog__title/__body/__foot.
     */
    create: function (o) {
      o = o || {};
      var id = o.id || WT.uid('dlg');
      var el = doc.getElementById(id);
      if (!el) {
        el = doc.createElement('dialog');
        el.id = id;
        doc.body.appendChild(el);
      }
      el.className = 'wt-dialog' + (o.wide || o.size === 'lg' ? ' wt-dialog--wide' : o.size === 'sm' ? ' wt-dialog--sm' : '');
      el.setAttribute('aria-labelledby', id + '-title');
      el.innerHTML =
        '<div class="wt-dialog__inner">' +
          '<div class="wt-dialog__head">' +
            '<h2 class="wt-dialog__title" id="' + WT.esc(id) + '-title">' + WT.esc(o.title || '') + '</h2>' +
            '<button class="wt-btn wt-btn--icon wt-btn--ghost wt-dialog__close" type="button" data-wt-close="cancel" aria-label="' + WT.esc(o.closeLabel || 'Close') + '">' + WT.icon('x') + '</button>' +
          '</div>' +
          '<div class="wt-dialog__body">' + (o.body || '') + '</div>' +
          (o.foot ? '<div class="wt-dialog__foot">' + o.foot + '</div>' : '') +
        '</div>';
      return el;
    },
    /**
     * Promise<boolean> confirmation. { title, body (text), html (trusted HTML), confirmLabel,
     * cancelLabel, danger, typeToConfirm: 'RESET', trigger }.
     */
    confirm: function (o) {
      o = o || {};
      var el = WT.dialog.create({
        id: 'wt-confirm',
        title: o.title || 'Are you sure?',
        size: 'sm',
        body:
          (o.html ? '<div class="wt-dialog__text">' + o.html + '</div>' : '<p class="wt-dialog__text">' + WT.esc(o.body || '') + '</p>') +
          (o.typeToConfirm
            ? '<div class="wt-field"><label class="wt-label" for="wt-confirm-type">Type ' + WT.esc(o.typeToConfirm) + ' to confirm</label>' +
              '<input class="wt-input" id="wt-confirm-type" autocomplete="off" autocapitalize="characters" spellcheck="false" /></div>'
            : ''),
        foot:
          '<button class="wt-btn wt-btn--secondary" type="button" data-wt-close="cancel">' + WT.esc(o.cancelLabel || 'Cancel') + '</button>' +
          '<button class="wt-btn ' + (o.danger ? 'wt-btn--danger' : 'wt-btn--primary') + '" type="button" data-wt-confirm>' + WT.esc(o.confirmLabel || 'Confirm') + '</button>'
      });
      var ok = el.querySelector('[data-wt-confirm]');
      var typed = el.querySelector('#wt-confirm-type');
      var sync = function () {
        if (typed) ok.disabled = typed.value.trim() !== o.typeToConfirm;
      };
      sync();
      if (typed) {
        typed.addEventListener('input', sync);
        typed.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' && !ok.disabled) {
            e.preventDefault();
            el.close('confirm');
          }
        });
      }
      ok.addEventListener('click', function () {
        if (!ok.disabled) el.close('confirm');
      });
      return new Promise(function (resolve) {
        WT.dialog.open(el, {
          trigger: o.trigger,
          initialFocus: typed || el.querySelector('[data-wt-close="cancel"].wt-btn--secondary'),
          onClose: function (v) {
            resolve(v === 'confirm');
          }
        });
      });
    }
  };

  /* ================================================================== */
  /* UI builders (HTML strings using the 02-components.css classes)      */
  /* ================================================================== */

  function attrs(map) {
    var s = '';
    Object.keys(map || {}).forEach(function (k) {
      var v = map[k];
      if (v === false || v === null || v === undefined) return;
      s += ' ' + k + (v === true ? '' : '="' + WT.esc(v) + '"');
    });
    return s;
  }
  WT.attrs = attrs;

  var VOTE_LABEL = { include: 'Include', exclude: 'Exclude' };
  var PRIORITY_LABEL = { high: 'High', medium: 'Medium', low: 'Low' };
  WT.VOTE_LABEL = VOTE_LABEL;
  WT.PRIORITY_LABEL = PRIORITY_LABEL;

  WT.ui = {
    /**
     * Segmented radio group (real radios). { name, legend, options: [{ value, label, icon?, hint? }],
     * value, variant: 'vote' | 'priority' | '', hint, fk (focus-key prefix), size: 'lg', legendHidden }
     */
    segmented: function (o) {
      var hintId = o.hint ? (o.id || o.name) + '-hint' : '';
      var opts = (o.options || [])
        .map(function (op) {
          var fk = (o.fk || o.name) + '-' + op.value;
          return (
            '<label class="wt-segmented__option' + (op.value ? ' wt-segmented__option--' + WT.esc(op.value) : '') + '">' +
              '<input class="wt-segmented__input" type="radio"' +
              attrs({ name: o.name, value: op.value, checked: o.value === op.value, 'data-fk': fk, 'aria-describedby': hintId || null, disabled: !!o.disabled }) + ' />' +
              '<span class="wt-segmented__label">' + (op.icon ? WT.icon(op.icon, { size: 18 }) : '') + '<span>' + WT.esc(op.label) + '</span></span>' +
            '</label>'
          );
        })
        .join('');
      return (
        '<fieldset class="wt-fieldset wt-segmented' + (o.variant ? ' wt-segmented--' + WT.esc(o.variant) : '') + (o.size === 'lg' ? ' wt-segmented--lg' : '') + '"' + attrs({ id: o.id }) + '>' +
          '<legend class="wt-legend' + (o.legendHidden ? ' wt-sr-only' : '') + '">' + WT.esc(o.legend) + '</legend>' +
          (o.hint ? '<p class="wt-hint" id="' + WT.esc(hintId) + '">' + WT.esc(o.hint) + '</p>' : '') +
          '<div class="wt-segmented__options">' + opts + '</div>' +
        '</fieldset>'
      );
    },
    /** Include / Exclude group (name defaults to 'vote'). */
    voteGroup: function (o) {
      o = o || {};
      return WT.ui.segmented({
        name: o.name || 'vote',
        id: o.id,
        legend: o.legend || 'Include in the production statement?',
        hint: o.hint,
        value: o.value,
        variant: 'vote',
        size: 'lg',
        fk: o.fk,
        options: [
          { value: 'include', label: 'Include', icon: 'check' },
          { value: 'exclude', label: 'Exclude', icon: 'x' }
        ]
      });
    },
    /** High / Medium / Low group (name defaults to 'priority'). */
    priorityGroup: function (o) {
      o = o || {};
      return WT.ui.segmented({
        name: o.name || 'priority',
        id: o.id,
        legend: o.legend || 'Priority if included',
        hint: o.hint === undefined ? 'How important is this for the first release?' : o.hint,
        value: o.value,
        variant: 'priority',
        fk: o.fk,
        options: [
          { value: 'high', label: 'High' },
          { value: 'medium', label: 'Medium' },
          { value: 'low', label: 'Low' }
        ]
      });
    },
    /**
     * Labelled input or textarea with optional hint and live character counter.
     * { id, label, value, max, hint, multiline, rows, placeholder, optional, fk, name, autocomplete, type }
     */
    field: function (o) {
      var id = o.id || WT.uid('fld');
      var describe = [];
      if (o.hint) describe.push(id + '-hint');
      if (o.max) describe.push(id + '-count');
      var common = attrs({
        id: id,
        name: o.name || null,
        maxlength: o.max || null,
        placeholder: o.placeholder || null,
        autocomplete: o.autocomplete || (o.multiline ? null : 'off'),
        'aria-describedby': describe.length ? describe.join(' ') : null,
        'data-fk': o.fk || id,
        'data-counter': o.max ? id + '-count' : null,
        spellcheck: o.multiline ? 'true' : null
      });
      var val = o.value || '';
      var control = o.multiline
        ? '<textarea class="wt-textarea"' + common + attrs({ rows: o.rows || 4 }) + '>' + WT.esc(val) + '</textarea>'
        : '<input class="wt-input"' + common + attrs({ type: o.type || 'text', value: val }) + ' />';
      return (
        '<div class="wt-field' + (o.cls ? ' ' + WT.esc(o.cls) : '') + '">' +
          '<label class="wt-label" for="' + WT.esc(id) + '">' + WT.esc(o.label) + (o.optional ? ' <span class="wt-optional">(optional)</span>' : '') + '</label>' +
          (o.hint ? '<p class="wt-hint" id="' + WT.esc(id) + '-hint">' + WT.esc(o.hint) + '</p>' : '') +
          control +
          (o.max ? WT.ui.counter(id, val.length, o.max) : '') +
        '</div>'
      );
    },
    /** The counter element for a field (updated automatically on input). */
    counter: function (id, n, max) {
      return '<p class="wt-counter" id="' + WT.esc(id) + '-count" data-max="' + max + '"' + counterState(n, max) + '>' + counterText(n, max) + '</p>';
    },
    /** Toggle switch: { id, label, checked, hint, fk }. A real checkbox with role="switch". */
    switch: function (o) {
      var id = o.id || WT.uid('sw');
      return (
        '<label class="wt-switch" for="' + WT.esc(id) + '">' +
          '<input class="wt-switch__input" type="checkbox" role="switch"' + attrs({ id: id, checked: !!o.checked, 'data-fk': o.fk || id, 'aria-describedby': o.hint ? id + '-hint' : null }) + ' />' +
          '<span class="wt-switch__track" aria-hidden="true"></span>' +
          '<span class="wt-switch__label">' + WT.esc(o.label) + '</span>' +
        '</label>' +
        (o.hint ? '<p class="wt-hint" id="' + WT.esc(id) + '-hint">' + WT.esc(o.hint) + '</p>' : '')
      );
    },
    /** Badge: kind include|exclude|none|high|medium|low|hidden|neutral|brand. */
    badge: function (kind, text, icon) {
      return '<span class="wt-badge wt-badge--' + WT.esc(kind) + '">' + (icon ? WT.icon(icon, { size: 14 }) : '') + WT.esc(text) + '</span>';
    },
    /** ✓ Include / ✗ Exclude / – Not answered */
    voteBadge: function (vote) {
      if (vote === 'include') return WT.ui.badge('include', 'Include', 'check');
      if (vote === 'exclude') return WT.ui.badge('exclude', 'Exclude', 'x');
      return WT.ui.badge('none', 'No vote', 'minus');
    },
    /** High / Medium / Low priority badge ('' when null). */
    priorityBadge: function (p) {
      if (!PRIORITY_LABEL[p]) return '';
      return WT.ui.badge(p, PRIORITY_LABEL[p] + ' priority');
    },
    /** Notice box. { kind: 'info'|'brand'|'error'|'success', title, html (trusted), text, compact } */
    notice: function (o) {
      var kind = o.kind || 'info';
      var icon = kind === 'error' ? 'alert' : kind === 'success' ? 'check-circle' : 'info';
      var body = (o.title ? '<strong class="wt-notice__title">' + WT.esc(o.title) + '</strong> ' : '') + (o.html !== undefined ? o.html : WT.esc(o.text || ''));
      return (
        '<div class="wt-notice wt-notice--' + WT.esc(kind) + (o.compact ? ' wt-notice--compact' : '') + '"' + (o.role ? ' role="' + WT.esc(o.role) + '"' : kind === 'error' ? ' role="alert"' : '') + '>' +
          WT.icon(icon, { cls: 'wt-notice__icon', size: o.compact ? 18 : 20 }) +
          '<div class="wt-notice__body">' + (o.compact ? '<p>' + body + '</p>' : '<p>' + body + '</p>') + '</div>' +
        '</div>'
      );
    },
    /** Loading placeholder. { lines = 3, title = true, block = false, label = 'Loading…' } */
    skeleton: function (o) {
      o = o || {};
      var n = o.lines === undefined ? 3 : o.lines;
      var s = '<div class="wt-skeleton-group" aria-busy="true"><span class="wt-sr-only">' + WT.esc(o.label || 'Loading…') + '</span>';
      if (o.title !== false) s += '<div class="wt-skeleton wt-skeleton--title"></div>';
      if (o.block) s += '<div class="wt-skeleton wt-skeleton--block"></div>';
      for (var i = 0; i < n; i++) s += '<div class="wt-skeleton wt-skeleton--text"></div>';
      return s + '</div>';
    },
    /** Labelled native <progress>. { value, max, label, id, hideLabel } */
    progress: function (o) {
      var id = o.id || WT.uid('prog');
      return (
        '<div class="wt-progress">' +
          '<span class="wt-progress__label' + (o.hideLabel ? ' wt-sr-only' : '') + '" id="' + WT.esc(id) + '-label">' + WT.esc(o.label || '') + '</span>' +
          '<progress class="wt-progress__bar" id="' + WT.esc(id) + '" max="' + Number(o.max || 100) + '" value="' + Number(o.value || 0) + '" aria-labelledby="' + WT.esc(id) + '-label"></progress>' +
        '</div>'
      );
    },
    /** Scrollable, focusable table container with a sticky header. html is the <table>. */
    tableWrap: function (html, label, cls) {
      return '<div class="wt-table-wrap' + (cls ? ' ' + WT.esc(cls) : '') + '" role="region" tabindex="0" aria-label="' + WT.esc(label || 'Table') + '">' + html + '</div>';
    },
    /**
     * Wire a WAI-ARIA tablist: arrow keys, Home/End, automatic activation.
     * root contains [role=tab] buttons with aria-controls. onChange(tabEl) is optional.
     */
    tabs: function (root, onChange) {
      if (!root || root._wtTabs) return;
      root._wtTabs = true;
      var tabs = function () {
        return WT.$$('[role="tab"]', root);
      };
      var select = function (tab, focus) {
        tabs().forEach(function (t) {
          var on = t === tab;
          t.setAttribute('aria-selected', on ? 'true' : 'false');
          t.tabIndex = on ? 0 : -1;
          var panel = doc.getElementById(t.getAttribute('aria-controls'));
          if (panel) panel.hidden = !on;
        });
        if (focus) tab.focus();
        if (onChange) onChange(tab);
      };
      root.addEventListener('click', function (e) {
        var t = e.target.closest('[role="tab"]');
        if (t && root.contains(t)) select(t, false);
      });
      root.addEventListener('keydown', function (e) {
        var list = tabs();
        var i = list.indexOf(doc.activeElement);
        if (i === -1) return;
        var vertical = root.getAttribute('aria-orientation') === 'vertical';
        var next = null;
        if (e.key === (vertical ? 'ArrowDown' : 'ArrowRight')) next = list[(i + 1) % list.length];
        else if (e.key === (vertical ? 'ArrowUp' : 'ArrowLeft')) next = list[(i - 1 + list.length) % list.length];
        else if (e.key === 'Home') next = list[0];
        else if (e.key === 'End') next = list[list.length - 1];
        if (next) {
          e.preventDefault();
          select(next, true);
        }
      });
    }
  };

  function counterText(n, max) {
    return WT.fmt.num(n) + ' / ' + WT.fmt.num(max);
  }
  function counterState(n, max) {
    return n >= max ? ' data-state="full"' : n >= max * 0.9 ? ' data-state="near"' : '';
  }

  // Character counters: any input/textarea with data-counter="<counter id>".
  var counterSpoken = {};
  doc.addEventListener('input', function (e) {
    var el = e.target;
    var cid = el && el.getAttribute && el.getAttribute('data-counter');
    if (!cid) return;
    var c = doc.getElementById(cid);
    if (!c) return;
    var max = Number(el.getAttribute('maxlength') || c.getAttribute('data-max') || 0);
    var n = el.value.length;
    c.textContent = counterText(n, max);
    if (n >= max) c.setAttribute('data-state', 'full');
    else if (n >= max * 0.9) c.setAttribute('data-state', 'near');
    else c.removeAttribute('data-state');
    // Speak only when crossing into the last 10%, and at the limit.
    var band = n >= max ? 'full' : n >= max * 0.9 ? 'near' : '';
    if (band && counterSpoken[cid] !== band) WT.announce(n >= max ? 'Character limit reached' : max - n + ' characters left');
    counterSpoken[cid] = band;
  });
})(window.WT = window.WT || {});
