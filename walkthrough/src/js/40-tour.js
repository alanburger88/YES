/*
 * 40-tour.js — the guided walkthrough (#/tour/<featureId>). SPEC section 5.
 * Owner: tour.
 *
 * Layout: the panel (step text, "Your view", sticky navigation) and the live
 * statement in a same-origin frame, with a highlight overlay drawn in THIS page
 * over the frame. The DOM is built once; changing step never reloads the frame
 * (the router calls onRoute), it re-renders the panel and re-activates:
 *
 *   driver.reset → driver.apply → driver.target → driver.scrollToTarget → draw
 *
 * Every activation carries a token, so a newer step change cancels an older
 * one at its next await (and driver.reset() aborts a running apply()). After
 * activation, focus goes back to the step h1 when the statement pulled it into
 * the frame (STATEMENT-MAP G4), unless the visitor went into the statement.
 *
 * Overlay: an SVG spotlight (dim with a rounded cut-out, padding 8, radius 12),
 * a 3px --spot outline with an inner contrast ring and a "k · Title" tag. It is
 * aria-hidden and pointer-events: none, so the statement stays usable. It is
 * tracked with requestAnimationFrame while anything moves (frame scroll, frame
 * and target resize, DOM mutations that may replace the target), then idles.
 * When the target is scrolled away, an edge indicator offers "Show it".
 *
 * WT.tour (read-only helpers, used by tests): { current(), frame(), target() }
 */
