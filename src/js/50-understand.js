/*
 * Understand: bank-issued digital dollar education, statement versus live balance, the sample
 * on-chain reference and the illustrative reserve / transparency panel
 * (PRD 4 layer 4 "Trust and help", 5.6, 5.9, 6 "Education/evidence").
 *
 * Content governance (PRD 6): every explanation and every evidence slot is a
 * content record in YES.content.education / YES.content.evidence with an
 * approved-copy ID, locale variants, source, date, responsible entity,
 * validity window, visibility rule and illustrative flag. Records are rendered
 * only when their rule passes; the record itself is shown in small print so the
 * governance model is visible. The copy text lives in the i18n dictionaries
 * (both locales ship in the file), so `copyKey`, `source` and
 * `responsibleEntity` hold string keys rather than text.
 *
 * Every figure in an example comes from YES.calc / YES.data. Expanded topics and
 * the hash display live in YES.state.understand so they survive a language
 * switch. Nothing here links to a real explorer, issuer or report.
 */
(function (root) {
  'use strict';
  var YES = root.YES;
  var ui = YES.ui;
  var t = YES.t;
  var esc = ui.esc;
  var doc = root.document;

  /* Accordion topics, in reading order; 'transparency' is a panel, not an accordion item. */
  var TOPICS = ['token_units', 'usd_equivalent', 'onchain_vs_internal', 'tx_status', 'fees', 'redemption', 'statement_vs_live'];
  var OPENABLE = TOPICS.concat(['transparency']);
  /* Route params that focus a panel (#/understand/<panel>). */
  var PANELS = ['basics', 'live', 'onchain', 'transparency'];
  var PANEL_ICONS = { basics: 'book', live: 'calendar', onchain: 'chain', transparency: 'shield' };
  var TOPIC_ICONS = {
    token_units: 'units',
    usd_equivalent: 'approx',
    onchain_vs_internal: 'chain',
    tx_status: 'check-circle',
    fees: 'fee',
    redemption: 'redeem',
    statement_vs_live: 'calendar'
  };
  /* Icons the shared set does not have, drawn in the same 24×24 stroke style. */
  var LOCAL_ICONS = {
    units: '<rect x="3" y="7" width="18" height="10" rx="2"/><path d="M7 7v3.5"/><path d="M11 7v5"/><path d="M15 7v3.5"/>',
    approx: '<path d="M5 9.5c2.3-2 4.7-2 7 0s4.7 2 7 0"/><path d="M5 15.5c2.3-2 4.7-2 7 0s4.7 2 7 0"/>',
    expand: '<path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/>',
    collapse: '<path d="m7 20 5-5 5 5"/><path d="m7 4 5 5 5-5"/>',
    nolink: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/><path d="m4 4 16 16"/>'
  };

  /* Related-transaction shortcuts: the explorer filter and the matching test, so the
     count on the button is exactly what the explorer will list. */
  var REL = {
    onchain: { filter: { rails: ['onchain'] } },
    internal: { filter: { rails: ['internal'], types: ['transfer_in', 'transfer_out'] } },
    pending: { filter: { statuses: ['pending'] } },
    fees: { filter: { types: ['fee'] } },
    redemptions: { filter: { types: ['redemption'] } }
  };
  var FILTER_FIELDS = { types: 'type', statuses: 'status', rails: 'rail' };

  /* ------------------------------------------------------------------ */
  /* Content records (PRD 6: Education/evidence)                         */
  /* ------------------------------------------------------------------ */
  var CONTENT_DATE = '2026-10-01T09:00:00-04:00';
  var VALIDITY = { from: '2026-09-01T00:00:00-04:00', to: '2027-03-31T23:59:59-04:00' };

  function contentRecord(kind, id, copyId, copyKey, visibility, extra) {
    var rec = {
      id: id,
      kind: kind,
      copyId: copyId, // approved-copy ID (demo IDs until YES approves the copy)
      version: '0.1',
      copyKey: copyKey, // i18n key of the record's title/label (both locales ship)
      locales: ['en', 'es'], // locale variants present in this file
      source: 'understand.meta.sourceDemo', // "Demo copy — pending YES approval"
      date: CONTENT_DATE,
      responsibleEntity: 'understand.meta.ownerSlot', // "[YES content owner]"
      validity: { from: VALIDITY.from, to: VALIDITY.to },
      visibility: visibility, // rule id, see RULES
      illustrative: true,
      approved: false
    };
    Object.keys(extra || {}).forEach(function (k) {
      rec[k] = extra[k];
    });
    return rec;
  }
  function eduRecord(id, copyId) {
    return contentRecord('education', id, copyId, 'understand.topic.' + id + '.title', 'always');
  }
  function evRecord(id, copyId, extra) {
    var e = { verified: false, evidence: null };
    Object.keys(extra || {}).forEach(function (k) {
      e[k] = extra[k];
    });
    return contentRecord('evidence', id, copyId, e.copyKey || 'understand.tp.slot.' + id, 'verified_current', e);
  }

  YES.content = YES.content || {};
  YES.content.education = [
    eduRecord('token_units', 'EDU-001-TOKEN-UNITS'),
    eduRecord('usd_equivalent', 'EDU-002-USD-EQUIVALENT'),
    eduRecord('onchain_vs_internal', 'EDU-003-ONCHAIN-INTERNAL'),
    eduRecord('tx_status', 'EDU-004-TX-STATUS'),
    eduRecord('fees', 'EDU-005-FEES'),
    eduRecord('redemption', 'EDU-006-REDEMPTION'),
    eduRecord('statement_vs_live', 'EDU-007-STATEMENT-LIVE')
  ];
  YES.content.evidence = [
    evRecord('onchain_reference', 'EVD-101-ONCHAIN-SAMPLE', { copyKey: 'understand.oc.title' }),
    /* The panel layout and its production rules (copy, not a claim): always shown. */
    contentRecord('evidence', 'transparency_panel', 'EVD-200-TRANSPARENCY-PANEL', 'understand.tp.title', 'always', { verified: false, evidence: null }),
    evRecord('issuer', 'EVD-201-ISSUER', { slot: 'ISSUER_OR_PARTNER' }),
    evRecord('reserve_report', 'EVD-202-RESERVE-REPORT'),
    evRecord('attestation_date', 'EVD-203-ATTESTATION-DATE'),
    evRecord('redemption_terms', 'EVD-204-REDEMPTION-TERMS'),
    evRecord('source_link', 'EVD-205-SOURCE-LINK'),
    /* Neither verified nor illustrative: the production rule hides the claim, and the
       transparency panel renders this record as its "information unavailable" example. */
    evRecord('attestation_example', 'EVD-299-UNAVAILABLE-EXAMPLE', { copyKey: 'understand.tp.ex.name', illustrative: false, example: true })
  ];

  function record(list, id) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  function asOf() {
    return YES.data.statement.asOf;
  }
  function withinValidity(rec, iso) {
    var x = Date.parse(iso);
    return !!rec.validity && x >= Date.parse(rec.validity.from) && x <= Date.parse(rec.validity.to);
  }
  function hasLocale(rec) {
    var lang = YES.i18n.lang;
    var table = YES.i18n.dict[lang] || {};
    return rec.locales.indexOf(lang) !== -1 && rec.copyKey in table;
  }
  var RULES = {
    always: function () {
      return true;
    },
    verified_current: function (rec) {
      return evidenceState(rec) === 'verified';
    }
  };

  /** Education copy is shown only with a locale variant, inside its validity window, when its rule passes. */
  function eduVisible(rec) {
    if (!rec) return false;
    var rule = RULES[rec.visibility];
    return hasLocale(rec) && withinValidity(rec, asOf()) && !!rule && rule(rec);
  }

  /**
   * Evidence state (PRD 5.6): 'verified' only with verified evidence, source, date,
   * responsible entity and a current validity window; 'stale' when verified evidence
   * has expired; 'illustrative' for labelled showcase placeholders; otherwise
   * 'unavailable' — the claim is hidden and the page says so.
   */
  function evidenceState(rec) {
    if (!rec) return 'unavailable';
    var verifiedOk = !!(YES.config.features.verifiedEvidence && rec.verified && rec.evidence && rec.source && rec.date && rec.responsibleEntity);
    if (verifiedOk) return withinValidity(rec, asOf()) ? 'verified' : 'stale';
    if (YES.config.demo && rec.illustrative) return 'illustrative';
    return 'unavailable';
  }

  /* ------------------------------------------------------------------ */
  /* Helpers                                                             */
  /* ------------------------------------------------------------------ */
  var els = { root: null };
  var inited = false;
  var justOpened = null;
  var focusTimer = null;

  function icon(name, opts) {
    var html = ui.icon(LOCAL_ICONS[name] ? 'info' : name, opts);
    if (!LOCAL_ICONS[name]) return html;
    var open = html.indexOf('>') + 1;
    var close = html.lastIndexOf('</svg>');
    return html.slice(0, open) + LOCAL_ICONS[name] + html.slice(close);
  }
  function st() {
    return YES.data.statement;
  }
  function asset() {
    return YES.calc.asset();
  }
  function tzShort(iso) {
    var s = YES.fmt.tz(iso);
    var i = s.indexOf(' (');
    return i === -1 ? s : s.slice(0, i);
  }
  function dateTime(iso) {
    return YES.fmt.date(iso, 'datetime') + ' ' + tzShort(iso);
  }
  function amountText(minor, sign) {
    return YES.fmt.amount(minor, { sign: sign || 'auto' });
  }
  function signed(minor) {
    return ui.amountHtml(minor, { sign: 'always' });
  }
  function balance(minor) {
    return ui.amountHtml(minor, { sign: 'auto' });
  }
  function sumOf(list) {
    var s = 0;
    list.forEach(function (x) {
      s += x.amount;
    });
    return s;
  }
  function product() {
    return YES.L(YES.config.slots.PRODUCT_NAME);
  }
  function issuer() {
    return YES.L(YES.config.slots.ISSUER_OR_PARTNER);
  }
  function pendingTx() {
    return YES.calc.notInBalance().filter(function (x) {
      return x.status === 'pending';
    });
  }
  function isTransfer(x) {
    return x.type === 'transfer_in' || x.type === 'transfer_out';
  }
  function onchainTx() {
    var list = YES.calc.all().filter(function (x) {
      return !!x.onchain;
    });
    return list[0] || null;
  }
  /**
   * Which on-chain transfers show a network and hash, worded from the data (PRD 5.3:
   * only when verified; 5.6: one illustrative sample). A transfer without details
   * shows none, so the note never claims that every transfer has them.
   */
  function onchainDetailsNote(list) {
    var state = evidenceState(record(YES.content.evidence, 'onchain_reference'));
    var verified = list.filter(function (x) {
      return x.onchain && x.onchain.verified;
    }).length;
    var samples = list.filter(function (x) {
      return x.onchain && !x.onchain.verified;
    }).length;
    var total = YES.fmt.count(list.length);
    if (state === 'verified' && verified) return t('understand.ex.onchainNoteVerified', { n: YES.fmt.count(verified), total: total });
    if (state === 'illustrative' && samples) return t('understand.ex.onchainNoteSample', { n: YES.fmt.count(samples), total: total });
    return t('understand.ex.onchainNoteNone');
  }
  function matches(tx, filter) {
    return Object.keys(filter).every(function (k) {
      var field = FILTER_FIELDS[k];
      return !field || filter[k].indexOf(tx[field]) !== -1;
    });
  }
  function relCount(id) {
    var f = REL[id].filter;
    return YES.calc.all().filter(function (x) {
      return matches(x, f);
    }).length;
  }
  function tag(text, cls, iconName) {
    return '<span class="tag' + (cls ? ' ' + cls : '') + '">' + (iconName ? icon(iconName, { size: 14 }) : '') + '<span>' + esc(text) + '</span></span>';
  }
  function placeholder(text) {
    return '<span class="und-ph">' + esc(text) + '</span>';
  }

  /* --------------------------- State ------------------------------- */
  function U() {
    var s = YES.state.understand || {};
    var exp = Array.isArray(s.expanded) ? s.expanded : [];
    var meta = {};
    Object.keys(s.meta || {}).forEach(function (k) {
      if (s.meta[k]) meta[k] = true;
    });
    return {
      expanded: TOPICS.filter(function (id) {
        return exp.indexOf(id) !== -1;
      }),
      fullHash: !!s.fullHash,
      meta: meta // content-record disclosures the customer opened, by copy ID
    };
  }
  function setU(patch) {
    var u = U();
    Object.keys(patch).forEach(function (k) {
      u[k] = patch[k];
    });
    return YES.set({ understand: u });
  }
  function isOpen(id) {
    return U().expanded.indexOf(id) !== -1;
  }
  function setOpen(id, open) {
    var e = U().expanded.filter(function (x) {
      return x !== id;
    });
    if (open) e.push(id);
    setU({ expanded: e });
  }

  /* ------------------------------------------------------------------ */
  /* Shared fragments                                                    */
  /* ------------------------------------------------------------------ */
  function panelHead(id, title, tagHtml) {
    return (
      '<div class="und-panel__head">' +
      '<span class="und-panel__icon">' +
      icon(PANEL_ICONS[id], { size: 22 }) +
      '</span>' +
      '<h2 class="und-panel__title" id="und-' +
      id +
      '-title" tabindex="-1" data-fk="und-h-' +
      id +
      '">' +
      esc(title) +
      '</h2>' +
      (tagHtml ? '<span class="und-panel__tag">' + tagHtml + '</span>' : '') +
      '</div>'
    );
  }

  function metaHtml(rec, extraRows) {
    var rows = [
      ['understand.meta.id', '<span class="und-meta__id">' + esc(rec.copyId) + '</span> ' + esc(t('understand.meta.versionValue', { v: rec.version }))],
      ['understand.meta.source', esc(t(rec.source))],
      ['understand.meta.owner', esc(t(rec.responsibleEntity))],
      ['understand.meta.date', esc(YES.fmt.date(rec.date, 'medium'))],
      ['understand.meta.validity', esc(t('understand.meta.validityValue', { from: YES.fmt.date(rec.validity.from, 'medium'), to: YES.fmt.date(rec.validity.to, 'medium') }))],
      ['understand.meta.visibility', esc(t('understand.meta.vis.' + rec.visibility))],
      [
        'understand.meta.languages',
        esc(
          rec.locales
            .map(function (l) {
              return t('lang.' + l);
            })
            .join(', ')
        )
      ],
      ['understand.meta.status', esc(t(rec.illustrative ? 'understand.meta.statusIllustrative' : rec.approved ? 'understand.meta.statusApproved' : 'understand.meta.statusDraft'))]
    ].concat(extraRows || []);
    var open = !!U().meta[rec.copyId];
    return (
      '<details class="und-meta" data-content-record="' +
      esc(rec.copyId) +
      '"' +
      (open ? ' open' : '') +
      '><summary class="und-meta__sum" data-fk="und-meta-' +
      esc(rec.copyId) +
      '">' +
      icon('book', { size: 14 }) +
      '<span class="und-meta__sumtext"><span class="und-meta__title">' +
      esc(t('understand.meta.title')) +
      '</span> <span class="und-meta__id">' +
      esc(rec.copyId) +
      '</span> <span class="und-meta__src">· ' +
      esc(t(rec.source)) +
      '</span></span>' +
      icon('chevron-down', { size: 16, cls: 'und-meta__chev' }) +
      '</summary><dl class="und-meta__list">' +
      rows
        .map(function (r) {
          return '<div><dt>' + esc(t(r[0])) + '</dt><dd>' + r[1] + '</dd></div>';
        })
        .join('') +
      '</dl></details>'
    );
  }

  function fact(labelHtml, valueHtml, noteHtml) {
    return (
      '<div class="und-fact"><dt>' +
      labelHtml +
      '</dt><dd><span class="und-fact__value">' +
      valueHtml +
      '</span>' +
      (noteHtml ? '<span class="und-fact__note">' + noteHtml + '</span>' : '') +
      '</dd></div>'
    );
  }
  function facts(list) {
    // data-n lets the stylesheet choose columns that divide the facts evenly.
    return '<dl class="und-facts" data-n="' + list.length + '">' + list.join('') + '</dl>';
  }
  function example(inner) {
    return '<div class="und-example"><p class="und-example__eyebrow">' + icon('balance', { size: 16 }) + '<span>' + esc(t('understand.inStatement')) + '</span></p>' + inner + '</div>';
  }
  function line(tx, metaHtml, extraCls) {
    return (
      '<li class="und-line' +
      (extraCls ? ' ' + extraCls : '') +
      '"><span class="und-line__main"><span class="und-line__desc">' +
      esc(YES.L(tx.description)) +
      '</span><span class="und-line__meta">' +
      metaHtml +
      '</span></span><span class="und-line__amt">' +
      signed(tx.amount) +
      '</span></li>'
    );
  }
  function txDate(tx) {
    return tx.postedAt ? t('understand.ex.postedOn', { date: YES.fmt.date(tx.postedAt, 'medium') }) : t('understand.ex.startedOn', { date: YES.fmt.date(tx.initiatedAt, 'medium') });
  }
  function relButton(relId, key, fk) {
    var n = relCount(relId);
    if (!n) return '';
    return (
      '<button type="button" class="btn und-rel" data-und-rel="' +
      esc(relId) +
      '" data-fk="' +
      esc(fk) +
      '"><span>' +
      esc(t(key, { n: YES.fmt.count(n) })) +
      '</span>' +
      icon('arrow-right', { size: 16 }) +
      '</button>'
    );
  }
  function goButton(target, key, fk, iconName) {
    return '<button type="button" class="btn btn--ghost und-go" data-und-go="' + esc(target) + '" data-fk="' + esc(fk) + '">' + icon(iconName || 'arrow-right', { size: 16 }) + '<span>' + esc(t(key)) + '</span></button>';
  }
  function paras(list) {
    return list
      .map(function (p) {
        return '<p>' + esc(p) + '</p>';
      })
      .join('');
  }

  /* ------------------------------------------------------------------ */
  /* Topic bodies — each example computed from YES.calc / YES.data       */
  /* ------------------------------------------------------------------ */
  var BODY = {
    token_units: function () {
      var a = asset();
      var smallest = null;
      YES.calc.posted().forEach(function (x) {
        if (!smallest || Math.abs(x.amount) < Math.abs(smallest.amount)) smallest = x;
      });
      var list = [
        fact(esc(t('understand.ex.closing')), balance(st().closing), esc(t('understand.ex.closingNote', { product: product(), symbol: a.symbol }))),
        fact(esc(t('understand.ex.precision')), esc(YES.fmt.count(a.precision)), esc(t('understand.ex.precisionNote', { unit: amountText(1) })))
      ];
      if (smallest) list.push(fact(esc(t('understand.ex.smallest')), signed(smallest.amount), esc(YES.L(smallest.description))));
      return {
        text: [t('understand.topic.token_units.p1', { product: product(), symbol: a.symbol, precision: YES.fmt.count(a.precision) }), t('understand.topic.token_units.p2')],
        example: facts(list),
        actions: ''
      };
    },

    usd_equivalent: function () {
      var a = asset();
      var f = a.fiat;
      var fiat = YES.calc.fiat(st().closing);
      var text = [t('understand.topic.usd_equivalent.p1'), t('understand.topic.usd_equivalent.p2')];
      if (fiat === null || !f) {
        return { text: text, example: '<p class="und-example__text">' + esc(t('understand.topic.usd_equivalent.none')) + '</p>', actions: '' };
      }
      var rate = YES.fmt.number(Math.round(f.rateMicros / 100), 4);
      var list = [
        fact(
          esc(t('understand.ex.rate')),
          esc(t('understand.ex.rateValue', { one: YES.fmt.count(1), symbol: a.symbol, rate: rate, currency: f.currency })),
          f.illustrative ? ui.illustrativeTag() : ''
        ),
        fact(esc(t('understand.ex.rateSource')), esc(YES.L(f.source))),
        fact(esc(t('understand.ex.rateTime')), esc(dateTime(f.at))),
        fact(esc(t('understand.ex.closingFiat')), esc(t('understand.ex.approx', { v: YES.fmt.fiat(fiat, f.currency) })), esc(t('understand.ex.closingFiatNote', { amount: amountText(st().closing) })))
      ];
      return { text: text, example: facts(list), actions: '' };
    },

    onchain_vs_internal: function () {
      var posted = YES.calc.posted();
      var internal = posted.filter(function (x) {
        return isTransfer(x) && x.rail === 'internal';
      });
      var onchain = posted.filter(function (x) {
        return isTransfer(x) && x.rail === 'onchain';
      });
      var netFees = [];
      onchain.forEach(function (x) {
        netFees = netFees.concat(YES.calc.feesFor(x.id));
      });
      var list = [
        fact(esc(t('understand.ex.internal')), esc(YES.txCount(internal.length)), esc(t('understand.ex.internalNote'))),
        fact(esc(t('understand.ex.onchain')), esc(YES.txCount(onchain.length)), esc(onchainDetailsNote(onchain)))
      ];
      if (onchain.length) {
        list.push(
          fact(
            esc(t('understand.ex.networkFees')),
            netFees.length ? signed(sumOf(netFees)) : esc(t('common.none')),
            esc(netFees.length === 1 ? t('understand.ex.feeLines1') : t('understand.ex.feeLinesN', { n: YES.fmt.count(netFees.length) }))
          )
        );
      }
      return {
        text: [t('understand.topic.onchain_vs_internal.p1'), t('understand.topic.onchain_vs_internal.p2')],
        example: facts(list),
        actions:
          relButton('onchain', 'understand.rel.onchain', 'und-rel-onchain') +
          relButton('internal', 'understand.rel.internal', 'und-rel-internal') +
          (onchainTx() ? goButton('onchain', 'understand.goOnchain', 'und-go-onchain-topic', 'chain') : '')
      };
    },

    tx_status: function () {
      var posted = YES.calc.posted();
      var notIn = YES.calc.notInBalance();
      var pend = pendingTx();
      var other = notIn.filter(function (x) {
        return x.status !== 'pending';
      });
      var list = [
        fact(ui.statusHtml('posted'), esc(YES.txCount(posted.length)), esc(t('understand.ex.counted'))),
        fact(
          ui.statusHtml('pending'),
          esc(YES.txCount(pend.length)),
          pend.length ? esc(t('understand.ex.notCounted', { amount: amountText(sumOf(pend)) })) : esc(t('understand.ex.nonePending'))
        ),
        fact(esc(t('understand.ex.failedUnknown')), other.length ? esc(YES.txCount(other.length)) : esc(t('common.none')), esc(t('understand.ex.failedNote')))
      ];
      return {
        text: [t('understand.topic.tx_status.p1'), t('understand.topic.tx_status.p2')],
        example: facts(list),
        actions: relButton('pending', 'understand.rel.pending', 'und-rel-pending-status')
      };
    },

    fees: function () {
      var cat = YES.calc.category('fees');
      var rows = (cat ? cat.txIds : []).map(function (id) {
        return YES.calc.tx(id);
      });
      var foreign = YES.calc.foreignFees();
      var inner;
      if (rows.length) {
        inner =
          '<ul class="und-lines">' +
          rows
            .map(function (x) {
              return line(x, esc(txDate(x)));
            })
            .join('') +
          '</ul>' +
          '<p class="und-lines__total"><span>' +
          esc(t('understand.ex.feesTotal')) +
          ' <span class="und-lines__count">' +
          esc(rows.length === 1 ? t('understand.ex.feeLines1') : t('understand.ex.feeLinesN', { n: YES.fmt.count(rows.length) })) +
          '</span></span>' +
          signed(YES.calc.feesTotal()) +
          '</p>';
      } else {
        inner = '<p class="und-example__text">' + esc(t('understand.ex.noFees')) + '</p>';
      }
      return {
        text: [
          t('understand.topic.fees.p1'),
          foreign.length ? t('understand.topic.fees.foreign', { count: YES.txCount(foreign.length) }) : t('understand.topic.fees.p2')
        ],
        example: inner,
        actions: relButton('fees', 'understand.rel.fees', 'und-rel-fees')
      };
    },

    redemption: function () {
      var cat = YES.calc.category('redemptions');
      var postedRows = (cat ? cat.txIds : []).map(function (id) {
        return YES.calc.tx(id);
      });
      var pend = pendingTx().filter(function (x) {
        return x.type === 'redemption';
      });
      var items = postedRows.map(function (x) {
        var fees = YES.calc.feesFor(x.id);
        var meta = esc(txDate(x));
        if (fees.length) meta += ' · ' + esc(t('understand.ex.withFee', { amount: amountText(sumOf(fees)) }));
        return line(x, meta);
      });
      pend.forEach(function (x) {
        items.push(line(x, ui.statusHtml('pending') + ' <span>' + esc(txDate(x)) + ' · ' + esc(t('status.notInBalance')) + '</span>', 'und-line--pending'));
      });
      var inner = items.length ? '<ul class="und-lines">' + items.join('') + '</ul>' : '<p class="und-example__text">' + esc(t('understand.ex.noRedemptions')) + '</p>';
      inner += facts([fact(esc(t('understand.ex.provider')), placeholder(issuer()), esc(t('understand.ex.providerNote')))]);
      return {
        text: [t('understand.topic.redemption.p1'), t('understand.topic.redemption.p2')],
        example: inner,
        actions: relButton('redemptions', 'understand.rel.redemptions', 'und-rel-redemptions')
      };
    },

    statement_vs_live: function () {
      var pend = pendingTx();
      var list = [
        fact(esc(t('understand.ex.statementBalance')), balance(st().closing), esc(t('understand.live.asOf', { date: dateTime(st().asOf) }))),
        fact(
          esc(t('understand.ex.pendingAtCutoff')),
          pend.length ? signed(sumOf(pend)) : esc(t('common.none')),
          pend.length ? esc(pend.length === 1 ? YES.L(pend[0].description) : YES.txCount(pend.length)) : ''
        ),
        fact(esc(t('understand.live.balance')), esc(t('understand.ex.liveNotShown')), esc(t('understand.ex.liveNotShownNote')))
      ];
      return {
        text: [t('understand.topic.statement_vs_live.p1'), t('understand.topic.statement_vs_live.p2')],
        example: facts(list),
        actions: goButton('live', 'understand.goLive', 'und-go-live-topic', 'calendar') + relButton('pending', 'understand.rel.pending', 'und-rel-pending-live')
      };
    }
  };

  /* ------------------------------------------------------------------ */
  /* View                                                                */
  /* ------------------------------------------------------------------ */
  function headHtml() {
    var period = YES.fmt.date(st().periodEnd, 'monthYear');
    var jump = PANELS.map(function (p) {
      return (
        '<li><a class="und-jump__link" href="#/understand/' +
        p +
        '" data-und-go="' +
        p +
        '" data-fk="und-go-' +
        p +
        '">' +
        icon(PANEL_ICONS[p], { size: 16 }) +
        '<span>' +
        esc(t('understand.jump.' + p)) +
        '</span></a></li>'
      );
    }).join('');
    return (
      '<div class="und-head">' +
      '<h1 id="h-understand" class="view-title" data-view-heading tabindex="-1" data-fk="und-h1">' +
      esc(t('understand.title')) +
      '</h1>' +
      '<p class="view-lede und-lede">' +
      esc(t('understand.lede', { period: period })) +
      '</p>' +
      '<p class="und-gov">' +
      icon('info', { size: 16 }) +
      '<span>' +
      esc(t('understand.gov')) +
      '</span></p>' +
      '<nav class="und-jump" aria-label="' +
      esc(t('understand.jump.label')) +
      '"><ul class="und-jump__list">' +
      jump +
      '</ul></nav>' +
      '</div>'
    );
  }

  function unavailableTopicHtml() {
    return (
      '<div class="notice und-unavail" data-und-unavailable>' +
      icon('info', { size: 20 }) +
      '<div><p><strong>' +
      esc(t('understand.unavailable.title')) +
      '</strong></p><p>' +
      esc(t('understand.unavailable.body')) +
      '</p></div></div>'
    );
  }

  function topicPanelBody(id) {
    var rec = record(YES.content.education, id);
    if (!eduVisible(rec)) return unavailableTopicHtml() + (rec ? metaHtml(rec) : '');
    var b = BODY[id]();
    var title = t('understand.topic.' + id + '.title');
    return (
      '<div class="und-acc__text-body">' +
      paras(b.text) +
      '</div>' +
      example(b.example) +
      '<div class="und-actions">' +
      ui.explainButton({ topic: 'edu', id: id }, title, { fk: 'und-explain-' + id }) +
      b.actions +
      '</div>' +
      metaHtml(rec)
    );
  }

  function topicHtml(id) {
    var open = isOpen(id);
    var anim = justOpened === id && !ui.reducedMotion();
    return (
      '<li class="und-acc__item' +
      (open ? ' is-open' : '') +
      '" id="und-topic-' +
      id +
      '" data-topic="' +
      id +
      '">' +
      '<h3 class="und-acc__h">' +
      '<button type="button" class="und-acc__btn" id="und-btn-' +
      id +
      '" aria-expanded="' +
      open +
      '" aria-controls="und-panel-' +
      id +
      '" data-und-toggle="' +
      id +
      '" data-fk="und-t-' +
      id +
      '">' +
      '<span class="und-acc__icon">' +
      icon(TOPIC_ICONS[id], { size: 20 }) +
      '</span>' +
      '<span class="und-acc__label"><span class="und-acc__title">' +
      esc(t('understand.topic.' + id + '.title')) +
      '</span><span class="und-acc__teaser">' +
      esc(t('understand.topic.' + id + '.teaser')) +
      '</span></span>' +
      icon('chevron-down', { size: 20, cls: 'und-acc__chev' }) +
      '</button></h3>' +
      '<div class="und-acc__panel' +
      (anim ? ' anim-in' : '') +
      '" id="und-panel-' +
      id +
      '" role="region" aria-labelledby="und-btn-' +
      id +
      '"' +
      (open ? '' : ' hidden') +
      '>' +
      topicPanelBody(id) +
      '</div></li>'
    );
  }

  function basicsHtml() {
    var allOpen = U().expanded.length === TOPICS.length;
    return (
      '<section class="card und-panel und-basics" id="und-basics" aria-labelledby="und-basics-title">' +
      '<div class="und-basics__top">' +
      panelHead('basics', t('understand.basics.title')) +
      '<button type="button" class="btn btn--sm und-all" data-und-all data-fk="und-all" aria-controls="' +
      TOPICS.map(function (id) {
        return 'und-panel-' + id;
      }).join(' ') +
      '">' +
      icon(allOpen ? 'collapse' : 'expand', { size: 16 }) +
      '<span>' +
      esc(t(allOpen ? 'understand.collapseAll' : 'understand.expandAll')) +
      '</span></button>' +
      '</div>' +
      '<p class="und-panel__lede">' +
      esc(t('understand.basics.lede')) +
      '</p>' +
      '<ul class="und-acc">' +
      TOPICS.map(topicHtml).join('') +
      '</ul>' +
      '</section>'
    );
  }

  function liveHtml() {
    var s = st();
    var pend = pendingTx();
    var diff;
    if (pend.length) {
      diff = pend
        .map(function (x) {
          return (
            '<li class="und-diff__item"><span class="und-diff__status">' +
            ui.statusHtml(x.status) +
            '</span><span>' +
            esc(t('understand.live.diffPending', { desc: YES.L(x.description), amount: amountText(x.amount), abs: amountText(Math.abs(x.amount)) })) +
            '</span></li>'
          );
        })
        .join('');
      diff = '<ul class="und-diff">' + diff + '</ul><p class="und-diff__other">' + esc(t('understand.live.diffOther', { asOf: dateTime(s.asOf) })) + '</p>';
    } else {
      diff = '<p class="und-diff__other">' + esc(t('understand.live.diffNone', { asOf: dateTime(s.asOf) })) + '</p>';
    }
    return (
      '<section class="card und-panel und-live" id="und-live" aria-labelledby="und-live-title">' +
      panelHead('live', t('understand.live.title')) +
      '<p class="und-panel__lede">' +
      esc(t('understand.live.lede')) +
      '</p>' +
      '<div class="und-live__snap" data-und-area="statement">' +
      '<div class="und-live__top"><h3 class="und-live__h">' +
      esc(t('understand.live.snapTitle')) +
      '</h3>' +
      tag(t('understand.live.snapTag'), 'und-tag--record', 'lock') +
      '</div>' +
      '<p class="und-live__label">' +
      esc(t('understand.live.closing')) +
      '</p>' +
      '<p class="und-live__amount">' +
      balance(s.closing) +
      '</p>' +
      '<p class="und-live__line">' +
      icon('clock', { size: 16 }) +
      '<span>' +
      esc(t('understand.live.asOf', { date: dateTime(s.asOf) })) +
      '</span></p>' +
      '<p class="und-live__line">' +
      icon('calendar', { size: 16 }) +
      '<span>' +
      esc(t('understand.live.period', { range: YES.fmt.range(s.periodStart, s.periodEnd) })) +
      '</span></p>' +
      '<p class="und-live__line">' +
      icon('lock', { size: 16 }) +
      '<span>' +
      esc(t('understand.live.fixed')) +
      '</span></p>' +
      '</div>' +
      '<p class="und-live__divider"><span>' +
      esc(t('understand.live.divider')) +
      '</span></p>' +
      '<div class="und-live__live" data-und-area="live">' +
      '<div class="und-live__top"><h3 class="und-live__h">' +
      esc(t('understand.live.liveTitle')) +
      '</h3>' +
      tag(t('understand.live.liveTag'), 'und-tag--off', 'nolink') +
      '</div>' +
      '<p class="und-live__nc">' +
      esc(t('understand.live.notConnected')) +
      '</p>' +
      '<dl class="und-live__kv">' +
      '<div><dt>' +
      esc(t('understand.live.balance')) +
      '</dt><dd>' +
      esc(t('understand.live.balanceValue')) +
      '</dd></div>' +
      '<div><dt>' +
      esc(t('understand.live.updated')) +
      '</dt><dd>' +
      placeholder(t('understand.live.updatedValue')) +
      '</dd></div>' +
      '</dl>' +
      '<p class="und-live__prod">' +
      esc(t('understand.live.prod')) +
      '</p>' +
      '</div>' +
      '<h3 class="und-diff__title">' +
      esc(t('understand.live.diffTitle')) +
      '</h3>' +
      diff +
      (pend.length
        ? '<div class="und-actions"><button type="button" class="btn" data-und-opentx="' +
          esc(pend[0].id) +
          '" data-fk="und-live-opentx">' +
          icon('clock', { size: 16 }) +
          '<span>' +
          esc(t(pend.length === 1 ? 'understand.live.viewPending' : 'understand.live.viewFirstPending')) +
          '</span></button></div>'
        : '') +
      '</section>'
    );
  }

  function onchainHtml() {
    var tx = onchainTx();
    var rec = record(YES.content.evidence, 'onchain_reference');
    var state = evidenceState(rec);
    var head = panelHead('onchain', t('understand.oc.title'), ui.illustrativeTag());
    if (!tx || state === 'unavailable') {
      return (
        '<section class="card und-panel und-oc" id="und-onchain" aria-labelledby="und-onchain-title">' +
        head +
        evidenceUnavailableHtml(t('understand.oc.title'), tx ? 'understand.tp.ex.body' : 'understand.oc.none') +
        '</section>'
      );
    }
    var oc = tx.onchain;
    var full = U().fullHash;
    var dir = tx.amount < 0 ? 'out' : 'in';
    return (
      '<section class="card und-panel und-oc" id="und-onchain" aria-labelledby="und-onchain-title">' +
      head +
      '<div class="notice notice--illustrative und-label" data-und-label="onchain">' +
      icon('info', { size: 20 }) +
      '<div><p class="und-label__text"><strong>' +
      esc(t('understand.oc.label')) +
      '</strong></p><p>' +
      esc(t('understand.oc.labelBody')) +
      '</p></div></div>' +
      '<div class="und-oc__tx">' +
      '<span class="dir dir--' +
      dir +
      '">' +
      icon(ui.typeIcon(tx.type), { size: 18 }) +
      '</span>' +
      '<span class="und-oc__txmain"><span class="und-oc__desc">' +
      esc(YES.L(tx.description)) +
      '</span><span class="und-oc__txmeta"><span>' +
      esc(ui.typeLabel(tx)) +
      '</span> · <span>' +
      esc(YES.fmt.date(tx.postedAt || tx.initiatedAt, 'medium')) +
      '</span> · <span>' +
      esc(t('rail.' + tx.rail)) +
      '</span></span></span>' +
      '<span class="und-oc__amt">' +
      signed(tx.amount) +
      '</span>' +
      '</div>' +
      '<dl class="und-oc__kv">' +
      '<div><dt>' +
      esc(t('understand.oc.network')) +
      '</dt><dd>' +
      esc(YES.L(oc.network)) +
      '</dd></div>' +
      '<div class="und-oc__hashrow"><dt>' +
      esc(t('understand.oc.hash')) +
      '</dt><dd><code class="mono und-hash" id="und-hash" data-full="' +
      (full ? 'true' : 'false') +
      '">' +
      esc(full ? oc.hash : oc.hashDisplay) +
      '</code>' +
      '<span class="und-hash__actions">' +
      '<button type="button" class="btn btn--sm" data-und-copy data-fk="und-copy-hash" aria-label="' +
      esc(t('understand.oc.copyHashLabel')) +
      '">' +
      icon('copy', { size: 16 }) +
      '<span>' +
      esc(t('understand.oc.copyHash')) +
      '</span></button>' +
      '<button type="button" class="btn btn--sm btn--ghost" data-und-fullhash data-fk="und-full-hash" aria-pressed="' +
      (full ? 'true' : 'false') +
      '" aria-controls="und-hash">' +
      icon('eye', { size: 16 }) +
      '<span>' +
      esc(t('understand.oc.showFull')) +
      '</span></button>' +
      '</span></dd></div>' +
      '<div><dt>' +
      esc(t('understand.oc.confirmations')) +
      '</dt><dd>' +
      esc(YES.fmt.count(oc.confirmations)) +
      ' <span class="und-oc__note">' +
      esc(t('understand.oc.confirmationsNote')) +
      '</span></dd></div>' +
      '<div><dt>' +
      esc(t('understand.oc.verification')) +
      '</dt><dd class="und-oc__unverified">' +
      icon('alert', { size: 16 }) +
      '<span>' +
      esc(t(oc.verified ? 'understand.oc.verified' : 'understand.oc.notVerified')) +
      '</span></dd></div>' +
      '<div><dt>' +
      esc(t('understand.oc.explorer')) +
      '</dt><dd class="und-oc__nolink">' +
      icon('nolink', { size: 16 }) +
      '<span>' +
      esc(t('understand.oc.noLink')) +
      '</span></dd></div>' +
      '</dl>' +
      '<div class="und-oc__why"><h3 class="und-oc__why-title">' +
      esc(t('understand.oc.whyTitle')) +
      '</h3><p>' +
      esc(t('understand.oc.why')) +
      '</p></div>' +
      '<div class="und-actions">' +
      '<button type="button" class="btn btn--primary" data-und-opentx="' +
      esc(tx.id) +
      '" data-fk="und-oc-opentx">' +
      '<span>' +
      esc(t('understand.oc.open')) +
      '</span>' +
      icon('arrow-right', { size: 16 }) +
      '</button>' +
      '</div>' +
      metaHtml(rec, [['understand.meta.evidence', esc(t('understand.meta.ev.' + state))]]) +
      '</section>'
    );
  }

  function evidenceUnavailableHtml(name, bodyKey) {
    return (
      '<div class="und-unavail-card" data-und-unavailable>' +
      '<div class="und-unavail-card__head"><span class="und-unavail-card__name">' +
      esc(name) +
      '</span>' +
      '<span class="status status--unknown">' +
      icon('info', { size: 16 }) +
      '<span>' +
      esc(t('understand.tp.ex.state')) +
      '</span></span></div>' +
      '<p>' +
      esc(t(bodyKey)) +
      '</p></div>'
    );
  }

  function slotValue(rec) {
    var state = evidenceState(rec);
    if (state === 'illustrative') {
      var text = rec.slot ? YES.L(YES.config.slots[rec.slot]) : t('understand.tp.ph.' + rec.id);
      return placeholder(text);
    }
    if (state === 'verified') {
      /* Production path: the fact plus its provenance. Not reachable in the showcase
         (features.verifiedEvidence is false and no record carries evidence). */
      var ev = rec.evidence || {};
      return (
        '<span class="und-slot__fact">' +
        esc(YES.L(ev.value)) +
        '</span><span class="und-slot__prov">' +
        esc(t('understand.tp.provenance', { source: YES.L(ev.sourceName), date: YES.fmt.date(rec.date, 'medium'), owner: t(rec.responsibleEntity) })) +
        '</span>'
      );
    }
    return '<span class="und-slot__na">' + icon('info', { size: 14 }) + '<span>' + esc(t('understand.tp.ex.state')) + '</span></span>';
  }

  function transparencyHtml() {
    var slots = ['issuer', 'reserve_report', 'attestation_date', 'redemption_terms', 'source_link'];
    var slotRows = slots
      .map(function (id) {
        var rec = record(YES.content.evidence, id);
        return (
          '<div class="und-slot" data-slot-id="' +
          esc(id) +
          '" data-evidence-state="' +
          esc(evidenceState(rec)) +
          '"><dt>' +
          esc(t('understand.tp.slot.' + id)) +
          '</dt><dd>' +
          slotValue(rec) +
          '<span class="und-slot__rec"><span class="und-meta__id">' +
          esc(rec.copyId) +
          '</span> · ' +
          esc(t('understand.meta.ev.' + evidenceState(rec))) +
          '</span></dd></div>'
        );
      })
      .join('');
    var rules = ['rule1', 'rule2', 'rule3']
      .map(function (k, i) {
        return '<li><span class="und-rules__n" aria-hidden="true">' + esc(YES.fmt.count(i + 1)) + '</span><span>' + esc(t('understand.tp.' + k)) + '</span></li>';
      })
      .join('');
    var exRec = record(YES.content.evidence, 'attestation_example');
    var exState = evidenceState(exRec);
    var slotRecIds = slots.map(function (id) {
      return record(YES.content.evidence, id).copyId;
    });
    var panelRec = record(YES.content.evidence, 'transparency_panel');
    return (
      '<section class="card und-panel und-tp" id="und-transparency" aria-labelledby="und-transparency-title">' +
      panelHead('transparency', t('understand.tp.title'), ui.illustrativeTag()) +
      '<div class="notice notice--illustrative und-label" data-und-label="transparency">' +
      icon('info', { size: 20 }) +
      '<div><p class="und-label__text"><strong>' +
      esc(t('understand.tp.label')) +
      '</strong></p><p>' +
      esc(t('understand.tp.labelBody')) +
      '</p></div></div>' +
      '<div class="und-tp__grid">' +
      '<div class="und-tp__col">' +
      '<div class="und-tp__hrow"><h3 class="und-tp__h">' +
      esc(t('understand.tp.slotsTitle')) +
      '</h3>' +
      tag(t('understand.tp.placeholders'), 'tag--illustrative', 'info') +
      '</div>' +
      '<dl class="und-slots">' +
      slotRows +
      '</dl>' +
      '<p class="und-tp__nolinks">' +
      icon('nolink', { size: 16 }) +
      '<span>' +
      esc(t('understand.tp.noLinks')) +
      '</span></p>' +
      '</div>' +
      '<div class="und-tp__col">' +
      '<h3 class="und-tp__h">' +
      esc(t('understand.tp.ruleTitle')) +
      '</h3>' +
      '<ol class="und-rules">' +
      rules +
      '</ol>' +
      '<div class="und-preview" data-und-example="unavailable" data-evidence-state="' +
      esc(exState) +
      '">' +
      '<div class="und-preview__head"><h3 class="und-preview__title">' +
      esc(t('understand.tp.exampleTitle')) +
      '</h3>' +
      tag(t('understand.tp.exampleTag'), '', 'eye') +
      '</div>' +
      (exState === 'unavailable' || exState === 'stale' ? evidenceUnavailableHtml(t(exRec.copyKey), 'understand.tp.ex.body') : '') +
      '</div>' +
      '</div>' +
      '</div>' +
      '<div class="und-actions">' +
      ui.explainButton({ topic: 'edu', id: 'transparency' }, t('understand.tp.title'), { fk: 'und-explain-transparency' }) +
      '</div>' +
      metaHtml(panelRec, [
        ['understand.meta.slotRecords', '<span class="und-meta__id">' + esc(slotRecIds.join(', ')) + '</span>'],
        ['understand.meta.evidence', esc(t('understand.meta.ev.illustrative'))]
      ]) +
      '</section>'
    );
  }

  function render() {
    if (!els.root) return;
    /* Reading order = DOM order = the in-page navigation: basics, live, on-chain,
       transparency. Basics and transparency span the width; the two evidence panels
       pair up side by side when there is room (50-understand.css), so no column
       trails a long empty area whatever the accordion state. */
    var html =
      headHtml() +
      '<div class="und-layout">' +
      basicsHtml() +
      '<div class="und-pair">' +
      liveHtml() +
      onchainHtml() +
      '</div>' +
      transparencyHtml() +
      '</div>';
    ui.render(els.root, html);
    justOpened = null;
  }

  /* ------------------------------------------------------------------ */
  /* Navigation and focus                                                */
  /* ------------------------------------------------------------------ */
  function viewVisible() {
    var v = doc.getElementById('view-understand');
    return !!v && !v.hidden;
  }
  /*
   * Bring a topic or panel to the top of the page, clear of the masthead. The
   * page's scroll-padding-top follows --masthead-h, which the shell keeps equal
   * to the part of the masthead that stays pinned (the phone's badge band
   * scrolls away; nothing is pinned on short screens or with very large text).
   */
  function scrollToEl(el) {
    var behavior = ui.reducedMotion() ? 'auto' : 'smooth';
    try {
      el.scrollIntoView({ block: 'start', behavior: behavior });
    } catch (e) {
      el.scrollIntoView(true);
    }
  }
  function focusTopic(id) {
    var btn = doc.getElementById('und-btn-' + id);
    var item = doc.getElementById('und-topic-' + id);
    if (!btn || !viewVisible()) return;
    scrollToEl(item || btn);
    btn.focus({ preventScroll: true });
  }
  function focusPanel(id) {
    var h = doc.getElementById('und-' + id + '-title');
    var sec = doc.getElementById('und-' + id);
    if (!h || !viewVisible()) return;
    scrollToEl(sec || h);
    h.focus({ preventScroll: true });
  }
  function later(fn) {
    // Defer until the router has finished (it may scroll to the top on a view change).
    clearTimeout(focusTimer);
    focusTimer = setTimeout(fn, 0);
  }

  function onRoute(r) {
    if (!inited || !r || r.view !== 'understand' || !r.param) return;
    var p = r.param;
    if (TOPICS.indexOf(p) !== -1) {
      if (!isOpen(p)) {
        justOpened = p;
        setOpen(p, true);
      }
      later(function () {
        focusTopic(p);
      });
    } else if (PANELS.indexOf(p) !== -1) {
      later(function () {
        focusPanel(p);
      });
    }
  }

  /**
   * Navigate to Understand and expand a topic (or focus the transparency panel).
   * Unknown ids open the view at its heading.
   */
  function openTopic(topicId) {
    if (OPENABLE.indexOf(topicId) === -1) {
      YES.nav.go('understand');
      return;
    }
    if (TOPICS.indexOf(topicId) !== -1 && !isOpen(topicId)) {
      justOpened = topicId;
      setOpen(topicId, true);
    }
    YES.nav.go('understand', { param: topicId, focus: false });
  }

  function syncParam(id, open) {
    if (YES.state.view !== 'understand') return;
    var cur = YES.nav.current();
    if (open) YES.nav.setParam(id);
    else if (cur.param === id) YES.nav.setParam(null);
  }

  YES.understand = {
    openTopic: openTopic,
    topics: TOPICS.slice(),
    /** 'visible' | 'unavailable' for an education topic in the current language. */
    contentState: function (id) {
      return eduVisible(record(YES.content.education, id)) ? 'visible' : 'unavailable';
    },
    /** 'verified' | 'stale' | 'illustrative' | 'unavailable' for an evidence record. */
    evidenceState: function (id) {
      return evidenceState(record(YES.content.evidence, id));
    }
  };

  /* ------------------------------------------------------------------ */
  /* Strings                                                             */
  /* ------------------------------------------------------------------ */
  YES.register({
    name: 'understand',
    i18n: {
      en: {
        'understand.title': 'Understand your statement',
        'understand.lede': 'Plain-language explanations of the terms in this statement, each with an example from your {period} figures. Open a topic, see the transactions behind it, or ask YES to explain it.',
        'understand.gov': 'These explanations are demo copy pending YES approval. Each one shows its content record — ID, source, owner, validity and visibility rule — the way approved content would be governed.',
        'understand.jump.label': 'On this page',
        'understand.jump.basics': 'Bank-issued digital dollar basics',
        'understand.jump.live': 'Statement versus live balance',
        'understand.jump.onchain': 'On-chain reference',
        'understand.jump.transparency': 'Reserves and transparency',

        'understand.basics.title': 'Bank-issued digital dollar basics',
        'understand.basics.lede': 'Short explanations of the terms used in this statement. Each example uses your own figures.',
        'understand.expandAll': 'Expand all',
        'understand.collapseAll': 'Collapse all',
        'understand.expandedAll': 'All topics expanded',
        'understand.collapsedAll': 'All topics collapsed',
        'understand.inStatement': 'In your statement',

        'understand.topic.token_units.title': 'Token units',
        'understand.topic.token_units.teaser': 'How your balance is counted',
        'understand.topic.token_units.p1':
          'Your balance is held in {product} ({symbol}), a bank-issued digital dollar. This statement counts it to {precision} decimal places, so every amount is exact.',
        'understand.topic.token_units.p2': 'Amounts are never rounded to make totals add up: your opening balance plus every posted movement equals your closing balance exactly.',

        'understand.topic.usd_equivalent.title': 'USD equivalent',
        'understand.topic.usd_equivalent.teaser': 'A reference value, shown only with a rate, source and time',
        'understand.topic.usd_equivalent.p1': 'Next to your token balance you may see an approximate value in US dollars. It is shown only when the rate, its source and the time it applies to are all available.',
        'understand.topic.usd_equivalent.p2': 'It is for reference only. It is not a market quote, and it does not promise what you would receive for your tokens.',
        'understand.topic.usd_equivalent.none': 'This statement has no rate with a source and time, so no US dollar equivalent is shown.',

        'understand.topic.onchain_vs_internal.title': 'On-chain versus internal transfers',
        'understand.topic.onchain_vs_internal.teaser': 'Within YES, or over a blockchain network',
        'understand.topic.onchain_vs_internal.p1': 'An internal transfer moves tokens between YES accounts. It stays within YES and does not use a blockchain network.',
        'understand.topic.onchain_vs_internal.p2':
          'An on-chain transfer goes over a blockchain network to or from an external wallet. It has a network and a transaction hash, and it can carry a network fee.',

        'understand.topic.tx_status.title': 'Transaction status',
        'understand.topic.tx_status.teaser': 'Posted, pending, failed or unknown',
        'understand.topic.tx_status.p1': 'Posted means the transaction is complete for this statement and is counted in your balance.',
        'understand.topic.tx_status.p2':
          'Pending means it had not completed when the statement was cut off. Pending, failed and unknown transactions are listed so you can see them, but they are never counted in the statement balance.',

        'understand.topic.fees.title': 'Fees',
        'understand.topic.fees.teaser': 'Each fee is its own line, linked to its transaction',
        'understand.topic.fees.p1': 'Each fee appears as its own line in your transactions, linked to the transaction it was charged for, so every amount can be traced.',
        'understand.topic.fees.p2': 'Fees in another asset would be listed separately and never subtracted from your token balance without a documented conversion. This statement has none.',
        'understand.topic.fees.foreign': 'Fees in another asset are listed separately and are not subtracted from your token balance: {count} in this statement.',

        'understand.topic.redemption.title': 'Redemption',
        'understand.topic.redemption.teaser': 'Exchanging tokens for US dollars',
        'understand.topic.redemption.p1': 'A redemption exchanges tokens for US dollars paid to your linked bank account. The tokens leave your balance when the redemption is posted.',
        'understand.topic.redemption.p2': 'A redemption that is still pending at the cut-off is listed but not counted. If it completes, it appears on your next statement.',

        'understand.topic.statement_vs_live.title': 'Statement balance versus live balance',
        'understand.topic.statement_vs_live.teaser': 'A fixed snapshot, not your balance right now',
        'understand.topic.statement_vs_live.p1': 'Your statement is a snapshot of your account at the cut-off time. Its balance is the record for the period and does not change.',
        'understand.topic.statement_vs_live.p2':
          'Your live balance — what your account holds now — can differ because of activity after the cut-off, including pending transactions that complete later.',

        'understand.ex.closing': 'Closing balance',
        'understand.ex.closingNote': '{product} ({symbol})',
        'understand.ex.precision': 'Decimal places',
        'understand.ex.precisionNote': 'Smallest unit: {unit}',
        'understand.ex.smallest': 'Smallest posted amount',
        'understand.ex.rate': 'Rate',
        'understand.ex.rateValue': '{one} {symbol} = {rate} {currency}',
        'understand.ex.rateSource': 'Rate source',
        'understand.ex.rateTime': 'Rate time',
        'understand.ex.closingFiat': 'Closing balance shown as',
        'understand.ex.closingFiatNote': 'For {amount}, for reference only',
        'understand.ex.approx': '≈ {v}',
        'understand.ex.internal': 'Internal transfers (YES)',
        'understand.ex.internalNote': 'No blockchain network used',
        'understand.ex.onchain': 'On-chain transfers',
        'understand.ex.onchainNoteSample': 'Network and hash appear only when verified. This demo adds an illustrative sample to {n} of {total}.',
        'understand.ex.onchainNoteVerified': 'Network and hash appear only when verified: {n} of {total} verified.',
        'understand.ex.onchainNoteNone': 'Network and hash appear only when verified. None are available for these transfers.',
        'understand.ex.networkFees': 'Fees for on-chain transfers',
        'understand.ex.feeLines1': '1 fee line',
        'understand.ex.feeLinesN': '{n} fee lines',
        'understand.ex.counted': 'Counted in the balance',
        'understand.ex.notCounted': '{amount}, not counted',
        'understand.ex.nonePending': 'Nothing pending at the cut-off',
        'understand.ex.failedUnknown': 'Failed or unknown',
        'understand.ex.failedNote': 'Always shown explicitly',
        'understand.ex.feesTotal': 'Total fees',
        'understand.ex.noFees': 'No fees were charged this period.',
        'understand.ex.postedOn': 'Posted {date}',
        'understand.ex.startedOn': 'Initiated {date}',
        'understand.ex.withFee': 'fee {amount} on its own line',
        'understand.ex.noRedemptions': 'No redemptions this period.',
        'understand.ex.provider': 'Redemption provider',
        'understand.ex.providerNote': 'Shown once approved by YES',
        'understand.ex.statementBalance': 'Statement balance',
        'understand.ex.pendingAtCutoff': 'Pending at the cut-off',
        'understand.ex.liveNotShown': 'Not shown',
        'understand.ex.liveNotShownNote': 'Not connected in this demo',

        'understand.rel.onchain': 'See on-chain transfers ({n})',
        'understand.rel.internal': 'See internal transfers ({n})',
        'understand.rel.pending': 'See pending transactions ({n})',
        'understand.rel.fees': 'See fee lines ({n})',
        'understand.rel.redemptions': 'See redemptions ({n})',
        'understand.goLive': 'Compare snapshot and live data',
        'understand.goOnchain': 'View the sample on-chain reference',

        'understand.unavailable.title': 'This explanation is unavailable',
        'understand.unavailable.body': 'Its approved copy is missing, out of date or not available in this language, so it is not shown. Ask YES or contact support for help.',

        'understand.meta.title': 'Content record',
        'understand.meta.id': 'ID',
        'understand.meta.versionValue': '(version {v})',
        'understand.meta.source': 'Source',
        'understand.meta.owner': 'Responsible',
        'understand.meta.date': 'Dated',
        'understand.meta.validity': 'Valid',
        'understand.meta.validityValue': '{from} – {to}',
        'understand.meta.visibility': 'Visibility',
        'understand.meta.languages': 'Languages',
        'understand.meta.status': 'Status',
        'understand.meta.statusIllustrative': 'Illustrative, not approved',
        'understand.meta.statusDraft': 'Draft, not approved',
        'understand.meta.statusApproved': 'Approved',
        'understand.meta.sourceDemo': 'Demo copy — pending YES approval',
        'understand.meta.ownerSlot': '[YES content owner]',
        'understand.meta.vis.always': 'Always shown',
        'understand.meta.vis.verified_current': 'Shown only when verified and current',
        'understand.meta.slotRecords': 'Slot records',
        'understand.meta.evidence': 'Evidence',
        'understand.meta.ev.illustrative': 'Illustrative placeholder, not verified',
        'understand.meta.ev.verified': 'Verified',
        'understand.meta.ev.stale': 'Out of date — hidden',
        'understand.meta.ev.unavailable': 'Unavailable — hidden',

        'understand.live.title': 'Statement balance versus live balance',
        'understand.live.lede': 'Your statement is a fixed record. Live account data, when connected, belongs in a separate, timestamped area — never in the statement itself.',
        'understand.live.snapTitle': 'Statement snapshot',
        'understand.live.snapTag': 'Statement of record',
        'understand.live.closing': 'Closing statement balance',
        'understand.live.asOf': 'As of {date}',
        'understand.live.period': 'Period: {range}',
        'understand.live.fixed': 'Fixed for this period — it does not change.',
        'understand.live.divider': 'Separate from the statement',
        'understand.live.liveTitle': 'Live account data',
        'understand.live.liveTag': 'Not connected',
        'understand.live.notConnected': 'Live account data is not connected in this demo.',
        'understand.live.balance': 'Live balance',
        'understand.live.balanceValue': 'Not available',
        'understand.live.updated': 'Last updated',
        'understand.live.updatedValue': '[Timestamp appears here when connected]',
        'understand.live.prod': 'In production, this area would show your current balance and the time it was checked, apart from the statement.',
        'understand.live.diffTitle': 'Why the two could differ',
        'understand.live.diffPending':
          '“{desc}” for {amount} was pending at the cut-off, so it is not in the statement balance. If it completes, your live balance would be {abs} lower than this statement, before any other activity.',
        'understand.live.diffOther': 'Any activity after {asOf} — deposits, transfers or fees — would show only in live data and on your next statement.',
        'understand.live.diffNone': 'Nothing was pending at the cut-off. Any activity after {asOf} would show only in live data and on your next statement.',
        'understand.live.viewPending': 'View the pending transaction',
        'understand.live.viewFirstPending': 'View the first pending transaction',

        'understand.oc.title': 'Sample on-chain reference',
        'understand.oc.label': 'Illustrative reference — no live blockchain verification',
        'understand.oc.labelBody': 'These blockchain details are fictional and have not been checked on any blockchain. They show where verified details would appear.',
        'understand.oc.network': 'Network',
        'understand.oc.hash': 'Transaction hash',
        'understand.oc.copyHash': 'Copy',
        'understand.oc.copyHashLabel': 'Copy the full illustrative transaction hash',
        'understand.oc.showFull': 'Show full hash',
        'understand.oc.confirmations': 'Confirmations',
        'understand.oc.confirmationsNote': 'Illustrative — not checked live',
        'understand.oc.verification': 'Verification',
        'understand.oc.notVerified': 'Not verified',
        'understand.oc.verified': 'Verified',
        'understand.oc.explorer': 'Blockchain explorer',
        'understand.oc.noLink': 'No link',
        'understand.oc.whyTitle': 'Why there is no explorer link',
        'understand.oc.why':
          'This reference is fictional. A link to a real blockchain explorer could show someone else’s transaction, or nothing at all, so none is given. In production, a link appears only for verified transactions, with a warning before you leave YES.',
        'understand.oc.open': 'Open this transaction',
        'understand.oc.none': 'No transaction in this statement has an on-chain reference.',

        'understand.tp.title': 'Reserves and transparency',
        'understand.tp.label': 'Illustrative layout; no reserve assertion',
        'understand.tp.labelBody': 'This panel shows where verified information about the bank-issued digital dollar would appear. Nothing here states a fact about reserves, custody or the issuing bank.',
        'understand.tp.slotsTitle': 'Where verified facts would appear',
        'understand.tp.slot.issuer': 'Approved issuer',
        'understand.tp.slot.reserve_report': 'Reserve report',
        'understand.tp.slot.attestation_date': 'Attestation date',
        'understand.tp.slot.redemption_terms': 'Redemption terms',
        'understand.tp.slot.source_link': 'Source link',
        'understand.tp.ph.reserve_report': '[Reserve report — not provided in this demo]',
        'understand.tp.ph.attestation_date': '[Attestation date — not provided]',
        'understand.tp.ph.redemption_terms': '[Approved redemption terms — not provided]',
        'understand.tp.ph.source_link': '[Source link — none in this demo]',
        'understand.tp.placeholders': 'Placeholders',
        'understand.tp.noLinks': 'No link in this panel leads anywhere: there is no real report, attestation or source behind it.',
        'understand.tp.provenance': 'Source: {source} · {date} · {owner}',
        'understand.tp.ruleTitle': 'How this works in production',
        'understand.tp.rule1': 'Only verified facts are shown, each with its source, date and responsible entity.',
        'understand.tp.rule2': 'A link to an outside source shows a warning before you leave YES.',
        'understand.tp.rule3': 'If evidence is missing or out of date, the claim is hidden and this page says the information is unavailable.',
        'understand.tp.exampleTitle': 'What you would see if evidence is unavailable',
        'understand.tp.exampleTag': 'Example',
        'understand.tp.ex.name': 'Reserve attestation',
        'understand.tp.ex.state': 'Information unavailable',
        'understand.tp.ex.body': 'Current, verified evidence is not available, so no claim is shown here. Ask YES or contact support if you have questions.'
      },
      es: {
        'understand.title': 'Entiende tu estado de cuenta',
        'understand.lede':
          'Explicaciones sencillas de los términos de este estado de cuenta, cada una con un ejemplo basado en tus cifras de {period}. Abre un tema, consulta los movimientos relacionados o pide a YES que te lo explique.',
        'understand.gov':
          'Estas explicaciones son textos de demostración pendientes de aprobación de YES. Cada una muestra su registro de contenido (identificador, fuente, responsable, vigencia y regla de visibilidad), tal como se gestionaría el contenido aprobado.',
        'understand.jump.label': 'En esta página',
        'understand.jump.basics': 'Conceptos básicos',
        'understand.jump.live': 'Estado de cuenta frente a saldo en vivo',
        'understand.jump.onchain': 'Referencia en cadena',
        'understand.jump.transparency': 'Reservas y transparencia',

        'understand.basics.title': 'Conceptos básicos del dólar digital emitido por un banco',
        'understand.basics.lede': 'Explicaciones breves de los términos de este estado de cuenta. Cada ejemplo usa tus propias cifras.',
        'understand.expandAll': 'Desplegar todo',
        'understand.collapseAll': 'Contraer todo',
        'understand.expandedAll': 'Todos los temas desplegados',
        'understand.collapsedAll': 'Todos los temas contraídos',
        'understand.inStatement': 'En tu estado de cuenta',

        'understand.topic.token_units.title': 'Unidades de token',
        'understand.topic.token_units.teaser': 'Cómo se cuenta tu saldo',
        'understand.topic.token_units.p1':
          'Tu saldo está en {product} ({symbol}), un dólar digital emitido por un banco. En este estado de cuenta se expresa con {precision} decimales, así que cada importe es exacto.',
        'understand.topic.token_units.p2': 'Los importes nunca se redondean para que los totales cuadren: tu saldo inicial más cada movimiento registrado es exactamente igual a tu saldo final.',

        'understand.topic.usd_equivalent.title': 'Equivalente en USD',
        'understand.topic.usd_equivalent.teaser': 'Un valor de referencia, solo con tasa, fuente y hora',
        'understand.topic.usd_equivalent.p1':
          'Junto a tu saldo en tokens puedes ver un valor aproximado en dólares estadounidenses. Solo se muestra cuando están disponibles la tasa, su fuente y el momento al que corresponde.',
        'understand.topic.usd_equivalent.p2': 'Es solo una referencia. No es una cotización de mercado ni una promesa de lo que recibirías por tus tokens.',
        'understand.topic.usd_equivalent.none': 'Este estado de cuenta no tiene una tasa con fuente y hora, así que no se muestra ningún equivalente en dólares.',

        'understand.topic.onchain_vs_internal.title': 'Transferencias en cadena frente a internas',
        'understand.topic.onchain_vs_internal.teaser': 'Dentro de YES o a través de una red blockchain',
        'understand.topic.onchain_vs_internal.p1': 'Una transferencia interna mueve tokens entre cuentas de YES. Se queda dentro de YES y no usa ninguna red blockchain.',
        'understand.topic.onchain_vs_internal.p2':
          'Una transferencia en cadena pasa por una red blockchain hacia o desde un monedero externo. Tiene una red y un hash de transacción, y puede llevar una comisión de red.',

        'understand.topic.tx_status.title': 'Estado del movimiento',
        'understand.topic.tx_status.teaser': 'Registrado, pendiente, fallido o desconocido',
        'understand.topic.tx_status.p1': 'Registrado significa que el movimiento está completo para este estado de cuenta y se cuenta en tu saldo.',
        'understand.topic.tx_status.p2':
          'Pendiente significa que no se había completado al cierre del estado de cuenta. Los movimientos pendientes, fallidos o con estado desconocido aparecen en la lista para que los veas, pero nunca se cuentan en el saldo del estado de cuenta.',

        'understand.topic.fees.title': 'Comisiones',
        'understand.topic.fees.teaser': 'Cada comisión es una línea propia, vinculada a su movimiento',
        'understand.topic.fees.p1': 'Cada comisión aparece como una línea propia en tus movimientos, vinculada al movimiento por el que se cobró, para que cada importe pueda rastrearse.',
        'understand.topic.fees.p2':
          'Las comisiones en otro activo se mostrarían por separado y nunca se restarían de tu saldo en tokens sin una conversión documentada. Este estado de cuenta no tiene ninguna.',
        'understand.topic.fees.foreign': 'Las comisiones en otro activo se muestran por separado y no se restan de tu saldo en tokens: {count} en este estado de cuenta.',

        'understand.topic.redemption.title': 'Canje',
        'understand.topic.redemption.teaser': 'Cambiar tokens por dólares estadounidenses',
        'understand.topic.redemption.p1':
          'Un canje cambia tokens por dólares estadounidenses que se pagan en tu cuenta bancaria vinculada. Los tokens salen de tu saldo cuando el canje queda registrado.',
        'understand.topic.redemption.p2': 'Un canje que sigue pendiente al cierre aparece en la lista, pero no se cuenta. Si se completa, aparecerá en tu próximo estado de cuenta.',

        'understand.topic.statement_vs_live.title': 'Saldo del estado de cuenta frente a saldo en vivo',
        'understand.topic.statement_vs_live.teaser': 'Una instantánea fija, no tu saldo de este momento',
        'understand.topic.statement_vs_live.p1': 'Tu estado de cuenta es una instantánea de tu cuenta a la hora de cierre. Su saldo es el registro del período y no cambia.',
        'understand.topic.statement_vs_live.p2':
          'Tu saldo en vivo (lo que tiene tu cuenta ahora) puede ser distinto por la actividad posterior al cierre, incluidos los movimientos pendientes que se completen más tarde.',

        'understand.ex.closing': 'Saldo final',
        'understand.ex.closingNote': '{product} ({symbol})',
        'understand.ex.precision': 'Decimales',
        'understand.ex.precisionNote': 'Unidad mínima: {unit}',
        'understand.ex.smallest': 'Importe registrado más pequeño',
        'understand.ex.rate': 'Tasa',
        'understand.ex.rateValue': '{one} {symbol} = {rate} {currency}',
        'understand.ex.rateSource': 'Fuente de la tasa',
        'understand.ex.rateTime': 'Hora de la tasa',
        'understand.ex.closingFiat': 'Saldo final expresado como',
        'understand.ex.closingFiatNote': 'Para {amount}, solo como referencia',
        'understand.ex.approx': '≈ {v}',
        'understand.ex.internal': 'Transferencias internas (YES)',
        'understand.ex.internalNote': 'Sin usar una red blockchain',
        'understand.ex.onchain': 'Transferencias en cadena',
        'understand.ex.onchainNoteSample': 'La red y el hash solo aparecen cuando están verificados. Esta demostración añade un ejemplo ilustrativo a {n} de {total}.',
        'understand.ex.onchainNoteVerified': 'La red y el hash solo aparecen cuando están verificados: {n} de {total} verificadas.',
        'understand.ex.onchainNoteNone': 'La red y el hash solo aparecen cuando están verificados. No hay ninguno disponible para estas transferencias.',
        'understand.ex.networkFees': 'Comisiones de transferencias en cadena',
        'understand.ex.feeLines1': '1 línea de comisión',
        'understand.ex.feeLinesN': '{n} líneas de comisión',
        'understand.ex.counted': 'Se cuentan en el saldo',
        'understand.ex.notCounted': '{amount}, no se cuenta',
        'understand.ex.nonePending': 'Nada pendiente al cierre',
        'understand.ex.failedUnknown': 'Fallidos o desconocidos',
        'understand.ex.failedNote': 'Siempre se muestran de forma explícita',
        'understand.ex.feesTotal': 'Total de comisiones',
        'understand.ex.noFees': 'No se cobraron comisiones en este período.',
        'understand.ex.postedOn': 'Registrado el {date}',
        'understand.ex.startedOn': 'Iniciado el {date}',
        'understand.ex.withFee': 'comisión de {amount} en su propia línea',
        'understand.ex.noRedemptions': 'No hubo canjes en este período.',
        'understand.ex.provider': 'Proveedor del canje',
        'understand.ex.providerNote': 'Se mostrará cuando YES lo apruebe',
        'understand.ex.statementBalance': 'Saldo del estado de cuenta',
        'understand.ex.pendingAtCutoff': 'Pendiente al cierre',
        'understand.ex.liveNotShown': 'No se muestra',
        'understand.ex.liveNotShownNote': 'No está conectado en esta demostración',

        'understand.rel.onchain': 'Ver transferencias en cadena ({n})',
        'understand.rel.internal': 'Ver transferencias internas ({n})',
        'understand.rel.pending': 'Ver movimientos pendientes ({n})',
        'understand.rel.fees': 'Ver líneas de comisión ({n})',
        'understand.rel.redemptions': 'Ver canjes ({n})',
        'understand.goLive': 'Comparar instantánea y datos en vivo',
        'understand.goOnchain': 'Ver la referencia en cadena de muestra',

        'understand.unavailable.title': 'Esta explicación no está disponible',
        'understand.unavailable.body':
          'Su texto aprobado falta, está desactualizado o no está disponible en este idioma, así que no se muestra. Pregunta a YES o contacta con soporte si necesitas ayuda.',

        'understand.meta.title': 'Registro de contenido',
        'understand.meta.id': 'Identificador',
        'understand.meta.versionValue': '(versión {v})',
        'understand.meta.source': 'Fuente',
        'understand.meta.owner': 'Responsable',
        'understand.meta.date': 'Fecha',
        'understand.meta.validity': 'Vigencia',
        'understand.meta.validityValue': '{from} – {to}',
        'understand.meta.visibility': 'Visibilidad',
        'understand.meta.languages': 'Idiomas',
        'understand.meta.status': 'Estado',
        'understand.meta.statusIllustrative': 'Ilustrativo, no aprobado',
        'understand.meta.statusDraft': 'Borrador, no aprobado',
        'understand.meta.statusApproved': 'Aprobado',
        'understand.meta.sourceDemo': 'Texto de demostración — pendiente de aprobación de YES',
        'understand.meta.ownerSlot': '[Responsable de contenidos de YES]',
        'understand.meta.vis.always': 'Se muestra siempre',
        'understand.meta.vis.verified_current': 'Solo se muestra si está verificado y vigente',
        'understand.meta.slotRecords': 'Registros de los campos',
        'understand.meta.evidence': 'Evidencia',
        'understand.meta.ev.illustrative': 'Marcador ilustrativo, sin verificar',
        'understand.meta.ev.verified': 'Verificada',
        'understand.meta.ev.stale': 'Desactualizada: oculta',
        'understand.meta.ev.unavailable': 'No disponible: oculta',

        'understand.live.title': 'Saldo del estado de cuenta frente a saldo en vivo',
        'understand.live.lede':
          'Tu estado de cuenta es un registro fijo. Los datos de la cuenta en vivo, cuando estén conectados, van en un área separada y con fecha y hora, nunca dentro del estado de cuenta.',
        'understand.live.snapTitle': 'Instantánea del estado de cuenta',
        'understand.live.snapTag': 'Registro oficial',
        'understand.live.closing': 'Saldo final del estado de cuenta',
        'understand.live.asOf': 'Al {date}',
        'understand.live.period': 'Período: {range}',
        'understand.live.fixed': 'Fijo para este período: no cambia.',
        'understand.live.divider': 'Separado del estado de cuenta',
        'understand.live.liveTitle': 'Datos de la cuenta en vivo',
        'understand.live.liveTag': 'No conectado',
        'understand.live.notConnected': 'Los datos de la cuenta en vivo no están conectados en esta demostración.',
        'understand.live.balance': 'Saldo en vivo',
        'understand.live.balanceValue': 'No disponible',
        'understand.live.updated': 'Última actualización',
        'understand.live.updatedValue': '[Aquí aparecerá la fecha y hora cuando esté conectado]',
        'understand.live.prod': 'En producción, esta área mostraría tu saldo actual y la hora en que se consultó, aparte del estado de cuenta.',
        'understand.live.diffTitle': 'Por qué pueden ser distintos',
        'understand.live.diffPending':
          '«{desc}» por {amount} estaba pendiente al cierre, así que no está en el saldo del estado de cuenta. Si se completa, tu saldo en vivo sería {abs} menor que el de este estado de cuenta, antes de cualquier otra actividad.',
        'understand.live.diffOther': 'Cualquier actividad posterior al {asOf} (depósitos, transferencias o comisiones) solo aparecería en los datos en vivo y en tu próximo estado de cuenta.',
        'understand.live.diffNone': 'No había nada pendiente al cierre. Cualquier actividad posterior al {asOf} solo aparecería en los datos en vivo y en tu próximo estado de cuenta.',
        'understand.live.viewPending': 'Ver el movimiento pendiente',
        'understand.live.viewFirstPending': 'Ver el primer movimiento pendiente',

        'understand.oc.title': 'Referencia en cadena de muestra',
        'understand.oc.label': 'Referencia ilustrativa — sin verificación en blockchain en vivo',
        'understand.oc.labelBody': 'Estos detalles de blockchain son ficticios y no se han comprobado en ninguna blockchain. Muestran dónde aparecerían los detalles verificados.',
        'understand.oc.network': 'Red',
        'understand.oc.hash': 'Hash de la transacción',
        'understand.oc.copyHash': 'Copiar',
        'understand.oc.copyHashLabel': 'Copiar el hash ilustrativo completo de la transacción',
        'understand.oc.showFull': 'Mostrar hash completo',
        'understand.oc.confirmations': 'Confirmaciones',
        'understand.oc.confirmationsNote': 'Ilustrativo: no se comprueba en vivo',
        'understand.oc.verification': 'Verificación',
        'understand.oc.notVerified': 'Sin verificar',
        'understand.oc.verified': 'Verificada',
        'understand.oc.explorer': 'Explorador de blockchain',
        'understand.oc.noLink': 'Sin enlace',
        'understand.oc.whyTitle': 'Por qué no hay enlace a un explorador',
        'understand.oc.why':
          'Esta referencia es ficticia. Un enlace a un explorador de blockchain real podría mostrar la transacción de otra persona o no mostrar nada, así que no se incluye. En producción, solo aparece un enlace para transacciones verificadas, con un aviso antes de salir de YES.',
        'understand.oc.open': 'Abrir este movimiento',
        'understand.oc.none': 'Ningún movimiento de este estado de cuenta tiene una referencia en cadena.',

        'understand.tp.title': 'Reservas y transparencia',
        'understand.tp.label': 'Diseño ilustrativo; sin afirmación sobre reservas',
        'understand.tp.labelBody': 'Este panel muestra dónde aparecería la información verificada sobre el dólar digital emitido por un banco. Nada de lo que hay aquí afirma un hecho sobre reservas, custodia o el banco emisor.',
        'understand.tp.slotsTitle': 'Dónde aparecerían los hechos verificados',
        'understand.tp.slot.issuer': 'Emisor aprobado',
        'understand.tp.slot.reserve_report': 'Informe de reservas',
        'understand.tp.slot.attestation_date': 'Fecha de certificación',
        'understand.tp.slot.redemption_terms': 'Condiciones de canje',
        'understand.tp.slot.source_link': 'Enlace a la fuente',
        'understand.tp.ph.reserve_report': '[Informe de reservas — no incluido en esta demostración]',
        'understand.tp.ph.attestation_date': '[Fecha de certificación — no incluida]',
        'understand.tp.ph.redemption_terms': '[Condiciones de canje aprobadas — no incluidas]',
        'understand.tp.ph.source_link': '[Enlace a la fuente — ninguno en esta demostración]',
        'understand.tp.placeholders': 'Marcadores de posición',
        'understand.tp.noLinks': 'Ningún elemento de este panel lleva a otro sitio: no hay ningún informe, certificación ni fuente real detrás.',
        'understand.tp.provenance': 'Fuente: {source} · {date} · {owner}',
        'understand.tp.ruleTitle': 'Cómo funciona en producción',
        'understand.tp.rule1': 'Solo se muestran hechos verificados, cada uno con su fuente, su fecha y la entidad responsable.',
        'understand.tp.rule2': 'Un enlace a una fuente externa muestra un aviso antes de salir de YES.',
        'understand.tp.rule3': 'Si la evidencia falta o está desactualizada, la afirmación se oculta y esta página indica que la información no está disponible.',
        'understand.tp.exampleTitle': 'Lo que verías si no hay evidencia disponible',
        'understand.tp.exampleTag': 'Ejemplo',
        'understand.tp.ex.name': 'Certificación de reservas',
        'understand.tp.ex.state': 'Información no disponible',
        'understand.tp.ex.body': 'No hay evidencia verificada y vigente, así que aquí no se muestra ninguna afirmación. Pregunta a YES o contacta con soporte si tienes dudas.'
      }
    },

    init: function () {
      els.root = doc.getElementById('understand-root');
      if (!els.root) return;
      inited = true;
      if (!YES.state.understand) YES.state.understand = U();
      var r = els.root;

      ui.delegate(r, 'click', '[data-und-toggle]', function (e, b) {
        var id = b.getAttribute('data-und-toggle');
        var open = !isOpen(id);
        if (open) justOpened = id;
        setOpen(id, open);
        syncParam(id, open);
      });
      // Optional accordion keys (APG): move between topic headers.
      ui.delegate(r, 'keydown', '[data-und-toggle]', function (e, b) {
        var keys = { ArrowDown: 1, ArrowUp: 1, Home: 1, End: 1 };
        if (!keys[e.key] || e.altKey || e.ctrlKey || e.metaKey) return;
        var btns = ui.$$('[data-und-toggle]', r);
        var i = btns.indexOf(b);
        var n = btns.length;
        var next = e.key === 'ArrowDown' ? (i + 1) % n : e.key === 'ArrowUp' ? (i - 1 + n) % n : e.key === 'Home' ? 0 : n - 1;
        e.preventDefault();
        btns[next].focus();
      });
      ui.delegate(r, 'click', '[data-und-all]', function () {
        var allOpen = U().expanded.length === TOPICS.length;
        setU({ expanded: allOpen ? [] : TOPICS.slice() });
        if (allOpen && TOPICS.indexOf(YES.nav.current().param) !== -1) YES.nav.setParam(null);
        ui.announce(t(allOpen ? 'understand.collapsedAll' : 'understand.expandedAll'));
      });
      ui.delegate(r, 'click', '[data-und-go]', function (e, a) {
        e.preventDefault();
        YES.nav.go('understand', { param: a.getAttribute('data-und-go'), focus: false });
      });
      ui.delegate(r, 'click', '[data-und-rel]', function (e, b) {
        var rel = REL[b.getAttribute('data-und-rel')];
        if (!rel) return;
        var f = {};
        Object.keys(rel.filter).forEach(function (k) {
          f[k] = rel.filter[k].slice();
        });
        YES.explorer.applyFilter(f, { reset: true });
      });
      ui.delegate(r, 'click', '[data-und-opentx]', function (e, b) {
        YES.explorer.openTx(b.getAttribute('data-und-opentx'), { trigger: b });
      });
      ui.delegate(r, 'click', '[data-und-copy]', function () {
        var tx = onchainTx();
        if (tx) ui.copy(tx.onchain.hash);
      });
      ui.delegate(r, 'click', '[data-und-fullhash]', function () {
        setU({ fullHash: !U().fullHash });
      });

      // <details> 'toggle' does not bubble, so listen in the capture phase.
      r.addEventListener(
        'toggle',
        function (e) {
          var d = e.target;
          if (!d || !d.matches || !d.matches('details[data-content-record]')) return;
          var id = d.getAttribute('data-content-record');
          var meta = U().meta;
          if (!!meta[id] === d.open) return;
          var next = {};
          Object.keys(meta).forEach(function (k) {
            next[k] = true;
          });
          if (d.open) next[id] = true;
          else delete next[id];
          setU({ meta: next });
        },
        true
      );

      YES.on('route', onRoute);
      this.render();
    },

    render: render,

    onState: function (keys) {
      if (!inited) return;
      if (keys.indexOf('understand') !== -1) render();
    }
  });
})(window);
