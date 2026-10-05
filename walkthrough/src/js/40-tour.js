/*
 * 40-tour.js — the guided walkthrough (#/tour/<featureId>). SPEC section 5.
 * Owner: tour.
 *
 * Layout: the panel (step text, "Your view", sticky navigation), a bar
 * ("View as" Mobile / Tablet / Desktop, open in a new tab, Dim the rest, the
 * branding notice) and the live statement in a same-origin frame, with a
 * highlight overlay drawn in THIS page over the frame. The DOM is built once;
 * changing step never reloads the frame (the router calls onRoute), it
 * re-renders the panel and re-activates:
 *
 *   driver.reset → driver.apply → driver.target → driver.scrollToTarget → draw
 *
 * Every activation carries a token, so a newer step change cancels an older
 * one at its next await (and driver.reset() aborts a running apply()). After
 * activation, focus goes back to the step h1 (or the control the visitor was
 * using) when the statement pulled it into the frame (STATEMENT-MAP G4),
 * unless the visitor went into the statement.
 *
 * View as: the frame gets the device's LOGICAL width (Mobile 390, Tablet 820,
 * Desktop 1280) and a logical height that fills the stage ÷ scale, and is
 * scaled down with a CSS transform when the stage is narrower (scale =
 * min(1, available width ÷ logical width)), centred, with a device outline for
 * Mobile and Tablet. The statement lays itself out for that width
 * (WT.driver.isPhone reads the frame's own width). Everything drawn over the
 * frame maps statement coordinates through the frame's scale and offset
 * (frameGeo()). The choice is saved in localStorage (infoslips.wt.device);
 * without one, the default follows the app's width.
 *
 * Overlay: an SVG spotlight (dim with a rounded cut-out, padding 8, radius 12),
 * a 3px --spot outline with an inner contrast ring and a "k · Title" tag (placed
 * around the outline where it hides the least of the statement). It is
 * aria-hidden and pointer-events: none, so the statement stays usable. It is
 * tracked with requestAnimationFrame while anything moves (frame scroll, frame
 * and target resize, DOM mutations that may replace the target), then idles.
 * When the target is scrolled away, an edge indicator offers "Show it".
 *
 * WT.tour (read-only helpers, used by tests):
 *   { current(), frame(), target(), device(), scale() }
 */
