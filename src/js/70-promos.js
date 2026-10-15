/*
 * "From YES": promotional updates about new features and developments.
 *
 * Content lives in YES.config.promotions (00-config.js), so YES can change the
 * copy, the order, the icons and the eligibility rules without code. This
 * module evaluates each rule against YES.data and YES.calc, fills the copy
 * with this statement's own figures (YES.fmt, never typed numbers) and renders
 * the placements:
 *
 *   overview   one card, "What's new from YES", between the balance card and
 *              the balance journey (YES.promos.slotHtml('overview'), called by
 *              the overview module). The highest-priority eligible update that
 *              was not dismissed; "Next update" rotates, "Not now" dismisses.
 *              It never rotates on its own.
 *   fees       a one-line note beside the network fee in the Fees card
 *   txDetail   a one-line note in the transaction detail of that send (and of
 *              its fee line) (YES.promos.noteHtml(place, { txId }))
 *   whatsnew   the What's new view (#/whatsnew, #/whatsnew/<id>): every update
 *   assistant  Ask YES answers "What's new?" from YES.promos.view()
 *
 * Rules: everything is illustrative (demo mode labels every promotion "From
 * YES" and "Illustrative"); screen only, never in print, the PDF, the CSV or
 * the noscript summary (those are built from the statement data alone);
 * calls to action show a toast and go nowhere; nothing is tracked or sent.
 * Impressions and clicks are counted in memory for the demo only
 * (YES.promos.metrics()). Dismissals live in YES.state.promos (so they survive
 * a language switch) and in localStorage 'yes.promos' (this browser only,
 * wrapped in try/catch: blocked storage never breaks the page).
 */
