/*
 * Overview — the first screen (PRD 4 "First screen", 5.1, 5.2, 5.7 and layers
 * 1–2 of the progressive uncover).
 *
 *   1. Personal heading and the warm handshake paragraph.
 *   2. Balance card: closing balance in token units, "as of" time, an optional
 *      illustrative USD equivalent (only when rate, source and timestamp exist),
 *      the signed net change, the not-in-balance notice and a secondary
 *      statement-details panel with identifiers masked.
 *   3. The interactive balance journey (signature feature): opening → categories
 *      → closing, grouped as incoming / outgoing. Every step and group is a
 *      toggle button revealing exactly the transactions behind it, with a sum
 *      line proving the rows add up. A text equation and a table state the same
 *      arithmetic. If the statement does not reconcile, an exception replaces it.
 *   4. "Why it changed": a running-balance step chart (hover/focus layer,
 *      keyboard points, summary sentence, table view; a plain list when there is
 *      too little data), a fees summary and one data-supported insight.
 *   5. "Your statement in 60 seconds": an animated, narrated walkthrough that
 *      plays like a video (never on its own), drawn from this statement's
 *      figures, with captions, chapters and a transcript.
 *
 * Every figure comes from YES.calc over YES.data — nothing is typed in twice.
 */
(function (root) {
  'use strict';
  var YES = root.YES;
  var ui = YES.ui;
  var t = YES.t;
  var esc = ui.esc;
  var doc = root.document;

  /* Same-time chart markers (a movement and its fee) are dodged sideways by this many px. */
  var DODGE = 8;

  /* Net change uses a trend glyph: the tray arrows (arrow-in / arrow-out) mean
     "received" / "sent" for a single transaction, and a downward "received"
     arrow next to a positive change reads as a decrease. */
  ui.registerIcons({
    'trend-up': '<path d="m3 17 6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
    'trend-down': '<path d="m3 7 6 6 4-4 8 8"/><path d="M15 17h6v-6"/>',
    'trend-flat': '<path d="M3 12h18"/><path d="m16 7 5 5-5 5"/>'
  });

  /* Disclosure state survives re-renders and language switches. The selected
     journey step itself lives in the shared YES.state.journeyStep. */
  if (!YES.state.overview) YES.state.overview = { details: false, journeyTable: false, chartTable: false, transcript: false, cc: true, muted: false };

  var pendingAnim = false;
  var chart = { pts: [], xs: [], ys: [], w: 0, lastW: 0, focusIdx: 0, hover: -1 };
  var observer = null;
  /* The step selected before the latest change: lets onState keep the
     explorer's step filter in step with the journey. */
  var lastStep = YES.state.journeyStep || null;
  /* Marks the history entry pushed when a step is selected from the unselected
     journey, so Back (or Clear) returns to the full journey instead of leaving
     the statement. Unique per page load: an entry restored from an earlier
     load does not belong to this document. */
  var ENTRY = 'ov-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  /* ------------------------------------------------------------------ */
  /* Helpers                                                             */
  /* ------------------------------------------------------------------ */
  function st() {
    return YES.data.statement;
  }
  function asset() {
    return YES.calc.asset();
  }
  function sym() {
    return asset().symbol;
  }
  function num(minor) {
    return YES.fmt.number(minor);
  }
  function plain(minor) {
    return YES.fmt.amount(minor, { unit: false });
  }
  function amt(minor, sign) {
    return YES.fmt.amount(minor, { sign: sign || 'auto' });
  }
  function periodText() {
    return YES.fmt.range(st().periodStart, st().periodEnd);
  }
  function monthText() {
    return YES.fmt.date(st().periodEnd, 'monthYear');
  }
  function stamp(iso) {
    return YES.fmt.date(iso, 'datetime') + ' ' + YES.fmt.tz(iso);
  }
  function has(obj, k) {
    return Object.prototype.hasOwnProperty.call(obj, k);
  }
  function ovState() {
    return YES.state.overview || {};
  }
  function setOv(key, value) {
    var cur = ovState();
    var next = {};
    Object.keys(cur).forEach(function (k) {
      next[k] = cur[k];
    });
    next[key] = value;
    YES.set({ overview: next });
  }
  /**
   * The journey picks its layout from its own width (a container query in
   * 10-overview.css), not the viewport: the docked assistant narrows the column
   * without changing the viewport. CSS publishes the active layout as --jr-layout.
   */
  function wideJourney() {
    var jr = doc.querySelector('#ov-journey-body .jr');
    if (!jr || !root.getComputedStyle) return false;
    return root.getComputedStyle(jr).getPropertyValue('--jr-layout').trim() === 'waterfall';
  }
  /** A sentence-final value that already ends in a full stop ("Daniel K.") takes no second one. */
  function noStop(text) {
    return String(text == null ? '' : text).replace(/\.\s*$/, '');
  }
  /** A string in every shipped language ({ en, es }), for labels another module renders later. */
  function localised(key) {
    var out = {};
    YES.config.languages.forEach(function (l) {
      var table = YES.i18n.dict[l];
      if (table && table[key] != null) out[l] = table[key];
    });
    return out;
  }
  function sumOf(list) {
    var s = 0;
    for (var i = 0; i < list.length; i++) s += list[i].amount;
    return s;
  }

  /** Visual number (aria-hidden) with a spoken twin that names the unit. */
  function numHtml(minor, opts) {
    opts = opts || {};
    var sign = opts.sign || 'always';
    var visible = YES.fmt.amount(minor, { sign: sign, unit: !!opts.unit });
    var spoken = YES.fmt.amountSpoken(minor, { sign: sign === 'never' ? 'auto' : sign });
    // With a unit, the number and the unit stay whole but the unit may drop to
    // its own line (very large text), as in wrapAmountHtml.
    var cut = opts.unit ? visible.lastIndexOf('\u00a0') : -1;
    var shown = cut === -1 ? esc(visible) : '<span class="ov-amt__n">' + esc(visible.slice(0, cut)) + '</span> <span class="ov-amt__u">' + esc(visible.slice(cut + 1)) + '</span>';
    return (
      '<span class="ov-num' +
      (cut === -1 ? '' : ' ov-amt') +
      (opts.cls ? ' ' + opts.cls : '') +
      '"><span aria-hidden="true">' +
      shown +
      '</span><span class="sr-only">' +
      esc(spoken) +
      '</span></span>'
    );
  }

  /**
   * A signed amount (like ui.amountHtml) whose unit may drop to its own line:
   * the number and the unit each stay whole, and an ordinary space joins them,
   * so very large text (200%) on a phone wraps instead of scrolling sideways.
   */
  function wrapAmountHtml(minor, opts) {
    opts = opts || {};
    var sign = opts.sign || 'always';
    var text = YES.fmt.amount(minor, { sign: sign });
    var cut = text.lastIndexOf('\u00a0');
    var visible = cut === -1 ? '<span class="ov-amt__n">' + esc(text) + '</span>' : '<span class="ov-amt__n">' + esc(text.slice(0, cut)) + '</span> <span class="ov-amt__u">' + esc(text.slice(cut + 1)) + '</span>';
    return (
      '<span class="amount amount--' +
      (minor < 0 ? 'out' : minor > 0 ? 'in' : 'zero') +
      ' ov-amt"><span aria-hidden="true">' +
      visible +
      '</span><span class="sr-only">' +
      esc(YES.fmt.amountSpoken(minor, { sign: sign })) +
      '</span></span>'
    );
  }

  /**
   * The hero figure's width in em, estimated from its characters (proportional
   * figures at the hero weight; generous, so the estimate never runs short).
   * CSS caps the hero's size with it so the figure always fits its column.
   */
  function heroEm(text) {
    var em = 0;
    for (var i = 0; i < text.length; i++) {
      var c = text.charAt(i);
      em += /[0-9]/.test(c) ? 0.68 : /[.,'\u00a0\u202f\u2009 ]/.test(c) ? 0.36 : 0.84;
    }
    return Math.max(1, em).toFixed(2);
  }

  /** "—" in a table cell, with a spoken equivalent. */
  function naHtml() {
    return '<span aria-hidden="true">—</span><span class="sr-only">' + esc(t('common.none')) + '</span>';
  }

  /** Nice axis ticks (minor units) covering [lo, hi]. */
  function ticks(lo, hi, target) {
    var f = Math.pow(10, asset().precision);
    var loM = lo / f;
    var hiM = hi / f;
    if (hiM <= loM) hiM = loM + 1;
    var raw = (hiM - loM) / (target || 4);
    var mag = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
    var n = raw / mag;
    var step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
    var start = Math.floor(loM / step) * step;
    var end = Math.ceil(hiM / step) * step;
    var out = [];
    for (var k = 0; start + k * step <= end + step / 1e6; k++) out.push(Math.round((start + k * step) * f));
    return out;
  }
  function tickLabel(minor) {
    var f = Math.pow(10, asset().precision);
    return minor % f === 0 ? YES.fmt.count(minor / f) : YES.fmt.number(minor);
  }

  /* ------------------------------------------------------------------ */
  /* Selection model                                                     */
  /* ------------------------------------------------------------------ */
  /** A selectable journey step (category) or group (incoming / outgoing). */
  function selectionInfo(id) {
    if (!id || typeof id !== 'string') return null;
    var cat = YES.calc.category(id);
    if (cat) return { id: id, kind: 'step', label: t('cat.' + id), value: cat.total, txIds: cat.txIds, members: [id] };
    var groups = YES.calc.groups();
    if (has(groups, id)) {
      var g = groups[id];
      return { id: id, kind: 'group', label: t('group.' + id), value: g.total, txIds: g.txIds, members: g.categories.slice() };
    }
    return null;
  }

  /** The posted transactions behind a selection, in chronological order. */
  function rowsFor(txIds) {
    var set = {};
    txIds.forEach(function (id) {
      set[id] = true;
    });
    return YES.calc.posted().filter(function (tx) {
      return set[tx.id];
    });
  }

  /* ------------------------------------------------------------------ */
  /* 1. Heading and handshake                                            */
  /* ------------------------------------------------------------------ */
  function headerHtml() {
    var s = st();
    return (
      '<header class="ov-head">' +
      '<h1 id="h-overview" class="view-title" data-view-heading tabindex="-1" data-fk="ov-h1">' +
      esc(t('overview.title', { month: monthText() })) +
      '</h1>' +
      '<p class="ov-handshake">' +
      esc(t('overview.handshake', { name: s.customer.firstName, period: periodText() })) +
      '</p>' +
      '</header>'
    );
  }

  /* ------------------------------------------------------------------ */
  /* 2. Balance card                                                     */
  /* ------------------------------------------------------------------ */
  function fiatHtml() {
    var s = st();
    var a = asset();
    var fiatMinor = YES.calc.fiat(s.closing);
    if (fiatMinor === null || !a.fiat) return '';
    var f = a.fiat;
    return (
      '<div class="ov-fiat ov-balance__fiat">' +
      '<p class="ov-fiat__line"><span class="ov-fiat__value">≈ ' +
      esc(YES.fmt.fiat(fiatMinor, f.currency)) +
      '</span> <span class="ov-fiat__label">' +
      esc(t('overview.fiat.label', { currency: f.currency })) +
      '</span> ' +
      (f.illustrative ? ui.illustrativeTag() : '') +
      '</p>' +
      '<p class="ov-fiat__meta">' +
      esc(
        t('overview.fiat.detail', {
          symbol: a.symbol,
          rate: YES.fmt.number(Math.round(f.rateMicros / 100), 4),
          currency: f.currency,
          source: YES.L(f.source),
          date: stamp(f.at)
        })
      ) +
      '</p></div>'
    );
  }

  function changeHtml() {
    var s = st();
    var net = YES.calc.netChange();
    var dir = net < 0 ? 'out' : net > 0 ? 'in' : 'neutral';
    // Number and unit are separate boxes so the unit can drop to its own line
    // when the column is narrow, instead of running past the card's edge.
    return (
      '<div class="ov-change">' +
      '<p class="ov-change__label">' +
      esc(t('overview.balance.changeLabel')) +
      '</p>' +
      '<p class="ov-change__value"><span class="dir dir--' +
      dir +
      '">' +
      ui.icon(net < 0 ? 'trend-down' : net > 0 ? 'trend-up' : 'trend-flat', { size: 18 }) +
      '</span>' +
      '<span class="amount amount--' +
      (net < 0 ? 'out' : net > 0 ? 'in' : 'zero') +
      ' ov-change__amount"><span class="ov-change__num" aria-hidden="true">' +
      esc(YES.fmt.amount(net, { sign: 'always', unit: false })) +
      '</span> <span class="ov-change__unit" aria-hidden="true">' +
      esc(sym()) +
      '</span><span class="sr-only">' +
      esc(YES.fmt.amountSpoken(net, { sign: 'always' })) +
      '</span></span>' +
      '</p>' +
      '<p class="ov-change__text">' +
      esc(t('overview.balance.change', { opening: amt(s.opening), date: YES.fmt.date(s.periodStart, 'long') })) +
      '</p></div>'
    );
  }

  function notInBalanceHtml() {
    var list = YES.calc.notInBalance();
    if (!list.length) return '';
    var total = sumOf(list);
    var allPending = list.every(function (tx) {
      return tx.status === 'pending';
    });
    var key = 'overview.notIn.' + (allPending ? 'pending' : 'other') + (list.length === 1 ? '1' : 'N');
    var text = t(key, { n: YES.fmt.count(list.length), amount: amt(total) });
    var detail = '';
    var action;
    if (list.length === 1) {
      var tx = list[0];
      detail =
        '<p class="ov-notin__detail">' +
        ui.statusHtml(tx.status) +
        ' <span>' +
        esc(t('overview.notIn.detail', { description: YES.L(tx.description), date: YES.fmt.date(tx.initiatedAt, 'datetime') })) +
        '</span></p>';
      action =
        '<button type="button" class="btn" data-ov-tx="' +
        esc(tx.id) +
        '" data-fk="ov-notin-view">' +
        esc(t('overview.notIn.view')) +
        '</button>' +
        ui.explainButton({ topic: 'pending', id: tx.id }, t('status.notInBalance'), { fk: 'ov-notin-explain' });
    } else {
      action =
        '<button type="button" class="btn" data-ov-notin-all data-fk="ov-notin-all">' +
        esc(t('overview.notIn.viewAll')) +
        '</button>' +
        ui.explainButton({ topic: 'pending' }, t('status.notInBalance'), { fk: 'ov-notin-explain' });
    }
    return (
      '<div class="notice notice--warn ov-notin">' +
      ui.icon('clock', { size: 20 }) +
      '<div class="ov-notin__body"><p class="ov-notin__text"><strong>' +
      esc(text) +
      '</strong></p>' +
      detail +
      '<div class="ov-notin__actions">' +
      action +
      '</div></div></div>'
    );
  }

  /** A masked identifier with its "Masked" tag. The bullets are hidden from
      assistive technology, which hears "ending in 7316" instead (ui.maskedHtml). */
  function maskedValueHtml(value) {
    return (
      '<span class="mono">' +
      ui.maskedHtml(value) +
      '</span> <span class="tag ov-masked">' +
      ui.icon('lock', { size: 12 }) +
      '<span>' +
      esc(t('overview.details.masked')) +
      '</span></span>'
    );
  }

  function kvHtml(rows) {
    return (
      '<dl class="kv ov-kv">' +
      rows
        .map(function (r) {
          return '<dt>' + esc(t(r[0])) + '</dt><dd>' + r[1] + '</dd>';
        })
        .join('') +
      '</dl>'
    );
  }

  function detailsHtml() {
    var s = st();
    var a = asset();
    var open = !!ovState().details;
    var left = [
      ['overview.details.id', '<span class="mono">' + esc(s.id) + '</span>'],
      ['overview.details.version', esc(s.version)],
      ['overview.details.status', esc(t('overview.issue.' + (s.issueStatus === 'corrected' ? 'corrected' : 'original')))],
      ['overview.details.account', esc(YES.L(s.account.label))],
      ['overview.details.accountId', maskedValueHtml(s.account.maskedId)],
      ['overview.details.wallet', maskedValueHtml(s.account.walletMasked)],
      ['overview.details.asset', esc(t('overview.details.assetValue', { name: YES.L(a.name), symbol: a.symbol, precision: YES.fmt.count(a.precision) }))]
    ];
    var right = [
      ['overview.details.start', esc(YES.fmt.date(s.periodStart, 'datetime'))],
      ['overview.details.end', esc(YES.fmt.date(s.periodEnd, 'datetime'))],
      ['overview.details.asOf', esc(YES.fmt.date(s.asOf, 'datetime'))],
      ['overview.details.generated', esc(YES.fmt.date(s.generatedAt, 'datetime'))],
      ['overview.details.timezone', esc(YES.fmt.tz(s.asOf))],
      ['overview.details.dateBasis', esc(t('term.postedDate')) + '<span class="ov-kv__note">' + esc(t('term.dateBasisNote')) + '</span>']
    ];
    return (
      '<details class="disclosure ov-details" data-ov-disclosure="details"' +
      (open ? ' open' : '') +
      '>' +
      '<summary data-fk="ov-details">' +
      ui.icon('info', { size: 18 }) +
      '<span>' +
      esc(t('overview.details.summary')) +
      '</span></summary>' +
      '<div class="disclosure__body ov-details__body">' +
      '<div class="ov-details__grid">' +
      '<div><h3 class="ov-details__title">' +
      esc(t('overview.details.statement')) +
      '</h3>' +
      kvHtml(left) +
      '</div>' +
      '<div><h3 class="ov-details__title">' +
      esc(t('overview.details.dates')) +
      '</h3>' +
      kvHtml(right) +
      '</div></div>' +
      '<p class="ov-details__mask">' +
      ui.icon('lock', { size: 16 }) +
      '<span>' +
      esc(t('overview.details.maskNote')) +
      '</span></p>' +
      '</div></details>'
    );
  }

  function balanceHtml() {
    var s = st();
    var a = asset();
    var heroText = plain(s.closing);
    var hero =
      '<p class="ov-hero"><span class="ov-hero__num" aria-hidden="true" style="--ov-hero-em:' +
      esc(heroEm(heroText)) +
      '">' +
      esc(heroText) +
      '</span><span class="ov-hero__sym" aria-hidden="true">' +
      esc(a.symbol) +
      '</span><span class="sr-only">' +
      esc(YES.fmt.amountSpoken(s.closing) + ', ' + YES.L(a.unitLabel)) +
      '</span></p>';
    return (
      '<section class="card ov-balance" aria-labelledby="ov-balance-title">' +
      '<div class="ov-balance__grid">' +
      '<div class="ov-balance__main">' +
      '<h2 id="ov-balance-title" class="ov-balance__title">' +
      esc(t('term.statementBalance')) +
      '</h2>' +
      hero +
      '<p class="ov-hero__unit">' +
      esc(t('overview.balance.unitLine', { unit: YES.L(a.unitLabel), asset: YES.L(a.name) })) +
      '</p>' +
      '<p class="ov-asof">' +
      ui.icon('clock', { size: 16 }) +
      '<span>' +
      // A line may break after the "/" of "America/New_York" (very large text).
      esc(t('term.asOf', { date: stamp(s.asOf) })).replace(/\//g, '/<wbr>') +
      '</span></p>' +
      '</div>' +
      // Narrow: balance → net change → actions → USD equivalent, so the two
      // primary actions reach the first screen. Wide: the USD equivalent sits
      // under the balance and the net change and actions take the second column.
      '<div class="ov-balance__side">' +
      changeHtml() +
      '<div class="ov-actions">' +
      '<button type="button" class="btn btn--primary" data-ov-explore data-fk="ov-explore"><span>' +
      esc(t('overview.actions.explore')) +
      '</span>' +
      ui.icon('arrow-right', { size: 18 }) +
      '</button>' +
      '<button type="button" class="btn btn--ai" data-explain="balance" data-fk="ov-explain-balance" aria-label="' +
      esc(t('overview.actions.explainLabel')) +
      '">' +
      ui.icon('sparkle', { size: 18 }) +
      '<span>' +
      esc(t('overview.actions.explain')) +
      '</span></button>' +
      '</div></div>' +
      fiatHtml() +
      '</div>' +
      notInBalanceHtml() +
      detailsHtml() +
      '</section>'
    );
  }

  /* ------------------------------------------------------------------ */
  /* 3. Balance journey                                                  */
  /* ------------------------------------------------------------------ */
  function catIcon(id) {
    var cats = YES.data.categories;
    for (var i = 0; i < cats.length; i++) if (cats[i].id === id) return ui.typeIcon(cats[i].types[0]);
    return 'balance';
  }

  /** Shown only while a step or group is pressed, so selection never relies on colour. */
  var CHECK = '<span class="jr-check" aria-hidden="true">' + ui.icon('check', { size: 14 }) + '</span>';

  function stepHtml(s, col, pct, info, hasNext) {
    var total = s.kind === 'total';
    var dir = total ? 'total' : s.value < 0 ? 'out' : 'in';
    var lo = pct(Math.min(s.start, s.end));
    var hi = pct(Math.max(s.start, s.end));
    var style = '--col:' + col + ';--lo:' + lo.toFixed(3) + '%;--hi:' + hi.toFixed(3) + '%;--end:' + pct(s.end).toFixed(3) + '%';
    var cls = 'jr-step jr-step--' + dir + (total ? ' jr-step--total' : ' jr-step--delta');
    var member = !!info && info.members.indexOf(s.id) !== -1;
    if (info) cls += member ? (info.id === s.id ? ' is-selected' : ' is-member') : ' is-dim';
    var plot = '<span class="jr-plot" aria-hidden="true"><span class="jr-bar"></span>' + (hasNext ? '<span class="jr-link"></span>' : '') + '</span>';
    var label = '<span class="jr-label">' + (total ? '' : CHECK) + '<span>' + esc(t('cat.' + s.id)) + '</span></span>';
    if (total) {
      var when = s.id === 'opening' ? st().periodStart : st().periodEnd;
      return (
        '<div class="' +
        cls +
        '" data-step="' +
        esc(s.id) +
        '" data-value="' +
        s.value +
        '" style="' +
        style +
        '">' +
        plot +
        '<span class="jr-meta">' +
        label +
        '<span class="jr-value">' +
        numHtml(s.value, { sign: 'auto' }) +
        '</span><span class="jr-sub">' +
        esc(YES.fmt.date(when, 'short')) +
        '</span></span></div>'
      );
    }
    var pressed = !!info && info.id === s.id;
    return (
      '<button type="button" class="' +
      cls +
      '" data-step="' +
      esc(s.id) +
      '" data-value="' +
      s.value +
      '" data-ov-step="' +
      esc(s.id) +
      '" aria-pressed="' +
      pressed +
      '" aria-controls="ov-panel" data-fk="ov-step-' +
      esc(s.id) +
      '" style="' +
      style +
      '">' +
      plot +
      '<span class="jr-meta">' +
      label +
      '<span class="jr-value"><span class="dir dir--' +
      dir +
      ' jr-dir">' +
      ui.icon(catIcon(s.id), { size: 14 }) +
      '</span>' +
      numHtml(s.value) +
      '</span><span class="jr-sub">' +
      esc(YES.txCount(s.count)) +
      '</span><span class="sr-only">' +
      esc(t('overview.journey.subtotal', { amount: YES.fmt.amountSpoken(s.end) })) +
      '</span></span></button>'
    );
  }

  function groupHtml(gid, g, col, span, info) {
    var pressed = !!info && info.id === gid;
    var related =
      !!info &&
      (pressed ||
        info.members.some(function (m) {
          return g.categories.indexOf(m) !== -1;
        }));
    var cls = 'jr-group jr-group--' + (g.total < 0 ? 'out' : 'in') + (info && !related ? ' is-dim' : '');
    return (
      '<button type="button" class="' +
      cls +
      '" data-group="' +
      esc(gid) +
      '" data-value="' +
      g.total +
      '" data-ov-step="' +
      esc(gid) +
      '" aria-pressed="' +
      pressed +
      '" aria-controls="ov-panel" data-fk="ov-step-' +
      esc(gid) +
      '" style="--col:' +
      col +
      ';--span:' +
      span +
      '">' +
      '<span class="jr-group__text"><span class="jr-group__label">' +
      CHECK +
      '<span>' +
      esc(t('group.' + gid)) +
      '</span></span><span class="jr-group__value">' +
      numHtml(g.total) +
      '</span><span class="jr-group__count">' +
      esc(YES.txCount(g.count)) +
      '</span></span><span class="jr-group__bracket" aria-hidden="true"></span></button>'
    );
  }

  /** Steps and group buttons (plus the axis on wide screens), as items. */
  function journeyItems(info) {
    var steps = YES.calc.journey();
    var groups = YES.calc.groups();
    var lo = 0;
    var hi = 0;
    steps.forEach(function (s) {
      lo = Math.min(lo, s.start, s.end);
      hi = Math.max(hi, s.start, s.end);
    });
    var tk = ticks(lo, hi, 4);
    var dLo = tk[0];
    var dHi = tk[tk.length - 1];
    function pct(v) {
      return ((v - dLo) / (dHi - dLo)) * 100;
    }
    var items = [];
    items.push({
      id: null,
      html:
        '<div class="jr-axis" aria-hidden="true">' +
        tk
          .map(function (v) {
            return '<span class="jr-axis__tick" style="--at:' + pct(v).toFixed(3) + '%">' + esc(tickLabel(v)) + '</span>';
          })
          .join('') +
        '</div><div class="jr-grid" aria-hidden="true">' +
        tk
          .map(function (v) {
            return '<span class="jr-grid__line' + (v === 0 ? ' jr-grid__line--zero' : '') + '" style="--at:' + pct(v).toFixed(3) + '%"></span>';
          })
          .join('') +
        '</div>'
    });
    var lastGroup = null;
    steps.forEach(function (s, i) {
      var col = i + 2;
      if (s.kind === 'delta' && s.group !== lastGroup && has(groups, s.group)) {
        var span = 0;
        for (var j = i; j < steps.length && steps[j].kind === 'delta' && steps[j].group === s.group; j++) span++;
        items.push({ id: s.group, html: groupHtml(s.group, groups[s.group], col, span, info) });
        lastGroup = s.group;
      }
      items.push({ id: s.id, html: stepHtml(s, col, pct, info, i < steps.length - 1) });
    });
    return { items: items, cols: steps.length };
  }

  /** Where the transactions panel sits: below the waterfall (wide) or right after the selection (narrow). */
  function panelAnchorId(info) {
    if (!info || wideJourney()) return null;
    return info.kind === 'group' ? info.members[info.members.length - 1] : info.id;
  }

  function journeyBodyHtml() {
    var info = selectionInfo(YES.state.journeyStep);
    var built = journeyItems(info);
    var slot = '<div id="ov-panel" class="ov-panel-slot">' + panelHtml(info) + '</div>';
    var anchor = panelAnchorId(info);
    var inner = built.items
      .map(function (it) {
        return it.html + (anchor && it.id === anchor ? slot : '');
      })
      .join('');
    return (
      '<div class="jr' +
      (info ? ' has-selection' : '') +
      '" role="group" aria-label="' +
      esc(t('overview.journey.stepsLabel')) +
      '" style="--cols:' +
      built.cols +
      '">' +
      inner +
      '</div>' +
      (anchor ? '' : slot)
    );
  }

  /** Signed amount for list rows: the unit is visual-only on wide screens, always spoken. */
  function rowAmount(minor) {
    var dir = minor < 0 ? 'out' : minor > 0 ? 'in' : 'zero';
    return (
      '<span class="amount amount--' +
      dir +
      '"><span aria-hidden="true">' +
      esc(YES.fmt.amount(minor, { sign: 'always', unit: false })) +
      '<span class="ov-unit"> ' +
      esc(sym()) +
      '</span></span><span class="sr-only">' +
      esc(YES.fmt.amountSpoken(minor, { sign: 'always' })) +
      '</span></span>'
    );
  }

  function rowHtml(tx) {
    var dir = tx.amount < 0 ? 'out' : 'in';
    return (
      '<li><button type="button" class="ov-tx" data-ov-tx="' +
      esc(tx.id) +
      '" data-fk="ov-tx-' +
      esc(tx.id) +
      '">' +
      '<span class="ov-tx__icon dir dir--' +
      dir +
      '">' +
      ui.icon(ui.typeIcon(tx.type), { size: 16 }) +
      '</span>' +
      '<span class="ov-tx__when ov-seps"><span class="ov-seps__in"><span class="ov-tx__date">' +
      esc(YES.fmt.date(tx.postedAt, 'medium')) +
      '</span><span class="sr-only">, </span>' +
      '<span class="ov-tx__type">' +
      esc(ui.typeLabel(tx)) +
      '</span></span></span>' +
      '<span class="ov-tx__cp">' +
      ui.maskedHtml(YES.L(tx.counterparty)) +
      '</span>' +
      '<span class="ov-tx__amt">' +
      rowAmount(tx.amount) +
      '</span>' +
      '<span class="ov-tx__go" aria-hidden="true">' +
      ui.icon('chevron', { size: 16 }) +
      '</span>' +
      '<span class="sr-only">, ' +
      esc(t('overview.panel.open')) +
      '</span></button></li>'
    );
  }

  /** "−120.00 − 200.00 − 60.00 = −380.00 EXUSD": the rows, added up in the open. */
  function rowsEquation(rows, sum) {
    var s = '';
    rows.forEach(function (tx, i) {
      if (i === 0) s = plain(tx.amount);
      else s += (tx.amount < 0 ? ' ' + YES.fmt.MINUS + ' ' : ' + ') + num(tx.amount);
    });
    return s + ' = ' + plain(sum) + ' ' + sym();
  }

  function panelHtml(info) {
    if (!info) return '';
    var rows = rowsFor(info.txIds);
    var sum = sumOf(rows);
    var ok = sum === info.value;
    var list = rows.length
      ? '<div class="ov-txhead" aria-hidden="true"><span></span><span>' +
        esc(t('overview.panel.colDate')) +
        '</span><span>' +
        esc(t('overview.panel.colType')) +
        '</span><span>' +
        esc(t('overview.panel.colCounterparty')) +
        '</span><span class="ov-txhead__amt">' +
        esc(t('overview.panel.colAmount')) +
        '</span><span></span></div>' +
        '<ul class="ov-txlist">' +
        rows.map(rowHtml).join('') +
        '</ul>'
      : '<p class="ov-panel__empty">' + esc(t('overview.panel.empty')) + '</p>';
    return (
      '<section class="ov-panel" id="ov-panel-section" aria-labelledby="ov-panel-title" data-panel-step="' +
      esc(info.id) +
      '">' +
      '<div class="ov-panel__head">' +
      '<p class="card__eyebrow">' +
      esc(t(info.kind === 'group' ? 'overview.panel.eyebrowGroup' : 'overview.panel.eyebrow')) +
      '</p>' +
      '<h3 id="ov-panel-title" class="ov-panel__title" tabindex="-1" data-fk="ov-panel-title">' +
      esc(info.label) +
      '</h3>' +
      // Separators are drawn by CSS and clipped at the start of a wrapped line.
      '<div class="ov-panel__meta ov-seps"><p class="ov-seps__in"><span>' +
      esc(YES.txCount(rows.length)) +
      '</span><span>' +
      numHtml(info.value, { unit: true }) +
      '</span><span>' +
      esc(t('overview.panel.order')) +
      '</span></p></div>' +
      '</div>' +
      list +
      '<div class="ov-sum ' +
      (ok ? 'ov-sum--ok' : 'ov-sum--bad') +
      '" data-sum="' +
      sum +
      '">' +
      '<span class="ov-sum__label">' +
      esc(t('overview.panel.sum')) +
      '</span>' +
      '<span class="ov-sum__value">' +
      wrapAmountHtml(sum) +
      '</span>' +
      '<span class="ov-sum__check">' +
      ui.icon(ok ? 'check-circle' : 'alert', { size: 16 }) +
      '<span>' +
      esc(ok ? t('overview.panel.matches', { label: info.label }) : t('overview.panel.mismatch', { amount: amt(info.value, 'always') })) +
      '</span></span>' +
      (rows.length > 1 ? '<span class="ov-sum__math" aria-hidden="true">' + esc(rowsEquation(rows, sum)) + '</span>' : '') +
      '</div>' +
      '<div class="ov-panel__actions">' +
      (rows.length
        ? '<button type="button" class="btn btn--primary" data-ov-show="' +
          esc(info.id) +
          '" data-fk="ov-panel-show"><span>' +
          esc(t('overview.panel.show')) +
          '</span>' +
          ui.icon('arrow-right', { size: 18 }) +
          '</button>'
        : '') +
      ui.explainButton({ topic: 'step', id: info.id }, info.label, { fk: 'ov-panel-explain' }) +
      '<button type="button" class="btn btn--ghost" data-ov-clear data-fk="ov-panel-clear">' +
      ui.icon('close', { size: 16 }) +
      '<span>' +
      esc(t('overview.panel.clear')) +
      '</span></button>' +
      '</div></section>'
    );
  }

  /** The same arithmetic as text: labelled terms, a plain equation and a spoken sentence. */
  function equationHtml() {
    var steps = YES.calc.journey();
    var first = steps[0];
    var last = steps[steps.length - 1];
    var plainEq = plain(first.value);
    var spoken = t('cat.opening') + ' ' + YES.fmt.amountSpoken(first.value);
    var terms = '<span class="jr-eq__term"><span class="jr-eq__num">' + esc(plain(first.value)) + '</span><span class="jr-eq__lbl">' + esc(t('cat.opening')) + '</span></span>';
    steps.slice(1, -1).forEach(function (s) {
      var op = s.value < 0 ? YES.fmt.MINUS : '+';
      plainEq += ' ' + op + ' ' + num(s.value);
      spoken += ', ' + t(s.value < 0 ? 'fmt.minus' : 'fmt.plus') + ' ' + t('cat.' + s.id) + ' ' + YES.fmt.amount(Math.abs(s.value), { sign: 'never' });
      terms +=
        '<span class="jr-eq__term"><span class="jr-eq__num"><span class="jr-eq__op">' +
        esc(op) +
        '</span>' +
        esc(num(s.value)) +
        '</span><span class="jr-eq__lbl">' +
        esc(t('cat.' + s.id)) +
        '</span></span>';
    });
    var closing = plain(last.value) + ' ' + sym();
    plainEq += ' = ' + closing;
    spoken += ', ' + t('overview.journey.equals') + ' ' + t('cat.closing') + ' ' + YES.fmt.amountSpoken(last.value) + '.';
    // The unit may drop below the figure when the line is very narrow (200% text).
    terms +=
      '<span class="jr-eq__term jr-eq__term--total"><span class="jr-eq__num ov-amt"><span class="jr-eq__op">=</span><span class="ov-amt__n">' +
      esc(plain(last.value)) +
      '</span> <span class="ov-amt__u">' +
      esc(sym()) +
      '</span></span><span class="jr-eq__lbl">' +
      esc(t('cat.closing')) +
      '</span></span>';
    return (
      '<div class="jr-eq" data-equation="' +
      esc(plainEq) +
      '">' +
      '<p class="jr-eq__title">' +
      esc(t('overview.journey.eqTitle')) +
      '</p>' +
      '<p class="jr-eq__line" aria-hidden="true">' +
      terms +
      '</p>' +
      '<p class="sr-only">' +
      esc(spoken) +
      '</p></div>'
    );
  }

  function journeyTableHtml() {
    var steps = YES.calc.journey();
    var open = !!ovState().journeyTable;
    var body = steps
      .map(function (s) {
        var total = s.kind === 'total';
        return (
          '<tr data-step="' +
          esc(s.id) +
          '"><th scope="row"><span class="ov-table__label">' +
          esc(t('cat.' + s.id)) +
          '</span>' +
          (total ? '' : '<span class="ov-table__sub">' + esc(YES.txCount(s.count)) + '</span>') +
          '</th><td class="num">' +
          (total ? naHtml() : ui.amountHtml(s.value, { unit: false })) +
          '</td><td class="num">' +
          esc(plain(s.end)) +
          '</td><td class="num ov-col-count">' +
          (total ? naHtml() : esc(YES.fmt.count(s.count))) +
          '</td></tr>'
        );
      })
      .join('');
    var posted = YES.calc.posted().length;
    return (
      '<details class="disclosure ov-tablebox" data-ov-disclosure="journeyTable"' +
      (open ? ' open' : '') +
      '>' +
      '<summary data-fk="ov-jtable">' +
      ui.icon('balance', { size: 18 }) +
      '<span>' +
      esc(t('overview.journey.table')) +
      '</span></summary>' +
      '<div class="disclosure__body"><p class="ov-tablenote">' +
      ui.icon('info', { size: 16 }) +
      '<span>' +
      esc(t('overview.journey.byType')) +
      '</span></p><div class="table-wrap"><table class="table ov-table ov-jtable">' +
      '<caption>' +
      esc(t('overview.journey.caption', { period: periodText(), symbol: sym() })) +
      '</caption>' +
      '<thead><tr><th scope="col">' +
      esc(t('overview.journey.colStep')) +
      '</th><th scope="col" class="num">' +
      esc(t('overview.journey.colChange')) +
      '</th><th scope="col" class="num">' +
      esc(t('overview.journey.colAfter')) +
      '</th><th scope="col" class="num ov-col-count">' +
      esc(t('overview.journey.colCount')) +
      '</th></tr></thead><tbody>' +
      body +
      '</tbody><tfoot><tr><th scope="row">' +
      esc(t('overview.journey.net')) +
      '</th><td class="num">' +
      ui.amountHtml(YES.calc.netChange(), { unit: false }) +
      '</td><td class="num"></td><td class="num ov-col-count">' +
      esc(YES.fmt.count(posted)) +
      '</td></tr></tfoot></table></div></div></details>'
    );
  }

  function legendHtml(items) {
    return (
      '<ul class="ov-legend" aria-label="' +
      esc(t('overview.journey.legendLabel')) +
      '">' +
      items
        .map(function (it) {
          return '<li>' + it[0] + '<span>' + esc(it[1]) + '</span></li>';
        })
        .join('') +
      '</ul>'
    );
  }

  function exceptionHtml() {
    return (
      '<div class="notice notice--critical ov-exception" role="alert">' +
      ui.icon('alert', { size: 22 }) +
      '<div><p><strong>' +
      esc(t('overview.journey.exTitle')) +
      '</strong></p><p>' +
      esc(t('overview.journey.exBody')) +
      '</p><p><button type="button" class="btn" data-ov-help data-fk="ov-ex-help">' +
      esc(t('overview.help')) +
      '</button></p></div></div>'
    );
  }

  function journeySectionHtml(rec) {
    var s = st();
    var head =
      '<div class="ov-sechead"><div class="ov-sechead__text"><h2 id="ov-journey-title">' +
      esc(t('overview.journey.title')) +
      '</h2>' +
      (rec.ok ? '<p class="ov-sublede">' + esc(t('overview.journey.lede', { opening: amt(s.opening), closing: amt(s.closing) })) + '</p>' : '') +
      '</div>' +
      (rec.ok
        ? '<div class="ov-sechead__aside">' +
          legendHtml([
            ['<span class="ov-key ov-key--in" aria-hidden="true"></span>', t('overview.journey.legendIn')],
            ['<span class="ov-key ov-key--out" aria-hidden="true"></span>', t('overview.journey.legendOut')],
            ['<span class="ov-key ov-key--total" aria-hidden="true"></span>', t('overview.journey.legendTotal')]
          ]) +
          '<p class="ov-unitnote">' +
          esc(t('overview.journey.unit', { symbol: sym(), unit: YES.L(asset().unitLabel) })) +
          '</p></div>'
        : '') +
      '</div>';
    if (!rec.ok) return '<section class="card ov-journey" aria-labelledby="ov-journey-title">' + head + exceptionHtml() + '</section>';
    return (
      '<section class="card ov-journey" aria-labelledby="ov-journey-title">' +
      head +
      '<div id="ov-journey-body" class="ov-journey__body">' +
      journeyBodyHtml() +
      '</div>' +
      equationHtml() +
      journeyTableHtml() +
      '</section>'
    );
  }

  /** Reflect YES.state.journeyStep in place (keeps transitions), then redraw the panel. */
  function syncJourney() {
    var body = doc.getElementById('ov-journey-body');
    if (!body) return;
    var jr = body.querySelector('.jr');
    if (!jr) return;
    var anim = pendingAnim && !ui.reducedMotion();
    pendingAnim = false;
    var info = selectionInfo(YES.state.journeyStep);
    jr.classList.toggle('has-selection', !!info);
    ui.$$('[data-ov-step]', jr).forEach(function (b) {
      b.setAttribute('aria-pressed', String(!!info && info.id === b.getAttribute('data-ov-step')));
    });
    ui.$$('.jr-step', jr).forEach(function (el) {
      var id = el.getAttribute('data-step');
      var member = !!info && info.members.indexOf(id) !== -1;
      el.classList.toggle('is-selected', member && info.id === id);
      el.classList.toggle('is-member', member && info.id !== id);
      el.classList.toggle('is-dim', !!info && !member);
      el.classList.remove('is-anim');
    });
    ui.$$('.jr-group', jr).forEach(function (el) {
      var gid = el.getAttribute('data-group');
      var cats = (YES.calc.groups()[gid] || { categories: [] }).categories;
      var related =
        !!info &&
        (info.id === gid ||
          info.members.some(function (m) {
            return cats.indexOf(m) !== -1;
          }));
      el.classList.toggle('is-dim', !!info && !related);
    });
    placePanel(info);
    var slot = doc.getElementById('ov-panel');
    ui.render(slot, panelHtml(info));
    if (anim && info) {
      info.members.forEach(function (id, i) {
        var el = jr.querySelector('.jr-step[data-step="' + id + '"]');
        if (!el) return;
        void el.offsetWidth; // restart the keyframes on an element that stays in place
        el.style.setProperty('--i', i);
        el.classList.add('is-anim');
      });
      var panel = slot.firstElementChild;
      if (panel) panel.classList.add('is-anim');
    }
  }

  /**
   * Move the panel slot next to the selection in the list layout, below the
   * waterfall in the wide one. Moving a node drops focus, so focus inside the
   * panel is put back on the same control.
   */
  function placePanel(info) {
    var slot = doc.getElementById('ov-panel');
    var body = doc.getElementById('ov-journey-body');
    if (!slot || !body) return;
    var jr = body.querySelector('.jr');
    if (!jr) return;
    var anchorId = panelAnchorId(info === undefined ? selectionInfo(YES.state.journeyStep) : info);
    var anchor = anchorId ? jr.querySelector('.jr-step[data-step="' + anchorId + '"]') : null;
    var active = doc.activeElement;
    var key = active && slot.contains(active) ? active.getAttribute('data-fk') : null;
    var moved = false;
    if (anchor) {
      if (anchor.nextElementSibling !== slot) {
        anchor.parentNode.insertBefore(slot, anchor.nextSibling);
        moved = true;
      }
    } else if (slot.parentNode !== body || slot.previousElementSibling !== jr) {
      body.insertBefore(slot, jr.nextSibling);
      moved = true;
    }
    if (moved && key && doc.activeElement !== active) ui.focusKey(key);
  }

  /** Scroll just enough to show the panel without hiding the control that opened it. */
  function reveal(el, keepVisible) {
    if (!el || !el.getBoundingClientRect) return;
    var r = el.getBoundingClientRect();
    var vh = root.innerHeight || doc.documentElement.clientHeight;
    var mast = doc.getElementById('masthead');
    var topLimit = (mast ? mast.getBoundingClientRect().bottom : 0) + 12;
    var keepTop = keepVisible ? keepVisible.getBoundingClientRect().top : r.top;
    var delta = 0;
    if (r.bottom > vh - 12) delta = Math.min(r.bottom - vh + 12, keepTop - topLimit);
    else if (r.top < topLimit) delta = r.top - topLimit;
    if (Math.abs(delta) > 1 && root.scrollBy) root.scrollBy({ top: delta, behavior: ui.reducedMotion() ? 'auto' : 'smooth' });
  }

  /* ---------------------------- History ----------------------------- */
  /* Selecting a step from the full journey pushes a history entry, so the
     browser's (or Android's) Back clears the selection instead of leaving the
     statement; moving between steps replaces that entry. Clear goes back
     through the same entry, so the history does not fill with copies. */
  function onOwnEntry() {
    var h = root.history && root.history.state;
    return !!(h && h.ovEntry === ENTRY);
  }
  function markOwnEntry() {
    try {
      root.history.replaceState({ ovEntry: ENTRY }, '', root.location.href);
    } catch (e) {
      /* history unavailable: Back simply leaves, as before */
    }
  }
  /** Reflect a new selection in the address (call after YES.set; prev = the step before). */
  function routeTo(id, prev) {
    if (YES.state.view !== 'overview' || !root.history) return;
    if (!prev && id) {
      YES.nav.go('overview', { param: id, focus: false }); // pushes #/overview/<id>
      markOwnEntry();
    } else {
      var own = onOwnEntry();
      YES.nav.setParam(id); // replaces the entry (and its state)
      if (own) markOwnEntry();
    }
  }

  function selectedMessage(info) {
    return t('overview.journey.selected', {
      label: info.label,
      count: YES.txCount(rowsFor(info.txIds).length),
      amount: YES.fmt.amountSpoken(info.value, { sign: 'always' })
    });
  }

  function select(id, opts) {
    opts = opts || {};
    var info = selectionInfo(id);
    if (!info) return false;
    var prev = YES.state.journeyStep;
    pendingAnim = true;
    if (opts.navigate && YES.state.view !== 'overview') {
      YES.nav.go('overview', { param: id, focus: false }); // show the view first, then select
      YES.set({ journeyStep: id });
    } else {
      YES.set({ journeyStep: id });
      routeTo(id, prev);
    }
    pendingAnim = false;
    ui.announce(selectedMessage(info));
    var panel = doc.getElementById('ov-panel-section');
    if (panel) {
      if (opts.focusPanel) {
        var h = doc.getElementById('ov-panel-title');
        if (h) h.focus({ preventScroll: true });
        reveal(panel, panel);
      } else {
        reveal(panel, opts.trigger || null);
      }
    }
    return true;
  }

  function clearSelection(opts) {
    opts = opts || {};
    var prev = YES.state.journeyStep;
    if (!prev) return;
    var back = !opts.fromHistory && YES.state.view === 'overview' && onOwnEntry();
    var hadFocus = doc.activeElement && doc.getElementById('ov-panel') && doc.getElementById('ov-panel').contains(doc.activeElement);
    YES.set({ journeyStep: null });
    if (back) root.history.back();
    else if (!opts.fromHistory && YES.state.view === 'overview') YES.nav.setParam(null);
    ui.announce(t('overview.journey.cleared'));
    if (opts.returnFocus || hadFocus) ui.focusKey('ov-step-' + prev);
  }

  /* --------------------- Explorer filter in step ---------------------- */
  /* PRD 5.2: selecting a step filters the transaction explorer to exactly the
     transactions behind it, and clearing it restores the full ledger. The
     filter is shared state (YES.state.filters, shape from YES.defaultFilters),
     so the Transactions view opens on the same rows with its "Step" chip and
     "Back to balance journey" link — without an extra announcement here. */
  function syncExplorer(prev, next) {
    var cur = YES.state.filters || YES.defaultFilters();
    var f;
    if (next) {
      if (cur.step === next && !cur.ids) return;
      f = YES.defaultFilters();
      f.step = next;
    } else {
      if (!prev || cur.step !== prev) return; // the customer changed it in Transactions: leave it
      f = {};
      Object.keys(cur).forEach(function (k) {
        f[k] = cur[k];
      });
      f.step = null;
    }
    YES.set({ filters: f });
  }

  /* ------------------------------------------------------------------ */
  /* 4. Why it changed: running balance, fees, insight                   */
  /* ------------------------------------------------------------------ */
  function triPath(x, y, up, s) {
    s = s || 1;
    var h = 6 * s;
    var w = 5.5 * s;
    var b = 4 * s;
    return up
      ? 'M' + x + ' ' + (y - h) + 'L' + (x + w) + ' ' + (y + b) + 'L' + (x - w) + ' ' + (y + b) + 'Z'
      : 'M' + x + ' ' + (y + h) + 'L' + (x + w) + ' ' + (y - b) + 'L' + (x - w) + ' ' + (y - b) + 'Z';
  }
  function r1(v) {
    return Math.round(v * 10) / 10;
  }

  function pointLabel(p) {
    return t('overview.chart.point', {
      date: YES.fmt.date(p.iso, 'datetime'),
      type: ui.typeLabel(p.tx),
      amount: YES.fmt.amountSpoken(p.delta, { sign: 'always' }),
      // The template ends this clause with a full stop: "Daniel K." must not read "Daniel K..".
      counterparty: noStop(YES.fmt.maskedSpoken(YES.L(p.tx.counterparty))),
      balance: YES.fmt.amountSpoken(p.balance)
    });
  }

  /** Rendered width of a 12px chart label, so axis labels are thinned before they collide. */
  var measureCtx = null;
  function textWidth(str) {
    try {
      if (!measureCtx) measureCtx = doc.createElement('canvas').getContext('2d');
      var host = plotHost();
      measureCtx.font = '12px ' + ((host && root.getComputedStyle(host).fontFamily) || 'sans-serif');
      return measureCtx.measureText(str).width;
    } catch (e) {
      return str.length * 7;
    }
  }

  /** The SVG chart plus its keyboard/pointer layer, drawn at the host's pixel width. */
  function plotInner(width) {
    var s = st();
    var running = YES.calc.running();
    var byId = {};
    YES.calc.posted().forEach(function (tx) {
      byId[tx.id] = tx;
    });
    var W = Math.max(240, Math.round(width));
    var compact = W < 560;
    var H = compact ? 230 : 270;
    var m = { l: compact ? 46 : 54, r: 14, t: 26, b: 32 };
    var x0 = Date.parse(s.periodStart);
    var x1 = Date.parse(s.periodEnd);
    var lo = Math.min(0, s.opening);
    var hi = s.opening;
    running.forEach(function (p) {
      lo = Math.min(lo, p.balance);
      hi = Math.max(hi, p.balance);
    });
    var tk = ticks(lo, hi, compact ? 3 : 4);
    var y0 = tk[0];
    var y1 = tk[tk.length - 1];
    var pw = W - m.l - m.r;
    var ph = H - m.t - m.b;
    function X(ms) {
      return r1(m.l + ((ms - x0) / (x1 - x0)) * pw);
    }
    function Y(v) {
      return r1(m.t + (1 - (v - y0) / (y1 - y0)) * ph);
    }
    var svg = [];
    tk.forEach(function (v) {
      var y = Y(v);
      svg.push('<line class="' + (v === 0 ? 'c-zero' : 'c-grid') + '" x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + y + '" y2="' + y + '"/>');
      svg.push('<text class="c-tick" x="' + (m.l - 8) + '" y="' + y + '" text-anchor="end" dominant-baseline="middle">' + esc(tickLabel(v)) + '</text>');
    });
    // A tick every week; a label only as often as the labels fit side by side
    // (every week on a desktop, every second week on a 320px phone).
    var DAY = 86400000;
    var weeks = [];
    for (var d = 0; x0 + d * DAY <= x1; d += 7) weeks.push({ ms: x0 + d * DAY, text: YES.fmt.date(new Date(x0 + d * DAY).toISOString(), 'short') });
    var widest = 0;
    weeks.forEach(function (wk) {
      widest = Math.max(widest, textWidth(wk.text));
    });
    var perWeek = (pw * 7 * DAY) / Math.max(DAY, x1 - x0);
    var every = 1;
    while (every < weeks.length && perWeek * every < widest + 12) every++;
    weeks.forEach(function (wk, k) {
      var x = X(wk.ms);
      svg.push('<line class="c-xtick" x1="' + x + '" x2="' + x + '" y1="' + (H - m.b) + '" y2="' + (H - m.b + 4) + '"/>');
      if (k % every === 0) svg.push('<text class="c-tick" x="' + x + '" y="' + (H - m.b + 19) + '" text-anchor="middle">' + esc(wk.text) + '</text>');
    });
    chart.pts = [];
    chart.xs = [];
    chart.ys = [];
    var path = 'M' + X(x0) + ' ' + Y(s.opening);
    var lane = {}; // timestamp -> markers already placed there
    running.forEach(function (p) {
      var px = X(Date.parse(p.at));
      var py = Y(p.balance);
      path += 'H' + px + 'V' + py;
      chart.pts.push({ id: p.txId, at: Date.parse(p.at), iso: p.at, balance: p.balance, delta: p.delta, tx: byId[p.txId], lane: 0 });
      chart.xs.push(px);
      chart.ys.push(py);
    });
    // Same-time markers (a movement and its fee) would sit exactly on top of
    // each other: keep the movement on the line and dodge the others sideways,
    // so every marker stays visible and can be picked.
    var order = chart.pts
      .map(function (p, i) {
        return i;
      })
      .sort(function (a, b) {
        var fa = chart.pts[a].tx.type === 'fee' ? 1 : 0;
        var fb = chart.pts[b].tx.type === 'fee' ? 1 : 0;
        return chart.pts[a].at - chart.pts[b].at || fa - fb || a - b;
      });
    order.forEach(function (i) {
      var key = chart.pts[i].at;
      var k = lane[key] || 0;
      lane[key] = k + 1;
      chart.pts[i].lane = k;
      chart.xs[i] = r1(chart.xs[i] + k * DODGE);
    });
    path += 'H' + X(x1);
    var base = Y(Math.min(Math.max(0, y0), y1));
    svg.push('<path class="c-area" d="' + path + 'V' + base + 'H' + X(x0) + 'Z"/>');
    svg.push('<path class="c-line" d="' + path + '"/>');
    // Dodged markers first, so the movement on the line is drawn on top; fees are smaller.
    order
      .slice()
      .sort(function (a, b) {
        return chart.pts[b].lane - chart.pts[a].lane || a - b;
      })
      .forEach(function (i) {
        var p = chart.pts[i];
        svg.push(
          '<path class="ov-mk ov-mk--' +
            (p.delta < 0 ? 'out' : 'in') +
            (p.tx.type === 'fee' ? ' ov-mk--minor' : '') +
            '" data-i="' +
            i +
            '" d="' +
            triPath(chart.xs[i], chart.ys[i], p.delta >= 0, p.tx.type === 'fee' ? 0.8 : 1) +
            '"/>'
        );
      });
    var endBalance = running.length ? running[running.length - 1].balance : s.opening;
    svg.push('<text class="c-end" x="' + (W - m.r) + '" y="' + (Y(endBalance) - 12) + '" text-anchor="end">' + esc(plain(endBalance)) + '</text>');

    chart.w = W;
    if (chart.focusIdx >= chart.pts.length) chart.focusIdx = 0;
    var points = chart.pts
      .map(function (p, i) {
        return (
          '<button type="button" class="ov-pt' +
          (p.tx.type === 'fee' ? ' ov-pt--minor' : '') +
          '" data-ov-pt="' +
          i +
          '" data-ov-tx="' +
          esc(p.id) +
          '" data-fk="ov-pt-' +
          esc(p.id) +
          '" tabindex="' +
          (i === chart.focusIdx ? '0' : '-1') +
          '" style="left:' +
          chart.xs[i] +
          'px;top:' +
          chart.ys[i] +
          'px" aria-label="' +
          esc(pointLabel(p)) +
          '"></button>'
        );
      })
      .join('');
    return (
      '<svg class="ov-chart__svg" width="' +
      W +
      '" height="' +
      H +
      '" viewBox="0 0 ' +
      W +
      ' ' +
      H +
      '" aria-hidden="true" focusable="false">' +
      svg.join('') +
      '</svg>' +
      '<div class="ov-cross" aria-hidden="true" hidden style="top:' +
      m.t +
      'px;height:' +
      ph +
      'px"></div>' +
      '<div class="ov-pts" role="group" aria-label="' +
      esc(t('overview.chart.pointsLabel')) +
      '">' +
      points +
      '</div>' +
      '<div class="ov-tip" aria-hidden="true" hidden></div>'
    );
  }

  function renderPlot() {
    var host = doc.getElementById('ov-chart-plot');
    if (!host) return;
    var w = host.clientWidth;
    if (!w) return; // hidden view: the resize observer redraws once it has a size
    chart.lastW = w;
    chart.hover = -1;
    ui.render(host, plotInner(w));
  }

  function chartSummary() {
    var s = st();
    var running = YES.calc.running();
    var best = { v: s.opening, at: s.periodStart };
    var worst = { v: s.opening, at: s.periodStart };
    running.forEach(function (p) {
      if (p.balance > best.v) best = { v: p.balance, at: p.at };
      if (p.balance < worst.v) worst = { v: p.balance, at: p.at };
    });
    var end = running.length ? running[running.length - 1].balance : s.opening;
    return t('overview.chart.summary', {
      max: amt(best.v),
      maxDate: YES.fmt.date(best.at, 'long'),
      min: amt(worst.v),
      minDate: YES.fmt.date(worst.at, 'long'),
      closing: amt(end)
    });
  }

  function chartTableHtml() {
    var s = st();
    var open = !!ovState().chartTable;
    var body =
      '<tr><th scope="row"><span class="ov-table__date">' +
      esc(YES.fmt.date(s.periodStart, 'medium')) +
      '</span><span>' +
      esc(t('cat.opening')) +
      '</span></th><td class="num">' +
      naHtml() +
      '</td><td class="num">' +
      esc(plain(s.opening)) +
      '</td></tr>';
    YES.calc.running().forEach(function (p) {
      var tx = YES.calc.tx(p.txId);
      body +=
        '<tr><th scope="row"><span class="ov-table__date">' +
        esc(YES.fmt.date(p.at, 'datetime')) +
        '</span><button type="button" class="btn--link ov-table__tx" data-ov-tx="' +
        esc(tx.id) +
        '" data-fk="ov-ctx-' +
        esc(tx.id) +
        '">' +
        esc(ui.typeLabel(tx) + ' · ') +
        ui.maskedHtml(YES.L(tx.counterparty)) +
        '</button></th><td class="num">' +
        ui.amountHtml(p.delta, { unit: false }) +
        '</td><td class="num">' +
        esc(plain(p.balance)) +
        '</td></tr>';
    });
    return (
      '<details class="disclosure ov-tablebox" data-ov-disclosure="chartTable"' +
      (open ? ' open' : '') +
      '>' +
      '<summary data-fk="ov-ctable">' +
      ui.icon('balance', { size: 18 }) +
      '<span>' +
      esc(t('overview.chart.table')) +
      '</span></summary>' +
      '<div class="disclosure__body"><div class="table-wrap"><table class="table ov-table ov-ctable">' +
      '<caption>' +
      esc(t('overview.chart.caption', { period: periodText(), symbol: sym() })) +
      '</caption><thead><tr><th scope="col">' +
      esc(t('overview.chart.colTx')) +
      '</th><th scope="col" class="num">' +
      esc(t('overview.journey.colChange')) +
      '</th><th scope="col" class="num">' +
      esc(t('overview.chart.colAfter')) +
      '</th></tr></thead><tbody>' +
      body +
      '</tbody></table></div></div></details>'
    );
  }

  function miniRowHtml(tx, fk, extra) {
    return (
      '<li><button type="button" class="ov-mini" data-ov-tx="' +
      esc(tx.id) +
      '" data-fk="' +
      esc(fk + tx.id) +
      '">' +
      '<span class="ov-mini__main">' +
      esc(YES.L(tx.description)) +
      '</span>' +
      '<span class="ov-mini__date">' +
      esc(YES.fmt.date(tx.postedAt || tx.initiatedAt, 'medium')) +
      (extra ? ' · ' + esc(extra) : '') +
      '</span>' +
      '<span class="ov-mini__amt">' +
      rowAmount(tx.amount) +
      '</span>' +
      '<span class="sr-only">, ' +
      esc(t('overview.panel.open')) +
      '</span></button></li>'
    );
  }

  function lowDataHtml(running) {
    var s = st();
    if (!running.length) {
      return '<p class="notice notice--info ov-lowdata">' + ui.icon('info', { size: 18 }) + '<span>' + esc(t('overview.chart.none', { amount: amt(s.opening) })) + '</span></p>';
    }
    return (
      '<p class="notice notice--info ov-lowdata">' +
      ui.icon('info', { size: 18 }) +
      '<span>' +
      esc(t('overview.chart.low', { count: YES.txCount(running.length) })) +
      '</span></p>' +
      '<ol class="ov-minilist ov-lowlist">' +
      running
        .map(function (p) {
          return miniRowHtml(YES.calc.tx(p.txId), 'ov-low-', t('overview.chart.after', { amount: amt(p.balance) }));
        })
        .join('') +
      '</ol>'
    );
  }

  function chartCardHtml() {
    var running = YES.calc.running();
    var low = running.length < 3;
    var head =
      '<div class="ov-cardhead"><h3 id="ov-chart-title">' +
      esc(t('overview.chart.title')) +
      '</h3>' +
      ui.explainButton({ topic: 'chart' }, t('overview.chart.title'), { fk: 'ov-chart-explain' }) +
      '</div>' +
      '<p class="ov-cardlede">' +
      esc(t('overview.chart.lede', { period: periodText() })) +
      '</p>';
    if (low) return '<section class="card ov-chartcard" aria-labelledby="ov-chart-title">' + head + lowDataHtml(running) + '</section>';
    var keyLine = '<svg class="ov-lkey" width="18" height="10" viewBox="0 0 18 10" aria-hidden="true" focusable="false"><path class="ov-lkey__line" d="M1 5H17"/></svg>';
    var keyIn = '<svg class="ov-lkey" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" focusable="false"><path class="ov-mk ov-mk--in" d="' + triPath(7, 7.5, true) + '"/></svg>';
    var keyOut = '<svg class="ov-lkey" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" focusable="false"><path class="ov-mk ov-mk--out" d="' + triPath(7, 6.5, false) + '"/></svg>';
    return (
      '<section class="card ov-chartcard" aria-labelledby="ov-chart-title">' +
      head +
      '<figure class="ov-chart" aria-labelledby="ov-chart-title" data-ov-figure>' +
      legendHtml([
        [keyLine, t('overview.chart.legendLine')],
        [keyIn, t('overview.chart.legendIn')],
        [keyOut, t('overview.chart.legendOut')]
      ]) +
      '<div id="ov-chart-plot" class="ov-chart__plot" data-ov-plot>' +
      (chart.lastW ? plotInner(chart.lastW) : '') +
      '</div>' +
      '<figcaption id="ov-chart-summary" class="ov-chart__summary">' +
      esc(chartSummary()) +
      '</figcaption></figure>' +
      chartTableHtml() +
      '</section>'
    );
  }

  function feesHtml() {
    var cat = YES.calc.category('fees');
    var rows = cat ? rowsFor(cat.txIds) : [];
    var total = cat ? cat.total : 0;
    var foreign = YES.calc.foreignFees();
    var html =
      '<section class="card ov-fees" aria-labelledby="ov-fees-title">' +
      '<h3 id="ov-fees-title" class="ov-cardtitle"><span class="dir dir--out">' +
      ui.icon('fee', { size: 18 }) +
      '</span><span>' +
      esc(t('overview.fees.title')) +
      '</span></h3>';
    if (!rows.length) {
      html += '<p>' + esc(t('overview.fees.none')) + '</p>';
    } else {
      html +=
        '<p class="ov-fees__total"><span class="ov-fees__label">' +
        esc(t('overview.fees.total')) +
        '</span><span class="ov-fees__value">' +
        wrapAmountHtml(total) +
        '</span><span class="ov-fees__count">' +
        esc(rows.length === 1 ? t('overview.fees.count1') : t('overview.fees.countN', { n: YES.fmt.count(rows.length) })) +
        '</span></p>' +
        '<ul class="ov-minilist">' +
        rows
          .map(function (tx) {
            return miniRowHtml(tx, 'ov-fee-');
          })
          .join('') +
        '</ul>' +
        '<p class="ov-fees__note">' +
        esc(t('overview.fees.note')) +
        '</p>';
    }
    if (!foreign.length) {
      html += '<p class="ov-fees__foreign" data-foreign="none">' + esc(t('overview.fees.foreignNone')) + '</p>';
    } else {
      html +=
        '<p class="ov-fees__foreign">' +
        esc(t('overview.fees.foreign')) +
        '</p><ul class="ov-fees__foreignlist">' +
        foreign
          .map(function (f) {
            var known = YES.data.assets[f.fee.asset];
            var value = known ? YES.fmt.amount(-f.fee.amount, { asset: f.fee.asset, sign: 'always' }) : -f.fee.amount + ' ' + f.fee.asset;
            return '<li>' + esc(value) + '</li>';
          })
          .join('') +
        '</ul>';
    }
    html +=
      '<div class="ov-cardactions">' +
      (rows.length
        ? '<button type="button" class="btn" data-ov-select="fees" data-fk="ov-fees-show">' + ui.icon('balance', { size: 18 }) + '<span>' + esc(t('overview.fees.show')) + '</span></button>'
        : '') +
      ui.explainButton({ topic: 'fees' }, t('overview.fees.title'), { fk: 'ov-fees-explain' }) +
      '</div></section>';
    return html;
  }

  function insightHtml() {
    var tx = YES.calc.largest();
    if (!tx) return '';
    return (
      '<section class="card ov-insight" aria-labelledby="ov-insight-title">' +
      '<p class="card__eyebrow">' +
      esc(t('overview.insight.eyebrow')) +
      '</p>' +
      '<h3 id="ov-insight-title" class="ov-cardtitle">' +
      esc(t('overview.insight.title')) +
      '</h3>' +
      '<p class="ov-insight__body">' +
      esc(t('overview.insight.body', { amount: amt(tx.amount, 'always'), date: YES.fmt.date(tx.postedAt, 'long'), description: noStop(YES.L(tx.description)) })) +
      '</p>' +
      '<div class="ov-cardactions">' +
      '<button type="button" class="btn" data-ov-tx="' +
      esc(tx.id) +
      '" data-fk="ov-insight-view">' +
      esc(t('overview.insight.view')) +
      '</button>' +
      '<button type="button" class="btn btn--ghost ov-learn" data-ov-learn="token_units" data-fk="ov-insight-learn">' +
      ui.icon('book', { size: 18 }) +
      '<span>' +
      esc(t('overview.insight.learn')) +
      '</span></button>' +
      '</div></section>'
    );
  }

  function whyHtml(rec) {
    var head =
      '<div class="ov-sechead ov-sechead--plain"><div class="ov-sechead__text"><h2 id="ov-why-title">' +
      esc(t('overview.why.title')) +
      '</h2><p class="ov-sublede">' +
      esc(t('overview.why.lede')) +
      '</p></div></div>';
    if (!rec.ok) {
      return (
        '<section class="ov-why" aria-labelledby="ov-why-title">' +
        head +
        '<p class="notice notice--critical">' +
        ui.icon('alert', { size: 18 }) +
        '<span>' +
        esc(t('overview.why.withheld')) +
        '</span></p></section>'
      );
    }
    return (
      '<section class="ov-why" aria-labelledby="ov-why-title">' +
      head +
      '<div class="ov-why__grid">' +
      chartCardHtml() +
      '<div class="ov-why__aside">' +
      feesHtml() +
      insightHtml() +
      '</div></div></section>'
    );
  }

  /* ------------------------------------------------------------------ */
  /* 5. "Your statement in 60 seconds": an animated, narrated player      */
  /* ------------------------------------------------------------------ */
  /*
   * PRD 5.7. Not a video file: a stage drawn in the page from this
   * statement's own figures (YES.calc, YES.fmt), in the current language, with
   * nothing fetched: a 16:9 frame, or on a narrow player (a phone held upright,
   * also in full screen) a portrait 3:4 frame with its own layout for every
   * chapter and type sized for a phone (CSS only: the same timeline, cues and
   * frames). It behaves like a video: it never plays on its own; Play /
   * Pause, a seek slider with chapter markers, captions (on by default), mute
   * and full screen; chapters and a transcript beneath it.
   *
   * The picture is a pure function of time. drawFrame(t) sets every animated
   * property (entrances, bar growth, highlights, the pointer) from t alone, so
   * seeking to any time draws exactly that frame, in either frame, and reduced
   * motion swaps movement for fades and cuts. requestAnimationFrame only
   * advances t. (The pointer's spots are measured from the frame's layout.)
   *
   * Narration: the approved recording for the current language
   * (YES.config.slots.VIDEO_VOICEOVER[lang], a data:audio URI) kept in step
   * with the playhead; otherwise the device's built-in voice (Web Speech API)
   * reads one short sentence per caption cue when the playhead reaches it.
   * With neither, it plays silently with captions on and says so.
   */
  var VID = {
    end: 60,
    poster: 5, // the frame shown before the first Play
    chapters: [
      { id: 'greet', at: 0 },
      { id: 'balance', at: 6.6 },
      { id: 'largest', at: 24.5 },
      { id: 'inspect', at: 35 },
      { id: 'help', at: 50.4 }
    ],
    /* One short sentence each. Each window holds its sentence at about 2.5
       words a second, numbers spoken in full, in English and in Spanish
       (the test checks this), with a little air before the next one. */
    cues: [
      { id: 'hello', at: 0 },
      { id: 'period', at: 1.5 },
      { id: 'opening', at: 6.6 },
      { id: 'incoming', at: 10.5 },
      { id: 'outgoing', at: 13.1 },
      { id: 'closing', at: 18.2 },
      { id: 'largest', at: 24.5 },
      { id: 'what', at: 29.1 },
      { id: 'select', at: 35 },
      { id: 'rows', at: 38.2 },
      { id: 'open', at: 41.7 },
      { id: 'actions', at: 45.6 },
      { id: 'help', at: 50.4 },
      { id: 'bye', at: 54.5 }
    ],
    lastCueEnd: 59.3,
    /* A voice still reading when its window ends holds the picture this long at most. */
    holdMs: 2500,
    /* Resuming (or seeking) inside the first 40% of a cue reads it; later, the next one. */
    resumeShare: 0.4
  };
  /** Cue start times by id (scene timings are written against them). */
  var C = {};
  VID.cues.forEach(function (c) {
    C[c.id] = c.at;
  });
  function sceneEnd(i) {
    return i + 1 < VID.chapters.length ? VID.chapters[i + 1].at : VID.end;
  }

  ui.registerIcons({
    'vp-pause': '<rect x="6.5" y="5" width="3.6" height="14" rx="1"/><rect x="13.9" y="5" width="3.6" height="14" rx="1"/>',
    'vp-replay': '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.5 4.5v4.2h4.2"/>',
    'vp-volume': '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9.2a4 4 0 0 1 0 5.6"/><path d="M18.2 6.6a7.6 7.6 0 0 1 0 10.8"/>',
    'vp-muted': '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="m16 9.5 5 5"/><path d="m21 9.5-5 5"/>',
    'vp-cc': '<rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="M10.6 10.3a2.2 2.2 0 1 0 0 3.4"/><path d="M17 10.3a2.2 2.2 0 1 0 0 3.4"/>',
    'vp-fs': '<path d="M4 9V4h5"/><path d="M20 9V4h-5"/><path d="M4 15v5h5"/><path d="M20 15v5h-5"/>',
    'vp-fs-exit': '<path d="M9 4v5H4"/><path d="M15 4v5h5"/><path d="M9 20v-5H4"/><path d="M15 20v-5h5"/>'
  });

  /** m:ss, whole seconds. */
  function tc(sec) {
    var s = Math.max(0, Math.floor(sec + 1e-6));
    var m = Math.floor(s / 60);
    s %= 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }
  function r2(v) {
    return Math.round(v * 100) / 100;
  }
  function chapterAt(t) {
    var i = 0;
    for (var k = 0; k < VID.chapters.length; k++) if (t >= VID.chapters[k].at - 1e-6) i = k;
    return i;
  }
  function chapterTitle(i) {
    return t('overview.video.ch.' + VID.chapters[i].id);
  }

  /**
   * A number for the voice only: no grouping and no trailing zeros, so a voice
   * reads "1147.5" as "one thousand one hundred forty-seven point five" (and
   * "1147,5" as "mil ciento cuarenta y siete coma cinco"). Captions and the
   * picture use YES.fmt.amount like the rest of the statement.
   */
  function sayNum(minor) {
    var p = asset().precision;
    return new Intl.NumberFormat(YES.i18n.locale(), { minimumFractionDigits: 0, maximumFractionDigits: p, useGrouping: false }).format(Math.abs(minor) / Math.pow(10, p));
  }

  /** Everything the video shows, from the same snapshot as the rest of the page. */
  function vidModel() {
    var groups = YES.calc.groups();
    var cats = YES.calc.categories().filter(function (c) {
      return c.count > 0;
    });
    // How to inspect a transaction: the first journey step holding a movement
    // with a linked fee (so the detail has one to show), else the first step.
    var step = null;
    var tx = null;
    cats.some(function (c) {
      var rows = rowsFor(c.txIds);
      for (var i = 0; i < rows.length; i++) {
        if (rows[i].type !== 'fee' && YES.calc.feesFor(rows[i].id).length) {
          step = c;
          tx = rows[i];
          return true;
        }
      }
      return false;
    });
    if (!step && cats.length) {
      step = cats[0];
      tx = rowsFor(step.txIds)[0] || null;
    }
    return {
      s: st(),
      inc: groups.incoming.total,
      out: groups.outgoing.total,
      big: YES.calc.largest(),
      posted: YES.calc.posted(),
      step: step,
      rows: step ? rowsFor(step.txIds) : [],
      tx: tx,
      fees: tx
        ? YES.calc.feesFor(tx.id).filter(function (f) {
            return f.status === 'posted';
          })
        : []
    };
  }

  /** Caption text and spoken text for every cue. */
  function cueList(m) {
    var s = m.s;
    var big = m.big;
    var v = {
      name: s.customer.firstName,
      period: periodText(),
      month: monthText(),
      opening: amt(s.opening),
      openingSay: sayNum(s.opening),
      incoming: amt(Math.abs(m.inc)),
      incomingSay: sayNum(m.inc),
      outgoing: amt(Math.abs(m.out)),
      outgoingSay: sayNum(m.out),
      closing: amt(s.closing),
      closingSay: sayNum(s.closing)
    };
    if (big) {
      v.amount = amt(big.amount, 'always');
      v.amountSay = sayNum(big.amount);
      v.description = noStop(YES.L(big.description));
      v.date = YES.fmt.date(big.postedAt, 'long');
    }
    var table = YES.i18n.dict[YES.i18n.lang] || {};
    return VID.cues.map(function (c, i) {
      var id = c.id;
      if ((id === 'largest' || id === 'what') && !big) id += 'None';
      var text = t('overview.video.cue.' + id, v);
      var sayKey = 'overview.video.say.' + (id === 'largest' ? (big.amount < 0 ? 'largestOut' : 'largestIn') : id);
      return {
        id: c.id,
        at: c.at,
        end: i + 1 < VID.cues.length ? VID.cues[i + 1].at : VID.lastCueEnd,
        ch: chapterAt(c.at),
        text: text,
        say: has(table, sayKey) ? t(sayKey, v) : text
      };
    });
  }

  /* --------------------------------------------------------- the stage */
  /**
   * Animation attributes, read once by buildAnims():
   *   i  — enters at (s): fades in, moving by fx ('up' default, 'left', 'right', 'fade')
   *   d  — entrance duration (s)
   *   o  — leaves at (s): fades out
   *   p  — [at, dur]: --p grows 0 → 1 (bar heights; on the phone frame, the
   *        journey receding under the transaction's detail)
   *   hl — [from, to]: --hl rises to 1 and falls back (highlights, pressed states)
   *   dim — recedes from (s) to a quieter opacity
   *   pt — a target the pointer can travel to
   */
  function att(o) {
    var out = '';
    if (o.i != null) out += ' data-in="' + r2(o.i) + '"';
    if (o.d != null) out += ' data-dur="' + r2(o.d) + '"';
    if (o.o != null) out += ' data-out="' + r2(o.o) + '"';
    if (o.fx) out += ' data-fx="' + o.fx + '"';
    if (o.p) out += ' data-p="' + r2(o.p[0]) + ':' + r2(o.p[1]) + '"';
    if (o.hl) out += ' data-hl="' + r2(o.hl[0]) + ':' + r2(o.hl[1]) + '"';
    if (o.dim != null) out += ' data-dim="' + r2(o.dim) + '"';
    if (o.pt) out += ' data-pt="' + o.pt + '"';
    return out;
  }
  function scene(i, cls, inner) {
    var at = VID.chapters[i].at;
    var end = sceneEnd(i);
    return '<div class="vs-scene ' + cls + '"' + att({ i: at, d: 0.45, fx: 'fade', o: end < VID.end ? end - 0.35 : null }) + '>' + inner + '</div>';
  }
  function eyebrow(i) {
    return (
      '<p class="vs-eyebrow"' +
      att({ i: VID.chapters[i].at + 0.15, fx: 'fade' }) +
      '><span class="vs-n">' +
      (i + 1) +
      '</span><span>' +
      esc(chapterTitle(i)) +
      '</span></p>'
    );
  }
  function logo() {
    return ui.logoHtml({ cls: 'vs-logo', decorative: true });
  }
  function dirIcon(minor, kind) {
    var dir = kind || (minor < 0 ? 'out' : 'in');
    var icon = dir === 'total' ? 'balance' : dir === 'out' ? 'arrow-out' : 'arrow-in';
    return '<span class="vs-dir vs-dir--' + dir + '">' + ui.icon(icon, { size: 16 }) + '</span>';
  }
  /** A signed figure without its unit, for the dense parts of the picture. */
  function figure(minor, sign) {
    return YES.fmt.amount(minor, { sign: sign || 'always', unit: false });
  }

  function sceneGreet(m) {
    var items = VID.chapters
      .slice(1)
      .map(function (c, i) {
        return '<li' + att({ i: 2.9 + i * 0.35, fx: 'left' }) + '><span class="vs-n">' + (i + 2) + '</span><span>' + esc(chapterTitle(i + 1)) + '</span></li>';
      })
      .join('');
    return scene(
      0,
      'vs-greet',
      '<div class="vs-greet__logo"' +
        att({ i: 0.15, fx: 'fade' }) +
        '>' +
        logo() +
        '</div>' +
        '<div class="vs-greet__text"><p class="vs-greet__hello"' +
        att({ i: 0.35 }) +
        '>' +
        esc(t('overview.video.posterHello', { name: m.s.customer.firstName })) +
        '</p><p class="vs-greet__sub"' +
        att({ i: C.period + 0.3 }) +
        '>' +
        esc(t('overview.video.greetSub', { period: periodText() })) +
        '</p></div>' +
        '<div class="vs-card vs-greet__agenda"' +
        att({ i: 2.6, fx: 'right' }) +
        '><p class="vs-label">' +
        esc(t('overview.video.inThis')) +
        '</p><ol class="vs-agenda">' +
        items +
        '</ol></div>'
    );
  }

  function sceneBalance(m) {
    var s = m.s;
    var end = sceneEnd(1);
    var afterIn = s.opening + m.inc;
    var afterOut = afterIn + m.out;
    var top = Math.max(1, s.opening, afterIn, afterOut, s.closing);
    function pc(v) {
      return r2((Math.max(0, v) / top) * 80);
    }
    var bars = [
      { kind: 'total', from: 0, to: s.opening, at: C.opening + 0.5, label: figure(s.opening, 'auto') },
      { kind: 'in', from: s.opening, to: afterIn, at: C.incoming + 0.3, label: figure(m.inc) },
      { kind: 'out', from: afterIn, to: afterOut, at: C.outgoing + 0.3, label: figure(m.out) },
      { kind: 'total', from: 0, to: s.closing, at: C.closing + 0.3, label: figure(s.closing, 'auto') }
    ];
    var hls = [
      [C.opening + 0.3, C.incoming],
      [C.incoming + 0.1, C.outgoing],
      [C.outgoing + 0.1, C.closing],
      [C.closing + 0.1, end]
    ];
    var plot = bars
      .map(function (b, i) {
        var lo = pc(Math.min(b.from, b.to));
        var hi = pc(Math.max(b.from, b.to));
        var x = 5 + i * 25;
        var link =
          i < bars.length - 1
            ? '<span class="vs-link" style="left:' + (x + 15) + '%;width:10%;bottom:' + pc(b.to) + '%"' + att({ i: bars[i + 1].at, d: 0.4, fx: 'fade' }) + '></span>'
            : '';
        return (
          '<span class="vs-bar vs-bar--' +
          b.kind +
          (b.to < b.from ? ' vs-bar--down' : '') +
          '" style="left:' +
          x +
          '%;bottom:' +
          lo +
          '%;height:' +
          Math.max(0.8, r2(hi - lo)) +
          '%"' +
          att({ i: b.at, d: 0.25, fx: 'fade', p: [b.at, 0.9], hl: hls[i] }) +
          '></span><span class="vs-bar__v" style="left:' +
          (x - 4) +
          '%;bottom:' +
          hi +
          '%"' +
          att({ i: b.at + 0.6, fx: 'fade' }) +
          '>' +
          esc(b.label) +
          '</span>' +
          link
        );
      })
      .join('');
    var rows = [
      { cls: 'total', icon: dirIcon(0, 'total'), label: t('cat.opening'), val: amt(s.opening), at: C.opening + 0.4 },
      { cls: 'in', icon: dirIcon(m.inc || 1), label: t('group.incoming'), val: figure(m.inc), at: C.incoming + 0.2 },
      { cls: 'out', icon: dirIcon(m.out || -1), label: t('group.outgoing'), val: figure(m.out), at: C.outgoing + 0.2 },
      { cls: 'closing', icon: dirIcon(0, 'total'), label: t('cat.closing'), val: amt(s.closing), at: C.closing + 0.2 }
    ]
      .map(function (r, i) {
        return (
          '<li class="vs-row vs-row--' +
          r.cls +
          '"' +
          att({ i: r.at, fx: 'left', hl: hls[i] }) +
          '>' +
          r.icon +
          '<span class="vs-row__label">' +
          esc(r.label) +
          '</span><span class="vs-row__val">' +
          esc(r.val) +
          '</span></li>'
        );
      })
      .join('');
    var net = YES.calc.netChange();
    return scene(
      1,
      'vs-bal',
      eyebrow(1) +
        '<div class="vs-card vs-bal__card"' +
        att({ i: C.opening + 0.15 }) +
        '><div class="vs-bal__side"><ul class="vs-rows">' +
        rows +
        '</ul><p class="vs-net"' +
        att({ i: C.closing + 1.4, fx: 'fade' }) +
        '>' +
        ui.icon(net < 0 ? 'trend-down' : net > 0 ? 'trend-up' : 'trend-flat', { size: 16 }) +
        '<span>' +
        esc(t('overview.journey.net')) +
        '</span><strong>' +
        esc(amt(net, 'always')) +
        '</strong></p></div>' +
        '<div class="vs-bal__chart"><div class="vs-plot"><span class="vs-plot__base"></span>' +
        plot +
        '</div></div></div>'
    );
  }

  function sceneLargest(m) {
    var big = m.big;
    var end = sceneEnd(2);
    if (!big) {
      return scene(2, 'vs-big', eyebrow(2) + '<div class="vs-card vs-big__none"' + att({ i: C.largest + 0.3 }) + '><p>' + esc(t('overview.video.cue.largestNone')) + '</p></div>');
    }
    var list = m.posted;
    var max = 1;
    list.forEach(function (tx) {
      max = Math.max(max, Math.abs(tx.amount));
    });
    var w = 100 / Math.max(1, list.length);
    var flagX = 50;
    var flagH = 0;
    var bars = list
      .map(function (tx, i) {
        var h = Math.max(1.5, r2((Math.abs(tx.amount) / max) * 40));
        var isMax = tx.id === big.id;
        var x = r2(i * w + w * 0.18);
        if (isMax) {
          flagX = r2(i * w + w / 2);
          flagH = h;
        }
        var at = C.largest + 0.3 + i * 0.06;
        return (
          '<span class="vs-mv vs-mv--' +
          (tx.amount < 0 ? 'out' : 'in') +
          (isMax ? ' is-max' : '') +
          '" style="left:' +
          x +
          '%;width:' +
          r2(w * 0.64) +
          '%;height:' +
          h +
          '%;' +
          (tx.amount < 0 ? 'top:50%' : 'bottom:50%') +
          '"' +
          att({ i: at, d: 0.3, fx: 'fade', p: [at, 0.5], dim: isMax ? null : C.largest + 1.6, hl: isMax ? [C.largest + 1.6, end] : null }) +
          '></span>'
        );
      })
      .join('');
    // The flag sits beside the bar's end, on whichever side has room.
    var side = flagX < 60 ? 'left:calc(' + r2(flagX + w * 0.32) + '% + 1cqw)' : 'right:calc(' + r2(100 - flagX + w * 0.32) + '% + 1cqw)';
    var flag =
      '<span class="vs-flag" style="' +
      side +
      ';' +
      (big.amount < 0 ? 'top:calc(50% + ' + flagH + '% - 3.2cqw)' : 'bottom:calc(50% + ' + flagH + '% - 3.2cqw)') +
      '"' +
      att({ i: C.largest + 1.8, fx: 'fade' }) +
      '>' +
      esc(figure(big.amount)) +
      '</span>';
    var dir = big.amount < 0 ? 'out' : 'in';
    return scene(
      2,
      'vs-big',
      eyebrow(2) +
        '<div class="vs-card vs-big__chart"' +
        att({ i: C.largest + 0.15 }) +
        '><p class="vs-label">' +
        esc(t('overview.video.everyMove')) +
        '</p><div class="vs-mvplot"><span class="vs-mvplot__base"></span>' +
        bars +
        flag +
        '</div><p class="vs-axis"><span>' +
        esc(YES.fmt.date(list[0].postedAt, 'short')) +
        '</span><span>' +
        esc(YES.fmt.date(list[list.length - 1].postedAt, 'short')) +
        '</span></p></div>' +
        '<div class="vs-card vs-big__tx"' +
        att({ i: C.largest + 1.2, fx: 'right' }) +
        '><div class="vs-big__head"><span class="vs-ico vs-ico--' +
        dir +
        '">' +
        ui.icon(ui.typeIcon(big.type), { size: 20 }) +
        '</span><p class="vs-label">' +
        esc(t('overview.insight.title')) +
        '</p></div><p class="vs-big__amt">' +
        esc(figure(big.amount)) +
        ' <span>' +
        esc(sym()) +
        '</span></p><p class="vs-big__desc"' +
        att({ i: C.what + 0.2, fx: 'fade' }) +
        '>' +
        esc(noStop(YES.L(big.description))) +
        '</p><dl class="vs-kv vs-kv--grid"' +
        att({ i: C.what + 0.7, fx: 'fade' }) +
        '><div class="vs-kv__row"' +
        att({ hl: [C.what + 2.2, C.what + 4.4] }) +
        '><dt>' +
        esc(t('term.postedDate')) +
        '</dt><dd>' +
        esc(YES.fmt.date(big.postedAt, 'medium')) +
        '</dd></div><div class="vs-kv__row"><dt>' +
        esc(t('overview.video.reference')) +
        '</dt><dd class="mono">' +
        esc(big.reference) +
        '</dd></div></dl></div>'
    );
  }

  /** The pointer's path in the walkthrough: [time, target] stops; moving between different targets. */
  function pointerPath() {
    return [
      [C.select + 0.8, 'rest'],
      [C.select + 1.9, 'step'],
      [C.open + 0.2, 'step'],
      [C.open + 0.9, 'row'],
      [C.open + 1.3, 'row'],
      [C.open + 2, 'aside'], // out of the way while the detail's facts are read
      [C.actions + 0.3, 'aside'],
      [C.actions + 0.95, 'explain'],
      [C.actions + 2.4, 'explain'],
      [C.actions + 3.05, 'ask']
    ];
  }
  var PRESS = function () {
    return [C.select + 2, C.open + 0.95, C.actions + 1, C.actions + 3.1];
  };

  function sceneInspect(m) {
    var end = sceneEnd(3);
    var press = PRESS();
    var cats = YES.calc.categories();
    var steps = cats
      .map(function (c) {
        var target = m.step && c.id === m.step.id;
        return (
          '<li class="vs-step"' +
          att({ hl: target ? [press[0], end] : null, pt: target ? 'step' : null }) +
          '>' +
          dirIcon(c.total || (c.group === 'outgoing' ? -1 : 1)) +
          '<span class="vs-step__label">' +
          esc(t('cat.' + c.id)) +
          '</span><span class="vs-step__val">' +
          esc(figure(c.total)) +
          '</span>' +
          (target ? '<span class="vs-step__check">' + ui.icon('check', { size: 14 }) + '</span>' : '') +
          '</li>'
        );
      })
      .join('');
    var shown = m.rows.slice(0, 4);
    var rows = shown
      .map(function (tx, i) {
        var target = m.tx && tx.id === m.tx.id;
        return (
          '<li class="vs-trow' +
          (target ? ' is-target' : '') +
          '"' +
          att({ i: C.rows - 0.1 + i * 0.25, fx: 'left', hl: target ? [press[1], C.open + 1.8] : null, pt: target ? 'row' : null }) +
          '><span class="vs-trow__date">' +
          esc(YES.fmt.date(tx.postedAt, 'short')) +
          '</span><span class="vs-trow__desc">' +
          esc(noStop(YES.L(tx.description))) +
          '</span><span class="vs-trow__amt">' +
          esc(figure(tx.amount)) +
          '</span></li>'
        );
      })
      .join('');
    var tx = m.tx;
    var feeTotal = sumOf(m.fees);
    var sheet = tx
      ? '<div class="vs-sheet"' +
        att({ i: press[1] + 0.25, d: 0.5, fx: 'right' }) +
        '><p class="vs-sheet__title">' +
        esc(noStop(YES.L(tx.description))) +
        '</p><p class="vs-sheet__amt"><span>' +
        esc(amt(tx.amount, 'always')) +
        '</span><span class="vs-status">' +
        ui.icon('check-circle', { size: 14 }) +
        esc(t('status.' + tx.status)) +
        '</span></p><div class="vs-kv vs-kv--grid">' +
        '<div class="vs-kv__row"' +
        att({ hl: [C.open + 1.7, C.open + 2.7] }) +
        '><span>' +
        esc(t('term.initiatedDate')) +
        '</span><span>' +
        esc(YES.fmt.date(tx.initiatedAt, 'datetime')) +
        '</span></div>' +
        '<div class="vs-kv__row"' +
        att({ hl: [C.open + 1.7, C.open + 2.7] }) +
        '><span>' +
        esc(t('term.postedDate')) +
        '</span><span>' +
        esc(YES.fmt.date(tx.postedAt, 'datetime')) +
        '</span></div>' +
        '<div class="vs-kv__row"' +
        att({ hl: [C.open + 2.5, C.open + 3.3] }) +
        '><span>' +
        esc(t('overview.video.reference')) +
        '</span><span class="mono">' +
        esc(tx.reference) +
        '</span></div>' +
        '<div class="vs-kv__row"' +
        att({ hl: [C.open + 3, C.actions + 0.3] }) +
        '><span>' +
        esc(t('type.fee')) +
        '</span><span>' +
        esc(m.fees.length ? amt(feeTotal, 'always') : t('overview.video.feeNone')) +
        '</span></div></div>' +
        '<div class="vs-actions"><span class="vs-spot vs-spot--aside" data-pt="aside"></span><span class="vs-btn vs-btn--ai"' +
        att({ hl: [press[2], press[3] - 0.2], pt: 'explain' }) +
        '>' +
        ui.icon('sparkle', { size: 14 }) +
        '<span>' +
        esc(t('explain.button')) +
        '</span></span><span class="vs-btn"' +
        att({ hl: [press[3], end], pt: 'ask' }) +
        '>' +
        ui.icon('chat', { size: 14 }) +
        '<span>' +
        esc(t('overview.video.ask')) +
        '</span></span></div></div>'
      : '';
    return scene(
      3,
      'vs-ins',
      eyebrow(3) +
        '<div class="vs-card vs-app"' +
        att({ i: C.select + 0.15 }) +
        '><div class="vs-app__journey"' +
        // On the phone frame the detail covers the journey too: it recedes as the list does.
        (tx ? att({ p: [press[1] + 0.05, 0.3] }) : '') +
        '><p class="vs-label">' +
        esc(t('overview.journey.title')) +
        '</p><ul class="vs-steps">' +
        steps +
        '</ul></div><div class="vs-app__panel"' +
        // While the detail slides in over it, the list beneath fades out, so no text shows through.
        (tx ? att({ o: press[1] + 0.15 }) : '') +
        '><p class="vs-hint"' +
        att({ o: press[0] + 0.15 }) +
        '>' +
        esc(t('overview.video.pick')) +
        '</p><p class="vs-label"' +
        att({ i: press[0] + 0.3, fx: 'fade' }) +
        '>' +
        // On a phone only the step's name is kept (the lead is left out).
        (m.step ? '<span class="vs-label__lead">' + esc(t('overview.panel.eyebrow')) + ' · </span>' + esc(t('cat.' + m.step.id)) : esc(t('overview.panel.eyebrow'))) +
        '</p><ul class="vs-trows">' +
        rows +
        '</ul>' +
        (m.step
          ? '<p class="vs-sum"' +
            att({ i: C.rows + 1.4, fx: 'fade', hl: [C.rows + 1.5, C.open] }) +
            '>' +
            ui.icon('check-circle', { size: 16 }) +
            '<span>' +
            esc(t('overview.panel.sum')) +
            '</span><strong>' +
            esc(amt(m.step.total, 'always')) +
            '</strong></p>'
          : '') +
        '</div>' +
        sheet +
        '<span class="vs-spot vs-spot--rest" data-pt="rest"></span></div><span class="vs-pointer" data-pointer></span>'
    );
  }

  function sceneHelp() {
    var sup = YES.config.support || {};
    var contact = [];
    if (sup.phone) contact.push(['phone', sup.phone]);
    if (sup.email) contact.push(['mail', sup.email]);
    contact.push(['file-down', t('record.button')]);
    return scene(
      4,
      'vs-help',
      '<div class="vs-help__cards"' +
        att({ o: C.bye - 0.2 }) +
        '>' +
        eyebrow(4) +
        '<div class="vs-card vs-help__ask"' +
        att({ i: C.help + 0.3, hl: [C.help + 0.6, C.help + 2.4] }) +
        '><span class="vs-ico vs-ico--ai">' +
        ui.icon('chat', { size: 20 }) +
        '</span><p class="vs-help__t">' +
        esc(t('ask.button')) +
        '</p><p class="vs-help__p">' +
        esc(t('overview.video.askBody')) +
        '</p><span class="vs-chip">' +
        ui.icon('sparkle', { size: 14 }) +
        '<span>' +
        esc(t('overview.video.askSample')) +
        '</span></span></div>' +
        '<div class="vs-card vs-help__help"' +
        att({ i: C.help + 0.8, hl: [C.help + 2.4, C.bye - 0.3] }) +
        '><span class="vs-ico vs-ico--help">' +
        ui.icon('question', { size: 20 }) +
        '</span><p class="vs-help__t">' +
        esc(t('nav.help')) +
        '</p><p class="vs-help__p">' +
        esc(t('overview.video.helpBody')) +
        '</p><ul class="vs-contact">' +
        contact
          .map(function (c) {
            return '<li>' + ui.icon(c[0], { size: 14 }) + '<span>' + esc(c[1]) + '</span></li>';
          })
          .join('') +
        '</ul></div></div>' +
        '<div class="vs-end"><div' +
        att({ i: C.bye + 0.3, fx: 'fade' }) +
        '>' +
        logo() +
        '</div><p class="vs-end__bye"' +
        att({ i: C.bye + 0.6 }) +
        '>' +
        esc(t('overview.video.bye')) +
        '</p><p class="vs-end__sig"' +
        att({ i: C.bye + 1.2 }) +
        '>' +
        esc(t('overview.video.sig', { month: monthText() })) +
        '</p><p class="vs-end__demo"' +
        att({ i: C.bye + 1.8, fx: 'fade' }) +
        '>' +
        esc(t('demo.badge')) +
        '</p></div>'
    );
  }

  function stageHtml(m) {
    return (
      '<div class="vp-stage" aria-hidden="true" data-vp="stage">' +
      '<div class="vs-chrome"' +
      att({ i: VID.chapters[1].at + 0.2, fx: 'fade', o: C.bye - 0.3 }) +
      '>' +
      logo() +
      '</div>' +
      sceneGreet(m) +
      sceneBalance(m) +
      sceneLargest(m) +
      sceneInspect(m) +
      sceneHelp(m) +
      '<div class="vp-cc" data-vp-cc hidden><span class="vp-cc__t"></span></div>' +
      '</div>'
    );
  }

  /* -------------------------------------------------------- the player */
  /** The approved recording for the current language, if packaged as a data: audio URI. */
  /*
   * Fingerprint of the narration script in the current language (FNV-1a over
   * each cue's id, timing and caption). A recording generated for this script
   * carries the same fingerprint (scripts/voiceover.mjs); if the statement's
   * figures or the wording change, the fingerprints differ and the outdated
   * recording is not played: the device voice narrates instead.
   */
  function scriptHash() {
    var cues = VP.cues && VP.cues.length && VP.cuesLang === YES.i18n.lang ? VP.cues : cueList(vidModel());
    var str = YES.i18n.lang + '\n' + cues
      .map(function (c) {
        return c.id + '|' + c.at + '|' + c.end + '|' + c.text;
      })
      .join('\n');
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return ('0000000' + h.toString(16)).slice(-8);
  }
  var staleWarned = {};
  /**
   * The packaged recording for the current language, or null. The slot holds a
   * data: audio URI, or { src, scriptHash, voice } as written by the build from
   * src/media (scriptHash must match this script, see scriptHash()).
   */
  function recordedSrc() {
    var slot = YES.config.slots && YES.config.slots.VIDEO_VOICEOVER;
    var v = slot && slot[YES.i18n.lang];
    var src = v && typeof v === 'object' ? v.src : v;
    if (typeof src !== 'string' || !/^data:audio\/[a-z0-9.+-]+[;,]/i.test(src)) return null;
    if (v && typeof v === 'object' && v.scriptHash && v.scriptHash !== scriptHash()) {
      if (!staleWarned[YES.i18n.lang] && root.console) {
        staleWarned[YES.i18n.lang] = true;
        console.warn('[YES] the ' + YES.i18n.lang + ' voiceover was recorded for a different script; using the device voice instead. Regenerate it with scripts/voiceover.mjs.');
      }
      return null;
    }
    return src;
  }

  function playerHtml(m) {
    var title = t('overview.video.title');
    var total = tc(VID.end);
    var posterSlot = YES.config.slots.VIDEO_POSTER;
    var rec = recordedSrc();
    var marks = VID.chapters
      .slice(1)
      .map(function (c) {
        return '<span style="left:' + r2((c.at / VID.end) * 100) + '%"></span>';
      })
      .join('');
    function btn(act, fk, label, icons, pressed) {
      return (
        '<button type="button" class="vp-btn vp-btn--' +
        act +
        '" data-vp="' +
        act +
        '" data-fk="' +
        fk +
        '" aria-label="' +
        esc(label) +
        '"' +
        (pressed == null ? '' : ' aria-pressed="' + pressed + '"') +
        '>' +
        icons +
        '</button>'
      );
    }
    function ic(name, cls) {
      return ui.icon(name, { size: 22, cls: cls });
    }
    // Rendered in its current state, so focus kept on a bar control survives a re-render.
    var at = VP.started ? VP.t : 0;
    var ccOn = ovState().cc !== false || !!VP.forcedCc[YES.i18n.lang];
    return (
      '<div class="vp' +
      (VP.started ? ' is-started' : '') +
      (VP.ended ? ' is-ended' : '') +
      '" data-vp-player role="region" aria-label="' +
      esc(t('overview.video.player', { title: title })) +
      '">' +
      '<div class="vp-screen">' +
      stageHtml(m) +
      // An approved poster may be packaged as a data: image; anything else would be a request.
      (typeof posterSlot === 'string' && /^data:image\//.test(posterSlot) ? '<img class="vp-posterimg" src="' + esc(posterSlot) + '" alt="">' : '') +
      '<button type="button" class="vp-big" data-vp="toggle" data-vp-big data-fk="vp-big" aria-label="' +
      esc(t('overview.video.playLabel', { title: title, time: total })) +
      '">' +
      ui.icon('play', { size: 30, cls: 'vp-i-play' }) +
      ui.icon('vp-replay', { size: 30, cls: 'vp-i-replay' }) +
      '</button>' +
      '<span class="vp-dur" aria-hidden="true">' +
      esc(total) +
      '</span></div>' +
      // In the order the controls sit on a wide player, so Tab follows what the eye sees.
      '<div class="vp-bar">' +
      btn('toggle', 'vp-toggle', t(VP.ended ? 'overview.video.replay' : 'overview.video.play'), ic('play', 'vp-i-play') + ic('vp-pause', 'vp-i-pause') + ic('vp-replay', 'vp-i-replay')) +
      btn('mute', 'vp-mute', t('overview.video.mute'), ic('vp-volume', 'vp-i-on') + ic('vp-muted', 'vp-i-off'), !!ovState().muted) +
      '<span class="vp-time" aria-hidden="true"><span data-vp-now>' +
      esc(tc(at)) +
      '</span> / ' +
      esc(total) +
      '</span>' +
      '<div class="vp-seek"><span class="vp-track" aria-hidden="true"><span class="vp-fill"></span><span class="vp-marks">' +
      marks +
      '</span></span><input type="range" class="vp-range" min="0" max="' +
      VID.end +
      '" step="0.1" value="' +
      r2(at) +
      '" data-vp-range data-fk="vp-seek" aria-label="' +
      esc(t('overview.video.seek')) +
      '" aria-valuetext="' +
      esc(seekText(at)) +
      '"></div>' +
      btn('cc', 'vp-cc', t('overview.video.cc'), ic('vp-cc'), ccOn) +
      btn('fs', 'vp-fs', t('overview.video.fs'), ic('vp-fs', 'vp-i-fs') + ic('vp-fs-exit', 'vp-i-fsx')) +
      '</div>' +
      (rec ? '<audio class="vp-audio" preload="auto" src="' + esc(rec) + '" data-vp-audio></audio>' : '') +
      '</div>'
    );
  }

  function seekText(sec) {
    var ch = chapterAt(sec);
    return t('overview.video.seekText', { now: tc(sec), total: tc(VID.end), n: ch + 1, chapter: chapterTitle(ch) });
  }

  function chaptersHtml() {
    return (
      '<div class="ov-vchap__wrap"><h3 class="ov-vchap__title" id="ov-vchap-title">' +
      esc(t('overview.video.chapters')) +
      '</h3><ol class="ov-vchap" aria-labelledby="ov-vchap-title">' +
      VID.chapters
        .map(function (c, i) {
          var title = chapterTitle(i);
          return (
            '<li><button type="button" class="ov-vchap__btn" data-vp-seek="' +
            c.at +
            '" data-vp-ch="' +
            i +
            '" data-fk="vp-ch-' +
            i +
            '" aria-label="' +
            esc(t('overview.video.chapterLabel', { n: i + 1, title: title, time: tc(c.at) })) +
            '"><span class="ov-vchap__n" aria-hidden="true">' +
            (i + 1) +
            '</span><span class="ov-vchap__name">' +
            esc(title) +
            '</span><span class="ov-vchap__time">' +
            esc(tc(c.at)) +
            '</span></button></li>'
          );
        })
        .join('') +
      '</ol></div>'
    );
  }

  function transcriptHtml(cues) {
    var open = !!ovState().transcript;
    return (
      '<details class="disclosure ov-vtr" data-ov-disclosure="transcript"' +
      (open ? ' open' : '') +
      '><summary data-fk="vp-transcript">' +
      ui.icon('book', { size: 18 }) +
      '<span>' +
      esc(t('overview.video.transcript')) +
      '</span></summary><div class="disclosure__body"><p class="ov-vtr__note">' +
      esc(t('overview.video.transcriptNote')) +
      '</p>' +
      VID.chapters
        .map(function (c, ci) {
          return (
            '<h4 class="ov-vtr__ch">' +
            esc(t('overview.video.chapterHead', { n: ci + 1, title: chapterTitle(ci) })) +
            '</h4><ol class="ov-vtr__list">' +
            cues
              .map(function (cue, i) {
                if (cue.ch !== ci) return '';
                return (
                  '<li><button type="button" class="ov-vtr__line" data-vp-seek="' +
                  cue.at +
                  '" data-vp-cue="' +
                  i +
                  '" data-fk="vp-cue-' +
                  i +
                  '"><span class="ov-vtr__time">' +
                  esc(tc(cue.at)) +
                  '</span><span class="ov-vtr__text">' +
                  esc(cue.text) +
                  '</span></button></li>'
                );
              })
              .join('') +
            '</ol>'
          );
        })
        .join('') +
      '</div></details>'
    );
  }

  function videoCardHtml(rec) {
    var title = t('overview.video.title');
    var time = tc(VID.end);
    var head =
      '<p class="card__eyebrow">' +
      esc(t('overview.video.eyebrow')) +
      '</p><h2 id="ov-video-title" class="ov-video__title">' +
      esc(title) +
      '</h2>';
    if (!rec.ok) {
      // The video's figures are the statement's: a statement that does not reconcile shows none.
      VP.cues = [];
      return '<section class="card ov-video" aria-labelledby="ov-video-title">' + head + '<p class="ov-video__desc">' + esc(t('overview.video.withheld')) + '</p></section>';
    }
    var m = vidModel();
    VP.cues = cueList(m);
    VP.cuesLang = YES.i18n.lang;
    return (
      '<section class="card ov-video" aria-labelledby="ov-video-title"><div class="ov-video__grid">' +
      '<div class="ov-video__media">' +
      playerHtml(m) +
      '</div>' +
      '<div class="ov-video__body">' +
      head +
      '<p class="ov-video__desc">' +
      esc(t('overview.video.desc', { month: monthText() })) +
      '</p>' +
      '<ul class="ov-video__meta">' +
      '<li>' +
      ui.icon('clock', { size: 16 }) +
      '<span>' +
      esc(t('overview.video.duration', { time: time })) +
      '</span></li>' +
      '<li>' +
      ui.icon('video', { size: 16 }) +
      '<span>' +
      esc(t('overview.video.optional')) +
      '</span></li></ul>' +
      '<p class="ov-video__honest">' +
      ui.illustrativeTag() +
      ' <span data-vp-honest>' +
      esc(t(recordedSrc() ? 'overview.video.honestRecorded' : 'overview.video.honest')) +
      '</span></p>' +
      '<p class="ov-video__voice" data-vp-note hidden>' +
      ui.icon('info', { size: 18 }) +
      '<span>' +
      esc(t('overview.video.noVoice')) +
      '</span></p>' +
      chaptersHtml() +
      '</div>' +
      transcriptHtml(VP.cues) +
      '</div></section>'
    );
  }

  /* ------------------------------------------------------ the runtime */
  var VP = {
    el: null, // the player ([data-vp-player]) currently in the page
    stage: null,
    cues: [],
    anims: [],
    ptr: null,
    targets: null,
    audio: null,
    t: 0,
    playing: false,
    started: false, // left the poster (played or sought)
    ended: false,
    raf: 0,
    last: 0,
    dragging: false,
    spokenCue: -1, // the cue the voice has handled on this pass
    shown: { sec: -1, cue: -2, ch: -2, cc: null },
    idle: 0,
    sp: { token: 0, speaking: false, cue: -1, holdAt: 0, calls: 0 }, // calls: speak() calls made
    audioFailed: {}, // language → the recording could not play: fall back to the device voice
    forcedCc: {} // language → captions were turned on because there is no voice
  };
  var VOICE = { settled: false, bound: false };

  function now() {
    return root.performance && root.performance.now ? root.performance.now() : Date.now();
  }
  function clamp01(x) {
    return x < 0 ? 0 : x > 1 ? 1 : x;
  }
  function easeOut(x) {
    return 1 - Math.pow(1 - x, 3);
  }
  function easeInOut(x) {
    return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
  }
  /** 0 → 1 from `at` over `dur` seconds (eased); a cut when dur is 0. */
  function ramp(t, at, dur) {
    if (!(dur > 0)) return t >= at ? 1 : 0;
    return easeOut(clamp01((t - at) / dur));
  }

  var MOVES = { up: [0, 1.6], left: [-2.4, 0], right: [3, 0] };
  function buildAnims(stage) {
    return ui.$$('[data-in],[data-out],[data-p],[data-hl],[data-dim]', stage).map(function (el) {
      function num(a) {
        var v = el.getAttribute(a);
        return v === null ? null : parseFloat(v);
      }
      function pair(a) {
        var v = el.getAttribute(a);
        if (v === null) return null;
        var p = v.split(':');
        return [parseFloat(p[0]), parseFloat(p[1])];
      }
      return { el: el, i: num('data-in'), d: num('data-dur'), o: num('data-out'), dim: num('data-dim'), fx: el.getAttribute('data-fx') || 'up', p: pair('data-p'), hl: pair('data-hl'), last: {} };
    });
  }
  function put(a, prop, val) {
    if (a.last[prop] === val) return;
    a.last[prop] = val;
    if (prop.charAt(0) === '-') a.el.style.setProperty(prop, val);
    else a.el.style[prop] = val;
  }
  /** One element at time t: a pure function of t (and of reduced motion). */
  function applyAnim(a, t, rm) {
    if (a.i !== null || a.o !== null || a.dim !== null) {
      var o = 1;
      var move = MOVES[a.fx];
      var k = 1;
      if (a.i !== null) {
        k = ramp(t, a.i, rm ? 0.3 : a.d || 0.55);
        o = k;
      }
      if (a.o !== null) o *= 1 - ramp(t, a.o, 0.35);
      if (a.dim !== null) o *= 1 - 0.62 * ramp(t, a.dim, 0.5);
      o = Math.round(o * 1000) / 1000;
      put(a, 'opacity', String(o));
      put(a, 'visibility', o <= 0 ? 'hidden' : '');
      if (move) {
        var off = rm ? 0 : 1 - k;
        put(a, 'transform', off > 0.0005 ? 'translate(' + r2(move[0] * off) + 'cqw,' + r2(move[1] * off) + 'cqw)' : '');
      }
    }
    if (a.p) put(a, '--p', String(rm ? (t >= a.p[0] ? 1 : 0) : Math.round(easeInOut(clamp01((t - a.p[0]) / a.p[1])) * 1000) / 1000));
    if (a.hl) {
      var d = rm ? 0.15 : 0.3;
      put(a, '--hl', String(Math.round(Math.min(ramp(t, a.hl[0], d), 1 - ramp(t, a.hl[1] - d, d)) * 1000) / 1000));
    }
  }

  /** Pointer targets as percentages of the stage, from the laid-out (untransformed) boxes. */
  function measureTargets() {
    var stage = VP.stage;
    if (!stage || !stage.clientWidth) return null;
    var W = stage.clientWidth;
    var H = stage.clientHeight;
    // Fixed spots on the 16:9 frame; the phone frame marks its own (.vs-spot).
    var out = { rest: { x: 72, y: 82 }, aside: { x: 87, y: 63 } };
    ui.$$('[data-pt]', stage).forEach(function (el) {
      if (!el.offsetParent) return; // not drawn in this frame
      var x = 0;
      var y = 0;
      var n = el;
      while (n && n !== stage) {
        x += n.offsetLeft;
        y += n.offsetTop;
        n = n.offsetParent;
      }
      var name = el.getAttribute('data-pt');
      // Point near the start of a row or button, clear of most of its words.
      var fx = name === 'step' ? 0.08 : name === 'row' ? 0.2 : 0.13;
      out[name] = { x: ((x + el.offsetWidth * fx) / W) * 100, y: ((y + el.offsetHeight * 0.55) / H) * 100 };
    });
    return out;
  }
  function drawPointer(t, rm) {
    var el = VP.ptr;
    if (!el) return;
    if (!VP.targets) VP.targets = measureTargets();
    var tg = VP.targets;
    var path = pointerPath();
    var o = ramp(t, path[0][0] - 0.3, 0.3) * (1 - ramp(t, sceneEnd(3) - 0.7, 0.3));
    el.style.opacity = String(Math.round(o * 1000) / 1000);
    el.style.visibility = o <= 0 || !tg ? 'hidden' : '';
    if (!tg) return;
    var pos = tg[path[0][1]];
    for (var k = 0; k < path.length - 1; k++) {
      var a = path[k];
      var b = path[k + 1];
      if (t < a[0]) break;
      var from = tg[a[1]] || pos;
      var to = tg[b[1]] || from;
      if (t >= b[0]) {
        pos = to;
        continue;
      }
      if (a[1] === b[1]) pos = from;
      else if (rm) pos = from; // a cut on arrival
      else {
        var q = easeInOut((t - a[0]) / (b[0] - a[0]));
        pos = { x: from.x + (to.x - from.x) * q, y: from.y + (to.y - from.y) * q };
      }
      break;
    }
    if (!pos) pos = tg.rest;
    el.style.left = r2(pos.x) + '%';
    el.style.top = r2(pos.y) + '%';
    var press = 0;
    PRESS().forEach(function (p) {
      var d = t - p;
      if (d >= 0 && d < 0.6) press = Math.max(press, Math.sin((d / 0.6) * Math.PI));
    });
    el.style.setProperty('--press', String(Math.round(press * 1000) / 1000));
  }

  /** The picture at time t. */
  function drawFrame(t) {
    var rm = ui.reducedMotion();
    for (var i = 0; i < VP.anims.length; i++) applyAnim(VP.anims[i], t, rm);
    drawPointer(t, rm);
  }
  function shownTime() {
    return VP.started ? VP.t : VID.poster;
  }
  function draw() {
    if (VP.el) drawFrame(shownTime());
  }

  function cueAt(t) {
    for (var i = VP.cues.length - 1; i >= 0; i--) if (t >= VP.cues[i].at && t < VP.cues[i].end) return i;
    return -1;
  }

  /* ---- narration */
  function synth() {
    try {
      return root.speechSynthesis || null;
    } catch (e) {
      return null;
    }
  }
  function normLang(s) {
    return String(s || '')
      .replace(/_/g, '-')
      .toLowerCase();
  }
  /**
   * The device voice for the current language: an exact locale, then the same
   * language. Offline voices only: a network voice (localService false, such
   * as Chrome's "Google …" voices) would send the narration, with the
   * statement's figures, off the device. Without one it plays with captions.
   */
  function voiceInfo() {
    var s = synth();
    if (!s || typeof root.SpeechSynthesisUtterance !== 'function') return { state: 'none' };
    var list;
    try {
      list = s.getVoices() || [];
    } catch (e) {
      list = [];
    }
    if (!list.length) return { state: VOICE.settled ? 'none' : 'pending' };
    var lang = YES.i18n.lang;
    var want = normLang(YES.i18n.locale());
    var exact = [];
    var same = [];
    for (var i = 0; i < list.length; i++) {
      var l = normLang(list[i].lang);
      if (l === want) exact.push(list[i]);
      else if (l.split('-')[0] === lang) same.push(list[i]);
    }
    function local(arr) {
      for (var j = 0; j < arr.length; j++) if (arr[j].localService) return arr[j];
      return null;
    }
    var v = local(exact) || local(same);
    return v ? { state: 'ready', voice: v } : { state: 'none' };
  }
  /** 'recorded' | 'voice' | 'pending' (voices still loading) | 'none'. */
  function mode() {
    if (VP.audio && recordedSrc() && !VP.audioFailed[YES.i18n.lang]) return 'recorded';
    var s = voiceInfo().state;
    return s === 'ready' ? 'voice' : s;
  }
  function watchVoices() {
    var s = synth();
    if (!s || VOICE.bound) return;
    VOICE.bound = true;
    var changed = function () {
      VOICE.settled = true;
      refreshVoice();
    };
    if (s.addEventListener) s.addEventListener('voiceschanged', changed);
    else s.onvoiceschanged = changed;
    // Some engines never announce their (empty) list: decide after a moment.
    setTimeout(function () {
      if (VOICE.settled) return;
      VOICE.settled = true;
      refreshVoice();
    }, 1500);
  }
  /** Voices arrived (or never will): captions on and mute off when there is none. */
  function refreshVoice() {
    if (!VP.el) return;
    var md = mode();
    var lang = YES.i18n.lang;
    if (md === 'none' && !VP.forcedCc[lang]) {
      VP.forcedCc[lang] = true;
      VP.cc = true;
    }
    if (md === 'voice' && VP.playing && VP.spokenCue >= 0 && !VP.sp.speaking) startCue();
    syncUi();
  }
  function speakCue(i) {
    if (!VP.playing || VP.muted || mode() !== 'voice') return;
    var s = synth();
    var cue = VP.cues[i];
    var info = voiceInfo();
    if (!s || !cue || info.state !== 'ready') return;
    try {
      if (VP.sp.speaking || s.speaking || s.pending) s.cancel();
    } catch (e) {
      /* the engine refused: speak anyway */
    }
    var u = new root.SpeechSynthesisUtterance(cue.say);
    u.lang = YES.i18n.locale();
    u.voice = info.voice;
    u.rate = 1;
    u.pitch = 1;
    var token = ++VP.sp.token;
    VP.sp.speaking = true;
    VP.sp.cue = i;
    VP.sp.holdAt = 0;
    u.onend = u.onerror = function () {
      if (token !== VP.sp.token) return;
      VP.sp.speaking = false;
      VP.sp.holdAt = 0;
    };
    VP.sp.calls++;
    try {
      s.speak(u);
    } catch (e) {
      VP.sp.speaking = false;
    }
  }
  /**
   * iOS Safari lets speech start from an animation frame only once speech has
   * been started inside a user gesture. So a Play, resume, chapter, transcript
   * (or unmute) gesture always speaks synchronously in its handler: the cue
   * due now (startCue, already called), or, when the playhead is past the
   * first 40% of a cue and nothing is due, a silent utterance (a space at
   * volume 0). `before` is VP.sp.calls when the handler began. Nothing is
   * spoken while paused or muted, or without a device voice for the language.
   */
  function gestureVoice(before) {
    if (VP.sp.calls !== before || !VP.playing || VP.muted) return;
    var md = mode();
    var s = synth();
    if ((md !== 'voice' && md !== 'pending') || !s) return;
    try {
      var u = new root.SpeechSynthesisUtterance(' ');
      u.volume = 0;
      u.lang = YES.i18n.locale();
      var info = voiceInfo();
      if (info.voice) u.voice = info.voice;
      VP.sp.calls++;
      s.speak(u);
    } catch (e) {
      /* no engine to unlock */
    }
  }
  function stopSpeech() {
    VP.sp.token++;
    VP.sp.speaking = false;
    VP.sp.cue = -1;
    VP.sp.holdAt = 0;
    var s = synth();
    if (s) {
      try {
        s.cancel();
      } catch (e) {
        /* nothing to stop */
      }
    }
  }
  /** After Play, a resume or a seek: read the cue under the playhead only from its first 40%. */
  function startCue() {
    var i = cueAt(VP.t);
    VP.spokenCue = i;
    if (i < 0 || !VP.playing) return;
    var c = VP.cues[i];
    if (VP.t - c.at <= VID.resumeShare * (c.end - c.at)) speakCue(i);
  }
  /** A slow voice holds the picture at the end of its cue (briefly), so it never runs into the next one. */
  function holdForVoice(next, n) {
    var sp = VP.sp;
    if (!sp.speaking || sp.cue < 0 || VP.muted || mode() !== 'voice') {
      sp.holdAt = 0;
      return next;
    }
    var end = VP.cues[sp.cue].end;
    if (next < end) return next;
    if (!sp.holdAt) sp.holdAt = n;
    if (n - sp.holdAt > VID.holdMs) return next;
    return Math.max(VP.t, end - 0.001);
  }

  /* ---- recorded voiceover */
  function audioUsable() {
    return !!VP.audio && mode() === 'recorded';
  }
  function audioCanSeek(a) {
    return !isFinite(a.duration) || VP.t < a.duration - 0.05;
  }
  function audioSeek() {
    var a = VP.audio;
    if (!audioUsable()) return;
    try {
      if (audioCanSeek(a)) a.currentTime = VP.t;
    } catch (e) {
      /* not seekable yet: play() starts from the default position */
    }
  }
  function audioFailed() {
    VP.audioFailed[YES.i18n.lang] = true;
    if (VP.audio) VP.audio.pause();
    syncUi();
    if (VP.playing) startCue(); // the device voice takes over
  }
  function audioPlay() {
    var a = VP.audio;
    if (!audioUsable()) return;
    a.muted = VP.muted;
    audioSeek();
    var p;
    try {
      p = a.play();
    } catch (e) {
      audioFailed();
      return;
    }
    if (p && p.catch)
      p.catch(function (err) {
        if (!err || err.name !== 'AbortError') audioFailed();
      });
  }
  function audioPause() {
    if (VP.audio && !VP.audio.paused) VP.audio.pause();
  }
  function audioDrift() {
    var a = VP.audio;
    if (!audioUsable() || a.paused) return;
    if (audioCanSeek(a) && Math.abs(a.currentTime - VP.t) > 0.3) {
      try {
        a.currentTime = VP.t;
      } catch (e) {
        /* try again on the next frame */
      }
    }
  }

  /* ---- transport */
  function schedule() {
    if (!VP.raf && VP.playing) VP.raf = root.requestAnimationFrame(tick);
  }
  function tick() {
    VP.raf = 0;
    if (!VP.playing || !VP.el || !VP.el.isConnected) return;
    var n = now();
    var dt = Math.min(0.25, Math.max(0, (n - VP.last) / 1000));
    VP.last = n;
    var next = holdForVoice(VP.t + dt, n);
    if (next >= VID.end) {
      finish();
      return;
    }
    VP.t = next;
    var i = cueAt(VP.t);
    if (i !== VP.spokenCue) {
      VP.spokenCue = i;
      if (i >= 0) speakCue(i);
    }
    audioDrift();
    drawFrame(VP.t);
    tickUi();
    schedule();
  }
  function vpPlay() {
    if (!VP.el || VP.playing) return;
    if (VP.ended || VP.t >= VID.end - 0.05) VP.t = 0;
    VP.ended = false;
    VP.started = true;
    VP.playing = true;
    VP.last = now();
    startCue();
    audioPlay();
    drawFrame(VP.t);
    syncUi();
    wake();
    schedule();
  }
  function vpPause() {
    if (VP.raf) root.cancelAnimationFrame(VP.raf);
    VP.raf = 0;
    var was = VP.playing;
    VP.playing = false;
    stopSpeech();
    audioPause();
    if (was) {
      syncUi();
      wake();
    }
  }
  function finish() {
    if (VP.raf) root.cancelAnimationFrame(VP.raf);
    VP.raf = 0;
    VP.t = VID.end;
    VP.playing = false;
    VP.ended = true;
    stopSpeech();
    audioPause();
    drawFrame(VP.t);
    syncUi();
    wake();
  }
  function vpToggle() {
    if (VP.playing) vpPause();
    else vpPlay();
  }
  function vpSeek(sec, opts) {
    if (!VP.el) return;
    VP.t = Math.max(0, Math.min(VID.end, sec));
    VP.started = true;
    stopSpeech();
    if (VP.t >= VID.end) {
      finish();
      return;
    }
    VP.ended = false;
    audioSeek();
    if (VP.playing) {
      VP.last = now();
      startCue();
    } else VP.spokenCue = cueAt(VP.t);
    drawFrame(VP.t);
    syncUi();
    wake();
    if (opts && opts.play) vpPlay();
  }
  function vpMute() {
    if (mode() === 'none') return;
    VP.muted = !VP.muted;
    setOv('muted', VP.muted);
    if (VP.audio) VP.audio.muted = VP.muted;
    if (VP.muted) stopSpeech();
    else if (VP.playing) startCue();
    syncUi();
  }
  function vpCc() {
    VP.cc = !VP.cc;
    setOv('cc', VP.cc);
    syncUi();
  }
  function fsEnabled() {
    return !!(doc.fullscreenEnabled || doc.webkitFullscreenEnabled);
  }
  function fsActive() {
    var f = doc.fullscreenElement || doc.webkitFullscreenElement || null;
    return !!f && f === VP.el;
  }
  function vpFs() {
    var p = VP.el;
    if (!p || !fsEnabled()) return;
    var r = null;
    try {
      if (fsActive()) {
        var exit = doc.exitFullscreen || doc.webkitExitFullscreen;
        if (exit) r = exit.call(doc);
      } else {
        var req = p.requestFullscreen || p.webkitRequestFullscreen;
        if (req) r = req.call(p);
      }
    } catch (e) {
      r = null;
    }
    if (r && r.catch) r.catch(function () {});
  }
  /* Full screen keeps the device's orientation: a phone held upright gets the
     portrait frame (the narrow player's layout), a wide screen the 16:9 one. */
  function onFullscreen() {
    if (!VP.el) return;
    VP.el.classList.toggle('is-fs', fsActive());
    VP.targets = null;
    draw();
    syncUi();
  }

  /** Activity shows the control bar; it hides again after a while of playing untouched. */
  function wake() {
    var p = VP.el;
    if (!p) return;
    p.classList.remove('is-idle');
    clearTimeout(VP.idle);
    if (!VP.playing) return;
    VP.idle = setTimeout(function () {
      if (VP.playing && VP.el === p && !p.querySelector(':focus-visible')) p.classList.add('is-idle');
    }, 2800);
  }

  /* ---- controls and text */
  function q(sel) {
    return VP.el ? VP.el.querySelector(sel) : null;
  }
  function setAttr(el, name, val) {
    if (el && el.getAttribute(name) !== val) el.setAttribute(name, val);
  }
  function syncUi() {
    var p = VP.el;
    if (!p) return;
    var md = mode();
    var title = t('overview.video.title');
    p.classList.toggle('is-started', VP.started);
    p.classList.toggle('is-playing', VP.playing);
    p.classList.toggle('is-ended', VP.ended);
    setAttr(
      q('[data-vp-big]'),
      'aria-label',
      VP.ended ? t('overview.video.replayLabel', { title: title }) : t('overview.video.playLabel', { title: title, time: tc(VID.end) })
    );
    setAttr(q('[data-fk="vp-toggle"]'), 'aria-label', t(VP.ended ? 'overview.video.replay' : VP.playing ? 'overview.video.pause' : 'overview.video.play'));
    var mute = q('[data-vp="mute"]');
    if (mute) {
      setAttr(mute, 'aria-pressed', String(VP.muted));
      mute.disabled = md === 'none';
    }
    setAttr(q('[data-vp="cc"]'), 'aria-pressed', String(VP.cc));
    var fs = q('[data-vp="fs"]');
    if (fs) {
      fs.hidden = !fsEnabled();
      setAttr(fs, 'aria-label', t(fsActive() ? 'overview.video.fsExit' : 'overview.video.fs'));
    }
    var card = p.closest('.ov-video');
    if (card) {
      var note = card.querySelector('[data-vp-note]');
      if (note) note.hidden = md !== 'none';
      var honest = card.querySelector('[data-vp-honest]');
      if (honest) honest.textContent = t(md === 'recorded' ? 'overview.video.honestRecorded' : md === 'none' ? 'overview.video.honestSilent' : 'overview.video.honest');
    }
    VP.shown = { sec: -1, cue: -2, ch: -2, cc: null };
    tickUi();
  }
  /** Time, slider, captions and the current chapter / transcript line (only what changed). */
  function tickUi() {
    var p = VP.el;
    if (!p) return;
    var sec = VP.started ? VP.t : 0;
    var range = q('[data-vp-range]');
    if (range && !VP.dragging) range.value = String(r2(sec));
    var seek = q('.vp-seek');
    if (seek) seek.style.setProperty('--pct', r2((sec / VID.end) * 100) + '%');
    var whole = Math.floor(sec + 1e-6);
    if (whole !== VP.shown.sec) {
      VP.shown.sec = whole;
      var nowEl = q('[data-vp-now]');
      if (nowEl) nowEl.textContent = tc(sec);
      setAttr(range, 'aria-valuetext', seekText(sec));
    }
    var ci = VP.started && !VP.ended ? cueAt(sec) : -1;
    if (ci !== VP.shown.cue || VP.cc !== VP.shown.cc) {
      VP.shown.cue = ci;
      VP.shown.cc = VP.cc;
      var cc = q('[data-vp-cc]');
      if (cc) {
        cc.hidden = !(VP.cc && ci >= 0);
        cc.firstChild.textContent = ci >= 0 ? VP.cues[ci].text : '';
      }
      var card = p.closest('.ov-video');
      if (card) {
        ui.$$('[data-vp-cue]', card).forEach(function (b) {
          var on = +b.getAttribute('data-vp-cue') === ci;
          b.classList.toggle('is-current', on);
          if (on) b.setAttribute('aria-current', 'true');
          else b.removeAttribute('aria-current');
        });
      }
    }
    var ch = VP.started ? chapterAt(sec) : -1;
    if (ch !== VP.shown.ch) {
      VP.shown.ch = ch;
      var c2 = p.closest('.ov-video');
      if (c2) {
        ui.$$('[data-vp-ch]', c2).forEach(function (b) {
          if (+b.getAttribute('data-vp-ch') === ch) b.setAttribute('aria-current', 'true');
          else b.removeAttribute('aria-current');
        });
      }
    }
  }

  /** After each render: find the new player, read its animations and redraw at the playhead. */
  function vpBind() {
    var p = doc.querySelector('#overview-root [data-vp-player]');
    VP.el = p;
    if (!p) {
      VP.stage = VP.ptr = VP.audio = null;
      VP.anims = [];
      return;
    }
    VP.stage = p.querySelector('.vp-stage');
    VP.anims = buildAnims(VP.stage);
    VP.ptr = VP.stage.querySelector('[data-pointer]');
    VP.targets = null;
    VP.audio = p.querySelector('[data-vp-audio]');
    VP.cc = ovState().cc !== false;
    VP.muted = !!ovState().muted;
    if (mode() === 'none') VP.cc = true;
    if (VP.audio) {
      VP.audio.muted = VP.muted;
      VP.audio.addEventListener('error', audioFailed);
    }
    p.classList.toggle('is-fs', fsActive());
    draw();
    syncUi();
  }

  /** Keys inside the player (a focused button keeps Space and Enter for itself). */
  function onPlayerKey(e) {
    var p = e.target.closest && e.target.closest('[data-vp-player]');
    if (!p || e.ctrlKey || e.metaKey || e.altKey) return;
    var onRange = e.target.matches('[data-vp-range]');
    var onButton = e.target.tagName === 'BUTTON';
    var k = e.key;
    var to = null;
    if (onRange) {
      if (k === 'ArrowLeft' || k === 'ArrowDown') to = VP.t - 5;
      else if (k === 'ArrowRight' || k === 'ArrowUp') to = VP.t + 5;
      else if (k === 'Home') to = 0;
      else if (k === 'End') to = VID.end;
      else if (k === 'PageUp' || k === 'PageDown') {
        var ch = chapterAt(VP.started ? VP.t : 0);
        if (k === 'PageUp') to = ch + 1 < VID.chapters.length ? VID.chapters[ch + 1].at : VID.end;
        else to = VP.t - VID.chapters[ch].at > 1 ? VID.chapters[ch].at : VID.chapters[Math.max(0, ch - 1)].at;
      }
    } else if (k === 'ArrowLeft') to = VP.t - 5;
    else if (k === 'ArrowRight') to = VP.t + 5;
    if (to === null) {
      if (k === 'j' || k === 'J') to = VP.t - 10;
      else if (k === 'l' || k === 'L') to = VP.t + 10;
    }
    var spoke = VP.sp.calls;
    if (to !== null) {
      e.preventDefault();
      vpSeek(to);
      gestureVoice(spoke);
      return;
    }
    if ((k === ' ' && !onButton) || k === 'k' || k === 'K') vpToggle();
    else if (k === 'm' || k === 'M') vpMute();
    else if (k === 'c' || k === 'C') vpCc();
    else if (k === 'f' || k === 'F') vpFs();
    else return;
    e.preventDefault();
    gestureVoice(spoke);
    wake();
  }

  /** Delegated events for the player, chapters and transcript (bound once, from init). */
  function bindPlayer(el) {
    ui.delegate(el, 'click', '[data-vp]', function (e, b) {
      var act = b.getAttribute('data-vp');
      var spoke = VP.sp.calls;
      if (act === 'toggle' || act === 'stage') {
        var fromBig = b.hasAttribute('data-vp-big');
        vpToggle();
        gestureVoice(spoke);
        // The big button goes away once playing: carry focus to Pause.
        if (fromBig && VP.playing && doc.activeElement === b) {
          var tg = q('[data-fk="vp-toggle"]');
          if (tg) tg.focus({ preventScroll: true });
        }
      } else if (act === 'mute') {
        vpMute();
        gestureVoice(spoke);
      } else if (act === 'cc') vpCc();
      else if (act === 'fs') vpFs();
    });
    ui.delegate(el, 'click', '[data-vp-seek]', function (e, b) {
      var spoke = VP.sp.calls;
      vpSeek(parseFloat(b.getAttribute('data-vp-seek')), { play: true });
      gestureVoice(spoke);
      var p = VP.el;
      if (p && p.getBoundingClientRect) {
        var r = p.getBoundingClientRect();
        // The sticky masthead covers the top of the window (the page's scroll padding).
        var top = parseFloat(root.getComputedStyle(doc.documentElement).scrollPaddingTop) || 0;
        if (r.top < top || r.bottom > (root.innerHeight || 0)) p.scrollIntoView({ block: 'nearest', behavior: ui.reducedMotion() ? 'auto' : 'smooth' });
      }
    });
    el.addEventListener('input', function (e) {
      if (e.target.matches && e.target.matches('[data-vp-range]')) vpSeek(parseFloat(e.target.value));
    });
    el.addEventListener('pointerdown', function (e) {
      if (e.target.matches && e.target.matches('[data-vp-range]')) VP.dragging = true;
    });
    doc.addEventListener('pointerup', function () {
      if (!VP.dragging) return;
      VP.dragging = false;
      tickUi();
    });
    doc.addEventListener('pointercancel', function () {
      VP.dragging = false;
    });
    el.addEventListener('keydown', onPlayerKey);
    el.addEventListener('pointermove', function (e) {
      if (e.target.closest && e.target.closest('[data-vp-player]')) wake();
    });
    el.addEventListener('focusin', function (e) {
      if (e.target.closest && e.target.closest('[data-vp-player]')) wake();
    });
    doc.addEventListener('fullscreenchange', onFullscreen);
    doc.addEventListener('webkitfullscreenchange', onFullscreen);
    // Pause whenever the video is out of sight: another view, a hidden tab, a page being left.
    YES.on('view', function (v) {
      if (v !== 'overview') vpPause();
    });
    doc.addEventListener('visibilitychange', function () {
      if (doc.hidden) vpPause();
    });
    root.addEventListener('pagehide', function () {
      vpPause();
    });
    // A voice left speaking by an earlier page (some engines keep their queue) stops now.
    var s = synth();
    if (s) {
      try {
        s.cancel();
      } catch (e) {
        /* nothing queued */
      }
    }
    watchVoices();
  }

  /* Public API for the video (tests and other modules). */
  var videoApi = {
    play: vpPlay,
    pause: vpPause,
    seek: function (sec, opts) {
      vpSeek(sec, opts);
    },
    state: function () {
      return {
        t: VP.t,
        playing: VP.playing,
        started: VP.started,
        ended: VP.ended,
        duration: VID.end,
        cue: VP.started ? cueAt(VP.t) : -1,
        chapter: VP.started ? chapterAt(VP.t) : -1,
        captions: VP.cc,
        muted: VP.muted,
        mode: mode()
      };
    },
    chapters: function () {
      return VID.chapters.map(function (c, i) {
        return { id: c.id, at: c.at, end: sceneEnd(i), title: chapterTitle(i) };
      });
    },
    cues: function () {
      return VP.cues.map(function (c) {
        return { id: c.id, at: c.at, end: c.end, chapter: c.ch, text: c.text, say: c.say };
      });
    },
    /** Fingerprint of the current language's narration script (see scriptHash()). */
    scriptHash: function () {
      return scriptHash();
    }
  };

  /* ------------------------------------------------------------------ */
  /* Chart interaction (pointer crosshair + keyboard points)             */
  /* ------------------------------------------------------------------ */
  function plotHost() {
    return doc.getElementById('ov-chart-plot');
  }

  function tipHtml(i) {
    var p = chart.pts[i];
    var same = chart.pts.filter(function (q, j) {
      return j !== i && q.at === p.at;
    }).length;
    return (
      '<p class="ov-tip__value">' +
      esc(amt(p.balance)) +
      '</p>' +
      '<p class="ov-tip__label">' +
      esc(t('overview.chart.balanceAfter')) +
      '</p>' +
      '<p class="ov-tip__row"><svg class="ov-tip__key" width="12" height="12" viewBox="0 0 14 14" aria-hidden="true" focusable="false"><path class="ov-mk ov-mk--' +
      (p.delta < 0 ? 'out' : 'in') +
      '" d="' +
      triPath(7, p.delta < 0 ? 6.5 : 7.5, p.delta >= 0) +
      '"/></svg><span><strong>' +
      esc(amt(p.delta, 'always')) +
      '</strong> ' +
      esc(ui.typeLabel(p.tx)) +
      '</span></p>' +
      '<p class="ov-tip__meta">' +
      ui.maskedHtml(YES.L(p.tx.counterparty)) +
      '</p>' +
      '<p class="ov-tip__meta">' +
      esc(YES.fmt.date(p.iso, 'datetime')) +
      '</p>' +
      (same ? '<p class="ov-tip__meta">' + esc(t('overview.chart.sameTime', { n: YES.fmt.count(same) })) + '</p>' : '') +
      '<p class="ov-tip__hint">' +
      esc(t('overview.chart.openHint')) +
      '</p>'
    );
  }

  function showTip(i) {
    var host = plotHost();
    if (!host || !chart.pts[i]) return;
    var tip = host.querySelector('.ov-tip');
    var cross = host.querySelector('.ov-cross');
    if (!tip || !cross) return;
    tip.innerHTML = tipHtml(i);
    tip.hidden = false;
    cross.hidden = false;
    var x = chart.xs[i];
    var y = chart.ys[i];
    cross.style.left = x + 'px';
    var tw = tip.offsetWidth;
    var th = tip.offsetHeight;
    var left = Math.max(0, Math.min(chart.w - tw, x - tw / 2));
    var top = y - th - 16;
    if (top < 0) top = y + 16;
    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
    ui.$$('.ov-mk', host).forEach(function (mk) {
      mk.classList.toggle('is-active', mk.getAttribute('data-i') === String(i));
    });
  }

  function hideTip() {
    var host = plotHost();
    if (!host) return;
    var tip = host.querySelector('.ov-tip');
    var cross = host.querySelector('.ov-cross');
    if (tip) tip.hidden = true;
    if (cross) cross.hidden = true;
    ui.$$('.ov-mk.is-active', host).forEach(function (mk) {
      mk.classList.remove('is-active');
    });
  }

  function pointFocused() {
    var a = doc.activeElement;
    return !!(a && a.closest && a.closest('[data-ov-pt]'));
  }

  /** Nearest point by x; among same-time points prefer the movement over its fee, then the closest y. */
  function nearestAt(clientX, clientY) {
    var host = plotHost();
    if (!host || !chart.pts.length) return -1;
    var r = host.getBoundingClientRect();
    var px = clientX - r.left;
    var py = clientY - r.top;
    var best = -1;
    var bdx = Infinity;
    for (var i = 0; i < chart.xs.length; i++) {
      var dx = Math.abs(chart.xs[i] - px);
      if (best === -1 || dx < bdx - 0.5) {
        best = i;
        bdx = dx;
      } else if (Math.abs(dx - bdx) <= 0.5) {
        var feeI = chart.pts[i].tx.type === 'fee';
        var feeB = chart.pts[best].tx.type === 'fee';
        if ((feeB && !feeI) || (feeB === feeI && Math.abs(chart.ys[i] - py) < Math.abs(chart.ys[best] - py))) {
          best = i;
          bdx = dx;
        }
      }
    }
    return best;
  }

  function pointButton(i) {
    var host = plotHost();
    return host ? host.querySelector('[data-ov-pt="' + i + '"]') : null;
  }

  function setRoving(i) {
    chart.focusIdx = i;
    var host = plotHost();
    if (!host) return;
    ui.$$('[data-ov-pt]', host).forEach(function (b) {
      b.setAttribute('tabindex', b.getAttribute('data-ov-pt') === String(i) ? '0' : '-1');
    });
  }

  function onPointKey(e, b) {
    var i = +b.getAttribute('data-ov-pt');
    var n = chart.pts.length;
    var j = null;
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        j = Math.min(n - 1, i + 1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        j = Math.max(0, i - 1);
        break;
      case 'Home':
        j = 0;
        break;
      case 'End':
        j = n - 1;
        break;
      case 'Escape':
        hideTip();
        return;
      default:
        return;
    }
    e.preventDefault();
    setRoving(j);
    var next = pointButton(j);
    if (next) next.focus();
  }

  /* ------------------------------------------------------------------ */
  /* Actions                                                             */
  /* ------------------------------------------------------------------ */
  function idOf(tx) {
    return tx.id;
  }
  /** Posted transactions in the chart's (chronological) order. */
  function runningIds() {
    return YES.calc.running().map(function (p) {
      return p.txId;
    });
  }
  /**
   * The list a transaction is opened from, in display order, so the detail's
   * Previous / Next stay within it: the selected step's rows, the fee lines, or
   * the running balance (chart points, its table, the low-data list). A single
   * transaction (the pending notice, the insight) has no list of its own.
   */
  function listFor(el) {
    if (!el || !el.closest) return null;
    if (el.closest('.ov-chart, .ov-ctable, .ov-lowlist')) return runningIds();
    if (el.closest('#ov-panel-section')) {
      var info = selectionInfo(YES.state.journeyStep);
      return info ? rowsFor(info.txIds).map(idOf) : null;
    }
    if (el.closest('.ov-fees')) {
      var cat = YES.calc.category('fees');
      return cat ? rowsFor(cat.txIds).map(idOf) : null;
    }
    return null;
  }
  function openTx(id, trigger, list) {
    var opts = { trigger: trigger };
    list = list || listFor(trigger);
    if (list && list.length) opts.list = list;
    YES.explorer.openTx(id, opts);
  }

  /** Hand over to the Transactions view with the given filter (fresh, not merged). */
  function showInTransactions(partial) {
    YES.explorer.applyFilter(partial, { reset: true });
    if (YES.state.view !== 'transactions') YES.nav.go('transactions');
  }

  /* ------------------------------------------------------------------ */
  /* Render                                                              */
  /* ------------------------------------------------------------------ */
  function viewHtml() {
    var rec = YES.calc.reconcile(YES.data);
    return headerHtml() + balanceHtml() + journeySectionHtml(rec) + whyHtml(rec) + videoCardHtml(rec);
  }

  function render() {
    var el = doc.getElementById('overview-root');
    if (!el) return;
    // A full re-render (a language switch) pauses the video and keeps its playhead.
    if (VP.playing) vpPause();
    ui.render(el, viewHtml());
    vpBind();
    placePanel(); // the first render cannot know the layout before the journey exists
    var host = plotHost();
    if (host && host.clientWidth && (!host.firstChild || Math.abs(host.clientWidth - chart.lastW) >= 1)) renderPlot();
    if (observer) {
      observer.disconnect();
      if (host) observer.observe(host);
      var body = doc.getElementById('ov-journey-body');
      if (body) observer.observe(body);
      if (VP.stage) observer.observe(VP.stage);
    }
  }

  /* Public API (replaces the stubs in 04-core.js). */
  YES.overview = {
    /** Select a journey step or group; navigates to Overview and moves focus to the transactions panel. */
    selectStep: function (stepId) {
      return select(stepId, { navigate: true, focusPanel: true });
    },
    /** Clear the journey selection. */
    clearStep: function () {
      clearSelection({ returnFocus: false });
    },
    /** "Your statement in 60 seconds": play(), pause(), seek(seconds, { play }), state(), chapters(), cues(). */
    video: videoApi
  };

  YES.register({
    name: 'overview',
    i18n: {
      en: {
        'overview.title': 'Your {month} statement',
        'overview.handshake':
          'Hello, {name}. Here is your YES activity for {period}. Start with the highlights, then explore any movement you would like to understand. If something does not look right, we are here to help.',
        'overview.help': 'Get help',

        'overview.balance.unitLine': '{unit} of {asset}',
        'overview.balance.changeLabel': 'Net change this period',
        'overview.balance.change': 'Since your opening balance of {opening} on {date}.',
        'overview.fiat.label': '{currency} equivalent',
        'overview.fiat.detail': 'Rate 1 {symbol} = {rate} {currency} · Source: {source} · {date}. Shown for reference only; it is not a guarantee of value.',
        'overview.actions.explore': 'Explore transactions',
        'overview.actions.explain': 'Explain this balance',
        'overview.actions.explainLabel': 'Explain this balance with AI',

        'overview.notIn.pending1': '1 pending transaction ({amount}) is not included in this balance.',
        'overview.notIn.pendingN': '{n} pending transactions ({amount} in total) are not included in this balance.',
        'overview.notIn.other1': '1 transaction that is not posted ({amount}) is not included in this balance.',
        'overview.notIn.otherN': '{n} transactions that are not posted ({amount} in total) are not included in this balance.',
        'overview.notIn.detail': '{description} · initiated {date}',
        'overview.notIn.view': 'View transaction',
        'overview.notIn.viewAll': 'Show them in Transactions',
        'overview.notIn.listLabel': 'Not included in this balance',

        'overview.details.summary': 'Statement details',
        'overview.details.statement': 'Statement',
        'overview.details.dates': 'Period and dates',
        'overview.details.id': 'Statement ID',
        'overview.details.version': 'Version',
        'overview.details.status': 'Issue status',
        'overview.issue.original': 'Original',
        'overview.issue.corrected': 'Corrected',
        'overview.details.account': 'Account',
        'overview.details.accountId': 'Account number',
        'overview.details.wallet': 'Wallet',
        'overview.details.masked': 'Masked',
        'overview.details.asset': 'Asset',
        'overview.details.assetValue': '{name} ({symbol}), {precision} decimal places',
        'overview.details.start': 'Period start',
        'overview.details.end': 'Period end',
        'overview.details.asOf': 'Statement as of',
        'overview.details.generated': 'Generated',
        'overview.details.timezone': 'Timezone',
        'overview.details.dateBasis': 'Date basis',
        'overview.details.maskNote': 'Account and wallet identifiers are masked to protect your account. Showing them in full is not available in this statement.',

        'overview.journey.title': 'Balance journey',
        'overview.journey.lede': 'How your balance moved from {opening} to {closing}, with this period’s movements grouped by type. Select any step to see the transactions behind it.',
        'overview.journey.unit': 'Amounts in {symbol} {unit}',
        'overview.journey.legendLabel': 'Legend',
        'overview.journey.legendIn': 'Adds to balance',
        'overview.journey.legendOut': 'Reduces balance',
        'overview.journey.legendTotal': 'Opening and closing balance',
        'overview.journey.stepsLabel': 'Balance journey steps',
        'overview.journey.subtotal': 'Running subtotal after this step: {amount}',
        'overview.journey.selected': '{label} selected: {count}, {amount}. The transactions are listed below.',
        'overview.journey.cleared': 'Selection cleared. The full journey is shown.',
        'overview.journey.eqTitle': 'In numbers',
        'overview.journey.equals': 'equals',
        'overview.journey.table': 'Show the journey as a table',
        'overview.journey.caption': 'Balance journey, {period}. Amounts in {symbol}.',
        'overview.journey.byType':
          'Steps are grouped by type, not by date, so the subtotals between the opening and closing balance are not balances your account held. For your balance on each date, see Running balance.',
        'overview.journey.colStep': 'Step',
        'overview.journey.colChange': 'Change',
        'overview.journey.colAfter': 'Running subtotal',
        'overview.journey.colCount': 'Transactions',
        'overview.journey.net': 'Net change',
        'overview.journey.exTitle': 'The balance journey can’t be shown',
        'overview.journey.exBody':
          'The opening balance plus this period’s posted movements does not equal the closing balance. Rather than show figures that could be wrong, the journey and chart are withheld. Nothing has been rounded or adjusted to hide the difference.',

        'overview.panel.eyebrow': 'Transactions behind this step',
        'overview.panel.eyebrowGroup': 'Transactions behind this group',
        'overview.panel.order': 'Listed by posted date',
        'overview.panel.colDate': 'Posted',
        'overview.panel.colType': 'Type',
        'overview.panel.colCounterparty': 'Counterparty',
        'overview.panel.colAmount': 'Amount',
        'overview.panel.open': 'open details',
        'overview.panel.sum': 'Sum of these rows',
        'overview.panel.matches': 'Matches {label} in the journey',
        'overview.panel.mismatch': 'Does not match the journey value of {amount}',
        'overview.panel.empty': 'No transactions contributed to this step in this period.',
        'overview.panel.show': 'Show in Transactions',
        'overview.panel.clear': 'Clear selection',

        'overview.why.title': 'Why it changed',
        'overview.why.lede': 'When your balance moved, what moved it, and what it cost.',
        'overview.why.withheld': 'The running-balance chart, fees summary and insights are withheld because this statement does not reconcile.',
        'overview.chart.title': 'Running balance',
        'overview.chart.lede': 'Your balance after each posted transaction, {period}. Select a point to open that transaction.',
        'overview.chart.legendLine': 'Balance',
        'overview.chart.legendIn': 'Incoming transaction',
        'overview.chart.legendOut': 'Outgoing transaction or fee',
        'overview.chart.summary': 'Your balance was highest at {max} on {maxDate} and lowest at {min} on {minDate}. It closed the period at {closing}.',
        'overview.chart.pointsLabel': 'Chart points, one per posted transaction. Use the arrow keys to move between them.',
        'overview.chart.point': '{date}: {type}, {amount}, {counterparty}. Balance after: {balance}. Opens the transaction.',
        'overview.chart.balanceAfter': 'Balance after',
        'overview.chart.sameTime': '+{n} more at the same time',
        'overview.chart.openHint': 'Select to open the transaction',
        'overview.chart.table': 'Show the chart data as a table',
        'overview.chart.caption': 'Balance after each posted transaction, {period}. Amounts in {symbol}.',
        'overview.chart.colTx': 'Transaction',
        'overview.chart.colAfter': 'Balance after',
        'overview.chart.low': 'With only {count} this period, a chart would not be meaningful. Here is each change instead.',
        'overview.chart.none': 'No transactions were posted this period, so your balance stayed at {amount}.',
        'overview.chart.after': 'Balance after: {amount}',

        'overview.fees.title': 'Fees this period',
        'overview.fees.total': 'Total fees',
        'overview.fees.count1': '1 fee',
        'overview.fees.countN': '{n} fees',
        'overview.fees.note': 'Each fee is its own ledger line, linked to the transaction it belongs to.',
        'overview.fees.none': 'No fees were charged this period.',
        'overview.fees.foreignNone': 'Fees in other assets: none',
        'overview.fees.foreign': 'Fees in other assets, shown separately and not part of the balance journey:',
        'overview.fees.show': 'Show fees in the journey',

        'overview.insight.eyebrow': 'Insight',
        'overview.insight.title': 'Your largest movement',
        'overview.insight.body': 'The largest single movement this period was {amount} on {date}: {description}.',
        'overview.insight.view': 'View this transaction',
        'overview.insight.learn': 'What are token units?',

        'overview.video.eyebrow': 'Personalized video',
        'overview.video.title': 'Your statement in 60 seconds',
        'overview.video.desc': 'A short, personal walkthrough of your {month} balance, your largest movement and where to get help.',
        'overview.video.duration': 'Duration {time}',
        'overview.video.optional': 'Optional; it never plays on its own',
        'overview.video.honest': 'An animated walkthrough built from this statement’s sample figures, narrated by your device’s built-in voice.',
        'overview.video.honestRecorded': 'An animated walkthrough built from this statement’s sample figures, narrated by a recorded voiceover.',
        'overview.video.honestSilent': 'An animated walkthrough built from this statement’s sample figures, with captions.',
        'overview.video.noVoice': 'Voiceover isn’t available in this language on this device — captions are on.',
        'overview.video.withheld': 'This video is withheld because the statement does not reconcile.',
        'overview.video.player': 'Video player: {title}',
        'overview.video.playLabel': 'Play video: {title} ({time})',
        'overview.video.replayLabel': 'Replay video: {title}',
        'overview.video.play': 'Play',
        'overview.video.pause': 'Pause',
        'overview.video.replay': 'Replay',
        'overview.video.seek': 'Video position',
        'overview.video.seekText': '{now} of {total}, chapter {n}: {chapter}',
        'overview.video.mute': 'Mute voiceover',
        'overview.video.cc': 'Captions',
        'overview.video.fs': 'Full screen',
        'overview.video.fsExit': 'Exit full screen',
        'overview.video.chapters': 'Chapters',
        'overview.video.chapterLabel': 'Chapter {n}, {title}, {time}. Plays from here.',
        'overview.video.chapterHead': 'Chapter {n}: {title}',
        'overview.video.transcript': 'Transcript',
        'overview.video.transcriptNote': 'Select a line to play the video from there.',
        'overview.video.ch.greet': 'Personal greeting',
        'overview.video.ch.balance': 'Opening and closing balance',
        'overview.video.ch.largest': 'Largest meaningful movement',
        'overview.video.ch.inspect': 'How to inspect a transaction',
        'overview.video.ch.help': 'Where to get help',
        'overview.video.posterHello': 'Hello, {name}',
        'overview.video.greetSub': 'Your YES statement for {period}',
        'overview.video.inThis': 'In this video',
        'overview.video.everyMove': 'Every posted movement',
        'overview.video.reference': 'Reference',
        'overview.video.pick': 'Select a step to see its transactions',
        'overview.video.feeNone': 'None',
        'overview.video.ask': 'Ask about this transaction',
        'overview.video.askBody': 'Answers about any figure, from this statement.',
        'overview.video.askSample': 'Why did my balance change?',
        'overview.video.helpBody': 'Contact options and your statement record.',
        'overview.video.bye': 'We are here to help.',
        'overview.video.sig': 'Your YES statement · {month}',
        /* Captions: one short sentence per cue, with the figures as the statement shows them. */
        'overview.video.cue.hello': 'Hello, {name}.',
        'overview.video.cue.period': 'This is your YES statement for {period}.',
        'overview.video.cue.opening': 'You started the period with {opening}.',
        'overview.video.cue.incoming': 'Incoming activity added {incoming}.',
        'overview.video.cue.outgoing': 'Outgoing activity and fees took away {outgoing}.',
        'overview.video.cue.closing': 'You closed the period with {closing}.',
        'overview.video.cue.largest': 'Your largest single movement was {amount}.',
        'overview.video.cue.largestNone': 'There were no movements this period.',
        'overview.video.cue.what': '{description}, posted on {date}.',
        'overview.video.cue.whatNone': 'Your balance stayed at {closing}.',
        'overview.video.cue.select': 'Select any step of your balance journey.',
        'overview.video.cue.rows': 'Its transactions appear, and they add up exactly.',
        'overview.video.cue.open': 'Open one to check its dates, reference and fees.',
        'overview.video.cue.actions': 'From there, use Explain with AI or Ask about this transaction.',
        'overview.video.cue.help': 'Questions? Ask YES, or open Help to contact us.',
        'overview.video.cue.bye': 'If something does not look right, we are here to help.',
        /* What the voice says where a caption would read badly aloud ("EXUSD", grouped decimals). */
        'overview.video.say.period': 'This is your YES statement for {month}.',
        'overview.video.say.opening': 'You started the period with {openingSay} tokens.',
        'overview.video.say.incoming': 'Incoming activity added {incomingSay}.',
        'overview.video.say.outgoing': 'Outgoing activity and fees took away {outgoingSay}.',
        'overview.video.say.closing': 'You closed the period with {closingSay} tokens.',
        'overview.video.say.largestIn': 'Your largest single movement added {amountSay} tokens.',
        'overview.video.say.largestOut': 'Your largest single movement took away {amountSay} tokens.'
      },
      es: {
        'overview.title': 'Tu estado de cuenta de {month}',
        'overview.handshake':
          'Hola, {name}. Aquí tienes tu actividad de YES del {period}. Empieza por lo esencial y explora cualquier movimiento que quieras entender mejor. Si algo no te cuadra, estamos aquí para ayudarte.',
        'overview.help': 'Obtener ayuda',

        'overview.balance.unitLine': '{unit} de {asset}',
        'overview.balance.changeLabel': 'Cambio neto del período',
        'overview.balance.change': 'Desde tu saldo inicial de {opening} el {date}.',
        'overview.fiat.label': 'Equivalente en {currency}',
        'overview.fiat.detail': 'Tasa 1 {symbol} = {rate} {currency} · Fuente: {source} · {date}. Solo como referencia; no es una garantía de valor.',
        'overview.actions.explore': 'Explorar movimientos',
        'overview.actions.explain': 'Explicar este saldo',
        'overview.actions.explainLabel': 'Explicar este saldo con IA',

        'overview.notIn.pending1': '1 movimiento pendiente ({amount}) no está incluido en este saldo.',
        'overview.notIn.pendingN': '{n} movimientos pendientes ({amount} en total) no están incluidos en este saldo.',
        'overview.notIn.other1': '1 movimiento no registrado ({amount}) no está incluido en este saldo.',
        'overview.notIn.otherN': '{n} movimientos no registrados ({amount} en total) no están incluidos en este saldo.',
        'overview.notIn.detail': '{description} · iniciado el {date}',
        'overview.notIn.view': 'Ver movimiento',
        'overview.notIn.viewAll': 'Verlos en Movimientos',
        'overview.notIn.listLabel': 'No incluidos en este saldo',

        'overview.details.summary': 'Detalles del estado de cuenta',
        'overview.details.statement': 'Estado de cuenta',
        'overview.details.dates': 'Período y fechas',
        'overview.details.id': 'ID del estado de cuenta',
        'overview.details.version': 'Versión',
        'overview.details.status': 'Estado de emisión',
        'overview.issue.original': 'Original',
        'overview.issue.corrected': 'Corregido',
        'overview.details.account': 'Cuenta',
        'overview.details.accountId': 'Número de cuenta',
        'overview.details.wallet': 'Monedero',
        'overview.details.masked': 'Enmascarado',
        'overview.details.asset': 'Activo',
        'overview.details.assetValue': '{name} ({symbol}), {precision} decimales',
        'overview.details.start': 'Inicio del período',
        'overview.details.end': 'Fin del período',
        'overview.details.asOf': 'Estado de cuenta al',
        'overview.details.generated': 'Generado',
        'overview.details.timezone': 'Zona horaria',
        'overview.details.dateBasis': 'Base de fechas',
        'overview.details.maskNote': 'Los identificadores de cuenta y de monedero están enmascarados para proteger tu cuenta. En este estado de cuenta no es posible mostrarlos completos.',

        'overview.journey.title': 'Recorrido del saldo',
        'overview.journey.lede': 'Cómo pasó tu saldo de {opening} a {closing}, con los movimientos del período agrupados por tipo. Selecciona cualquier paso para ver los movimientos que lo forman.',
        'overview.journey.unit': 'Importes en {unit} {symbol}',
        'overview.journey.legendLabel': 'Leyenda',
        'overview.journey.legendIn': 'Suma al saldo',
        'overview.journey.legendOut': 'Reduce el saldo',
        'overview.journey.legendTotal': 'Saldo inicial y final',
        'overview.journey.stepsLabel': 'Pasos del recorrido del saldo',
        'overview.journey.subtotal': 'Subtotal acumulado tras este paso: {amount}',
        'overview.journey.selected': 'Seleccionaste {label}: {count}, {amount}. Los movimientos aparecen debajo.',
        'overview.journey.cleared': 'Selección borrada. Se muestra el recorrido completo.',
        'overview.journey.eqTitle': 'En cifras',
        'overview.journey.equals': 'es igual a',
        'overview.journey.table': 'Ver el recorrido como tabla',
        'overview.journey.caption': 'Recorrido del saldo del {period}. Importes en {symbol}.',
        'overview.journey.byType':
          'Los pasos se agrupan por tipo, no por fecha, así que los subtotales entre el saldo inicial y el final no son saldos que haya tenido tu cuenta. Para ver tu saldo en cada fecha, consulta Saldo acumulado.',
        'overview.journey.colStep': 'Paso',
        'overview.journey.colChange': 'Cambio',
        'overview.journey.colAfter': 'Subtotal',
        'overview.journey.colCount': 'Movimientos',
        'overview.journey.net': 'Cambio neto',
        'overview.journey.exTitle': 'No se puede mostrar el recorrido del saldo',
        'overview.journey.exBody':
          'El saldo inicial más los movimientos registrados del período no es igual al saldo final. En lugar de mostrar cifras que podrían ser incorrectas, retenemos el recorrido y el gráfico. No se ha redondeado ni ajustado nada para ocultar la diferencia.',

        'overview.panel.eyebrow': 'Movimientos de este paso',
        'overview.panel.eyebrowGroup': 'Movimientos de este grupo',
        'overview.panel.order': 'Ordenados por fecha de registro',
        'overview.panel.colDate': 'Registrado',
        'overview.panel.colType': 'Tipo',
        'overview.panel.colCounterparty': 'Contraparte',
        'overview.panel.colAmount': 'Importe',
        'overview.panel.open': 'abrir detalles',
        'overview.panel.sum': 'Suma de estas filas',
        'overview.panel.matches': 'Coincide con {label} en el recorrido',
        'overview.panel.mismatch': 'No coincide con el valor del recorrido, {amount}',
        'overview.panel.empty': 'Ningún movimiento contribuyó a este paso en este período.',
        'overview.panel.show': 'Ver en Movimientos',
        'overview.panel.clear': 'Borrar selección',

        'overview.why.title': 'Por qué cambió',
        'overview.why.lede': 'Cuándo se movió tu saldo, qué lo movió y cuánto costó.',
        'overview.why.withheld': 'El gráfico del saldo acumulado, el resumen de comisiones y los datos destacados se retienen porque este estado de cuenta no cuadra.',
        'overview.chart.title': 'Saldo acumulado',
        'overview.chart.lede': 'Tu saldo después de cada movimiento registrado del {period}. Selecciona un punto para abrir ese movimiento.',
        'overview.chart.legendLine': 'Saldo',
        'overview.chart.legendIn': 'Movimiento de entrada',
        'overview.chart.legendOut': 'Movimiento de salida o comisión',
        'overview.chart.summary': 'Tu saldo más alto fue de {max}, el {maxDate}, y el más bajo, de {min}, el {minDate}. Cerró el período en {closing}.',
        'overview.chart.pointsLabel': 'Puntos del gráfico, uno por movimiento registrado. Usa las flechas para moverte entre ellos.',
        'overview.chart.point': '{date}: {type}, {amount}, {counterparty}. Saldo después: {balance}. Abre el movimiento.',
        'overview.chart.balanceAfter': 'Saldo después',
        'overview.chart.sameTime': '+{n} más a la misma hora',
        'overview.chart.openHint': 'Selecciona para abrir el movimiento',
        'overview.chart.table': 'Ver los datos del gráfico como tabla',
        'overview.chart.caption': 'Saldo después de cada movimiento registrado del {period}. Importes en {symbol}.',
        'overview.chart.colTx': 'Movimiento',
        'overview.chart.colAfter': 'Saldo después',
        'overview.chart.low': 'Con solo {count} en este período, un gráfico no sería útil. Aquí tienes cada cambio.',
        'overview.chart.none': 'No se registró ningún movimiento en este período, así que tu saldo se mantuvo en {amount}.',
        'overview.chart.after': 'Saldo después: {amount}',

        'overview.fees.title': 'Comisiones del período',
        'overview.fees.total': 'Total de comisiones',
        'overview.fees.count1': '1 comisión',
        'overview.fees.countN': '{n} comisiones',
        'overview.fees.note': 'Cada comisión aparece en su propia línea, vinculada al movimiento al que corresponde.',
        'overview.fees.none': 'No se cobraron comisiones en este período.',
        'overview.fees.foreignNone': 'Comisiones en otros activos: ninguna',
        'overview.fees.foreign': 'Comisiones en otros activos, que se muestran aparte y no forman parte del recorrido del saldo:',
        'overview.fees.show': 'Ver comisiones en el recorrido',

        'overview.insight.eyebrow': 'Dato destacado',
        'overview.insight.title': 'Tu mayor movimiento',
        'overview.insight.body': 'El mayor movimiento individual del período fue de {amount}, el {date}: {description}.',
        'overview.insight.view': 'Ver este movimiento',
        'overview.insight.learn': '¿Qué son las unidades de token?',

        'overview.video.eyebrow': 'Video personalizado',
        'overview.video.title': 'Tu estado de cuenta en 60 segundos',
        'overview.video.desc': 'Un recorrido breve y personal por tu saldo de {month}, tu mayor movimiento y dónde obtener ayuda.',
        'overview.video.duration': 'Duración {time}',
        'overview.video.optional': 'Opcional; nunca se reproduce solo',
        'overview.video.honest': 'Un recorrido animado creado con las cifras de muestra de este estado de cuenta, narrado con la voz integrada de tu dispositivo.',
        'overview.video.honestRecorded': 'Un recorrido animado creado con las cifras de muestra de este estado de cuenta, narrado con una locución grabada.',
        'overview.video.honestSilent': 'Un recorrido animado creado con las cifras de muestra de este estado de cuenta, con subtítulos.',
        'overview.video.noVoice': 'La locución no está disponible en este idioma en este dispositivo; los subtítulos están activados.',
        'overview.video.withheld': 'Este video se retiene porque el estado de cuenta no cuadra.',
        'overview.video.player': 'Reproductor de video: {title}',
        'overview.video.playLabel': 'Reproducir video: {title} ({time})',
        'overview.video.replayLabel': 'Volver a ver el video: {title}',
        'overview.video.play': 'Reproducir',
        'overview.video.pause': 'Pausar',
        'overview.video.replay': 'Volver a ver',
        'overview.video.seek': 'Posición del video',
        'overview.video.seekText': '{now} de {total}, capítulo {n}: {chapter}',
        'overview.video.mute': 'Silenciar la locución',
        'overview.video.cc': 'Subtítulos',
        'overview.video.fs': 'Pantalla completa',
        'overview.video.fsExit': 'Salir de pantalla completa',
        'overview.video.chapters': 'Capítulos',
        'overview.video.chapterLabel': 'Capítulo {n}, {title}, {time}. Reproduce desde aquí.',
        'overview.video.chapterHead': 'Capítulo {n}: {title}',
        'overview.video.transcript': 'Transcripción',
        'overview.video.transcriptNote': 'Selecciona una línea para reproducir el video desde ahí.',
        'overview.video.ch.greet': 'Saludo personal',
        'overview.video.ch.balance': 'Saldo inicial y final',
        'overview.video.ch.largest': 'El movimiento más relevante',
        'overview.video.ch.inspect': 'Cómo revisar un movimiento',
        'overview.video.ch.help': 'Dónde obtener ayuda',
        'overview.video.posterHello': 'Hola, {name}',
        'overview.video.greetSub': 'Tu estado de cuenta de YES del {period}',
        'overview.video.inThis': 'En este video',
        'overview.video.everyMove': 'Todos los movimientos registrados',
        'overview.video.reference': 'Referencia',
        'overview.video.pick': 'Selecciona un paso para ver sus movimientos',
        'overview.video.feeNone': 'Ninguna',
        'overview.video.ask': 'Preguntar por este movimiento',
        'overview.video.askBody': 'Respuestas sobre cualquier cifra, a partir de este estado de cuenta.',
        'overview.video.askSample': '¿Por qué cambió mi saldo?',
        'overview.video.helpBody': 'Opciones de contacto y descarga de tu estado de cuenta.',
        'overview.video.bye': 'Estamos aquí para ayudarte.',
        'overview.video.sig': 'Tu estado de cuenta de YES · {month}',
        'overview.video.cue.hello': 'Hola, {name}.',
        'overview.video.cue.period': 'Este es tu estado de cuenta de YES del {period}.',
        'overview.video.cue.opening': 'Empezaste el período con {opening}.',
        'overview.video.cue.incoming': 'Las entradas sumaron {incoming}.',
        'overview.video.cue.outgoing': 'Las salidas y las comisiones restaron {outgoing}.',
        'overview.video.cue.closing': 'Cerraste el período con {closing}.',
        'overview.video.cue.largest': 'Tu mayor movimiento individual fue de {amount}.',
        'overview.video.cue.largestNone': 'No hubo movimientos en este período.',
        'overview.video.cue.what': '{description}, del {date}.',
        'overview.video.cue.whatNone': 'Tu saldo se mantuvo en {closing}.',
        'overview.video.cue.select': 'Selecciona cualquier paso del recorrido del saldo.',
        'overview.video.cue.rows': 'Aparecen sus movimientos, que suman ese importe.',
        'overview.video.cue.open': 'Abre uno para ver sus fechas, referencia y comisiones.',
        'overview.video.cue.actions': 'Desde ahí, usa Explicar con IA o Preguntar por este movimiento.',
        'overview.video.cue.help': '¿Dudas? Pregunta a YES o abre Ayuda para contactarnos.',
        'overview.video.cue.bye': 'Si algo no te cuadra, estamos aquí para ayudarte.',
        'overview.video.say.period': 'Este es tu estado de cuenta de {month}.',
        'overview.video.say.opening': 'Empezaste el período con {openingSay} unidades de token.',
        'overview.video.say.incoming': 'Las entradas sumaron {incomingSay}.',
        'overview.video.say.outgoing': 'Las salidas y las comisiones restaron {outgoingSay}.',
        'overview.video.say.closing': 'Cerraste el período con {closingSay} unidades de token.',
        'overview.video.say.largestIn': 'Tu mayor movimiento sumó {amountSay} unidades de token.',
        'overview.video.say.largestOut': 'Tu mayor movimiento restó {amountSay} unidades de token.'
      }
    },

    init: function () {
      var el = doc.getElementById('overview-root');
      if (!el) return;

      // Journey: steps and groups are toggles.
      ui.delegate(el, 'click', '[data-ov-step]', function (e, b) {
        var id = b.getAttribute('data-ov-step');
        if (YES.state.journeyStep === id) clearSelection({ returnFocus: false });
        else select(id, { trigger: b });
      });
      ui.delegate(el, 'click', '[data-ov-clear]', function () {
        clearSelection({ returnFocus: true });
      });
      ui.delegate(el, 'click', '[data-ov-show]', function (e, b) {
        showInTransactions({ step: b.getAttribute('data-ov-show') });
      });
      ui.delegate(el, 'click', '[data-ov-explore]', function () {
        showInTransactions({});
      });
      ui.delegate(el, 'click', '[data-ov-select]', function (e, b) {
        YES.overview.selectStep(b.getAttribute('data-ov-select'));
      });
      ui.delegate(el, 'click', '[data-ov-tx]', function (e, b) {
        openTx(b.getAttribute('data-ov-tx'), b);
      });
      ui.delegate(el, 'click', '[data-ov-notin-all]', function () {
        var ids = YES.calc.notInBalance().map(function (tx) {
          return tx.id;
        });
        // A { en, es } label: the explorer resolves it when it renders, so the
        // chip follows a later language switch.
        YES.explorer.showRows(ids, localised('overview.notIn.listLabel'));
        if (YES.state.view !== 'transactions') YES.nav.go('transactions');
      });
      ui.delegate(el, 'click', '[data-ov-learn]', function (e, b) {
        YES.understand.openTopic(b.getAttribute('data-ov-learn'));
      });
      ui.delegate(el, 'click', '[data-ov-help]', function () {
        YES.help.open('contact');
      });
      bindPlayer(el);

      // Running-balance chart: crosshair + tooltip on hover, nearest point on click.
      el.addEventListener('pointermove', function (e) {
        var plot = e.target.closest && e.target.closest('[data-ov-plot]');
        if (!plot) {
          if (chart.hover !== -1) {
            chart.hover = -1;
            if (!pointFocused()) hideTip();
          }
          return;
        }
        if (e.pointerType === 'touch') return;
        var i = nearestAt(e.clientX, e.clientY);
        if (i !== chart.hover && i !== -1) {
          chart.hover = i;
          showTip(i);
        }
      });
      el.addEventListener('pointerleave', function () {
        chart.hover = -1;
        if (!pointFocused()) hideTip();
      });
      ui.delegate(el, 'click', '[data-ov-plot]', function (e) {
        if (e.target.closest('[data-ov-tx]')) return;
        var i = nearestAt(e.clientX, e.clientY);
        if (i !== -1)
          openTx(
            chart.pts[i].id,
            pointButton(i),
            chart.pts.map(function (p) {
              return p.id;
            })
          );
      });
      ui.delegate(el, 'keydown', '[data-ov-pt]', onPointKey);
      el.addEventListener('focusin', function (e) {
        var b = e.target.closest && e.target.closest('[data-ov-pt]');
        if (!b) return;
        var i = +b.getAttribute('data-ov-pt');
        setRoving(i);
        showTip(i);
      });
      el.addEventListener('focusout', function (e) {
        var b = e.target.closest && e.target.closest('[data-ov-pt]');
        if (!b) return;
        var next = e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('[data-ov-pt]');
        if (!next && chart.hover === -1) hideTip();
      });

      // Disclosures remember their state (the toggle event does not bubble).
      el.addEventListener(
        'toggle',
        function (e) {
          var d = e.target;
          var key = d && d.getAttribute && d.getAttribute('data-ov-disclosure');
          if (key && !!ovState()[key] !== d.open) setOv(key, d.open);
        },
        true
      );

      // Deep link (or Forward): #/overview/<step> selects that step. Within the
      // Overview (Forward, an edited address) the selection is announced; when
      // the view itself changes the router announces the view instead.
      var routeView = null;
      YES.on('route', function (r) {
        var sameView = routeView === 'overview';
        routeView = r.view;
        if (r.view !== 'overview' || !r.param || r.param === YES.state.journeyStep) return;
        var info = selectionInfo(r.param);
        if (!info) return;
        pendingAnim = true;
        YES.set({ journeyStep: r.param });
        pendingAnim = false;
        if (sameView) ui.announce(selectedMessage(info));
      });
      // Back (or an edited address) to plain #/overview restores the full journey.
      // Only the browser fires 'hashchange'; the navigation's own links push
      // #/overview without one, and a selection survives those.
      root.addEventListener('hashchange', function () {
        if (!YES.nav.isRouteHash(root.location.hash)) return;
        var r = YES.nav.current();
        if (r.view === 'overview' && !r.param && YES.state.journeyStep) clearSelection({ fromHistory: true });
      });

      // Layout changes: redraw the chart at its new width; move the panel when
      // the journey switches between the list and the waterfall (its own width
      // decides, so docking the assistant counts too).
      if (root.ResizeObserver) {
        observer = new root.ResizeObserver(function () {
          root.requestAnimationFrame(function () {
            var host = plotHost();
            if (host && host.clientWidth && Math.abs(host.clientWidth - chart.lastW) >= 2) renderPlot();
            placePanel();
            // The video's pointer targets follow the stage's size (full screen, a docked assistant).
            VP.targets = null;
            draw();
          });
        });
      } else {
        root.addEventListener('resize', function () {
          renderPlot();
          placePanel();
        });
      }

      render();
    },

    render: render,

    onState: function (keys) {
      if (keys.indexOf('journeyStep') === -1) return;
      var prev = lastStep;
      lastStep = YES.state.journeyStep || null;
      syncJourney();
      syncExplorer(prev, lastStep);
    }
  });
})(window);
