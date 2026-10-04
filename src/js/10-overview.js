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
 *   5. The personalized-video placeholder card and its storyboard dialog.
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

  var VIDEO_SECONDS = 60;
  var FRAMES = [
    { key: 'f1', icon: 'user', at: 0 },
    { key: 'f2', icon: 'balance', at: 12 },
    { key: 'f3', icon: 'arrow-out', at: 24 },
    { key: 'f4', icon: 'search', at: 36 },
    { key: 'f5', icon: 'chat', at: 48 }
  ];
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
  if (!YES.state.overview) YES.state.overview = { details: false, journeyTable: false, chartTable: false };

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
  function timecode(sec) {
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
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
  /* 5. Personalized video placeholder                                   */
  /* ------------------------------------------------------------------ */
  /**
   * The [YES_LOGO] slot in the poster's top-left corner. Approved artwork (SVG
   * markup or a data: image) comes from the shared slot helper, like the
   * masthead and the print header, and keeps its own aspect ratio, left-aligned
   * at the poster's lettering height. Without it, the poster draws its own
   * text placeholder, inverted on the poster colours.
   */
  function posterLogoHtml() {
    var art = ui.logoHtml({ cls: 'ov-poster__art', size: 24, decorative: true });
    if (/\bov-poster__art--art\b/.test(art)) return '<foreignObject class="ov-poster__artbox" x="20" y="18" width="120" height="24">' + art + '</foreignObject>';
    return (
      '<rect class="ov-poster__logo" x="20" y="18" width="48" height="24" rx="6"/>' +
      '<text class="ov-poster__logotext" x="44" y="35" text-anchor="middle">' +
      esc(YES.config.slots.YES_LOGO.text || 'YES') +
      '</text>'
    );
  }

  function posterHtml() {
    var slot = YES.config.slots.VIDEO_POSTER;
    // An approved poster may be packaged as a data: URI; anything else would be a network request.
    if (typeof slot === 'string' && /^data:image\//.test(slot)) return '<img class="ov-poster__img" src="' + esc(slot) + '" alt="">';
    // A miniature of this statement's own balance journey (opening → movements →
    // closing), drawn from YES.calc like every other figure: a preview of what the
    // video explains, not a decorative "performance" chart.
    var steps = YES.calc.journey();
    var hi = 0;
    steps.forEach(function (sp) {
      hi = Math.max(hi, sp.start, sp.end);
    });
    var slot = 100 / Math.max(1, steps.length);
    var barSvg = steps
      .map(function (sp, i) {
        var top = 128 - (Math.max(sp.start, sp.end) / (hi || 1)) * 70;
        var h = Math.max(2, (Math.abs(sp.end - sp.start) / (hi || 1)) * 70);
        var cls = sp.kind === 'total' ? 'ov-poster__bar ov-poster__bar--total' : 'ov-poster__bar';
        return '<rect class="' + cls + '" x="' + r1(206 + i * slot + slot * 0.2) + '" y="' + r1(top) + '" width="' + r1(slot * 0.6) + '" height="' + r1(h) + '" rx="1.5"/>';
      })
      .join('');
    return (
      '<svg class="ov-poster__svg" viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">' +
      '<rect class="ov-poster__bg" width="320" height="180"/>' +
      '<circle class="ov-poster__glow" cx="300" cy="-10" r="150"/>' +
      posterLogoHtml() +
      '<text class="ov-poster__hello" x="20" y="76">' +
      esc(t('overview.video.posterHello', { name: st().customer.firstName })) +
      '</text>' +
      '<text class="ov-poster__sub" x="20" y="96">' +
      esc(monthText()) +
      '</text>' +
      barSvg +
      '<path class="ov-poster__base" d="M206 128H306"/>' +
      '</svg>'
    );
  }

  function videoCardHtml() {
    var title = t('overview.video.title');
    var time = timecode(VIDEO_SECONDS);
    return (
      '<section class="card ov-video" aria-labelledby="ov-video-title">' +
      // A size container: with very large text the play control and the
      // duration move below the artwork instead of colliding on it.
      '<div class="ov-video__media"><div class="ov-video__poster">' +
      posterHtml() +
      '<button type="button" class="ov-video__play" data-ov-video data-fk="ov-video-play" aria-label="' +
      esc(t('overview.video.playLabel', { title: title, time: time })) +
      '"><span class="ov-video__playicon">' +
      ui.icon('play', { size: 16 }) +
      '</span><span>' +
      esc(t('overview.video.play')) +
      '</span></button>' +
      '<span class="ov-video__dur" aria-hidden="true">' +
      esc(time) +
      '</span></div></div>' +
      '<div class="ov-video__body">' +
      '<p class="card__eyebrow">' +
      esc(t('overview.video.eyebrow')) +
      '</p>' +
      '<h2 id="ov-video-title" class="ov-video__title">' +
      esc(title) +
      '</h2>' +
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
      '<p class="ov-video__ph">' +
      ui.illustrativeTag('demo.only') +
      ' <span>' +
      esc(t('overview.video.placeholderShort')) +
      '</span></p>' +
      '</div></section>'
    );
  }

  function storyVars() {
    var s = st();
    var big = YES.calc.largest();
    var vars = {
      name: s.customer.firstName,
      period: periodText(),
      opening: amt(s.opening),
      closing: amt(s.closing),
      net: amt(YES.calc.netChange(), 'always')
    };
    if (big) {
      vars.amount = amt(big.amount, 'always');
      vars.date = YES.fmt.date(big.postedAt, 'long');
      vars.description = noStop(YES.L(big.description));
    }
    return { vars: vars, big: big };
  }

  function videoDialogHtml() {
    var sv = storyVars();
    var frames = FRAMES.map(function (f, i) {
      var k = f.key === 'f3' && !sv.big ? 'f3none' : f.key;
      var to = i + 1 < FRAMES.length ? FRAMES[i + 1].at : VIDEO_SECONDS;
      return {
        n: i + 1,
        icon: f.key === 'f3' && sv.big ? ui.typeIcon(sv.big.type) : f.icon,
        from: timecode(f.at),
        to: timecode(to),
        title: t('overview.video.' + k + '.title'),
        screen: t('overview.video.' + k + '.screen', sv.vars),
        say: t('overview.video.' + k + '.say', sv.vars)
      };
    });
    var reqs = ['req1', 'req2', 'req3', 'req4', 'req5', 'req6'];
    return (
      '<div class="dlg__head">' +
      '<h2 id="video-dialog-title" class="dlg__title" tabindex="-1" data-fk="ov-video-title">' +
      esc(t('overview.video.title')) +
      '</h2>' +
      '<button type="button" class="btn btn--icon btn--ghost" data-ov-video-close data-fk="ov-video-x" aria-label="' +
      esc(t('common.close')) +
      '">' +
      ui.icon('close') +
      '</button></div>' +
      '<div class="dlg__body ov-vdlg" tabindex="0" role="region" aria-label="' +
      esc(t('overview.video.bodyLabel')) +
      '">' +
      '<div class="notice notice--illustrative">' +
      ui.icon('info', { size: 18 }) +
      '<p><strong>' +
      esc(t('overview.video.dlgTitle')) +
      '</strong> ' +
      esc(t('overview.video.dlgNotice')) +
      '</p></div>' +
      '<h3 class="ov-vdlg__h">' +
      esc(t('overview.video.storyboard')) +
      '</h3>' +
      '<ol class="ov-story">' +
      frames
        .map(function (f) {
          return (
            '<li class="ov-story__frame" data-frame="' +
            f.n +
            '"><div class="ov-story__thumb" aria-hidden="true"><span class="ov-story__n">' +
            f.n +
            '</span>' +
            ui.icon(f.icon, { size: 22 }) +
            '</div><div class="ov-story__text"><p class="ov-story__time">' +
            esc(t('overview.video.frame', { n: f.n, from: f.from, to: f.to })) +
            '</p><h4 class="ov-story__title">' +
            esc(f.title) +
            '</h4><p class="ov-story__screen"><span class="ov-story__label">' +
            esc(t('overview.video.onScreen')) +
            '</span> ' +
            esc(f.screen) +
            '</p></div></li>'
          );
        })
        .join('') +
      '</ol>' +
      '<p class="ov-vdlg__note">' +
      esc(t('overview.video.figures')) +
      '</p>' +
      '<h3 class="ov-vdlg__h">' +
      esc(t('overview.video.transcript')) +
      '</h3>' +
      '<div class="ov-transcript">' +
      frames
        .map(function (f) {
          return '<p><span class="ov-transcript__time">' + esc(f.from) + '</span><span>' + esc(f.say) + '</span></p>';
        })
        .join('') +
      '</div>' +
      '<h3 class="ov-vdlg__h">' +
      esc(t('overview.video.prodTitle')) +
      '</h3>' +
      '<ul class="ov-req">' +
      reqs
        .map(function (r) {
          return '<li>' + ui.icon('check', { size: 16 }) + '<span>' + esc(t('overview.video.' + r)) + '</span></li>';
        })
        .join('') +
      '</ul>' +
      '</div>' +
      '<div class="dlg__foot"><button type="button" class="btn" data-ov-video-close data-fk="ov-video-done">' +
      esc(t('common.close')) +
      '</button></div>'
    );
  }

  function openVideo(trigger) {
    var dlg = doc.getElementById('video-dialog');
    if (!dlg) return;
    ui.render(dlg, videoDialogHtml());
    ui.openDialog(dlg, { trigger: trigger, initialFocus: '#video-dialog-title' });
  }

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
    return headerHtml() + balanceHtml() + journeySectionHtml(rec) + whyHtml(rec) + videoCardHtml();
  }

  function render() {
    var el = doc.getElementById('overview-root');
    if (!el) return;
    ui.render(el, viewHtml());
    placePanel(); // the first render cannot know the layout before the journey exists
    var host = plotHost();
    if (host && host.clientWidth && (!host.firstChild || Math.abs(host.clientWidth - chart.lastW) >= 1)) renderPlot();
    if (observer) {
      observer.disconnect();
      if (host) observer.observe(host);
      var body = doc.getElementById('ov-journey-body');
      if (body) observer.observe(body);
    }
    var dlg = doc.getElementById('video-dialog');
    if (dlg && dlg.open) ui.render(dlg, videoDialogHtml());
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
    }
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
        'overview.video.dlgTitle': 'Placeholder: there is no video in this demo.',
        'overview.video.placeholderShort': 'This demo includes a storyboard, not a video.',
        'overview.video.play': 'Play',
        'overview.video.playLabel': 'Play: {title} ({time}, placeholder storyboard)',
        'overview.video.posterHello': 'Hello, {name}',
        'overview.video.dlgNotice': 'Nothing is streamed or played. The storyboard below shows what a personalized video would cover, using figures from this statement.',
        'overview.video.storyboard': 'Storyboard',
        'overview.video.bodyLabel': 'Storyboard, transcript and production notes',
        'overview.video.frame': 'Frame {n} · {from}–{to}',
        'overview.video.onScreen': 'On screen:',
        'overview.video.transcript': 'Transcript',
        'overview.video.figures': 'Every figure comes from this statement snapshot.',
        'overview.video.f1.title': 'Personal greeting',
        'overview.video.f1.screen': 'The YES logo and “Hello, {name}”, with the statement period {period}.',
        'overview.video.f1.say': 'Hello, {name}. This is your YES statement for {period}.',
        'overview.video.f2.title': 'Opening and closing balance',
        'overview.video.f2.screen': 'The balance journey from {opening} to {closing}.',
        'overview.video.f2.say': 'You began the period with {opening} and closed it with {closing}, a net change of {net}.',
        'overview.video.f3.title': 'Largest meaningful movement',
        'overview.video.f3.screen': 'A highlight of {amount} on {date}.',
        'overview.video.f3.say': 'Your largest movement was {amount} on {date}: {description}.',
        'overview.video.f3none.title': 'Largest meaningful movement',
        'overview.video.f3none.screen': 'A calm, unchanged balance.',
        'overview.video.f3none.say': 'There were no movements this period.',
        'overview.video.f4.title': 'How to inspect a transaction',
        'overview.video.f4.screen': 'A journey step opening its transactions, then one transaction’s details.',
        'overview.video.f4.say': 'Select any step of your balance journey to see the transactions behind it, then open one to check its dates, fees and reference.',
        'overview.video.f5.title': 'Where to get help',
        'overview.video.f5.screen': 'Ask YES and the Help section.',
        'overview.video.f5.say': 'If something does not look right, ask YES or visit Help. We are here to help.',
        'overview.video.prodTitle': 'What the production video needs',
        'overview.video.req1': 'An approved video asset or rendering service',
        'overview.video.req2': 'Captions in English and Spanish',
        'overview.video.req3': 'A full transcript, like the one above',
        'overview.video.req4': 'Play, pause and stop controls, and never autoplay',
        'overview.video.req5': 'Localized voice-over and on-screen text',
        'overview.video.req6': 'A static fallback: if the video cannot load, the written statement remains complete'
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
        'overview.video.dlgTitle': 'Marcador de posición: esta demostración no incluye ningún video.',
        'overview.video.placeholderShort': 'Esta demostración incluye un guion gráfico, no un video.',
        'overview.video.play': 'Reproducir',
        'overview.video.playLabel': 'Reproducir: {title} ({time}, guion gráfico de muestra)',
        'overview.video.posterHello': 'Hola, {name}',
        'overview.video.dlgNotice': 'No se transmite ni se reproduce nada. El guion gráfico muestra lo que cubriría un video personalizado, con las cifras de este estado de cuenta.',
        'overview.video.storyboard': 'Guion gráfico',
        'overview.video.bodyLabel': 'Guion gráfico, transcripción y notas de producción',
        'overview.video.frame': 'Escena {n} · {from}–{to}',
        'overview.video.onScreen': 'En pantalla:',
        'overview.video.transcript': 'Transcripción',
        'overview.video.figures': 'Todas las cifras provienen de esta instantánea del estado de cuenta.',
        'overview.video.f1.title': 'Saludo personal',
        'overview.video.f1.screen': 'El logotipo de YES y «Hola, {name}», con el período del estado de cuenta: {period}.',
        'overview.video.f1.say': 'Hola, {name}. Este es tu estado de cuenta de YES del {period}.',
        'overview.video.f2.title': 'Saldo inicial y final',
        'overview.video.f2.screen': 'El recorrido del saldo de {opening} a {closing}.',
        'overview.video.f2.say': 'Empezaste el período con {opening} y lo cerraste con {closing}: un cambio neto de {net}.',
        'overview.video.f3.title': 'El movimiento más relevante',
        'overview.video.f3.screen': 'Un destacado de {amount} el {date}.',
        'overview.video.f3.say': 'Tu mayor movimiento fue de {amount}, el {date}: {description}.',
        'overview.video.f3none.title': 'El movimiento más relevante',
        'overview.video.f3none.screen': 'Un saldo tranquilo, sin cambios.',
        'overview.video.f3none.say': 'No hubo movimientos en este período.',
        'overview.video.f4.title': 'Cómo revisar un movimiento',
        'overview.video.f4.screen': 'Un paso del recorrido que muestra sus movimientos y, después, el detalle de uno de ellos.',
        'overview.video.f4.say': 'Selecciona cualquier paso del recorrido del saldo para ver sus movimientos y abre uno para revisar sus fechas, comisiones y referencia.',
        'overview.video.f5.title': 'Dónde obtener ayuda',
        'overview.video.f5.screen': 'Pregunta a YES y la sección de Ayuda.',
        'overview.video.f5.say': 'Si algo no te cuadra, pregunta a YES o visita la sección de Ayuda. Estamos aquí para ayudarte.',
        'overview.video.prodTitle': 'Qué necesita el video en producción',
        'overview.video.req1': 'Un video aprobado o un servicio de generación de video aprobado',
        'overview.video.req2': 'Subtítulos en inglés y en español',
        'overview.video.req3': 'Una transcripción completa, como la anterior',
        'overview.video.req4': 'Controles para reproducir, pausar y detener, y nunca reproducción automática',
        'overview.video.req5': 'Locución y texto en pantalla localizados',
        'overview.video.req6': 'Una alternativa estática: si el video no carga, el estado de cuenta escrito sigue completo'
      }
    },

    init: function () {
      var el = doc.getElementById('overview-root');
      var dlg = doc.getElementById('video-dialog');
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
      ui.delegate(el, 'click', '[data-ov-video]', function (e, b) {
        openVideo(b);
      });
      if (dlg) {
        ui.delegate(dlg, 'click', '[data-ov-video-close]', function () {
          ui.closeDialog(dlg);
        });
      }

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
