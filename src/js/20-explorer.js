/*
 * Transactions explorer (PRD 4 layer 3, 5.3, 5.6 on-chain sample, 5.8).
 *
 * Search, combined filters, sort, a compact desktop table and readable mobile
 * cards, the transaction detail dialog, CSV export, and Print / Download PDF
 * for the statement of record (the PDF itself is composed by the help module,
 * YES.help.downloadPdf). The detail has no language switch of its own: it uses
 * the language chosen in the masthead (ARCHITECTURE rule 7). Everything is derived
 * from YES.data / YES.calc; the view keeps its context in YES.state
 * (filters, sort, selectedTx, explorer.filtersOpen) so a language switch
 * re-renders without losing anything.
 *
 * Rendering is split so typing never loses focus or caret: the search box and
 * filter controls are only rebuilt on a full render (language change); filter
 * changes update control values in place and re-render the chips and results.
 */
(function (root) {
  'use strict';
  var YES = root.YES;
  var ui = YES.ui;
  var t = YES.t;
  var esc = ui.esc;
  var doc = root.document;

  var TYPE_ORDER = ['deposit', 'transfer_in', 'transfer_out', 'redemption', 'fee'];
  var RAIL_ORDER = ['internal', 'onchain', 'other'];
  var STATUS_ORDER = ['posted', 'pending', 'failed', 'unknown'];
  var SORT_KEYS = { posted: 1, initiated: 1, amount: 1 };
  var SORTS = [
    { key: 'posted', dir: 'desc' },
    { key: 'posted', dir: 'asc' },
    { key: 'initiated', dir: 'desc' },
    { key: 'initiated', dir: 'asc' },
    { key: 'amount', dir: 'desc' },
    { key: 'amount', dir: 'asc' }
  ];
  var FIELD_ORDER = ['description', 'counterparty', 'memo', 'type', 'status', 'amount', 'rail', 'reference', 'id'];
  var CLASSIFICATION = 'ILLUSTRATIVE_DEMO_DATA';
  var SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

  var els = { root: null, dlg: null };
  var timers = {};
  var enterNext = false; // animate the next results render (rows arriving from a journey step)
  var dlgCtx = { view: null, list: null }; // view the detail dialog was opened over, and the list it was opened from
  var closing = false; // a close we started is waiting for the dialog's async 'close' event
  var hist = { pushed: false }; // opening the detail added a history entry

  /* ------------------------------------------------------------------ */
  /* Small helpers                                                       */
  /* ------------------------------------------------------------------ */
  function st() {
    return YES.data.statement;
  }
  function asset() {
    return YES.calc.asset();
  }
  function ms(iso) {
    return iso ? Date.parse(iso) : NaN;
  }
  /**
   * Table or cards. Phones always get cards. Otherwise the table is used only
   * when the results column is wide enough for it, which depends on the space
   * the view actually has (the docked assistant narrows it), not on the
   * viewport: below that width the same rows are shown as cards, so amounts and
   * balances are never pushed behind a sideways scroll.
   */
  var TABLE_MIN = 540;
  var layout = { table: null, observer: null };
  function tableMode() {
    if (ui.isNarrow()) return false;
    var res = els.root && els.root.querySelector('#tx-results');
    var w = res ? res.clientWidth : 0;
    return !w || w >= TABLE_MIN; // not laid out yet (view hidden): decide when it is shown
  }
  function allTx() {
    return YES.calc.all();
  }
  function setOf(list) {
    var o = {};
    (list || []).forEach(function (v) {
      o[v] = true;
    });
    return o;
  }
  function statusOf(tx) {
    return STATUS_ORDER.indexOf(tx.status) !== -1 ? tx.status : 'unknown';
  }
  function statusLabel(s) {
    return t({ posted: 1, pending: 1, failed: 1 }[s] ? 'status.' + s : 'status.unknown');
  }
  function railLabel(r) {
    var k = 'rail.' + r;
    return YES.i18n.dict[YES.i18n.lang][k] ? t(k) : r;
  }
  function methodLabel(m) {
    var k = 'method.' + m;
    return YES.i18n.dict[YES.i18n.lang][k] ? t(k) : m || '';
  }
  function railText(tx) {
    var m = methodLabel(tx.method);
    return railLabel(tx.rail) + (m ? ' · ' + m : '');
  }
  /**
   * A calendar day (YYYY-MM-DD) as an instant that falls on that same date in the
   * statement timezone, so YES.fmt.date / range label the day the customer picked.
   * Noon UTC works from UTC−12 to UTC+11; zones at UTC+12 and later (Auckland,
   * Kiritimati) are already on the next day at noon UTC, so use midnight UTC there.
   */
  function dayIso(day) {
    var noon = day + 'T12:00:00Z';
    if (YES.fmt.isoDate(noon) === day) return noon;
    var early = day + 'T00:00:00Z';
    return YES.fmt.isoDate(early) === day ? early : noon;
  }
  function tzShort(iso) {
    var s = YES.fmt.tz(iso);
    var i = s.indexOf(' (');
    return i === -1 ? s : s.slice(0, i);
  }
  /** Translate `key`, escape it, then splice in pre-built HTML for `htmlVars`. */
  function tHtml(key, vars, htmlVars) {
    var v = {};
    var marks = {};
    var n = 0;
    var k;
    for (k in vars || {}) v[k] = vars[k];
    for (k in htmlVars || {}) {
      var m = '\u0001' + n++ + '\u0002';
      v[k] = m;
      marks[m] = htmlVars[k];
    }
    var s = esc(t(key, v));
    Object.keys(marks).forEach(function (m) {
      s = s.split(m).join(marks[m]);
    });
    return s;
  }

  /* ------------------------------------------------------------------ */
  /* State accessors                                                     */
  /* ------------------------------------------------------------------ */
  function F() {
    var d = YES.defaultFilters();
    var f = YES.state.filters || {};
    Object.keys(d).forEach(function (k) {
      if (f[k] !== undefined && f[k] !== null) d[k] = f[k];
    });
    ['types', 'statuses', 'rails'].forEach(function (k) {
      if (!Array.isArray(d[k])) d[k] = [];
    });
    if (d.ids && !Array.isArray(d.ids)) d.ids = null;
    d.q = String(d.q || '');
    d.min = String(d.min == null ? '' : d.min);
    d.max = String(d.max == null ? '' : d.max);
    if (['all', 'in', 'out'].indexOf(d.direction) === -1) d.direction = 'all';
    d.idsLabel = f.idsLabel || null;
    // The language the amount range was typed in: "1,000" and "1.000" mean
    // different things in English and Spanish, so the text is always read with
    // the separators of the language it was entered in (see localizeAmounts).
    d.amountLang = f.amountLang && YES.config.languages.indexOf(f.amountLang) !== -1 ? f.amountLang : null;
    return d;
  }
  /** Stamp a filter object whose amount range was just (re)typed with the UI language. */
  function stampAmountLang(f, patch) {
    if ('min' in patch || 'max' in patch) f.amountLang = YES.i18n.lang;
    if (!String(f.min || '').trim() && !String(f.max || '').trim()) f.amountLang = null;
    return f;
  }
  function setFilters(patch) {
    var f = F();
    Object.keys(patch).forEach(function (k) {
      f[k] = Array.isArray(patch[k]) ? patch[k].slice() : patch[k];
    });
    return YES.set({ filters: stampAmountLang(f, patch) });
  }
  function S() {
    var s = YES.state.sort || {};
    return { key: SORT_KEYS[s.key] ? s.key : 'posted', dir: s.dir === 'asc' ? 'asc' : 'desc' };
  }
  /**
   * Filter basis (PRD 6 rule 3): the statement's date basis, the same one the
   * totals, chart and exports use. Choosing a sort order never changes it, so a
   * sort can only reorder rows, never add or remove them.
   */
  function filterBasis() {
    return st().dateBasis === 'initiated' ? 'initiated' : 'posted';
  }
  /** Dates shown in the list: the sort's date when sorting by initiated date, else the statement basis. */
  function shownBasis() {
    return S().key === 'initiated' ? 'initiated' : filterBasis();
  }
  /** Display date on a basis (an unposted transaction shows when it was initiated). */
  function basisIso(tx, b) {
    return b === 'initiated' ? tx.initiatedAt : tx.postedAt || tx.initiatedAt;
  }
  /** The date a filter compares on a basis: an unposted transaction has no posted date. */
  function filterIso(tx, b) {
    return b === 'initiated' ? tx.initiatedAt : tx.postedAt || null;
  }
  function viewPrefs() {
    return YES.state.explorer || { filtersOpen: false };
  }

  /** Date input bounds on a basis: the statement period (widened for any dates outside it). */
  function dateBounds(b) {
    var s = st();
    var min = YES.fmt.isoDate(s.periodStart);
    var max = YES.fmt.isoDate(s.periodEnd);
    allTx().forEach(function (tx) {
      var d = YES.fmt.isoDate(filterIso(tx, b));
      if (d && d < min) min = d;
      if (d && d > max) max = d;
    });
    return { min: min, max: max };
  }

  function stepIds(step) {
    var c = YES.calc.category(step);
    if (c) return c.txIds;
    var g = YES.calc.groups()[step];
    return g ? g.txIds : [];
  }
  function stepLabel(step) {
    if (YES.calc.category(step)) return t('cat.' + step);
    if (step === 'incoming' || step === 'outgoing') return t('group.' + step);
    return String(step);
  }

  /* ------------------------------------------------------------------ */
  /* Amount parsing ("," or "." decimals) — returns minor units          */
  /* ------------------------------------------------------------------ */
  /**
   * Parse a typed amount. A lone separator followed by exactly three digits is a
   * thousands separator when it is the grouping mark of `lang` (default: the UI
   * language): "1,000" is one thousand in English, "1.000" in Spanish.
   */
  function parseAmount(raw, lang) {
    var s = String(raw == null ? '' : raw)
      .replace(/[\s  ']/g, '')
      .replace(/^[+−-]/, '');
    s = s.replace(new RegExp(asset().symbol + '$', 'i'), '');
    if (!s) return { empty: true, value: null };
    if (!/^[0-9.,]+$/.test(s) || !/[0-9]/.test(s)) return { error: true, value: null };
    var p = asset().precision;
    var lastComma = s.lastIndexOf(',');
    var lastDot = s.lastIndexOf('.');
    var dec = null;
    if (lastComma !== -1 && lastDot !== -1) {
      dec = lastComma > lastDot ? ',' : '.';
    } else if (lastComma !== -1 || lastDot !== -1) {
      var sep = lastComma !== -1 ? ',' : '.';
      var count = s.split(sep).length - 1;
      var after = s.length - s.lastIndexOf(sep) - 1;
      var group = groupMark(lang || YES.i18n.lang);
      if (count > 1 || (sep === group && after === 3)) dec = null;
      else dec = sep;
    }
    var intPart = s;
    var fracPart = '';
    if (dec) {
      var i = s.lastIndexOf(dec);
      intPart = s.slice(0, i);
      fracPart = s.slice(i + 1);
    }
    intPart = intPart.replace(/[.,]/g, '');
    if (/[.,]/.test(fracPart)) return { error: true, value: null };
    if (!intPart && !fracPart) return { error: true, value: null };
    if (intPart.length > 12) return { error: true, value: null };
    var digits = (fracPart + '000000000').slice(0, p);
    var minor = parseInt(intPart || '0', 10) * Math.pow(10, p) + (p ? parseInt(digits, 10) : 0);
    if (fracPart.length > p && parseInt(fracPart.charAt(p), 10) >= 5) minor += 1;
    return { value: minor };
  }
  function groupMark(lang) {
    return lang === 'es' ? '.' : ',';
  }
  /**
   * An amount as a customer would type it in `lang`, without grouping so it can
   * never be misread: 1000 → "1000" / 45.50 → "45.50" (en), "45,50" (es).
   */
  function typedAmount(minor, lang) {
    var plain = YES.fmt.plain(minor);
    if (/\.0+$/.test(plain)) plain = plain.replace(/\.0+$/, '');
    return groupMark(lang) === '.' ? plain.replace('.', ',') : plain;
  }
  /**
   * After a language switch, rewrite the amount range in the new language's
   * format so it keeps its meaning ("1,000" typed in English becomes "1000",
   * not one unit in Spanish). Text that does not parse is left as typed.
   */
  function localizeAmounts() {
    var f = F();
    var from = f.amountLang;
    var to = YES.i18n.lang;
    if (!from || from === to) return;
    var next = {};
    for (var k in f) next[k] = f[k];
    ['min', 'max'].forEach(function (w) {
      var p = parseAmount(f[w], from);
      if (f[w].trim() && p.value != null) next[w] = typedAmount(p.value, to);
    });
    next.amountLang = to;
    YES.set({ filters: next });
  }

  /* ------------------------------------------------------------------ */
  /* Search: accent- and case-insensitive, with highlight ranges         */
  /* ------------------------------------------------------------------ */
  function fold(s) {
    s = String(s == null ? '' : s);
    var out = '';
    var map = [];
    for (var i = 0; i < s.length; i++) {
      var c = s.charAt(i);
      var f = c.normalize ? c.normalize('NFD').replace(/[̀-ͯ]/g, '') : c;
      f = f.toLowerCase();
      for (var j = 0; j < f.length; j++) {
        out += f.charAt(j);
        map.push(i);
      }
    }
    return { s: out, map: map };
  }
  function queryTerms(q) {
    var seen = {};
    return String(q || '')
      .trim()
      .split(/\s+/)
      .map(function (w) {
        return fold(w).s;
      })
      .filter(function (w) {
        if (!w || seen[w]) return false;
        seen[w] = true;
        return true;
      });
  }
  function ranges(text, terms) {
    var f = fold(text);
    var rs = [];
    terms.forEach(function (term) {
      var from = 0;
      var idx;
      while (term && (idx = f.s.indexOf(term, from)) !== -1) {
        rs.push([f.map[idx], f.map[idx + term.length - 1] + 1]);
        from = idx + term.length;
      }
    });
    rs.sort(function (a, b) {
      return a[0] - b[0];
    });
    var merged = [];
    rs.forEach(function (r) {
      var last = merged[merged.length - 1];
      if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
      else merged.push([r[0], r[1]]);
    });
    return merged;
  }
  /** Escaped text with <mark> around every match of the search terms. */
  function hl(text, terms) {
    text = String(text == null ? '' : text);
    if (!terms || !terms.length) return esc(text);
    var rs = ranges(text, terms);
    if (!rs.length) return esc(text);
    var out = '';
    var pos = 0;
    rs.forEach(function (r) {
      out += esc(text.slice(pos, r[0])) + '<mark>' + esc(text.slice(r[0], r[1])) + '</mark>';
      pos = r[1];
    });
    return out + esc(text.slice(pos));
  }
  /**
   * Searchable fields. `shown` fields are visible in the row and get highlighted
   * in place; the others are echoed, highlighted, in the "Matched in" line.
   */
  function fieldsOf(tx) {
    return [
      { key: 'description', text: YES.L(tx.description), shown: true },
      { key: 'counterparty', text: YES.L(tx.counterparty), shown: true },
      { key: 'memo', text: tx.memo ? YES.L(tx.memo) : '', shown: true },
      { key: 'type', text: ui.typeLabel(tx), shown: true },
      { key: 'type', text: tx.type, shown: false },
      { key: 'status', text: statusLabel(statusOf(tx)), shown: true },
      // The canonical value ("posted") is not on screen in Spanish ("Registrado"), so echo it.
      { key: 'status', text: tx.status || '', shown: statusLabel(statusOf(tx)).toLowerCase() === String(tx.status || '').toLowerCase() },
      { key: 'rail', text: railText(tx), shown: false },
      { key: 'rail', text: (tx.rail || '') + ' ' + (tx.method || ''), shown: false },
      { key: 'reference', text: tx.reference || '', shown: false },
      { key: 'id', text: tx.id, shown: false }
    ];
  }
  /** A search word that looks like an amount: "45.50", "-45,50", "+200", "1,000". */
  var AMOUNT_TERM = /^[+\-−]?\d[\d.,]*$/;
  /**
   * Does a numeric search word name this transaction's amount? Matched on the
   * size, ignoring sign unless one is typed; separators are read like the
   * Amount filter. A whole number also finds the amounts in that unit ("45"
   * finds 45.50), the way people search for a payment they half remember.
   */
  function amountMatches(tx, term) {
    if (!AMOUNT_TERM.test(term)) return false;
    var sign = term.charAt(0);
    if ((sign === '-' || sign === '−') && !(tx.amount < 0)) return false;
    if (sign === '+' && !(tx.amount > 0)) return false;
    var p = parseAmount(term);
    if (p.value == null) return false;
    var abs = Math.abs(tx.amount);
    if (abs === p.value) return true;
    var unit = Math.pow(10, asset().precision);
    return !/[.,]/.test(term) && Math.floor(abs / unit) * unit === p.value;
  }
  function matchTx(tx, terms) {
    var fields = fieldsOf(tx).map(function (fl) {
      fl.folded = fold(fl.text).s;
      return fl;
    });
    var amountField = { key: 'amount', text: '', shown: true };
    var hit = [];
    for (var i = 0; i < terms.length; i++) {
      var any = false;
      for (var j = 0; j < fields.length; j++) {
        if (fields[j].text && fields[j].folded.indexOf(terms[i]) !== -1) {
          any = true;
          if (hit.indexOf(fields[j]) === -1) hit.push(fields[j]);
        }
      }
      if (amountMatches(tx, terms[i])) {
        any = true;
        if (hit.indexOf(amountField) === -1) hit.push(amountField);
      }
      if (!any) return null;
    }
    return hit;
  }
  function hitKey(match, key) {
    return !!(match || []).some(function (m) {
      return m.key === key && m.shown;
    });
  }

  /* ------------------------------------------------------------------ */
  /* Filtering and sorting                                               */
  /* ------------------------------------------------------------------ */
  function sortRows(rows) {
    var s = S();
    var sign = s.dir === 'asc' ? 1 : -1;
    rows.sort(function (A, B) {
      var a = A.tx;
      var b = B.tx;
      var d;
      if (s.key === 'amount') {
        d = Math.abs(a.amount) - Math.abs(b.amount);
        if (d) return d * sign;
        return ms(basisIso(b, 'posted')) - ms(basisIso(a, 'posted')) || (b.seq || 0) - (a.seq || 0);
      }
      d = ms(basisIso(a, s.key)) - ms(basisIso(b, s.key));
      if (!d) d = (a.seq || 0) - (b.seq || 0);
      return d * sign;
    });
    return rows;
  }

  /**
   * Filter + sort. Returns [{ tx, match }] where match lists the fields that
   * matched the search. `skip` leaves one facet group out ('direction', 'types',
   * 'statuses' or 'rails'), which is how each option's count is worked out.
   * The array also carries `undated`: transactions left out only because the
   * date range uses the posted date and they have none yet, although they were
   * initiated inside the range.
   */
  function run(skip) {
    var f = F();
    var b = filterBasis();
    var terms = queryTerms(f.q);
    var stepSet = f.step ? setOf(stepIds(f.step)) : null;
    var idSet = f.ids ? setOf(f.ids) : null;
    var min = parseAmount(f.min, f.amountLang);
    var max = parseAmount(f.max, f.amountLang);
    var out = [];
    var undated = [];
    var inRange = function (day) {
      return !!day && !(f.from && day < f.from) && !(f.to && day > f.to);
    };
    allTx().forEach(function (tx) {
      if (idSet && !idSet[tx.id]) return;
      if (stepSet && !stepSet[tx.id]) return;
      if (skip !== 'direction' && f.direction === 'in' && !(tx.amount > 0)) return;
      if (skip !== 'direction' && f.direction === 'out' && !(tx.amount < 0)) return;
      if (skip !== 'types' && f.types.length && f.types.indexOf(tx.type) === -1) return;
      if (skip !== 'statuses' && f.statuses.length && f.statuses.indexOf(statusOf(tx)) === -1) return;
      if (skip !== 'rails' && f.rails.length && f.rails.indexOf(tx.rail) === -1) return;
      var abs = Math.abs(tx.amount);
      if (min.value != null && abs < min.value) return;
      if (max.value != null && abs > max.value) return;
      var m = null;
      if (terms.length) {
        m = matchTx(tx, terms);
        if (!m) return;
      }
      if ((f.from || f.to) && !inRange(YES.fmt.isoDate(filterIso(tx, b)))) {
        if (!filterIso(tx, b) && inRange(YES.fmt.isoDate(tx.initiatedAt))) undated.push(tx);
        return;
      }
      out.push({ tx: tx, match: m });
    });
    out = sortRows(out);
    out.undated = undated;
    return out;
  }

  function filtered() {
    return run().map(function (r) {
      return r.tx;
    });
  }

  /* ------------------------------------------------------------------ */
  /* Active filter chips                                                 */
  /* ------------------------------------------------------------------ */
  function chips() {
    var f = F();
    var b = filterBasis();
    var list = [];
    var q = f.q.trim();
    if (q) list.push({ id: 'q', label: t('explorer.chip.q', { q: q }) });
    if (f.step) list.push({ id: 'step', label: t('explorer.chip.step', { label: stepLabel(f.step) }) });
    if (f.ids) {
      var n = YES.fmt.count(f.ids.length);
      list.push({ id: 'ids', label: f.idsLabel ? t('explorer.chip.idsLabel', { label: YES.L(f.idsLabel), n: n }) : t('explorer.chip.ids', { n: n }) });
    }
    if (f.from || f.to) {
      var bl = t('explorer.basis.' + b + 'Cap');
      var label;
      if (f.from && f.to) label = t('explorer.chip.dateRange', { basis: bl, range: f.from <= f.to ? YES.fmt.range(dayIso(f.from), dayIso(f.to)) : YES.fmt.date(dayIso(f.from), 'long') + ' – ' + YES.fmt.date(dayIso(f.to), 'long') });
      else if (f.from) label = t('explorer.chip.dateFrom', { basis: bl, date: YES.fmt.date(dayIso(f.from), 'long') });
      else label = t('explorer.chip.dateTo', { basis: bl, date: YES.fmt.date(dayIso(f.to), 'long') });
      list.push({ id: 'date', label: label });
    }
    if (f.direction !== 'all') list.push({ id: 'dir', label: t('explorer.chip.dir', { label: t('explorer.dir.' + f.direction) }) });
    f.types.forEach(function (ty) {
      list.push({ id: 'type:' + ty, label: t('explorer.chip.type', { label: ui.typeLabel(ty) }) });
    });
    f.statuses.forEach(function (s) {
      list.push({ id: 'status:' + s, label: t('explorer.chip.status', { label: statusLabel(s) }) });
    });
    f.rails.forEach(function (r) {
      list.push({ id: 'rail:' + r, label: t('explorer.chip.rail', { label: railLabel(r) }) });
    });
    if (f.min.trim() || f.max.trim()) {
      var mn = parseAmount(f.min, f.amountLang);
      var mx = parseAmount(f.max, f.amountLang);
      var show = function (p, raw) {
        return p.value != null ? YES.fmt.amount(p.value, { sign: 'never' }) : raw.trim();
      };
      var al;
      if (f.min.trim() && f.max.trim()) al = t('explorer.chip.amountRange', { min: show(mn, f.min), max: show(mx, f.max) });
      else if (f.min.trim()) al = t('explorer.chip.amountMin', { min: show(mn, f.min) });
      else al = t('explorer.chip.amountMax', { max: show(mx, f.max) });
      list.push({ id: 'amount', label: al });
    }
    return list;
  }
  /** Number of filters set in the filter panel (search, journey step and id lists have their own controls). */
  function panelCount() {
    return chips().filter(function (c) {
      return c.id !== 'q' && c.id !== 'step' && c.id !== 'ids';
    }).length;
  }
  function removeChip(id) {
    var f = F();
    var p = id.split(':');
    if (id === 'q') return setFilters({ q: '' });
    if (id === 'step') return setFilters({ step: null });
    if (id === 'ids') return setFilters({ ids: null, idsLabel: null });
    if (id === 'date') return setFilters({ from: '', to: '' });
    if (id === 'dir') return setFilters({ direction: 'all' });
    if (id === 'amount') return setFilters({ min: '', max: '' });
    var map = { type: 'types', status: 'statuses', rail: 'rails' };
    if (map[p[0]]) {
      var patch = {};
      patch[map[p[0]]] = f[map[p[0]]].filter(function (v) {
        return v !== p[1];
      });
      return setFilters(patch);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Rendering: view shell                                               */
  /* ------------------------------------------------------------------ */
  function dirIcon(tx) {
    var cls = tx.amount > 0 ? 'in' : tx.amount < 0 ? 'out' : 'neutral';
    return '<span class="dir dir--' + cls + ' tx-dir">' + ui.icon(ui.typeIcon(tx.type), { size: 18 }) + '</span>';
  }

  function headHtml() {
    var s = st();
    return (
      '<header class="tx-head">' +
      '<h1 id="h-transactions" class="view-title" data-view-heading tabindex="-1">' +
      esc(t('explorer.title')) +
      '</h1>' +
      '<p class="view-lede">' +
      esc(t('explorer.lede', { period: YES.fmt.range(s.periodStart, s.periodEnd), n: YES.fmt.count(allTx().length) })) +
      ' <strong>' +
      esc(t('term.dateBasisNote')) +
      '</strong> ' +
      esc(t('explorer.ledeTimes', { tz: YES.fmt.tz(s.asOf) })) +
      '</p>' +
      '</header>'
    );
  }

  function sortOptionsHtml() {
    var s = S();
    return SORTS.map(function (o) {
      var v = o.key + ':' + o.dir;
      return '<option value="' + v + '"' + (o.key === s.key && o.dir === s.dir ? ' selected' : '') + '>' + esc(t('explorer.sort.' + o.key + '.' + o.dir)) + '</option>';
    }).join('');
  }

  function barHtml() {
    var f = F();
    var n = panelCount();
    var open = !!viewPrefs().filtersOpen;
    return (
      '<div class="tx-bar">' +
      '<div class="tx-search field" role="search" aria-label="' +
      esc(t('explorer.search.region')) +
      '">' +
      '<label class="field__label" for="tx-q">' +
      esc(t('explorer.search.label')) +
      '</label>' +
      '<div class="input-icon tx-search__box">' +
      ui.icon('search', { size: 18 }) +
      '<input id="tx-q" class="input" type="search" data-fk="tx-q" data-tx-q autocomplete="off" spellcheck="false" enterkeyhint="search" aria-describedby="tx-q-hint" placeholder="' +
      esc(t('explorer.search.placeholder')) +
      '" value="' +
      esc(f.q) +
      '">' +
      '<button type="button" class="tx-search__clear" data-tx-q-clear data-fk="tx-q-clear" aria-label="' +
      esc(t('explorer.search.clear')) +
      '"' +
      (f.q ? '' : ' hidden') +
      '>' +
      ui.icon('close', { size: 18 }) +
      '</button>' +
      '</div>' +
      '<p id="tx-q-hint" class="field__hint">' +
      esc(t('explorer.search.hint')) +
      '</p>' +
      '</div>' +
      '<div class="tx-bar__tools">' +
      '<button type="button" class="btn tx-filter-toggle" data-tx-toggle data-fk="tx-filters-toggle" aria-controls="tx-filter-panel" aria-expanded="' +
      open +
      '">' +
      ui.icon('filter', { size: 18 }) +
      '<span>' +
      esc(t('explorer.filters.toggle')) +
      '</span><span class="tx-badge" data-tx-badge' +
      (n ? '' : ' hidden') +
      '><span aria-hidden="true">' +
      esc(YES.fmt.count(n)) +
      '</span><span class="sr-only">' +
      esc(t('explorer.filters.activeN', { n: YES.fmt.count(n) })) +
      '</span></span>' +
      ui.icon('chevron-down', { size: 16, cls: 'tx-filter-toggle__chev' }) +
      '</button>' +
      '<div class="tx-sort field">' +
      '<label class="field__label" for="tx-sort">' +
      esc(t('explorer.sort.label')) +
      '</label>' +
      '<select id="tx-sort" class="select" data-fk="tx-sort" data-tx-sort>' +
      sortOptionsHtml() +
      '</select>' +
      '</div>' +
      '</div>' +
      '</div>'
    );
  }

  /**
   * Facet counts: how many transactions each option would show, given every
   * other active filter and the search (an option's own group is left out, so
   * the numbers say what ticking it would add). Options that would show nothing
   * are de-emphasised but stay operable.
   */
  function facetCounts() {
    var out = { direction: { all: 0, in: 0, out: 0 }, types: {}, statuses: {}, rails: {} };
    run('direction').forEach(function (r) {
      out.direction.all++;
      if (r.tx.amount > 0) out.direction['in']++;
      else if (r.tx.amount < 0) out.direction.out++;
    });
    ['types', 'statuses', 'rails'].forEach(function (g) {
      run(g).forEach(function (r) {
        var v = facetValue(g, r.tx);
        out[g][v] = (out[g][v] || 0) + 1;
      });
    });
    return out;
  }
  function facetValue(group, tx) {
    return group === 'types' ? tx.type : group === 'statuses' ? statusOf(tx) : tx.rail;
  }
  function countHtml(group, v, n) {
    return (
      '<span class="tx-check__n" data-tx-n="' +
      esc(group + ':' + v) +
      '"><span aria-hidden="true">' +
      esc(YES.fmt.count(n)) +
      '</span><span class="sr-only">' +
      esc(t('explorer.filters.nMatching', { n: YES.fmt.count(n) })) +
      '</span></span>'
    );
  }

  function checkGroupHtml(group, legendKey, values, labelFn, selected, counts) {
    var items = values
      .map(function (v) {
        var id = 'tx-' + group + '-' + v;
        var n = counts[group][v] || 0;
        return (
          '<label class="tx-check' +
          (n ? '' : ' is-zero') +
          '" for="' +
          id +
          '"><input type="checkbox" id="' +
          id +
          '" value="' +
          esc(v) +
          '" data-tx-f="' +
          group +
          '" data-fk="' +
          id +
          '"' +
          (selected.indexOf(v) !== -1 ? ' checked' : '') +
          '><span class="tx-check__label">' +
          esc(labelFn(v)) +
          '</span>' +
          countHtml(group, v, n) +
          '</label>'
        );
      })
      .join('');
    return '<fieldset class="tx-fs"><legend class="tx-fs__legend">' + esc(t(legendKey)) + '</legend><div class="tx-checks">' + items + '</div></fieldset>';
  }

  function presentValues(order, getter) {
    var present = {};
    allTx().forEach(function (tx) {
      present[getter(tx)] = true;
    });
    var out = order.filter(function (v) {
      return present[v];
    });
    Object.keys(present).forEach(function (v) {
      if (out.indexOf(v) === -1) out.push(v);
    });
    return out;
  }

  function filtersHtml() {
    var f = F();
    var b = filterBasis();
    var bounds = dateBounds(b);
    var open = !!viewPrefs().filtersOpen;
    var counts = facetCounts();
    var dirIcons = { all: 'sort', in: 'arrow-in', out: 'arrow-out' };
    var dirs = ['all', 'in', 'out']
      .map(function (d) {
        return (
          '<label class="tx-check tx-check--radio' +
          (counts.direction[d] ? '' : ' is-zero') +
          '" for="tx-dir-' +
          d +
          '"><input type="radio" id="tx-dir-' +
          d +
          '" name="tx-dir" value="' +
          d +
          '" data-tx-f="direction" data-fk="tx-dir-' +
          d +
          '"' +
          (f.direction === d ? ' checked' : '') +
          '>' +
          ui.icon(dirIcons[d], { size: 16, cls: 'tx-check__icon' }) +
          '<span class="tx-check__label">' +
          esc(t('explorer.dir.' + d)) +
          '</span>' +
          countHtml('direction', d, counts.direction[d]) +
          '</label>'
        );
      })
      .join('');
    var types = presentValues(TYPE_ORDER, function (tx) {
      return tx.type;
    });
    var statuses = presentValues(STATUS_ORDER, statusOf);
    var rails = presentValues(RAIL_ORDER, function (tx) {
      return tx.rail;
    });
    var dateField = function (which) {
      return (
        '<div class="field"><label class="field__label tx-sublabel" for="tx-' +
        which +
        '">' +
        esc(t('explorer.filters.' + which)) +
        '</label><input type="date" id="tx-' +
        which +
        '" class="input tx-date-input" data-tx-f="' +
        which +
        '" data-fk="tx-' +
        which +
        '" min="' +
        bounds.min +
        '" max="' +
        bounds.max +
        '" value="' +
        esc(f[which]) +
        '" aria-describedby="tx-date-err"></div>'
      );
    };
    var amountField = function (which) {
      return (
        '<div class="field"><label class="field__label tx-sublabel" for="tx-' +
        which +
        '">' +
        esc(t('explorer.filters.' + which)) +
        '</label><input type="text" inputmode="decimal" autocomplete="off" id="tx-' +
        which +
        '" class="input" data-tx-f="' +
        which +
        '" data-fk="tx-' +
        which +
        '" value="' +
        esc(f[which]) +
        '" aria-describedby="tx-amt-hint tx-amt-err"></div>'
      );
    };
    return (
      '<section class="tx-filters" id="tx-filter-panel" aria-labelledby="tx-filters-title" data-open="' +
      open +
      '">' +
      '<h2 id="tx-filters-title" class="tx-filters__title">' +
      ui.icon('filter', { size: 18 }) +
      '<span>' +
      esc(t('explorer.filters.title')) +
      '</span></h2>' +
      '<form class="tx-filters__form" data-tx-form novalidate>' +
      '<fieldset class="tx-fs"><legend class="tx-fs__legend" id="tx-date-legend">' +
      esc(t('explorer.filters.dateLegend', { basis: t('explorer.basis.' + b) })) +
      '</legend><div class="tx-pair">' +
      dateField('from') +
      dateField('to') +
      '</div><p class="field__error" id="tx-date-err" hidden></p></fieldset>' +
      '<fieldset class="tx-fs"><legend class="tx-fs__legend">' +
      esc(t('explorer.filters.direction')) +
      '</legend><div class="tx-checks">' +
      dirs +
      '</div></fieldset>' +
      checkGroupHtml('types', 'explorer.filters.type', types, function (v) {
        return ui.typeLabel(v);
      }, f.types, counts) +
      checkGroupHtml('statuses', 'explorer.filters.status', statuses, statusLabel, f.statuses, counts) +
      checkGroupHtml('rails', 'explorer.filters.rail', rails, railLabel, f.rails, counts) +
      '<fieldset class="tx-fs"><legend class="tx-fs__legend">' +
      esc(t('explorer.filters.amount')) +
      '</legend><p class="field__hint tx-fs__hint" id="tx-amt-hint">' +
      esc(t('explorer.filters.amountHint', { symbol: asset().symbol })) +
      '</p><div class="tx-pair">' +
      amountField('min') +
      amountField('max') +
      '</div><p class="field__error" id="tx-amt-err" hidden></p></fieldset>' +
      '</form>' +
      '<div class="tx-filters__foot">' +
      '<button type="button" class="btn btn--primary" data-tx-done data-fk="tx-filters-done"></button>' +
      '<button type="button" class="btn btn--ghost" data-tx-clear data-fk="tx-filters-clear">' +
      esc(t('common.clearAll')) +
      '</button>' +
      '</div>' +
      '</section>'
    );
  }

  /**
   * The statement-of-record PDF is composed by the help module (the same record
   * as its print view, see "Download or print" in Help). A build without that
   * module has no PDF, so the button is left out rather than shown dead.
   */
  function pdfAvailable() {
    return !!(YES.help && typeof YES.help.downloadPdf === 'function');
  }

  function exportHtml(count) {
    var pdf = pdfAvailable();
    // The statement of record first (Print, and the same record as a PDF file
    // beside it), then the two CSV exports of the ledger.
    return (
      '<section class="tx-export card card--flat" aria-labelledby="tx-export-title">' +
      '<div class="tx-export__text"><h2 id="tx-export-title" class="tx-export__title">' +
      ui.icon('download', { size: 20 }) +
      '<span>' +
      esc(t('explorer.export.title')) +
      '</span></h2>' +
      '<p class="tx-export__body">' +
      esc(t(pdf ? 'explorer.export.bodyPdf' : 'explorer.export.body')) +
      '</p></div>' +
      '<div class="tx-export__actions' +
      (pdf ? ' tx-export__actions--pairs' : '') +
      '">' +
      '<button type="button" class="btn" data-tx-print data-fk="tx-print">' +
      ui.icon('print', { size: 18 }) +
      '<span>' +
      esc(t('common.print')) +
      '</span></button>' +
      (pdf
        ? '<button type="button" class="btn" data-tx-pdf data-fk="tx-pdf">' + ui.icon('file-down', { size: 18 }) + '<span>' + esc(t('explorer.export.pdf')) + '</span></button>'
        : '') +
      '<button type="button" class="btn" data-tx-csv="all" data-fk="tx-csv-all">' +
      ui.icon('download', { size: 18 }) +
      '<span>' +
      esc(t('explorer.export.all')) +
      '</span></button>' +
      '<button type="button" class="btn" data-tx-csv="filtered" data-fk="tx-csv-view"' +
      (count ? '' : ' disabled') +
      '>' +
      ui.icon('download', { size: 18 }) +
      '<span data-tx-csv-label>' +
      esc(t('explorer.export.view', { n: YES.fmt.count(count) })) +
      '</span></button>' +
      '</div>' +
      '</section>'
    );
  }

  /* ------------------------------------------------------------------ */
  /* Rendering: chips and results                                        */
  /* ------------------------------------------------------------------ */
  function chipsHtml() {
    var list = chips();
    if (!list.length) return '';
    var f = F();
    var items = list
      .map(function (c) {
        return (
          '<li><button type="button" class="chip tx-chip" data-tx-chip="' +
          esc(c.id) +
          '" data-fk="tx-chip-' +
          esc(c.id) +
          '" aria-label="' +
          esc(t('explorer.chip.remove', { label: c.label })) +
          '"><span class="tx-chip__label">' +
          esc(c.label) +
          '</span><span class="tx-chip__x">' +
          ui.icon('close', { size: 16 }) +
          '</span></button></li>'
        );
      })
      .join('');
    return (
      '<div class="tx-chips" role="group" aria-labelledby="tx-chips-label">' +
      '<span class="tx-chips__label" id="tx-chips-label">' +
      esc(t('explorer.chips.label')) +
      '</span>' +
      '<ul class="tx-chips__list">' +
      items +
      '</ul>' +
      '<button type="button" class="btn btn--sm btn--ghost tx-chips__clear" data-tx-clear data-fk="tx-clear">' +
      esc(t('common.clearAll')) +
      '</button>' +
      (f.step
        ? '<a class="tx-chips__back" href="#/overview" data-nav="overview" data-fk="tx-back-journey">' + ui.icon('arrow-left', { size: 16 }) + '<span>' + esc(t('explorer.backToJourney')) + '</span></a>'
        : '') +
      '</div>'
    );
  }

  function countText(shown, total, filteredView) {
    if (!filteredView) return t('explorer.count.all', { total: YES.fmt.count(total) });
    return t('explorer.count.some', { shown: YES.fmt.count(shown), total: YES.fmt.count(total) });
  }

  function totalsHtml(rows, filteredView) {
    var posted = rows.filter(function (r) {
      return YES.calc.inBalance(r.tx);
    });
    var pend = rows.filter(function (r) {
      return !YES.calc.inBalance(r.tx);
    });
    var html = '';
    if (posted.length) {
      var sum = posted.reduce(function (s, r) {
        return s + r.tx.amount;
      }, 0);
      var key = filteredView ? (posted.length === 1 ? 'explorer.total.filtered1' : 'explorer.total.filteredN') : posted.length === 1 ? 'explorer.total.all1' : 'explorer.total.allN';
      html += '<p class="tx-total" data-tx-total>' + tHtml(key, { n: YES.fmt.count(posted.length) }, { amount: '<strong>' + ui.amountHtml(sum) + '</strong>' }) + '</p>';
    } else if (rows.length) {
      html += '<p class="tx-total" data-tx-total>' + esc(t('explorer.total.none')) + '</p>';
    }
    if (pend.length) {
      var psum = pend.reduce(function (s, r) {
        return s + r.tx.amount;
      }, 0);
      html +=
        '<p class="tx-pending-note">' +
        ui.icon('clock', { size: 16 }) +
        '<span>' +
        tHtml(pend.length === 1 ? 'explorer.pendingNote1' : 'explorer.pendingNoteN', { n: YES.fmt.count(pend.length) }, { amount: ui.amountHtml(psum) }) +
        '</span></p>';
    }
    var undated = rows.undated || [];
    if (undated.length) {
      html +=
        '<p class="tx-basis-note" data-tx-undated>' +
        ui.icon('info', { size: 16 }) +
        '<span>' +
        esc(t(undated.length === 1 ? 'explorer.undatedNote1' : 'explorer.undatedNoteN', { n: YES.fmt.count(undated.length), basis: t('explorer.basis.' + filterBasis()) })) +
        '</span></p>';
    }
    if (shownBasis() !== filterBasis()) {
      html += '<p class="tx-basis-note">' + ui.icon('info', { size: 16 }) + '<span>' + esc(t('explorer.initiatedNote')) + '</span></p>';
    }
    return html;
  }

  function matchLineHtml(match, terms) {
    if (!match || !match.length) return '';
    var parts = [];
    FIELD_ORDER.forEach(function (key) {
      var hits = match.filter(function (m) {
        return m.key === key;
      });
      if (!hits.length) return;
      var shown = hits.filter(function (m) {
        return m.shown;
      });
      var label = esc(t('explorer.field.' + key));
      if (shown.length) parts.push(label);
      else parts.push(label + ' <span class="tx-match__value">' + hl(hits[0].text, terms) + '</span>');
    });
    return '<p class="tx-match">' + ui.icon('search', { size: 14 }) + '<span><span class="tx-match__label">' + esc(t('explorer.match.in')) + '</span> ' + parts.join(' · ') + '</span></p>';
  }

  /**
   * The row's accessible name. A date that is not the posted date says which
   * date it is, and a transaction outside the statement balance says so, so the
   * name never presents a pending amount like a posted one.
   */
  function openLabel(tx, b) {
    var unposted = !tx.postedAt;
    var iso = basisIso(tx, b);
    var date = YES.fmt.date(iso, 'medium');
    if (b === 'initiated' || unposted) date = t('explorer.row.initiatedDate', { date: date });
    var label = t('explorer.row.openLabel', {
      description: YES.L(tx.description),
      counterparty: YES.fmt.maskedSpoken(YES.L(tx.counterparty)),
      date: date,
      amount: YES.fmt.amountSpoken(tx.amount, { sign: 'always' })
    });
    if (!YES.calc.inBalance(tx)) {
      label = t('explorer.row.openLabelNotIn', { label: label, status: statusLabel(statusOf(tx)), notIn: t('status.notInBalance') });
    }
    return label + ' ' + t('explorer.row.viewDetails');
  }
  function openButton(tx, terms, b) {
    return (
      '<button type="button" class="tx-open" data-tx-open="' +
      esc(tx.id) +
      '" data-fk="tx-open-' +
      esc(tx.id) +
      '" aria-label="' +
      esc(openLabel(tx, b)) +
      '">' +
      hl(YES.L(tx.description), terms) +
      '</button>'
    );
  }
  /** Keep masked identifiers ("•••• 4821") on one line. */
  function nb(text) {
    return String(text == null ? '' : text).replace(/(•+) (?=\S)/g, '$1\u00a0').replace(/ (?=•)/g, '\u00a0');
  }
  /**
   * Highlighted text whose masked identifiers are spoken as "ending in 4821"
   * (ui.maskedHtml) instead of "bullet bullet…".
   */
  function hlMasked(text, terms) {
    var str = nb(text);
    var re = new RegExp(YES.fmt.MASK_RE.source, 'g');
    var out = '';
    var last = 0;
    var m;
    while ((m = re.exec(str))) {
      out += hl(str.slice(last, m.index), terms);
      out += '<span class="tx-mask"><span aria-hidden="true">' + hl(m[0], terms) + '</span><span class="sr-only">' + esc(t('fmt.maskedEnding', { tail: m[2] })) + '</span></span>';
      last = m.index + m[0].length;
    }
    return out + hl(str.slice(last), terms);
  }
  /** The customer's own memo, quoted for the UI language, tagged with the language it was written in. */
  function memoHtml(tx, terms) {
    var own = typeof tx.memo === 'string';
    var lang = own && st().language && st().language !== YES.i18n.lang ? ' lang="' + esc(st().language) + '"' : '';
    return tHtml('explorer.memoQuoted', {}, { memo: '<span' + lang + '>' + hl(YES.L(tx.memo), terms) + '</span>' });
  }
  function subLineHtml(tx, terms, withType) {
    return (
      '<span class="tx-sub">' +
      (withType ? '<span class="tx-type-inline">' + hl(ui.typeLabel(tx), terms) + ' · </span>' : '') +
      hlMasked(YES.L(tx.counterparty), terms) +
      (tx.memo ? ' · <span class="tx-memo">' + memoHtml(tx, terms) + '</span>' : '') +
      '</span>'
    );
  }
  /** Status chip; when the search matched the status, its label is highlighted in place. */
  function statusChipHtml(tx, match, terms) {
    var html = ui.statusHtml(tx.status);
    if (!hitKey(match, 'status')) return html;
    var label = esc(statusLabel(statusOf(tx)));
    return html.replace('<span>' + label + '</span>', '<span>' + hl(statusLabel(statusOf(tx)), terms) + '</span>');
  }
  /** Amount; marked as a whole when a search word named it. */
  function amountCellHtml(tx, match, opts) {
    var html = ui.amountHtml(tx.amount, opts);
    return hitKey(match, 'amount') ? '<mark class="tx-mark-amount">' + html + '</mark>' : html;
  }
  function pendingLineHtml(tx) {
    if (YES.calc.inBalance(tx)) return '';
    return '<span class="tx-notin">' + ui.icon('clock', { size: 14 }) + '<span>' + esc(t('status.notInBalance')) + '</span></span>';
  }
  function dateParts(tx, b) {
    var iso = basisIso(tx, b);
    var unposted = b === 'posted' && !tx.postedAt;
    var time = YES.fmt.date(iso, 'time').replace(/\s/g, '\u00a0'); // "10:47 PM" never splits
    return {
      day: YES.fmt.date(iso, 'short'),
      time: unposted ? t('explorer.row.initiated', { time: time }) : time,
      prev: b === 'initiated' && YES.fmt.isoDate(iso) < YES.fmt.isoDate(st().periodStart)
    };
  }

  function rowHtml(r, terms, b) {
    var tx = r.tx;
    var pending = !YES.calc.inBalance(tx);
    var d = dateParts(tx, b);
    return (
      '<tr class="tx-row' +
      (pending ? ' tx-row--pending' : '') +
      '" data-tx-row="' +
      esc(tx.id) +
      '">' +
      '<td class="tx-date"><span class="tx-date__day">' +
      esc(d.day) +
      '</span><span class="tx-date__time">' +
      esc(d.time) +
      '</span>' +
      (d.prev ? '<span class="tag tx-prev">' + esc(t('explorer.row.prevPeriod')) + '</span>' : '') +
      '</td>' +
      '<td class="tx-cell-desc"><div class="tx-desc">' +
      dirIcon(tx) +
      '<div class="tx-desc__text">' +
      openButton(tx, terms, b) +
      subLineHtml(tx, terms, true) +
      // Shown instead of the Status column when the table is narrow (container query).
      '<span class="tx-status-inline">' +
      statusChipHtml(tx, r.match, terms) +
      '</span>' +
      pendingLineHtml(tx) +
      matchLineHtml(r.match, terms) +
      '</div></div></td>' +
      '<td class="tx-status">' +
      statusChipHtml(tx, r.match, terms) +
      '</td>' +
      '<td class="num tx-amount">' +
      amountCellHtml(tx, r.match, { unit: false }) +
      '</td>' +
      '<td class="num tx-balance">' +
      (pending
        ? '<span aria-hidden="true">—</span><span class="sr-only">' + esc(t('status.notInBalance')) + '</span>'
        : esc(YES.fmt.amount(tx.balanceAfter, { unit: false }))) +
      '</td>' +
      '</tr>'
    );
  }

  function cardHtml(r, terms, b, i) {
    var tx = r.tx;
    var pending = !YES.calc.inBalance(tx);
    var d = dateParts(tx, b);
    return (
      '<li class="tx-card' +
      (pending ? ' tx-card--pending' : '') +
      '" data-tx-row="' +
      esc(tx.id) +
      '" style="--i:' +
      i +
      '">' +
      dirIcon(tx) +
      '<div class="tx-card__body">' +
      '<div class="tx-card__top"><span class="tx-card__meta"><span class="tx-card__type">' +
      hl(ui.typeLabel(tx), terms) +
      '</span> · ' +
      esc(b === 'posted' && !tx.postedAt ? t('explorer.row.initiatedOn', { date: d.day }) : d.day) +
      (d.prev ? ' <span class="tag tx-prev">' + esc(t('explorer.row.prevPeriod')) + '</span>' : '') +
      '</span>' +
      amountCellHtml(tx, r.match, { cls: 'tx-card__amount' }) +
      '</div>' +
      openButton(tx, terms, b) +
      subLineHtml(tx, terms) +
      matchLineHtml(r.match, terms) +
      '<div class="tx-card__foot">' +
      statusChipHtml(tx, r.match, terms) +
      (pending ? pendingLineHtml(tx) : '<span class="tx-card__bal">' + esc(t('explorer.row.balanceAfter', { amount: YES.fmt.amount(tx.balanceAfter, { unit: false }) })) + '</span>') +
      '</div>' +
      '</div></li>'
    );
  }

  function captionText() {
    var s = S();
    return t('explorer.caption', { sort: t('explorer.sort.' + s.key + '.' + s.dir), basis: t('explorer.basis.' + shownBasis()), symbol: asset().symbol, tz: YES.fmt.tz(st().asOf) });
  }

  function emptyHtml(list) {
    var applied = list
      .map(function (c) {
        return c.label;
      })
      .join(' · ');
    return (
      '<div class="empty tx-empty">' +
      ui.icon('search', { size: 32 }) +
      '<h3>' +
      esc(t('explorer.empty.title')) +
      '</h3>' +
      '<p class="tx-empty__applied">' +
      esc(t('explorer.empty.applied', { applied: applied })) +
      '</p>' +
      '<p class="tx-empty__hint">' +
      esc(t('explorer.empty.hint')) +
      '</p>' +
      '<button type="button" class="btn btn--primary" data-tx-clear data-fk="tx-empty-clear">' +
      esc(t('explorer.empty.clear')) +
      '</button>' +
      '</div>'
    );
  }

  function resultsHtml(rows) {
    var total = allTx().length;
    var list = chips();
    var filteredView = list.length > 0;
    var terms = queryTerms(F().q);
    var b = shownBasis();
    var s = S();
    var html =
      '<div class="tx-results__head">' +
      '<h2 id="tx-results-title" class="tx-results__count" tabindex="-1" data-fk="tx-results-title">' +
      esc(countText(rows.length, total, filteredView)) +
      '</h2>' +
      totalsHtml(rows, filteredView) +
      '</div>';
    if (!rows.length) return html + emptyHtml(list);
    var entering = enterNext && !ui.reducedMotion() ? ' is-entering' : '';
    layout.table = tableMode();
    if (layout.table) {
      var dateSort = s.key === 'amount' ? '' : ' aria-sort="' + (s.dir === 'asc' ? 'ascending' : 'descending') + '"';
      var amtSort = s.key === 'amount' ? ' aria-sort="' + (s.dir === 'asc' ? 'ascending' : 'descending') + '"' : '';
      html +=
        '<div class="table-wrap tx-table-wrap' +
        entering +
        '"><table class="table tx-table"><caption class="tx-caption">' +
        esc(captionText()) +
        '</caption><thead><tr>' +
        '<th scope="col" class="tx-col-date"' +
        dateSort +
        '>' +
        esc(t('explorer.col.date.' + b)) +
        '</th>' +
        '<th scope="col">' +
        esc(t('explorer.col.description')) +
        '</th>' +
        '<th scope="col" class="tx-col-status">' +
        esc(t('explorer.col.status')) +
        '</th>' +
        '<th scope="col" class="num"' +
        amtSort +
        '>' +
        esc(t('explorer.col.amount')) +
        '</th>' +
        '<th scope="col" class="num">' +
        esc(t('explorer.col.balance')) +
        '</th>' +
        '</tr></thead><tbody>' +
        rows
          .map(function (r) {
            return rowHtml(r, terms, b);
          })
          .join('') +
        '</tbody></table></div>';
    } else {
      html +=
        '<p class="tx-caption tx-caption--cards" id="tx-cards-caption">' +
        esc(captionText()) +
        '</p><ul class="tx-cards' +
        entering +
        '" aria-labelledby="tx-results-title tx-cards-caption">' +
        rows
          .map(function (r, i) {
            return cardHtml(r, terms, b, Math.min(i, 12));
          })
          .join('') +
        '</ul>';
    }
    return html;
  }

  /* ------------------------------------------------------------------ */
  /* Render orchestration                                                */
  /* ------------------------------------------------------------------ */
  function renderView() {
    if (!els.root) return;
    var rows = run();
    var html =
      headHtml() +
      barHtml() +
      '<div class="tx-layout">' +
      filtersHtml() +
      '<div class="tx-main"><div id="tx-chips" class="tx-chips-wrap">' +
      chipsHtml() +
      '</div><div id="tx-results" class="tx-results">' +
      resultsHtml(rows) +
      '</div></div>' +
      '</div>' +
      exportHtml(rows.length);
    enterNext = false;
    ui.render(els.root, html);
    syncControls(rows);
  }

  /** Partial update after a filter or sort change: never touches the inputs being typed in. */
  function update() {
    if (!els.root || !els.root.firstChild) return;
    var rows = run();
    ui.render(els.root.querySelector('#tx-chips'), chipsHtml());
    ui.render(els.root.querySelector('#tx-results'), resultsHtml(rows));
    enterNext = false;
    syncControls(rows);
  }

  function setInvalid(input, bad) {
    if (!input) return;
    if (bad) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  }
  function showError(id, msg) {
    var el = els.root.querySelector('#' + id);
    if (!el) return;
    if (msg) {
      ui.render(el, ui.icon('alert', { size: 16 }) + '<span>' + esc(msg) + '</span>');
      el.hidden = false;
    } else {
      el.textContent = '';
      el.hidden = true;
    }
  }

  /** Bring every control in line with YES.state (values only; no re-render). */
  function syncControls(rows) {
    var r = els.root;
    if (!r || !r.firstChild) return;
    rows = rows || run();
    var f = F();
    var s = S();
    var b = filterBasis();
    var bounds = dateBounds(b);
    var q = r.querySelector('#tx-q');
    if (q && q.value !== f.q) q.value = f.q;
    var qc = r.querySelector('[data-tx-q-clear]');
    if (qc) qc.hidden = !f.q;

    ['from', 'to'].forEach(function (w) {
      var el = r.querySelector('#tx-' + w);
      if (!el) return;
      if (el.value !== f[w]) el.value = f[w];
      // Touch the bounds only when the basis changes them (rewriting them rebuilds Chrome's date editor).
      if (el.min !== bounds.min) el.min = bounds.min;
      if (el.max !== bounds.max) el.max = bounds.max;
    });
    var legend = r.querySelector('#tx-date-legend');
    if (legend) legend.textContent = t('explorer.filters.dateLegend', { basis: t('explorer.basis.' + b) });
    var badOrder = f.from && f.to && f.from > f.to;
    setInvalid(r.querySelector('#tx-to'), badOrder);
    showError('tx-date-err', badOrder ? t('explorer.filters.dateError') : '');

    ui.$$('[data-tx-f="direction"]', r).forEach(function (el) {
      el.checked = el.value === f.direction;
    });
    ['types', 'statuses', 'rails'].forEach(function (g) {
      ui.$$('[data-tx-f="' + g + '"]', r).forEach(function (el) {
        el.checked = f[g].indexOf(el.value) !== -1;
      });
    });
    var mn = parseAmount(f.min, f.amountLang);
    var mx = parseAmount(f.max, f.amountLang);
    ['min', 'max'].forEach(function (w) {
      var el = r.querySelector('#tx-' + w);
      if (el && el.value !== f[w]) el.value = f[w];
    });
    var amtErr = '';
    if (mn.error || mx.error) amtErr = t('explorer.filters.amountInvalid');
    else if (mn.value != null && mx.value != null && mn.value > mx.value) amtErr = t('explorer.filters.amountOrder');
    setInvalid(r.querySelector('#tx-min'), !!mn.error);
    setInvalid(r.querySelector('#tx-max'), !!mx.error || (!mn.error && !mx.error && mn.value != null && mx.value != null && mn.value > mx.value));
    showError('tx-amt-err', amtErr);

    var sel = r.querySelector('#tx-sort');
    if (sel && sel.value !== s.key + ':' + s.dir) sel.value = s.key + ':' + s.dir;

    var counts = facetCounts();
    ui.$$('[data-tx-n]', r).forEach(function (el) {
      var p = el.getAttribute('data-tx-n').split(':');
      var n = (counts[p[0]] || {})[p[1]] || 0;
      var shown = YES.fmt.count(n);
      if (el.firstChild.textContent !== shown) {
        el.firstChild.textContent = shown;
        el.lastChild.textContent = t('explorer.filters.nMatching', { n: shown });
      }
      var label = el.closest('.tx-check');
      if (label) label.classList.toggle('is-zero', !n);
    });

    var n = panelCount();
    var badge = r.querySelector('[data-tx-badge]');
    if (badge) {
      badge.hidden = !n;
      badge.firstChild.textContent = YES.fmt.count(n);
      badge.lastChild.textContent = t('explorer.filters.activeN', { n: YES.fmt.count(n) });
    }
    var open = !!viewPrefs().filtersOpen;
    var toggle = r.querySelector('[data-tx-toggle]');
    if (toggle) toggle.setAttribute('aria-expanded', String(open));
    var panel = r.querySelector('#tx-filter-panel');
    if (panel) panel.setAttribute('data-open', String(open));
    var done = r.querySelector('[data-tx-done]');
    if (done) done.textContent = t('explorer.filters.showResults', { n: YES.fmt.count(rows.length) });

    var csv = r.querySelector('[data-tx-csv="filtered"]');
    if (csv) {
      csv.disabled = !rows.length;
      var lbl = csv.querySelector('[data-tx-csv-label]');
      if (lbl) lbl.textContent = t('explorer.export.view', { n: YES.fmt.count(rows.length) });
    }
  }

  function countAnnouncement() {
    var rows = run();
    var list = chips();
    if (!rows.length) return t('explorer.announce.none', { total: YES.fmt.count(allTx().length) });
    return countText(rows.length, allTx().length, list.length > 0) + '.';
  }
  function announceCount(delay) {
    clearTimeout(timers.announce);
    timers.announce = setTimeout(function () {
      ui.announce(countAnnouncement());
    }, delay || 0);
  }

  function focusResults() {
    var el = els.root && els.root.querySelector('#tx-results-title');
    if (!el) return;
    el.focus({ preventScroll: true });
    if (!el.scrollIntoView) return;
    var behavior = ui.reducedMotion() ? 'auto' : 'smooth';
    if (ui.isNarrow()) {
      // On small screens bring the active chips and the first rows into view together.
      var chipsEl = els.root.querySelector('#tx-chips');
      (chipsEl && chipsEl.firstChild ? chipsEl : el).scrollIntoView({ block: 'start', behavior: behavior });
    } else {
      el.scrollIntoView({ block: 'nearest', behavior: behavior });
    }
  }

  /* ------------------------------------------------------------------ */
  /* Public filter API                                                   */
  /* ------------------------------------------------------------------ */
  /**
   * opts: reset (start from the default filters), navigate (default true: go to
   * Transactions), focus ('results' | 'heading' | false), announce (default
   * true: announce the result count; false for a caller that announces its own
   * summary, so the count does not talk over it).
   */
  function applyFilter(partial, opts) {
    partial = partial || {};
    opts = opts || {};
    var navigate = opts.navigate !== false;
    var focus = opts.focus === undefined ? 'results' : opts.focus;
    var f = opts.reset ? YES.defaultFilters() : F();
    if (!opts.reset) f.idsLabel = F().idsLabel;
    Object.keys(partial).forEach(function (k) {
      f[k] = Array.isArray(partial[k]) ? partial[k].slice() : partial[k];
    });
    // A journey step and an explicit id list are alternative scopes.
    if (partial.step && !('ids' in partial)) {
      f.ids = null;
      f.idsLabel = null;
    }
    if (partial.ids && !('step' in partial)) f.step = null;
    if (!f.ids) f.idsLabel = null;
    stampAmountLang(f, partial);
    enterNext = !!(partial.step || partial.ids);
    YES.set({ filters: f });
    enterNext = false;
    if (navigate && YES.state.view !== 'transactions') YES.nav.go('transactions', { focus: false });
    if (navigate) {
      if (focus === 'results') focusResults();
      else if (focus === 'heading') ui.focusView('transactions');
    }
    if (opts.announce !== false) announceCount(navigate ? 120 : 0);
    else clearTimeout(timers.announce); // nor may a count still queued from earlier typing talk over the caller
    return filtered();
  }

  function showRows(ids, labelText) {
    return applyFilter({ ids: (ids || []).slice(), idsLabel: labelText || null }, { reset: true });
  }

  function clearFilters(opts) {
    opts = opts || {};
    YES.set({ filters: YES.defaultFilters() });
    if (opts.focus !== false && els.root && YES.state.view === 'transactions') focusResults();
    announceCount(60);
  }

  /* ------------------------------------------------------------------ */
  /* Transaction detail dialog                                           */
  /* ------------------------------------------------------------------ */
  function rowButton(id) {
    if (!els.root || !SAFE_ID.test(id)) return null;
    return els.root.querySelector('[data-tx-open="' + id + '"]');
  }
  function visible(el) {
    return !!(el && el.isConnected && el.offsetParent !== null);
  }
  function ledgerIds() {
    return sortRows(
      allTx().map(function (tx) {
        return { tx: tx };
      })
    ).map(function (r) {
      return r.tx.id;
    });
  }
  /** Valid, unique transaction ids from a caller-supplied list (or null). */
  function cleanList(list) {
    if (!Array.isArray(list)) return null;
    var out = [];
    list.forEach(function (v) {
      v = String(v);
      if (SAFE_ID.test(v) && YES.calc.tx(v) && out.indexOf(v) === -1) out.push(v);
    });
    return out.length ? out : null;
  }
  /**
   * The list a transaction was opened from, when the caller did not pass one:
   * the trigger names the transaction in a data attribute (data-ov-tx="…"), and
   * its nearest list or table holds the siblings it was shown with, in order.
   */
  function listFromTrigger(trigger, id) {
    if (!trigger || !trigger.attributes || !trigger.closest) return null;
    var attr = null;
    for (var i = 0; i < trigger.attributes.length; i++) {
      var a = trigger.attributes[i];
      if (a.name.indexOf('data-') === 0 && a.value === id) {
        attr = a.name;
        break;
      }
    }
    var box = attr && trigger.closest('ul, ol, tbody, table, [role="list"]');
    if (!box) return null;
    var list = cleanList(
      ui.$$('[' + attr + ']', box).map(function (el) {
        return el.getAttribute(attr);
      })
    );
    return list && list.length > 1 && list.indexOf(id) !== -1 ? list : null;
  }
  /**
   * Previous/next order: the list the detail was opened from (a journey step's
   * rows, an explanation's supporting rows, the explorer's current results);
   * otherwise the current results, or the whole ledger in the current order.
   */
  function navList(id) {
    if (dlgCtx.list && dlgCtx.list.indexOf(id) !== -1) return dlgCtx.list;
    var list = filtered().map(function (tx) {
      return tx.id;
    });
    return list.indexOf(id) !== -1 ? list : ledgerIds();
  }

  function copyRow(labelKey, value, copyKey, fk, mono) {
    return (
      '<dt class="tx-kv__copy">' +
      esc(t(labelKey)) +
      '</dt><dd><span class="tx-copy"><span class="' +
      (mono ? 'mono ' : '') +
      'tx-copy__value">' +
      esc(value) +
      '</span><button type="button" class="btn btn--sm tx-copy__btn" data-txd-copy="' +
      esc(copyKey) +
      '" data-fk="' +
      fk +
      '" aria-label="' +
      esc(t('explorer.dlg.copyLabel', { label: t(labelKey), value: value })) +
      '">' +
      ui.icon('copy', { size: 16 }) +
      '<span>' +
      esc(t('common.copy')) +
      '</span></button></span></dd>'
    );
  }

  function feeAmountText(f) {
    if (YES.data.assets[f.asset]) return YES.fmt.amount(-Math.abs(f.amount), { asset: f.asset });
    return '−' + f.amount + ' ' + f.asset;
  }

  function feesSectionHtml(tx) {
    var body = '';
    var sid = st().assetId;
    if (tx.type === 'fee' && tx.parentId) {
      var parent = YES.calc.tx(tx.parentId);
      body =
        '<p class="tx-dlg__lead">' +
        esc(t('explorer.dlg.feeOf')) +
        '</p>' +
        '<div class="tx-link-card">' +
        '<div class="tx-link-card__text"><span class="tx-link-card__title">' +
        esc(parent ? YES.L(parent.description) : tx.parentId) +
        '</span><span class="tx-link-card__meta">' +
        (parent ? ui.amountHtml(parent.amount) + ' · ' : '') +
        '<span class="mono">' +
        esc(tx.parentId) +
        '</span></span></div>' +
        (parent
          ? '<button type="button" class="btn btn--sm" data-txd-go="' +
            esc(parent.id) +
            '" data-fk="txd-parent" aria-label="' +
            esc(t('explorer.dlg.openParentLabel', { id: parent.id })) +
            '">' +
            esc(t('explorer.dlg.openParent')) +
            ui.icon('arrow-right', { size: 16 }) +
            '</button>'
          : '') +
        '</div>' +
        '<p class="tx-dlg__small">' +
        esc(t('explorer.dlg.feeSeparate')) +
        '</p>';
    } else if (tx.fees && tx.fees.length) {
      var linked = 0;
      var items = tx.fees
        .map(function (f) {
          var feeTx = f.feeTxId ? YES.calc.tx(f.feeTxId) : null;
          var foreign = f.asset !== sid;
          if (!foreign && feeTx) linked += feeTx.amount;
          var kindKey = 'explorer.dlg.feeKind.' + (f.kind || 'other');
          var kind = YES.i18n.dict[YES.i18n.lang][kindKey] ? t(kindKey) : t('explorer.dlg.feeKind.other');
          return (
            '<li class="tx-fee">' +
            '<div class="tx-fee__text"><span class="tx-fee__kind">' +
            esc(kind) +
            '</span>' +
            (feeTx ? '<span class="tx-fee__id mono">' + esc(feeTx.id) + '</span>' : '') +
            (foreign ? '<span class="tx-dlg__small">' + esc(t('explorer.dlg.foreignFee', { asset: f.asset })) + '</span>' : '') +
            '</div>' +
            '<span class="tx-fee__amt">' +
            (feeTx ? ui.amountHtml(feeTx.amount) : esc(feeAmountText(f))) +
            '</span>' +
            (feeTx
              ? '<button type="button" class="btn btn--sm" data-txd-go="' +
                esc(feeTx.id) +
                '" data-fk="txd-fee-' +
                esc(feeTx.id) +
                '" aria-label="' +
                esc(t('explorer.dlg.openFeeLabel', { kind: kind, id: feeTx.id })) +
                '">' +
                esc(t('explorer.dlg.openFee')) +
                ui.icon('arrow-right', { size: 16 }) +
                '</button>'
              : '') +
            '</li>'
          );
        })
        .join('');
      body =
        '<ul class="tx-fees">' +
        items +
        '</ul>' +
        '<p class="tx-fees__total"><span>' +
        esc(t('explorer.dlg.totalWithFees')) +
        '</span>' +
        ui.amountHtml(tx.amount + linked) +
        '</p>' +
        '<p class="tx-dlg__small">' +
        esc(t('explorer.dlg.feeSeparate')) +
        '</p>';
    } else {
      body = '<p class="tx-dlg__muted">' + esc(t('explorer.dlg.noFees')) + '</p>';
    }
    return '<section class="tx-dlg__section" aria-labelledby="txd-fees-h"><h3 id="txd-fees-h">' + ui.icon('fee', { size: 18 }) + '<span>' + esc(t('explorer.dlg.fees')) + '</span></h3>' + body + '</section>';
  }

  function onchainSectionHtml(tx) {
    if (tx.rail !== 'onchain') return '';
    var oc = tx.onchain;
    var body;
    if (oc) {
      body =
        '<div class="notice notice--illustrative tx-onchain__notice">' +
        ui.icon('info', { size: 20 }) +
        '<div><p class="tx-onchain__label"><strong>' +
        esc(t('explorer.dlg.onchainLabel')) +
        '</strong></p><p>' +
        esc(t('explorer.dlg.onchainNoLink')) +
        '</p></div></div>' +
        '<dl class="kv tx-kv">' +
        '<dt>' +
        esc(t('explorer.dlg.network')) +
        '</dt><dd>' +
        esc(YES.L(oc.network)) +
        '</dd>' +
        '<dt class="tx-kv__copy">' +
        esc(t('explorer.dlg.hash')) +
        '</dt><dd><span class="tx-copy"><span class="mono tx-copy__value" title="' +
        esc(oc.hash) +
        '">' +
        esc(oc.hashDisplay || oc.hash) +
        '</span><button type="button" class="btn btn--sm tx-copy__btn" data-txd-copy="hash" data-fk="txd-copy-hash" aria-label="' +
        esc(t('explorer.dlg.copyHash')) +
        '">' +
        ui.icon('copy', { size: 16 }) +
        '<span>' +
        esc(t('common.copy')) +
        '</span></button></span></dd>' +
        '<dt>' +
        esc(t('explorer.dlg.confirmations')) +
        '</dt><dd>' +
        esc(YES.fmt.count(oc.confirmations)) +
        '</dd>' +
        '</dl>';
    } else {
      body = '<p class="tx-dlg__muted">' + esc(t('explorer.dlg.onchainUnverified')) + '</p>';
    }
    return (
      '<section class="tx-dlg__section tx-onchain" aria-labelledby="txd-chain-h"><h3 id="txd-chain-h">' +
      ui.icon('chain', { size: 18 }) +
      '<span>' +
      esc(t('explorer.dlg.onchain')) +
      '</span>' +
      (oc ? ui.illustrativeTag() : '') +
      '</h3>' +
      body +
      '</section>'
    );
  }

  function inquiryState(id) {
    var d = null;
    try {
      d = YES.inquiry.draftFor(id);
    } catch (e) {
      d = null;
    }
    if (!d || (d.txId && d.txId !== id)) return null;
    return d;
  }

  function dialogHtml(tx) {
    var s = st();
    var pending = !YES.calc.inBalance(tx);
    var a = asset();
    var list = navList(tx.id);
    var pos = list.indexOf(tx.id);
    var prev = pos > 0 ? list[pos - 1] : null;
    var next = pos !== -1 && pos < list.length - 1 ? list[pos + 1] : null;
    var inq = inquiryState(tx.id);
    var askKey = inq && inq.status === 'submitted' ? 'explorer.dlg.viewInquiry' : inq ? 'explorer.dlg.continue' : 'explorer.dlg.ask';
    var dt = function (iso) {
      return YES.fmt.date(iso, 'datetime') + ' ' + tzShort(iso);
    };
    var prevPeriod = tx.priorPeriodInitiation || (tx.initiatedAt && YES.fmt.isoDate(tx.initiatedAt) < YES.fmt.isoDate(s.periodStart));
    var notes = (tx.notes || [])
      .map(function (n) {
        return '<li>' + esc(YES.L(n)) + '</li>';
      })
      .join('');

    var kv =
      '<dl class="kv tx-kv">' +
      '<dt>' +
      esc(t('explorer.dlg.status')) +
      '</dt><dd>' +
      ui.statusHtml(tx.status) +
      '</dd>' +
      '<dt>' +
      esc(t('explorer.dlg.posted')) +
      '</dt><dd>' +
      (tx.postedAt ? esc(dt(tx.postedAt)) : '<span class="tx-dlg__muted">' + esc(t('explorer.dlg.notPosted')) + '</span>') +
      '</dd>' +
      '<dt>' +
      esc(t('explorer.dlg.initiated')) +
      '</dt><dd>' +
      esc(dt(tx.initiatedAt)) +
      (prevPeriod ? ' <span class="tag tx-prev">' + esc(t('explorer.row.prevPeriod')) + '</span>' : '') +
      (prevPeriod && !(tx.notes && tx.notes.length) ? '<span class="tx-dlg__small tx-prevnote">' + esc(t('explorer.dlg.prevPeriodNote')) + '</span>' : '') +
      '</dd>' +
      '<dt>' +
      esc(t('explorer.dlg.type')) +
      '</dt><dd>' +
      esc(ui.typeLabel(tx)) +
      '<span class="tx-canon">' +
      esc(t('explorer.dlg.eventType')) +
      ' <code>' +
      esc(tx.type) +
      '</code></span></dd>' +
      '<dt>' +
      esc(t('explorer.dlg.rail')) +
      '</dt><dd>' +
      esc(railText(tx)) +
      '</dd>' +
      '<dt>' +
      esc(t('explorer.dlg.counterparty')) +
      '</dt><dd>' +
      ui.maskedHtml(nb(YES.L(tx.counterparty))) +
      '</dd>' +
      '<dt>' +
      esc(t('explorer.dlg.description')) +
      '</dt><dd>' +
      esc(YES.L(tx.description)) +
      '</dd>' +
      (tx.memo ? '<dt>' + esc(t('explorer.dlg.memo')) + '</dt><dd>' + memoHtml(tx, null) + '</dd>' : '') +
      '<dt>' +
      esc(t('explorer.dlg.balanceAfter')) +
      '</dt><dd>' +
      (pending ? '<span class="tx-notin">' + ui.icon('clock', { size: 14 }) + '<span>' + esc(t('status.notInBalance')) + '</span></span>' : '<span class="tabular">' + esc(YES.fmt.amount(tx.balanceAfter)) + '</span>') +
      '</dd>' +
      copyRow('explorer.dlg.reference', tx.reference || '', 'ref', 'txd-copy-ref', true) +
      copyRow('explorer.dlg.txId', tx.id, 'id', 'txd-copy-id', true) +
      '</dl>';

    var inquiryNote = '';
    if (inq && inq.status === 'submitted') {
      inquiryNote = '<div class="notice notice--illustrative tx-dlg__inq">' + ui.icon('info', { size: 20 }) + '<p>' + esc(t('explorer.dlg.submittedNote', { ref: inq.ref || '' })) + '</p></div>';
    } else if (inq) {
      inquiryNote = '<div class="notice notice--info tx-dlg__inq">' + ui.icon('info', { size: 20 }) + '<p>' + esc(t('explorer.dlg.draftNote')) + '</p></div>';
    }

    var posText = pos !== -1 ? t('explorer.dlg.position', { a: YES.fmt.count(pos + 1), b: YES.fmt.count(list.length) }) : '';
    return (
      '<div class="dlg__head tx-dlg__head">' +
      dirIcon(tx) +
      '<div class="tx-dlg__headtext"><p class="tx-dlg__eyebrow">' +
      // The date never splits across lines beside the close button on a narrow sheet.
      esc(t('explorer.dlg.eyebrow', { type: ui.typeLabel(tx), date: tx.postedAt ? YES.fmt.date(tx.postedAt, 'medium').replace(/\s/g, '\u00a0') : statusLabel(statusOf(tx)) })) +
      '</p><h2 id="tx-dialog-title" class="dlg__title" tabindex="-1" data-fk="txd-title">' +
      esc(YES.L(tx.description)) +
      '</h2></div>' +
      // No language switch here (ARCHITECTURE rule 7): the detail uses the
      // language chosen in the masthead. To change it the customer closes the
      // detail (focus returns to its row; filters and sort stay in YES.state),
      // switches in the masthead and reopens the same row. A programmatic
      // YES.setLang while it is open re-renders it in place (render() below),
      // still on the same transaction.
      '<button type="button" class="btn btn--icon btn--ghost tx-dlg__close" data-txd-close data-fk="txd-close" aria-label="' +
      esc(t('explorer.dlg.close')) +
      '">' +
      ui.icon('close', { size: 20 }) +
      '</button>' +
      '</div>' +
      '<div class="dlg__body tx-dlg__body">' +
      '<div class="tx-dlg__hero' +
      (pending ? ' tx-dlg__hero--pending' : '') +
      '">' +
      '<p class="tx-dlg__amount">' +
      ui.amountHtml(tx.amount) +
      '</p>' +
      '<div class="tx-dlg__heroStatus">' +
      ui.statusHtml(tx.status) +
      (pending ? '<span class="tx-notin">' + ui.icon('clock', { size: 14 }) + '<span>' + esc(t('status.notInBalance')) + '</span></span>' : '') +
      '</div>' +
      // PRD 2: balances and references in the demo are visibly marked, here too
      // (on a phone this sheet covers the masthead badge).
      (YES.config.demo ? '<span class="tx-dlg__demo">' + ui.illustrativeTag('demo.badge') + '</span>' : '') +
      '<span class="tx-dlg__break" aria-hidden="true"></span>' +
      '<p class="tx-dlg__unit">' +
      esc(t('explorer.dlg.unit', { asset: YES.L(a.name), symbol: a.symbol })) +
      '</p>' +
      '</div>' +
      inquiryNote +
      '<section class="tx-dlg__section" aria-labelledby="txd-details-h"><h3 id="txd-details-h">' +
      ui.icon('info', { size: 18 }) +
      '<span>' +
      esc(t('explorer.dlg.details')) +
      '</span></h3>' +
      kv +
      '<p class="tx-dlg__small tx-dlg__tz">' +
      esc(t('explorer.dlg.times', { tz: YES.fmt.tz(tx.postedAt || tx.initiatedAt) })) +
      '</p>' +
      '</section>' +
      feesSectionHtml(tx) +
      onchainSectionHtml(tx) +
      (notes ? '<section class="tx-dlg__section" aria-labelledby="txd-notes-h"><h3 id="txd-notes-h">' + ui.icon('book', { size: 18 }) + '<span>' + esc(t('explorer.dlg.notes')) + '</span></h3><ul class="tx-notes">' + notes + '</ul></section>' : '') +
      '</div>' +
      '<div class="dlg__foot tx-dlg__foot">' +
      '<div class="tx-pager" role="group" aria-label="' +
      esc(t('explorer.dlg.pager')) +
      '">' +
      '<button type="button" class="btn btn--icon btn--ghost tx-pager__btn" data-txd-go="' +
      esc(prev || '') +
      '" data-fk="txd-prev" aria-label="' +
      esc(t('explorer.dlg.prevLabel')) +
      '"' +
      (prev ? '' : ' disabled') +
      '>' +
      ui.icon('arrow-left', { size: 18 }) +
      '</button>' +
      '<span class="tx-pager__pos">' +
      (posText
        ? '<span class="tx-pager__long">' + esc(posText) + '</span><span class="tx-pager__short" aria-hidden="true">' + esc(YES.fmt.count(pos + 1) + '/' + YES.fmt.count(list.length)) + '</span>'
        : '') +
      '</span>' +
      '<button type="button" class="btn btn--icon btn--ghost tx-pager__btn" data-txd-go="' +
      esc(next || '') +
      '" data-fk="txd-next" aria-label="' +
      esc(t('explorer.dlg.nextLabel')) +
      '"' +
      (next ? '' : ' disabled') +
      '>' +
      ui.icon('arrow-right', { size: 18 }) +
      '</button>' +
      '</div>' +
      '<div class="tx-dlg__actions">' +
      ui.explainButton({ topic: 'transaction', id: tx.id }, t('explorer.dlg.explainTopic', { description: YES.L(tx.description), id: tx.id }), { fk: 'txd-explain' }) +
      '<button type="button" class="btn btn--primary" data-txd-ask="' +
      esc(tx.id) +
      '" data-fk="txd-ask">' +
      ui.icon('question', { size: 18 }) +
      '<span>' +
      esc(t(askKey)) +
      '</span></button>' +
      '</div>' +
      '</div>'
    );
  }

  function renderDialog() {
    var id = YES.state.selectedTx;
    var tx = id ? YES.calc.tx(id) : null;
    if (!els.dlg || !tx) return;
    var body = els.dlg.querySelector('.dlg__body');
    var scroll = body ? body.scrollTop : 0;
    var same = els.dlg.getAttribute('data-tx') === id;
    // Keep the dialog's live regions (ui.announce) across re-renders: a region
    // that is re-created right before its message may not be announced.
    var live = ui.$$(':scope > [aria-live]', els.dlg);
    ui.render(els.dlg, dialogHtml(tx));
    live.forEach(function (el) {
      els.dlg.appendChild(el);
    });
    els.dlg.setAttribute('data-tx', id);
    var nb = els.dlg.querySelector('.dlg__body');
    if (nb && same) nb.scrollTop = scroll;
  }

  /**
   * Settle state and route after the detail closes (idempotent: the native
   * 'close' event arrives a task after closeTx has already settled).
   *   how 'back'    — the customer closed it (close button, Escape, backdrop):
   *                   if opening it added a history entry, step back over it, so
   *                   the browser's Back and the close button agree;
   *   how 'replace' — closed by code or by a navigation: rewrite the address.
   * Either way only the closed transaction's own address is touched: one that
   * names another transaction (a newer link still waiting for its 'hashchange')
   * belongs to that navigation and is left for it to open.
   */
  function settleClosed(how) {
    if (!els.dlg || els.dlg.open) return; // re-opened before a late 'close' event arrived
    if (YES.state.selectedTx === null && !els.dlg.hasAttribute('data-tx')) return;
    var closedId = els.dlg.getAttribute('data-tx') || YES.state.selectedTx;
    YES.set({ selectedTx: null });
    els.dlg.removeAttribute('data-tx');
    // No stale controls (close, copy, pager, actions) linger in the closed dialog.
    els.dlg.textContent = '';
    dlgCtx.view = null;
    dlgCtx.list = null;
    var pushed = hist.pushed;
    hist.pushed = false;
    var cur = YES.nav.current();
    if (cur.view !== 'transactions' || !cur.param || cur.param !== closedId) return;
    if (how === 'back' && pushed && root.history && typeof root.history.back === 'function') root.history.back();
    else YES.nav.setParam(null);
  }

  /** Run fn once the dialog's pending 'close' event (and its focus return) has been handled. */
  function whenClosed(fn) {
    if (!closing) return fn();
    var done = false;
    var run = function () {
      if (done) return;
      done = true;
      closing = false;
      fn();
    };
    els.dlg.addEventListener(
      'close',
      function () {
        setTimeout(run, 0);
      },
      { once: true }
    );
    setTimeout(run, 150);
  }

  /**
   * Open the transaction detail.
   *   opts.trigger — where focus returns on close;
   *   opts.list    — ids of the list it was opened from, in order: previous /
   *                  next stay within it (inferred from the trigger's list when
   *                  omitted; the explorer's own rows use the current results).
   * Over the Transactions view the address becomes #/transactions/<id>. Opened by
   * the customer, that is a new history entry, so the browser's Back (or a
   * phone's back gesture) closes the sheet and stays in the list. Over another
   * view the dialog opens in place so focus can return to what opened it.
   */
  function openTx(id, opts) {
    opts = opts || {};
    var tx = id && SAFE_ID.test(String(id)) ? YES.calc.tx(String(id)) : null;
    if (!els.dlg) return;
    if (closing && !els.dlg.open) {
      whenClosed(function () {
        openTx(id, opts);
      });
      return;
    }
    if (!tx) {
      ui.toast(t('explorer.notFound', { id: String(id || '') }));
      if (opts.fromRoute) YES.nav.setParam(null);
      return;
    }
    var wasOpen = els.dlg.open;
    var onTx = YES.state.view === 'transactions';
    if (!wasOpen) {
      dlgCtx.view = YES.state.view;
      dlgCtx.list =
        cleanList(opts.list) ||
        listFromTrigger(opts.trigger, tx.id) ||
        (onTx
          ? filtered().map(function (x) {
              return x.id;
            })
          : null);
    }
    YES.set({ selectedTx: tx.id });
    renderDialog();
    var row = rowButton(tx.id);
    if (!wasOpen) {
      var trigger = opts.trigger || (visible(row) ? row : null) || (onTx ? els.root.querySelector('#tx-results-title') : null) || doc.activeElement;
      ui.openDialog(els.dlg, {
        trigger: trigger,
        initialFocus: '#tx-dialog-title',
        onClose: function () {
          settleClosed('replace');
        }
      });
      if (onTx && !opts.fromRoute && YES.nav.current().param !== tx.id) {
        hist.pushed = true;
        YES.nav.go('transactions', { param: tx.id, focus: false });
      } else if (onTx) {
        YES.nav.setParam(tx.id);
      }
      return;
    }
    if (onTx) YES.nav.setParam(tx.id);
    // Moving between transactions inside the dialog: return focus to the row now shown.
    if (visible(row)) ui.setDialogReturn(els.dlg, row);
    var b = els.dlg.querySelector('.dlg__body');
    if (b) b.scrollTop = 0;
    // Previous / Next keep focus on the pager (the other button at either end),
    // so stepping through a list is one key press per transaction.
    var target = null;
    if (opts.focusFk === 'txd-prev' || opts.focusFk === 'txd-next') {
      (opts.focusFk === 'txd-prev' ? ['txd-prev', 'txd-next'] : ['txd-next', 'txd-prev']).some(function (fk) {
        var el = els.dlg.querySelector('[data-fk="' + fk + '"]');
        if (el && !el.disabled) target = el;
        return !!target;
      });
    }
    (target || els.dlg.querySelector('#tx-dialog-title')).focus({ preventScroll: true });
    var list = navList(tx.id);
    ui.announce(t('explorer.dlg.showing', { description: YES.L(tx.description), position: t('explorer.dlg.position', { a: YES.fmt.count(list.indexOf(tx.id) + 1), b: YES.fmt.count(list.length) }) }));
  }

  /** Close the detail (API: rewrites the address; the close button steps back over its history entry). */
  function closeTx(opts) {
    if (!els.dlg || !els.dlg.open) return;
    closing = true;
    ui.closeDialog(els.dlg);
    // The native 'close' event fires a task later; settle state and route now so
    // callers see the closed state immediately (settleClosed is idempotent).
    settleClosed(opts && opts.how === 'back' ? 'back' : 'replace');
  }

  function onRoute(r) {
    if (!els.dlg) return;
    var open = els.dlg.open;
    if (r.view === 'transactions' && r.param) {
      if (!(open && YES.state.selectedTx === r.param)) openTx(r.param, { fromRoute: true });
      return;
    }
    if (open && dlgCtx.view && (r.view !== dlgCtx.view || r.view === 'transactions')) closeTx();
  }

  /* ------------------------------------------------------------------ */
  /* CSV export                                                          */
  /* ------------------------------------------------------------------ */
  /* Machine-readable values come from the shared formatters (YES.fmt.plain:
     "." decimals and ASCII minus; YES.fmt.isoTime: 24-hour statement time), so
     the file can never drift from what the screen shows. */
  function plainAmount(minor) {
    return minor == null ? '' : YES.fmt.plain(minor);
  }
  function isoDateTime(iso) {
    return iso ? YES.fmt.isoDate(iso) + ' ' + YES.fmt.isoTime(iso) : '';
  }
  function csvCell(v, text) {
    var s = v == null ? '' : String(v);
    if (text && /^[=+\-@\t\r]/.test(s)) s = "'" + s; // keep spreadsheet formulas inert
    if (/[",;\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }
  /** Opening and closing balance from the balance journey (YES.calc), never typed in. */
  function bridgeEnds() {
    var j = YES.calc.journey();
    return { opening: j[0].value, closing: j[j.length - 1].value };
  }
  /**
   * What a CSV contains, in words, repeated on every row so each line stands on
   * its own: the complete record, or the current view's filters and order.
   */
  function exportScope(which) {
    if (which !== 'filtered') return t('explorer.csv.scopeAll');
    var s = S();
    var applied = chips()
      .map(function (c) {
        return c.label;
      })
      .join(' · ');
    return t('explorer.csv.scopeView', { filters: applied || t('explorer.csv.noFilters'), sort: t('explorer.sort.' + s.key + '.' + s.dir) });
  }
  /*
   * Columns: the transaction, then the statement facts it belongs to (version,
   * period, as-of and generation time, date basis, opening and closing balance)
   * and what the export covers. Repeating the facts keeps the file rectangular,
   * so it opens cleanly in any spreadsheet and every row stays traceable.
   */
  var CSV_COLS = [
    ['statementId', function () { return st().id; }, true],
    ['txId', function (tx) { return tx.id; }, true],
    ['postedDate', function (tx) { return YES.fmt.isoDate(tx.postedAt); }],
    ['postedTime', function (tx) { return YES.fmt.isoTime(tx.postedAt); }],
    ['initiatedDate', function (tx) { return YES.fmt.isoDate(tx.initiatedAt); }],
    ['initiatedTime', function (tx) { return YES.fmt.isoTime(tx.initiatedAt); }],
    ['timezone', function () { return st().timezone; }, true],
    ['type', function (tx) { return tx.type; }, true],
    ['typeLabel', function (tx) { return ui.typeLabel(tx); }, true],
    ['description', function (tx) { return YES.L(tx.description); }, true],
    ['counterparty', function (tx) { return YES.L(tx.counterparty); }, true],
    ['memo', function (tx) { return tx.memo ? YES.L(tx.memo) : ''; }, true],
    ['direction', function (tx) { return tx.amount < 0 ? 'outgoing' : tx.amount > 0 ? 'incoming' : 'none'; }, true],
    ['amount', function (tx) { return plainAmount(tx.amount); }],
    ['asset', function (tx) { return tx.asset; }, true],
    ['balanceAfter', function (tx) { return YES.calc.inBalance(tx) ? plainAmount(tx.balanceAfter) : ''; }],
    ['status', function (tx) { return tx.status; }, true],
    ['included', function (tx) { return YES.calc.inBalance(tx) ? 'true' : 'false'; }],
    ['rail', function (tx) { return tx.rail; }, true],
    ['method', function (tx) { return tx.method || ''; }, true],
    ['reference', function (tx) { return tx.reference || ''; }, true],
    ['parentId', function (tx) { return tx.parentId || ''; }, true],
    ['statementVersion', function () { return st().version || ''; }, true],
    ['issueStatus', function () { return st().issueStatus || ''; }, true],
    ['periodStart', function () { return YES.fmt.isoDate(st().periodStart); }],
    ['periodEnd', function () { return YES.fmt.isoDate(st().periodEnd); }],
    ['asOf', function () { return isoDateTime(st().asOf); }],
    ['generatedAt', function () { return isoDateTime(st().generatedAt); }],
    ['dateBasis', function () { return st().dateBasis || 'posted'; }, true],
    ['openingBalance', function (tx, ctx) { return plainAmount(ctx.ends.opening); }],
    ['closingBalance', function (tx, ctx) { return plainAmount(ctx.ends.closing); }],
    ['scope', function (tx, ctx) { return ctx.scope; }, true],
    ['classification', function () { return CLASSIFICATION; }, true]
  ];
  function completeList() {
    var posted = YES.calc.posted();
    var other = YES.calc.notInBalance().sort(function (a, b) {
      return ms(a.initiatedAt) - ms(b.initiatedAt) || (a.seq || 0) - (b.seq || 0);
    });
    return posted.concat(other);
  }
  function buildCsv(which) {
    var list = which === 'filtered' ? filtered() : completeList();
    var lines = [
      CSV_COLS.map(function (c) {
        return csvCell(t('explorer.csv.' + c[0]), true);
      }).join(',')
    ];
    var ctx = { ends: bridgeEnds(), scope: exportScope(which) };
    list.forEach(function (tx) {
      lines.push(
        CSV_COLS.map(function (c) {
          return csvCell(c[1](tx, ctx), !!c[2]);
        }).join(',')
      );
    });
    return { list: list, content: '﻿' + lines.join('\r\n') + '\r\n' };
  }
  function exportCsv(which) {
    which = which === 'filtered' ? 'filtered' : 'all';
    var out = buildCsv(which);
    if (which === 'filtered' && !out.list.length) {
      ui.toast(t('explorer.export.empty'));
      return null;
    }
    var name = st().id + '_' + (which === 'filtered' ? 'current-view' : 'complete-record') + '_DEMO.csv';
    ui.download(name, out.content, 'text/csv;charset=utf-8');
    ui.toast(t('explorer.export.done', { count: YES.txCount(out.list.length) }));
    return name;
  }

  /* ------------------------------------------------------------------ */
  /* Events                                                              */
  /* ------------------------------------------------------------------ */
  function readGroup(group) {
    return ui
      .$$('[data-tx-f="' + group + '"]', els.root)
      .filter(function (el) {
        return el.checked;
      })
      .map(function (el) {
        return el.value;
      });
  }

  function setPanelOpen(open) {
    var v = {};
    var cur = viewPrefs();
    for (var k in cur) v[k] = cur[k];
    v.filtersOpen = !!open;
    YES.set({ explorer: v });
    syncControls();
  }

  function bind() {
    var r = els.root;
    r.addEventListener('submit', function (e) {
      e.preventDefault();
    });
    r.addEventListener('input', function (e) {
      var el = e.target;
      if (el.hasAttribute('data-tx-q')) {
        setFilters({ q: el.value });
        announceCount(700);
        return;
      }
      var kind = el.getAttribute('data-tx-f');
      if (kind === 'min' || kind === 'max') {
        var patch = {};
        patch[kind] = el.value;
        setFilters(patch);
        announceCount(700);
      }
    });
    r.addEventListener('change', function (e) {
      var el = e.target;
      if (el.hasAttribute('data-tx-sort')) {
        var p = el.value.split(':');
        YES.set({ sort: { key: p[0], dir: p[1] } });
        clearTimeout(timers.announce);
        timers.announce = setTimeout(function () {
          ui.announce(t('explorer.sort.announce', { label: t('explorer.sort.' + S().key + '.' + S().dir) }) + ' ' + countAnnouncement());
        }, 100);
        return;
      }
      var kind = el.getAttribute('data-tx-f');
      if (!kind || kind === 'min' || kind === 'max') return;
      var patch = {};
      if (kind === 'types' || kind === 'statuses' || kind === 'rails') patch[kind] = readGroup(kind);
      else if (kind === 'direction') patch.direction = el.value;
      else if (kind === 'from' || kind === 'to') patch[kind] = el.value || '';
      setFilters(patch);
      announceCount(200);
    });
    r.addEventListener('keydown', function (e) {
      // Escape in a non-empty search box clears it (and keeps focus there).
      if (e.key === 'Escape' && e.target.hasAttribute && e.target.hasAttribute('data-tx-q') && e.target.value) {
        e.preventDefault();
        setFilters({ q: '' });
        announceCount(200);
      }
    });

    ui.delegate(r, 'click', '[data-tx-q-clear]', function () {
      setFilters({ q: '' });
      var q = r.querySelector('#tx-q');
      if (q) q.focus();
      announceCount(200);
    });
    ui.delegate(r, 'click', '[data-tx-open]', function (e, b) {
      e.preventDefault();
      openTx(b.getAttribute('data-tx-open'), { trigger: b });
    });
    ui.delegate(r, 'click', '[data-tx-row]', function (e, row) {
      if (e.target.closest('button, a, input, select, label, summary')) return;
      var sel = root.getSelection && root.getSelection();
      if (sel && String(sel).length) return; // the customer is selecting text, not opening
      var b = row.querySelector('[data-tx-open]');
      if (b) openTx(b.getAttribute('data-tx-open'), { trigger: b });
    });
    ui.delegate(r, 'click', '[data-tx-chip]', function (e, b) {
      var all = ui.$$('[data-tx-chip]', r);
      var idx = all.indexOf(b);
      var label = b.querySelector('.tx-chip__label').textContent;
      removeChip(b.getAttribute('data-tx-chip'));
      var left = ui.$$('[data-tx-chip]', r);
      var target = left[idx] || left[idx - 1] || r.querySelector('#tx-results-title');
      if (target) target.focus({ preventScroll: true });
      clearTimeout(timers.announce);
      timers.announce = setTimeout(function () {
        ui.announce(t('explorer.chip.removed', { label: label }) + ' ' + countAnnouncement());
      }, 100);
    });
    ui.delegate(r, 'click', '[data-tx-clear]', function () {
      YES.set({ filters: YES.defaultFilters() });
      focusResults();
      clearTimeout(timers.announce);
      timers.announce = setTimeout(function () {
        ui.announce(t('explorer.cleared') + ' ' + countAnnouncement());
      }, 100);
    });
    ui.delegate(r, 'click', '[data-tx-toggle]', function () {
      setPanelOpen(!viewPrefs().filtersOpen);
    });
    ui.delegate(r, 'click', '[data-tx-done]', function () {
      setPanelOpen(false);
      focusResults();
      announceCount(100);
    });
    ui.delegate(r, 'click', '[data-tx-csv]', function (e, b) {
      exportCsv(b.getAttribute('data-tx-csv'));
    });
    ui.delegate(r, 'click', '[data-tx-print]', function () {
      if (typeof root.print === 'function') root.print();
    });
    // The help module builds and downloads the PDF (and confirms it), so this
    // button and the one in Help produce the same file.
    ui.delegate(r, 'click', '[data-tx-pdf]', function () {
      if (pdfAvailable()) YES.help.downloadPdf();
    });

    var d = els.dlg;
    if (d) {
      // State and route follow every close (button, Escape, backdrop, programmatic).
      // A close we did not start (Escape, backdrop) is the customer's own.
      d.addEventListener('close', function () {
        var ours = closing;
        closing = false;
        settleClosed(ours ? 'replace' : 'back');
      });
      ui.delegate(d, 'click', '[data-txd-close]', function () {
        closeTx({ how: 'back' });
      });
      ui.delegate(d, 'click', '[data-txd-go]', function (e, b) {
        var id = b.getAttribute('data-txd-go');
        if (id) openTx(id, { focusFk: b.getAttribute('data-fk') });
      });
      ui.delegate(d, 'click', '[data-txd-copy]', function (e, b) {
        var tx = YES.calc.tx(YES.state.selectedTx);
        if (!tx) return;
        var k = b.getAttribute('data-txd-copy');
        var v = k === 'ref' ? tx.reference : k === 'id' ? tx.id : k === 'hash' && tx.onchain ? tx.onchain.hash : '';
        if (v) ui.copy(v);
      });
      // "Ask about this transaction" and "Explain with AI" hand over to another
      // dialog: the detail closes itself first (stepping back over its history
      // entry, as when the customer closes it), so the next dialog is never left
      // behind a modal, and focus later returns to the control that opened the
      // detail, or else to the transaction's row ("Back to transaction" in the
      // inquiry reopens the detail from there).
      var handOver = function (id) {
        var back = ui.dialogTrigger(d);
        var row = rowButton(id);
        if (!visible(back) && visible(row)) back = row;
        closing = true;
        ui.closeDialog(d, { returnFocus: false });
        settleClosed('back');
        return visible(back) ? back : null;
      };
      ui.delegate(d, 'click', '[data-txd-ask]', function (e, b) {
        var id = b.getAttribute('data-txd-ask');
        YES.inquiry.start(id, { trigger: handOver(id) });
      });
      ui.delegate(d, 'click', '[data-explain]', function (e, b) {
        e.preventDefault();
        e.stopPropagation();
        var ctx = { topic: b.getAttribute('data-explain'), id: b.getAttribute('data-explain-id') || null };
        YES.assistant.open({ topic: ctx.topic, id: ctx.id, trigger: handOver(ctx.id) });
      });
    }

    YES.on('route', onRoute);

    // Table or cards follows the width the results actually get (the docked
    // assistant narrows the page without any viewport change).
    if (root.ResizeObserver) {
      layout.observer = new root.ResizeObserver(function () {
        // Next frame: changing layout inside the observer callback would loop.
        root.requestAnimationFrame(function () {
          if (layout.table !== null && tableMode() !== layout.table) update();
        });
      });
      layout.observer.observe(r);
    }

    if (root.matchMedia) {
      var mq = root.matchMedia('(max-width: 719px)');
      var onMq = function () {
        update();
      };
      if (mq.addEventListener) mq.addEventListener('change', onMq);
      else if (mq.addListener) mq.addListener(onMq);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Public API + registration                                           */
  /* ------------------------------------------------------------------ */
  YES.explorer = {
    applyFilter: applyFilter,
    showRows: showRows,
    clearFilters: clearFilters,
    openTx: openTx,
    closeTx: closeTx,
    filtered: filtered,
    exportCsv: exportCsv,
    /* Exposed for tests and the print/help module: CSV text without downloading. */
    csv: function (which) {
      return buildCsv(which === 'filtered' ? 'filtered' : 'all').content;
    },
    parseAmount: parseAmount
  };

  YES.register({
    name: 'explorer',
    i18n: {
      en: {
        'explorer.title': 'Transactions',
        'explorer.lede': 'All {n} movements in your statement for {period}.',
        'explorer.ledeTimes': 'Times are shown in {tz}.',
        'explorer.initiatedNote': 'Sorted by initiated date, so the date column shows when each transaction was initiated. The date filter and the totals still use the posted date.',
        'explorer.undatedNote1': '1 transaction initiated in these dates is not listed: it has not been posted, so it has no {basis} yet.',
        'explorer.undatedNoteN': '{n} transactions initiated in these dates are not listed: they have not been posted, so they have no {basis} yet.',

        'explorer.search.region': 'Transactions',
        'explorer.search.label': 'Search transactions',
        'explorer.search.placeholder': 'Name, amount or reference',
        'explorer.search.hint': 'Searches description, counterparty, memo, type, status, rail, reference, transaction ID and amount.',
        'explorer.search.clear': 'Clear search',

        'explorer.filters.title': 'Filters',
        'explorer.filters.toggle': 'Filters',
        'explorer.filters.activeN': '{n} active',
        'explorer.filters.nMatching': 'results: {n}',
        'explorer.filters.dateLegend': 'Date range ({basis})',
        'explorer.filters.from': 'From',
        'explorer.filters.to': 'To',
        'explorer.filters.dateError': 'The start date is after the end date, so nothing can match.',
        'explorer.filters.direction': 'Direction',
        'explorer.filters.type': 'Transaction type',
        'explorer.filters.status': 'Status',
        'explorer.filters.rail': 'Rail',
        'explorer.filters.amount': 'Amount',
        'explorer.filters.amountHint': 'Size in {symbol}, ignoring sign. Use a point or a comma for decimals.',
        'explorer.filters.min': 'Minimum',
        'explorer.filters.max': 'Maximum',
        'explorer.filters.amountInvalid': 'Enter an amount such as 45.50 or 45,50.',
        'explorer.filters.amountOrder': 'The minimum is larger than the maximum, so nothing can match.',
        'explorer.filters.showResults': 'Show results ({n})',

        'explorer.dir.all': 'All',
        'explorer.dir.in': 'Incoming',
        'explorer.dir.out': 'Outgoing',

        'explorer.basis.posted': 'posted date',
        'explorer.basis.initiated': 'initiated date',
        'explorer.basis.postedCap': 'Posted',
        'explorer.basis.initiatedCap': 'Initiated',

        'explorer.sort.label': 'Sort by',
        'explorer.sort.posted.desc': 'Posted date, newest first',
        'explorer.sort.posted.asc': 'Posted date, oldest first',
        'explorer.sort.initiated.desc': 'Initiated date, newest first',
        'explorer.sort.initiated.asc': 'Initiated date, oldest first',
        'explorer.sort.amount.desc': 'Amount, largest first',
        'explorer.sort.amount.asc': 'Amount, smallest first',
        'explorer.sort.announce': 'Sorted by {label}.',

        'explorer.chips.label': 'Active filters',
        'explorer.chip.q': 'Search: “{q}”',
        'explorer.chip.step': 'Step: {label}',
        'explorer.chip.ids': 'Selected transactions ({n})',
        'explorer.chip.idsLabel': '{label} ({n})',
        'explorer.chip.dateRange': '{basis}: {range}',
        'explorer.chip.dateFrom': '{basis}: from {date}',
        'explorer.chip.dateTo': '{basis}: until {date}',
        'explorer.chip.dir': 'Direction: {label}',
        'explorer.chip.type': 'Type: {label}',
        'explorer.chip.status': 'Status: {label}',
        'explorer.chip.rail': 'Rail: {label}',
        'explorer.chip.amountRange': 'Amount: {min} to {max}',
        'explorer.chip.amountMin': 'Amount: at least {min}',
        'explorer.chip.amountMax': 'Amount: up to {max}',
        'explorer.chip.remove': '{label} — remove filter',
        'explorer.chip.removed': 'Removed {label}.',
        'explorer.cleared': 'All filters cleared.',
        'explorer.backToJourney': 'Back to balance journey',

        'explorer.count.all': 'Showing all {total} transactions',
        'explorer.count.some': 'Showing {shown} of {total} transactions',
        'explorer.announce.none': 'No transactions match. Showing 0 of {total} transactions.',
        'explorer.total.filtered1': 'Filtered total: {amount} across 1 posted transaction',
        'explorer.total.filteredN': 'Filtered total: {amount} across {n} posted transactions',
        'explorer.total.all1': 'Net change: {amount} across 1 posted transaction',
        'explorer.total.allN': 'Net change: {amount} across {n} posted transactions',
        'explorer.total.none': 'No posted transactions in this view, so there is no filtered total.',
        'explorer.pendingNote1': '1 pending transaction ({amount}) is listed but not included in the statement balance.',
        'explorer.pendingNoteN': '{n} pending transactions ({amount}) are listed but not included in the statement balance.',
        'explorer.caption': 'Order: {sort} · Dates: {basis} · Amounts in {symbol} · Times in {tz}',

        'explorer.col.date.posted': 'Posted',
        'explorer.col.date.initiated': 'Initiated',
        'explorer.col.description': 'Description',
        'explorer.col.status': 'Status',
        'explorer.col.amount': 'Amount',
        'explorer.col.balance': 'Balance after',

        'explorer.row.openLabel': '{description}, {counterparty}, {date}, {amount}.',
        'explorer.row.openLabelNotIn': '{label} {status}. {notIn}.',
        'explorer.row.viewDetails': 'View details',
        'explorer.row.initiatedDate': 'initiated {date}',
        'explorer.row.initiated': 'Initiated {time}',
        'explorer.row.initiatedOn': 'Initiated {date}',
        'explorer.row.prevPeriod': 'Previous period',
        'explorer.row.balanceAfter': 'Balance after {amount}',

        'explorer.memoQuoted': '“{memo}”',
        'explorer.match.in': 'Matched in',
        'explorer.field.description': 'Description',
        'explorer.field.counterparty': 'Counterparty',
        'explorer.field.memo': 'Memo',
        'explorer.field.type': 'Type',
        'explorer.field.status': 'Status',
        'explorer.field.amount': 'Amount',
        'explorer.field.rail': 'Rail',
        'explorer.field.reference': 'Reference',
        'explorer.field.id': 'Transaction ID',

        'explorer.empty.title': 'No transactions match',
        'explorer.empty.applied': 'Nothing in this statement matches: {applied}.',
        'explorer.empty.hint': 'Remove a filter above, or clear them all to see every transaction.',
        'explorer.empty.clear': 'Clear all filters',

        'explorer.export.title': 'Download or print',
        'explorer.export.body': 'CSV files are created on this device from the same statement data, and every row is marked as illustrative demo data. Nothing is sent.',
        'explorer.export.bodyPdf': 'Print the statement of record or save it as a PDF, or download the transactions as CSV. Files are created on this device from the same statement data and marked as illustrative demo data. Nothing is sent.',
        'explorer.export.pdf': 'Download PDF statement',
        'explorer.export.all': 'Download CSV — complete record',
        'explorer.export.view': 'Download CSV — current view ({n})',
        'explorer.export.done': 'CSV download started ({count}). Nothing was sent.',
        'explorer.export.empty': 'There are no transactions in the current view to download.',

        'explorer.csv.statementId': 'Statement ID',
        'explorer.csv.txId': 'Transaction ID',
        'explorer.csv.postedDate': 'Posted date',
        'explorer.csv.postedTime': 'Posted time',
        'explorer.csv.initiatedDate': 'Initiated date',
        'explorer.csv.initiatedTime': 'Initiated time',
        'explorer.csv.timezone': 'Time zone',
        'explorer.csv.type': 'Event type',
        'explorer.csv.typeLabel': 'Type',
        'explorer.csv.description': 'Description',
        'explorer.csv.counterparty': 'Counterparty',
        'explorer.csv.memo': 'Memo',
        'explorer.csv.direction': 'Direction',
        'explorer.csv.amount': 'Amount',
        'explorer.csv.asset': 'Asset',
        'explorer.csv.balanceAfter': 'Balance after',
        'explorer.csv.status': 'Status',
        'explorer.csv.included': 'Included in statement balance',
        'explorer.csv.rail': 'Rail',
        'explorer.csv.method': 'Method',
        'explorer.csv.reference': 'Reference',
        'explorer.csv.parentId': 'Related transaction ID',
        'explorer.csv.statementVersion': 'Statement version',
        'explorer.csv.issueStatus': 'Issue status',
        'explorer.csv.periodStart': 'Period start',
        'explorer.csv.periodEnd': 'Period end',
        'explorer.csv.asOf': 'Statement as of',
        'explorer.csv.generatedAt': 'Generated',
        'explorer.csv.dateBasis': 'Date basis',
        'explorer.csv.openingBalance': 'Opening balance',
        'explorer.csv.closingBalance': 'Closing balance',
        'explorer.csv.scope': 'Export scope',
        'explorer.csv.scopeAll': 'Complete record',
        'explorer.csv.scopeView': 'Current view — filters: {filters}; order: {sort}',
        'explorer.csv.noFilters': 'none',
        'explorer.csv.classification': 'Data classification',

        'explorer.notFound': 'Transaction {id} is not in this statement.',

        'explorer.dlg.close': 'Close transaction details',
        'explorer.dlg.eyebrow': '{type} · {date}',
        'explorer.dlg.unit': '{asset} ({symbol})',
        'explorer.dlg.details': 'Details',
        'explorer.dlg.status': 'Status',
        'explorer.dlg.posted': 'Posted',
        'explorer.dlg.notPosted': 'Not posted — pending at the statement cut-off',
        'explorer.dlg.initiated': 'Initiated',
        'explorer.dlg.prevPeriodNote': 'Initiated in the previous period. It belongs to this statement because statements use the posted date.',
        'explorer.dlg.type': 'Type',
        'explorer.dlg.eventType': 'Event type',
        'explorer.dlg.rail': 'Rail and method',
        'explorer.dlg.counterparty': 'Counterparty',
        'explorer.dlg.description': 'Description',
        'explorer.dlg.memo': 'Memo',
        'explorer.dlg.balanceAfter': 'Balance after',
        'explorer.dlg.reference': 'Reference',
        'explorer.dlg.txId': 'Transaction ID',
        'explorer.dlg.copyLabel': 'Copy {label} {value}',
        'explorer.dlg.copyHash': 'Copy the full illustrative transaction hash',
        'explorer.dlg.times': 'Times shown in {tz}.',
        'explorer.dlg.fees': 'Fees',
        'explorer.dlg.noFees': 'No fees were charged for this transaction.',
        'explorer.dlg.feeSeparate': 'Fees are recorded as their own lines so each amount can be traced.',
        'explorer.dlg.feeKind.network_transfer': 'Network transfer fee',
        'explorer.dlg.feeKind.card_deposit': 'Card deposit fee',
        'explorer.dlg.feeKind.redemption': 'Redemption fee',
        'explorer.dlg.feeKind.other': 'Service fee',
        'explorer.dlg.openFee': 'Open fee line',
        'explorer.dlg.openFeeLabel': 'Open fee line: {kind}, {id}',
        'explorer.dlg.totalWithFees': 'Total including fees',
        'explorer.dlg.feeOf': 'This fee belongs to:',
        'explorer.dlg.openParent': 'Open transaction',
        'explorer.dlg.openParentLabel': 'Open the related transaction {id}',
        'explorer.dlg.foreignFee': 'Charged in {asset}. Shown separately and not included in the balance journey.',
        'explorer.dlg.onchain': 'Blockchain details',
        'explorer.dlg.onchainLabel': 'Illustrative reference — no live blockchain verification',
        'explorer.dlg.onchainNoLink': 'This fictional reference has not been checked on any blockchain, so no explorer link is shown. Linking it to a real explorer would suggest a verification that has not happened.',
        'explorer.dlg.network': 'Network',
        'explorer.dlg.hash': 'Transaction hash',
        'explorer.dlg.confirmations': 'Confirmations',
        'explorer.dlg.onchainUnverified': 'Blockchain details appear only when verified. No verified network, hash or confirmations are available for this transfer, so none are shown.',
        'explorer.dlg.notes': 'Notes',
        'explorer.dlg.explainTopic': '{description} ({id})',
        'explorer.dlg.ask': 'Ask about this transaction',
        'explorer.dlg.continue': 'Continue your inquiry',
        'explorer.dlg.viewInquiry': 'View your demo inquiry',
        'explorer.dlg.draftNote': 'You have an unfinished inquiry about this transaction. Pick up where you left off.',
        'explorer.dlg.submittedNote': 'Demo inquiry {ref} completed. Demo only — no inquiry was sent.',
        'explorer.dlg.pager': 'Move between transactions',
        'explorer.dlg.prevLabel': 'Previous transaction',
        'explorer.dlg.nextLabel': 'Next transaction',
        'explorer.dlg.position': '{a} of {b}',
        'explorer.dlg.showing': 'Showing {description}, {position}.'
      },
      es: {
        'explorer.title': 'Movimientos',
        'explorer.lede': 'Los {n} movimientos de tu estado de cuenta del {period}.',
        'explorer.ledeTimes': 'Las horas se muestran en {tz}.',
        'explorer.initiatedNote': 'Ordenado por fecha de inicio: la columna de fecha muestra cuándo se inició cada movimiento. El filtro de fechas y los totales siguen usando la fecha de registro.',
        'explorer.undatedNote1': '1 movimiento iniciado en estas fechas no aparece: no se ha registrado, así que todavía no tiene {basis}.',
        'explorer.undatedNoteN': '{n} movimientos iniciados en estas fechas no aparecen: no se han registrado, así que todavía no tienen {basis}.',

        'explorer.search.region': 'Movimientos',
        'explorer.search.label': 'Buscar movimientos',
        'explorer.search.placeholder': 'Nombre, importe, referencia',
        'explorer.search.hint': 'Busca en descripción, contraparte, concepto, tipo, estado, canal, referencia, ID del movimiento e importe.',
        'explorer.search.clear': 'Borrar búsqueda',

        'explorer.filters.title': 'Filtros',
        'explorer.filters.toggle': 'Filtros',
        'explorer.filters.activeN': '{n} activos',
        'explorer.filters.nMatching': 'resultados: {n}',
        'explorer.filters.dateLegend': 'Rango de fechas ({basis})',
        'explorer.filters.from': 'Desde',
        'explorer.filters.to': 'Hasta',
        'explorer.filters.dateError': 'La fecha inicial es posterior a la final, así que nada puede coincidir.',
        'explorer.filters.direction': 'Dirección',
        'explorer.filters.type': 'Tipo de movimiento',
        'explorer.filters.status': 'Estado',
        'explorer.filters.rail': 'Canal',
        'explorer.filters.amount': 'Importe',
        'explorer.filters.amountHint': 'Tamaño en {symbol}, sin tener en cuenta el signo. Usa coma o punto para los decimales.',
        'explorer.filters.min': 'Mínimo',
        'explorer.filters.max': 'Máximo',
        'explorer.filters.amountInvalid': 'Escribe un importe como 45,50 o 45.50.',
        'explorer.filters.amountOrder': 'El mínimo es mayor que el máximo, así que nada puede coincidir.',
        'explorer.filters.showResults': 'Ver resultados ({n})',

        'explorer.dir.all': 'Todos',
        'explorer.dir.in': 'Entradas',
        'explorer.dir.out': 'Salidas',

        'explorer.basis.posted': 'fecha de registro',
        'explorer.basis.initiated': 'fecha de inicio',
        'explorer.basis.postedCap': 'Registro',
        'explorer.basis.initiatedCap': 'Inicio',

        'explorer.sort.label': 'Ordenar por',
        'explorer.sort.posted.desc': 'Fecha de registro, más recientes',
        'explorer.sort.posted.asc': 'Fecha de registro, más antiguos',
        'explorer.sort.initiated.desc': 'Fecha de inicio, más recientes',
        'explorer.sort.initiated.asc': 'Fecha de inicio, más antiguos',
        'explorer.sort.amount.desc': 'Importe, de mayor a menor',
        'explorer.sort.amount.asc': 'Importe, de menor a mayor',
        'explorer.sort.announce': 'Ordenado por {label}.',

        'explorer.chips.label': 'Filtros activos',
        'explorer.chip.q': 'Búsqueda: «{q}»',
        'explorer.chip.step': 'Paso: {label}',
        'explorer.chip.ids': 'Movimientos seleccionados ({n})',
        'explorer.chip.idsLabel': '{label} ({n})',
        'explorer.chip.dateRange': '{basis}: {range}',
        'explorer.chip.dateFrom': '{basis}: desde el {date}',
        'explorer.chip.dateTo': '{basis}: hasta el {date}',
        'explorer.chip.dir': 'Dirección: {label}',
        'explorer.chip.type': 'Tipo: {label}',
        'explorer.chip.status': 'Estado: {label}',
        'explorer.chip.rail': 'Canal: {label}',
        'explorer.chip.amountRange': 'Importe: de {min} a {max}',
        'explorer.chip.amountMin': 'Importe: desde {min}',
        'explorer.chip.amountMax': 'Importe: hasta {max}',
        'explorer.chip.remove': '{label} — quitar filtro',
        'explorer.chip.removed': 'Filtro quitado: {label}.',
        'explorer.cleared': 'Se borraron todos los filtros.',
        'explorer.backToJourney': 'Volver al recorrido del saldo',

        'explorer.count.all': 'Mostrando los {total} movimientos',
        'explorer.count.some': 'Mostrando {shown} de {total} movimientos',
        'explorer.announce.none': 'Ningún movimiento coincide. Mostrando 0 de {total} movimientos.',
        'explorer.total.filtered1': 'Total filtrado: {amount} en 1 movimiento registrado',
        'explorer.total.filteredN': 'Total filtrado: {amount} en {n} movimientos registrados',
        'explorer.total.all1': 'Cambio neto: {amount} en 1 movimiento registrado',
        'explorer.total.allN': 'Cambio neto: {amount} en {n} movimientos registrados',
        'explorer.total.none': 'No hay movimientos registrados en esta vista, así que no hay total filtrado.',
        'explorer.pendingNote1': '1 movimiento pendiente ({amount}) aparece en la lista pero no se incluye en el saldo del estado de cuenta.',
        'explorer.pendingNoteN': '{n} movimientos pendientes ({amount}) aparecen en la lista pero no se incluyen en el saldo del estado de cuenta.',
        'explorer.caption': 'Orden: {sort} · Fechas: {basis} · Importes en {symbol} · Horas en {tz}',

        'explorer.col.date.posted': 'Registro',
        'explorer.col.date.initiated': 'Inicio',
        'explorer.col.description': 'Descripción',
        'explorer.col.status': 'Estado',
        'explorer.col.amount': 'Importe',
        'explorer.col.balance': 'Saldo después',

        'explorer.row.openLabel': '{description}, {counterparty}, {date}, {amount}.',
        'explorer.row.openLabelNotIn': '{label} {status}. {notIn}.',
        'explorer.row.viewDetails': 'Ver detalles',
        'explorer.row.initiatedDate': 'iniciado el {date}',
        'explorer.row.initiated': 'Iniciado {time}',
        'explorer.row.initiatedOn': 'Iniciado el {date}',
        'explorer.row.prevPeriod': 'Período anterior',
        'explorer.row.balanceAfter': 'Saldo después: {amount}',

        'explorer.memoQuoted': '«{memo}»',
        'explorer.match.in': 'Coincidencia en',
        'explorer.field.description': 'Descripción',
        'explorer.field.counterparty': 'Contraparte',
        'explorer.field.memo': 'Concepto',
        'explorer.field.type': 'Tipo',
        'explorer.field.status': 'Estado',
        'explorer.field.amount': 'Importe',
        'explorer.field.rail': 'Canal',
        'explorer.field.reference': 'Referencia',
        'explorer.field.id': 'ID del movimiento',

        'explorer.empty.title': 'Ningún movimiento coincide',
        'explorer.empty.applied': 'Nada en este estado de cuenta coincide con: {applied}.',
        'explorer.empty.hint': 'Quita un filtro de arriba o bórralos todos para ver todos los movimientos.',
        'explorer.empty.clear': 'Borrar todos los filtros',

        'explorer.export.title': 'Descargar o imprimir',
        'explorer.export.body': 'Los archivos CSV se crean en este dispositivo con los mismos datos del estado de cuenta, y cada fila está marcada como datos ilustrativos de demostración. No se envía nada.',
        'explorer.export.bodyPdf': 'Imprime el estado de cuenta oficial o guárdalo en PDF, o descarga los movimientos en CSV. Los archivos se crean en este dispositivo con los mismos datos del estado de cuenta y están marcados como datos ilustrativos de demostración. No se envía nada.',
        'explorer.export.pdf': 'Descargar estado de cuenta en PDF',
        'explorer.export.all': 'Descargar CSV — registro completo',
        'explorer.export.view': 'Descargar CSV — vista actual ({n})',
        'explorer.export.done': 'Descarga del CSV iniciada ({count}). No se envió nada.',
        'explorer.export.empty': 'No hay movimientos en la vista actual para descargar.',

        'explorer.csv.statementId': 'ID del estado de cuenta',
        'explorer.csv.txId': 'ID del movimiento',
        'explorer.csv.postedDate': 'Fecha de registro',
        'explorer.csv.postedTime': 'Hora de registro',
        'explorer.csv.initiatedDate': 'Fecha de inicio',
        'explorer.csv.initiatedTime': 'Hora de inicio',
        'explorer.csv.timezone': 'Zona horaria',
        'explorer.csv.type': 'Tipo de evento',
        'explorer.csv.typeLabel': 'Tipo',
        'explorer.csv.description': 'Descripción',
        'explorer.csv.counterparty': 'Contraparte',
        'explorer.csv.memo': 'Concepto',
        'explorer.csv.direction': 'Dirección',
        'explorer.csv.amount': 'Importe',
        'explorer.csv.asset': 'Activo',
        'explorer.csv.balanceAfter': 'Saldo después',
        'explorer.csv.status': 'Estado',
        'explorer.csv.included': 'Incluido en el saldo del estado de cuenta',
        'explorer.csv.rail': 'Canal',
        'explorer.csv.method': 'Método',
        'explorer.csv.reference': 'Referencia',
        'explorer.csv.parentId': 'ID del movimiento relacionado',
        'explorer.csv.statementVersion': 'Versión del estado de cuenta',
        'explorer.csv.issueStatus': 'Estado de emisión',
        'explorer.csv.periodStart': 'Inicio del período',
        'explorer.csv.periodEnd': 'Fin del período',
        'explorer.csv.asOf': 'Estado de cuenta a fecha de',
        'explorer.csv.generatedAt': 'Generado',
        'explorer.csv.dateBasis': 'Base de fechas',
        'explorer.csv.openingBalance': 'Saldo inicial',
        'explorer.csv.closingBalance': 'Saldo final',
        'explorer.csv.scope': 'Alcance de la exportación',
        'explorer.csv.scopeAll': 'Registro completo',
        'explorer.csv.scopeView': 'Vista actual — filtros: {filters}; orden: {sort}',
        'explorer.csv.noFilters': 'ninguno',
        'explorer.csv.classification': 'Clasificación de los datos',

        'explorer.notFound': 'El movimiento {id} no está en este estado de cuenta.',

        'explorer.dlg.close': 'Cerrar los detalles del movimiento',
        'explorer.dlg.eyebrow': '{type} · {date}',
        'explorer.dlg.unit': '{asset} ({symbol})',
        'explorer.dlg.details': 'Detalles',
        'explorer.dlg.status': 'Estado',
        'explorer.dlg.posted': 'Registrado',
        'explorer.dlg.notPosted': 'Sin registrar: estaba pendiente al cierre del estado de cuenta',
        'explorer.dlg.initiated': 'Iniciado',
        'explorer.dlg.prevPeriodNote': 'Se inició en el período anterior. Pertenece a este estado de cuenta porque los estados de cuenta usan la fecha de registro.',
        'explorer.dlg.type': 'Tipo',
        'explorer.dlg.eventType': 'Tipo de evento',
        'explorer.dlg.rail': 'Canal y método',
        'explorer.dlg.counterparty': 'Contraparte',
        'explorer.dlg.description': 'Descripción',
        'explorer.dlg.memo': 'Concepto',
        'explorer.dlg.balanceAfter': 'Saldo después',
        'explorer.dlg.reference': 'Referencia',
        'explorer.dlg.txId': 'ID del movimiento',
        'explorer.dlg.copyLabel': 'Copiar {label} {value}',
        'explorer.dlg.copyHash': 'Copiar el hash ilustrativo completo de la transacción',
        'explorer.dlg.times': 'Horas mostradas en {tz}.',
        'explorer.dlg.fees': 'Comisiones',
        'explorer.dlg.noFees': 'No se cobraron comisiones por este movimiento.',
        'explorer.dlg.feeSeparate': 'Las comisiones se registran como líneas propias para que cada importe pueda rastrearse.',
        'explorer.dlg.feeKind.network_transfer': 'Comisión por transferencia en red',
        'explorer.dlg.feeKind.card_deposit': 'Comisión por depósito con tarjeta',
        'explorer.dlg.feeKind.redemption': 'Comisión por canje',
        'explorer.dlg.feeKind.other': 'Comisión de servicio',
        'explorer.dlg.openFee': 'Abrir comisión',
        'explorer.dlg.openFeeLabel': 'Abrir comisión: {kind}, {id}',
        'explorer.dlg.totalWithFees': 'Total con comisiones',
        'explorer.dlg.feeOf': 'Esta comisión corresponde a:',
        'explorer.dlg.openParent': 'Abrir movimiento',
        'explorer.dlg.openParentLabel': 'Abrir el movimiento relacionado {id}',
        'explorer.dlg.foreignFee': 'Cobrada en {asset}. Se muestra por separado y no se incluye en el recorrido del saldo.',
        'explorer.dlg.onchain': 'Detalles de blockchain',
        'explorer.dlg.onchainLabel': 'Referencia ilustrativa — sin verificación en blockchain en vivo',
        'explorer.dlg.onchainNoLink': 'Esta referencia ficticia no se ha comprobado en ninguna blockchain, por eso no se muestra un enlace a un explorador. Enlazarla a un explorador real sugeriría una verificación que no ha ocurrido.',
        'explorer.dlg.network': 'Red',
        'explorer.dlg.hash': 'Hash de la transacción',
        'explorer.dlg.confirmations': 'Confirmaciones',
        'explorer.dlg.onchainUnverified': 'Los detalles de blockchain solo aparecen cuando están verificados. No hay red, hash ni confirmaciones verificados para esta transferencia, así que no se muestran.',
        'explorer.dlg.notes': 'Notas',
        'explorer.dlg.explainTopic': '{description} ({id})',
        'explorer.dlg.ask': 'Preguntar por este movimiento',
        'explorer.dlg.continue': 'Continuar tu consulta',
        'explorer.dlg.viewInquiry': 'Ver tu consulta de demostración',
        'explorer.dlg.draftNote': 'Tienes una consulta sin terminar sobre este movimiento. Continúa donde la dejaste.',
        'explorer.dlg.submittedNote': 'Consulta de demostración {ref} completada. Solo demostración: no se envió ninguna consulta.',
        'explorer.dlg.pager': 'Moverse entre movimientos',
        'explorer.dlg.prevLabel': 'Movimiento anterior',
        'explorer.dlg.nextLabel': 'Movimiento siguiente',
        'explorer.dlg.position': '{a} de {b}',
        'explorer.dlg.showing': 'Mostrando: {description}, {position}.'
      }
    },
    init: function () {
      els.root = doc.getElementById('transactions-root');
      els.dlg = doc.getElementById('tx-dialog');
      if (!YES.state.explorer) YES.state.explorer = { filtersOpen: false };
      if (!els.root) return;
      bind();
      this.render();
    },
    render: function () {
      localizeAmounts();
      renderView();
      if (els.dlg && els.dlg.open && YES.state.selectedTx) renderDialog();
    },
    onState: function (keys) {
      if (!els.root || !els.root.firstChild) return;
      if (keys.indexOf('filters') !== -1 || keys.indexOf('sort') !== -1) update();
      if (keys.indexOf('inquiry') !== -1 && els.dlg && els.dlg.open && YES.state.selectedTx) renderDialog();
    }
  });
})(window);
