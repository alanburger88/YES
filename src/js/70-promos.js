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
 *              It never rotates on its own. When the update is personalised,
 *              its hook (the customer's own figure) is the headline, with a
 *              small preview (fee comparison, trust meter, currency chips).
 *              It fades in once, the first time it scrolls into view.
 *   teaser     one line inside the balance card, after the net change, for
 *              the top update (YES.promos.teaserHtml(), called by the overview)
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
 * (YES.promos.metrics()). Dismissals, the updates already seen in What's new
 * and whether Ask YES was opened live in YES.state.promos (so they survive a
 * language switch) and in localStorage 'yes.promos' (this browser only,
 * wrapped in try/catch: blocked storage never breaks the page). They drive the
 * masthead's new-updates badge and the dot on Ask YES (YES.promos.badges(),
 * rendered by the shell) and the New pills in What's new.
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
  var inView = false; // the What's new view is showing (one visit)
  var visitNew = []; // ids not seen yet when this visit began: their New pills stay for the visit
  var entered = false; // the Overview card's one-time entrance has run (this page view)
  var entranceIO = null;

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
  /** Posted fees of one kind in this statement's asset: { total (positive minor units), count, first (the first fee, one send's), txIds, parentIds }. */
  function feesOfKind(kind) {
    var out = { total: 0, count: 0, first: 0, txIds: [], parentIds: [] };
    calc.posted().forEach(function (x) {
      if (x.type !== 'fee' || x.feeKind !== kind || x.asset !== st().assetId) return;
      out.total += -x.amount;
      if (!out.count) out.first = -x.amount;
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
  function ids(list) {
    return Array.isArray(list) ? list.filter(known) : [];
  }
  /**
   * What this browser remembers: { dismissed, seen, ask }. Version 1 stored
   * only { v: 1, dismissed } and still loads (nothing seen, Ask YES not opened);
   * a bare array of dismissed ids loads too.
   */
  function readStored() {
    var out = { dismissed: [], seen: [], ask: false };
    try {
      var raw = root.localStorage.getItem(storageKey());
      if (!raw) return out;
      var o = JSON.parse(raw);
      if (Array.isArray(o)) {
        out.dismissed = ids(o);
      } else if (o && typeof o === 'object') {
        out.dismissed = ids(o.dismissed);
        out.seen = ids(o.seen);
        out.ask = o.ask === true;
      }
    } catch (e) {
      /* storage blocked or unreadable: nothing dismissed or seen */
    }
    return out;
  }
  function writeStored(s) {
    try {
      if (s.dismissed.length || s.seen.length || s.ask) root.localStorage.setItem(storageKey(), JSON.stringify({ v: 2, dismissed: s.dismissed, seen: s.seen, ask: !!s.ask }));
      else root.localStorage.removeItem(storageKey());
    } catch (e) {
      /* storage unavailable: the choice still applies to this page view (YES.state) */
    }
  }
  /** A copy of YES.state.promos ({ dismissed, current, seen, ask }), seeded once from this browser's storage. */
  function S() {
    var s = YES.state.promos;
    if (!s || typeof s !== 'object') {
      // First read (the overview may render before this module's init): seed
      // the state silently, without a 'state' event in the middle of a render.
      var stored = readStored();
      s = { dismissed: stored.dismissed, current: null, seen: stored.seen, ask: stored.ask };
      YES.state.promos = s;
    }
    return { dismissed: ids(s.dismissed), current: known(s.current) ? s.current : null, seen: ids(s.seen), ask: s.ask === true };
  }
  function save(next) {
    var s = { dismissed: next.dismissed.slice(), current: next.current || null, seen: (next.seen || []).slice(), ask: !!next.ask };
    writeStored(s);
    YES.set({ promos: s });
  }
  /** Mark updates as seen (What's new opened, or a deep link to one). True when something changed. */
  function markSeen(list) {
    var s = S();
    var add = list.filter(function (id) {
      return known(id) && s.seen.indexOf(id) === -1;
    });
    if (!add.length) return false;
    s.seen = s.seen.concat(add);
    save(s);
    return true;
  }
  function markAsked() {
    var s = S();
    if (s.ask) return;
    s.ask = true;
    save(s);
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
  /**
   * A promotion in the current language: { id, theme, icon, eyebrow, title,
   * body, personal, hook, support, teaser, note, cta, feature, footnote,
   * eligible, dismissed, seen }. `personal` and `hook` are '' unless eligible;
   * `support` falls back to the body.
   */
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
      hook: ok ? copy(p, 'hook', v) : '',
      support: copy(p, 'support', v) || copy(p, 'body', v),
      teaser: copy(p, 'teaser', v),
      note: copy(p, 'note', v),
      cta: copy(p, 'cta', v),
      feature: copy(p, 'feature', v),
      footnote: copy(p, 'footnote', v),
      eligible: ok,
      dismissed: isDismissed(p.id),
      seen: S().seen.indexOf(p.id) !== -1
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

  /**
   * For the masthead (05-shell.js): { whatsnew: the eligible updates in What's
   * new that were not dismissed and not seen yet, ask: show the dot on Ask YES
   * (until it is opened once, while an update is eligible) }.
   */
  function badges() {
    if (!inited || !conf()) return { whatsnew: 0, ask: false };
    var s = S();
    var any = false;
    var n = all().filter(function (p) {
      var ok = eligible(p);
      if (ok && placed(p, 'assistant')) any = true;
      return ok && placed(p, 'whatsnew') && s.dismissed.indexOf(p.id) === -1 && s.seen.indexOf(p.id) === -1;
    }).length;
    return { whatsnew: n, ask: any && !s.ask };
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
  function seeLinkHtml(p, fk, cls, label, name) {
    return (
      '<a class="' +
      cls +
      '"' +
      (name ? ' aria-label="' + esc(name) + '"' : '') +
      ' href="#/whatsnew/' +
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
  /**
   * Identity: one external send's network fee beside a YES identity's (none,
   * the stated promise, formatted with YES.fmt like every figure). The figures
   * are text; the check mark is decorative.
   */
  function compareHtml(p, idBase) {
    var f = feesOfKind(feeKindOf(p));
    if (!f.count) return '';
    function row(cls, who, minor, mark) {
      return (
        '<li class="promo-compare__row' +
        cls +
        '"><span class="promo-compare__who">' +
        (mark ? '<span class="promo-compare__mark" aria-hidden="true">' + ui.icon('check', { size: 14 }) + '</span>' : '') +
        '<span>' +
        esc(who) +
        '</span></span><span class="sr-only">: </span><span class="promo-compare__fee">' +
        esc(t('promos.compare.fee', { amount: YES.fmt.amount(minor) })) +
        '</span></li>'
      );
    }
    return (
      '<div class="promo-compare"><p class="promo-compare__label" id="' +
      esc(idBase) +
      '-compare">' +
      esc(t('promos.compare.label')) +
      '</p><ul class="promo-compare__rows" aria-labelledby="' +
      esc(idBase) +
      '-compare">' +
      row('', t('promos.compare.external'), f.first, false) +
      row(' promo-compare__row--yes', t('promos.compare.yes'), 0, true) +
      '</ul></div>'
    );
  }
  /** Currencies: the statement's asset today, the planned ones (config codes) beside it. */
  function chipsHtml(p, idBase) {
    if (!Array.isArray(p.codes) || !p.codes.length) return '';
    var a = calc.asset();
    function group(key, cls, list) {
      return (
        '<p class="promo-chips__label" id="' +
        esc(idBase) +
        '-chips-' +
        key +
        '">' +
        esc(t('promos.chips.' + key)) +
        '</p><ul class="promo-chips__list" aria-labelledby="' +
        esc(idBase) +
        '-chips-' +
        key +
        '">' +
        list
          .map(function (code) {
            return '<li class="promo-chip' + cls + '">' + (cls ? ui.icon('check', { size: 14 }) : '') + '<span translate="no">' + esc(code) + '</span></li>';
          })
          .join('') +
        '</ul>'
      );
    }
    return (
      '<div class="promo-chips">' +
      group('now', ' promo-chip--now', [a.symbol]) +
      group(
        'planned',
        '',
        p.codes.map(function (c) {
          return c.code;
        })
      ) +
      '</div>'
    );
  }
  /** The small preview beside an update: the Overview card (compact) or a What's new card. */
  function extraHtml(p, idBase, compact) {
    if (p.theme === 'trust') return meterHtml(idBase);
    if (p.theme === 'identity') return eligible(p) ? compareHtml(p, idBase) : '';
    if (p.theme === 'currencies') return compact ? chipsHtml(p, idBase) : codesHtml(p, idBase);
    return ''; // interest: no figures, no preview
  }

  /** The Overview card: one update at a time. */
  function overviewCardHtml(id) {
    var p = byId(id);
    var m = view(id);
    var q = queue();
    var pos = q.indexOf(id);
    impression('overview', id);
    var counter = q.length > 1 ? '<span class="promo__count">' + esc(t('promos.count', { a: YES.fmt.count(pos + 1), b: YES.fmt.count(q.length) })) + '</span>' : '';
    // Personalised: the customer's own figure leads (the hook), and the
    // supporting line says what to do. Otherwise the title and the body.
    var lead = m.hook
      ? '<p class="promo__body promo__support">' + textHtml(m.support, p.handle) + '</p>'
      : '<p class="promo__body">' + textHtml(m.body, p.handle) + (m.personal ? ' <span class="promo__personal">' + textHtml(m.personal, p.handle) + '</span>' : '') + '</p>';
    var visual = extraHtml(p, 'promo-ov', true);
    return (
      '<section class="promo promo--overview' +
      (visual ? ' promo--visual' : '') +
      (m.hook ? ' promo--hook' : '') +
      '" aria-labelledby="promo-ov-h" data-promo="' +
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
      esc(m.hook || m.title) +
      '</h3>' +
      lead +
      (m.footnote ? '<p class="promo__foot">' + textHtml(m.footnote, p.handle) + '</p>' : '') +
      '</div>' +
      (visual ? '<div class="promo__visual">' + visual + '</div>' : '') +
      '<div class="promo__actions">' +
      seeLinkHtml(p, 'promo-ov-see', 'btn btn--promo', '<span>' + esc(t('promos.see')) + '</span>' + ui.icon('arrow-right', { size: 18 })) +
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
  /** Where the Overview card sits: 'afterBalance' (default) or 'afterJourney' (config). */
  function overviewPosition() {
    var c = conf();
    return c && c.overviewPosition === 'afterJourney' ? 'afterJourney' : 'afterBalance';
  }
  /**
   * Markup for a placement slot owned by this module: slotHtml('overview',
   * position) gives the card only at the configured position (the overview
   * offers both), so there is never more than one.
   */
  function slotHtml(place, position) {
    if (place !== 'overview' || !conf()) return '';
    if ((position || 'afterBalance') !== overviewPosition()) return '';
    armEntranceSoon();
    return '<div class="promo-slot promo-slot--' + overviewPosition() + '" data-promo-slot="overview">' + overviewInner() + '</div>';
  }

  /**
   * The top update for the balance card's teaser: the highest-priority
   * eligible update placed on the Overview. None when it was dismissed (the
   * teaser then hides), when nothing is eligible or promotions are off.
   */
  function teaserId() {
    if (!conf()) return null;
    var top = sorted(
      all().filter(function (p) {
        return placed(p, 'overview') && eligible(p);
      })
    )[0];
    return top && !isDismissed(top.id) && YES.L(top.teaser) ? top.id : null;
  }
  function teaserInner() {
    var id = teaserId();
    var m = id && view(id);
    if (!m || !m.teaser) return '';
    var p = byId(id);
    impression('teaser', id);
    // Set apart from the statement's figures: a hairline, the "From YES" label
    // and the Illustrative tag. The link opens the update in What's new.
    return (
      '<div class="promo-teaser" data-promo="' +
      esc(id) +
      '" data-promo-place="teaser">' +
      '<p class="promo-teaser__msg"><span class="promo-teaser__labels">' +
      fromHtml() +
      demoTag() +
      '</span> <span class="promo-teaser__text">' +
      textHtml(m.teaser, p.handle) +
      '</span> ' +
      // Named in full ("See what's new: Pay a YES identity"); the visible words come first.
      seeLinkHtml(p, 'promo-teaser-see', 'promo-teaser__link', '<span>' + esc(t('promos.see')) + '</span>' + ui.icon('arrow-right', { size: 16 }), t('promos.see') + ': ' + m.title) +
      '</p></div>'
    );
  }
  /** The balance card's one-line teaser (the overview places it after the net change), or ''. */
  function teaserHtml() {
    if (!conf()) return '';
    return '<div class="promo-teaser-slot" data-promo-slot="teaser">' + teaserInner() + '</div>';
  }

  /*
   * One-time entrance: the first time the Overview card scrolls into view in
   * this page view, it fades in and lifts (CSS, about 300ms). The card is
   * visible from the start: the class is added only as it enters, never under
   * reduced motion, never again after a re-render.
   */
  function armEntranceSoon() {
    if (entered) return;
    setTimeout(armEntrance, 0);
  }
  function armEntrance() {
    if (entranceIO) {
      entranceIO.disconnect();
      entranceIO = null;
    }
    if (entered) return;
    var card = doc.querySelector('#overview-root .promo--overview');
    if (!card) return;
    if (typeof root.IntersectionObserver !== 'function' || ui.reducedMotion()) {
      entered = true; // nothing to animate: the card simply shows
      return;
    }
    entranceIO = new root.IntersectionObserver(function (entries) {
      if (entered) return;
      for (var i = 0; i < entries.length; i++) {
        if (!entries[i].isIntersecting) continue;
        entered = true;
        if (entranceIO) entranceIO.disconnect();
        entranceIO = null;
        if (!ui.reducedMotion() && entries[i].target.isConnected) entries[i].target.classList.add('promo--enter');
        return;
      }
    });
    entranceIO.observe(card);
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
      // The labels first, then the message and its link (one line when there is room).
      '<span class="promo-note__labels">' +
      fromHtml() +
      demoTag() +
      '</span><span class="promo-note__msg"><span class="promo-note__text">' +
      textHtml(m.note, p.handle) +
      '</span> ' +
      seeLinkHtml(p, fk, 'promo-note__link', esc(t('promos.noteLink')) + '<span class="sr-only">: ' + esc(m.title) + '</span>') +
      '</span></p>'
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
      // New: not seen yet when this visit to What's new began (kept for the visit).
      (visitNew.indexOf(id) !== -1 ? '<span class="promo-new">' + esc(t('promos.new')) + '</span>' : '') +
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
    ui.$$('[data-promo-slot="teaser"]').forEach(function (el) {
      var html = teaserInner();
      if (html !== el.innerHTML) ui.render(el, html);
    });
    armEntranceSoon();
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
  /**
   * Seen: opening What's new marks every update in it as seen; a deep link
   * (#/whatsnew/<id>) marks only that update. The New pills are those not seen
   * when the visit began, and they stay until the customer leaves the view.
   */
  function onRoute(r) {
    if (!r || r.view !== 'whatsnew') {
      inView = false;
      return;
    }
    var id = r.param && byId(r.param) ? r.param : null;
    var entering = !inView;
    if (entering) {
      inView = true;
      var s = S();
      visitNew = list('whatsnew').filter(function (x) {
        return s.seen.indexOf(x) === -1;
      });
    }
    // A change re-renders the view (onState); otherwise refresh this visit's pills.
    if (!markSeen(id ? [id] : list('whatsnew')) && entering) renderView();
    if (!id) return;
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
    var s = S();
    save({ dismissed: [], current: null, seen: s.seen, ask: s.ask }); // what was seen stays seen
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
    teaserHtml: teaserHtml,
    noteHtml: noteHtml,
    badges: badges,
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
        'promos.new': 'New',
        'promos.compare.label': 'Network fee per send',
        'promos.compare.external': 'External wallet',
        'promos.compare.yes': 'YES identity',
        'promos.compare.fee': 'Network fee {amount}',
        'promos.chips.now': 'Now',
        'promos.chips.planned': 'Planned',
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
        'promos.new': 'Nuevo',
        'promos.compare.label': 'Comisión de red por envío',
        'promos.compare.external': 'Monedero externo',
        'promos.compare.yes': 'Identidad YES',
        'promos.compare.fee': 'Comisión de red {amount}',
        'promos.chips.now': 'Ahora',
        'promos.chips.planned': 'Previstas',
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
      if (!inited) return;
      // Ask YES opened once: its dot goes (kept in this browser).
      if (keys.indexOf('assistant') !== -1 && YES.state.assistant && YES.state.assistant.open && conf()) markAsked();
      if (keys.indexOf('promos') === -1) return;
      renderView();
      syncPlacements();
    }
  });
})(window);