(function (WT) {
  'use strict';

  var doc = document;
  var win = window;

  var PAD = 8; // spotlight padding around the target (overlay px)
  var RADIUS = 12;
  var INSET = 2; // keeps the outline inside the frame when the target is clipped
  var GROW = 22; // the outline settles onto the target from this much larger
  var TWEEN_MS = 320;
  var DIM_KEY = 'infoslips.wt.tour.dim';
  var DEVICE_KEY = 'infoslips.wt.device';
  var STEP_LANG_KEY = 'infoslips.wt.stepLang'; // written by 30-driver.js when a step sets the statement's language
  var FAIL_TEXT = 'We couldn’t highlight this part automatically.';
  var BRAND_TEXT = 'YES brand applied. The design may change after the workshop.';
  var FINISH_GUARD_MS = 3000;

  /** The "View as" devices: logical width, height (0 = fill the stage) and how to say it. */
  var DEVICES = {
    mobile: { label: 'Mobile', w: 390, h: 844, say: 'a phone', radius: 22 },
    tablet: { label: 'Tablet', w: 820, h: 1180, say: 'a tablet', radius: 16 },
    desktop: { label: 'Desktop', w: 1280, h: 0, say: 'a desktop', radius: 0 }
  };
  var DEVICE_ORDER = ['mobile', 'tablet', 'desktop'];
  /** Device glyphs, drawn like WT.icon (24-unit grid, 2px strokes). */
  var DEVICE_ICON = {
    mobile: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
    tablet: '<rect x="4" y="2.5" width="16" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
    desktop: '<rect x="2.5" y="4" width="19" height="12.5" rx="2"/><path d="M8.5 20.5h7M12 16.5v4"/>'
  };

  var els = {};
  var S = {
    built: false,
    id: '',
    token: 0,
    activated: '', // the step whose activation finished
    failed: false,
    target: null,
    clips: [], // ancestors of the target that clip it (scroll boxes)
    pinned: false, // target in a dialog, the masthead or a fixed box: not under the statement's sticky masthead
    state: 'idle',
    dim: true,
    pane: 'split',
    phone: null,
    phoneAt: null, // the statement's layout when the step was set up
    device: 'desktop',
    geo: null, // { lw, lh, s, chrome }
    tween: null,
    raf: 0,
    still: 0,
    aliveUntil: 0,
    last: '',
    stepAt: 0,
    frameUseAt: 0,
    tabKeyAt: 0,
    wantFocus: false,
    lastFocus: null,
    pendingFocus: null,
    boundDoc: null,
    mo: null,
    ro: null,
    slowTimer: 0,
    flipTimer: 0,
    devTimer: 0,
    drCtl: null,
    tabbed: null, // a target we made focusable (tabindex=-1) for "Go to the highlighted part"
    goAfter: false, // focus the target once the running activation finishes
    whyOpen: null, // the visitor's own choice for "Why it matters" (null: by screen width)
    wasVisible: false, // the target was fully in view before a resize started
    resizing: false,
    resizeTimer: 0,
    typed: {}, // textareas changed since they got focus
    sayOnSave: false, // announce "Saved" when the next save succeeds
    failSaid: false, // a save failure was announced (once per streak)
    finishing: false
  };
  var stepsDlg = null;
  var drDlg = null;

  /* ------------------------------------------------------------------ */
  /* Small helpers                                                       */
  /* ------------------------------------------------------------------ */
  function icon(name, size, cls) {
    return WT.icon(name, { size: size || 18, cls: cls });
  }
  function deviceIcon(name, size) {
    var n = size || 18;
    return (
      '<svg class="wt-icon wt-tour__devicon" width="' + n + '" height="' + n + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
      DEVICE_ICON[name] +
      '</svg>'
    );
  }
  function stepFor(id) {
    return (WT.steps && WT.steps[id]) || null;
  }
  function firstId() {
    return WT.features.length ? WT.features[0].id : '';
  }
  function now() {
    return Date.now();
  }
  function tourVisible() {
    var r = WT.route();
    return !!(r && r.view === 'tour' && S.built);
  }
  function fwin() {
    try {
      return (els.frame && els.frame.contentWindow) || null;
    } catch (e) {
      return null;
    }
  }
  function title() {
    return els.content ? els.content.querySelector('h1') : null;
  }
  function focusTitle() {
    var h = title();
    if (h) h.focus({ preventScroll: true });
  }
  function parentModalOpen() {
    return !!doc.querySelector('dialog[open]');
  }
  function mq(q) {
    return !!(win.matchMedia && win.matchMedia(q).matches);
  }
  /** Statement labels are written in “curly quotes” in the step text: show them as UI labels. */
  function rich(s) {
    return WT.esc(s || '').replace(/“([^“”]{1,90})”/g, '“<span class="wt-tour__ui">$1</span>”');
  }
  function isTyping(el) {
    if (!el || !el.tagName) return false;
    if (el.isContentEditable) return true;
    var tag = el.tagName.toLowerCase();
    if (tag === 'textarea' || tag === 'select') return true;
    if (tag !== 'input') return false;
    var type = (el.getAttribute('type') || 'text').toLowerCase();
    return ['button', 'checkbox', 'radio', 'range', 'color', 'file', 'image', 'reset', 'submit'].indexOf(type) === -1;
  }
  function tagText(id) {
    var f = WT.feature(id);
    return f ? f.index + 1 + ' · ' + f.title : '';
  }
  /** The tour resumes here when it is opened without a step (#/tour). */
  function resumeId() {
    return WT.reviewer.lastStep() || WT.answers.stats().firstUnanswered || firstId();
  }

  /* ------------------------------------------------------------------ */
  /* Layout (built once)                                                 */
  /* ------------------------------------------------------------------ */
  function deviceOptionsHtml() {
    return DEVICE_ORDER.map(function (name) {
      var d = DEVICES[name];
      return (
        '<label class="wt-tour__seg-opt" data-tip="' + d.label + '">' +
          '<input class="wt-tour__seg-input" type="radio" name="tour-device" value="' + name + '" data-fk="tour-device-' + name + '"' + (S.device === name ? ' checked' : '') + ' />' +
          '<span class="wt-tour__seg-face">' + deviceIcon(name) + '<span class="wt-tour__seg-text">' + d.label + '</span></span>' +
        '</label>'
      );
    }).join('');
  }

  function layoutHtml() {
    return (
      '<div class="wt-tour" data-pane="split" data-device="' + S.device + '">' +
        /* Panel: first in the DOM, so the step heading leads the reading and tab order. */
        '<div class="wt-tour__panel wt-fill">' +
          '<div class="wt-tour__scroll" data-tour="scroll">' +
            '<div class="wt-tour__content" data-tour="content"></div>' +
            '<section class="wt-card wt-tour__view" id="tour-view" aria-labelledby="tour-view-h">' +
              '<fieldset class="wt-fieldset wt-tour__fieldset">' +
                '<legend class="wt-tour__legend"><h2 class="wt-tour__view-h" id="tour-view-h">Your view</h2></legend>' +
                '<p class="wt-hint wt-tour__view-hint">Saved as you go. Everyone with the link can see your answers.</p>' +
                '<div class="wt-tour__form" data-tour="form"></div>' +
              '</fieldset>' +
              '<div class="wt-tour__savebar">' +
                /* Not a live region: WT.announce speaks failures, and "Saved" after a field or a choice is done. */
                '<p class="wt-status wt-tour__status" data-tour="save"></p>' +
                '<button class="wt-btn wt-btn--secondary wt-btn--sm" type="button" data-act="retry" hidden>' + icon('refresh', 16) + '<span>Retry</span></button>' +
                '<button class="wt-btn wt-btn--link wt-tour__clear" type="button" data-act="clear" hidden>Clear my answer</button>' +
              '</div>' +
            '</section>' +
            '<div class="wt-tour__more" data-tour="more"></div>' +
            '<p class="wt-tour__keys">' + icon('keyboard', 18) +
              '<span>Keyboard: <kbd>Alt</kbd> + <kbd><span aria-hidden="true">→</span><span class="wt-sr-only">Right arrow</span></kbd> next step, ' +
              '<kbd>Alt</kbd> + <kbd><span aria-hidden="true">←</span><span class="wt-sr-only">Left arrow</span></kbd> previous step, when you’re not typing in a field.</span></p>' +
          '</div>' +
          '<nav class="wt-tour__nav" aria-label="Walkthrough steps">' +
            '<button class="wt-tour__state" type="button" data-act="goform" data-state="none" data-fk="tour-state"></button>' +
            '<button class="wt-btn wt-btn--ghost wt-btn--sm wt-tour__tool wt-tour__tool--steps" type="button" data-act="steps" aria-haspopup="dialog" data-tip="All steps">' + icon('list') + '<span class="wt-tour__tool-label">All steps</span></button>' +
            '<button class="wt-btn wt-btn--ghost wt-btn--sm wt-tour__tool wt-tour__tool--restart" type="button" data-act="restart" aria-haspopup="dialog" data-tip="Restart">' + icon('restart') + '<span class="wt-tour__tool-label">Restart</span></button>' +
            '<button class="wt-btn wt-btn--secondary wt-tour__prev" type="button" data-act="prev">' + icon('arrow-left') + '<span>Back</span></button>' +
            '<button class="wt-btn wt-btn--primary wt-tour__next" type="button" data-act="next"><span data-tour="next-label">Next</span>' + icon('arrow-right') + '</button>' +
          '</nav>' +
        '</div>' +

        /* Bar: above the frame on wider screens, between frame and panel on phones. */
        '<div class="wt-tour__bar">' +
          '<div class="wt-tour__tools">' +
            '<p class="wt-tour__bar-label">' + icon('eye', 18) + '<strong>Interactive statement</strong></p>' +
            '<div class="wt-tour__panes" role="group" aria-label="Screen space">' +
              '<button class="wt-chip wt-tour__pane" type="button" data-pane-btn="statement" aria-pressed="false" aria-label="Show statement" data-tip="Show statement">' + icon('expand', 16) + '<span class="wt-tour__pane-text">Statement</span></button>' +
              '<button class="wt-chip wt-tour__pane" type="button" data-pane-btn="panel" aria-pressed="false" aria-label="Show panel" data-tip="Show panel">' + icon('layers', 16) + '<span class="wt-tour__pane-text">Panel</span></button>' +
            '</div>' +
            '<div class="wt-tour__views" role="radiogroup" aria-labelledby="tour-views-label" data-tour="views">' +
              '<span class="wt-tour__views-label" id="tour-views-label">View as</span>' +
              '<span class="wt-tour__seg">' + deviceOptionsHtml() + '</span>' +
            '</div>' +
            '<a class="wt-tour__newtab" data-tour="newtab" href="' + WT.esc(WT.STATEMENT_TAB_URL) + '" target="_blank" rel="noopener" aria-label="Open the statement in a new tab" data-tip="Open in a new tab">' +
              icon('external', 17) + '<span class="wt-tour__newtab-text">New tab</span></a>' +
            /* WT.ui.switch markup, with " the rest" in its own span so phones can show just "Dim". */
            '<div class="wt-tour__dim" data-tip="Dim the rest">' +
              '<label class="wt-switch" for="tour-dim">' +
                '<input class="wt-switch__input" type="checkbox" role="switch" id="tour-dim" data-fk="tour-dim"' + (S.dim ? ' checked' : '') + ' />' +
                '<span class="wt-switch__track" aria-hidden="true"></span>' +
                '<span class="wt-switch__label">Dim<span class="wt-tour__dim-more"> the rest</span></span>' +
              '</label>' +
            '</div>' +
          '</div>' +
          '<div class="wt-tour__info">' +
            '<p class="wt-tour__bar-hint">Click around freely. It doesn’t change your answers.</p>' +
            '<p class="wt-tour__brand" data-brand-notice="compact">' + icon('info', 16) + '<span>' + BRAND_TEXT + '</span></p>' +
          '</div>' +
        '</div>' +

        /* Stage: the statement (in its device outline), the overlay over it, and the edge indicator. */
        '<div class="wt-tour__stage">' +
          '<div class="wt-tour__frame-wrap" data-tour="wrap">' +
            '<div class="wt-tour__device" data-tour="device">' +
              '<iframe id="wt-frame" class="wt-tour__frame" src="statement/index.html" title="YES statement (interactive demo)"></iframe>' +
            '</div>' +
            '<div class="wt-tour__veil" aria-hidden="true"><span class="wt-tour__spinner"></span><span>Loading the statement…</span></div>' +
            '<div class="wt-tour__overlay" id="wt-tour-overlay" data-state="idle" data-dim="' + (S.dim ? 'on' : 'off') + '" aria-hidden="true">' +
              '<svg class="wt-spot" width="100%" height="100%" focusable="false" aria-hidden="true">' +
                '<defs><mask id="wt-spot-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="100%" height="100%">' +
                  '<rect class="wt-spot__all" x="0" y="0" width="100%" height="100%"></rect>' +
                  '<rect class="wt-spot__hole" x="0" y="0" width="0" height="0" rx="' + RADIUS + '" ry="' + RADIUS + '"></rect>' +
                '</mask></defs>' +
                '<rect class="wt-spot__dim" x="0" y="0" width="100%" height="100%" mask="url(#wt-spot-mask)"></rect>' +
              '</svg>' +
              '<div class="wt-spot__ring"></div>' +
              '<div class="wt-spot__tag"></div>' +
              '<div class="wt-spot__busy"><span class="wt-tour__spinner"></span><span data-tour="busy"></span></div>' +
            '</div>' +
            '<div class="wt-tour__edge" data-tour="edge" data-edge="above" hidden>' +
              '<span class="wt-tour__edge-text" id="wt-tour-edge-text"></span>' +
              '<button class="wt-btn wt-btn--primary wt-btn--sm" type="button" data-act="showit" aria-describedby="wt-tour-edge-text">Show it</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>'
    );
  }

  function build(section) {
    S.dim = WT.storage.getRaw(DIM_KEY) !== '0';
    S.device = currentDevice();
    // The statement keeps its language in sessionStorage (yes.lang), which this tab
    // shares with it. If the tour's Language step left it in Spanish, start the
    // statement in English again; English is always the tour's baseline (STATEMENT-MAP G13).
    if (WT.session.getRaw(STEP_LANG_KEY)) {
      WT.session.remove('yes.lang');
      WT.session.remove(STEP_LANG_KEY);
    }
    if (WT.driver) WT.driver.baseline({ lang: 'en' });

    section.innerHTML = layoutHtml();
    var q = function (sel) {
      return section.querySelector(sel);
    };
    els.section = section;
    els.root = q('.wt-tour');
    els.panel = q('.wt-tour__panel');
    els.scroll = q('[data-tour="scroll"]');
    els.content = q('[data-tour="content"]');
    els.more = q('[data-tour="more"]');
    els.view = q('#tour-view');
    els.form = q('[data-tour="form"]');
    els.save = q('[data-tour="save"]');
    els.retry = q('[data-act="retry"]');
    els.clear = q('[data-act="clear"]');
    els.chip = q('[data-act="goform"]');
    els.prev = q('[data-act="prev"]');
    els.next = q('[data-act="next"]');
    els.nextLabel = q('[data-tour="next-label"]');
    els.bar = q('.wt-tour__bar');
    els.views = q('[data-tour="views"]');
    els.newtab = q('[data-tour="newtab"]');
    els.stage = q('.wt-tour__stage');
    els.wrap = q('[data-tour="wrap"]');
    els.device = q('[data-tour="device"]');
    els.frame = q('#wt-frame');
    els.overlay = q('#wt-tour-overlay');
    els.hole = q('.wt-spot__hole');
    els.ring = q('.wt-spot__ring');
    els.tag = q('.wt-spot__tag');
    els.busy = q('[data-tour="busy"]');
    els.edge = q('[data-tour="edge"]');
    els.edgeText = q('#wt-tour-edge-text');
    els.dim = q('#tour-dim');
    S.built = true;

    // Size the frame for the device before the statement boots, so it starts in the right layout.
    layoutDevice();
    queueTips();

    els.root.addEventListener('click', onClick);
    els.panel.addEventListener('change', onFormChange);
    els.panel.addEventListener('input', onFormInput);
    els.panel.addEventListener('focusout', onFormBlur);
    els.root.addEventListener('focusin', function (e) {
      if (e.target !== els.frame) S.lastFocus = e.target;
    });
    els.dim.addEventListener('change', function () {
      setDim(els.dim.checked);
      WT.announce(els.dim.checked ? 'The rest of the statement is dimmed' : 'Dimming is off');
    });
    els.views.addEventListener('change', function (e) {
      var t = e.target;
      if (t && t.name === 'tour-device' && t.checked) setDevice(t.value, { save: true, announce: true });
    });
    // The statement may change its address with history.replaceState (no event), so the
    // link catches up just before it is used: hover, focus, any button press (middle-click,
    // the context menu's "Open in new tab") and the click itself (onClick).
    ['pointerenter', 'pointerdown', 'focus'].forEach(function (t) {
      els.newtab.addEventListener(t, syncNewTab);
    });
    els.frame.addEventListener('load', onFrameLoad);
    if (win.ResizeObserver) {
      new ResizeObserver(function () {
        layoutDevice();
        kick();
      }).observe(els.wrap);
    }
    win.addEventListener('resize', onWindowResize);
    win.addEventListener('orientationchange', onWindowResize);
    // Focus moving into the frame right after a Tab is the visitor's own choice.
    win.addEventListener('blur', function () {
      if (now() - S.tabKeyAt < 200) S.frameUseAt = now();
    });
    if (win.matchMedia) {
      var phoneMq = win.matchMedia('(max-width: 719.98px)');
      var onMq = function () {
        if (!phoneMq.matches && S.pane !== 'split') setPane('split');
      };
      if (phoneMq.addEventListener) phoneMq.addEventListener('change', onMq);
      else if (phoneMq.addListener) phoneMq.addListener(onMq);
    }
    setSaveFrom(null);
  }

  /* ------------------------------------------------------------------ */
  /* View as: Mobile / Tablet / Desktop                                  */
  /* ------------------------------------------------------------------ */
  function savedDevice() {
    var v = WT.storage.getRaw(DEVICE_KEY);
    return v && DEVICES[v] ? v : '';
  }
  /** Without a saved choice: Desktop at 1024px and up, Tablet at 720–1023px, Mobile below. */
  function defaultDevice() {
    var w = doc.documentElement.clientWidth || win.innerWidth || 1280;
    return w >= 1024 ? 'desktop' : w >= 720 ? 'tablet' : 'mobile';
  }
  function currentDevice() {
    return savedDevice() || defaultDevice();
  }

  /**
   * Fit the frame into the stage: the device's logical width, scaled down when
   * the stage is narrower, with a logical height that fills the stage. Mobile
   * and Tablet get a device outline when there is room around them (or when a
   * tablet is shown scaled down); Desktop always fills the width.
   */
  function layoutDevice() {
    if (!els.wrap || !els.frame) return;
    var W = els.wrap.clientWidth;
    var H = els.wrap.clientHeight;
    if (!W || !H) return;
    var dev = DEVICES[S.device] || DEVICES.desktop;
    var lw = dev.w;
    var P = W < 720 ? 12 : 24;
    var chrome = false;
    if (S.device === 'mobile') chrome = W >= lw + 2 * P;
    else if (S.device === 'tablet') chrome = W >= lw + 2 * P || W < lw;
    var pad = chrome ? P : 0;
    var s = Math.min(1, (W - 2 * pad) / lw);
    s = Math.max(0.1, Math.floor(s * 10000) / 10000);
    var vw = Math.floor(lw * s);
    var vh = Math.max(40, H - 2 * pad);
    var lh = Math.max(120, Math.floor(vh / s));
    var x = Math.max(0, Math.round((W - vw) / 2));
    var g = S.geo;
    if (g && g.lw === lw && g.lh === lh && g.s === s && g.x === x && g.y === pad && g.chrome === chrome) return;
    S.geo = { lw: lw, lh: lh, s: s, x: x, y: pad, vw: vw, vh: vh, chrome: chrome };
    var st = els.root.style;
    st.setProperty('--dev-x', x + 'px');
    st.setProperty('--dev-y', pad + 'px');
    st.setProperty('--dev-w', vw + 'px');
    st.setProperty('--dev-h', vh + 'px');
    st.setProperty('--frame-lw', lw + 'px');
    st.setProperty('--frame-lh', lh + 'px');
    st.setProperty('--frame-s', String(s));
    els.root.setAttribute('data-chrome', chrome ? 'on' : 'off');
    els.root.setAttribute('data-scaled', s < 1 ? 'on' : 'off');
    S.last = '';
    kick();
  }

  /** Tooltips only where a control shows an icon alone, or its text is cut short. */
  var TIP_TEXT = '.wt-tour__seg-text, .wt-tour__newtab-text, .wt-tour__tool-label, .wt-tour__pane-text, .wt-tour__state-text, .wt-tour__dim-more';
  function syncTips() {
    if (!els.root) return;
    WT.$$('[data-tip]', els.root).forEach(function (el) {
      var t = el.querySelector(TIP_TEXT);
      var on = !t || t.getBoundingClientRect().width <= 1 || t.scrollWidth > t.clientWidth + 1;
      el.classList.toggle('has-tip', on);
    });
  }
  var tipsQueued = 0;
  function queueTips() {
    if (tipsQueued) return;
    tipsQueued = win.requestAnimationFrame(function () {
      tipsQueued = 0;
      syncTips();
    });
  }

  function syncDeviceRadios() {
    WT.$$('input[name="tour-device"]', els.views).forEach(function (r) {
      r.checked = r.value === S.device;
    });
  }

  /** Switch the view. opts: { save, announce }. The step is set up again once the frame has its new size. */
  function setDevice(name, opts) {
    opts = opts || {};
    if (!DEVICES[name] || !S.built) return;
    if (opts.save) WT.storage.set(DEVICE_KEY, name);
    var changed = name !== S.device;
    S.device = name;
    els.root.setAttribute('data-device', name);
    syncDeviceRadios();
    layoutDevice();
    if (opts.announce && changed) WT.announce('Showing the statement as on ' + DEVICES[name].say);
    if (!changed) return;
    clearTimeout(S.devTimer);
    clearTimeout(S.flipTimer);
    S.devTimer = setTimeout(function () {
      S.devTimer = 0;
      if (!tourVisible() || !S.id) return;
      S.stepAt = now(); // focus pulled into the frame now is the statement's doing, not the visitor's
      activate(S.id);
    }, 160);
  }

  /** Window resize or rotation: the default view follows the width until the visitor chooses. */
  function onWindowResize() {
    if (!S.built) return;
    if (!S.resizing) S.resizing = true; // freeze "was the target in view?" before the new layout is measured
    clearTimeout(S.resizeTimer);
    S.resizeTimer = setTimeout(afterResize, 320);
    if (!savedDevice()) {
      var d = defaultDevice();
      if (d !== S.device) setDevice(d, { announce: false });
    }
    layoutDevice();
    queueTips();
    kick();
  }

  /** Once a resize has settled: bring the target back if it was in view and now isn't (fully). */
  function afterResize() {
    S.resizing = false;
    if (!tourVisible() || S.activated !== S.id || !S.target || S.devTimer) return;
    var was = S.wasVisible;
    var w = fwin();
    var g = measure(w);
    var lost = g.kind === 'off' || (g.kind === 'on' && /top|bottom/.test(g.clip || ''));
    if (was && lost && WT.driver) {
      WT.driver.scrollToTarget(w, S.target).then(kick);
    }
  }

  /** Where the frame is drawn, in overlay (wrap) coordinates, and its scale. */
  function frameGeo() {
    var fr = els.frame.getBoundingClientRect();
    var wr = els.wrap.getBoundingClientRect();
    var ow = els.frame.offsetWidth || fr.width || 1;
    var s = fr.width / ow || 1;
    return { x: fr.left - wr.left + els.frame.clientLeft * s, y: fr.top - wr.top + els.frame.clientTop * s, s: s, lw: els.frame.clientWidth, lh: els.frame.clientHeight };
  }

  /* ------------------------------------------------------------------ */
  /* Panel content                                                       */
  /* ------------------------------------------------------------------ */
  function listHtml(items) {
    return (
      '<ul class="wt-tour__list" role="list">' +
      items
        .map(function (t) {
          return '<li>' + icon('check', 16) + '<span>' + rich(t) + '</span></li>';
        })
        .join('') +
      '</ul>'
    );
  }

  /** Header (section, step k of N, title), the failure note, What it is, and Try it. */
  function contentHtml(id) {
    var f = WT.feature(id);
    var st = stepFor(id) || {};
    var k = f.index + 1;
    var n = WT.features.length;
    return (
      '<header class="wt-tour__head">' +
        '<div class="wt-tour__meta">' +
          '<span class="wt-tour__section">' + WT.esc(WT.sectionLabel(f.section)) + '</span>' +
          '<span class="wt-tour__count wt-num" id="tour-count">Step ' + k + ' of ' + n + '</span>' +
        '</div>' +
        '<progress class="wt-progress__bar wt-tour__progress" max="' + n + '" value="' + k + '" aria-labelledby="tour-count"></progress>' +
        '<h1 class="wt-title wt-tour__title" id="tour-title" tabindex="-1" data-fk="h1" aria-describedby="tour-count">' + WT.esc(f.title) + '</h1>' +
        '<p class="wt-sr-only" id="tour-where">In the statement, this part is highlighted: ' + WT.esc(tagText(id)) + '.</p>' +
      '</header>' +
      '<div class="wt-tour__note" data-tour="note" role="status" aria-live="polite"></div>' +
      '<section class="wt-tour__sec" aria-labelledby="tour-what-h">' +
        '<h2 class="wt-tour__h" id="tour-what-h">What it is</h2>' +
        '<p class="wt-tour__what">' + rich(st.what || f.short) + '</p>' +
      '</section>' +
      '<section class="wt-band wt-tour__try" aria-labelledby="tour-try-h">' +
        '<h2 class="wt-tour__h" id="tour-try-h">' + icon('target', 16) + '<span>Try it</span></h2>' +
        (st.tryIt ? '<p>' + rich(st.tryIt) + '</p>' : '') +
        '<button class="wt-btn wt-btn--secondary wt-btn--sm wt-tour__goto" type="button" data-act="goto" data-fk="tour-goto">' + icon('target', 16) + '<span>Go to the highlighted part</span></button>' +
      '</section>'
    );
  }

  /** "Why it matters for YES and customers" (a disclosure) and View data requirements. */
  function moreHtml(id) {
    var st = stepFor(id) || {};
    var yes = Array.isArray(st.valueYes) ? st.valueYes : [];
    var cust = Array.isArray(st.valueCustomer) ? st.valueCustomer : [];
    var open = S.whyOpen === null ? mq('(min-width: 1024px)') : S.whyOpen;
    var why =
      yes.length || cust.length
        ? '<details class="wt-details wt-tour__why"' + (open ? ' open' : '') + '>' +
            '<summary class="wt-tour__why-sum" data-fk="tour-why">' + icon('sparkle', 18, 'wt-tour__why-icon') + '<span>Why it matters for YES and customers</span></summary>' +
            '<div class="wt-tour__values">' +
              (yes.length
                ? '<section class="wt-tour__value" aria-labelledby="tour-yes-h"><h2 class="wt-tour__h" id="tour-yes-h">' + icon('flag', 16) + '<span>Value for YES</span></h2>' + listHtml(yes) + '</section>'
                : '') +
              (cust.length
                ? '<section class="wt-tour__value" aria-labelledby="tour-cust-h"><h2 class="wt-tour__h" id="tour-cust-h">' + icon('users', 16) + '<span>Value for your customers</span></h2>' + listHtml(cust) + '</section>'
                : '') +
            '</div>' +
          '</details>'
        : '';
    return (
      why +
      '<div class="wt-tour__actions">' +
        '<button class="wt-btn wt-btn--secondary wt-btn--sm" type="button" data-act="datareq" data-fk="tour-datareq" aria-haspopup="dialog">' + icon('braces') + '<span>View data requirements</span></button>' +
      '</div>'
    );
  }

  function priorityLegend(vote) {
    return vote === 'exclude' ? 'Priority if YES did include it (optional)' : 'Priority if included';
  }

  function formHtml(id) {
    var a = WT.answers.get(id) || {};
    return (
      WT.ui.voteGroup({ name: 'tour-vote', id: 'tour-vote', fk: 'tour-vote', value: a.vote }) +
      WT.ui.field({ id: 'tour-reason', label: 'Why include or exclude it?', optional: true, multiline: true, rows: 3, max: WT.LIMITS.reason, value: a.reason || '' }) +
      WT.ui.priorityGroup({ name: 'tour-priority', id: 'tour-priority', fk: 'tour-priority', value: a.priority, legend: priorityLegend(a.vote) }) +
      WT.ui.field({
        id: 'tour-comment',
        label: 'Comment',
        optional: true,
        multiline: true,
        rows: 4,
        max: WT.LIMITS.comment,
        value: a.comment || '',
        hint: 'Ideas, questions or concerns about this feature.'
      })
    );
  }

  function renderForm(id) {
    if (!els.form || !id) return;
    WT.render(els.form, formHtml(id));
    S.typed = {};
    updateClear();
    renderChip();
  }

  /**
   * Bring the form in line with the saved answer without re-rendering it: used
   * when the change came from elsewhere (another tab, the server, a reset). The
   * field the visitor is in is left alone, so their typing is never reversed.
   */
  function syncForm(id) {
    if (!els.form || !id || id !== S.id) return;
    var a = WT.answers.get(id) || {};
    var active = doc.activeElement;
    ['vote', 'priority'].forEach(function (k) {
      var radios = WT.$$('input[name="tour-' + k + '"]', els.form);
      if (radios.indexOf(active) !== -1) return;
      radios.forEach(function (r) {
        r.checked = r.value === a[k];
      });
    });
    ['reason', 'comment'].forEach(function (k) {
      var el = els.form.querySelector('#tour-' + k);
      var v = a[k] || '';
      if (!el || el === active || el.value === v) return;
      el.value = v;
      var counter = els.form.querySelector('#tour-' + k + '-count');
      var max = WT.LIMITS[k];
      if (counter && max) counter.outerHTML = WT.ui.counter('tour-' + k, v.length, max);
    });
    relabelPriority();
    updateClear();
    renderChip();
  }

  function relabelPriority() {
    var lg = els.form && els.form.querySelector('#tour-priority > legend');
    var v = els.form && els.form.querySelector('input[name="tour-vote"]:checked');
    var text = priorityLegend(v ? v.value : (WT.answers.get(S.id) || {}).vote);
    if (lg && lg.textContent !== text) lg.textContent = text;
  }

  function updateClear() {
    if (els.clear) els.clear.hidden = !WT.answers.get(S.id);
  }

  /** The state chip in the navigation: what this reviewer said about this feature; it leads to the form. */
  function renderChip() {
    if (!els.chip || !S.id) return;
    var a = WT.answers.get(S.id);
    var p = a && WT.PRIORITY_LABEL[a.priority] ? WT.PRIORITY_LABEL[a.priority] + ' priority' : '';
    var state;
    var main;
    var rest;
    var glyph;
    if (a && a.vote === 'include') {
      state = 'include';
      main = 'Included';
      rest = p;
      glyph = 'check';
    } else if (a && a.vote === 'exclude') {
      state = 'exclude';
      main = 'Excluded';
      rest = p;
      glyph = 'x';
    } else {
      state = 'none';
      main = a ? 'No vote yet' : 'Not answered yet';
      rest = 'Give your view';
      glyph = 'edit';
    }
    var html =
      '<span class="wt-tour__state-dot">' + icon(glyph, 14) + '</span>' +
      '<span class="wt-tour__state-text"><span class="wt-sr-only">Your view: </span>' +
        '<span class="wt-tour__state-main">' + WT.esc(main) + '</span>' +
        (rest ? '<span class="wt-tour__state-rest"><span class="wt-tour__state-sep"> · </span>' + WT.esc(rest) + '</span>' : '') +
      '</span>';
    var sig = state + '|' + main + '|' + rest;
    if (els.chip.getAttribute('data-sig') === sig) return;
    els.chip.setAttribute('data-sig', sig);
    els.chip.setAttribute('data-state', state);
    els.chip.setAttribute('data-tip', main + (rest ? ' · ' + rest : ''));
    els.chip.innerHTML = html;
    queueTips();
  }

  /** The chip: show the form and put focus on the vote. */
  function goToForm() {
    if (S.pane === 'statement') setPane('split');
    var radio = els.form.querySelector('input[name="tour-vote"]:checked') || els.form.querySelector('input[name="tour-vote"]');
    var smooth = WT.reducedMotion() ? 'auto' : 'smooth';
    if (win.getComputedStyle(els.scroll).overflowY === 'auto') {
      var top = els.view.getBoundingClientRect().top - els.scroll.getBoundingClientRect().top + els.scroll.scrollTop - 12;
      els.scroll.scrollTo({ top: Math.max(0, top), behavior: smooth });
    } else {
      // Short screens: the page scrolls as a whole.
      var y = els.view.getBoundingClientRect().top + win.scrollY - (parseFloat(win.getComputedStyle(doc.documentElement).scrollPaddingTop) || 80);
      win.scrollTo({ top: Math.max(0, y), behavior: smooth });
    }
    if (radio) radio.focus({ preventScroll: true });
  }

  function setNote(text) {
    var note = els.content && els.content.querySelector('[data-tour="note"]');
    if (!note) return;
    if (!text) {
      note.innerHTML = '';
      note.classList.remove('is-shown');
      return;
    }
    note.classList.add('is-shown');
    note.innerHTML = WT.ui.notice({ kind: 'info', compact: true, html: text, role: 'none' });
  }
  function failText(id) {
    var st = stepFor(id);
    return WT.esc(FAIL_TEXT) + (st && st.tryIt ? ' <strong>Try it:</strong> ' + rich(st.tryIt) : '');
  }

  function updateNav(id) {
    var i = WT.featureIndex(id);
    var last = i >= WT.features.length - 1;
    els.prev.disabled = i <= 0;
    els.nextLabel.textContent = last ? 'Finish and see results' : 'Next';
    els.next.classList.toggle('is-finish', last);
    els.next.removeAttribute('aria-busy');
    S.finishing = false;
  }

  /* ---- Autosave status (visual only; WT.announce speaks what matters) ---- */
  var SAVE_ICON = { saving: 'refresh', saved: 'check-circle', error: 'alert', idle: 'info' };
  function setSave(kind, text) {
    if (!els.save) return;
    els.retry.hidden = kind !== 'error';
    if (els.save.getAttribute('data-state') === kind && els.save.textContent === text) return;
    els.save.setAttribute('data-state', kind);
    els.save.innerHTML = WT.icon(SAVE_ICON[kind] || 'info', { size: 16 }) + '<span>' + WT.esc(text) + '</span>';
  }
  function offline() {
    return win.navigator && win.navigator.onLine === false;
  }
  /** The status line from a 'saved' payload (or the current status when p is null). */
  function setSaveFrom(p) {
    if (!S.built) return; // the tour was never opened: nothing to show
    var st = WT.answers.status();
    p = p || { ok: st.ok, pending: st.pending, willRetry: st.willRetry, saving: st.saving };
    if (p.ok && Array.isArray(p.dropped) && p.dropped.length) {
      // The server refused a change (422) and the core dropped it: nothing to retry, never "Saved".
      var mine = p.dropped.indexOf(S.id) !== -1;
      setSave('error', mine ? 'Not saved: the server refused this change.' : 'A change wasn’t saved: the server refused it.');
      els.retry.hidden = true;
      S.sayOnSave = false;
      if (tourVisible()) WT.announce(mine ? 'Your change to this feature wasn’t saved: the server refused it. Please check it and try again.' : 'One of your changes wasn’t saved: the server refused it.');
      return;
    }
    var pending = p.pending != null ? p.pending : st.pending;
    // willRetry comes from the core when it knows (true only while a retry is scheduled);
    // without it, never promise an automatic retry.
    var willRetry = typeof p.willRetry === 'boolean' ? p.willRetry : st.willRetry === true;
    if (p.saving || (p.ok && pending)) return setSave('saving', 'Saving…');
    if (p.ok) {
      S.failSaid = false;
      // After "Start as a new reviewer" ({ reset: true }) nothing of this reviewer was saved yet.
      if (!p.reset && (p.savedAt || st.savedAt)) setSave('saved', 'Saved');
      else setSave('idle', 'Your answers save automatically.');
      return;
    }
    if (!pending) {
      // Nothing waiting (e.g. offline with every answer already saved).
      setSave('idle', p.offline || offline() ? 'You’re offline. Your answers will save when you’re back.' : 'Your answers save automatically.');
      return;
    }
    var text = offline() || p.offline ? 'Not saved yet: you’re offline. We’ll save when you’re back.' : willRetry ? 'Not saved yet. We’ll try again shortly.' : 'Not saved yet.';
    setSave('error', text);
    if (!S.failSaid && tourVisible()) {
      S.failSaid = true;
      S.sayOnSave = false;
      WT.announce(
        offline() || p.offline
          ? 'Your answer isn’t saved yet because you’re offline. It is kept on this device and saved when you’re back online.'
          : willRetry
            ? 'Your answer isn’t saved yet. We’ll try again automatically, or you can select Retry.'
            : 'Your answer isn’t saved. Select Retry to try again.'
      );
    }
  }

  /* ------------------------------------------------------------------ */
  /* Showing a step                                                      */
  /* ------------------------------------------------------------------ */
  function resolveId(param) {
    if (param && WT.feature(param)) return param;
    var id = param ? firstId() : resumeId();
    if (param) WT.toast('We couldn’t find that step, so here’s the first one.');
    S.pendingFocus = WT.ready === true;
    Promise.resolve().then(function () {
      WT.go('/tour/' + id, { replace: true });
    });
    return null;
  }

  function stepTitle(f) {
    return 'Step ' + (f.index + 1) + ': ' + f.title + ' · Walkthrough';
  }

  function showStep(id, opts) {
    opts = opts || {};
    var f = WT.feature(id);
    if (!f) return;
    S.id = id;
    S.stepAt = now();
    S.wantFocus = !!opts.focus;
    WT.reviewer.setLastStep(id);
    WT.render(els.content, contentHtml(id));
    WT.render(els.more, moreHtml(id));
    renderForm(id);
    updateNav(id);
    els.scroll.scrollTop = 0;
    WT.setTitle(stepTitle(f));
    S.lastFocus = null;
    if (opts.focus) {
      focusTitle();
      S.lastFocus = title();
    }
    activate(id);
  }

  function go(delta) {
    var i = WT.featureIndex(S.id);
    if (i < 0) return;
    var j = i + delta;
    if (j < 0) return;
    if (j >= WT.features.length) return finishTour();
    WT.go('/tour/' + WT.features[j].id);
  }

  /** "Finish and see results": send what is queued first, so the results include it (at most 3 s). */
  function finishTour() {
    if (S.finishing) return;
    S.finishing = true;
    els.next.setAttribute('aria-busy', 'true');
    els.nextLabel.textContent = 'Saving your answers…';
    WT.announce('Saving your answers…');
    var done = false;
    var leave = function () {
      if (done) return;
      done = true;
      clearTimeout(guard);
      S.finishing = false;
      els.next.removeAttribute('aria-busy');
      if (S.id) updateNav(S.id);
      if (tourVisible()) WT.go('/results');
    };
    var guard = setTimeout(leave, FINISH_GUARD_MS);
    var p;
    try {
      p = WT.answers.flush();
    } catch (e) {
      p = null;
    }
    Promise.resolve(p).then(leave, leave);
  }

  function restart(trigger) {
    WT.dialog
      .confirm({
        title: 'Restart the walkthrough?',
        body: 'You’ll go back to step 1. Your answers are kept, and you can change them at any time.',
        confirmLabel: 'Restart',
        cancelLabel: 'Stay here',
        trigger: trigger
      })
      .then(function (yes) {
        if (!yes) return;
        var first = firstId();
        if (S.id === first) showStep(first, { focus: true });
        else WT.go('/tour/' + first);
      });
  }

  /* ------------------------------------------------------------------ */
  /* Events                                                              */
  /* ------------------------------------------------------------------ */
  function onClick(e) {
    var paneBtn = e.target.closest('[data-pane-btn]');
    if (paneBtn && els.root.contains(paneBtn)) {
      var mode = paneBtn.getAttribute('data-pane-btn');
      setPane(S.pane === mode ? 'split' : mode);
      return;
    }
    var sum = e.target.closest('.wt-tour__why > summary');
    if (sum) {
      // Remember the visitor's own choice for the next steps.
      var det = sum.parentElement;
      setTimeout(function () {
        S.whyOpen = det.open;
      }, 0);
      return;
    }
    if (e.target.closest('[data-tour="newtab"]')) {
      syncNewTab();
      return;
    }
    var b = e.target.closest('[data-act]');
    if (!b || !els.root.contains(b) || b.disabled) return;
    switch (b.getAttribute('data-act')) {
      case 'next':
        return go(1);
      case 'prev':
        return go(-1);
      case 'restart':
        return restart(b);
      case 'steps':
        return openSteps(b);
      case 'datareq':
        return openDataReq(b);
      case 'goform':
        return goToForm();
      case 'goto':
        return goToTarget();
      case 'retry':
        setSave('saving', 'Saving…');
        S.failSaid = false;
        S.sayOnSave = true;
        WT.answers.retry();
        return;
      case 'clear':
        WT.answers.clear(S.id);
        renderForm(S.id);
        WT.announce('Your answer for this feature is cleared.');
        var first = els.form.querySelector('input[name="tour-vote"]');
        if (first) first.focus();
        return;
      case 'showit':
        return showIt();
    }
  }

  function onFormChange(e) {
    var t = e.target;
    if (!S.id || !t || !t.name) return;
    if (t.name === 'tour-vote') {
      WT.answers.set(S.id, { vote: t.value });
      relabelPriority();
      S.sayOnSave = true;
    } else if (t.name === 'tour-priority') {
      WT.answers.set(S.id, { priority: t.value });
      S.sayOnSave = true;
    }
  }
  function onFormInput(e) {
    var t = e.target;
    if (!S.id || !t) return;
    if (t.id === 'tour-reason') WT.answers.set(S.id, { reason: t.value });
    else if (t.id === 'tour-comment') WT.answers.set(S.id, { comment: t.value });
    else return;
    S.typed[t.id] = true;
  }
  /** Leaving a field the visitor changed: say "Saved" (now, or once the save lands). */
  function onFormBlur(e) {
    var t = e.target;
    if (!t || !S.typed[t.id]) return;
    delete S.typed[t.id];
    var st = WT.answers.status();
    if (st.ok && !st.pending && !st.saving) WT.announce('Saved');
    else if (st.ok || st.pending) S.sayOnSave = true;
  }

  /** Alt+→ / Alt+← (in this page or in the statement), outside text fields. */
  function onKey(e) {
    if (e.key === 'Tab') S.tabKeyAt = now();
    if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    if (!tourVisible() || isTyping(e.target) || parentModalOpen()) return;
    e.preventDefault();
    go(e.key === 'ArrowRight' ? 1 : -1);
  }

  /**
   * "Walkthrough" in the masthead (#/tour) while the tour is open: stay on the
   * step instead of adding a #/tour entry that then resolves to the same step.
   */
  function onDocClick(e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target.closest && e.target.closest('a[href="#/tour"]');
    if (!a || !S.built) return;
    var r = WT.route();
    if (!r || r.view !== 'tour' || !S.id) return;
    e.preventDefault();
    if (WT.shell && typeof WT.shell.closeMenu === 'function') WT.shell.closeMenu();
    var f = WT.feature(S.id);
    if (f) WT.setTitle(stepTitle(f));
    focusTitle();
  }

  function setDim(on) {
    S.dim = !!on;
    if (els.overlay) els.overlay.setAttribute('data-dim', on ? 'on' : 'off');
    WT.storage.set(DIM_KEY, on ? '1' : '0');
  }

  function setPane(mode) {
    S.resizing = true;
    clearTimeout(S.resizeTimer);
    S.resizeTimer = setTimeout(afterResize, 320);
    S.pane = mode;
    els.root.setAttribute('data-pane', mode);
    WT.$$('[data-pane-btn]', els.root).forEach(function (b) {
      var name = b.getAttribute('data-pane-btn');
      var on = name === mode;
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      var old = b.querySelector('.wt-icon');
      if (old) old.outerHTML = icon(on ? 'collapse' : name === 'statement' ? 'expand' : 'layers', 16);
    });
    els.stage.inert = mode === 'panel' && WT.isNarrow();
    win.requestAnimationFrame(function () {
      layoutDevice();
      kick();
      if (mode !== 'panel' && S.target && S.state === 'offscreen' && WT.driver) WT.driver.scrollToTarget(fwin(), S.target).then(kick);
    });
  }

  function showIt() {
    var hadFocus = els.edge.contains(doc.activeElement);
    var w = fwin();
    if (S.state === 'offscreen' && S.target && WT.driver) {
      WT.driver.scrollToTarget(w, S.target).then(function () {
        kick();
        if (hadFocus && (els.edge.hidden || !els.edge.contains(doc.activeElement))) focusTitle();
      });
      if (hadFocus) focusTitle();
    } else if (S.id) {
      if (hadFocus) focusTitle();
      S.stepAt = now();
      activate(S.id);
    }
  }

  /** "Go to the highlighted part": scroll the statement to it and put keyboard focus on it. */
  function goToTarget() {
    if (S.pane === 'panel') setPane('split');
    if (S.failed && S.activated === S.id) {
      WT.announce(FAIL_TEXT + ' Use the Try it steps instead.');
      return;
    }
    var el = S.target;
    var w = fwin();
    if (!el || !el.isConnected || S.activated !== S.id || !WT.driver) {
      // Lost (the visitor moved on in the statement) or still being set up: set it up, then focus it.
      S.goAfter = true;
      if (S.activated === S.id) {
        S.stepAt = now();
        activate(S.id);
      }
      return;
    }
    WT.driver.scrollToTarget(w, el).then(function () {
      kick();
      focusTarget();
    });
  }
  function focusable(el) {
    if (!el || el.hasAttribute('tabindex')) return !!el;
    return /^(A|BUTTON|INPUT|SELECT|TEXTAREA|SUMMARY|IFRAME)$/.test(el.tagName) && !el.disabled && (el.tagName !== 'A' || el.hasAttribute('href'));
  }
  function focusTarget() {
    var el = S.target;
    var w = fwin();
    if (!el || !el.isConnected || !w) return;
    if (!focusable(el)) {
      el.setAttribute('tabindex', '-1');
      S.tabbed = el;
    }
    S.frameUseAt = now() + 1500; // the visitor asked to go there: keep focus in the statement
    try {
      els.frame.focus({ preventScroll: true });
      el.focus({ preventScroll: true });
    } catch (e) {
      /* the statement is reloading */
    }
    WT.announce('Focus is on the highlighted part in the statement.');
  }
  function untab() {
    if (S.tabbed) {
      try {
        S.tabbed.removeAttribute('tabindex');
      } catch (e) {
        /* gone with an old document */
      }
      S.tabbed = null;
    }
  }

  /* ------------------------------------------------------------------ */
  /* The frame                                                           */
  /* ------------------------------------------------------------------ */
  function frameReady() {
    var w = fwin();
    if (!w || !WT.driver) return Promise.resolve(null);
    return WT.driver.ready(w, 15000).then(function (ok) {
      return ok ? w : null;
    });
  }

  function onFrameLoad() {
    frameReady().then(function (w) {
      if (!w) return;
      bindFrame(w);
      syncTheme();
      syncNewTab();
      els.root.classList.add('is-ready');
      kick();
    });
  }

  /** "Open in a new tab" opens the statement where the frame is now (its view and sub-route). */
  function syncNewTab() {
    if (!els.newtab) return;
    var hash = '';
    try {
      hash = (fwin() && fwin().location.hash) || '';
    } catch (e) {
      hash = '';
    }
    var href = WT.STATEMENT_TAB_URL + hash;
    if (els.newtab.getAttribute('href') !== href) els.newtab.setAttribute('href', href);
  }

  /** Listeners and observers on the statement's document (again after a reload, G12). */
  function bindFrame(w) {
    var d;
    try {
      d = w.document;
    } catch (e) {
      return;
    }
    if (!d || !d.documentElement || S.boundDoc === d) return;
    S.boundDoc = d;
    d.addEventListener('scroll', kick, { capture: true, passive: true });
    w.addEventListener('resize', onFrameResize);
    w.addEventListener('hashchange', syncNewTab);
    w.addEventListener('popstate', syncNewTab);
    d.addEventListener('keydown', onKey);
    var use = function () {
      S.frameUseAt = Math.max(S.frameUseAt, now());
    };
    d.addEventListener('pointerdown', use, true);
    d.addEventListener('keydown', use, true);
    if (S.mo) S.mo.disconnect();
    var MO = w.MutationObserver || win.MutationObserver;
    S.mo = new MO(function () {
      kick();
    });
    S.mo.observe(d.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class', 'hidden', 'open', 'style', 'aria-expanded', 'data-theme']
    });
    if (S.ro) S.ro.disconnect();
    var RO = w.ResizeObserver || win.ResizeObserver;
    S.ro = RO
      ? new RO(function () {
          kick();
        })
      : null;
    if (S.ro && S.target && S.target.ownerDocument === d) S.ro.observe(S.target);
    S.phone = WT.driver.isPhone(w);
  }

  function onFrameResize() {
    kick();
    var w = fwin();
    if (!w || !WT.driver) return;
    var phone = WT.driver.isPhone(w);
    if (S.phone === null || phone === S.phone) {
      S.phone = phone;
      return;
    }
    // The statement switched between its phone and desktop layouts: set the step up again
    // (once it has settled, and only if the layout still differs from the one the step was set up in).
    S.phone = phone;
    if (S.devTimer) return; // a view switch sets the step up again anyway
    clearTimeout(S.flipTimer);
    S.flipTimer = setTimeout(function () {
      var fw = fwin();
      if (tourVisible() && S.activated === S.id && fw && WT.driver.isPhone(fw) !== S.phoneAt) {
        S.stepAt = now();
        activate(S.id);
      }
    }, 300);
  }

  /** The theme the statement should show: the app's, or the step's own (the Dark mode step shows the other one, G17). */
  function wantedTheme(app) {
    var st = stepFor(S.id);
    if (!st || S.activated !== S.id) return app;
    var acts = (st.setup || []).filter(function (a) {
      return a && Object.prototype.hasOwnProperty.call(a, 'theme');
    });
    if (!acts.length) return app;
    var v = acts[acts.length - 1].theme;
    if (v === 'light' || v === 'dark') return v;
    return app === 'dark' ? 'light' : 'dark';
  }
  function syncTheme() {
    var app = WT.theme.effective();
    if (WT.driver) WT.driver.baseline({ theme: app });
    var w = fwin();
    var y;
    try {
      y = w && w.YES;
    } catch (e) {
      y = null;
    }
    if (!y || !y.ready || !y.theme) return;
    var want = wantedTheme(app);
    try {
      if (y.theme.effective() !== want || y.theme.get() !== want) y.theme.set(want);
    } catch (e) {
      /* the statement is reloading */
    }
  }

  /* ------------------------------------------------------------------ */
  /* Activation                                                          */
  /* ------------------------------------------------------------------ */
  function activate(id) {
    var token = ++S.token;
    var f = WT.feature(id);
    clearTimeout(S.flipTimer);
    untab();
    S.activated = '';
    S.failed = false;
    S.tween = null;
    setTarget(null);
    els.root.removeAttribute('data-activated');
    els.overlay.removeAttribute('data-anim');
    els.busy.textContent = 'Showing ' + f.title + '…';
    setState('busy');
    if (!els.edge.hidden) {
      var edgeFocus = els.edge.contains(doc.activeElement);
      els.edge.hidden = true;
      if (edgeFocus) focusTitle();
    }
    clearTimeout(S.slowTimer);
    els.overlay.classList.remove('is-slow');
    S.slowTimer = setTimeout(function () {
      if (token === S.token && S.state === 'busy') els.overlay.classList.add('is-slow');
    }, 450);
    return run(id, token).catch(function (e) {
      if (win.console) console.error('[WT] tour step failed: ' + id, e);
      if (token === S.token) finish(id, token, null);
    });
  }

  async function run(id, token) {
    var step = stepFor(id);
    var stale = function () {
      return token !== S.token;
    };
    var w = await frameReady();
    if (stale()) return;
    if (!w || !step) return finish(id, token, null);
    bindFrame(w);
    WT.driver.baseline({ theme: WT.theme.effective() });
    await WT.driver.reset(w, { top: false });
    if (stale()) return;
    var res = await WT.driver.apply(w, step);
    if (stale() || (res && res.aborted)) return;
    var el = await WT.driver.target(w, step, { timeout: 4000 });
    if (stale()) return;
    if (el) {
      await WT.driver.scrollToTarget(w, el);
      if (stale()) return;
      if (!el.isConnected) el = resolveTarget(w, step);
    }
    finish(id, token, el);
  }

  function finish(id, token, el) {
    if (token !== S.token) return;
    clearTimeout(S.slowTimer);
    els.overlay.classList.remove('is-slow');
    S.activated = id;
    S.failed = !el;
    setTarget(el);
    tagPick.spot = null; // a new target: choose the tag's place afresh
    els.tag.textContent = tagText(id);
    if (el && !WT.reducedMotion()) {
      S.tween = { t0: 0 };
      els.overlay.setAttribute('data-anim', '1');
    }
    setNote(el ? '' : failText(id));
    syncTheme();
    syncNewTab();
    var w = fwin();
    if (w && WT.driver) S.phone = S.phoneAt = WT.driver.isPhone(w);
    S.aliveUntil = now() + 900;
    S.last = '';
    S.wasVisible = !!el;
    if (el) {
      els.ring.classList.remove('is-pulse');
      void els.ring.offsetWidth; // restart the pulse
      els.ring.classList.add('is-pulse');
    }
    kick();
    els.root.setAttribute('data-activated', id);
    if (S.goAfter) {
      S.goAfter = false;
      if (el) {
        focusTarget();
        return;
      }
    }
    settleFocus(token);
  }

  /** Give focus back to the panel (or the bar) when the statement pulled it into the frame (G4). */
  function settleFocus(token) {
    var fix = function () {
      if (token !== S.token || !tourVisible() || parentModalOpen()) return;
      var a = doc.activeElement;
      var inFrame = a === els.frame;
      var lost = !a || a === doc.body || a === doc.documentElement;
      if (!inFrame && !lost) return;
      if (inFrame && S.frameUseAt > S.stepAt) return; // the visitor went into the statement
      if (lost && !S.wantFocus) return; // first load: leave focus where the browser put it
      var t = S.lastFocus;
      var ok = t && t.isConnected && els.root.contains(t) && !els.stage.contains(t) && !t.disabled && !t.closest('[hidden]');
      (ok ? t : title()).focus({ preventScroll: true });
    };
    fix();
    setTimeout(fix, 160);
    setTimeout(fix, 480);
  }

  function resolveTarget(w, step) {
    if (!w || !step || !WT.driver) return null;
    var list = WT.driver.selectors(w, step) || [];
    for (var i = 0; i < list.length; i++) {
      var el = WT.driver.firstVisible(w, list[i]);
      if (el) return el;
    }
    return null;
  }

  function setTarget(el) {
    if (S.ro) {
      try {
        S.ro.disconnect();
      } catch (e) {
        /* frame gone */
      }
    }
    S.target = el || null;
    S.clips = [];
    S.pinned = false;
    S.last = '';
    if (!el) return;
    var w = el.ownerDocument.defaultView;
    S.pinned = !!el.closest('dialog[open], #masthead, #mast-menu');
    var d = el.ownerDocument;
    for (var p = el.parentElement; p && p !== d.body && p !== d.documentElement; p = p.parentElement) {
      var cs = w.getComputedStyle(p);
      if (cs.position === 'fixed') S.pinned = true;
      if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') S.clips.push(p);
    }
    if (S.ro) {
      try {
        S.ro.observe(el);
      } catch (e) {
        /* observer from an old document */
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* Overlay: measure, draw, track                                       */
  /* ------------------------------------------------------------------ */
  function kick() {
    S.still = 0;
    if (!S.raf && S.built) S.raf = win.requestAnimationFrame(loop);
  }
  function loop(t) {
    S.raf = 0;
    if (!tourVisible()) return;
    var changed = tick(t);
    if (changed || S.tween) S.still = 0;
    else S.still++;
    if (S.still < 10 || now() < S.aliveUntil) S.raf = win.requestAnimationFrame(loop);
  }

  function tick(t) {
    if (!S.activated || S.activated !== S.id) return false;
    var g = measure(fwin());
    var f = g.f || {};
    var sig =
      g.kind + '|' + g.W + 'x' + g.H + '|' + f.x + ',' + f.y + ',' + f.s +
      (g.o ? '|' + g.o.x + ',' + g.o.y + ',' + g.o.w + ',' + g.o.h + '|' + g.clip + '|' + g.vt : '') + (g.dir || '');
    if (sig === S.last && !S.tween) return false;
    S.last = sig;
    draw(g, t || performance.now());
    return true;
  }

  function round(n) {
    return Math.round(n * 2) / 2;
  }

  /**
   * Where things are, in overlay coordinates. kind: 'on' (visible), 'off'
   * (scrolled away; dir 'above' | 'below'), 'lost' (no longer on the page),
   * 'failed' (never found) or 'none'. Statement rects (frame px) are mapped
   * through the frame's offset and scale; the padding is in overlay px.
   */
  function measure(w) {
    var W = els.wrap.clientWidth;
    var H = els.wrap.clientHeight;
    var g = { W: W, H: H, kind: 'none' };
    var d = null;
    try {
      d = w && w.document;
    } catch (e) {
      d = null;
    }
    if (!d || !d.documentElement || !WT.driver) return g;
    var f = frameGeo();
    g.f = f;
    var el = S.target;
    if (!el || !el.isConnected || el.ownerDocument !== d || !WT.driver.visible(w, el)) {
      var again = resolveTarget(w, stepFor(S.id));
      if (again !== S.target) setTarget(again);
      el = again;
    }
    if (!el) {
      g.kind = S.failed ? 'failed' : 'lost';
      g.vt = round(f.y + (S.pinned ? 0 : WT.driver.topInset(w)) * f.s);
      return g;
    }
    var de = d.documentElement;
    var v = { l: 0, t: S.pinned ? 0 : WT.driver.topInset(w), r: de.clientWidth || f.lw, b: de.clientHeight || f.lh };
    for (var i = 0; i < S.clips.length; i++) {
      var c = S.clips[i];
      if (!c.isConnected) continue;
      var cr = c.getBoundingClientRect();
      var cs = w.getComputedStyle(c);
      // the box's padding area (inside its borders) is what it shows
      var bl = parseFloat(cs.borderLeftWidth) || 0;
      var bt = parseFloat(cs.borderTopWidth) || 0;
      v.l = Math.max(v.l, cr.left + bl);
      v.t = Math.max(v.t, cr.top + bt);
      v.r = Math.min(v.r, cr.left + bl + c.clientWidth);
      v.b = Math.min(v.b, cr.top + bt + c.clientHeight);
    }
    var r = el.getBoundingClientRect();
    var ovH = Math.min(r.bottom, v.b) - Math.max(r.top, v.t);
    var ovW = Math.min(r.right, v.r) - Math.max(r.left, v.l);
    // Into overlay px.
    var M = { l: f.x + r.left * f.s, t: f.y + r.top * f.s, r: f.x + r.right * f.s, b: f.y + r.bottom * f.s };
    var V = { l: f.x + v.l * f.s, t: f.y + v.t * f.s, r: f.x + v.r * f.s, b: f.y + v.b * f.s };
    var o = {
      l: Math.max(M.l - PAD, V.l + INSET),
      t: Math.max(M.t - PAD, V.t + INSET),
      r: Math.min(M.r + PAD, V.r - INSET),
      b: Math.min(M.b + PAD, V.b - INSET)
    };
    var off = ovH < Math.min(24, r.height / 2) || ovW < Math.min(24, r.width / 2) || o.r - o.l < 12 || o.b - o.t < 12;
    g.vt = round(V.t);
    g.vb = round(H - V.b);
    g.tr = M;
    if (off) {
      g.kind = 'off';
      g.dir = (r.top + r.bottom) / 2 < (v.t + v.b) / 2 ? 'above' : 'below';
      return g;
    }
    g.kind = 'on';
    g.o = { x: round(o.l), y: round(o.t), w: round(o.r - o.l), h: round(o.b - o.t) };
    var clip = [];
    if (M.t - PAD < V.t + INSET - 0.5) clip.push('top');
    if (M.b + PAD > V.b - INSET + 0.5) clip.push('bottom');
    if (M.l - PAD < V.l + INSET - 0.5) clip.push('left');
    if (M.r + PAD > V.r - INSET + 0.5) clip.push('right');
    g.clip = clip.join(' ');
    return g;
  }

  function setState(state) {
    if (S.state === state) return;
    S.state = state;
    els.overlay.setAttribute('data-state', state);
    if (state === 'busy') setHole(null);
  }

  function setHole(o) {
    els.hole.setAttribute('x', o ? o.x : 0);
    els.hole.setAttribute('y', o ? o.y : 0);
    els.hole.setAttribute('width', o ? Math.max(0, o.w) : 0);
    els.hole.setAttribute('height', o ? Math.max(0, o.h) : 0);
  }

  function draw(g, t) {
    var state = { on: 'shown', off: 'offscreen', lost: 'lost', failed: 'failed' }[g.kind] || 'idle';
    setState(state);
    // Remember whether the target was fully in view, until a resize starts (afterResize compares).
    if (!S.resizing && !S.devTimer) S.wasVisible = g.kind === 'on' && !/top|bottom/.test(g.clip || '');
    var ov = els.overlay;
    if (g.kind === 'on') {
      var o = g.o;
      if (S.tween) {
        if (!S.tween.t0) S.tween.t0 = t;
        var k = Math.min(1, (t - S.tween.t0) / TWEEN_MS);
        var e = 1 - Math.pow(1 - k, 3);
        var grow = (1 - e) * GROW;
        o = { x: o.x - grow, y: o.y - grow, w: o.w + 2 * grow, h: o.h + 2 * grow };
        if (k >= 1) {
          S.tween = null;
          ov.removeAttribute('data-anim');
        }
      }
      setHole(o);
      ov.style.setProperty('--x', o.x + 'px');
      ov.style.setProperty('--y', o.y + 'px');
      ov.style.setProperty('--w', o.w + 'px');
      ov.style.setProperty('--h', o.h + 'px');
      if (g.clip) els.ring.setAttribute('data-clip', g.clip);
      else els.ring.removeAttribute('data-clip');
      placeTag(o, g);
    } else {
      S.tween = null;
      ov.removeAttribute('data-anim');
    }
    var edge = g.kind === 'off' || g.kind === 'lost';
    if (edge) {
      var dir = g.kind === 'lost' ? 'above' : g.dir;
      els.edge.setAttribute('data-edge', dir);
      els.edge.setAttribute('data-kind', g.kind);
      els.edge.style.setProperty('--edge-y', (dir === 'above' ? g.vt || 0 : g.vb || 0) + 12 + 'px');
      var text = g.kind === 'lost' ? 'The highlighted part isn’t on screen' : 'Highlighted part is ' + dir;
      if (els.edgeText.textContent !== text) els.edgeText.innerHTML = icon(g.kind === 'lost' ? 'target' : dir === 'above' ? 'arrow-up' : 'arrow-down', 16) + '<span>' + WT.esc(text) + '</span>';
    }
    if (els.edge.hidden === edge) {
      var hadFocus = els.edge.contains(doc.activeElement);
      els.edge.hidden = !edge;
      if (hadFocus && !edge) focusTitle();
    }
  }

  /*
   * The tag goes where it hides the least of the statement: above the outline,
   * on its top edge (like a legend) or below it, at the left or the right end;
   * beside its top corner; or inside a corner, in that order of preference.
   * Each spot is sampled in the statement. A spot that would hide a button,
   * link or form control is used only when every spot does; after that, the
   * least text and imagery covered wins (the target's own counts double; blank
   * space and the dimmed background don't), plus the share of the target the
   * tag would hide, so a small target is never covered while there is room
   * around it. The choice is made on the settled outline and kept while it
   * tweens or scrolls (looked at again once it has been still for a moment),
   * so the tag never jumps about.
   */
  var TAG_SPOTS = [
    ['above', 'start'], ['above', 'end'],
    ['edge', 'start'], ['edge', 'end'],
    ['below', 'start'], ['below', 'end'],
    ['beside', 'start'], ['beside', 'end'],
    ['inside', 'start'], ['inside', 'end'],
    ['inside-bottom', 'start'], ['inside-bottom', 'end']
  ];
  var tagPick = { sig: '', spot: null, at: 0, timer: 0 };

  function tagSpot(spot, o, g, tw, th) {
    var where = spot[0];
    if (where === 'beside') return { x: spot[1] === 'end' ? o.x + o.w + 6 : o.x - tw - 6, y: o.y + 6 };
    var inset = where === 'inside' || where === 'inside-bottom' ? 10 : 6;
    var x = spot[1] === 'end' ? o.x + o.w - tw - inset : o.x + inset;
    x = Math.max(8, Math.min(x, g.W - tw - 8));
    var y = where === 'above' ? o.y - th - 6 : where === 'edge' ? o.y - Math.round(th / 2) : where === 'below' ? o.y + o.h + 6 : where === 'inside' ? o.y + 10 : o.y + o.h - th - 10;
    return { x: x, y: y };
  }

  function near(r, x, y) {
    return x >= r.left - 2 && x <= r.right + 2 && y >= r.top - 2 && y <= r.bottom + 2;
  }
  /** Text or an icon at (x, y): the element's own text, or anything inside a control (icons there often ignore the pointer). */
  function inkAt(d, el, x, y, deep) {
    var range = d.createRange();
    var texts = [];
    if (deep) {
      var walker = d.createTreeWalker(el, 4); // NodeFilter.SHOW_TEXT
      for (var t = walker.nextNode(); t && texts.length < 40; t = walker.nextNode()) texts.push(t);
    } else {
      for (var n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 3) texts.push(n);
    }
    for (var i = 0; i < texts.length; i++) {
      if (!/\S/.test(texts[i].nodeValue)) continue;
      range.selectNodeContents(texts[i]);
      var rects = range.getClientRects();
      for (var j = 0; j < rects.length; j++) if (near(rects[j], x, y)) return true;
    }
    if (deep) {
      var icons = el.querySelectorAll('svg, img');
      for (var k = 0; k < icons.length && k < 10; k++) if (near(icons[k].getBoundingClientRect(), x, y)) return true;
    }
    return false;
  }

  var CONTROLS = 'button, a[href], summary, input, select, textarea, [role="button"], [role="tab"], [role="switch"], [role="option"]';
  /** What the statement shows at (x, y), in overlay coordinates: null, or { weight, control }. */
  function contentAt(d, f, x, y) {
    var fx = (x - f.x) / f.s;
    var fy = (y - f.y) / f.s;
    if (fx < 0 || fy < 0 || fx >= f.lw || fy >= f.lh) return null;
    var el = null;
    try {
      el = d.elementFromPoint(fx, fy);
    } catch (e) {
      return null;
    }
    if (!el || el === d.body || el === d.documentElement) return null;
    var control = el.closest(CONTROLS);
    var field = control && /^(INPUT|SELECT|TEXTAREA)$/.test(control.tagName);
    var hit = field || !!el.closest('img, svg, canvas, video') || inkAt(d, control || el, fx, fy, !!control);
    if (!hit) return null;
    return { weight: S.target && S.target.contains(el) ? 2 : 1, control: control };
  }

  function scoreTag(d, f, p, tw, th, tr) {
    var s = 0;
    var controls = [];
    var cols = Math.max(5, Math.ceil((tw - 8) / 12) + 1); // every ~12px, so small icons are found
    for (var row = 0; row < 3; row++) {
      for (var col = 0; col < cols; col++) {
        var c = contentAt(d, f, p.x + 4 + ((tw - 8) * col) / (cols - 1), p.y + th * (0.2 + 0.3 * row));
        if (!c) continue;
        s += c.weight;
        if (c.control && controls.indexOf(c.control) === -1) controls.push(c.control);
      }
    }
    s += 1000 * controls.length; // hiding a control loses to any spot that hides none
    if (tr) {
      var w = Math.min(p.x + tw, tr.r) - Math.max(p.x, tr.l);
      var h = Math.min(p.y + th, tr.b) - Math.max(p.y, tr.t);
      if (w > 0 && h > 0) s += (10 * w * h) / (tw * th);
    }
    return s;
  }

  function placeTag(o, g) {
    var tag = els.tag;
    var tw = tag.offsetWidth;
    var th = tag.offsetHeight;
    var f = g.f;
    var top = f.y + 4; // the tag may sit over the statement's (dimmed) sticky masthead
    var bottom = g.H - (g.vb || 0) - 4;
    var fits = function (p) {
      return p.y >= top && p.y + th <= bottom && p.x >= 4 && p.x + tw <= g.W - 4;
    };
    // Choose on the settled outline (g.o), then place relative to the drawn one (o).
    var sig = [g.o.x, g.o.y, g.o.w, g.o.h, g.W, g.H, g.vb, tw, th, f.s].join(',');
    var due = tagPick.sig !== sig || !tagPick.spot;
    if (due && tagPick.spot && now() - tagPick.at < 150) {
      // Moving (scroll, resize): keep the spot for now and look again once it settles.
      due = false;
      clearTimeout(tagPick.timer);
      tagPick.timer = setTimeout(function () {
        S.last = '';
        kick();
      }, 160);
    }
    if (due) {
      var d = null;
      try {
        d = fwin() && fwin().document;
      } catch (e) {
        d = null;
      }
      var tr = g.tr ? { l: g.tr.l, t: g.tr.t, r: g.tr.r, b: g.tr.b } : null;
      var best = null;
      var bestScore = Infinity;
      for (var i = 0; i < TAG_SPOTS.length; i++) {
        var p = tagSpot(TAG_SPOTS[i], g.o, g, tw, th);
        if (!fits(p)) continue;
        var sc = d ? scoreTag(d, f, p, tw, th, tr) : 0;
        if (sc < bestScore) {
          best = TAG_SPOTS[i];
          bestScore = sc;
        }
        if (sc < 0.5) break;
      }
      tagPick.sig = sig;
      tagPick.at = now();
      tagPick.spot = best || ['inside', 'start'];
    }
    var pos = tagSpot(tagPick.spot, o, g, tw, th);
    pos.y = Math.max(top, Math.min(pos.y, bottom - th));
    pos.x = Math.max(4, Math.min(pos.x, g.W - tw - 4));
    els.overlay.style.setProperty('--tx', Math.round(pos.x) + 'px');
    els.overlay.style.setProperty('--ty', Math.round(pos.y) + 'px');
    els.overlay.style.setProperty('--tmax', Math.max(80, g.W - 16) + 'px');
    tag.setAttribute('data-where', tagPick.spot[0] + ' ' + tagPick.spot[1]);
  }

  /* ------------------------------------------------------------------ */
  /* All steps                                                           */
  /* ------------------------------------------------------------------ */
  function buildStepsDlg() {
    stepsDlg = WT.dialog.create({
      id: 'tour-steps',
      title: 'All steps',
      wide: true,
      body:
        '<p class="wt-steplist__brand" data-brand-notice="compact">' + icon('info', 16) + '<span>' + BRAND_TEXT + '</span></p>' +
        '<div data-tour="steplist"></div>'
    });
    stepsDlg.classList.add('wt-tour-steps');
    stepsDlg.addEventListener('click', function (e) {
      var a = e.target.closest('a[data-goto]');
      if (!a || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      var id = a.getAttribute('data-goto');
      WT.dialog.setReturn(stepsDlg, null);
      WT.dialog.close(stepsDlg, 'goto');
      if (id === S.id) focusTitle();
      else WT.go('/tour/' + id);
    });
    // Screenshots that are missing show a placeholder instead of a broken image.
    stepsDlg.addEventListener(
      'error',
      function (e) {
        var img = e.target;
        if (img && img.tagName === 'IMG') {
          var box = img.closest('.wt-steplist__thumb');
          if (box) box.classList.add('is-missing');
        }
      },
      true
    );
  }

  function stateBadge(a) {
    if (a && a.vote === 'include') return WT.ui.badge('include', 'Include', 'check');
    if (a && a.vote === 'exclude') return WT.ui.badge('exclude', 'Exclude', 'x');
    if (a) return WT.ui.badge('neutral', 'Answered', 'comment');
    return WT.ui.badge('none', 'Not answered', 'minus');
  }

  function stepListHtml() {
    var answers = WT.answers.all();
    var stats = WT.answers.stats();
    var items = WT.features
      .map(function (f) {
        var cur = f.id === S.id;
        var a = answers[f.id];
        return (
          '<li>' +
            '<a class="wt-steplist__item' + (cur ? ' is-current' : '') + '" href="#/tour/' + encodeURIComponent(f.id) + '" data-goto="' + WT.esc(f.id) + '" data-fk="steplist-' + WT.esc(f.id) + '"' + (cur ? ' aria-current="step"' : '') + '>' +
              '<span class="wt-steplist__thumb">' +
                '<img src="' + WT.esc(WT.shot(f.id, true)) + '" alt="" width="160" height="100" loading="lazy" decoding="async" />' +
                icon('image', 22, 'wt-steplist__ph') +
              '</span>' +
              '<span class="wt-steplist__text">' +
                '<span class="wt-steplist__top"><span class="wt-steplist__n"><span class="wt-sr-only">Step </span>' + (f.index + 1) + '</span>' +
                '<span class="wt-steplist__section"><span class="wt-sr-only">, </span>' + WT.esc(WT.sectionLabel(f.section)) + '</span></span>' +
                '<span class="wt-steplist__title"><span class="wt-sr-only">: </span>' + WT.esc(f.title) + '</span>' +
                '<span class="wt-steplist__state"><span class="wt-sr-only">, </span>' + stateBadge(a) + (cur ? '<span class="wt-steplist__here">You’re here</span>' : '') + '</span>' +
              '</span>' +
            '</a>' +
          '</li>'
        );
      })
      .join('');
    return (
      '<p class="wt-steplist__summary">' +
        '<span>You’ve answered <strong>' + stats.answered + ' of ' + stats.total + '</strong> features.</span> ' +
        '<span class="wt-steplist__counts">' + WT.ui.badge('include', stats.include + ' included', 'check') + ' ' + WT.ui.badge('exclude', stats.exclude + ' excluded', 'x') + '</span>' +
      '</p>' +
      '<ol class="wt-steplist" role="list">' + items + '</ol>'
    );
  }

  function renderStepList() {
    if (!stepsDlg) return;
    WT.render(stepsDlg.querySelector('[data-tour="steplist"]'), stepListHtml());
  }

  function openSteps(trigger) {
    if (!stepsDlg) buildStepsDlg();
    renderStepList();
    var cur = stepsDlg.querySelector('[aria-current="step"]');
    WT.dialog.open(stepsDlg, { trigger: trigger, initialFocus: cur, lightDismiss: true });
    if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest' });
  }

  /* ------------------------------------------------------------------ */
  /* Data requirements                                                   */
  /* ------------------------------------------------------------------ */
  function buildDrDlg() {
    drDlg = WT.dialog.create({
      id: 'tour-datareq',
      title: 'Data requirements',
      wide: true,
      body: '<div data-tour="dr"></div>',
      foot:
        '<a class="wt-btn wt-btn--secondary" data-tour="dr-link" href="#/data">' + icon('braces') + '<span>Open the Data requirements page</span></a>' +
        '<button class="wt-btn wt-btn--primary" type="button" data-wt-close="done">Done</button>'
    });
    drDlg.classList.add('wt-tour-dr');
    drDlg.addEventListener('click', function (e) {
      var a = e.target.closest('a[href^="#/"]');
      if (a && drDlg.contains(a)) {
        WT.dialog.setReturn(drDlg, null);
        WT.dialog.close(drDlg, 'link');
      }
    });
    drDlg.addEventListener('close', function () {
      if (S.drCtl && typeof S.drCtl.destroy === 'function') {
        try {
          S.drCtl.destroy();
        } catch (e) {
          /* ignore */
        }
      }
      S.drCtl = null;
    });
  }

  function fallbackFields(id) {
    var req = WT.dataReq && WT.dataReq[id];
    if (!req || !Array.isArray(req.fields)) {
      return WT.ui.notice({ kind: 'info', text: 'The data requirements for this feature aren’t available yet. Please check the Data requirements page later.' });
    }
    return (
      WT.ui.notice({ kind: 'info', compact: true, text: 'The interactive explorer isn’t available right now, so here are the fields this feature needs.' }) +
      '<ul class="wt-tour__fields" role="list">' +
      req.fields
        .map(function (fl) {
          return (
            '<li class="wt-tour__field">' +
              '<code class="wt-tour__fpath">' + WT.esc(fl.path) + '</code>' +
              '<span class="wt-tour__ftype">' + WT.esc(fl.type) + '</span>' +
              (fl.required ? WT.ui.badge('neutral', 'Required') : '<span class="wt-tour__fopt">Optional</span>') +
              (fl.description ? '<span class="wt-tour__fdesc">' + WT.esc(fl.description) + '</span>' : '') +
            '</li>'
          );
        })
        .join('') +
      '</ul>'
    );
  }

  function openDataReq(trigger) {
    var id = S.id;
    var f = WT.feature(id);
    if (!f) return;
    if (!drDlg) buildDrDlg();
    drDlg.querySelector('.wt-dialog__title').textContent = 'Data requirements: ' + f.title;
    drDlg.querySelector('[data-tour="dr-link"]').setAttribute('href', '#/data/' + encodeURIComponent(id));
    var req = WT.dataReq && WT.dataReq[id];
    var box = drDlg.querySelector('[data-tour="dr"]');
    box.innerHTML = (req && req.summary ? '<p class="wt-dialog__text wt-tour__dr-summary">' + WT.esc(req.summary) + '</p>' : '') + '<div class="wt-tour__dr"></div>';
    var host = box.querySelector('.wt-tour__dr');
    var mounted = false;
    if (WT.json && typeof WT.json.mount === 'function') {
      try {
        S.drCtl = WT.json.mount(host, { features: [id] }) || null;
        mounted = true;
      } catch (e) {
        if (win.console) console.error('[WT] data explorer failed', e);
        host.innerHTML = '';
      }
    }
    if (!mounted) host.innerHTML = fallbackFields(id);
    WT.dialog.open(drDlg, { trigger: trigger });
  }

  /* ------------------------------------------------------------------ */
  /* Registration                                                        */
  /* ------------------------------------------------------------------ */
  WT.tour = {
    current: function () {
      return S.id;
    },
    frame: function () {
      return els.frame || null;
    },
    target: function () {
      return S.target;
    },
    /** 'mobile' | 'tablet' | 'desktop' */
    device: function () {
      return S.device;
    },
    /** The frame's current scale (1 = actual size). */
    scale: function () {
      return S.geo ? S.geo.s : 1;
    }
  };

  WT.register({
    name: 'tour',
    view: 'tour',
    manageFocus: true,
    keepScroll: true,
    init: function () {
      doc.addEventListener('keydown', onKey);
      doc.addEventListener('click', onDocClick, true);
      WT.on('theme', syncTheme);
      WT.on('answers', function (fid, detail) {
        if (!S.built || !S.id) return;
        // A change this tab's form made needs no re-render. Anything else (another
        // tab, the server, a reset; or an older core that says null) updates the
        // form in place, leaving the field the visitor is typing in alone.
        var remote = detail ? detail.source === 'remote' || detail.reset || fid === null : fid === null;
        var ids = detail && Array.isArray(detail.ids) ? detail.ids : null;
        var mine = fid === S.id || fid === null || !ids || ids.indexOf(S.id) !== -1;
        if (remote && mine) syncForm(S.id);
        else {
          updateClear();
          renderChip();
        }
        if (stepsDlg && stepsDlg.open) renderStepList();
      });
      WT.on('saving', function () {
        setSave('saving', 'Saving…');
      });
      WT.on('saved', function (p) {
        p = p || {};
        setSaveFrom(p);
        if (p.reset) S.sayOnSave = false;
        if (p.ok && !p.pending && S.sayOnSave) {
          S.sayOnSave = false;
          WT.announce('Saved');
        }
      });
    },
    render: function (param) {
      if (!S.built) build(doc.getElementById('view-tour'));
      else layoutDevice();
      var id = resolveId(param);
      if (!id) return;
      showStep(id, { focus: WT.ready === true });
    },
    onRoute: function (param) {
      var id = resolveId(param);
      if (!id) return;
      var focus = S.pendingFocus === null ? true : S.pendingFocus;
      S.pendingFocus = null;
      if (id === S.id && S.built && els.content.querySelector('h1')) {
        // e.g. #/tour resolved to the step already open: keep the statement as it is
        WT.setTitle(stepTitle(WT.feature(id)));
        if (focus) focusTitle();
        return;
      }
      showStep(id, { focus: focus });
    },
    leave: function () {
      S.token++;
      S.activated = '';
      clearTimeout(S.slowTimer);
      clearTimeout(S.flipTimer);
      clearTimeout(S.devTimer);
      S.devTimer = 0;
      untab();
      if (S.raf) win.cancelAnimationFrame(S.raf);
      S.raf = 0;
      if (els.overlay) setState('idle');
      if (els.edge) els.edge.hidden = true;
      // Open dialogs (All steps, data requirements) are closed by the router (00-core).
      // Never leave the video talking behind another page.
      try {
        var y = fwin() && fwin().YES;
        if (y && y.overview && y.overview.video && y.overview.video.state().playing) y.overview.video.pause();
      } catch (e) {
        /* ignore */
      }
    }
  });
})(window.WT = window.WT || {});
