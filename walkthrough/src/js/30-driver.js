/*
 * 30-driver.js — drives the YES statement for the tour and the screenshots
 * (SPEC section 6, docs/STATEMENT-MAP.md). Owner: steps.
 *
 * Depends only on window.WT (it reads WT.theme when the app is present, and
 * works without it). `win` is always the statement's window: the tour frame's
 * contentWindow, or window itself when this file is injected into the statement
 * page. Re-read win.YES on every call: a frame reload replaces it.
 *
 * Step activation, as the tour does it (SPEC section 5):
 *   await WT.driver.reset(win);                    // or reset(win, { top: false })
 *   await WT.driver.apply(win, WT.steps[id]);
 *   var el = await WT.driver.target(win, WT.steps[id]);   // null: "We couldn't highlight…"
 *   if (el) await WT.driver.scrollToTarget(win, el);
 *   // then draw the overlay and focus the step's h1 (the statement pulls focus into the frame, G4)
 *
 * API (every method is safe to call at any time, in any order)
 *
 *   WT.driver.reset(win, { top = true }) → Promise<{ ok, problems[] }>
 *     Returns the statement to a clean state: closes the phone Menu, the Ask YES
 *     drawer (and drops its conversation), the inquiry (and its draft), the
 *     transaction detail and any other open dialog; clears the journey
 *     selection, filters, sort, the filter panel, Understand topics and the
 *     Overview disclosures; pauses the video; leaves the integrity preview
 *     (which reloads the frame); restores the baseline language and theme;
 *     drops sub-routes from the frame's address (with replace, never a push or
 *     history.back()); and scrolls to the top (top: false keeps the scroll
 *     position, so a following scrollToTarget() glides from where the reader
 *     was instead of jumping to the top first). It never changes the view.
 *     `problems` lists anything still not clean (see check()). Never rejects.
 *
 *   WT.driver.apply(win, step) → Promise<{ ok, errors[], aborted? }>
 *     Runs step.setup (or an array of actions) in order. {menu} actions always
 *     run last (G11). Ends when the frame's scroll has settled. Never rejects:
 *     a failed action is reported in `errors` and the rest still run. A newer
 *     reset() aborts a running apply() at the next action (`aborted: true`), so
 *     fast Next/Back/jump clicks never interleave.
 *
 *   WT.driver.target(win, step, { timeout = 4000 }) → Promise<Element|null>
 *     The first visible match of step.target.phone (frame width < 720) or
 *     step.target.desktop. Polls until found; null on timeout or when a newer
 *     reset() starts.
 *
 *   WT.driver.scrollToTarget(win, el, { behavior, block = 'auto', margin = 12 })
 *       → Promise<DOMRect|null>
 *     Waits for the statement's own smooth scroll to finish (G5), then scrolls
 *     el into view: centred, or aligned to the top when it is taller than the
 *     space available (block 'auto'); 'center', 'start' and 'nearest' force a
 *     mode. Scroll containers inside the frame (dialogs, the drawer) are
 *     scrolled first; the window is scrolled only for targets in the page flow,
 *     below the statement's sticky masthead. It never uses scrollIntoView, so
 *     the PARENT page never scrolls. behavior defaults to 'smooth', or 'instant'
 *     with reduced motion. Resolves with the target's final rect (frame
 *     coordinates) once the scroll has settled.
 *
 *   WT.driver.settle(win, { el, minMs = 120, maxMs = 1200, frames = 3, animations })
 *       → Promise<void>
 *     Resolves when the frame's scroll position (and el's rect, if given) has
 *     not changed for `frames` frames, after at least minMs and at most maxMs.
 *     animations: true also waits (up to maxMs) for finite CSS animations and
 *     transitions in the frame to finish (used by the screenshots).
 *     settle(win, el) is short for settle(win, { el }).
 *
 *   WT.driver.isPhone(win) → boolean      frame width < 720 (the statement's phone layout)
 *   WT.driver.ready(win, ms = 10000) → Promise<boolean>   win.YES has booted
 *   WT.driver.baseline({ theme, lang }) → { theme, lang }
 *     Sets (keys present) and returns the state reset() restores.
 *     - theme: 'light' | 'dark' fixes it; null (default) follows the app theme
 *       (WT.theme.effective()), or, without the app, the frame's theme when the
 *       driver first saw it (later changes the visitor makes are followed).
 *     - lang: 'en' | 'es'. By default it is captured when the driver first sees
 *       the frame, and follows language changes the visitor makes in the
 *       statement, except during a step whose setup set the language. It is
 *       never captured from the frame while a step's language is in force:
 *       a { lang } action marks that in sessionStorage (infoslips.wt.stepLang,
 *       cleared when reset() restores the baseline), so a frame reloaded on the
 *       Language step (its yes.lang says 'es', G13) can't make Spanish the
 *       baseline. The tour also passes { lang: 'en' } before its first step.
 *     baseline(win, { … }) is accepted too; the baseline is shared.
 *   WT.driver.check(win, { top = true }) → { ok, problems[] }   the clean-state check reset() uses
 *   WT.driver.selectors(win, step) → string[]   the target list in use
 *   WT.driver.topInset(win) → number            height of the pinned masthead, px
 *   WT.driver.visible(win, el), WT.driver.firstVisible(win, selector)
 *
 * Actions (plain objects, shared with scripts/shots.mjs):
 *   { route: '#/overview' }   replace the frame's hash with an ABSOLUTE url built
 *                             from the frame's own href (G2), so history stays
 *                             flat (G6); waits for the view. A route with
 *                             ?simulate= waits for the frame to reload (G12).
 *   { call: 'overview.video.seek', args: [20] }   YES.<path>.apply(parent, args) (G18)
 *   { click: 'selector' }     first visible match; print buttons are refused (G15)
 *   { wait: 'selector' }      until visible (4s)
 *   { scroll: 'selector' }    align the match to the top, instantly
 *   { theme: 'dark' | 'light' | 'opposite' | 'toggle' }   'opposite' = not the baseline theme (G17)
 *   { lang: 'en' | 'es' | 'opposite' }
 *   { menu: true | false }    open/close the phone Menu; no-op on desktop; runs last
 *   { delay: ms }             at most 5000
 *
 * Gotchas handled here (STATEMENT-MAP section 4): waits use THIS window's timers
 * and animation frames, never the frame's (G3); the journey is cleared without
 * history.back() and the detail is closed with replace (G1); location.replace()
 * gets absolute URLs only (G2); print is never triggered (G15).
 *
 * The PARENT page never scrolls because of the driver. scrollToTarget() only
 * scrolls inside the frame, and reset()/apply() put back the scroll position
 * of the parent page and of every scroll container around the frame: the
 * statement's own scrollIntoView() calls (Understand topics, Help sections,
 * view headings) also scroll the frame's ancestors (verified). Steps use the
 * statement's deep links through { route }, so the driver adds no history
 * entries: browser Back/Forward only see the tour's own #/tour/<id> pushes.
 */