(function (WT) {
  'use strict';

  var doc = document;
  var win = window;

  var PAD = 8; // spotlight padding around the target
  var RADIUS = 12;
  var INSET = 2; // keeps the outline inside the frame when the target is clipped
  var GROW = 22; // the outline settles onto the target from this much larger
  var TWEEN_MS = 320;
  var DIM_KEY = 'infoslips.wt.tour.dim';
  var FAIL_TEXT = 'We couldn’t highlight this part automatically.';

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
    drCtl: null
  };
  var stepsDlg = null;
  var drDlg = null;

  /* ------------------------------------------------------------------ */
  /* Small helpers                                                       */
  /* ------------------------------------------------------------------ */
  function icon(name, size, cls) {
    return WT.icon(name, { size: size || 18, cls: cls });
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

  /* ------------------------------------------------------------------ */
  /* Layout (built once)                                                 */
  /* ------------------------------------------------------------------ */
  function layoutHtml() {
    return (
      '<div class="wt-tour" data-pane="split">' +
        /* Panel: first in the DOM, so the step heading leads the reading and tab order. */
        '<div class="wt-tour__panel wt-fill">' +
          '<div class="wt-tour__scroll" data-tour="scroll">' +
            '<div class="wt-tour__content" data-tour="content"></div>' +
            '<div class="wt-card wt-tour__view">' +
              '<fieldset class="wt-fieldset wt-tour__fieldset">' +
                '<legend class="wt-tour__legend"><h2 class="wt-tour__view-h">Your view</h2></legend>' +
                '<p class="wt-hint wt-tour__view-hint">Saved as you go. Everyone with the link can see your answers.</p>' +
                '<div class="wt-tour__form" data-tour="form"></div>' +
              '</fieldset>' +
              '<div class="wt-tour__savebar">' +
                '<p class="wt-status wt-tour__status" data-tour="save" role="status" aria-live="polite" aria-atomic="true"></p>' +
                '<button class="wt-btn wt-btn--secondary wt-btn--sm" type="button" data-act="retry" hidden>' + icon('refresh', 16) + '<span>Retry</span></button>' +
                '<button class="wt-btn wt-btn--link wt-tour__clear" type="button" data-act="clear" hidden>Clear my answer</button>' +
              '</div>' +
            '</div>' +
            '<p class="wt-tour__keys">' + icon('keyboard', 18) +
              '<span>Keyboard: <kbd>Alt</kbd> + <kbd aria-label="Right arrow">→</kbd> next step, <kbd>Alt</kbd> + <kbd aria-label="Left arrow">←</kbd> previous step, when you’re not typing in a field.</span></p>' +
          '</div>' +
          '<nav class="wt-tour__nav" aria-label="Walkthrough steps">' +
            '<button class="wt-btn wt-btn--ghost wt-btn--sm wt-tour__tool wt-tour__tool--steps" type="button" data-act="steps" aria-haspopup="dialog" title="All steps">' + icon('list') + '<span class="wt-tour__tool-label">All steps</span></button>' +
            '<button class="wt-btn wt-btn--ghost wt-btn--sm wt-tour__tool wt-tour__tool--restart" type="button" data-act="restart" aria-haspopup="dialog" title="Restart">' + icon('restart') + '<span class="wt-tour__tool-label">Restart</span></button>' +
            '<button class="wt-btn wt-btn--secondary wt-tour__prev" type="button" data-act="prev">' + icon('arrow-left') + '<span>Back</span></button>' +
            '<button class="wt-btn wt-btn--primary wt-tour__next" type="button" data-act="next"><span data-tour="next-label">Next</span>' + icon('arrow-right') + '</button>' +
          '</nav>' +
        '</div>' +

        /* Bar: above the frame on wider screens, between frame and panel on phones. */
        '<div class="wt-tour__bar">' +
          '<p class="wt-tour__bar-label">' + icon('eye', 18) +
            '<span><strong>Interactive statement</strong><span class="wt-tour__bar-hint"> · Click around freely. It doesn’t change your answers.</span></span></p>' +
          '<div class="wt-tour__panes" role="group" aria-label="Screen space">' +
            '<button class="wt-chip wt-tour__pane" type="button" data-pane-btn="statement" aria-pressed="false" aria-label="Show statement">' + icon('expand', 16) + '<span>Statement</span></button>' +
            '<button class="wt-chip wt-tour__pane" type="button" data-pane-btn="panel" aria-pressed="false" aria-label="Show panel">' + icon('layers', 16) + '<span>Panel</span></button>' +
          '</div>' +
          '<div class="wt-tour__dim">' + WT.ui.switch({ id: 'tour-dim', label: 'Dim the rest', checked: S.dim }) + '</div>' +
        '</div>' +

        /* Stage: the statement, the overlay over it, and the edge indicator. */
        '<div class="wt-tour__stage">' +
          '<div class="wt-tour__frame-wrap" data-tour="wrap">' +
            '<iframe id="wt-frame" class="wt-tour__frame" src="statement/index.html" title="YES statement (interactive demo)"></iframe>' +
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
    section.innerHTML = layoutHtml();
    var q = function (sel) {
      return section.querySelector(sel);
    };
    els.section = section;
    els.root = q('.wt-tour');
    els.panel = q('.wt-tour__panel');
    els.scroll = q('[data-tour="scroll"]');
    els.content = q('[data-tour="content"]');
    els.form = q('[data-tour="form"]');
    els.save = q('[data-tour="save"]');
    els.retry = q('[data-act="retry"]');
    els.clear = q('[data-act="clear"]');
    els.prev = q('[data-act="prev"]');
    els.next = q('[data-act="next"]');
    els.nextLabel = q('[data-tour="next-label"]');
    els.bar = q('.wt-tour__bar');
    els.stage = q('.wt-tour__stage');
    els.wrap = q('[data-tour="wrap"]');
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

    els.root.addEventListener('click', onClick);
    els.panel.addEventListener('change', onFormChange);
    els.panel.addEventListener('input', onFormInput);
    els.panel.addEventListener('focusin', function (e) {
      S.lastFocus = e.target;
    });
    els.dim.addEventListener('change', function () {
      setDim(els.dim.checked);
      WT.announce(els.dim.checked ? 'The rest of the statement is dimmed' : 'Dimming is off');
    });
    els.frame.addEventListener('load', onFrameLoad);
    if (win.ResizeObserver) new ResizeObserver(kick).observe(els.wrap);
    win.addEventListener('resize', kick);
    // Focus moving into the frame right after a Tab is the visitor's own choice.
    win.addEventListener('blur', function () {
      if (now() - S.tabKeyAt < 200) S.frameUseAt = now();
    });
    if (win.matchMedia) {
      var mq = win.matchMedia('(max-width: 719.98px)');
      var onMq = function () {
        if (!mq.matches && S.pane !== 'split') setPane('split');
      };
      if (mq.addEventListener) mq.addEventListener('change', onMq);
      else if (mq.addListener) mq.addListener(onMq);
    }
    setSaveFromStatus();
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

  function contentHtml(id) {
    var f = WT.feature(id);
    var st = stepFor(id) || {};
    var k = f.index + 1;
    var n = WT.features.length;
    var yes = Array.isArray(st.valueYes) ? st.valueYes : [];
    var cust = Array.isArray(st.valueCustomer) ? st.valueCustomer : [];
    var values =
      yes.length || cust.length
        ? '<div class="wt-card wt-card--flat wt-tour__values">' +
            (yes.length
              ? '<section class="wt-tour__value" aria-labelledby="tour-yes-h"><h2 class="wt-tour__h" id="tour-yes-h">' + icon('flag', 16) + '<span>Value for YES</span></h2>' + listHtml(yes) + '</section>'
              : '') +
            (cust.length
              ? '<section class="wt-tour__value" aria-labelledby="tour-cust-h"><h2 class="wt-tour__h" id="tour-cust-h">' + icon('users', 16) + '<span>Value for your customers</span></h2>' + listHtml(cust) + '</section>'
              : '') +
          '</div>'
        : '';
    return (
      '<header class="wt-tour__head">' +
        '<div class="wt-tour__meta">' +
          '<span class="wt-tour__section">' + WT.esc(WT.sectionLabel(f.section)) + '</span>' +
          '<span class="wt-tour__count wt-num" id="tour-count">Step ' + k + ' of ' + n + '</span>' +
        '</div>' +
        '<progress class="wt-progress__bar wt-tour__progress" max="' + n + '" value="' + k + '" aria-labelledby="tour-count"></progress>' +
        '<h1 class="wt-title wt-tour__title" id="tour-title" tabindex="-1" data-fk="h1">' + WT.esc(f.title) + '</h1>' +
      '</header>' +
      '<div class="wt-tour__note" data-tour="note" role="status" aria-live="polite"></div>' +
      '<section class="wt-tour__sec" aria-labelledby="tour-what-h">' +
        '<h2 class="wt-tour__h" id="tour-what-h">What it is</h2>' +
        '<p class="wt-tour__what">' + rich(st.what || f.short) + '</p>' +
      '</section>' +
      values +
      (st.tryIt
        ? '<section class="wt-band wt-tour__try" aria-labelledby="tour-try-h">' +
            '<h2 class="wt-tour__h" id="tour-try-h">' + icon('target', 16) + '<span>Try it</span></h2>' +
            '<p>' + rich(st.tryIt) + '</p>' +
          '</section>'
        : '') +
      '<div class="wt-tour__actions">' +
        '<button class="wt-btn wt-btn--secondary wt-btn--sm" type="button" data-act="datareq" aria-haspopup="dialog">' + icon('braces') + '<span>View data requirements</span></button>' +
      '</div>' +
      WT.brandNotice({ compact: true })
    );
  }

  function formHtml(id) {
    var a = WT.answers.get(id) || {};
    return (
      WT.ui.voteGroup({ name: 'tour-vote', id: 'tour-vote', fk: 'tour-vote', value: a.vote }) +
      WT.ui.field({ id: 'tour-reason', label: 'Why?', optional: true, multiline: true, rows: 3, max: WT.LIMITS.reason, value: a.reason || '' }) +
      WT.ui.priorityGroup({ name: 'tour-priority', id: 'tour-priority', fk: 'tour-priority', value: a.priority }) +
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
    updateClear();
  }
  function updateClear() {
    if (els.clear) els.clear.hidden = !WT.answers.get(S.id);
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
  }

  /* ---- Autosave status ---- */
  var SAVE_ICON = { saving: 'refresh', saved: 'check-circle', error: 'alert', idle: 'info' };
  function setSave(kind, text) {
    if (!els.save) return;
    if (els.save.getAttribute('data-state') === kind && els.save.textContent === text) return;
    els.save.setAttribute('data-state', kind);
    els.save.innerHTML = WT.icon(SAVE_ICON[kind] || 'info', { size: 16 }) + '<span>' + WT.esc(text) + '</span>';
    els.retry.hidden = kind !== 'error';
  }
  function setSaveFromStatus() {
    var st = WT.answers.status();
    if (st.pending && !st.ok) setSave('error', 'Not saved yet — we’ll retry');
    else if (st.saving || st.pending) setSave('saving', 'Saving…');
    else if (st.savedAt) setSave('saved', 'Saved');
    else setSave('idle', 'Your answers save automatically.');
  }

  /* ------------------------------------------------------------------ */
  /* Showing a step                                                      */
  /* ------------------------------------------------------------------ */
  function resolveId(param) {
    if (param && WT.feature(param)) return param;
    var id = param ? firstId() : WT.reviewer.lastStep() || WT.answers.stats().firstUnanswered || firstId();
    if (param) WT.toast('We couldn’t find that step, so here’s the first one.');
    S.pendingFocus = WT.ready === true;
    Promise.resolve().then(function () {
      WT.go('/tour/' + id, { replace: true });
    });
    return null;
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
    renderForm(id);
    updateNav(id);
    els.scroll.scrollTop = 0;
    WT.setTitle('Step ' + (f.index + 1) + ': ' + f.title + ' · Walkthrough');
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
    if (j >= WT.features.length) {
      WT.answers.flush();
      WT.go('/results');
      return;
    }
    WT.go('/tour/' + WT.features[j].id);
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
      case 'retry':
        setSave('saving', 'Saving…');
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
    } else if (t.name === 'tour-priority') {
      WT.answers.set(S.id, { priority: t.value });
    }
  }
  function onFormInput(e) {
    var t = e.target;
    if (!S.id || !t) return;
    if (t.id === 'tour-reason') WT.answers.set(S.id, { reason: t.value });
    else if (t.id === 'tour-comment') WT.answers.set(S.id, { comment: t.value });
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

  function setDim(on) {
    S.dim = !!on;
    if (els.overlay) els.overlay.setAttribute('data-dim', on ? 'on' : 'off');
    WT.storage.set(DIM_KEY, on ? '1' : '0');
  }

  function setPane(mode) {
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
      els.root.classList.add('is-ready');
      kick();
    });
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
    d.addEventListener('keydown', onKey);
    var use = function () {
      S.frameUseAt = now();
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
    // The statement switched between its phone and desktop layouts: set the step up again.
    S.phone = phone;
    clearTimeout(S.flipTimer);
    S.flipTimer = setTimeout(function () {
      if (tourVisible() && S.activated === S.id) activate(S.id);
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
    S.activated = '';
    S.failed = false;
    S.tween = null;
    setTarget(null);
    els.root.removeAttribute('data-activated');
    els.overlay.removeAttribute('data-anim');
    els.busy.textContent = 'Showing ' + f.title + '…';
    setState('busy');
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
    var f = WT.feature(id);
    els.tag.textContent = f.index + 1 + ' · ' + f.title;
    if (el && !WT.reducedMotion()) {
      S.tween = { t0: 0 };
      els.overlay.setAttribute('data-anim', '1');
    }
    setNote(el ? '' : failText(id));
    syncTheme();
    var w = fwin();
    if (w && WT.driver) S.phone = WT.driver.isPhone(w);
    S.aliveUntil = now() + 900;
    S.last = '';
    if (el) {
      els.ring.classList.remove('is-pulse');
      void els.ring.offsetWidth; // restart the pulse
      els.ring.classList.add('is-pulse');
    }
    kick();
    els.root.setAttribute('data-activated', id);
    settleFocus(token);
  }

  /** Give focus back to the panel when the statement pulled it into the frame (G4). */
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
      var ok = t && t.isConnected && els.panel.contains(t) && !t.disabled && !t.closest('[hidden]');
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
    var sig = g.kind + '|' + g.W + 'x' + g.H + (g.o ? '|' + g.o.x + ',' + g.o.y + ',' + g.o.w + ',' + g.o.h + '|' + g.clip + '|' + g.vt : '') + (g.dir || '');
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
   * 'failed' (never found) or 'none'.
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
    var el = S.target;
    if (!el || !el.isConnected || el.ownerDocument !== d || !WT.driver.visible(w, el)) {
      var again = resolveTarget(w, stepFor(S.id));
      if (again !== S.target) setTarget(again);
      el = again;
    }
    if (!el) {
      g.kind = S.failed ? 'failed' : 'lost';
      g.vt = (S.pinned ? 0 : WT.driver.topInset(w)) + els.frame.offsetTop;
      return g;
    }
    var fr = els.frame;
    var ox = fr.offsetLeft + fr.clientLeft;
    var oy = fr.offsetTop + fr.clientTop;
    var de = d.documentElement;
    var v = { l: 0, t: S.pinned ? 0 : WT.driver.topInset(w), r: de.clientWidth || fr.clientWidth, b: de.clientHeight || fr.clientHeight };
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
    var o = {
      l: Math.max(r.left - PAD, v.l + INSET),
      t: Math.max(r.top - PAD, v.t + INSET),
      r: Math.min(r.right + PAD, v.r - INSET),
      b: Math.min(r.bottom + PAD, v.b - INSET)
    };
    var off = ovH < Math.min(24, r.height / 2) || ovW < Math.min(24, r.width / 2) || o.r - o.l < 12 || o.b - o.t < 12;
    g.vt = round(v.t + oy);
    g.vb = round(H - (v.b + oy));
    if (off) {
      g.kind = 'off';
      g.dir = (r.top + r.bottom) / 2 < (v.t + v.b) / 2 ? 'above' : 'below';
      return g;
    }
    g.kind = 'on';
    g.o = { x: round(o.l + ox), y: round(o.t + oy), w: round(o.r - o.l), h: round(o.b - o.t) };
    var clip = [];
    if (r.top - PAD < v.t + INSET - 0.5) clip.push('top');
    if (r.bottom + PAD > v.b - INSET + 0.5) clip.push('bottom');
    if (r.left - PAD < v.l + INSET - 0.5) clip.push('left');
    if (r.right + PAD > v.r - INSET + 0.5) clip.push('right');
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

  function placeTag(o, g) {
    var tag = els.tag;
    var tw = tag.offsetWidth;
    var th = tag.offsetHeight;
    var gap = 6;
    var top = els.frame.offsetTop + 4; // the tag may sit over the statement's (dimmed) sticky masthead
    var bottom = g.H - (g.vb || 0) - 4;
    var x = Math.max(8, Math.min(o.x + 6, g.W - tw - 8));
    var y = o.y - th - gap;
    var where = 'above';
    if (y < top) {
      // no room above: sit on the outline's top edge, like a legend
      y = o.y - Math.round(th / 2);
      where = 'edge';
      if (y < top) {
        y = o.y + o.h + gap;
        where = 'below';
        if (y + th > bottom) {
          y = o.y + 10;
          x = Math.max(8, Math.min(o.x + 10, g.W - tw - 8));
          where = 'inside';
        }
      }
    }
    els.overlay.style.setProperty('--tx', Math.round(x) + 'px');
    els.overlay.style.setProperty('--ty', Math.round(y) + 'px');
    els.overlay.style.setProperty('--tmax', Math.max(80, g.W - 16) + 'px');
    tag.setAttribute('data-where', where);
  }

  /* ------------------------------------------------------------------ */
  /* All steps                                                           */
  /* ------------------------------------------------------------------ */
  function buildStepsDlg() {
    stepsDlg = WT.dialog.create({
      id: 'tour-steps',
      title: 'All steps',
      wide: true,
      body: '<div data-tour="steplist"></div>'
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
    }
  };

  WT.register({
    name: 'tour',
    view: 'tour',
    manageFocus: true,
    keepScroll: true,
    init: function () {
      doc.addEventListener('keydown', onKey);
      WT.on('theme', syncTheme);
      WT.on('answers', function (fid) {
        if (!S.built || !S.id) return;
        if (fid === null) renderForm(S.id);
        else updateClear();
        if (stepsDlg && stepsDlg.open) renderStepList();
      });
      WT.on('saving', function () {
        setSave('saving', 'Saving…');
      });
      WT.on('saved', function (p) {
        p = p || {};
        if (p.ok) setSave(p.pending ? 'saving' : 'saved', p.pending ? 'Saving…' : 'Saved');
        else if (p.pending) setSave('error', 'Not saved yet — we’ll retry');
        else if (p.offline) setSave('idle', 'You’re offline. We’ll save when you’re back.');
      });
    },
    render: function (param) {
      if (!S.built) build(doc.getElementById('view-tour'));
      var id = resolveId(param);
      if (!id) return;
      showStep(id, { focus: WT.ready === true });
    },
    onRoute: function (param) {
      var id = resolveId(param);
      if (!id) return;
      var focus = S.pendingFocus === null ? true : S.pendingFocus;
      S.pendingFocus = null;
      showStep(id, { focus: focus });
    },
    leave: function () {
      S.token++;
      S.activated = '';
      clearTimeout(S.slowTimer);
      clearTimeout(S.flipTimer);
      if (S.raf) win.cancelAnimationFrame(S.raf);
      S.raf = 0;
      if (els.overlay) setState('idle');
      if (els.edge) els.edge.hidden = true;
      [stepsDlg, drDlg].forEach(function (d) {
        if (d && d.open) {
          WT.dialog.setReturn(d, null);
          WT.dialog.close(d);
        }
      });
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
