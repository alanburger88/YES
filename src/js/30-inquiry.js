/*
 * Transaction inquiry — a complete LOCAL mock (PRD 5.4, 9 "Inquiry").
 *
 * Four steps in the #inquiry-dialog: (1) the transaction carried in, (2) reason
 * (only the reasons that fit that transaction: see reasonsFor), optional
 * description and preferred reply channel, (3) review, (4) a
 * confirmation that says "Demo only — no inquiry was sent" with a clearly
 * fictional local reference. Nothing is sent, nothing is stored outside
 * YES.state, and no contact details are ever requested.
 *
 * State (YES.state.inquiry) — survives closing the dialog and language switches:
 *   { txId, step: 'transaction'|'details'|'review'|'done', reason, description,
 *     channel, status: 'draft'|'submitted', ref, attempt, seq,
 *     errors: null|{ field: code }, notice: null|'resumed'|'duplicate',
 *     prior: null|<submitted record kept while a new demo inquiry is untouched>,
 *     others: { txId: record } }   ← inquiries parked for other transactions
 * The top-level fields describe the active inquiry; `others` keeps drafts and
 * completed demo inquiries for other transactions, so each one survives.
 */
(function (root) {
  'use strict';
  var YES = root.YES;
  var ui = YES.ui;
  var t = YES.t;
  var esc = ui.esc;
  var doc = root.document;

  var STEPS = ['transaction', 'details', 'review', 'done'];
  /* Every reason the form knows, in display order; reasonsFor(tx) offers the ones that fit. */
  var REASONS = ['unrecognized', 'amount', 'pending', 'fee', 'other'];
  var CHANNELS = ['in_app', 'email', 'phone'];
  var CHANNEL_ICONS = { in_app: 'chat', email: 'mail', phone: 'phone' };
  var FIELDS = ['reason', 'description', 'channel']; // form order (error summary order)
  var MAX = 500;
  var SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
  var REF_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // no 0/O or 1/I look-alikes
  /* Digits written together, or in groups of 3+ split by one space or hyphen (see looksSensitive). */
  var DIGIT_RUN = /\d{3,}(?:[  -]\d{3,})*/g;

  var els = { dlg: null, shell: null, live: null, liveA: null };
  /* DOM references cannot live in state: the control focus returns to, and the
     control that opened the transaction detail ("Back to transaction" target). */
  var ctx = { trigger: null, origin: null };
  var timers = {};
  var seqCounter = 0;
  var selfWrite = false;
  var revealing = false; // focusField scrolls the field itself; the focusin reveal stands aside

  /* ------------------------------------------------------------------ */
  /* State helpers                                                       */
  /* ------------------------------------------------------------------ */
  function assign(target) {
    for (var i = 1; i < arguments.length; i++) {
      var src = arguments[i];
      if (!src) continue;
      for (var k in src) if (Object.prototype.hasOwnProperty.call(src, k)) target[k] = src[k];
    }
    return target;
  }
  function raw() {
    var s = YES.state.inquiry;
    return s && typeof s === 'object' ? s : null;
  }
  function current() {
    var s = raw();
    return s && s.txId ? s : null;
  }
  function othersOf(s) {
    return s && s.others && typeof s.others === 'object' ? s.others : {};
  }
  function blank(txId, attempt) {
    return { txId: txId, step: 'transaction', reason: '', description: '', channel: '', status: 'draft', ref: null, attempt: attempt || 1, seq: 0, errors: null, notice: null, prior: null };
  }
  /** Tolerate partial or foreign shapes (e.g. { txId, step: 2, status }) without breaking. */
  function normalize(rec) {
    var r = assign(blank(rec.txId), rec);
    r.status = r.status === 'submitted' ? 'submitted' : 'draft';
    if (STEPS.indexOf(r.step) === -1) r.step = r.status === 'submitted' ? 'done' : 'transaction';
    if (r.status === 'submitted') r.step = 'done';
    else if (r.step === 'done') r.step = 'review';
    // A saved reason this transaction no longer offers (e.g. "pending" once it has posted) is dropped.
    if (reasonsFor(YES.calc.tx(r.txId)).indexOf(r.reason) === -1) r.reason = '';
    if (CHANNELS.indexOf(r.channel) === -1) r.channel = '';
    r.description = typeof r.description === 'string' ? r.description.slice(0, MAX) : '';
    r.attempt = r.attempt > 0 ? Math.floor(r.attempt) : 1;
    if (r.status === 'submitted' && !r.ref) r.ref = makeRef(r.txId, r.attempt);
    if (!r.errors || typeof r.errors !== 'object') r.errors = null;
    // Never review answers that would not pass: back to the form to complete them.
    if (r.step === 'review' && validate(r)) r.step = 'details';
    return r;
  }
  /** The persistable part of one inquiry (transient UI flags dropped). */
  function clean(rec) {
    return {
      txId: rec.txId,
      step: rec.step,
      reason: rec.reason || '',
      description: rec.description || '',
      channel: rec.channel || '',
      status: rec.status,
      ref: rec.ref || null,
      attempt: rec.attempt || 1,
      seq: rec.seq || 0
    };
  }
  /** Worth keeping: the customer moved on or entered something, or it was submitted. */
  function touched(rec) {
    return !!rec && (rec.status === 'submitted' || (rec.step && rec.step !== 'transaction') || !!rec.reason || !!rec.channel || !!(rec.description && rec.description.trim()));
  }
  function write(active, others) {
    var next = null;
    var o = others || {};
    if (active) next = assign({}, active, { others: o });
    else if (Object.keys(o).length) next = { txId: null, others: o };
    selfWrite = true;
    try {
      YES.set({ inquiry: next });
    } finally {
      selfWrite = false;
    }
  }
  function update(patch) {
    var s = current();
    if (!s) return null;
    var next = assign({}, s, patch, { seq: ++seqCounter });
    delete next.others;
    write(next, othersOf(s));
    return next;
  }
  /** Make txId the active inquiry, parking the previous one (if worth keeping). */
  function activate(txId) {
    var s = raw();
    var others = assign({}, othersOf(s));
    var cur = current();
    var rec;
    if (cur && cur.txId === txId) {
      rec = assign({}, cur);
      delete rec.others;
    } else {
      if (cur && touched(cur)) others[cur.txId] = clean(normalize(cur));
      else if (cur && cur.prior) others[cur.txId] = cur.prior; // unused new inquiry: keep the completed one
      rec = others[txId] ? assign({}, others[txId]) : blank(txId);
    }
    delete others[txId];
    return { rec: normalize(rec), others: others };
  }

  /** Deterministic, clearly fictional reference from the transaction id (+ attempt). */
  function makeRef(txId, attempt) {
    var h = 2166136261;
    var str = String(txId);
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    var code = '';
    for (var j = 0; j < 4; j++) {
      code += REF_ALPHABET.charAt(h % 32);
      h = Math.floor(h / 32);
    }
    return 'DEMO-INQ-' + code + (attempt > 1 ? '-' + attempt : '');
  }

  /* ------------------------------------------------------------------ */
  /* Reasons and validation                                              */
  /* ------------------------------------------------------------------ */
  function hasFee(tx) {
    return tx.type === 'fee' || !!(tx.fees && tx.fees.length) || YES.calc.feesFor(tx.id).length > 0;
  }
  /**
   * The reasons that make sense for this transaction: "It's still pending" only
   * while it is pending, "a question about a fee" only for a fee line or a
   * transaction with linked fees. The others always apply.
   */
  function reasonsFor(tx) {
    if (!tx) return REASONS.slice();
    return REASONS.filter(function (id) {
      if (id === 'pending') return tx.status === 'pending';
      if (id === 'fee') return hasFee(tx);
      return true;
    });
  }
  function reasonsOf(s) {
    return reasonsFor(s && s.txId ? YES.calc.tx(s.txId) : null);
  }

  /** Luhn checksum: every real payment-card number passes it. */
  function luhn(digits) {
    var sum = 0;
    var dbl = false;
    for (var i = digits.length - 1; i >= 0; i--) {
      var n = digits.charCodeAt(i) - 48;
      if (dbl) n = n * 2 > 9 ? n * 2 - 9 : n * 2;
      sum += n;
      dbl = !dbl;
    }
    return sum % 10 === 0;
  }
  /** Identifiers the statement itself shows (ids, references, network hashes): quoting them is fine. */
  function ownIdentifiers() {
    var d = YES.data || {};
    var st = d.statement || {};
    var ids = [st.id, st.account && st.account.walletMasked];
    (d.transactions || []).forEach(function (tx) {
      ids.push(tx.id, tx.reference);
      if (tx.onchain) ids.push(tx.onchain.hash, tx.onchain.hashDisplay);
    });
    return ids
      .filter(function (v) {
        return typeof v === 'string' && v.length > 3;
      })
      .map(function (v) {
        return v.toLowerCase();
      });
  }
  /**
   * Is the character `ch` (with `beyond` on its far side) part of the same token
   * as an adjacent digit run? A letter or digit is; so is an id joiner ("-", "_")
   * with a letter or digit beyond it, or a decimal/thousands mark between digits.
   */
  function glued(ch, beyond) {
    return /[a-z0-9]/i.test(ch) || (/[-_]/.test(ch) && /[a-z0-9]/i.test(beyond)) || (/[.,]/.test(ch) && /\d/.test(beyond));
  }
  /**
   * Does the description contain what looks like a full card or account number?
   * Only a number that stands on its own counts: digits inside a longer token
   * (a hex hash "0x…", an id like "YES-STM-202609-000184", an amount) never do,
   * and the statement's own identifiers are ignored. It counts when it holds
   *   - 12 or more digits written together (an account or card number), or
   *   - card-style groups of 4–6 digits ("4111 1111 1111 1111", "3782 822463
   *     10005") totalling 13–19 digits that pass the Luhn check — also when
   *     more digits follow, such as a security code.
   */
  function looksSensitive(text) {
    var s = String(text || '').toLowerCase();
    if (!/\d{3}/.test(s)) return false;
    ownIdentifiers().forEach(function (id) {
      if (s.indexOf(id) !== -1) s = s.split(id).join(' ');
    });
    DIGIT_RUN.lastIndex = 0;
    var m;
    while ((m = DIGIT_RUN.exec(s))) {
      var start = m.index;
      var end = start + m[0].length;
      if (glued(s.charAt(start - 1), s.charAt(start - 2)) || glued(s.charAt(end), s.charAt(end + 1))) continue;
      var groups = m[0].split(/[  -]/);
      for (var i = 0; i < groups.length; i++) {
        if (groups[i].length >= 12) return true;
        var acc = '';
        for (var j = i; j < groups.length && groups[j].length >= 4 && groups[j].length <= 6 && acc.length < 19; j++) {
          acc += groups[j];
          if (j > i && acc.length >= 13 && acc.length <= 19 && luhn(acc)) return true;
        }
      }
    }
    return false;
  }
  function validate(s) {
    var e = {};
    if (reasonsOf(s).indexOf(s.reason) === -1) e.reason = 'required';
    if (looksSensitive(s.description)) e.description = 'sensitive';
    if (CHANNELS.indexOf(s.channel) === -1) e.channel = 'required';
    return Object.keys(e).length ? e : null;
  }
  function without(errors, field) {
    var e = assign({}, errors);
    delete e[field];
    return Object.keys(e).length ? e : null;
  }

  /* ------------------------------------------------------------------ */
  /* DOM helpers                                                         */
  /* ------------------------------------------------------------------ */
  function cssEsc(v) {
    return root.CSS && root.CSS.escape ? root.CSS.escape(v) : String(v).replace(/["\\]/g, '\\$&');
  }
  /** A live element for a remembered control (re-rendered controls are found again by data-fk). */
  function resolve(el) {
    if (!el) return null;
    if (el.isConnected) return el;
    var fk = el.getAttribute && el.getAttribute('data-fk');
    return fk ? doc.querySelector('[data-fk="' + cssEsc(fk) + '"]') : null;
  }
  function visible(el) {
    return !!(el && el.isConnected && (el.offsetParent !== null || el.getClientRects().length));
  }
  function q(sel) {
    return els.shell ? els.shell.querySelector(sel) : null;
  }
  /**
   * Empty every live region in the dialog (ours, and any the shared ui.announce
   * added) and drop queued messages, so screen-reader browse mode never finds a
   * message from an earlier step, transaction or language.
   */
  function clearLive() {
    clearTimeout(timers.say);
    clearTimeout(timers.sayA);
    clearTimeout(timers.count);
    if (!els.dlg) return;
    ui.$$(':scope > [aria-live]', els.dlg).forEach(function (r) {
      r.textContent = '';
    });
  }
  /** Announce inside the open dialog (content outside a modal dialog is inert); otherwise via the shared regions. */
  function say(msg, assertive) {
    var region = assertive ? els.liveA : els.live;
    if (region && els.dlg && els.dlg.open) {
      region.textContent = '';
      clearTimeout(timers[assertive ? 'sayA' : 'say']);
      timers[assertive ? 'sayA' : 'say'] = setTimeout(function () {
        region.textContent = msg;
      }, 80);
      return;
    }
    ui.announce(msg, assertive);
  }

  function dateTime(iso) {
    return YES.fmt.date(iso, 'datetime');
  }
  function stepNo(step) {
    return STEPS.indexOf(step) + 1;
  }

  /* ------------------------------------------------------------------ */
  /* Rendering                                                           */
  /* ------------------------------------------------------------------ */
  function headHtml(s) {
    var idx = STEPS.indexOf(s.step);
    var done = s.step === 'done';
    var steps = STEPS.map(function (id, i) {
      return (
        '<li' +
        (i < idx ? ' class="is-done"' : '') +
        (i === idx ? ' aria-current="step"' : '') +
        ' data-inq-stepitem="' +
        id +
        '"><span class="inq-steps__label">' +
        esc(t('inquiry.step.' + id)) +
        (i < idx ? '<span class="sr-only">' + esc(t('inquiry.step.completed')) + '</span>' : '') +
        '</span></li>'
      );
    }).join('');
    return (
      '<div class="dlg__head inq-head">' +
      '<div class="inq-head__bar">' +
      '<button type="button" class="btn btn--ghost inq-head__back" data-inq-backtx data-fk="inq-backtx">' +
      ui.icon('arrow-left', { size: 18 }) +
      '<span>' +
      esc(t('inquiry.backToTx')) +
      '</span></button>' +
      '<button type="button" class="btn btn--icon btn--ghost inq-head__close" data-inq-close data-fk="inq-close" aria-label="' +
      esc(t(done ? 'inquiry.closeDone' : 'inquiry.closeDraft')) +
      '">' +
      ui.icon('close', { size: 20 }) +
      '</button>' +
      '</div>' +
      '<div class="inq-head__titlebar">' +
      '<h2 id="inquiry-dialog-title" class="dlg__title inq-head__title" tabindex="-1" data-fk="inq-title">' +
      esc(t(done ? 'inquiry.doneTitle' : 'inquiry.title')) +
      '</h2>' +
      (done ? '' : ui.illustrativeTag('inquiry.demoTag')) +
      '</div>' +
      '<ol class="steps inq-steps" aria-label="' +
      esc(t('inquiry.progress')) +
      '">' +
      steps +
      '</ol>' +
      '</div>'
    );
  }

  function stepHeading(s, key) {
    return (
      '<h3 class="inq-step__title" tabindex="-1" data-inq-heading data-fk="inq-h-' +
      esc(s.step) +
      '"><span class="inq-step__count">' +
      esc(t('inquiry.step.count', { n: YES.fmt.count(stepNo(s.step)), total: YES.fmt.count(STEPS.length) })) +
      '</span><span class="sr-only">: </span><span class="inq-step__text">' +
      esc(t(key)) +
      '</span></h3>'
    );
  }

  function kvRow(labelText, valueHtml, cls) {
    return '<dt>' + esc(labelText) + '</dt><dd' + (cls ? ' class="' + cls + '"' : '') + '>' + valueHtml + '</dd>';
  }

  function dirClass(tx) {
    return tx.amount < 0 ? 'out' : tx.amount > 0 ? 'in' : 'neutral';
  }

  /** The transaction carried into the inquiry: label, counterparty, date, signed amount, reference. */
  function txCardHtml(tx) {
    var pending = !YES.calc.inBalance(tx);
    var rows = kvRow(t('inquiry.tx.counterparty'), esc(YES.L(tx.counterparty)));
    if (tx.postedAt) {
      rows += kvRow(t('term.postedDate'), esc(dateTime(tx.postedAt)));
    } else {
      rows += kvRow(t('term.postedDate'), '<span class="inq-muted">' + esc(t('inquiry.tx.notPosted')) + '</span>');
      rows += kvRow(t('term.initiatedDate'), esc(dateTime(tx.initiatedAt)));
    }
    rows += kvRow(
      t('inquiry.tx.status'),
      '<span class="inq-status">' +
        ui.statusHtml(tx.status) +
        (pending ? '<span class="inq-notin">' + ui.icon('clock', { size: 14 }) + '<span>' + esc(t('status.notInBalance')) + '</span></span>' : '') +
        '</span>'
    );
    var fees = YES.calc.feesFor(tx.id);
    if (fees.length) {
      var feeSum = fees.reduce(function (a, f) {
        return a + f.amount;
      }, 0);
      rows += kvRow(t('inquiry.tx.fee'), ui.amountHtml(feeSum));
    }
    if (tx.parentId) {
      var parent = YES.calc.tx(tx.parentId);
      if (parent) rows += kvRow(t('inquiry.tx.feeFor'), esc(YES.L(parent.description)));
    }
    rows += kvRow(t('inquiry.tx.reference'), '<span class="mono" data-inq-txref>' + esc(tx.reference || '') + '</span>');
    rows += kvRow(t('inquiry.tx.id'), '<span class="mono">' + esc(tx.id) + '</span>');
    return (
      '<div class="inq-tx' +
      (pending ? ' inq-tx--pending' : '') +
      '" role="group" aria-labelledby="inq-tx-name" data-inq-tx="' +
      esc(tx.id) +
      '">' +
      '<div class="inq-tx__top">' +
      '<span class="dir dir--' +
      dirClass(tx) +
      '">' +
      ui.icon(ui.typeIcon(tx.type), { size: 18 }) +
      '</span>' +
      '<div class="inq-tx__name" id="inq-tx-name"><span class="inq-tx__type">' +
      esc(ui.typeLabel(tx.type)) +
      '<span class="sr-only">: </span></span><span class="inq-tx__desc">' +
      esc(YES.L(tx.description)) +
      '</span></div>' +
      '<p class="inq-tx__amount">' +
      ui.amountHtml(tx.amount) +
      '</p>' +
      '</div>' +
      '<dl class="kv inq-kv">' +
      rows +
      '</dl>' +
      '<p class="inq-tz">' +
      esc(t('term.timezone', { tz: YES.fmt.tz(tx.postedAt || tx.initiatedAt) })) +
      '</p>' +
      '</div>'
    );
  }

  function keepNoteHtml() {
    return '<p class="inq-keep">' + ui.icon('lock', { size: 16 }) + '<span>' + esc(t('inquiry.keep')) + '</span></p>';
  }

  function noticeHtml(s) {
    if (s.notice === 'resumed' && s.status !== 'submitted') {
      return (
        '<div class="notice notice--info inq-flash" data-inq-notice="resumed">' +
        ui.icon('clock', { size: 20 }) +
        '<div><p>' +
        esc(t('inquiry.resumed.body')) +
        '</p><p><button type="button" class="btn btn--link inq-linkbtn" data-inq-discard data-fk="inq-discard">' +
        esc(t('inquiry.resumed.discard')) +
        '</button></p></div></div>'
      );
    }
    return '';
  }

  function txStepHtml(s, tx) {
    return (
      noticeHtml(s) +
      stepHeading(s, 'inquiry.tx.heading') +
      '<p class="inq-lede">' +
      esc(t('inquiry.tx.lede')) +
      '</p>' +
      txCardHtml(tx) +
      '<div class="notice notice--info inq-note">' +
      ui.icon('info', { size: 20 }) +
      '<p>' +
      esc(t('inquiry.tx.notDispute')) +
      '</p></div>' +
      keepNoteHtml()
    );
  }

  /* ----------------------------- Details ---------------------------- */
  /* One message per field (state errors hold 'required' for the radio groups, 'sensitive' for the description). */
  function errorHtml(field) {
    var key = 'inquiry.err.' + field;
    return (
      '<p class="field__error inq-error" id="inq-' +
      field +
      '-error">' +
      ui.icon('alert', { size: 18 }) +
      '<span><span class="sr-only">' +
      esc(t('inquiry.err.prefix')) +
      ' </span>' +
      esc(t(key)) +
      '</span></p>'
    );
  }
  function firstInputId(field, s) {
    if (field === 'description') return 'inq-desc';
    var list = field === 'reason' ? reasonsOf(s) : CHANNELS;
    var v = s && s[field];
    return 'inq-' + field + '-' + (list.indexOf(v) !== -1 ? v : list[0]);
  }
  /*
   * The error summary is announced once, by moving focus to it (showErrors): a
   * named group whose description is the list of problems. It is deliberately
   * not role="alert" and nothing else is announced, so a screen reader hears it
   * once instead of an alert, the focused summary and a live-region message
   * talking over each other.
   */
  function summaryHtml(e, s) {
    var fields = FIELDS.filter(function (f) {
      return e && e[f];
    });
    if (!fields.length) return '';
    return (
      '<div class="inq-errors" role="group" tabindex="-1" data-fk="inq-errors" aria-labelledby="inq-errors-title" aria-describedby="inq-errors-list">' +
      ui.icon('alert', { size: 22 }) +
      '<div class="inq-errors__body"><h3 id="inq-errors-title" class="inq-errors__title">' +
      esc(t('inquiry.err.title')) +
      '</h3><ul class="inq-errors__list" id="inq-errors-list">' +
      fields
        .map(function (f) {
          return (
            '<li data-inq-err="' +
            f +
            '"><a href="#' +
            firstInputId(f, s) +
            '" data-inq-errlink="' +
            f +
            '" data-fk="inq-errlink-' +
            f +
            '">' +
            esc(t('inquiry.err.' + f)) +
            '</a></li>'
          );
        })
        .join('') +
      '</ul></div></div>'
    );
  }

  function groupDescribedBy(field, err) {
    var ids = [];
    if (err) ids.push('inq-' + field + '-error');
    if (field === 'channel') ids.push('inq-channel-hint');
    if (field === 'description') ids.push('inq-desc-hint', 'inq-desc-warn', 'inq-desc-count');
    return ids.join(' ');
  }

  function radioGroupHtml(field, options, s, e, o) {
    var err = e[field];
    var legendId = 'inq-' + field + '-legend';
    var describedBy = groupDescribedBy(field, err);
    var choices = options
      .map(function (id) {
        var inputId = 'inq-' + field + '-' + id;
        var hint = o.choiceHint ? t('inquiry.' + field + '.' + id + '.hint') : '';
        return (
          '<label class="choice inq-choice" data-inq-reveal for="' +
          inputId +
          '"><input type="radio" id="' +
          inputId +
          '" name="inq-' +
          field +
          '" value="' +
          id +
          '" data-inq-field="' +
          field +
          '" data-fk="' +
          inputId +
          '"' +
          (s[field] === id ? ' checked' : '') +
          (err ? ' aria-invalid="true"' : '') +
          '>' +
          (o.icons ? ui.icon(o.icons[id], { size: 18, cls: 'inq-choice__icon' }) : '') +
          '<span class="inq-choice__text"><span class="inq-choice__label">' +
          esc(t('inquiry.' + field + '.' + id)) +
          '</span>' +
          (hint ? '<span class="inq-choice__hint">' + esc(hint) + '</span>' : '') +
          '</span></label>'
        );
      })
      .join('');
    return (
      '<fieldset class="inq-field inq-group' +
      (err ? ' is-invalid' : '') +
      '" role="radiogroup" aria-labelledby="' +
      legendId +
      '" aria-required="true"' +
      (describedBy ? ' aria-describedby="' + describedBy + '"' : '') +
      (err ? ' aria-invalid="true"' : '') +
      ' data-inq-group="' +
      field +
      '">' +
      '<legend id="' +
      legendId +
      '" class="inq-legend">' +
      esc(t(o.legend)) +
      ' <span class="inq-req">' +
      esc(t('inquiry.required')) +
      '</span></legend>' +
      (o.hint ? '<p class="field__hint inq-hint" id="inq-' + field + '-hint">' + ui.icon('info', { size: 14 }) + '<span>' + esc(t(o.hint)) + '</span></p>' : '') +
      '<div data-inq-errslot="' +
      field +
      '">' +
      (err ? errorHtml(field) : '') +
      '</div>' +
      '<div class="choices inq-choices inq-choices--' +
      field +
      '">' +
      choices +
      '</div>' +
      '</fieldset>'
    );
  }

  function countText(len) {
    var left = MAX - len;
    if (left <= 0) return t('inquiry.description.limit', { max: YES.fmt.count(MAX) });
    if (left === 1) return t('inquiry.description.left1');
    return t('inquiry.description.left', { n: YES.fmt.count(left) });
  }

  function descriptionHtml(s, e) {
    var err = e.description;
    var len = (s.description || '').length;
    return (
      '<div class="field inq-field' +
      (err ? ' is-invalid' : '') +
      '" data-inq-group="description">' +
      '<label class="inq-legend" for="inq-desc">' +
      esc(t('inquiry.description.label')) +
      ' <span class="inq-opt">' +
      esc(t('inquiry.optional')) +
      '</span></label>' +
      '<p class="field__hint" id="inq-desc-hint">' +
      esc(t('inquiry.description.hint', { max: YES.fmt.count(MAX) })) +
      '</p>' +
      '<div class="notice notice--warn inq-warn" id="inq-desc-warn">' +
      ui.icon('shield', { size: 18 }) +
      '<p>' +
      esc(t('inquiry.description.warn')) +
      '</p></div>' +
      '<div data-inq-errslot="description">' +
      (err ? errorHtml('description') : '') +
      '</div>' +
      // The field and its counter scroll into view together when focused (revealFocused).
      '<div class="inq-descbox" data-inq-reveal>' +
      // A leading newline is dropped by the HTML parser, so a description that starts with one survives re-renders.
      '<textarea id="inq-desc" class="textarea inq-textarea" rows="4" maxlength="' +
      MAX +
      '" data-inq-desc data-fk="inq-desc" aria-describedby="' +
      groupDescribedBy('description', err) +
      '"' +
      (err ? ' aria-invalid="true"' : '') +
      ' autocomplete="off">\n' +
      esc(s.description || '') +
      '</textarea>' +
      '<p class="inq-count' +
      (MAX - len <= 50 ? ' is-low' : '') +
      '" id="inq-desc-count" data-inq-count>' +
      esc(countText(len)) +
      '</p>' +
      '</div>' +
      '</div>'
    );
  }

  function detailsStepHtml(s, tx) {
    var e = s.errors || {};
    return (
      '<div data-inq-summary>' +
      summaryHtml(e, s) +
      '</div>' +
      noticeHtml(s) +
      stepHeading(s, 'inquiry.details.heading') +
      '<div class="inq-form">' +
      radioGroupHtml('reason', reasonsFor(tx), s, e, { legend: 'inquiry.reason.legend' }) +
      descriptionHtml(s, e) +
      radioGroupHtml('channel', CHANNELS, s, e, { legend: 'inquiry.channel.legend', hint: 'inquiry.channel.hint', choiceHint: true, icons: CHANNEL_ICONS }) +
      '</div>' +
      keepNoteHtml()
    );
  }

  /* ----------------------------- Review ----------------------------- */
  function reviewRow(key, valueHtml, edit) {
    return (
      '<div class="inq-review__row" data-inq-reveal data-inq-row="' +
      edit +
      '"><dt>' +
      esc(t(key)) +
      '</dt><dd class="inq-review__value">' +
      valueHtml +
      '</dd><dd class="inq-review__action"><button type="button" class="btn btn--link inq-linkbtn" data-inq-edit="' +
      edit +
      '" data-fk="inq-edit-' +
      edit +
      '">' +
      esc(t('inquiry.review.change')) +
      '<span class="sr-only"> ' +
      esc(t(key)) +
      '</span></button></dd></div>'
    );
  }

  function txSummaryHtml(tx) {
    return (
      '<span class="inq-review__strong">' +
      esc(ui.typeLabel(tx.type)) +
      ' · ' +
      esc(YES.L(tx.description)) +
      '</span><span>' +
      ui.amountHtml(tx.amount) +
      '<span class="inq-sep" aria-hidden="true"> · </span><span class="sr-only">, </span>' +
      esc(tx.postedAt ? YES.fmt.date(tx.postedAt, 'medium') : t('inquiry.tx.notPosted')) +
      '</span><span class="mono">' +
      esc(tx.reference || tx.id) +
      '</span>'
    );
  }

  function answersHtml(s, tx, withEdit) {
    var desc = s.description && s.description.trim() ? '<span class="inq-quote">' + esc(s.description) + '</span>' : '<span class="inq-muted">' + esc(t('inquiry.review.none')) + '</span>';
    var reason = s.reason ? esc(t('inquiry.reason.' + s.reason)) : '';
    var channel = s.channel ? '<span class="inq-review__strong">' + esc(t('inquiry.channel.' + s.channel)) + '</span><span class="inq-muted">' + esc(t('inquiry.channel.' + s.channel + '.hint')) + '</span>' : '';
    if (withEdit) {
      return (
        '<dl class="inq-review">' +
        reviewRow('inquiry.review.tx', txSummaryHtml(tx), 'transaction') +
        reviewRow('inquiry.review.reason', reason, 'reason') +
        reviewRow('inquiry.review.description', desc, 'description') +
        reviewRow('inquiry.review.channel', channel, 'channel') +
        '</dl>'
      );
    }
    return (
      '<dl class="kv inq-kv inq-kv--done">' +
      kvRow(t('inquiry.review.tx'), '<span class="inq-stack">' + txSummaryHtml(tx) + '</span>') +
      kvRow(t('inquiry.review.reason'), reason) +
      kvRow(t('inquiry.review.description'), desc) +
      kvRow(t('inquiry.review.channel'), '<span class="inq-stack">' + channel + '</span>') +
      '</dl>'
    );
  }

  function reviewStepHtml(s, tx) {
    return (
      stepHeading(s, 'inquiry.review.heading') +
      '<div class="notice notice--illustrative inq-demo-note" data-inq-demo-note>' +
      ui.icon('info', { size: 20 }) +
      '<p><strong>' +
      esc(t('inquiry.review.demoStrong')) +
      '</strong> ' +
      esc(t('inquiry.review.demo')) +
      '</p></div>' +
      answersHtml(s, tx, true) +
      keepNoteHtml()
    );
  }

  /* --------------------------- Confirmation -------------------------- */
  function doneStepHtml(s, tx) {
    var dup = '';
    if (s.notice === 'duplicate') {
      dup =
        '<div class="notice notice--info inq-flash" data-inq-notice="duplicate">' +
        ui.icon('copy', { size: 20 }) +
        '<div><p><strong>' +
        esc(t('inquiry.dup.strong')) +
        '</strong> ' +
        esc(t('inquiry.dup.body')) +
        '</p><p><button type="button" class="btn" data-inq-new data-fk="inq-new">' +
        ui.icon('arrow-right', { size: 18 }) +
        '<span>' +
        esc(t('inquiry.dup.new')) +
        '</span></button></p></div></div>';
    }
    var prod = ['auth', 'case', 'dup', 'redact', 'reply']
      .map(function (k) {
        var icon = { auth: 'lock', case: 'clock', dup: 'copy', redact: 'shield', reply: 'chat' }[k];
        return '<li><span class="inq-prod__icon">' + ui.icon(icon, { size: 16 }) + '</span><span>' + esc(t('inquiry.done.prod.' + k)) + '</span></li>';
      })
      .join('');
    return (
      dup +
      '<div class="inq-receipt" role="group" aria-labelledby="inq-ref-label">' +
      '<span class="inq-receipt__icon">' +
      ui.icon('info', { size: 24 }) +
      '</span>' +
      '<div class="inq-receipt__main">' +
      '<p class="inq-receipt__label" id="inq-ref-label">' +
      esc(t('inquiry.done.refLabel')) +
      '</p>' +
      '<p class="inq-receipt__ref"><span class="mono inq-receipt__code" data-inq-ref>' +
      esc(s.ref || '') +
      '</span>' +
      ui.illustrativeTag('inquiry.done.refTag') +
      '</p>' +
      '<p class="inq-receipt__body">' +
      esc(t('inquiry.done.body')) +
      '</p>' +
      '</div></div>' +
      '<div class="inq-sec"><h3 class="inq-sec__title">' +
      esc(t('inquiry.done.entered')) +
      '</h3>' +
      answersHtml(s, tx, false) +
      '</div>' +
      '<div class="inq-sec" data-inq-prod><h3 class="inq-sec__title">' +
      esc(t('inquiry.done.prodTitle')) +
      '</h3><ul class="inq-prod">' +
      prod +
      '</ul></div>' +
      '<div class="inq-sec" data-inq-formal><h3 class="inq-sec__title">' +
      esc(t('inquiry.done.formalTitle')) +
      '</h3><p class="inq-sec__p">' +
      esc(t('inquiry.done.formalBody')) +
      '</p><div class="notice notice--illustrative inq-placeholder">' +
      ui.icon('info', { size: 20 }) +
      '<div><p><span class="tag">' +
      esc(t('inquiry.done.placeholder')) +
      '</span></p><p>' +
      esc(t('inquiry.done.formalPlaceholder')) +
      '</p></div></div></div>'
    );
  }

  function footHtml(s) {
    var back =
      '<button type="button" class="btn inq-foot__back" data-inq-prev data-fk="inq-prev">' + ui.icon('arrow-left', { size: 18 }) + '<span>' + esc(t('inquiry.back')) + '</span></button>';
    var b = '';
    if (s.step === 'transaction') {
      b = '<button type="button" class="btn btn--primary" data-inq-next data-fk="inq-next"><span>' + esc(t('inquiry.next')) + '</span>' + ui.icon('arrow-right', { size: 18 }) + '</button>';
    } else if (s.step === 'details') {
      b = back + '<button type="button" class="btn btn--primary" data-inq-next data-fk="inq-next"><span>' + esc(t('inquiry.next')) + '</span>' + ui.icon('arrow-right', { size: 18 }) + '</button>';
    } else if (s.step === 'review') {
      b = back + '<button type="button" class="btn btn--primary" data-inq-submit data-fk="inq-submit">' + ui.icon('check', { size: 18 }) + '<span>' + esc(t('inquiry.submit')) + '</span></button>';
    } else {
      b = '<button type="button" class="btn btn--primary" data-inq-close data-fk="inq-done">' + esc(t('inquiry.done')) + '</button>';
    }
    return '<div class="dlg__foot inq-foot inq-foot--' + esc(s.step) + '">' + b + '</div>';
  }

  function shellHtml(s, tx) {
    var body;
    if (s.step === 'details') body = detailsStepHtml(s, tx);
    else if (s.step === 'review') body = reviewStepHtml(s, tx);
    else if (s.step === 'done') body = doneStepHtml(s, tx);
    else body = txStepHtml(s, tx);
    return headHtml(s) + '<div class="dlg__body inq-body" data-inq-body data-step="' + esc(s.step) + '">' + body + '</div>' + footHtml(s);
  }

  /**
   * Render the dialog from state. Every render (a step change, start or resume,
   * a language switch, a change from outside) also empties the live regions:
   * whatever they said belonged to the screen being replaced.
   */
  function renderShell(opts) {
    var cur = current();
    var tx = cur ? YES.calc.tx(cur.txId) : null;
    if (!els.shell || !cur || !tx) return;
    var s = normalize(cur);
    var body = q('[data-inq-body]');
    var same = body && body.getAttribute('data-step') === s.step;
    var scroll = body ? body.scrollTop : 0;
    clearLive();
    ui.render(els.shell, shellHtml(s, tx));
    els.dlg.setAttribute('data-step', s.step);
    var nb = q('[data-inq-body]');
    if (!nb) return;
    if (opts && opts.enter) nb.classList.add('inq-body--enter');
    else if (same) nb.scrollTop = scroll;
    syncScrollable();
  }

  /**
   * Keyboard users must be able to scroll the step content even when it holds
   * no focusable control (e.g. the transaction or confirmation step on a small
   * screen): a scrolling body becomes a named, focusable region.
   */
  function syncScrollable() {
    var body = q('[data-inq-body]');
    if (!body || !els.dlg || !els.dlg.open) return;
    var scrolls = body.scrollHeight > body.clientHeight + 1;
    if (scrolls) {
      body.setAttribute('tabindex', '0');
      body.setAttribute('role', 'region');
      body.setAttribute('aria-labelledby', 'inquiry-dialog-title');
    } else if (body.hasAttribute('tabindex')) {
      if (doc.activeElement === body) focusHeading();
      body.removeAttribute('tabindex');
      body.removeAttribute('role');
      body.removeAttribute('aria-labelledby');
    }
  }

  /* ------------------------------------------------------------------ */
  /* Focus                                                               */
  /* ------------------------------------------------------------------ */
  function focusTitle() {
    var h = q('#inquiry-dialog-title');
    if (h) h.focus({ preventScroll: true });
  }
  function focusHeading() {
    var h = q('[data-inq-heading]') || q('#inquiry-dialog-title');
    if (h) h.focus({ preventScroll: true });
  }
  /** The element that scrolls the step content: the body, or the whole sheet on short viewports. */
  function scroller() {
    var body = q('[data-inq-body]');
    if (!body) return null;
    var oy = root.getComputedStyle(body).overflowY;
    return oy === 'auto' || oy === 'scroll' ? body : els.dlg;
  }
  /** What must be fully visible when `el` has focus: its choice card, the description with its counter, its review row. */
  function revealBox(el) {
    return el.closest('[data-inq-reveal]') || el;
  }
  /**
   * Show the focused control in full (WCAG 2.4.11/2.4.12). A browser only
   * reveals a textarea's caret line, which can leave the field, its counter and
   * most of a choice card under the dialog's footer.
   */
  function revealFocused(el, smooth) {
    var target = revealBox(el);
    if (!target.scrollIntoView) return;
    target.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: smooth && !ui.reducedMotion() ? 'smooth' : 'auto' });
  }
  function onFocusIn(e) {
    var el = e.target;
    var body = q('[data-inq-body]');
    if (revealing || !body || el === body || !body.contains(el)) return;
    // After the browser's own focus scrolling (and any re-render that restored focus).
    root.cancelAnimationFrame(timers.reveal);
    timers.reveal = root.requestAnimationFrame(function () {
      if (doc.activeElement === el && el.isConnected) revealFocused(el, false);
    });
  }
  function focusField(field) {
    var el =
      field === 'description'
        ? q('#inq-desc')
        : q('input[name="inq-' + field + '"]:checked') || q('input[name="inq-' + field + '"]');
    if (!el) return;
    revealing = true;
    try {
      el.focus({ preventScroll: true });
    } finally {
      revealing = false;
    }
    // The whole question (legend, hint, error and choices) when it fits; otherwise the field itself.
    var group = el.closest('[data-inq-group]');
    var sc = scroller();
    var fits = group && sc && group.getBoundingClientRect().height <= sc.clientHeight - 32;
    if (fits) group.scrollIntoView({ block: 'nearest', behavior: ui.reducedMotion() ? 'auto' : 'smooth' });
    else revealFocused(el, true);
  }

  /* ------------------------------------------------------------------ */
  /* Actions                                                             */
  /* ------------------------------------------------------------------ */
  function go(step, field) {
    if (!update({ step: step, errors: null, notice: null })) return;
    renderShell({ enter: true });
    var body = q('[data-inq-body]');
    if (body) body.scrollTop = 0;
    if (field) focusField(field);
    else focusHeading();
  }

  function showErrors(errors, step) {
    var p = { errors: errors, notice: null };
    if (step) p.step = step;
    update(p);
    renderShell({ enter: !!step });
    var body = q('[data-inq-body]');
    if (body) body.scrollTop = 0;
    // Focus alone announces the summary (its name and the list of problems); see summaryHtml.
    var sum = q('[data-fk="inq-errors"]');
    if (sum) sum.focus({ preventScroll: true });
  }

  function next() {
    var s = current();
    if (!s) return;
    if (s.step === 'transaction') return go('details');
    if (s.step === 'details') {
      var errors = validate(s);
      if (errors) return showErrors(errors);
      return go('review');
    }
    if (s.step === 'review') return submit();
  }

  function prev() {
    var s = current();
    if (!s) return;
    var i = STEPS.indexOf(s.step);
    if (i > 0 && s.step !== 'done') go(STEPS[i - 1]);
  }

  function submit() {
    var s = current();
    if (!s || s.status === 'submitted') return;
    var errors = validate(s);
    if (errors) return showErrors(errors, 'details');
    var ref = makeRef(s.txId, s.attempt || 1);
    update({ status: 'submitted', ref: ref, step: 'done', errors: null, notice: null, prior: null });
    renderShell({ enter: true });
    var body = q('[data-inq-body]');
    if (body) body.scrollTop = 0;
    focusTitle();
    say(t('inquiry.done.announce', { ref: ref }), true);
  }

  function edit(target) {
    if (target === 'transaction') return go('transaction');
    go('details', target);
  }

  function setField(field, value) {
    var s = current();
    if (!s || FIELDS.indexOf(field) === -1) return;
    if (field !== 'description' && (field === 'reason' ? reasonsOf(s) : CHANNELS).indexOf(value) === -1) return; // only choices on offer
    var p = {};
    p[field] = value;
    var fixed = !!(s.errors && s.errors[field]);
    if (fixed) p.errors = without(s.errors, field);
    update(p);
    if (fixed) syncFieldError(field);
  }

  function setDescription(value) {
    var s = current();
    if (!s) return;
    var v = String(value || '').slice(0, MAX);
    var p = { description: v };
    var fixed = !!(s.errors && s.errors.description && !looksSensitive(v));
    if (fixed) p.errors = without(s.errors, 'description');
    update(p);
    if (fixed) syncFieldError('description');
    var c = q('[data-inq-count]');
    if (c) {
      c.textContent = countText(v.length);
      c.classList.toggle('is-low', MAX - v.length <= 50);
    }
    clearTimeout(timers.count);
    timers.count = setTimeout(function () {
      if (MAX - v.length <= 100 && els.dlg && els.dlg.open) say(countText(v.length));
    }, 900);
  }

  /** Remove a fixed field's inline error and summary entry without re-rendering the form. */
  function syncFieldError(field) {
    var s = current();
    var e = (s && s.errors) || {};
    var err = e[field];
    var slot = q('[data-inq-errslot="' + field + '"]');
    if (slot) slot.innerHTML = err ? errorHtml(field) : '';
    var group = q('[data-inq-group="' + field + '"]');
    if (group) {
      group.classList.toggle('is-invalid', !!err);
      var targets = field === 'description' ? ui.$$('#inq-desc', group) : [group].concat(ui.$$('input[type="radio"]', group));
      targets.forEach(function (el) {
        if (err) el.setAttribute('aria-invalid', 'true');
        else el.removeAttribute('aria-invalid');
      });
      var describedEl = field === 'description' ? q('#inq-desc') : group;
      var ids = groupDescribedBy(field, err);
      if (describedEl) {
        if (ids) describedEl.setAttribute('aria-describedby', ids);
        else describedEl.removeAttribute('aria-describedby');
      }
    }
    var sum = q('.inq-errors');
    if (sum) {
      if (!err) {
        var li = sum.querySelector('[data-inq-err="' + field + '"]');
        if (li) li.parentNode.removeChild(li);
      }
      if (!sum.querySelector('[data-inq-err]')) {
        var hadFocus = sum.contains(doc.activeElement);
        sum.parentNode.removeChild(sum);
        if (hadFocus) focusHeading();
      }
    }
    syncScrollable();
  }

  function startNew() {
    var s = current();
    if (!s) return;
    var rec = blank(s.txId, (s.attempt || 1) + 1);
    rec.seq = ++seqCounter;
    // Keep the completed demo inquiry until the new one is actually used.
    if (s.status === 'submitted') rec.prior = clean(s);
    write(rec, othersOf(raw()));
    renderShell({ enter: true });
    focusHeading();
    say(t('inquiry.dup.started'));
  }

  function discard() {
    var s = current();
    if (!s) return;
    var rec = blank(s.txId, s.attempt || 1);
    rec.seq = ++seqCounter;
    write(rec, othersOf(raw()));
    renderShell({ enter: true });
    focusHeading();
    say(t('inquiry.resumed.discarded'));
  }

  /* ------------------------------------------------------------------ */
  /* Dialog hand-offs                                                    */
  /* ------------------------------------------------------------------ */
  /**
   * If the transaction detail is still open, close it first and remember the
   * control that opened it, so focus returns somewhere sensible. Only shared
   * APIs are used: ui.dialogTrigger / ui.setDialogReturn (core) for the focus
   * hand-off, and YES.explorer.closeTx for the close itself, so the explorer
   * settles its own state, route and history. ({ how: 'back' } is what the
   * explorer does for its own hand-offs: the detail's history entry is stepped
   * over, as when the customer closes it.)
   */
  function leaveTxDetail(trigger) {
    var txd = doc.getElementById('tx-dialog');
    var open = !!(txd && txd.open);
    var origin = open ? ui.dialogTrigger(txd) : null;
    // A trigger inside the detail (its "Ask about this transaction" button) goes away with it.
    if (trigger && txd && txd.contains(trigger)) trigger = null;
    if (trigger && els.dlg && els.dlg.contains(trigger)) trigger = null;
    if (open) {
      ui.setDialogReturn(txd, null); // focus moves into the inquiry, not back to the row behind it
      YES.explorer.closeTx({ how: 'back' });
      if (txd.open) ui.closeDialog(txd, { returnFocus: false }); // no explorer module (isolated build): close the bare dialog
    }
    origin = resolve(origin);
    trigger = resolve(trigger) || origin;
    if (!trigger) {
      var a = doc.activeElement;
      if (a && a !== doc.body && a !== doc.documentElement && !(txd && txd.contains(a)) && !(els.dlg && els.dlg.contains(a))) trigger = a;
    }
    return { trigger: trigger, origin: origin };
  }

  function backToTx() {
    var s = current();
    if (!s) return;
    var target = resolve(ctx.origin) || resolve(ctx.trigger);
    ui.setDialogReturn(els.dlg, null); // hand-off: the transaction detail takes focus, not the old trigger
    ui.closeDialog(els.dlg, { returnFocus: false });
    YES.explorer.openTx(s.txId, target ? { trigger: target } : {});
  }

  function onClose() {
    if (!els.dlg || els.dlg.open) return; // re-opened before a late 'close' event
    clearLive();
    var s = raw();
    var cur = current();
    if (cur) {
      var others = assign({}, othersOf(s));
      if (touched(cur)) {
        write(clean(normalize(cur)), others);
      } else if (cur.prior) {
        write(cur.prior, others); // a "new demo inquiry" that was never used: keep the completed one
      } else {
        // Nothing entered: no draft to keep. Re-activate the most recent parked inquiry, if any.
        var best = null;
        Object.keys(others).forEach(function (k) {
          if (!best || (others[k].seq || 0) > (best.seq || 0)) best = others[k];
        });
        if (best) delete others[best.txId];
        write(best ? clean(normalize(best)) : null, others);
      }
    }
    els.dlg.removeAttribute('data-step');
    // If focus was not returned (trigger hidden or gone), land on the current view's heading.
    setTimeout(function () {
      var a = doc.activeElement;
      if (a && a !== doc.body && a !== doc.documentElement) return;
      if (ui.anyModalOpen()) return;
      var trg = resolve(ctx.trigger);
      if (visible(trg)) return trg.focus({ preventScroll: true });
      var h = doc.querySelector('#view-' + YES.state.view + ' [data-view-heading]') || doc.getElementById('main');
      if (h) h.focus({ preventScroll: true });
    }, 0);
  }

  /* ------------------------------------------------------------------ */
  /* Public API                                                          */
  /* ------------------------------------------------------------------ */
  /** Start (or resume) the inquiry for a transaction. */
  function start(txId, opts) {
    opts = opts || {};
    var tx = txId && SAFE_ID.test(String(txId)) ? YES.calc.tx(String(txId)) : null;
    if (!tx) {
      ui.toast(t('inquiry.notFound', { id: String(txId || '') }));
      return;
    }
    if (!els.dlg) return;
    var wasOpen = els.dlg.open;
    var hand = wasOpen ? { trigger: null, origin: null } : leaveTxDetail(opts.trigger || null);

    var a = activate(tx.id);
    var rec = a.rec;
    rec.errors = null;
    rec.notice = rec.status === 'submitted' ? 'duplicate' : touched(rec) ? 'resumed' : null;
    rec.seq = ++seqCounter;
    write(rec, a.others);

    if (wasOpen) {
      renderShell({ enter: true });
      focusTitle();
      return;
    }
    ctx.trigger = hand.trigger;
    ctx.origin = hand.origin || hand.trigger;
    renderShell();
    ui.openDialog(els.dlg, { trigger: hand.trigger, initialFocus: '#inquiry-dialog-title' });
    syncScrollable();
  }

  /** Reopen the inquiry in progress (the active one, else the most recent draft). */
  function resume(opts) {
    var cur = current();
    var id = cur ? cur.txId : null;
    if (!id) {
      var others = othersOf(raw());
      var best = null;
      Object.keys(others).forEach(function (k) {
        var r = others[k];
        if (r.status !== 'submitted' && (!best || (r.seq || 0) > (best.seq || 0))) best = r;
      });
      id = best ? best.txId : null;
    }
    if (!id) {
      ui.toast(t('inquiry.noDraft'));
      return;
    }
    start(id, opts);
  }

  /** The draft or completed demo inquiry for a transaction, or null. */
  function draftFor(txId) {
    var s = raw();
    if (!s || !txId) return null;
    var rec = s.txId === txId ? s : othersOf(s)[txId] || null;
    if (!rec || !touched(rec)) return null;
    var r = normalize(rec);
    return { txId: r.txId, step: r.step, status: r.status, ref: r.ref || null, reason: r.reason, channel: r.channel, description: r.description };
  }

  YES.inquiry = { start: start, resume: resume, draftFor: draftFor };

  /* ------------------------------------------------------------------ */
  /* Registration                                                        */
  /* ------------------------------------------------------------------ */
  function bind() {
    var d = els.dlg;
    d.addEventListener('close', onClose);
    ui.delegate(d, 'click', '[data-inq-close]', function () {
      ui.closeDialog(d);
    });
    ui.delegate(d, 'click', '[data-inq-backtx]', function () {
      backToTx();
    });
    ui.delegate(d, 'click', '[data-inq-next]', function () {
      next();
    });
    ui.delegate(d, 'click', '[data-inq-prev]', function () {
      prev();
    });
    ui.delegate(d, 'click', '[data-inq-submit]', function () {
      submit();
    });
    ui.delegate(d, 'click', '[data-inq-edit]', function (e, b) {
      edit(b.getAttribute('data-inq-edit'));
    });
    ui.delegate(d, 'click', '[data-inq-errlink]', function (e, a) {
      e.preventDefault(); // never let the hash reach the router
      focusField(a.getAttribute('data-inq-errlink'));
    });
    ui.delegate(d, 'click', '[data-inq-new]', function () {
      startNew();
    });
    ui.delegate(d, 'click', '[data-inq-discard]', function () {
      discard();
    });
    ui.delegate(d, 'change', 'input[data-inq-field]', function (e, input) {
      if (input.checked) setField(input.getAttribute('data-inq-field'), input.value);
    });
    ui.delegate(d, 'input', '[data-inq-desc]', function (e, ta) {
      setDescription(ta.value);
    });
    d.addEventListener('focusin', onFocusIn);
    root.addEventListener('resize', function () {
      clearTimeout(timers.resize);
      timers.resize = setTimeout(syncScrollable, 120);
    });
  }

  YES.register({
    name: 'inquiry',
    i18n: {
      en: {
        'inquiry.title': 'Ask about this transaction',
        'inquiry.doneTitle': 'Demo only — no inquiry was sent',
        'inquiry.demoTag': 'Demo only',
        'inquiry.backToTx': 'Back to transaction',
        'inquiry.closeDraft': 'Close the inquiry. Your draft is kept.',
        'inquiry.closeDone': 'Close',
        'inquiry.progress': 'Inquiry progress',
        'inquiry.step.transaction': 'Transaction',
        'inquiry.step.details': 'Details',
        'inquiry.step.review': 'Review',
        'inquiry.step.done': 'Confirmation',
        'inquiry.step.count': 'Step {n} of {total}',
        'inquiry.step.completed': ' (completed)',
        'inquiry.next': 'Next',
        'inquiry.back': 'Back',
        'inquiry.submit': 'Submit demo inquiry',
        'inquiry.done': 'Done',
        'inquiry.keep': 'Your answers stay on this page. Closing keeps your draft, and nothing is sent.',
        'inquiry.notFound': 'Transaction {id} isn’t in this statement.',
        'inquiry.noDraft': 'There’s no inquiry in progress. Open a transaction and choose “Ask about this transaction”.',

        'inquiry.tx.heading': 'Check the transaction',
        'inquiry.tx.lede': 'Your inquiry will be about this transaction. We’ve included its reference for you.',
        'inquiry.tx.counterparty': 'Counterparty',
        'inquiry.tx.notPosted': 'Not posted yet',
        'inquiry.tx.status': 'Status',
        'inquiry.tx.fee': 'Linked fee',
        'inquiry.tx.feeFor': 'Fee for',
        'inquiry.tx.reference': 'Reference',
        'inquiry.tx.id': 'Transaction ID',
        'inquiry.tx.notDispute': 'An inquiry is a question about one transaction. It isn’t a formal dispute or a fraud report.',

        'inquiry.details.heading': 'Tell us what you’d like to ask',
        'inquiry.required': 'Required',
        'inquiry.optional': 'Optional',
        'inquiry.reason.legend': 'What is your inquiry about?',
        'inquiry.reason.unrecognized': 'I don’t recognize this transaction',
        'inquiry.reason.amount': 'The amount looks wrong',
        'inquiry.reason.pending': 'It’s still pending',
        'inquiry.reason.fee': 'I have a question about a fee',
        'inquiry.reason.other': 'Something else',
        'inquiry.description.label': 'Anything else we should know?',
        'inquiry.description.hint': 'Up to {max} characters.',
        'inquiry.description.warn': 'Don’t include passwords, full card or account numbers, or recovery phrases. YES will never ask for them.',
        'inquiry.description.left': '{n} characters left',
        'inquiry.description.left1': '1 character left',
        'inquiry.description.limit': 'You’ve reached the {max}-character limit',
        'inquiry.channel.legend': 'How should YES reply?',
        'inquiry.channel.hint': 'This demo collects no contact details. In production, YES would use the details already on your account.',
        'inquiry.channel.in_app': 'In-app message',
        'inquiry.channel.in_app.hint': 'A reply in your YES inbox',
        'inquiry.channel.email': 'Email on file',
        'inquiry.channel.email.hint': 'The address already on your account',
        'inquiry.channel.phone': 'Phone call on file',
        'inquiry.channel.phone.hint': 'The number already on your account',

        'inquiry.err.title': 'Some answers need your attention',
        'inquiry.err.prefix': 'Error:',
        'inquiry.err.reason': 'Choose what your inquiry is about.',
        'inquiry.err.description': 'Remove what looks like a full card or account number from your description.',
        'inquiry.err.channel': 'Choose how YES should reply.',

        'inquiry.review.heading': 'Check your inquiry',
        'inquiry.review.demoStrong': 'Demo only — nothing will be sent.',
        'inquiry.review.demo': 'Submitting creates a fictional reference on this page only. No case is opened and no one will contact you.',
        'inquiry.review.tx': 'Transaction',
        'inquiry.review.reason': 'Reason',
        'inquiry.review.description': 'Your description',
        'inquiry.review.none': 'Nothing added',
        'inquiry.review.channel': 'Reply by',
        'inquiry.review.change': 'Change',

        'inquiry.done.refLabel': 'Fictional demo reference',
        'inquiry.done.refTag': 'Fictional — not a case number',
        'inquiry.done.body': 'This reference exists only on this page. No case was created, nothing left your device, and no one will contact you about it.',
        'inquiry.done.entered': 'What you entered',
        'inquiry.done.prodTitle': 'What would happen in production',
        'inquiry.done.prod.auth': 'Your inquiry would be submitted through an authenticated, auditable YES service.',
        'inquiry.done.prod.case': 'You would receive a genuine case ID and could follow its status.',
        'inquiry.done.prod.dup': 'A second inquiry about the same transaction would be recognized as a duplicate and linked to the existing case.',
        'inquiry.done.prod.redact': 'Sensitive details you type would be redacted from analytics.',
        'inquiry.done.prod.reply': 'YES would reply through the channel you chose, using the contact details already on your account.',
        'inquiry.done.formalTitle': 'Inquiry, dispute or fraud report?',
        'inquiry.done.formalBody': 'An inquiry asks YES a question about a transaction. A formal dispute or a fraud report is a separate process with its own rules and timelines.',
        'inquiry.done.placeholder': 'Placeholder',
        'inquiry.done.formalPlaceholder': '[Formal dispute and fraud-report routes, with approved policy and timing copy, will appear here once YES approves them.]',
        'inquiry.done.announce': 'Demo only — no inquiry was sent. Fictional reference {ref}.',
        'inquiry.dup.strong': 'You already completed a demo inquiry about this transaction.',
        'inquiry.dup.body': 'In production, YES would show you the existing case and its status instead of opening a duplicate.',
        'inquiry.dup.new': 'Start a new demo inquiry',
        'inquiry.dup.started': 'New demo inquiry started.',
        'inquiry.resumed.body': 'Welcome back. We kept your draft, so you can pick up where you left off.',
        'inquiry.resumed.discard': 'Discard the draft and start over',
        'inquiry.resumed.discarded': 'Draft discarded. You’re starting a new inquiry.'
      },
      es: {
        'inquiry.title': 'Preguntar por este movimiento',
        'inquiry.doneTitle': 'Solo demostración: no se envió ninguna consulta',
        'inquiry.demoTag': 'Solo demostración',
        'inquiry.backToTx': 'Volver al movimiento',
        'inquiry.closeDraft': 'Cerrar la consulta. Tu borrador se conserva.',
        'inquiry.closeDone': 'Cerrar',
        'inquiry.progress': 'Progreso de la consulta',
        'inquiry.step.transaction': 'Movimiento',
        'inquiry.step.details': 'Detalles',
        'inquiry.step.review': 'Revisión',
        'inquiry.step.done': 'Confirmación',
        'inquiry.step.count': 'Paso {n} de {total}',
        'inquiry.step.completed': ' (completado)',
        'inquiry.next': 'Siguiente',
        'inquiry.back': 'Atrás',
        'inquiry.submit': 'Enviar consulta de demostración',
        'inquiry.done': 'Listo',
        'inquiry.keep': 'Tus respuestas se quedan en esta página. Si cierras, conservamos tu borrador y no se envía nada.',
        'inquiry.notFound': 'El movimiento {id} no está en este estado de cuenta.',
        'inquiry.noDraft': 'No tienes ninguna consulta en curso. Abre un movimiento y elige «Preguntar por este movimiento».',

        'inquiry.tx.heading': 'Comprueba el movimiento',
        'inquiry.tx.lede': 'Tu consulta será sobre este movimiento. Ya incluimos su referencia por ti.',
        'inquiry.tx.counterparty': 'Contraparte',
        'inquiry.tx.notPosted': 'Aún sin registrar',
        'inquiry.tx.status': 'Estado',
        'inquiry.tx.fee': 'Comisión vinculada',
        'inquiry.tx.feeFor': 'Comisión de',
        'inquiry.tx.reference': 'Referencia',
        'inquiry.tx.id': 'ID del movimiento',
        'inquiry.tx.notDispute': 'Una consulta es una pregunta sobre un movimiento. No es una disputa formal ni una denuncia de fraude.',

        'inquiry.details.heading': 'Cuéntanos qué quieres preguntar',
        'inquiry.required': 'Obligatorio',
        'inquiry.optional': 'Opcional',
        'inquiry.reason.legend': '¿Sobre qué es tu consulta?',
        'inquiry.reason.unrecognized': 'No reconozco este movimiento',
        'inquiry.reason.amount': 'El importe no parece correcto',
        'inquiry.reason.pending': 'Sigue pendiente',
        'inquiry.reason.fee': 'Tengo una pregunta sobre una comisión',
        'inquiry.reason.other': 'Otro motivo',
        'inquiry.description.label': '¿Hay algo más que debamos saber?',
        'inquiry.description.hint': 'Hasta {max} caracteres.',
        'inquiry.description.warn': 'No incluyas contraseñas, números completos de tarjeta o de cuenta, ni frases de recuperación. YES nunca te los pedirá.',
        'inquiry.description.left': 'Quedan {n} caracteres',
        'inquiry.description.left1': 'Queda 1 carácter',
        'inquiry.description.limit': 'Llegaste al límite de {max} caracteres',
        'inquiry.channel.legend': '¿Cómo quieres que YES te responda?',
        'inquiry.channel.hint': 'Esta demostración no recoge datos de contacto. En producción, YES usaría los datos que ya constan en tu cuenta.',
        'inquiry.channel.in_app': 'Mensaje en la app',
        'inquiry.channel.in_app.hint': 'Una respuesta en tu bandeja de YES',
        'inquiry.channel.email': 'Correo electrónico registrado',
        'inquiry.channel.email.hint': 'La dirección que ya consta en tu cuenta',
        'inquiry.channel.phone': 'Llamada al teléfono registrado',
        'inquiry.channel.phone.hint': 'El número que ya consta en tu cuenta',

        'inquiry.err.title': 'Algunas respuestas necesitan tu atención',
        'inquiry.err.prefix': 'Error:',
        'inquiry.err.reason': 'Elige sobre qué es tu consulta.',
        'inquiry.err.description': 'Quita de tu descripción lo que parece un número completo de tarjeta o de cuenta.',
        'inquiry.err.channel': 'Elige cómo quieres que YES te responda.',

        'inquiry.review.heading': 'Revisa tu consulta',
        'inquiry.review.demoStrong': 'Solo demostración: no se enviará nada.',
        'inquiry.review.demo': 'Al enviarla se crea una referencia ficticia solo en esta página. No se abre ningún caso y nadie se pondrá en contacto contigo.',
        'inquiry.review.tx': 'Movimiento',
        'inquiry.review.reason': 'Motivo',
        'inquiry.review.description': 'Tu descripción',
        'inquiry.review.none': 'No añadiste nada',
        'inquiry.review.channel': 'Respuesta por',
        'inquiry.review.change': 'Cambiar',

        'inquiry.done.refLabel': 'Referencia ficticia de demostración',
        'inquiry.done.refTag': 'Ficticia: no es un número de caso',
        'inquiry.done.body': 'Esta referencia solo existe en esta página. No se creó ningún caso, nada salió de tu dispositivo y nadie se pondrá en contacto contigo por esto.',
        'inquiry.done.entered': 'Lo que indicaste',
        'inquiry.done.prodTitle': 'Qué pasaría en producción',
        'inquiry.done.prod.auth': 'Tu consulta se enviaría a través de un servicio de YES autenticado y auditable.',
        'inquiry.done.prod.case': 'Recibirías un número de caso real y podrías seguir su estado.',
        'inquiry.done.prod.dup': 'Una segunda consulta sobre el mismo movimiento se reconocería como duplicada y se vincularía al caso existente.',
        'inquiry.done.prod.redact': 'Los datos sensibles que escribas se ocultarían en la analítica.',
        'inquiry.done.prod.reply': 'YES te respondería por el canal que elegiste, con los datos de contacto que ya constan en tu cuenta.',
        'inquiry.done.formalTitle': '¿Consulta, disputa o denuncia de fraude?',
        'inquiry.done.formalBody': 'Una consulta es una pregunta a YES sobre un movimiento. Una disputa formal o una denuncia de fraude es un proceso distinto, con sus propias reglas y plazos.',
        'inquiry.done.placeholder': 'Marcador de posición',
        'inquiry.done.formalPlaceholder': '[Las vías formales de disputa y de denuncia de fraude, con su política y sus plazos aprobados, aparecerán aquí cuando YES las apruebe.]',
        'inquiry.done.announce': 'Solo demostración: no se envió ninguna consulta. Referencia ficticia {ref}.',
        'inquiry.dup.strong': 'Ya completaste una consulta de demostración sobre este movimiento.',
        'inquiry.dup.body': 'En producción, YES te mostraría el caso existente y su estado en lugar de abrir uno duplicado.',
        'inquiry.dup.new': 'Iniciar una nueva consulta de demostración',
        'inquiry.dup.started': 'Nueva consulta de demostración iniciada.',
        'inquiry.resumed.body': 'Te damos la bienvenida de nuevo. Guardamos tu borrador para que continúes donde lo dejaste.',
        'inquiry.resumed.discard': 'Descartar el borrador y empezar de nuevo',
        'inquiry.resumed.discarded': 'Borrador descartado. Empiezas una consulta nueva.'
      }
    },
    init: function () {
      els.dlg = doc.getElementById('inquiry-dialog');
      if (!els.dlg) return;
      els.dlg.innerHTML =
        '<div class="inq-shell" data-inq-shell></div>' +
        '<div class="sr-only" aria-live="polite" aria-atomic="true" data-inq-live></div>' +
        '<div class="sr-only" aria-live="assertive" aria-atomic="true" data-inq-live-a></div>';
      els.shell = els.dlg.querySelector('[data-inq-shell]');
      els.live = els.dlg.querySelector('[data-inq-live]');
      els.liveA = els.dlg.querySelector('[data-inq-live-a]');
      bind();
    },
    render: function () {
      if (els.dlg && els.dlg.open) renderShell();
    },
    onState: function (keys) {
      if (selfWrite || keys.indexOf('inquiry') === -1 || !els.dlg || !els.dlg.open) return;
      // Changed from outside this module while the dialog is open.
      var cur = current();
      if (!cur || !YES.calc.tx(cur.txId)) return ui.closeDialog(els.dlg);
      var n = normalize(cur); // e.g. a reason this transaction does not offer, or a step that no longer applies
      delete n.others;
      write(n, othersOf(raw()));
      renderShell();
    }
  });
})(window);