(function (root) {
  'use strict';
  var YES = root.YES;
  var ui = YES.ui;
  var t = YES.t;
  var esc = ui.esc;
  var calc = YES.calc;
  var doc = root.document;

  var SAFE_ID = /^[a-z0-9-]{1,40}$/;
  var THEMES = { identity: 1, trust: 1, currencies: 1, interest: 1 };
  var NOTE_PLACES = { fees: 1, txDetail: 1 };

  var metrics = { impressions: {}, clicks: {} };
  var seen = {}; // placement:id pairs already counted as an impression in this page view
  var cleared = false; // the Overview just ran out of updates (this page view only)
  var inited = false;
  var focusTimer = null;

  /* ------------------------------------------------------------------ */
  /* Content                                                             */
  /* ------------------------------------------------------------------ */
  function conf() {
    var c = YES.config && YES.config.promotions;
    return c && c.enabled !== false && Array.isArray(c.items) ? c : null;
  }
  /** Every well-formed promotion, in configuration order. */
  function all() {
    var c = conf();
    if (!c) return [];
    return c.items.filter(function (p) {
      return p && SAFE_ID.test(String(p.id)) && THEMES[p.theme] && p.title && p.body;
    });
  }
  function byId(id) {
    var list = all();
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  /** Highest priority first; equal priorities keep the configuration order. */
  function sorted(list) {
    return list
      .map(function (p, i) {
        return { p: p, i: i };
      })
      .sort(function (a, b) {
        return (+b.p.priority || 0) - (+a.p.priority || 0) || a.i - b.i;
      })
      .map(function (x) {
        return x.p;
      });
  }
  function placed(p, place) {
    return Array.isArray(p.placements) && p.placements.indexOf(place) !== -1;
  }

  /* ------------------------------------------------------------------ */
  /* Facts from this statement (YES.data, YES.calc)                       */
  /* ------------------------------------------------------------------ */
  function st() {
    return YES.data.statement;
  }
  /** The customer's illustrative trust level, if the data has one. */
  function trust() {
    var c = st().customer;
    var tr = c && c.trust;
    return tr && typeof tr === 'object' && tr.level ? tr : null;
  }
  /** Trust levels in order, from the trust promotion's configuration. */
  function tiers() {
    var p = all().filter(function (x) {
      return x.theme === 'trust';
    })[0];
    return p && Array.isArray(p.tiers) ? p.tiers : [];
  }
  function tierIndex(id) {
    var ts = tiers();
    for (var i = 0; i < ts.length; i++) if (ts[i].id === id) return i;
    return -1;
  }
  function feeKindOf(p) {
    return (p && p.rule && p.rule.feeKind) || 'network_transfer';
  }
  /** Posted fees of one kind in this statement's asset: { total (positive minor units), count, txIds, parentIds }. */
  function feesOfKind(kind) {
    var out = { total: 0, count: 0, txIds: [], parentIds: [] };
    calc.posted().forEach(function (x) {
      if (x.type !== 'fee' || x.feeKind !== kind || x.asset !== st().assetId) return;
      out.total += -x.amount;
      out.count += 1;
      out.txIds.push(x.id);
      if (x.parentId) out.parentIds.push(x.parentId);
    });
    return out;
  }
  /** Sent to others this period (outgoing transfers and payments), positive minor units. */
  function sentTotal() {
    var c = calc.category('transfers_out');
    return c ? Math.abs(c.total) : 0;
  }

  /** Whether a promotion's eligibility rule holds for this statement. An unknown rule never does. */
  function eligible(p) {
    var r = (p && p.rule) || {};
    switch (r.kind) {
      case 'always':
        return true;
      case 'networkFeePaid':
        return feesOfKind(r.feeKind || 'network_transfer').total >= (Number.isInteger(r.min) && r.min > 0 ? r.min : 1);
      case 'trustBelow': {
        var tr = trust();
        var i = tr ? tierIndex(tr.level) : -1;
        var j = tierIndex(r.level);
        return i !== -1 && j !== -1 && i < j;
      }
      case 'balanceAtLeast':
        return Number.isInteger(r.amount) && st().closing >= r.amount;
      default:
        return false;
    }
  }

  /** Values for the copy placeholders, from YES.calc and YES.fmt (in the current language). */
  function vars(p) {
    var tr = trust();
    var ts = tiers();
    var i = tr ? tierIndex(tr.level) : -1;
    return {
      handle: (p && p.handle) || '',
      fee: YES.fmt.amount(feesOfKind(feeKindOf(p)).total),
      sent: YES.fmt.amount(sentTotal()),
      limit: tr && Number.isInteger(tr.monthlySendLimit) ? YES.fmt.amount(tr.monthlySendLimit) : '',
      level: i !== -1 ? YES.L(ts[i].label) : '',
      next: i !== -1 && ts[i + 1] ? YES.L(ts[i + 1].label) : '',
      closing: YES.fmt.amount(st().closing)
    };
  }
  /** Fill {name} placeholders; null when a placeholder has no value (the line is then left out). */
  function fill(str, v) {
    var missing = false;
    var out = String(str == null ? '' : str).replace(/\{(\w+)\}/g, function (m, k) {
      if (v[k] == null || v[k] === '') {
        missing = true;
        return m;
      }
      return v[k];
    });
    return missing ? null : out;
  }
  function copy(p, field, v) {
    if (!p || !p[field]) return '';
    var s = fill(YES.L(p[field]), v || vars(p));
    return s == null ? '' : s;
  }

  /* ------------------------------------------------------------------ */
  /* State: dismissed ids and the Overview's current update              */
  /* ------------------------------------------------------------------ */
  function storageKey() {
    var c = conf();
    return (c && c.storageKey) || 'yes.promos';
  }
  function known(id) {
    return typeof id === 'string' && !!byId(id);
  }
  function readStored() {
    try {
      var raw = root.localStorage.getItem(storageKey());
      if (!raw) return [];
      var o = JSON.parse(raw);
      return Array.isArray(o && o.dismissed) ? o.dismissed.filter(known) : [];
    } catch (e) {
      return []; // storage blocked or unreadable: nothing dismissed
    }
  }
  function writeStored(list) {
    try {
      if (list.length) root.localStorage.setItem(storageKey(), JSON.stringify({ v: 1, dismissed: list }));
      else root.localStorage.removeItem(storageKey());
    } catch (e) {
      /* storage unavailable: the choice still applies to this page view (YES.state) */
    }
  }
  /** A copy of YES.state.promos, seeded once from this browser's storage. */
  function S() {
    var s = YES.state.promos;
    if (!s || typeof s !== 'object') {
      // First read (the overview may render before this module's init): seed
      // the state silently, without a 'state' event in the middle of a render.
      s = { dismissed: readStored(), current: null };
      YES.state.promos = s;
    }
    return { dismissed: Array.isArray(s.dismissed) ? s.dismissed.filter(known) : [], current: known(s.current) ? s.current : null };
  }
  function save(next) {
    writeStored(next.dismissed);
    YES.set({ promos: { dismissed: next.dismissed.slice(), current: next.current || null } });
  }
  function isDismissed(id) {
    return S().dismissed.indexOf(id) !== -1;
  }

  /** The Overview's rotation: eligible, not dismissed, highest priority first (ids). */
  function queue() {
    var d = S().dismissed;
    return sorted(
      all().filter(function (p) {
        return placed(p, 'overview') && eligible(p) && d.indexOf(p.id) === -1;
      })
    ).map(function (p) {
      return p.id;
    });
  }
  function currentId() {
    var q = queue();
    var c = S().current;
    return q.indexOf(c) !== -1 ? c : q[0] || null;
  }

  /* ------------------------------------------------------------------ */
  /* Public model (also used by Ask YES)                                  */
  /* ------------------------------------------------------------------ */
  /** A promotion in the current language: { id, theme, icon, eyebrow, title, body, personal, note, cta, feature, footnote, eligible, dismissed }. */
  function view(id) {
    var p = byId(id);
    if (!p) return null;
    var v = vars(p);
    var ok = eligible(p);
    return {
      id: p.id,
      theme: p.theme,
      icon: p.icon || 'megaphone',
      eyebrow: copy(p, 'eyebrow', v),
      title: copy(p, 'title', v),
      body: copy(p, 'body', v),
      personal: ok ? copy(p, 'personal', v) : '',
      note: copy(p, 'note', v),
      cta: copy(p, 'cta', v),
      feature: copy(p, 'feature', v),
      footnote: copy(p, 'footnote', v),
      eligible: ok,
      dismissed: isDismissed(p.id)
    };
  }
  /**
   * Ids for a placement, highest priority first. The Overview and the notes
   * get eligible updates that were not dismissed; What's new and Ask YES get
   * every update placed there (the personal line needs eligibility).
   */
  function list(place) {
    var d = S().dismissed;
    return sorted(
      all().filter(function (p) {
        if (!placed(p, place)) return false;
        if (place === 'whatsnew' || place === 'assistant') return true;
        return eligible(p) && d.indexOf(p.id) === -1;
      })
    ).map(function (p) {
      return p.id;
    });
  }
  function count(kind, id) {
    metrics[kind][id] = (metrics[kind][id] || 0) + 1;
  }
  function impression(place, id) {
    var k = place + ':' + id;
    if (seen[k]) return;
    seen[k] = true;
    count('impressions', id);
  }

  /* ------------------------------------------------------------------ */
  /* Markup                                                              */
  /* ------------------------------------------------------------------ */
  function demoTag() {
    return YES.config.demo ? ui.illustrativeTag() : '';
  }
  function fromHtml() {
    return '<span class="promo-from">' + ui.icon('megaphone', { size: 14 }) + '<span>' + esc(t('promos.from')) + '</span></span>';
  }
  /* The example handle reads as an identifier (not a word to translate). */
  function textHtml(str, handle) {
    var h = esc(str);
    if (handle) h = h.split(esc(handle)).join('<span class="promo-handle" translate="no">' + esc(handle) + '</span>');
    return h;
  }
  function seeLinkHtml(p, m, fk, cls, label) {
    return (
      '<a class="' +
      cls +
      '" href="#/whatsnew/' +
      esc(p.id) +
      '" data-nav="whatsnew" data-nav-param="' +
      esc(p.id) +
      '" data-promo-action="see" data-promo-id="' +
      esc(p.id) +
      '" data-fk="' +
      esc(fk) +
      '">' +
      label +
      '</a>'
    );
  }

  /** Trust meter: every level labelled, the current one marked by words and shape, not colour alone. */
  function meterHtml(idBase) {
    var tr = trust();
    var ts = tiers();
    var cur = tr ? tierIndex(tr.level) : -1;
    if (cur === -1) return '';
    var steps = ts
      .map(function (tier, i) {
        var state = i < cur ? 'done' : i === cur ? 'current' : i === cur + 1 ? 'next' : 'later';
        var word = { done: 'promos.meter.done', current: 'promos.meter.current', next: 'promos.meter.next', later: 'promos.meter.later' }[state];
        return (
          '<li class="promo-meter__step promo-meter__step--' +
          state +
          '" data-tier="' +
          esc(tier.id) +
          '"' +
          (state === 'current' ? ' aria-current="step"' : '') +
          '><span class="promo-meter__bar" aria-hidden="true"></span><span class="promo-meter__name">' +
          (i <= cur ? ui.icon('badge-check', { size: 16 }) : '') +
          '<span>' +
          esc(YES.L(tier.label)) +
          '</span></span><span class="promo-meter__state">' +
          esc(t(word)) +
          '</span></li>'
        );
      })
      .join('');
    return (
      '<div class="promo-meter" data-level="' +
      esc(tr.level) +
      '"><p class="promo-meter__label" id="' +
      esc(idBase) +
      '-meter">' +
      esc(t('promos.meter.label')) +
      '</p><ol class="promo-meter__steps" aria-labelledby="' +
      esc(idBase) +
      '-meter">' +
      steps +
      '</ol></div>'
    );
  }
  function codesHtml(p, idBase) {
    if (!Array.isArray(p.codes) || !p.codes.length) return '';
    return (
      '<div class="promo-codes"><p class="promo-codes__label" id="' +
      esc(idBase) +
      '-codes">' +
      esc(t('promos.codes.label')) +
      '</p><ul class="promo-codes__list" aria-labelledby="' +
      esc(idBase) +
      '-codes">' +
      p.codes
        .map(function (c) {
          return '<li><span class="promo-codes__code" translate="no">' + esc(c.code) + '</span><span class="promo-codes__name">' + esc(YES.L(c.name)) + '</span></li>';
        })
        .join('') +
      '</ul></div>'
    );
  }
  function extraHtml(p, idBase, compact) {
    if (p.theme === 'trust') return meterHtml(idBase);
    if (p.theme === 'currencies' && !compact) return codesHtml(p, idBase);
    return '';
  }

  /** The Overview card: one update at a time. */
  function overviewCardHtml(id) {
    var p = byId(id);
    var m = view(id);
    var q = queue();
    var pos = q.indexOf(id);
    impression('overview', id);
    var counter = q.length > 1 ? '<span class="promo__count">' + esc(t('promos.count', { a: YES.fmt.count(pos + 1), b: YES.fmt.count(q.length) })) + '</span>' : '';
    return (
      '<section class="promo promo--overview" aria-labelledby="promo-ov-h" data-promo="' +
      esc(id) +
      '" data-promo-theme="' +
      esc(p.theme) +
      '">' +
      '<div class="promo__top">' +
      '<h2 id="promo-ov-h" class="promo__heading">' +
      ui.icon('megaphone', { size: 16 }) +
      '<span class="promo-from">' +
      esc(t('promos.cardTitle')) +
      '</span></h2>' +
      '<p class="promo__meta">' +
      demoTag() +
      counter +
      '</p></div>' +
      '<div class="promo__main">' +
      '<span class="promo__icon" aria-hidden="true">' +
      ui.icon(m.icon, { size: 22 }) +
      '</span>' +
      '<div class="promo__text">' +
      (m.eyebrow ? '<p class="promo__eyebrow">' + esc(m.eyebrow) + '</p>' : '') +
      '<h3 class="promo__title" id="promo-ov-title" tabindex="-1" data-fk="promo-ov-title">' +
      esc(m.title) +
      '</h3>' +
      '<p class="promo__body">' +
      textHtml(m.body, p.handle) +
      (m.personal ? ' <span class="promo__personal">' + textHtml(m.personal, p.handle) + '</span>' : '') +
      '</p>' +
      extraHtml(p, 'promo-ov', true) +
      (m.footnote ? '<p class="promo__foot">' + textHtml(m.footnote, p.handle) + '</p>' : '') +
      '</div>' +
      '<div class="promo__actions">' +
      seeLinkHtml(p, m, 'promo-ov-see', 'btn btn--promo', '<span>' + esc(t('promos.see')) + '</span>' + ui.icon('arrow-right', { size: 18 })) +
      (q.length > 1
        ? '<button type="button" class="btn btn--ghost promo__next" data-promo-action="next" data-fk="promo-ov-next">' + ui.icon('chevron', { size: 18 }) + '<span>' + esc(t('promos.next')) + '</span></button>'
        : '') +
      '<button type="button" class="btn btn--ghost promo__dismiss" data-promo-action="dismiss" data-promo-id="' +
      esc(id) +
      '" data-fk="promo-ov-dismiss" aria-label="' +
      esc(t('promos.dismissLabel', { title: m.title })) +
      '">' +
      ui.icon('close', { size: 18 }) +
      '<span>' +
      esc(t('promos.dismiss')) +
      '</span></button>' +
      '</div></div></section>'
    );
  }
  /* Shown once, right after the last update on the Overview is dismissed (this page view only). */
  function clearedHtml() {
    return (
      '<p class="promo-cleared">' +
      ui.icon('check', { size: 16 }) +
      '<span>' +
      esc(t('promos.cleared')) +
      '</span> <a class="promo-cleared__link" href="#/whatsnew" data-nav="whatsnew" data-fk="promo-ov-cleared">' +
      esc(t('promos.clearedLink')) +
      '</a></p>'
    );
  }
  function overviewInner() {
    var id = currentId();
    if (id) return overviewCardHtml(id);
    return cleared ? clearedHtml() : '';
  }
  /** Markup for a placement slot owned by this module ('overview'). */
  function slotHtml(place) {
    if (place !== 'overview' || !conf()) return '';
    return '<div class="promo-slot" data-promo-slot="overview">' + overviewInner() + '</div>';
  }

  /** Does a note placement apply to this transaction? (identity: the send that paid the fee, or the fee itself) */
  function noteFits(p, tx) {
    if (!tx) return false;
    if (p.theme !== 'identity') return false;
    var kind = feeKindOf(p);
    if (tx.type === 'fee') return tx.feeKind === kind && tx.status === 'posted';
    return (
      tx.status === 'posted' &&
      (tx.fees || []).some(function (f) {
        return f.kind === kind && f.asset === st().assetId;
      })
    );
  }
  /** A quiet one-line note for 'fees' or 'txDetail' (ctx.txId), or ''. */
  function noteHtml(place, ctx) {
    if (!NOTE_PLACES[place] || !conf()) return '';
    var tx = ctx && ctx.txId ? calc.tx(String(ctx.txId)) : null;
    var ids = list(place).filter(function (id) {
      return noteFits(byId(id), tx);
    });
    if (!ids.length) return '';
    var p = byId(ids[0]);
    var m = view(p.id);
    if (!m.note) return '';
    impression(place, p.id);
    var fk = 'promo-note-' + place + '-' + tx.id;
    return (
      '<p class="promo-note" data-promo="' +
      esc(p.id) +
      '" data-promo-place="' +
      esc(place) +
      '" data-promo-tx="' +
      esc(tx.id) +
      '">' +
      fromHtml() +
      '<span class="promo-note__text">' +
      textHtml(m.note, p.handle) +
      '</span> ' +
      seeLinkHtml(p, m, fk, 'promo-note__link', esc(t('promos.noteLink')) + '<span class="sr-only">: ' + esc(m.title) + '</span>') +
      (YES.config.demo ? ' ' + demoTag() : '') +
      '</p>'
    );
  }

  /** One update in the What's new view. */
  function fullCardHtml(id) {
    var p = byId(id);
    var m = view(id);
    var base = 'wn-' + id;
    impression('whatsnew', id);
    return (
      '<li class="wn-item"><article class="promo promo--full" id="' +
      esc(base) +
      '" data-promo="' +
      esc(id) +
      '" data-promo-theme="' +
      esc(p.theme) +
      '" aria-labelledby="' +
      esc(base) +
      '-title">' +
      '<div class="promo__head">' +
      '<span class="promo__icon" aria-hidden="true">' +
      ui.icon(m.icon, { size: 22 }) +
      '</span>' +
      '<p class="promo__tags">' +
      fromHtml() +
      demoTag() +
      (m.dismissed ? '<span class="tag promo__hidden">' + esc(t('promos.hiddenTag')) + '</span>' : '') +
      '</p></div>' +
      (m.eyebrow ? '<p class="promo__eyebrow">' + esc(m.eyebrow) + '</p>' : '') +
      '<h2 class="promo__title" id="' +
      esc(base) +
      '-title" tabindex="-1" data-fk="' +
      esc(base) +
      '-title">' +
      esc(m.title) +
      '</h2>' +
      '<p class="promo__body">' +
      textHtml(m.body, p.handle) +
      '</p>' +
      (m.personal ? '<p class="promo__personal promo__personal--block"><span class="promo__for">' + esc(t('promos.forYou')) + '</span> <span>' + textHtml(m.personal, p.handle) + '</span></p>' : '') +
      extraHtml(p, base, false) +
      (m.footnote ? '<p class="promo__foot">' + textHtml(m.footnote, p.handle) + '</p>' : '') +
      '<div class="promo__actions">' +
      '<button type="button" class="btn btn--promo" data-promo-action="cta" data-promo-id="' +
      esc(id) +
      '" data-fk="' +
      esc(base) +
      '-cta">' +
      '<span>' +
      esc(m.cta) +
      '</span>' +
      ui.icon('arrow-right', { size: 18 }) +
      '</button></div>' +
      '</article></li>'
    );
  }
  function whatsnewHtml() {
    var ids = list('whatsnew');
    var hidden = S().dismissed.filter(function (id) {
      return byId(id) && placed(byId(id), 'overview');
    }).length;
    var hiddenRow = hidden
      ? '<p class="wn-hidden">' +
        '<span>' +
        esc(hidden === 1 ? t('promos.view.hidden1') : t('promos.view.hiddenN', { n: YES.fmt.count(hidden) })) +
        '</span> <button type="button" class="btn btn--link" data-promo-action="restore" data-fk="wn-restore">' +
        esc(t('promos.view.restore')) +
        '</button></p>'
      : '';
    return (
      '<header class="wn-head">' +
      '<p class="wn-from">' +
      fromHtml() +
      demoTag() +
      '</p>' +
      '<h1 id="h-whatsnew" class="view-title" data-view-heading tabindex="-1" data-fk="wn-h1">' +
      esc(t('promos.view.title')) +
      '</h1>' +
      '<p class="view-lede wn-lede">' +
      esc(t('promos.view.lede')) +
      '</p>' +
      '<div class="notice notice--illustrative wn-note">' +
      ui.icon('info', { size: 20 }) +
      '<p>' +
      esc(t('promos.view.note')) +
      '</p></div>' +
      hiddenRow +
      '</header>' +
      (ids.length ? '<ul class="wn-list" aria-label="' + esc(t('promos.view.listLabel')) + '">' + ids.map(fullCardHtml).join('') + '</ul>' : '<p class="wn-empty">' + esc(t('promos.view.empty')) + '</p>')
    );
  }

  /* ------------------------------------------------------------------ */
  /* Rendering into the places this module owns                          */
  /* ------------------------------------------------------------------ */
  function renderView() {
    var el = doc.getElementById('whatsnew-root');
    if (el) ui.render(el, whatsnewHtml());
  }
  /** Refresh the Overview slot and every note already on the page (after a dismissal or restore). */
  function syncPlacements() {
    ui.$$('[data-promo-slot="overview"]').forEach(function (el) {
      ui.render(el, overviewInner());
    });
    ui.$$('.promo-note[data-promo-place]').forEach(function (el) {
      var html = noteHtml(el.getAttribute('data-promo-place'), { txId: el.getAttribute('data-promo-tx') });
      if (!html) el.remove();
      else if (html !== el.outerHTML) el.outerHTML = html;
    });
  }

  function later(fn) {
    // After the router has finished (it focuses and scrolls to the view heading).
    clearTimeout(focusTimer);
    focusTimer = setTimeout(fn, 0);
  }
  function focusItem(id) {
    var h = doc.getElementById('wn-' + id + '-title');
    var card = doc.getElementById('wn-' + id);
    if (!h || YES.state.view !== 'whatsnew') return;
    try {
      card.scrollIntoView({ block: 'start', behavior: ui.reducedMotion() ? 'auto' : 'smooth' });
    } catch (e) {
      card.scrollIntoView(true);
    }
    h.focus({ preventScroll: true });
  }
  function onRoute(r) {
    if (!r || r.view !== 'whatsnew' || !r.param || !byId(r.param)) return;
    var id = r.param;
    later(function () {
      focusItem(id);
    });
  }

  /* ------------------------------------------------------------------ */
  /* Actions                                                             */
  /* ------------------------------------------------------------------ */
  function next() {
    var q = queue();
    if (q.length < 2) return null;
    var cur = currentId();
    var id = q[(q.indexOf(cur) + 1) % q.length];
    var s = S();
    s.current = id;
    save(s);
    ui.announce(t('promos.showing', { a: YES.fmt.count(q.indexOf(id) + 1), b: YES.fmt.count(q.length), title: view(id).title }));
    return id;
  }
  function dismiss(id) {
    if (!known(id)) return null;
    var q = queue();
    var s = S();
    var at = q.indexOf(id);
    if (s.dismissed.indexOf(id) === -1) s.dismissed.push(id);
    var rest = q.filter(function (x) {
      return x !== id;
    });
    var nextId = rest.length ? rest[(at === -1 ? 0 : at) % rest.length] : null;
    s.current = nextId;
    cleared = !nextId;
    save(s);
    return nextId;
  }
  function restore() {
    cleared = false;
    save({ dismissed: [], current: null });
  }
  function cta(id) {
    var m = view(id);
    if (!m) return;
    count('clicks', id);
    // Demo: nothing opens, nothing is sent (the YES app would open the feature).
    ui.toast(t('promos.ctaToast', { feature: m.feature || m.title }));
  }

  function onClick(e) {
    var b = e.target.closest && e.target.closest('[data-promo-action]');
    if (!b) return;
    var act = b.getAttribute('data-promo-action');
    var id = b.getAttribute('data-promo-id');
    if (act === 'see') {
      // Navigation itself is the global [data-nav] handler (04-core.js).
      if (known(id)) count('clicks', id);
      return;
    }
    e.preventDefault();
    if (act === 'cta') {
      cta(id);
    } else if (act === 'next') {
      next();
    } else if (act === 'dismiss') {
      var title = known(id) ? view(id).title : '';
      var nextId = dismiss(id);
      // Focus the update now shown (or the way to What's new), never the page body.
      var target = doc.querySelector(nextId ? '#promo-ov-title' : '[data-fk="promo-ov-cleared"]');
      if (target) target.focus({ preventScroll: true });
      ui.announce(nextId ? t('promos.dismissedNext', { title: title, next: view(nextId).title }) : t('promos.dismissed', { title: title }));
    } else if (act === 'restore') {
      restore();
      var h = doc.getElementById('h-whatsnew');
      if (h) h.focus({ preventScroll: true });
      ui.announce(t('promos.view.restored'));
    }
  }

  /* ------------------------------------------------------------------ */
  /* Public API (replaces the stub in 04-core.js) + registration         */
  /* ------------------------------------------------------------------ */
  YES.promos = {
    slotHtml: slotHtml,
    noteHtml: noteHtml,
    list: list,
    view: view,
    eligible: function (id) {
      var p = byId(id);
      return !!p && eligible(p);
    },
    /** The update the Overview card shows, or null. */
    current: currentId,
    next: next,
    dismiss: dismiss,
    restore: restore,
    cta: cta,
    /** Figures behind the personalised copy (minor units), for tests and Ask YES. */
    facts: function () {
      var fees = feesOfKind('network_transfer');
      var tr = trust();
      return {
        networkFees: fees.total,
        networkFeeTxIds: fees.txIds.slice(),
        networkSendIds: fees.parentIds.slice(),
        sent: sentTotal(),
        closing: st().closing,
        trustLevel: tr ? tr.level : null,
        monthlySendLimit: tr && Number.isInteger(tr.monthlySendLimit) ? tr.monthlySendLimit : null
      };
    },
    /** In-memory demo counts only: { impressions: { id: n }, clicks: { id: n } }. Never stored or sent. */
    metrics: function () {
      return JSON.parse(JSON.stringify(metrics));
    }
  };

  YES.register({
    name: 'promos',
    i18n: {
      en: {
        'promos.from': 'From YES',
        'promos.cardTitle': "What's new from YES",
        'promos.count': '{a} of {b}',
        'promos.see': "See what's new",
        'promos.next': 'Next update',
        'promos.dismiss': 'Not now',
        'promos.dismissLabel': 'Not now: hide {title} from your Overview',
        'promos.dismissed': "{title} is hidden. You can find every update in What's new.",
        'promos.dismissedNext': '{title} is hidden. Next update: {next}.',
        'promos.showing': 'Update {a} of {b}: {title}',
        'promos.cleared': "You're all caught up. Every update is in What's new.",
        'promos.clearedLink': "Open What's new",
        'promos.noteLink': 'See how',
        'promos.ctaToast': 'In the YES app, this would open {feature}. Nothing was sent.',
        'promos.forYou': 'For you',
        'promos.hiddenTag': 'Hidden from Overview',
        'promos.meter.label': 'Your trust level',
        'promos.meter.done': 'Reached',
        'promos.meter.current': "You're here",
        'promos.meter.next': 'Next',
        'promos.meter.later': 'Later',
        'promos.codes.label': 'Planned currencies',
        'promos.view.title': "What's new",
        'promos.view.lede': 'New features and developments from YES for your USBC account.',
        'promos.view.note': 'Updates are illustrative and subject to YES approval. They are not part of your statement, and they never appear in print, the PDF or the CSV file.',
        'promos.view.listLabel': 'Updates from YES',
        'promos.view.hidden1': 'You hid 1 update from your Overview.',
        'promos.view.hiddenN': 'You hid {n} updates from your Overview.',
        'promos.view.restore': 'Show dismissed updates again',
        'promos.view.restored': 'Dismissed updates are back on your Overview.',
        'promos.view.empty': 'There are no updates right now.'
      },
      es: {
        'promos.from': 'De YES',
        'promos.cardTitle': 'Novedades de YES',
        'promos.count': '{a} de {b}',
        'promos.see': 'Ver novedades',
        'promos.next': 'Siguiente novedad',
        'promos.dismiss': 'Ahora no',
        'promos.dismissLabel': 'Ahora no: ocultar {title} en tu resumen',
        'promos.dismissed': '{title} está oculta. Encontrarás todas las novedades en Novedades.',
        'promos.dismissedNext': '{title} está oculta. Siguiente novedad: {next}.',
        'promos.showing': 'Novedad {a} de {b}: {title}',
        'promos.cleared': 'Estás al día. Todas las novedades están en Novedades.',
        'promos.clearedLink': 'Abrir Novedades',
        'promos.noteLink': 'Ver cómo',
        'promos.ctaToast': 'En la app de YES, esto abriría {feature}. No se envió nada.',
        'promos.forYou': 'Para ti',
        'promos.hiddenTag': 'Oculta en el resumen',
        'promos.meter.label': 'Tu nivel de confianza',
        'promos.meter.done': 'Alcanzado',
        'promos.meter.current': 'Estás aquí',
        'promos.meter.next': 'Siguiente',
        'promos.meter.later': 'Después',
        'promos.codes.label': 'Monedas previstas',
        'promos.view.title': 'Novedades',
        'promos.view.lede': 'Nuevas funciones y novedades de YES para tu cuenta de USBC.',
        'promos.view.note': 'Las novedades son ilustrativas y están sujetas a la aprobación de YES. No forman parte de tu estado de cuenta y nunca aparecen al imprimir, en el PDF ni en el archivo CSV.',
        'promos.view.listLabel': 'Novedades de YES',
        'promos.view.hidden1': 'Ocultaste 1 novedad en tu resumen.',
        'promos.view.hiddenN': 'Ocultaste {n} novedades en tu resumen.',
        'promos.view.restore': 'Volver a mostrar las novedades ocultas',
        'promos.view.restored': 'Las novedades ocultas vuelven a tu resumen.',
        'promos.view.empty': 'No hay novedades por ahora.'
      }
    },

    init: function () {
      inited = true;
      S(); // seed from storage before anything else renders
      doc.addEventListener('click', onClick);
      // Deep links (#/whatsnew/<id>), including the first route at boot.
      YES.on('route', onRoute);
      this.render();
    },

    render: function () {
      renderView();
    },

    onState: function (keys) {
      if (!inited || keys.indexOf('promos') === -1) return;
      renderView();
      syncPlacements();
    }
  });
})(window);