(function (WT) {
  'use strict';

  var host = window; // timers and frames always come from here (G3)
  var VIEWS = ['overview', 'transactions', 'understand', 'help'];
  var NO_CLICK = '[data-help-print], [data-tx-print]';
  var OV_DISCLOSURES = ['details', 'journeyTable', 'chartTable', 'transcript'];
  var ABORT = {};

  var base = { lang: null, theme: null };
  var states = new WeakMap();
  var STEP_LANG_KEY = 'infoslips.wt.stepLang'; // a step's { lang } is in force (read by 40-tour.js too)

  /* ------------------------------------------------------------------ */
  /* Small utilities (parent timers only)                                */
  /* ------------------------------------------------------------------ */
  function now() {
    return Date.now();
  }
  function sleep(ms) {
    return new Promise(function (r) {
      host.setTimeout(r, ms);
    });
  }
  /** One frame of the parent, or 50 ms if frames are throttled (background tab). */
  function frame1() {
    return new Promise(function (r) {
      var done = false;
      var fin = function () {
        if (!done) {
          done = true;
          r();
        }
      };
      if (host.requestAnimationFrame) host.requestAnimationFrame(fin);
      host.setTimeout(fin, 50);
    });
  }
  function frame2() {
    return frame1().then(frame1);
  }
  async function until(fn, ms) {
    var end = now() + (ms || 4000);
    for (;;) {
      var v;
      try {
        v = fn();
      } catch (e) {
        v = null;
      }
      if (v) return v;
      if (now() >= end) return null;
      await sleep(40);
    }
  }
  function Y(win) {
    try {
      return win.YES || null;
    } catch (e) {
      return null;
    }
  }
  function D(win) {
    try {
      return win.document;
    } catch (e) {
      return null;
    }
  }
  function reduced(win) {
    try {
      var q = '(prefers-reduced-motion: reduce)';
      return !!((host.matchMedia && host.matchMedia(q).matches) || (win.matchMedia && win.matchMedia(q).matches));
    } catch (e) {
      return false;
    }
  }
  function errText(e) {
    return String((e && e.message) || e);
  }
  /** sessionStorage is shared with the same-origin frame; it may throw (private mode, blocked storage). */
  function stepLangMark(on) {
    try {
      if (on) host.sessionStorage.setItem(STEP_LANG_KEY, '1');
      else host.sessionStorage.removeItem(STEP_LANG_KEY);
    } catch (e) {
      /* storage unavailable: the in-memory flag still applies */
    }
  }
  function stepLangMarked() {
    try {
      return !!host.sessionStorage.getItem(STEP_LANG_KEY);
    } catch (e) {
      return false;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Per-window state and baseline tracking                              */
  /* ------------------------------------------------------------------ */
  function S(win) {
    var s = states.get(win);
    if (!s) {
      s = { Y: null, theme: null, driving: 0, stepLang: false, stepTheme: false, gen: 0, chain: Promise.resolve() };
      states.set(win, s);
    }
    return s;
  }
  /** Bind to the current win.YES (again after a reload) and capture the baseline once. */
  function attach(win) {
    var y = Y(win);
    if (!y || !y.on) return y;
    var st = S(win);
    if (st.Y === y) return y;
    st.Y = y;
    // Never take the baseline from a frame that shows a step's language (a reload on the Language step).
    if (!base.lang && y.i18n && y.i18n.lang && !st.stepLang && !stepLangMarked()) base.lang = y.i18n.lang;
    if (!st.theme && y.theme && y.theme.effective) st.theme = y.theme.effective();
    y.on('lang', function () {
      if (Y(win) !== y || st.driving || st.stepLang || stepLangMarked()) return;
      base.lang = y.i18n.lang; // the visitor chose a language: keep it
    });
    y.on('theme', function () {
      if (Y(win) !== y || st.driving || st.stepTheme) return;
      st.theme = y.theme.effective();
    });
    return y;
  }
  function baseLang(win) {
    var y = Y(win);
    return base.lang || (y && y.data && y.data.statement && y.data.statement.language) || 'en';
  }
  function baseTheme(win) {
    if (base.theme === 'light' || base.theme === 'dark') return base.theme;
    if (WT.theme && typeof WT.theme.effective === 'function') return WT.theme.effective();
    return S(win).theme || 'light';
  }
  /** Serialise reset/apply per window, so they never interleave. */
  function queue(st, fn) {
    var run = st.chain.then(fn, fn);
    st.chain = run.then(
      function () {},
      function () {}
    );
    return run;
  }

  /* ------------------------------------------------------------------ */
  /* DOM helpers                                                         */
  /* ------------------------------------------------------------------ */
  function isPhone(win) {
    try {
      return win.innerWidth < 720;
    } catch (e) {
      return false;
    }
  }
  function visible(win, el) {
    if (!el || !el.isConnected) return false;
    var r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    var cs = win.getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') return false;
    return !el.closest('[hidden]') && !el.closest('dialog:not([open])');
  }
  function firstVisible(win, sel) {
    var d = D(win);
    if (!d) return null;
    var list;
    try {
      list = d.querySelectorAll(sel);
    } catch (e) {
      return null; // invalid selector
    }
    for (var i = 0; i < list.length; i++) if (visible(win, list[i])) return list[i];
    return null;
  }
  function selectors(win, step) {
    var t = (step && step.target) || step || {};
    if (typeof t === 'string') return [t];
    if (Array.isArray(t)) return t;
    var list = isPhone(win) ? t.phone || t.desktop : t.desktop || t.phone;
    return typeof list === 'string' ? [list] : list || [];
  }
  function actionsOf(step) {
    if (Array.isArray(step)) return step;
    return (step && step.setup) || [];
  }
  function kindOf(a) {
    var keys = ['route', 'call', 'click', 'wait', 'scroll', 'theme', 'lang', 'menu', 'delay'];
    for (var i = 0; i < keys.length; i++) if (a && Object.prototype.hasOwnProperty.call(a, keys[i])) return keys[i];
    return null;
  }
  /** Absolute URL in the frame's own document (G2: a relative one resolves against the PARENT). */
  function replaceHash(win, hash) {
    win.location.replace(win.location.href.split('#')[0] + hash);
  }
  function viewOf(hash) {
    var v = String(hash).replace(/^#\/?/, '').split('?')[0].split('/')[0];
    return VIEWS.indexOf(v) === -1 ? 'overview' : v;
  }
  function withheld(win) {
    var d = D(win);
    var y = Y(win);
    return !!((d && d.documentElement.classList.contains('is-withheld')) || (y && y.data && y.data.simulated));
  }
  function ready(win, ms) {
    return until(function () {
      var y = Y(win);
      var d = D(win);
      return y && y.ready === true && d && d.readyState !== 'loading';
    }, ms || 10000).then(function (v) {
      if (v) attach(win);
      return !!v;
    });
  }
  /** Height of the statement's masthead while it is pinned (sticky); 0 when it scrolls away. */
  function topInset(win) {
    var d = D(win);
    var m = d && d.getElementById('masthead');
    if (!m) return 0;
    var cs = win.getComputedStyle(m);
    if (cs.position !== 'sticky' && cs.position !== 'fixed') return 0;
    return Math.round(m.getBoundingClientRect().height);
  }

  /**
   * Remember the scroll position of everything around the frame (the frame
   * element's scrollable ancestors and their windows, up to the top); the
   * returned function restores whatever the statement moved.
   */
  function guardParents(win) {
    var saved = [];
    try {
      for (var w = win; w && w.frameElement && w.parent && w.parent !== w; w = w.parent) {
        var pw = w.parent;
        saved.push({ win: pw, x: pw.scrollX, y: pw.scrollY });
        for (var el = w.frameElement.parentElement; el && el !== pw.document.documentElement; el = el.parentElement) {
          if (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1) saved.push({ el: el, x: el.scrollLeft, y: el.scrollTop });
        }
      }
    } catch (e) {
      /* cross-origin parent: nothing we may touch */
    }
    var restore = function () {
      var moved = false;
      saved.forEach(function (s) {
        try {
          if (s.win) {
            if (s.win.scrollX !== s.x || s.win.scrollY !== s.y) {
              s.win.scrollTo({ left: s.x, top: s.y, behavior: 'instant' });
              moved = true;
            }
          } else if (s.el.scrollLeft !== s.x || s.el.scrollTop !== s.y) {
            s.el.scrollTo({ left: s.x, top: s.y, behavior: 'instant' });
            moved = true;
          }
        } catch (e) {
          /* ignore */
        }
      });
      return moved;
    };
    restore.empty = !saved.length;
    return restore;
  }
  /** Restore the parents now, and again while the statement keeps moving them (a smooth scroll in progress). */
  async function keepParents(restore) {
    if (restore.empty) return;
    restore();
    for (var i = 0; i < 3; i++) {
      await frame1();
      if (restore()) i = 0;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Settling and scrolling                                              */
  /* ------------------------------------------------------------------ */
  function signature(win, el) {
    var s = win.scrollX + ',' + win.scrollY;
    if (el && el.isConnected) {
      var r = el.getBoundingClientRect();
      s += ',' + Math.round(r.top) + ',' + Math.round(r.left) + ',' + Math.round(r.width) + ',' + Math.round(r.height);
    }
    return s;
  }
  async function animationsDone(win, ms) {
    var d = D(win);
    if (!d || !d.getAnimations) return;
    var finite = d.getAnimations().filter(function (a) {
      try {
        var t = a.effect && a.effect.getComputedTiming();
        return t && isFinite(t.endTime) && a.playState === 'running';
      } catch (e) {
        return false;
      }
    });
    if (!finite.length) return;
    await Promise.race([
      Promise.all(
        finite.map(function (a) {
          return a.finished.catch(function () {});
        })
      ),
      sleep(ms)
    ]);
  }
  async function settle(win, opts) {
    opts = opts && opts.nodeType === 1 ? { el: opts } : opts || {};
    var min = opts.minMs != null ? opts.minMs : 120;
    var max = opts.maxMs != null ? opts.maxMs : 1200;
    var need = opts.frames || 3;
    var t0 = now();
    var last = null;
    var stable = 0;
    while (now() - t0 < max) {
      await frame1();
      var sig;
      try {
        sig = signature(win, opts.el);
      } catch (e) {
        break;
      }
      if (sig === last) stable++;
      else {
        stable = 0;
        last = sig;
      }
      if (stable >= need && now() - t0 >= min) break;
    }
    if (opts.animations) await animationsDone(win, max);
  }
  function scrollable(win, p) {
    var cs = win.getComputedStyle(p);
    return /(auto|scroll|overlay)/.test(cs.overflowY) && p.scrollHeight > p.clientHeight + 1;
  }
  /** How far to scroll so a box (top, height) sits well in an area (aTop, aHeight). */
  function delta(top, height, aTop, aHeight, block, margin) {
    var room = aHeight - 2 * margin;
    if (block === 'nearest') {
      if (top >= aTop + margin && top + height <= aTop + aHeight - margin) return 0;
      block = height > room || top < aTop + margin ? 'start' : 'end';
    }
    if (block === 'auto') block = height > room ? 'start' : 'center';
    if (block === 'start') return top - (aTop + margin);
    if (block === 'end') return top + height - (aTop + aHeight - margin);
    return top + height / 2 - (aTop + aHeight / 2);
  }
  function scrollBox(box, by, behavior, isWin, win) {
    var cur = isWin ? win.scrollY : box.scrollTop;
    var maxTop = isWin ? Math.max(0, D(win).documentElement.scrollHeight - win.innerHeight) : box.scrollHeight - box.clientHeight;
    var next = Math.max(0, Math.min(maxTop, Math.round(cur + by)));
    if (Math.abs(next - cur) < 1) return 0;
    var o = { top: next, left: isWin ? win.scrollX : box.scrollLeft, behavior: behavior };
    if (isWin) win.scrollTo(o);
    else box.scrollTo(o);
    return next - cur;
  }
  async function scrollToTarget(win, el, opts) {
    opts = opts || {};
    if (!el || !el.isConnected) return null;
    await settle(win, { minMs: opts.minMs });
    if (!el.isConnected) return null;
    var d = D(win);
    var behavior = opts.behavior || (reduced(win) ? 'instant' : 'smooth');
    var block = opts.block || 'auto';
    var margin = opts.margin != null ? opts.margin : 12;
    var er = el.getBoundingClientRect();
    var shift = 0; // how far the inner containers move el up
    var pinned = !!el.closest('#masthead') || win.getComputedStyle(el).position === 'fixed';
    for (var p = el.parentElement; p && p !== d.body && p !== d.documentElement; p = p.parentElement) {
      var cs = win.getComputedStyle(p);
      if (cs.position === 'fixed') pinned = true;
      if (!scrollable(win, p)) continue;
      var pr = p.getBoundingClientRect();
      var pad = parseFloat(cs.scrollPaddingTop) || 0;
      var aTop = pr.top + p.clientTop + pad;
      shift += scrollBox(p, delta(er.top - shift, er.height, aTop, p.clientHeight - pad, block, margin), behavior, false, win);
    }
    if (!pinned) {
      var inset = topInset(win);
      var vh = d.documentElement.clientHeight || win.innerHeight;
      scrollBox(null, delta(er.top - shift, er.height, inset, vh - inset, block, margin), behavior, true, win);
    }
    await settle(win, { el: el, minMs: behavior === 'smooth' ? 120 : 0 });
    return el.isConnected ? el.getBoundingClientRect() : null;
  }

  /* ------------------------------------------------------------------ */
  /* Actions                                                             */
  /* ------------------------------------------------------------------ */
  async function route(win, hash) {
    hash = String(hash);
    if (hash.charAt(0) !== '#') hash = '#' + hash;
    if (hash.charAt(1) !== '/') hash = '#/' + hash.slice(1);
    var view = viewOf(hash);
    var y0 = Y(win);
    var simulate = /[?&]simulate=/.test(hash);
    if (win.location.hash !== hash) replaceHash(win, hash);
    else if (y0 && y0.nav && y0.nav.apply && (y0.state.view !== view || /^#\/[^/?]+\/./.test(hash))) y0.nav.apply(); // same address: re-run its handlers
    if (simulate) {
      // the boot's hashchange listener reloads the frame with the altered copy (G12)
      await until(function () {
        var y = Y(win);
        return y && y !== y0 && y.ready === true;
      }, 10000);
      attach(win);
      return;
    }
    var ok = await until(function () {
      var y = Y(win);
      var sec = D(win).getElementById('view-' + view);
      return y && y.state.view === view && sec && !sec.hidden;
    });
    if (!ok) throw new Error('route did not show ' + view + ': ' + hash);
    await sleep(30); // sub-routes focus and scroll in a setTimeout(0)
  }
  async function menu(win, open) {
    if (!isPhone(win)) return;
    var d = D(win);
    var b = d.querySelector('#masthead [data-mast-menu]');
    if (!b || !visible(win, b)) return;
    var isOpen = b.getAttribute('aria-expanded') === 'true';
    if (!!open !== isOpen) b.click();
    await until(function () {
      var p = d.getElementById('mast-menu');
      return p && p.hidden === !open;
    }, 1000);
  }
  function resolvePath(win, path) {
    var parts = String(path).split('.');
    var obj = Y(win);
    var parent = null;
    for (var i = 0; i < parts.length; i++) {
      parent = obj;
      obj = obj == null ? undefined : obj[parts[i]];
    }
    return { fn: obj, self: parent };
  }
  function opposite(v, list) {
    return list[0] === v ? list[1] : list[0];
  }

  async function run(win, st, a) {
    var kind = kindOf(a);
    var y = Y(win);
    switch (kind) {
      case 'route':
        return route(win, a.route);
      case 'call': {
        var r = resolvePath(win, a.call);
        if (typeof r.fn !== 'function') throw new Error('no such API: YES.' + a.call);
        st.driving++;
        try {
          var out = r.fn.apply(r.self, a.args || []);
          if (out && typeof out.then === 'function') await out;
        } finally {
          st.driving--;
        }
        await frame2();
        return;
      }
      case 'click': {
        var el = await until(function () {
          return firstVisible(win, a.click);
        });
        if (!el) throw new Error('click target not found: ' + a.click);
        if (el.closest(NO_CLICK)) throw new Error('refusing to click a print button: ' + a.click);
        el.click();
        await frame2();
        return;
      }
      case 'wait':
        if (!(await until(function () {
          return firstVisible(win, a.wait);
        }))) throw new Error('wait timed out: ' + a.wait);
        return;
      case 'scroll': {
        var target = await until(function () {
          return firstVisible(win, a.scroll);
        });
        if (!target) throw new Error('scroll target not found: ' + a.scroll);
        await scrollToTarget(win, target, { behavior: 'instant', block: 'start', minMs: 0 });
        return;
      }
      case 'theme': {
        var cur = y.theme.effective();
        var want = a.theme === 'opposite' ? opposite(baseTheme(win), ['light', 'dark']) : a.theme === 'toggle' ? opposite(cur, ['light', 'dark']) : a.theme;
        st.stepTheme = true;
        if (want !== cur || (want && y.theme.get() !== want)) {
          st.driving++;
          try {
            y.theme.set(want === 'light' || want === 'dark' ? want : null);
          } finally {
            st.driving--;
          }
        }
        await frame1();
        return;
      }
      case 'lang': {
        var langs = (y.config && y.config.languages) || ['en', 'es'];
        var lang = a.lang === 'opposite' ? opposite(baseLang(win), langs) : a.lang;
        st.stepLang = true;
        stepLangMark(true);
        if (y.i18n.lang !== lang) {
          st.driving++;
          try {
            y.setLang(lang, { silent: true });
          } finally {
            st.driving--;
          }
        }
        await frame1();
        return;
      }
      case 'menu':
        return menu(win, a.menu !== false);
      case 'delay':
        return sleep(Math.max(0, Math.min(5000, +a.delay || 0)));
      default:
        throw new Error('unknown action: ' + JSON.stringify(a));
    }
  }

  async function doApply(win, st, gen, step) {
    var errors = [];
    if (gen !== st.gen) return { ok: false, aborted: true, errors: errors };
    if (!(await ready(win))) return { ok: false, errors: ['statement not ready'] };
    var list = actionsOf(step);
    var restore = guardParents(win);
    var ordered = list
      .filter(function (a) {
        return kindOf(a) !== 'menu';
      })
      .concat(
        list.filter(function (a) {
          return kindOf(a) === 'menu';
        })
      ); // G11: a later navigation would close the Menu
    for (var i = 0; i < ordered.length; i++) {
      if (gen !== st.gen) return { ok: false, aborted: true, errors: errors };
      try {
        await run(win, st, ordered[i]);
      } catch (e) {
        errors.push(errText(e));
      }
    }
    await keepParents(restore);
    if (gen !== st.gen) return { ok: false, aborted: true, errors: errors };
    await settle(win);
    await keepParents(restore);
    return { ok: !errors.length, errors: errors };
  }

  /* ------------------------------------------------------------------ */
  /* Reset and the clean-state check                                     */
  /* ------------------------------------------------------------------ */
  function check(win, opts) {
    var problems = [];
    var y = Y(win);
    var d = D(win);
    if (!y || !y.state) return { ok: false, problems: ['statement not ready'] };
    var html = d.documentElement;
    var open = Array.prototype.map.call(d.querySelectorAll('dialog[open]'), function (x) {
      return x.id || x.className;
    });
    if (open.length) problems.push('open dialogs: ' + open.join(', '));
    if (html.classList.contains('has-modal')) problems.push('html.has-modal');
    if (html.classList.contains('assistant-docked')) problems.push('html.assistant-docked');
    if (withheld(win)) problems.push('integrity preview');
    if (y.state.journeyStep) problems.push('journey step ' + y.state.journeyStep);
    if (y.defaultFilters && JSON.stringify(y.state.filters) !== JSON.stringify(y.defaultFilters())) problems.push('filters');
    if (y.state.sort && (y.state.sort.key !== 'posted' || y.state.sort.dir !== 'desc')) problems.push('sort');
    if (y.state.selectedTx) problems.push('selected transaction ' + y.state.selectedTx);
    if (y.state.inquiry) problems.push('inquiry draft');
    if (y.state.assistant && (y.state.assistant.open || (y.state.assistant.thread || []).length)) problems.push('assistant conversation');
    var mb = d.querySelector('#masthead [data-mast-menu]');
    if (mb && mb.getAttribute('aria-expanded') === 'true') problems.push('phone menu open');
    if (y.i18n.lang !== baseLang(win)) problems.push('language ' + y.i18n.lang);
    if (y.theme.effective() !== baseTheme(win)) problems.push('theme ' + y.theme.effective());
    if (y.state.understand && ((y.state.understand.expanded || []).length || y.state.understand.fullHash)) problems.push('understand topics');
    if (y.state.explorer && y.state.explorer.filtersOpen) problems.push('filter panel open');
    var ov = y.state.overview || {};
    OV_DISCLOSURES.forEach(function (k) {
      if (ov[k]) problems.push('overview ' + k + ' open');
    });
    if (y.overview && y.overview.video && y.overview.video.state().playing) problems.push('video playing');
    if (y.nav && y.nav.current().param) problems.push('sub-route ' + win.location.hash);
    if (!(opts && opts.top === false) && win.scrollY > 1) problems.push('scrollY ' + win.scrollY);
    return { ok: !problems.length, problems: problems };
  }

  async function doReset(win, st, gen, opts) {
    var top = !(opts && opts.top === false);
    if (gen !== st.gen) return { ok: true, skipped: true, problems: [] };
    if (!(await ready(win))) return { ok: false, problems: ['statement not ready'] };
    // 0. The integrity preview (#/overview?simulate=mismatch): leaving it reloads the frame.
    if (withheld(win)) {
      var y0 = Y(win);
      replaceHash(win, '#/overview');
      await until(function () {
        var y = Y(win);
        return y && y !== y0 && y.ready === true && !withheld(win);
      }, 10000);
      attach(win);
    }
    var y = attach(win);
    var d = D(win);
    if (!y || !y.state) return { ok: false, problems: ['statement not ready'] };
    var restore = guardParents(win);
    st.driving++;
    try {
      // 1. Phone Menu
      var mb = d.querySelector('#masthead [data-mast-menu]');
      if (mb && mb.getAttribute('aria-expanded') === 'true') mb.click();
      // 2. Ask YES drawer (docked, modal or sheet) and its conversation
      if (y.assistant && y.assistant.isOpen && y.assistant.isOpen()) y.assistant.close({ returnFocus: false });
      if (y.state.assistant && (y.state.assistant.open || (y.state.assistant.thread || []).length)) y.set({ assistant: null });
      // 3. Inquiry (no close API)
      var inq = d.getElementById('inquiry-dialog');
      if (inq && inq.open) y.ui.closeDialog(inq, { returnFocus: false });
      // 4. Transaction detail: the default 'replace', never { how: 'back' } (G1)
      if (y.explorer && y.explorer.closeTx) y.explorer.closeTx();
      // 5. Anything else still open
      Array.prototype.forEach.call(d.querySelectorAll('dialog[open]'), function (x) {
        y.ui.closeDialog(x, { returnFocus: false });
      });
    } finally {
      st.driving--;
    }
    await sleep(0); // the dialogs' async 'close' handlers save the inquiry draft (G16)
    y = Y(win);
    st.driving++;
    try {
      if (y.state.inquiry) y.set({ inquiry: null });
      // 6. Journey: drop the overview's history marker first, so clearStep() replaces (G1)
      if (y.state.journeyStep) {
        try {
          win.history.replaceState(null, '', win.location.href);
        } catch (e) {
          /* ignore */
        }
        y.overview.clearStep();
      }
      // 7. Transactions: filters, sort, filter panel (YES.set alone does not sync the panel)
      if (y.defaultFilters && JSON.stringify(y.state.filters) !== JSON.stringify(y.defaultFilters())) y.explorer.clearFilters({ focus: false });
      if (y.state.sort && (y.state.sort.key !== 'posted' || y.state.sort.dir !== 'desc')) y.set({ sort: { key: 'posted', dir: 'desc' } });
      if (y.state.explorer && y.state.explorer.filtersOpen) {
        var tg = d.querySelector('[data-tx-toggle]');
        if (tg) tg.click();
        if (y.state.explorer.filtersOpen) {
          var ex = {};
          Object.keys(y.state.explorer).forEach(function (k) {
            ex[k] = y.state.explorer[k];
          });
          ex.filtersOpen = false;
          y.set({ explorer: ex });
        }
      }
      // 8. Understand topics and the full on-chain hash
      var u = y.state.understand;
      if (u && ((u.expanded || []).length || u.fullHash)) y.set({ understand: { expanded: [], fullHash: false, meta: {} } });
      // 9. Overview disclosures (statement details, tables, transcript); captions and mute are the visitor's
      var ov = y.state.overview;
      if (
        ov &&
        OV_DISCLOSURES.some(function (k) {
          return ov[k];
        })
      ) {
        var next = {};
        Object.keys(ov).forEach(function (k) {
          next[k] = ov[k];
        });
        OV_DISCLOSURES.forEach(function (k) {
          next[k] = false;
        });
        y.set({ overview: next });
      }
      // 10. Video
      if (y.overview && y.overview.video && y.overview.video.state().playing) y.overview.video.pause();
      // 11. Language and theme back to the baseline
      var lang = baseLang(win);
      if (y.i18n.lang !== lang) y.setLang(lang, { silent: true });
      var theme = baseTheme(win);
      if (y.theme.effective() !== theme) y.theme.set(theme);
    } finally {
      st.driving--;
    }
    st.stepLang = false;
    stepLangMark(false);
    st.stepTheme = false;
    // 12. Drop a sub-route (#/help/record, #/understand/token_units …) with replace: no history entry
    var cur = y.nav && y.nav.current();
    if (cur && (cur.param || Object.keys(cur.params || {}).length)) {
      replaceHash(win, '#/' + cur.view);
      await until(function () {
        var c = Y(win).nav.current();
        return !c.param && Y(win).state.view === cur.view;
      }, 1500);
    }
    // 13. Top of the page
    await frame2();
    if (top) {
      win.scrollTo({ top: 0, left: 0, behavior: 'instant' });
      await frame1();
      if (win.scrollY > 1) win.scrollTo(0, 0);
    }
    await keepParents(restore);
    return check(win, { top: top });
  }

  /* ------------------------------------------------------------------ */
  /* Public API                                                          */
  /* ------------------------------------------------------------------ */
  WT.driver = {
    reset: function (win, opts) {
      var st = S(win);
      var gen = ++st.gen; // aborts a running apply() at its next action
      return queue(st, function () {
        return doReset(win, st, gen, opts);
      }).catch(function (e) {
        return { ok: false, problems: [errText(e)] };
      });
    },
    apply: function (win, step) {
      var st = S(win);
      var gen = st.gen;
      return queue(st, function () {
        return doApply(win, st, gen, step);
      }).catch(function (e) {
        return { ok: false, errors: [errText(e)] };
      });
    },
    target: function (win, step, opts) {
      var st = S(win);
      var gen = st.gen;
      var list = selectors(win, step);
      return until(function () {
        if (gen !== st.gen) return ABORT;
        for (var i = 0; i < list.length; i++) {
          var el = firstVisible(win, list[i]);
          if (el) return el;
        }
        return null;
      }, (opts && opts.timeout) || 4000).then(function (v) {
        return v === ABORT ? null : v;
      });
    },
    scrollToTarget: function (win, el, opts) {
      return scrollToTarget(win, el, opts).catch(function () {
        return null;
      });
    },
    settle: function (win, opts) {
      return settle(win, opts).catch(function () {});
    },
    isPhone: isPhone,
    ready: ready,
    baseline: function (a, b) {
      var opts = a && a.document ? b : a;
      opts = opts || {};
      if ('lang' in opts) base.lang = opts.lang || null;
      if ('theme' in opts) base.theme = opts.theme === 'light' || opts.theme === 'dark' ? opts.theme : null;
      var win = a && a.document ? a : null;
      return { lang: win ? baseLang(win) : base.lang, theme: win ? baseTheme(win) : base.theme || (WT.theme && WT.theme.effective ? WT.theme.effective() : null) };
    },
    check: check,
    selectors: selectors,
    topInset: topInset,
    visible: visible,
    firstVisible: firstVisible
  };
})((window.WT = window.WT || {}));
