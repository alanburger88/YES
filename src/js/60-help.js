/*
 * Help, feedback and statement record (PRD 5.9, 5.8 UserWay, 5.3 print,
 * 2 "self-contained", 5.4 inquiry versus dispute).
 *
 * The Help view (#help-root) gathers contextual help, placeholder support
 * destinations, a local-only clarity prompt, the statement record, the
 * integrity checks, the accessibility statement with the live UserWay status,
 * and an honest list of what is connected in this file. It also owns the
 * statement-of-record print view (#print-root), rendered from the same data
 * and kept current on language change and on 'beforeprint'.
 *
 * Context that must survive a language switch lives in YES.state.help
 * (section, feedback draft, error, editing) and YES.state.feedback.clarity
 * (the saved, session-only feedback record).
 */
(function (root) {
  'use strict';
  var YES = root.YES;
  var ui = YES.ui;
  var t = YES.t;
  var esc = ui.esc;
  var doc = root.document;

  var SECTIONS = ['contact', 'feedback', 'record', 'integrity', 'accessibility', 'about'];
  var SECTION_ICONS = { contact: 'phone', feedback: 'thumbsUp', record: 'book', integrity: 'shield', accessibility: 'accessibility', about: 'info' };
  var RATINGS = ['very_clear', 'mostly_clear', 'little_confusing', 'confusing'];
  var UW_STATES = { idle: 'clock', loading: 'clock', loaded: 'check-circle', unavailable: 'info', host: 'check-circle', disabled: 'info' };
  var FEATURES = [
    { id: 'keyboard', icon: 'keyboard' },
    { id: 'screenReader', icon: 'chat' },
    { id: 'focus', icon: 'focus' },
    { id: 'motion', icon: 'motion' },
    { id: 'zoom', icon: 'zoom' },
    { id: 'textAlt', icon: 'textalt' },
    { id: 'color', icon: 'contrast' },
    { id: 'languages', icon: 'globe' }
  ];
  var ENHANCEMENTS = [
    { id: 'userway', icon: 'accessibility', tag: 'online', demo: false },
    { id: 'ai', icon: 'sparkle', tag: 'local', demo: true },
    { id: 'inquiry', icon: 'chat', tag: 'mock', demo: true },
    { id: 'video', icon: 'video', tag: 'placeholder', demo: true },
    { id: 'feedback', icon: 'thumbsUp', tag: 'session', demo: true },
    { id: 'analytics', icon: 'balance', tag: 'none', demo: false },
    { id: 'evidence', icon: 'chain', tag: 'illustrative', demo: true },
    { id: 'liveBalance', icon: 'clock', tag: 'notConnected', demo: false }
  ];

  /* Icons the shared set does not have, drawn in the same 24×24 stroke style. */
  var LOCAL_ICONS = {
    keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6.5 10h.01"/><path d="M10 10h.01"/><path d="M13.5 10h.01"/><path d="M17.5 10h.01"/><path d="M7.5 14h9"/>',
    focus: '<path d="M4 8V5a1 1 0 0 1 1-1h3"/><path d="M16 4h3a1 1 0 0 1 1 1v3"/><path d="M20 16v3a1 1 0 0 1-1 1h-3"/><path d="M8 20H5a1 1 0 0 1-1-1v-3"/><rect x="8.5" y="8.5" width="7" height="7" rx="1.5"/>',
    motion: '<circle cx="12" cy="12" r="9"/><path d="M10 9v6"/><path d="M14 9v6"/>',
    zoom: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/><path d="M11 8.5v5"/><path d="M8.5 11h5"/>',
    textalt: '<path d="M4 19V10"/><path d="M8.5 19V6"/><path d="M13 19v-5"/><path d="M3 19h11"/><path d="M17 8h4"/><path d="M17 12h4"/><path d="M17 16h4"/>',
    contrast: '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none"/>'
  };

  var els = { root: null, print: null };
  var inited = false;
  var focusTimer = null;

  /* ------------------------------------------------------------------ */
  /* Helpers                                                             */
  /* ------------------------------------------------------------------ */
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
  function amt(minor, sign) {
    return YES.fmt.amount(minor, { sign: sign || 'auto', unit: false });
  }
  function dateTime(iso) {
    return YES.fmt.date(iso, 'datetime');
  }
  function tzShort(iso) {
    var s = YES.fmt.tz(iso);
    var i = s.indexOf(' (');
    return i === -1 ? s : s.slice(0, i);
  }
  function issueLabel() {
    return t(st().issueStatus === 'corrected' ? 'help.issue.corrected' : 'help.issue.original');
  }
  function integrity() {
    return YES.integrity && YES.integrity.checks ? YES.integrity : YES.calc.reconcile();
  }
  function uwStatus() {
    var s = YES.userway && YES.userway.status;
    return UW_STATES[s] ? s : 'idle';
  }
  function lower(s) {
    return String(s).toLocaleLowerCase(YES.i18n.locale());
  }

  /* --------------------------- State ------------------------------- */
  function defaults() {
    return { section: null, rating: '', comment: '', error: false, editing: false };
  }
  function H() {
    var d = defaults();
    var s = YES.state.help || {};
    Object.keys(d).forEach(function (k) {
      if (s[k] !== undefined && s[k] !== null) d[k] = s[k];
    });
    if (RATINGS.indexOf(d.rating) === -1) d.rating = '';
    d.comment = String(d.comment || '');
    return d;
  }
  function setH(patch) {
    var h = H();
    Object.keys(patch).forEach(function (k) {
      h[k] = patch[k];
    });
    return YES.set({ help: h });
  }
  function savedFeedback() {
    var f = YES.state.feedback;
    var r = f && f.clarity;
    return r && RATINGS.indexOf(r.rating) !== -1 ? r : null;
  }
  /** The inquiry draft (or completed demo inquiry) the customer has, if any. */
  function inquiryDraft() {
    var s = YES.state.inquiry;
    if (!s || typeof s !== 'object' || !s.txId) return null;
    var d = null;
    try {
      d = YES.inquiry.draftFor(s.txId);
    } catch (e) {
      d = null;
    }
    d = d || s;
    return d && d.txId ? d : null;
  }

  /* ------------------------------------------------------------------ */
  /* View                                                                */
  /* ------------------------------------------------------------------ */
  function sectionHead(id, tagHtml) {
    return (
      '<div class="help-sec__head">' +
      '<span class="help-sec__icon">' +
      icon(SECTION_ICONS[id], { size: 22 }) +
      '</span>' +
      '<h2 class="help-sec__title" id="help-' +
      id +
      '-title" tabindex="-1" data-fk="help-h-' +
      id +
      '">' +
      esc(t('help.sec.' + id)) +
      '</h2>' +
      (tagHtml ? '<span class="help-sec__tag">' + tagHtml + '</span>' : '') +
      '</div>'
    );
  }
  function section(id, tagHtml, body) {
    return (
      '<section class="help-sec card" id="help-' +
      id +
      '" aria-labelledby="help-' +
      id +
      '-title" data-help-section="' +
      id +
      '">' +
      sectionHead(id, tagHtml) +
      body +
      '</section>'
    );
  }
  function tag(text, kind, iconName) {
    return '<span class="tag' + (kind ? ' tag--' + kind : '') + '">' + (iconName ? icon(iconName, { size: 14 }) : '') + '<span>' + esc(text) + '</span></span>';
  }
  function notice(kind, iconName, html, extraCls) {
    return '<div class="notice notice--' + kind + (extraCls ? ' ' + extraCls : '') + '">' + icon(iconName, { size: 20 }) + '<div>' + html + '</div></div>';
  }

  /* ---------------------- Contextual help -------------------------- */
  function quickTxHtml() {
    var d = inquiryDraft();
    var extra = '';
    var actions =
      '<button type="button" class="btn btn--primary" data-nav="transactions" data-fk="help-go-tx">' +
      '<span>' +
      esc(t('help.q.go')) +
      '</span>' +
      icon('arrow-right', { size: 18 }) +
      '</button>';
    if (d && d.status === 'submitted') {
      extra = notice('illustrative', 'info', '<p>' + esc(t('help.q.submitted', { ref: d.ref || '' })) + '</p>', 'help-quick__note');
      actions +=
        '<button type="button" class="btn" data-help-opentx="' +
        esc(d.txId) +
        '" data-fk="help-open-inquiry-tx">' +
        esc(t('help.q.viewTx')) +
        '</button>';
    } else if (d) {
      var tx = YES.calc.tx(d.txId);
      extra = notice('info', 'clock', '<p>' + esc(t('help.q.draft', { tx: tx ? YES.L(tx.description) : d.txId })) + '</p>', 'help-quick__note');
      actions += '<button type="button" class="btn" data-help-resume data-fk="help-resume">' + icon('chat', { size: 18 }) + '<span>' + esc(t('help.q.resume')) + '</span></button>';
    }
    return extra + '<div class="help-actions">' + actions + '</div>';
  }

  function quickHtml() {
    return (
      '<div class="help-quick">' +
      '<section class="help-quick__card card" aria-labelledby="help-q-title">' +
      '<div class="help-quick__head"><span class="help-quick__icon">' +
      icon('question', { size: 22 }) +
      '</span>' +
      '<h2 class="help-quick__title" id="help-q-title">' +
      esc(t('help.q.title')) +
      '</h2></div>' +
      '<p class="help-quick__body">' +
      esc(t('help.q.body')) +
      '</p>' +
      '<div id="help-quick-tx">' +
      quickTxHtml() +
      '</div>' +
      '</section>' +
      '<section class="help-quick__card help-quick__card--ai card" aria-labelledby="help-ask-title">' +
      '<div class="help-quick__head"><span class="help-quick__icon help-quick__icon--ai">' +
      icon('sparkle', { size: 22 }) +
      '</span>' +
      '<h2 class="help-quick__title" id="help-ask-title">' +
      esc(t('help.ask.title')) +
      '</h2></div>' +
      '<p class="help-quick__body">' +
      esc(t('help.ask.body')) +
      '</p>' +
      '<div class="help-actions"><button type="button" class="btn btn--ai" data-help-ask data-fk="help-ask" aria-label="' +
      esc(t('ask.buttonLong')) +
      '">' +
      icon('chat', { size: 18 }) +
      '<span>' +
      esc(t('ask.button')) +
      '</span></button></div>' +
      '</section>' +
      '</div>'
    );
  }

  function tocHtml() {
    return (
      '<nav class="help-toc" aria-label="' +
      esc(t('help.toc.label')) +
      '"><p class="help-toc__title" aria-hidden="true">' +
      esc(t('help.toc.label')) +
      '</p><ul class="help-toc__list">' +
      SECTIONS.map(function (id) {
        return (
          '<li><a class="help-toc__link" href="#/help/' +
          id +
          '" data-help-go="' +
          id +
          '" data-fk="help-toc-' +
          id +
          '">' +
          icon(SECTION_ICONS[id], { size: 18 }) +
          '<span>' +
          esc(t('help.sec.' + id)) +
          '</span></a></li>'
        );
      }).join('') +
      '</ul></nav>'
    );
  }

  /* --------------------------- Contact ----------------------------- */
  function contactHtml() {
    var sup = YES.config.support;
    var connected = !!sup.connected;
    var rows = [
      { id: 'phone', icon: 'phone', value: sup.phone, copy: true },
      { id: 'email', icon: 'mail', value: sup.email, copy: true },
      { id: 'hours', icon: 'clock', value: YES.L(sup.hours), copy: false }
    ];
    var items = rows
      .map(function (r) {
        var label = t('help.contact.' + r.id);
        return (
          '<li class="help-contact__item">' +
          '<span class="help-contact__icon">' +
          icon(r.icon, { size: 20 }) +
          '</span>' +
          '<div class="help-contact__main"><span class="help-contact__label">' +
          esc(label) +
          '</span><span class="help-contact__value"><span data-help-value="' +
          r.id +
          '">' +
          esc(r.value) +
          '</span>' +
          (connected ? '' : ui.illustrativeTag('common.placeholder')) +
          '</span></div>' +
          (r.copy
            ? '<button type="button" class="btn help-contact__copy" data-help-copy="' +
              r.id +
              '" data-fk="help-copy-' +
              r.id +
              '" aria-label="' +
              esc(t('help.contact.copy.' + r.id)) +
              '">' +
              icon('copy', { size: 16 }) +
              '<span>' +
              esc(t('common.copy')) +
              '</span></button>'
            : '') +
          '</li>'
        );
      })
      .join('');
    items +=
      '<li class="help-contact__item">' +
      '<span class="help-contact__icon">' +
      icon('chat', { size: 20 }) +
      '</span>' +
      '<div class="help-contact__main"><span class="help-contact__label">' +
      esc(t('help.contact.chat')) +
      '</span><span class="help-contact__value">' +
      esc(t(sup.chatAvailable ? 'help.contact.chatOn' : 'help.contact.chatOff')) +
      '</span></div></li>';

    var routes = ['inquiry', 'dispute', 'fraud']
      .map(function (id) {
        var isInq = id === 'inquiry';
        return (
          '<li class="help-route help-route--' +
          id +
          '">' +
          '<h4 class="help-route__title">' +
          esc(t('help.route.' + id + '.title')) +
          '</h4>' +
          '<p class="help-route__body">' +
          esc(t('help.route.' + id + '.body')) +
          '</p>' +
          '<p class="help-route__state">' +
          (isInq ? tag(t('help.route.inquiry.state'), 'illustrative', 'info') : tag(t('help.route.unavailable'), '', 'lock')) +
          '</p></li>'
        );
      })
      .join('');

    return section(
      'contact',
      connected ? '' : ui.illustrativeTag('help.contact.tag'),
      '<p class="help-sec__lede">' +
        esc(t('help.contact.lede')) +
        '</p>' +
        (connected ? '' : notice('illustrative', 'info', '<p>' + esc(t('help.contact.notConnected')) + '</p>', 'help-gap')) +
        '<ul class="help-contact">' +
        items +
        '</ul>' +
        '<h3 class="help-sub">' +
        esc(t('help.route.title')) +
        '</h3>' +
        '<p class="help-sub__lede">' +
        esc(t('help.route.lede')) +
        '</p>' +
        '<ul class="help-routes">' +
        routes +
        '</ul>' +
        notice('info', 'info', '<p>' + esc(t('help.route.note')) + '</p>', 'help-gap-top')
    );
  }

  /* --------------------------- Feedback ---------------------------- */
  function feedbackBodyHtml() {
    var h = H();
    var rec = savedFeedback();
    if (rec && !h.editing) {
      return (
        '<div class="notice notice--ok help-fb__done" id="help-fb-done" tabindex="-1" data-fk="help-fb-done">' +
        icon('check-circle', { size: 22 }) +
        '<div><p class="help-fb__done-title">' +
        esc(t('help.fb.doneTitle')) +
        '</p><p>' +
        esc(t('help.fb.doneBody')) +
        '</p>' +
        '<dl class="kv help-fb__summary"><dt>' +
        esc(t('help.fb.yourAnswer')) +
        '</dt><dd>' +
        esc(t('help.fb.rating.' + rec.rating)) +
        '</dd><dt>' +
        esc(t('help.fb.yourComment')) +
        '</dt><dd>' +
        (rec.comment ? esc(rec.comment) : '<span class="muted">' + esc(t('help.fb.noComment')) + '</span>') +
        '</dd></dl></div></div>' +
        '<div class="help-actions"><button type="button" class="btn" data-help-fb-edit data-fk="help-fb-edit">' +
        esc(t('help.fb.edit')) +
        '</button></div>'
      );
    }
    var err = h.error;
    var choices = RATINGS.map(function (r) {
      return (
        '<label class="choice help-fb__choice"><input type="radio" name="help-fb-rating" value="' +
        r +
        '" data-fk="help-fb-' +
        r +
        '"' +
        (h.rating === r ? ' checked' : '') +
        (err ? ' aria-invalid="true" aria-describedby="help-fb-error"' : '') +
        ' /><span>' +
        esc(t('help.fb.rating.' + r)) +
        '</span></label>'
      );
    }).join('');
    return (
      '<p class="help-sec__lede">' +
      esc(t('help.fb.lede')) +
      '</p>' +
      '<form class="help-fb" data-help-fb novalidate>' +
      '<fieldset class="help-fb__set">' +
      '<legend class="help-fb__legend">' +
      esc(t('help.fb.question')) +
      '</legend>' +
      (err ? '<p class="field__error help-fb__error" id="help-fb-error">' + icon('alert', { size: 18 }) + '<span>' + esc(t('help.fb.error')) + '</span></p>' : '') +
      '<div class="choices help-fb__choices">' +
      choices +
      '</div></fieldset>' +
      '<div class="field help-fb__field">' +
      '<label class="field__label" for="help-fb-comment">' +
      esc(t('help.fb.comment')) +
      ' <span class="help-optional">(' +
      esc(t('common.optional')) +
      ')</span></label>' +
      '<span class="field__hint" id="help-fb-hint">' +
      esc(t('help.fb.commentHint')) +
      '</span>' +
      '<textarea id="help-fb-comment" class="textarea" rows="3" maxlength="500" aria-describedby="help-fb-hint" data-fk="help-fb-comment">' +
      esc(h.comment) +
      '</textarea></div>' +
      notice('illustrative', 'info', '<p>' + esc(t('help.fb.demoNote')) + '</p>', 'help-gap-top') +
      '<div class="help-actions"><button type="submit" class="btn btn--primary" data-fk="help-fb-submit">' +
      esc(t('help.fb.submit')) +
      '</button>' +
      (h.editing && savedFeedback() ? '<button type="button" class="btn btn--ghost" data-help-fb-cancel data-fk="help-fb-cancel">' + esc(t('common.cancel')) + '</button>' : '') +
      '</div></form>'
    );
  }

  function feedbackHtml() {
    return section('feedback', ui.illustrativeTag('demo.only'), '<div id="help-fb-body">' + feedbackBodyHtml() + '</div>');
  }

  /* ---------------------------- Record ----------------------------- */
  function recordHtml() {
    var s = st();
    var rows = [
      ['help.rec.id', '<span class="mono">' + esc(s.id) + '</span>'],
      ['help.rec.version', esc(s.version)],
      ['help.rec.issue', esc(issueLabel())],
      ['help.rec.period', esc(YES.fmt.range(s.periodStart, s.periodEnd))],
      ['help.rec.generated', esc(dateTime(s.generatedAt) + ' ' + tzShort(s.generatedAt))],
      ['help.rec.asOf', esc(dateTime(s.asOf) + ' ' + tzShort(s.asOf))],
      ['help.rec.timezone', esc(YES.fmt.tz(s.asOf))],
      ['help.rec.basis', esc(t('term.postedDate')) + '<span class="help-kv__note">' + esc(t('term.dateBasisNote')) + '</span>']
    ];
    var kv = rows
      .map(function (r) {
        return '<dt>' + esc(t(r[0])) + '</dt><dd>' + r[1] + '</dd>';
      })
      .join('');
    return section(
      'record',
      tag(t('help.rec.tag'), '', 'lock'),
      '<p class="help-sec__lede">' +
        esc(t('help.rec.lede')) +
        '</p>' +
        '<dl class="kv help-kv">' +
        kv +
        '</dl>' +
        notice('info', 'lock', '<p><strong>' + esc(t('help.rec.snapshot')) + '</strong></p><p>' + esc(t('help.rec.live')) + '</p>', 'help-gap-top') +
        '<div class="help-actions help-actions--record">' +
        '<button type="button" class="btn btn--primary" data-help-print data-fk="help-print">' +
        icon('print', { size: 18 }) +
        '<span>' +
        esc(t('common.print')) +
        '</span></button>' +
        '<button type="button" class="btn" data-help-csv data-fk="help-csv">' +
        icon('download', { size: 18 }) +
        '<span>' +
        esc(t('help.rec.csv')) +
        '</span></button>' +
        '</div>' +
        '<p class="help-fine">' +
        esc(t('help.rec.printHint')) +
        '</p>' +
        '<p class="help-fine">' +
        icon('info', { size: 16 }) +
        '<span>' +
        esc(t('help.rec.retention')) +
        '</span></p>'
    );
  }

  /* --------------------------- Integrity --------------------------- */
  function equationHtml() {
    var steps = YES.calc.journey();
    var visual = [];
    var spoken = [];
    steps.forEach(function (s) {
      var label = t('cat.' + s.id);
      var isTotal = s.kind === 'total';
      var op = '';
      if (s.id === 'closing') op = '=';
      else if (!isTotal) op = s.value < 0 ? YES.fmt.MINUS : '+';
      var val = YES.fmt.amount(Math.abs(s.value), { sign: 'never', unit: s.id === 'closing' });
      visual.push(
        '<span class="help-eq__item' +
          (s.id === 'closing' ? ' help-eq__item--result' : '') +
          '">' +
          (op ? '<span class="help-eq__op">' + esc(op) + '</span>' : '') +
          '<span class="help-eq__term' +
          (isTotal ? ' help-eq__term--total' : '') +
          '"><span class="help-eq__val">' +
          esc(val) +
          '</span><span class="help-eq__lbl">' +
          esc(label) +
          '</span></span></span>'
      );
      var full = YES.fmt.amount(Math.abs(s.value), { sign: 'never' });
      if (s.id === 'opening') spoken.push(label + ' ' + full);
      else if (s.id === 'closing') spoken.push(t('help.int.equals') + ' ' + lower(label) + ' ' + full);
      else spoken.push(t(s.value < 0 ? 'fmt.minus' : 'fmt.plus') + ' ' + lower(label) + ' ' + full);
    });
    return (
      '<div class="help-eq" data-help-eq>' +
      '<p class="help-eq__visual" aria-hidden="true">' +
      visual.join('') +
      '</p>' +
      '<p class="sr-only">' +
      esc(spoken.join(', ') + '.') +
      '</p>' +
      '<p class="help-eq__unit">' +
      esc(t('help.int.unit', { symbol: asset().symbol })) +
      '</p></div>'
    );
  }

  function integrityHtml() {
    var r = integrity();
    var passed = r.checks.filter(function (c) {
      return c.ok;
    }).length;
    var allOk = passed === r.checks.length;
    var list = r.checks
      .map(function (c) {
        return (
          '<li class="check help-check ' +
          (c.ok ? 'check--ok' : 'check--fail') +
          '" data-check="' +
          esc(c.id) +
          '">' +
          icon(c.ok ? 'check-circle' : 'alert', { size: 18 }) +
          '<span class="help-check__label">' +
          esc(t('check.' + c.id)) +
          '</span><span class="check__state">' +
          esc(t(c.ok ? 'integrity.pass' : 'integrity.fail')) +
          '</span></li>'
        );
      })
      .join('');
    var summary = t('help.int.summary', { n: YES.fmt.count(passed), total: YES.fmt.count(r.checks.length) });
    return section(
      'integrity',
      '<span class="help-badge help-badge--' + (allOk ? 'ok' : 'fail') + '">' + icon(allOk ? 'check-circle' : 'alert', { size: 16 }) + '<span>' + esc(summary) + '</span></span>',
      '<p class="help-sec__lede">' +
        esc(t('help.int.lede')) +
        '</p>' +
        '<h3 class="help-sub">' +
        esc(t('help.int.eqTitle')) +
        '</h3>' +
        equationHtml() +
        '<h3 class="help-sub">' +
        esc(t('integrity.checks')) +
        '</h3>' +
        '<ul class="checks help-checks" aria-label="' +
        esc(t('help.int.listLabel', { summary: summary })) +
        '">' +
        list +
        '</ul>' +
        '<div class="notice notice--illustrative help-preview help-gap-top">' +
        icon('eye', { size: 20 }) +
        '<div><p class="help-preview__title">' +
        tag(t('demo.only'), 'illustrative') +
        ' <strong>' +
        esc(t('help.int.previewTitle')) +
        '</strong></p><p>' +
        esc(t('help.int.previewBody', { amount: YES.fmt.amount(1, { sign: 'never', unit: false }) })) +
        '</p><p class="help-preview__action"><a class="btn" href="#/overview?simulate=mismatch" data-help-preview data-fk="help-preview">' +
        icon('alert', { size: 18 }) +
        '<span>' +
        esc(t('help.int.preview')) +
        '</span></a></p></div></div>'
    );
  }

  /* ------------------------- Accessibility ------------------------- */
  function uwLiveHtml() {
    var s = uwStatus();
    return (
      '<span class="help-uw__chip help-uw__chip--' +
      s +
      '" data-help-uw-status="' +
      s +
      '">' +
      icon(UW_STATES[s], { size: 16 }) +
      '<span>' +
      esc(t('help.uw.status.' + s)) +
      '</span></span>' +
      '<span class="help-uw__msg">' +
      esc(t('help.uw.msg.' + s)) +
      '</span>'
    );
  }

  function accessibilityHtml() {
    var cfg = YES.config.userway || {};
    var features = FEATURES.map(function (f) {
      return (
        '<li class="help-feature"><span class="help-feature__icon">' +
        icon(f.icon, { size: 20 }) +
        '</span><div><h3 class="help-feature__title">' +
        esc(t('help.a11y.f.' + f.id)) +
        '</h3><p class="help-feature__body">' +
        esc(t('help.a11y.f.' + f.id + '.body')) +
        '</p></div></li>'
      );
    }).join('');
    return section(
      'accessibility',
      tag(t('help.a11y.tag'), '', 'check-circle'),
      '<p class="help-sec__lede">' +
        esc(t('help.a11y.lede')) +
        '</p>' +
        '<ul class="help-features">' +
        features +
        '</ul>' +
        '<div class="help-uw card card--inset">' +
        '<h3 class="help-uw__title">' +
        icon('accessibility', { size: 20 }) +
        '<span>' +
        esc(t('help.uw.title')) +
        '</span></h3>' +
        '<p class="help-uw__live" role="status" id="help-uw-live">' +
        uwLiveHtml() +
        '</p>' +
        '<dl class="kv help-uw__kv"><dt>' +
        esc(t('help.uw.account')) +
        '</dt><dd><span class="mono" data-help-uw-account>' +
        esc(cfg.accountId || t('common.none')) +
        '</span></dd><dt>' +
        esc(t('help.uw.loading')) +
        '</dt><dd>' +
        esc(t('help.uw.loadingValue')) +
        '</dd></dl>' +
        '<p class="help-uw__note">' +
        esc(t('help.uw.augments')) +
        '</p></div>' +
        '<p class="help-fine">' +
        icon('info', { size: 16 }) +
        '<span>' +
        esc(t('help.a11y.review')) +
        '</span></p>'
    );
  }

  /* ------------------------------ About ---------------------------- */
  function cellLabel(key) {
    return '<span class="help-table__lbl" aria-hidden="true">' + esc(t(key)) + '</span>';
  }

  /** What this file does for one connected enhancement ("In this file" column). */
  function enhancementFileHtml(id) {
    var uw = YES.config.userway || {};
    if (id === 'userway') {
      return (
        esc(t('help.about.e.userway.file', { id: uw.accountId || '' })) +
        ' <span data-help-uw-about>' +
        esc(t('help.about.e.userway.now', { status: t('help.uw.status.' + uwStatus()) })) +
        '</span>'
      );
    }
    var text = t('help.about.e.' + id + '.file');
    // The statement measures nothing, but the page must not claim that nothing
    // leaves it while it loads a third-party widget: name the widget whenever it
    // is enabled, in the same words as the footer's demo notice.
    if (id === 'analytics' && uw.enabled) text += ' ' + t('footer.userwayNote');
    return esc(text);
  }

  function aboutHtml() {
    var cfg = YES.config;
    var rows = ENHANCEMENTS.map(function (e) {
      var fileHtml = enhancementFileHtml(e.id);
      return (
        '<tr role="row" data-enh="' +
        e.id +
        '"><th scope="row" role="rowheader"><span class="help-enh">' +
        '<span class="help-enh__icon">' +
        icon(e.icon, { size: 18 }) +
        '</span><span>' +
        esc(t('help.about.e.' + e.id)) +
        '</span></span></th>' +
        '<td role="cell">' +
        cellLabel('help.about.colFile') +
        '<span class="help-enh__state">' +
        tag(t('help.about.tag.' + e.tag), e.demo ? 'illustrative' : '') +
        '</span><span class="help-enh__text">' +
        fileHtml +
        '</span></td>' +
        '<td role="cell">' +
        cellLabel('help.about.colProd') +
        '<span class="help-enh__text">' +
        esc(t('help.about.e.' + e.id + '.prod')) +
        '</span></td></tr>'
      );
    }).join('');

    var slots = cfg.slots;
    var sup = cfg.support;
    function swatch(color) {
      return '<span class="help-swatch" aria-hidden="true" style="background-color:' + esc(color) + '"></span><span class="mono">' + esc(color) + '</span>';
    }
    var logo = slots.YES_LOGO || {};
    // A miniature of the slot as rendered everywhere else; the words name its state.
    var logoMini = ui.logoHtml({ cls: 'help-logo-mini', size: 24, decorative: true });
    var logoArt = logoMini.indexOf('yes-logo--art') !== -1;
    var slotRows = [
      ['YES_LOGO', logoMini + '<span>' + esc(logoArt ? t('help.slots.logoSvg') : t('help.slots.logoText', { text: logo.text || t('brand.logoAlt') })) + '</span>'],
      ['YES_PRIMARY', swatch(slots.YES_PRIMARY)],
      ['YES_ACCENT', swatch(slots.YES_ACCENT)],
      ['YES_FONT', '<span class="mono help-slot__font">' + esc(slots.YES_FONT) + '</span>'],
      ['PRODUCT_NAME', esc(YES.L(slots.PRODUCT_NAME))],
      ['ISSUER_OR_PARTNER', esc(YES.L(slots.ISSUER_OR_PARTNER))],
      ['VIDEO_POSTER', esc(slots.VIDEO_POSTER ? t('help.slots.posterSet') : t('help.slots.posterNone'))],
      ['DISCLOSURES', esc(YES.L(slots.DISCLOSURES))],
      [
        'SUPPORT',
        '<span class="help-slot__lines"><span>' +
          esc(sup.phone) +
          '</span><span>' +
          esc(sup.email) +
          '</span><span>' +
          esc(YES.L(sup.hours)) +
          '</span><span class="muted">' +
          esc(t(sup.connected ? 'help.slots.connected' : 'help.slots.notConnected')) +
          '</span></span>'
      ]
    ]
      .map(function (r) {
        var name = r[0] === 'SUPPORT' ? t('help.slots.support') : '[' + r[0] + ']';
        return (
          '<tr role="row" data-slot-row="' +
          r[0] +
          '"><th scope="row" role="rowheader"><span class="' +
          (r[0] === 'SUPPORT' ? '' : 'mono ') +
          'help-slot__name">' +
          esc(name) +
          '</span></th><td role="cell">' +
          '<span class="help-slot__value">' +
          r[1] +
          '</span> ' +
          ui.illustrativeTag('common.placeholder') +
          '</td></tr>'
        );
      })
      .join('');

    return section(
      'about',
      '<span class="demo-badge">' + icon('info', { size: 16 }) + '<span>' + esc(t('demo.badge')) + '</span></span>',
      '<p class="help-sec__lede">' +
        esc(t('help.about.lede')) +
        '</p>' +
        '<div class="help-table-wrap table-wrap"><table class="table help-table help-table--stack" role="table" data-help-enh>' +
        '<caption>' +
        esc(t('help.about.caption')) +
        '</caption>' +
        '<thead role="rowgroup"><tr role="row"><th scope="col" role="columnheader">' +
        esc(t('help.about.colName')) +
        '</th><th scope="col" role="columnheader">' +
        esc(t('help.about.colFile')) +
        '</th><th scope="col" role="columnheader">' +
        esc(t('help.about.colProd')) +
        '</th></tr></thead><tbody role="rowgroup">' +
        rows +
        '</tbody></table></div>' +
        '<h3 class="help-sub">' +
        esc(t('help.slots.title')) +
        '</h3>' +
        '<p class="help-sub__lede">' +
        esc(t('help.slots.lede')) +
        '</p>' +
        '<div class="help-table-wrap table-wrap"><table class="table help-table help-table--stack help-table--slots" role="table" data-help-slots>' +
        '<caption class="sr-only">' +
        esc(t('help.slots.title')) +
        '</caption>' +
        '<thead role="rowgroup"><tr role="row"><th scope="col" role="columnheader">' +
        esc(t('help.slots.colSlot')) +
        '</th><th scope="col" role="columnheader">' +
        esc(t('help.slots.colValue')) +
        '</th></tr></thead><tbody role="rowgroup">' +
        slotRows +
        '</tbody></table></div>'
    );
  }

  function viewHtml() {
    return (
      '<h1 id="h-help" class="view-title" data-view-heading tabindex="-1">' +
      esc(t('help.title')) +
      '</h1>' +
      '<p class="view-lede">' +
      esc(t('help.lede')) +
      '</p>' +
      quickHtml() +
      '<div class="help-layout">' +
      tocHtml() +
      '<div class="help-sections">' +
      contactHtml() +
      feedbackHtml() +
      recordHtml() +
      integrityHtml() +
      accessibilityHtml() +
      aboutHtml() +
      '</div></div>'
    );
  }

  /* ------------------------------------------------------------------ */
  /* Statement-of-record print view                                      */
  /* ------------------------------------------------------------------ */
  /** Demo watermark, repeated down every printed page (position: fixed repeats per page). */
  function watermarkHtml() {
    var text = t('demo.watermark');
    var span = '<span>' + esc(text) + '</span>';
    return '<div class="print-watermark' + (text.length > 24 ? ' print-watermark--long' : '') + '" aria-hidden="true">' + span + span + span + '</div>';
  }

  /**
   * The [YES_LOGO] slot exactly as the masthead shows it (ui.logoHtml): approved
   * artwork (SVG or data: image) when supplied, else the text placeholder, which
   * 90-print.css prints as a boxed wordmark without a background fill.
   */
  function printLogoHtml() {
    return ui.logoHtml({ cls: 'pr-logo', size: '28pt' });
  }

  /** A CSS string literal that is also safe inside a <style> element. */
  function cssStr(s) {
    return (
      '"' +
      String(s)
        .replace(/[\\"]/g, '\\$&')
        .replace(/\r\n|[\r\n\f]/g, '\\A ')
        .replace(/</g, '\\3C ') +
      '"'
    );
  }

  /**
   * Running page footer for the statement of record: the statement ID and
   * version at the bottom left of every printed page, "Page n of N" at the
   * bottom right, in the current language (CSS @page margin boxes; a browser
   * without them simply prints the trailing footer block). Appearance is in
   * 60-help.css; only the localized content is generated here.
   */
  function pageFooterCss() {
    var s = st();
    var parts = t('help.print.pageOf').split(/\{(page|pages)\}/);
    var counter = parts
      .map(function (p, i) {
        if (i % 2) return 'counter(' + p + ')';
        return p ? cssStr(p) : '';
      })
      .filter(Boolean)
      .join(' ');
    return (
      '@media print{@page{' +
      '@bottom-left{content:' +
      cssStr(t('footer.statementId', { id: s.id, version: s.version })) +
      '}' +
      '@bottom-right{content:' +
      counter +
      '}}}'
    );
  }

  function printHtml() {
    var s = st();
    var a = asset();
    var cats = YES.calc.categories();
    var posted = YES.calc.posted();
    var running = YES.calc.running();
    var pending = YES.calc.notInBalance();
    var balanceAfter = {};
    running.forEach(function (r) {
      balanceAfter[r.txId] = r.balance;
    });
    var periodStartMs = Date.parse(s.periodStart);
    var cust = s.customer || {};
    var dt = function (iso) {
      return iso ? esc(YES.fmt.date(iso, 'medium')) + '<span class="pr-sub">' + esc(YES.fmt.date(iso, 'time')) + '</span>' : '';
    };
    var unitNote = t('help.print.unit', { symbol: a.symbol });

    var facts = [
      ['help.rec.id', '<span class="mono">' + esc(s.id) + '</span>'],
      ['help.rec.version', esc(s.version)],
      ['help.rec.issue', esc(issueLabel())],
      ['help.rec.period', esc(YES.fmt.range(s.periodStart, s.periodEnd))],
      ['help.rec.generated', esc(dateTime(s.generatedAt) + ' ' + tzShort(s.generatedAt))],
      ['help.rec.asOf', esc(dateTime(s.asOf) + ' ' + tzShort(s.asOf))],
      ['help.rec.timezone', esc(YES.fmt.tz(s.asOf))],
      ['help.rec.basis', esc(t('term.postedDate'))],
      ['help.print.asset', esc(YES.L(a.name) + ' (' + a.symbol + ')')]
    ]
      .map(function (f) {
        return '<dt>' + esc(t(f[0])) + '</dt><dd>' + f[1] + '</dd>';
      })
      .join('');

    /*
     * Closing and total rows are the last rows of each table body, never a
     * <tfoot>: print engines repeat a table footer at the bottom of every page
     * fragment, which would put "Closing balance" under a mid-period running
     * balance. Header rows (<thead>) do repeat, by design.
     */
    var summaryRows =
      '<tr class="pr-total"><th scope="row">' +
      esc(t('cat.opening')) +
      '</th><td class="num"></td><td class="num">' +
      esc(amt(s.opening)) +
      '</td></tr>' +
      cats
        .map(function (c) {
          return (
            '<tr data-print-cat="' +
            esc(c.id) +
            '"><th scope="row">' +
            esc(t('cat.' + c.id)) +
            '</th><td class="num">' +
            esc(YES.fmt.count(c.count)) +
            '</td><td class="num">' +
            esc(amt(c.total, 'always')) +
            '</td></tr>'
          );
        })
        .join('');
    var eq = YES.calc
      .journey()
      .map(function (step) {
        var label = t('cat.' + step.id);
        var v = YES.fmt.amount(Math.abs(step.value), { sign: 'never', unit: step.id === 'closing' });
        if (step.id === 'opening') return label + ' ' + v;
        if (step.id === 'closing') return '= ' + label + ' ' + v;
        return (step.value < 0 ? YES.fmt.MINUS : '+') + ' ' + label + ' ' + v;
      })
      .join(' ');

    var ledgerRows =
      '<tr class="pr-total" data-print-opening><td>' +
      esc(YES.fmt.date(s.periodStart, 'medium')) +
      '</td><td></td><th scope="row" colspan="3">' +
      esc(t('cat.opening')) +
      '</th><td class="num"></td><td class="num">' +
      esc(amt(s.opening)) +
      '</td></tr>' +
      posted
        .map(function (tx) {
          var prior = Date.parse(tx.initiatedAt) < periodStartMs;
          var parent = tx.parentId ? YES.calc.tx(tx.parentId) : null;
          return (
            '<tr data-print-tx="' +
            esc(tx.id) +
            '"><td>' +
            dt(tx.postedAt) +
            '</td><td>' +
            dt(tx.initiatedAt) +
            (prior ? '<span class="pr-flag">' + esc(t('help.print.prevPeriod')) + '</span>' : '') +
            '</td><td><span class="pr-desc">' +
            esc(YES.L(tx.description)) +
            '</span><span class="pr-sub">' +
            ui.maskedHtml(YES.L(tx.counterparty)) +
            '</span>' +
            (parent ? '<span class="pr-sub">' + esc(t('help.print.feeFor', { ref: parent.reference })) + '</span>' : '') +
            '</td><td>' +
            esc(ui.typeLabel(tx)) +
            '</td><td class="mono">' +
            esc(tx.reference) +
            '</td><td class="num">' +
            esc(amt(tx.amount, 'always')) +
            '</td><td class="num">' +
            esc(amt(balanceAfter[tx.id])) +
            '</td></tr>'
          );
        })
        .join('');

    var pendingHtml = pending.length
      ? '<table class="pr-table"><thead><tr><th scope="col">' +
        esc(t('term.initiatedDate')) +
        '</th><th scope="col">' +
        esc(t('help.print.colDesc')) +
        '</th><th scope="col">' +
        esc(t('help.print.colType')) +
        '</th><th scope="col">' +
        esc(t('help.print.colRef')) +
        '</th><th scope="col">' +
        esc(t('help.print.colStatus')) +
        '</th><th scope="col" class="num">' +
        esc(t('help.print.colAmount')) +
        '</th></tr></thead><tbody>' +
        pending
          .map(function (tx) {
            var stKey = { pending: 1, failed: 1 }[tx.status] ? 'status.' + tx.status : 'status.unknown';
            return (
              '<tr data-print-pending="' +
              esc(tx.id) +
              '"><td>' +
              dt(tx.initiatedAt) +
              '</td><td><span class="pr-desc">' +
              esc(YES.L(tx.description)) +
              '</span><span class="pr-sub">' +
              ui.maskedHtml(YES.L(tx.counterparty)) +
              '</span></td><td>' +
              esc(ui.typeLabel(tx)) +
              '</td><td class="mono">' +
              esc(tx.reference) +
              '</td><td><strong>' +
              esc(t(stKey)) +
              '</strong><span class="pr-sub">' +
              esc(t('status.notInBalance')) +
              '</span></td><td class="num">' +
              esc(amt(tx.amount, 'always')) +
              '</td></tr>'
            );
          })
          .join('') +
        '</tbody></table>'
      : '<p>' + esc(t('common.none')) + '</p>';

    var feeCat = YES.calc.category('fees');
    var feeRows = (feeCat ? feeCat.txIds : [])
      .map(function (id) {
        var tx = YES.calc.tx(id);
        var parent = tx.parentId ? YES.calc.tx(tx.parentId) : null;
        return (
          '<tr data-print-fee="' +
          esc(tx.id) +
          '"><td>' +
          esc(YES.fmt.date(tx.postedAt, 'medium')) +
          '</td><td>' +
          esc(YES.L(tx.description)) +
          '</td><td class="mono">' +
          esc(parent ? parent.reference : '') +
          '</td><td class="num">' +
          esc(amt(tx.amount, 'always')) +
          '</td></tr>'
        );
      })
      .join('');
    var foreign = YES.calc.foreignFees();

    // The ledger closes the way it opens: dated period end, label, balance.
    var ledgerClosing =
      '<tr class="pr-closing" data-print-ledger-closing><td>' +
      esc(YES.fmt.date(s.periodEnd, 'medium')) +
      '</td><td></td><th scope="row" colspan="3">' +
      esc(t('cat.closing')) +
      '</th><td class="num"></td><td class="num">' +
      esc(amt(s.closing)) +
      '</td></tr>';

    return (
      (YES.config.demo ? watermarkHtml() : '') +
      '<article class="pr" data-print-lang="' +
      esc(YES.i18n.lang) +
      '">' +
      '<header class="pr-head">' +
      '<div class="pr-head__brand">' +
      printLogoHtml() +
      '<div><p class="pr-kicker">' +
      esc(YES.L(YES.config.slots.PRODUCT_NAME)) +
      '</p><h1 class="pr-title">' +
      esc(t('help.print.title')) +
      '</h1><p class="pr-period">' +
      esc(YES.fmt.range(s.periodStart, s.periodEnd)) +
      '</p></div></div>' +
      (YES.config.demo ? '<p class="pr-demo">' + esc(t('demo.badgeLong')) + '</p>' : '') +
      '</header>' +
      '<div class="pr-meta">' +
      '<div class="pr-addr"><p class="pr-label">' +
      esc(t('help.print.customer')) +
      '</p><address><strong>' +
      esc(cust.displayName || '') +
      '</strong>' +
      (cust.address || [])
        .map(function (line) {
          return '<br />' + esc(line);
        })
        .join('') +
      '</address>' +
      '<p class="pr-label">' +
      esc(t('help.print.account')) +
      '</p><p>' +
      esc(YES.L(s.account.label)) +
      ' <span class="mono">' +
      ui.maskedHtml(s.account.maskedId) +
      '</span>' +
      (s.account.walletMasked ? '<br />' + esc(t('help.print.wallet')) + ' <span class="mono">' + ui.maskedHtml(s.account.walletMasked) + '</span>' : '') +
      '</p><p class="pr-sub">' +
      esc(t('help.print.masked')) +
      '</p></div>' +
      '<dl class="pr-facts">' +
      facts +
      '</dl></div>' +
      /* Balance summary */
      '<section class="pr-sec" data-print-summary><h2>' +
      esc(t('help.print.summary')) +
      '</h2><table class="pr-table pr-summary"><thead><tr><th scope="col">' +
      esc(t('help.print.colItem')) +
      '</th><th scope="col" class="num">' +
      esc(t('help.print.colCount')) +
      '</th><th scope="col" class="num">' +
      esc(t('help.print.colAmount')) +
      '</th></tr></thead><tbody>' +
      summaryRows +
      '<tr class="pr-closing"><th scope="row">' +
      esc(t('cat.closing')) +
      '</th><td class="num"></td><td class="num" data-print-closing>' +
      esc(YES.fmt.amount(s.closing)) +
      '</td></tr></tbody></table>' +
      '<p class="pr-eq" data-print-eq>' +
      esc(eq) +
      '</p><p class="pr-note">' +
      esc(t('help.print.net', { net: YES.fmt.amount(YES.calc.netChange(), { sign: 'always' }), count: YES.txCount(posted.length) })) +
      ' ' +
      esc(unitNote) +
      '</p></section>' +
      /* Posted ledger */
      '<section class="pr-sec" data-print-ledger><h2>' +
      esc(t('help.print.ledger')) +
      '</h2><p class="pr-note">' +
      esc(t('help.print.ledgerNote', { count: YES.txCount(posted.length), tz: YES.fmt.tz(s.asOf) })) +
      '</p><table class="pr-table pr-ledger"><thead><tr><th scope="col">' +
      esc(t('term.postedDate')) +
      '</th><th scope="col">' +
      esc(t('term.initiatedDate')) +
      '</th><th scope="col">' +
      esc(t('help.print.colDesc')) +
      '</th><th scope="col">' +
      esc(t('help.print.colType')) +
      '</th><th scope="col">' +
      esc(t('help.print.colRef')) +
      '</th><th scope="col" class="num">' +
      esc(t('help.print.colAmount')) +
      '</th><th scope="col" class="num">' +
      esc(t('help.print.colBalance')) +
      '</th></tr></thead><tbody>' +
      ledgerRows +
      ledgerClosing +
      '</tbody></table></section>' +
      /* Not in balance */
      '<section class="pr-sec pr-pending" data-print-pending-section><h2>' +
      esc(t('help.print.pending')) +
      '</h2><p class="pr-note">' +
      esc(t('help.print.pendingNote', { date: dateTime(s.asOf) + ' ' + tzShort(s.asOf) })) +
      '</p>' +
      pendingHtml +
      '</section>' +
      /* Fees */
      '<section class="pr-sec" data-print-fees><h2>' +
      esc(t('help.print.fees')) +
      '</h2><table class="pr-table"><thead><tr><th scope="col">' +
      esc(t('term.postedDate')) +
      '</th><th scope="col">' +
      esc(t('help.print.colFee')) +
      '</th><th scope="col">' +
      esc(t('help.print.colFeeFor')) +
      '</th><th scope="col" class="num">' +
      esc(t('help.print.colAmount')) +
      '</th></tr></thead><tbody>' +
      feeRows +
      '<tr class="pr-closing" data-print-fees-total><th scope="row" colspan="3">' +
      esc(t('help.print.feesTotal', { count: YES.txCount(feeCat ? feeCat.count : 0) })) +
      '</th><td class="num">' +
      esc(amt(YES.calc.feesTotal(), 'always')) +
      '</td></tr></tbody></table><p class="pr-note">' +
      esc(t(foreign.length ? 'help.print.foreignFees' : 'help.print.noForeignFees')) +
      '</p></section>' +
      /* Disclosures and footer print as one block, so the record's identification never sits alone on a page. */
      '<div class="pr-end" data-print-end>' +
      '<section class="pr-sec pr-disc" data-slot="DISCLOSURES"><h2>' +
      esc(t('footer.disclosures')) +
      '</h2><p>' +
      esc(YES.L(YES.config.slots.DISCLOSURES)) +
      '</p><p>' +
      esc(t('help.print.issuer', { value: YES.L(YES.config.slots.ISSUER_OR_PARTNER) })) +
      '</p><p>' +
      esc(t('help.print.snapshot')) +
      '</p></section>' +
      /* Footer */
      '<footer class="pr-foot">' +
      (YES.config.demo ? '<p><strong>' + esc(t('demo.watermark')) + '.</strong> ' + esc(t('footer.demo')) + '</p>' : '') +
      '<p>' +
      esc(t('footer.statementId', { id: s.id, version: s.version })) +
      ' · ' +
      esc(t('footer.generated', { date: dateTime(s.generatedAt) + ' ' + tzShort(s.generatedAt) })) +
      '</p><p>' +
      esc(t('footer.poweredBy')) +
      '</p></footer></div>' +
      '</article>'
    );
  }

  function renderPrint() {
    if (!els.print) return;
    els.print.innerHTML = printHtml();
    var style = doc.getElementById('help-print-page');
    if (!style) {
      style = doc.createElement('style');
      style.id = 'help-print-page';
      doc.head.appendChild(style);
    }
    style.textContent = pageFooterCss();
  }

  /* ------------------------------------------------------------------ */
  /* Rendering                                                           */
  /* ------------------------------------------------------------------ */
  function render() {
    if (!inited) return;
    ui.render(els.root, viewHtml());
    renderPrint();
  }
  function renderQuickTx() {
    ui.render(doc.getElementById('help-quick-tx'), quickTxHtml());
  }
  function renderFeedback() {
    ui.render(doc.getElementById('help-fb-body'), feedbackBodyHtml());
  }
  function renderUserway() {
    var live = doc.getElementById('help-uw-live');
    if (live) live.innerHTML = uwLiveHtml();
    var about = els.root && els.root.querySelector('[data-help-uw-about]');
    if (about) about.textContent = t('help.about.e.userway.now', { status: t('help.uw.status.' + uwStatus()) });
  }

  /* ------------------------------------------------------------------ */
  /* Navigation                                                          */
  /* ------------------------------------------------------------------ */
  function focusSection(id) {
    var h = doc.getElementById('help-' + id + '-title');
    var sec = doc.getElementById('help-' + id);
    if (!h || !sec || sec.offsetParent === null) return;
    h.focus({ preventScroll: true });
    sec.scrollIntoView({ block: 'start', behavior: ui.reducedMotion() ? 'auto' : 'smooth' });
  }

  /** Navigate to Help and focus a section (contact, feedback, record, integrity, accessibility, about). */
  function open(sectionId) {
    var sec = SECTIONS.indexOf(sectionId) !== -1 ? sectionId : null;
    if (sec) setH({ section: sec });
    YES.nav.go('help', { param: sec, focus: !sec });
  }

  function onRoute(r) {
    if (!r || r.view !== 'help') return;
    var sec = SECTIONS.indexOf(r.param) !== -1 ? r.param : null;
    if (!sec) return;
    setH({ section: sec });
    // Defer until the router has finished (it may scroll to the top or focus the h1).
    clearTimeout(focusTimer);
    focusTimer = setTimeout(function () {
      focusSection(sec);
    }, 0);
  }

  /* ------------------------------------------------------------------ */
  /* Feedback actions                                                    */
  /* ------------------------------------------------------------------ */
  function submitFeedback() {
    var h = H();
    var checked = els.root.querySelector('input[name="help-fb-rating"]:checked');
    var rating = checked ? checked.value : h.rating;
    var box = doc.getElementById('help-fb-comment');
    var comment = box ? box.value : h.comment;
    if (RATINGS.indexOf(rating) === -1) {
      setH({ error: true, comment: comment });
      renderFeedback();
      var first = els.root.querySelector('input[name="help-fb-rating"]');
      if (first) first.focus();
      ui.announce(t('help.fb.error'), true);
      return;
    }
    var record = { rating: rating, comment: String(comment || '').trim().slice(0, 500), at: new Date().toISOString() };
    var fb = {};
    var cur = YES.state.feedback || {};
    Object.keys(cur).forEach(function (k) {
      fb[k] = cur[k];
    });
    fb.clarity = record;
    setH({ rating: rating, comment: comment, error: false, editing: false });
    YES.set({ feedback: fb });
    renderFeedback();
    var done = doc.getElementById('help-fb-done');
    if (done) done.focus();
    ui.announce(t('help.fb.announce'));
  }

  /* ------------------------------------------------------------------ */
  /* Public API and registration                                         */
  /* ------------------------------------------------------------------ */
  YES.help = { open: open, renderPrint: renderPrint, sections: SECTIONS.slice() };

  YES.register({
    name: 'help',
    i18n: {
      en: {
        'help.title': 'Help and statement record',
        'help.lede': 'Get help with this statement, check how its numbers were verified, and print or download the record. Everything on this page works without a connection.',
        'help.toc.label': 'On this page',

        'help.sec.contact': 'Contact support',
        'help.sec.feedback': 'Feedback',
        'help.sec.record': 'Statement record',
        'help.sec.integrity': 'Statement integrity',
        'help.sec.accessibility': 'Accessibility',
        'help.sec.about': 'About this demo',

        'help.q.title': 'Question about a transaction?',
        'help.q.body': 'Open the transaction in Transactions and choose “Ask about this transaction”. Its reference is carried into the inquiry for you.',
        'help.q.go': 'Go to Transactions',
        'help.q.draft': 'You have an unfinished demo inquiry about “{tx}”. Pick up where you left off.',
        'help.q.resume': 'Continue your demo inquiry',
        'help.q.submitted': 'Demo inquiry {ref} completed. Demo only — no inquiry was sent.',
        'help.q.viewTx': 'View the transaction',
        'help.ask.title': 'Ask YES',
        'help.ask.body': 'Get a short explanation of your balance, a transaction or a fee. In this demo, answers are curated demo explanations computed from this statement — not a live AI service.',

        'help.contact.tag': 'Placeholder destinations',
        'help.contact.lede': 'How you would reach YES about this statement.',
        'help.contact.notConnected': 'These support destinations are placeholders and are not connected in this demo. You cannot call, email or chat with anyone from this file, and nothing you do here reaches a support team.',
        'help.contact.phone': 'Phone',
        'help.contact.email': 'Email',
        'help.contact.hours': 'Hours',
        'help.contact.chat': 'Chat',
        'help.contact.chatOff': 'Not available in this demo',
        'help.contact.chatOn': 'Available during support hours',
        'help.contact.copy.phone': 'Copy the placeholder phone number',
        'help.contact.copy.email': 'Copy the placeholder email address',

        'help.route.title': 'Inquiry, dispute or fraud report?',
        'help.route.lede': 'These are different routes with different rules and timing.',
        'help.route.inquiry.title': 'Transaction inquiry',
        'help.route.inquiry.body': 'Ask a question about one transaction, starting from its details. In this demo the inquiry is a local mock: nothing is sent and no case is created.',
        'help.route.inquiry.state': 'Demo: local mock',
        'help.route.dispute.title': 'Formal dispute',
        'help.route.dispute.body': '[Approved dispute policy, eligibility and response times appear here — placeholder.]',
        'help.route.fraud.title': 'Fraud or unauthorized activity',
        'help.route.fraud.body': '[Approved fraud-report route, urgent steps and response times appear here — placeholder.]',
        'help.route.unavailable': 'Not available in this demo',
        'help.route.note': 'An inquiry is not a formal dispute or fraud report. Formal routes need approved YES policy and timing copy before they can be offered.',

        'help.fb.lede': 'One quick question helps us make statements easier to understand.',
        'help.fb.question': 'How clear was this statement?',
        'help.fb.rating.very_clear': 'Very clear',
        'help.fb.rating.mostly_clear': 'Mostly clear',
        'help.fb.rating.little_confusing': 'A little confusing',
        'help.fb.rating.confusing': 'Confusing',
        'help.fb.error': 'Choose how clear the statement was to save your feedback.',
        'help.fb.comment': 'Anything we could make clearer?',
        'help.fb.commentHint': 'Please do not include personal or account details.',
        'help.fb.demoNote': 'Demo only — feedback is kept only in this browser session and is not sent.',
        'help.fb.submit': 'Save feedback',
        'help.fb.doneTitle': 'Thank you — your feedback is saved in this browser session.',
        'help.fb.doneBody': 'Demo only — your feedback was not sent. It is kept only in this browser session and is cleared when you reload or close the page.',
        'help.fb.announce': 'Feedback saved in this browser session only. Demo only — nothing was sent.',
        'help.fb.yourAnswer': 'Your answer',
        'help.fb.yourComment': 'Your comment',
        'help.fb.noComment': 'No comment',
        'help.fb.edit': 'Change my answer',

        'help.issue.original': 'Original',
        'help.issue.corrected': 'Corrected (new version)',
        'help.rec.tag': 'Period snapshot',
        'help.rec.lede': 'The facts that identify this statement of record.',
        'help.rec.id': 'Statement ID',
        'help.rec.version': 'Version',
        'help.rec.issue': 'Issue status',
        'help.rec.period': 'Statement period',
        'help.rec.generated': 'Generated',
        'help.rec.asOf': 'Statement as of',
        'help.rec.timezone': 'Timezone',
        'help.rec.basis': 'Date basis',
        'help.rec.snapshot': 'This is a period snapshot; an issued statement is never changed — corrections are issued as a new version.',
        'help.rec.live': 'It does not show live balances or current transaction status. In production, live information would appear in a separate, timestamped area.',
        'help.rec.csv': 'Download CSV — complete record',
        'help.rec.printHint': 'The printed statement lists every posted transaction, the balance summary, pending items and fees, with a demo watermark on each page. The CSV file is created on this device; nothing is sent.',
        'help.rec.retention': 'Retention, archival and correction handling are defined with YES and InfoSlips before live use.',

        'help.int.summary': '{n} of {total} checks passed',
        'help.int.listLabel': 'Release checks: {summary}',
        'help.int.lede': 'Before release, automated checks confirm that every total in this statement reconciles to its transactions. A statement that fails any check is withheld.',
        'help.int.eqTitle': 'Balance equation',
        'help.int.equals': 'equals',
        'help.int.unit': 'Exact amounts in {symbol} token units, from the posted transactions.',
        'help.int.previewTitle': 'What if the totals did not reconcile?',
        'help.int.previewBody': 'A statement that does not reconcile is withheld and routed for correction — it is never visually fixed by rounding or animation. The preview changes one amount by {amount} in a copy of the demo data so you can see the withheld state.',
        'help.int.preview': 'Preview the exception state',

        'help.a11y.tag': 'Targets WCAG 2.2 AA',
        'help.a11y.lede': 'This statement is designed to meet WCAG 2.2 Level AA. These features are built in and work without any add-on:',
        'help.a11y.f.keyboard': 'Keyboard',
        'help.a11y.f.keyboard.body': 'Every control works with a keyboard. Escape closes dialogs and the assistant.',
        'help.a11y.f.screenReader': 'Screen readers',
        'help.a11y.f.screenReader.body': 'Headings, landmarks and labels describe the page. Results and confirmations are announced.',
        'help.a11y.f.focus': 'Visible focus',
        'help.a11y.f.focus.body': 'A clear outline shows where you are as you move through the page.',
        'help.a11y.f.motion': 'Reduced motion',
        'help.a11y.f.motion.body': 'Animations are short and optional, and they switch off when your device asks for less motion.',
        'help.a11y.f.zoom': 'Zoom and reflow',
        'help.a11y.f.zoom.body': 'Text can be enlarged, and the layout reflows down to 320 pixels wide without sideways scrolling.',
        'help.a11y.f.textAlt': 'Text alternatives for charts',
        'help.a11y.f.textAlt.body': 'Every chart has a table or written equivalent with the same figures.',
        'help.a11y.f.color': 'Never color alone',
        'help.a11y.f.color.body': 'Direction and status are shown with signs, icons and words, not only color.',
        'help.a11y.f.languages': 'Two languages',
        'help.a11y.f.languages.body': 'English and Spanish are built in, and switching keeps your place.',
        'help.a11y.review': 'A formal WCAG 2.2 AA review and UserWay integration sign-off are required before production.',
        'help.uw.title': 'UserWay accessibility widget',
        'help.uw.account': 'Account ID',
        'help.uw.loading': 'How it loads',
        'help.uw.loadingValue': 'Online only, once. If your viewer already provides UserWay, no second launcher is added.',
        'help.uw.augments': 'The widget adds optional display and reading tools. It augments, not replaces, the accessible base of this statement.',
        'help.uw.status.idle': 'Not requested yet',
        'help.uw.status.loading': 'Loading',
        'help.uw.status.loaded': 'Loaded',
        'help.uw.status.unavailable': 'Unavailable offline',
        'help.uw.status.host': 'Provided by host viewer',
        'help.uw.status.disabled': 'Disabled',
        'help.uw.msg.idle': 'The widget is requested after the statement is ready.',
        'help.uw.msg.loading': 'Trying to load the widget. The statement already works without it.',
        'help.uw.msg.loaded': 'The widget is available. Look for its launcher on the page.',
        'help.uw.msg.unavailable': 'The widget is unavailable — you may be offline, or it was blocked. Everything still works without it.',
        'help.uw.msg.host': 'Your viewer already provides UserWay, so this statement does not add a second launcher.',
        'help.uw.msg.disabled': 'The widget is turned off in this file’s configuration. Everything still works without it.',

        'help.about.lede': 'This is one self-contained file with illustrative demo data. The statement, navigation, charts, explanations, language switch, search, filters and demo inquiry work offline. Connected enhancements are listed with their state in this file.',
        'help.about.caption': 'Connected enhancements',
        'help.about.colName': 'Enhancement',
        'help.about.colFile': 'In this file',
        'help.about.colProd': 'In production',
        'help.about.tag.online': 'Online only',
        'help.about.tag.local': 'Local demo',
        'help.about.tag.mock': 'Local mock',
        'help.about.tag.placeholder': 'Placeholder',
        'help.about.tag.session': 'Session only',
        'help.about.tag.none': 'None',
        'help.about.tag.illustrative': 'Illustrative only',
        'help.about.tag.notConnected': 'Not connected',
        'help.about.e.userway': 'UserWay accessibility widget',
        'help.about.e.userway.file': 'Loads once when you are online, with account ID {id}.',
        'help.about.e.userway.now': 'Current status: {status}.',
        'help.about.e.userway.prod': 'One approved integration, by YES or the InfoSlips viewer — never two launchers.',
        'help.about.e.ai': 'AI explanations',
        'help.about.e.ai.file': 'Curated demo explanations computed from this statement and labeled “Demo explanation”. No live AI model is used.',
        'help.about.e.ai.prod': 'An approved, governed AI service grounded in the statement.',
        'help.about.e.inquiry': 'Transaction inquiry',
        'help.about.e.inquiry.file': 'A complete local mock. Its confirmation says “Demo only — no inquiry was sent”.',
        'help.about.e.inquiry.prod': 'Secure, authenticated case management with a genuine case ID.',
        'help.about.e.video': 'Personalized video',
        'help.about.e.video.file': 'Poster and storyboard placeholder. No video is played or generated.',
        'help.about.e.video.prod': 'An approved video with captions and a transcript.',
        'help.about.e.feedback': 'Feedback',
        'help.about.e.feedback.file': 'Kept only in this browser session. Nothing is sent.',
        'help.about.e.feedback.prod': 'An approved feedback service.',
        'help.about.e.analytics': 'Analytics',
        'help.about.e.analytics.file': 'The statement itself measures and sends nothing.',
        'help.about.e.analytics.prod': 'Approved, minimized engagement measurement.',
        'help.about.e.evidence': 'Reserve and blockchain evidence',
        'help.about.e.evidence.file': 'Illustrative layout: no reserve assertion and no live blockchain verification.',
        'help.about.e.evidence.prod': 'Verified facts only, with source, date and responsible entity.',
        'help.about.e.liveBalance': 'Live balance',
        'help.about.e.liveBalance.file': 'This statement is a period snapshot; no live balance is shown.',
        'help.about.e.liveBalance.prod': 'A separate, timestamped area, apart from the statement.',
        'help.slots.title': 'Brand and legal replacement slots',
        'help.slots.lede': 'YES replaces these placeholders with approved assets and wording before production. Current values in this file:',
        'help.slots.colSlot': 'Slot',
        'help.slots.colValue': 'Current value',
        'help.slots.logoText': 'Text “{text}” in a placeholder box',
        'help.slots.logoSvg': 'Logo artwork supplied',
        'help.slots.posterNone': 'Not set — a drawn placeholder poster is shown',
        'help.slots.posterSet': 'Poster image supplied',
        'help.slots.support': 'Support destinations',
        'help.slots.notConnected': 'Not connected in this demo',
        'help.slots.connected': 'Connected',

        'help.print.title': 'Statement of record',
        'help.print.customer': 'Customer',
        'help.print.account': 'Account',
        'help.print.wallet': 'Wallet',
        'help.print.masked': 'Identifiers are masked.',
        'help.print.asset': 'Asset',
        'help.print.summary': 'Balance summary',
        'help.print.colItem': 'Item',
        'help.print.colCount': 'Transactions',
        'help.print.colAmount': 'Amount',
        'help.print.colBalance': 'Balance after',
        'help.print.colDesc': 'Description and counterparty',
        'help.print.colType': 'Type',
        'help.print.colRef': 'Reference',
        'help.print.colStatus': 'Status',
        'help.print.colFee': 'Fee',
        'help.print.colFeeFor': 'Charged for',
        'help.print.unit': 'Amounts are in {symbol} token units.',
        'help.print.net': 'Net change {net} across {count}.',
        'help.print.ledger': 'Posted transactions',
        'help.print.ledgerNote': '{count} in chronological order by posted date. Times in {tz}.',
        'help.print.prevPeriod': 'Previous period',
        'help.print.feeFor': 'Fee for {ref}',
        'help.print.pending': 'Not included in the statement balance',
        'help.print.pendingNote': 'Not posted by the statement cut-off ({date}). These amounts are not included in any balance or total in this statement.',
        'help.print.fees': 'Fees summary',
        'help.print.feesTotal': 'Total fees ({count})',
        'help.print.noForeignFees': 'Fees in other assets: none. Each fee is its own ledger line and is included in the balance summary.',
        'help.print.foreignFees': 'Fees in other assets are listed separately and are not included in this balance.',
        'help.print.issuer': 'Issuer or partner: {value}',
        'help.print.snapshot': 'This statement is a period snapshot. An issued statement is never changed; corrections are issued as a new version.',
        'help.print.pageOf': 'Page {page} of {pages}'
      },
      es: {
        'help.title': 'Ayuda y registro del estado de cuenta',
        'help.lede': 'Obtén ayuda con este estado de cuenta, comprueba cómo se verificaron sus cifras e imprime o descarga el registro. Todo en esta página funciona sin conexión.',
        'help.toc.label': 'En esta página',

        'help.sec.contact': 'Contactar con soporte',
        'help.sec.feedback': 'Tu opinión',
        'help.sec.record': 'Registro del estado de cuenta',
        'help.sec.integrity': 'Integridad del estado de cuenta',
        'help.sec.accessibility': 'Accesibilidad',
        'help.sec.about': 'Acerca de esta demostración',

        'help.q.title': '¿Tienes una pregunta sobre un movimiento?',
        'help.q.body': 'Abre el movimiento en Movimientos y elige «Preguntar por este movimiento». Su referencia se incluye en la consulta automáticamente.',
        'help.q.go': 'Ir a Movimientos',
        'help.q.draft': 'Tienes una consulta de demostración sin terminar sobre «{tx}». Continúa donde la dejaste.',
        'help.q.resume': 'Continuar tu consulta de demostración',
        'help.q.submitted': 'Consulta de demostración {ref} completada. Solo demostración: no se envió ninguna consulta.',
        'help.q.viewTx': 'Ver el movimiento',
        'help.ask.title': 'Pregunta a YES',
        'help.ask.body': 'Obtén una explicación breve de tu saldo, de un movimiento o de una comisión. En esta demostración, las respuestas son explicaciones de demostración preparadas a partir de este estado de cuenta, no un servicio de IA en vivo.',

        'help.contact.tag': 'Destinos provisionales',
        'help.contact.lede': 'Cómo te pondrías en contacto con YES sobre este estado de cuenta.',
        'help.contact.notConnected': 'Estos destinos de soporte son marcadores de posición y no están conectados en esta demostración. Desde este archivo no puedes llamar, escribir ni chatear con nadie, y nada de lo que hagas aquí llega a un equipo de soporte.',
        'help.contact.phone': 'Teléfono',
        'help.contact.email': 'Correo electrónico',
        'help.contact.hours': 'Horario',
        'help.contact.chat': 'Chat',
        'help.contact.chatOff': 'No disponible en esta demostración',
        'help.contact.chatOn': 'Disponible en horario de soporte',
        'help.contact.copy.phone': 'Copiar el número de teléfono provisional',
        'help.contact.copy.email': 'Copiar la dirección de correo electrónico provisional',

        'help.route.title': '¿Consulta, disputa o denuncia de fraude?',
        'help.route.lede': 'Son vías distintas, con reglas y plazos diferentes.',
        'help.route.inquiry.title': 'Consulta sobre un movimiento',
        'help.route.inquiry.body': 'Haz una pregunta sobre un movimiento a partir de sus detalles. En esta demostración la consulta es una simulación local: no se envía nada y no se crea ningún caso.',
        'help.route.inquiry.state': 'Demostración: simulación local',
        'help.route.dispute.title': 'Disputa formal',
        'help.route.dispute.body': '[Aquí aparecerán la política de disputas aprobada, los requisitos y los plazos de respuesta (marcador de posición).]',
        'help.route.fraud.title': 'Fraude o actividad no autorizada',
        'help.route.fraud.body': '[Aquí aparecerán la vía aprobada para denunciar fraudes, los pasos urgentes y los plazos de respuesta (marcador de posición).]',
        'help.route.unavailable': 'No disponible en esta demostración',
        'help.route.note': 'Una consulta no es una disputa formal ni una denuncia de fraude. Las vías formales necesitan textos de política y plazos aprobados por YES antes de poder ofrecerse.',

        'help.fb.lede': 'Una pregunta rápida nos ayuda a que los estados de cuenta sean más fáciles de entender.',
        'help.fb.question': '¿Qué tan claro fue este estado de cuenta?',
        'help.fb.rating.very_clear': 'Muy claro',
        'help.fb.rating.mostly_clear': 'Bastante claro',
        'help.fb.rating.little_confusing': 'Un poco confuso',
        'help.fb.rating.confusing': 'Confuso',
        'help.fb.error': 'Elige qué tan claro fue el estado de cuenta para guardar tu opinión.',
        'help.fb.comment': '¿Hay algo que podamos explicar mejor?',
        'help.fb.commentHint': 'No incluyas datos personales ni de tu cuenta.',
        'help.fb.demoNote': 'Solo demostración: tu opinión se guarda solo en esta sesión del navegador y no se envía.',
        'help.fb.submit': 'Guardar opinión',
        'help.fb.doneTitle': 'Gracias. Tu opinión se ha guardado en esta sesión del navegador.',
        'help.fb.doneBody': 'Solo demostración: tu opinión no se envió. Se guarda solo en esta sesión del navegador y se borra al recargar o cerrar la página.',
        'help.fb.announce': 'Opinión guardada solo en esta sesión del navegador. Solo demostración: no se envió nada.',
        'help.fb.yourAnswer': 'Tu respuesta',
        'help.fb.yourComment': 'Tu comentario',
        'help.fb.noComment': 'Sin comentario',
        'help.fb.edit': 'Cambiar mi respuesta',

        'help.issue.original': 'Original',
        'help.issue.corrected': 'Corregido (nueva versión)',
        'help.rec.tag': 'Instantánea del período',
        'help.rec.lede': 'Los datos que identifican este estado de cuenta oficial.',
        'help.rec.id': 'ID del estado de cuenta',
        'help.rec.version': 'Versión',
        'help.rec.issue': 'Estado de emisión',
        'help.rec.period': 'Período del estado de cuenta',
        'help.rec.generated': 'Generado',
        'help.rec.asOf': 'Estado de cuenta al',
        'help.rec.timezone': 'Zona horaria',
        'help.rec.basis': 'Base de fechas',
        'help.rec.snapshot': 'Esta es una instantánea del período; un estado de cuenta emitido nunca se modifica: las correcciones se emiten como una nueva versión.',
        'help.rec.live': 'No muestra saldos en vivo ni el estado actual de los movimientos. En producción, la información en vivo aparecería en un área separada y con fecha y hora.',
        'help.rec.csv': 'Descargar CSV — registro completo',
        'help.rec.printHint': 'El estado de cuenta impreso incluye todos los movimientos registrados, el resumen del saldo, los pendientes y las comisiones, con una marca de agua de demostración en cada página. El archivo CSV se crea en este dispositivo; no se envía nada.',
        'help.rec.retention': 'La conservación, el archivo y la gestión de correcciones se definen con YES e InfoSlips antes del uso real.',

        'help.int.summary': '{n} de {total} controles superados',
        'help.int.listLabel': 'Controles de publicación: {summary}',
        'help.int.lede': 'Antes de publicarse, unos controles automáticos confirman que cada total de este estado de cuenta cuadra con sus movimientos. Un estado de cuenta que no supera algún control queda retenido.',
        'help.int.eqTitle': 'Ecuación del saldo',
        'help.int.equals': 'es igual al',
        'help.int.unit': 'Importes exactos en unidades de token {symbol}, a partir de los movimientos registrados.',
        'help.int.previewTitle': '¿Y si los totales no cuadraran?',
        'help.int.previewBody': 'Un estado de cuenta que no cuadra se retiene y se envía para su corrección; nunca se arregla visualmente con redondeos ni animaciones. La vista previa cambia un importe en {amount} en una copia de los datos de demostración para que veas el estado retenido.',
        'help.int.preview': 'Ver el estado de excepción',

        'help.a11y.tag': 'Objetivo: WCAG 2.2 AA',
        'help.a11y.lede': 'Este estado de cuenta está diseñado para cumplir el nivel AA de WCAG 2.2. Estas funciones vienen incluidas y funcionan sin complementos:',
        'help.a11y.f.keyboard': 'Teclado',
        'help.a11y.f.keyboard.body': 'Todos los controles funcionan con el teclado. Escape cierra los diálogos y el asistente.',
        'help.a11y.f.screenReader': 'Lectores de pantalla',
        'help.a11y.f.screenReader.body': 'Los encabezados, las regiones y las etiquetas describen la página. Los resultados y las confirmaciones se anuncian.',
        'help.a11y.f.focus': 'Foco visible',
        'help.a11y.f.focus.body': 'Un contorno claro muestra dónde estás mientras recorres la página.',
        'help.a11y.f.motion': 'Movimiento reducido',
        'help.a11y.f.motion.body': 'Las animaciones son breves y opcionales, y se desactivan cuando tu dispositivo pide menos movimiento.',
        'help.a11y.f.zoom': 'Zoom y adaptación',
        'help.a11y.f.zoom.body': 'Puedes ampliar el texto, y el diseño se adapta hasta 320 píxeles de ancho sin desplazamiento lateral.',
        'help.a11y.f.textAlt': 'Alternativas de texto para gráficos',
        'help.a11y.f.textAlt.body': 'Cada gráfico tiene una tabla o un texto equivalente con las mismas cifras.',
        'help.a11y.f.color': 'Nunca solo el color',
        'help.a11y.f.color.body': 'La dirección y el estado se muestran con signos, iconos y palabras, no solo con colores.',
        'help.a11y.f.languages': 'Dos idiomas',
        'help.a11y.f.languages.body': 'Incluye inglés y español, y al cambiar de idioma no pierdes tu lugar.',
        'help.a11y.review': 'Antes de producción se requiere una revisión formal de WCAG 2.2 AA y la aprobación de la integración de UserWay.',
        'help.uw.title': 'Widget de accesibilidad UserWay',
        'help.uw.account': 'ID de cuenta',
        'help.uw.loading': 'Cómo se carga',
        'help.uw.loadingValue': 'Solo con conexión y una sola vez. Si tu visor ya ofrece UserWay, no se añade un segundo botón.',
        'help.uw.augments': 'El widget añade herramientas opcionales de visualización y lectura. Complementa, no sustituye, la base accesible de este estado de cuenta.',
        'help.uw.status.idle': 'Aún no solicitado',
        'help.uw.status.loading': 'Cargando',
        'help.uw.status.loaded': 'Cargado',
        'help.uw.status.unavailable': 'No disponible sin conexión',
        'help.uw.status.host': 'Proporcionado por el visor',
        'help.uw.status.disabled': 'Desactivado',
        'help.uw.msg.idle': 'El widget se solicita cuando el estado de cuenta está listo.',
        'help.uw.msg.loading': 'Intentando cargar el widget. El estado de cuenta ya funciona sin él.',
        'help.uw.msg.loaded': 'El widget está disponible. Busca su botón en la página.',
        'help.uw.msg.unavailable': 'El widget no está disponible: puede que no tengas conexión o que esté bloqueado. Todo sigue funcionando sin él.',
        'help.uw.msg.host': 'Tu visor ya ofrece UserWay, así que este estado de cuenta no añade un segundo botón.',
        'help.uw.msg.disabled': 'El widget está desactivado en la configuración de este archivo. Todo sigue funcionando sin él.',

        'help.about.lede': 'Este es un único archivo autónomo con datos ilustrativos de demostración. El estado de cuenta, la navegación, los gráficos, las explicaciones, el cambio de idioma, la búsqueda, los filtros y la consulta de demostración funcionan sin conexión. Las mejoras conectadas aparecen con su estado en este archivo.',
        'help.about.caption': 'Mejoras conectadas',
        'help.about.colName': 'Mejora',
        'help.about.colFile': 'En este archivo',
        'help.about.colProd': 'En producción',
        'help.about.tag.online': 'Solo con conexión',
        'help.about.tag.local': 'Demostración local',
        'help.about.tag.mock': 'Simulación local',
        'help.about.tag.placeholder': 'Marcador de posición',
        'help.about.tag.session': 'Solo en la sesión',
        'help.about.tag.none': 'Ninguna',
        'help.about.tag.illustrative': 'Solo ilustrativo',
        'help.about.tag.notConnected': 'No conectado',
        'help.about.e.userway': 'Widget de accesibilidad UserWay',
        'help.about.e.userway.file': 'Se carga una vez cuando tienes conexión, con el ID de cuenta {id}.',
        'help.about.e.userway.now': 'Estado actual: {status}.',
        'help.about.e.userway.prod': 'Una sola integración aprobada, de YES o del visor de InfoSlips; nunca dos botones.',
        'help.about.e.ai': 'Explicaciones con IA',
        'help.about.e.ai.file': 'Explicaciones de demostración preparadas a partir de este estado de cuenta y marcadas como «Explicación de demostración». No se usa ningún modelo de IA en vivo.',
        'help.about.e.ai.prod': 'Un servicio de IA aprobado y supervisado, basado en el estado de cuenta.',
        'help.about.e.inquiry': 'Consulta sobre un movimiento',
        'help.about.e.inquiry.file': 'Una simulación local completa. Su confirmación indica «Solo demostración: no se envió ninguna consulta».',
        'help.about.e.inquiry.prod': 'Gestión de casos segura y autenticada, con un número de caso real.',
        'help.about.e.video': 'Video personalizado',
        'help.about.e.video.file': 'Marcador de posición con imagen y guion. No se reproduce ni se genera ningún video.',
        'help.about.e.video.prod': 'Un video aprobado con subtítulos y transcripción.',
        'help.about.e.feedback': 'Opiniones',
        'help.about.e.feedback.file': 'Se guardan solo en esta sesión del navegador. No se envía nada.',
        'help.about.e.feedback.prod': 'Un servicio de opiniones aprobado.',
        'help.about.e.analytics': 'Analítica',
        'help.about.e.analytics.file': 'El propio estado de cuenta no mide ni envía nada.',
        'help.about.e.analytics.prod': 'Medición de uso aprobada y con datos mínimos.',
        'help.about.e.evidence': 'Pruebas de reservas y de blockchain',
        'help.about.e.evidence.file': 'Diseño ilustrativo: sin afirmaciones sobre reservas y sin verificación de blockchain en vivo.',
        'help.about.e.evidence.prod': 'Solo datos verificados, con fuente, fecha y entidad responsable.',
        'help.about.e.liveBalance': 'Saldo en vivo',
        'help.about.e.liveBalance.file': 'Este estado de cuenta es una instantánea del período; no se muestra ningún saldo en vivo.',
        'help.about.e.liveBalance.prod': 'Un área separada y con fecha y hora, aparte del estado de cuenta.',
        'help.slots.title': 'Espacios reemplazables de marca y textos legales',
        'help.slots.lede': 'YES reemplaza estos marcadores de posición por recursos y textos aprobados antes de producción. Valores actuales en este archivo:',
        'help.slots.colSlot': 'Espacio',
        'help.slots.colValue': 'Valor actual',
        'help.slots.logoText': 'Texto «{text}» en un recuadro provisional',
        'help.slots.logoSvg': 'Logotipo proporcionado',
        'help.slots.posterNone': 'Sin definir: se muestra una imagen provisional dibujada',
        'help.slots.posterSet': 'Imagen de portada proporcionada',
        'help.slots.support': 'Destinos de soporte',
        'help.slots.notConnected': 'No conectados en esta demostración',
        'help.slots.connected': 'Conectados',

        'help.print.title': 'Estado de cuenta oficial',
        'help.print.customer': 'Cliente',
        'help.print.account': 'Cuenta',
        'help.print.wallet': 'Monedero',
        'help.print.masked': 'Los identificadores están enmascarados.',
        'help.print.asset': 'Activo',
        'help.print.summary': 'Resumen del saldo',
        'help.print.colItem': 'Concepto',
        'help.print.colCount': 'Movimientos',
        'help.print.colAmount': 'Importe',
        'help.print.colBalance': 'Saldo después',
        'help.print.colDesc': 'Descripción y contraparte',
        'help.print.colType': 'Tipo',
        'help.print.colRef': 'Referencia',
        'help.print.colStatus': 'Estado',
        'help.print.colFee': 'Comisión',
        'help.print.colFeeFor': 'Cobrada por',
        'help.print.unit': 'Los importes están en unidades de token {symbol}.',
        'help.print.net': 'Cambio neto de {net} en {count}.',
        'help.print.ledger': 'Movimientos registrados',
        'help.print.ledgerNote': '{count} en orden cronológico por fecha de registro. Horas en {tz}.',
        'help.print.prevPeriod': 'Período anterior',
        'help.print.feeFor': 'Comisión de {ref}',
        'help.print.pending': 'No incluido en el saldo del estado de cuenta',
        'help.print.pendingNote': 'No registrado al cierre del estado de cuenta ({date}). Estos importes no se incluyen en ningún saldo ni total de este estado de cuenta.',
        'help.print.fees': 'Resumen de comisiones',
        'help.print.feesTotal': 'Total de comisiones ({count})',
        'help.print.noForeignFees': 'Comisiones en otros activos: ninguna. Cada comisión es una línea propia y está incluida en el resumen del saldo.',
        'help.print.foreignFees': 'Las comisiones en otros activos se muestran por separado y no se incluyen en este saldo.',
        'help.print.issuer': 'Emisor o socio: {value}',
        'help.print.snapshot': 'Este estado de cuenta es una instantánea del período. Un estado de cuenta emitido nunca se modifica; las correcciones se emiten como una nueva versión.',
        'help.print.pageOf': 'Página {page} de {pages}'
      }
    },

    init: function () {
      els.root = doc.getElementById('help-root');
      els.print = doc.getElementById('print-root');
      if (!els.root) return;
      inited = true;
      var r = els.root;

      ui.delegate(r, 'click', '[data-help-go]', function (e, a) {
        e.preventDefault();
        open(a.getAttribute('data-help-go'));
      });
      ui.delegate(r, 'click', '[data-help-copy]', function (e, b) {
        var sup = YES.config.support;
        var v = { phone: sup.phone, email: sup.email }[b.getAttribute('data-help-copy')];
        if (v) ui.copy(v);
      });
      ui.delegate(r, 'click', '[data-help-print]', function () {
        renderPrint();
        if (typeof root.print === 'function') root.print();
      });
      ui.delegate(r, 'click', '[data-help-csv]', function () {
        YES.explorer.exportCsv('all');
      });
      ui.delegate(r, 'click', '[data-help-ask]', function (e, b) {
        YES.assistant.open({ topic: 'general', trigger: b });
      });
      ui.delegate(r, 'click', '[data-help-resume]', function (e, b) {
        YES.inquiry.resume({ trigger: b });
      });
      ui.delegate(r, 'click', '[data-help-opentx]', function (e, b) {
        YES.explorer.openTx(b.getAttribute('data-help-opentx'), { trigger: b });
      });

      /* Feedback */
      ui.delegate(r, 'change', 'input[name="help-fb-rating"]', function (e, input) {
        var hadError = H().error;
        setH({ rating: input.value, error: false });
        if (hadError) renderFeedback();
      });
      ui.delegate(r, 'input', '#help-fb-comment', function (e, box) {
        setH({ comment: box.value });
      });
      ui.delegate(r, 'submit', '[data-help-fb]', function (e) {
        e.preventDefault();
        submitFeedback();
      });
      ui.delegate(r, 'click', '[data-help-fb-edit]', function () {
        var rec = savedFeedback();
        setH({ editing: true, error: false, rating: rec ? rec.rating : '', comment: rec ? rec.comment : '' });
        renderFeedback();
        var target = els.root.querySelector('input[name="help-fb-rating"]:checked') || els.root.querySelector('input[name="help-fb-rating"]');
        if (target) target.focus();
      });
      ui.delegate(r, 'click', '[data-help-fb-cancel]', function () {
        setH({ editing: false, error: false });
        renderFeedback();
        ui.focusKey('help-fb-edit');
      });

      YES.on('route', onRoute);
      YES.on('userway', renderUserway);
      root.addEventListener('beforeprint', renderPrint);

      this.render();
    },

    render: render,

    onState: function (keys) {
      if (!inited) return;
      if (keys.indexOf('inquiry') !== -1) renderQuickTx();
      if (keys.indexOf('feedback') !== -1) renderFeedback();
    }
  });
})(window);
