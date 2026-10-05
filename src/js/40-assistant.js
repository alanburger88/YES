/*
 * Ask YES — assistant drawer and deterministic demo explanations
 * (PRD 2 "AI" row, 5.5, 5.6, 9 "Explanation").
 *
 * Every answer is computed here, in the browser, from YES.calc / YES.data only.
 * No model, no network and no invented facts: if a question cannot be matched
 * to something this statement can answer, the assistant says so and offers
 * suggestions and a human-help route.
 *
 * The conversation lives in YES.state.assistant as intents (topic + id, curated
 * question id, or the visitor's own words plus the matched intent) — never as
 * rendered text — so a language switch re-renders the whole thread in the new
 * language. A question typed in the other language is answered in that language
 * (the entry keeps `lang`) until the visitor next chooses a language.
 *
 * Free text is matched with keyword tiers: everyday words ("today", "network",
 * "cost") count only alongside a statement word, so off-topic questions get the
 * honest fallback rather than an unrelated curated answer.
 *
 * Drawer modes
 *   docked  ≥1100px: non-modal, html.assistant-docked reflows the page so the
 *           drawer never covers the balance.
 *   modal   720–1099px: modal side drawer with a backdrop; <720px: full-screen sheet.
 *   stacked opened while another modal dialog is open: a modal on top of it,
 *           closing returns focus inside that dialog.
 *
 * Language (ARCHITECTURE rule 7): the drawer has no language switch of its own
 * and never offers one. It renders in the language chosen in the masthead (the
 * phone Menu) and re-renders the whole thread when that changes. Docked, the
 * masthead's switch is right beside it; modal, the page behind is inert, so the
 * visitor closes the drawer to change language, and the conversation (thread,
 * feedback, draft question) is kept in YES.state for when it is reopened.
 */
(function (root) {
  'use strict';
  var YES = root.YES;
  var ui = YES.ui;
  var t = YES.t;
  var esc = ui.esc;
  /* Text that may hold masked identifiers ("Debit card •••• 1190"), as HTML:
     the bullets stay visible, assistive technology hears "ending in 1190". */
  var mask = ui.maskedHtml || esc;
  var doc = root.document;
  var calc = YES.calc;
  var fmt = YES.fmt;

  var MAX_THREAD = 24;
  var ROW_PREVIEW = 6;
  var SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
  var ENTRY_ID = /^a\d{1,9}$/;
  var QUESTIONS = ['why_balance', 'fees_paid', 'largest', 'pending', 'statement_vs_live', 'peg', 'onchain_sent'];
  var Q_TOPIC = {
    why_balance: { topic: 'balance' },
    fees_paid: { topic: 'fees' },
    largest: { topic: 'largest' },
    pending: { topic: 'pending' },
    statement_vs_live: { topic: 'edu', id: 'statement_vs_live' },
    peg: { topic: 'peg' },
    onchain_sent: { topic: 'onchain_sent' }
  };
  var EDU = ['token_units', 'usd_equivalent', 'onchain_vs_internal', 'tx_status', 'fees', 'redemption', 'statement_vs_live', 'transparency'];
  var CONTEXT_TOPICS = { general: 1, balance: 1, step: 1, transaction: 1, fees: 1, edu: 1, chart: 1, pending: 1 };
  var RAILS = ['internal', 'onchain', 'other'];
  var CP_STOP = { linked: 1, external: 1, debit: 1, yes: 1, cuenta: 1, monedero: 1, tarjeta: 1, comision: 1, bank: 1, card: 1, wallet: 1 };

  var els = { root: null, dlg: null };
  var mode = null; // null (closed) | 'docked' | 'modal' | 'stacked'
  var returnTo = null; // element that gets focus back on close
  var animateId = null; // entry id that animates in on the next render
  var inqSig = ''; // inquiry states behind the rendered inquiry actions (see inquirySig)
  var mqDock = root.matchMedia ? root.matchMedia('(min-width: 1100px)') : null;

  /* ------------------------------------------------------------------ */
  /* Small helpers                                                       */
  /* ------------------------------------------------------------------ */
  function st() {
    return YES.data.statement;
  }
  function locale() {
    return YES.i18n.locale();
  }
  function fill(s, v) {
    return String(s).replace(/\{(\w+)\}/g, function (m, k) {
      return v[k] != null ? v[k] : m;
    });
  }
  /** Plural-aware string: picks `one` when vars.n === 1. */
  function pl(one, many) {
    return function (v) {
      return fill(v.n === 1 ? one : many, v);
    };
  }
  /** String that picks `withIt` when vars[name] is non-empty, else `without`. */
  function ifVar(name, withIt, without) {
    return function (v) {
      return fill(v[name] ? withIt : without, v);
    };
  }
  /** Translate `key`, escape it, then splice in pre-built HTML for `html` vars. */
  function P(key, vars, html) {
    var v = {};
    var marks = {};
    var n = 0;
    var k;
    for (k in vars || {}) v[k] = vars[k];
    for (k in html || {}) {
      var m = '\u0001' + n++ + '\u0002';
      v[k] = m;
      marks[m] = html[k];
    }
    var s = mask(t(key, v));
    Object.keys(marks).forEach(function (mk) {
      s = s.split(mk).join(marks[mk]);
    });
    return s;
  }
  function lc(s) {
    s = String(s || '');
    return s.charAt(0).toLocaleLowerCase(locale()) + s.slice(1);
  }
  function list(items) {
    try {
      return new Intl.ListFormat(locale(), { style: 'long', type: 'conjunction' }).format(items);
    } catch (e) {
      return items.join(', ');
    }
  }
  function sumOf(txs) {
    var s = 0;
    txs.forEach(function (x) {
      s += x.amount;
    });
    return s;
  }
  function ids(txs) {
    return txs.map(function (x) {
      return x.id;
    });
  }
  function txs(idList) {
    return idList
      .map(function (id) {
        return calc.tx(id);
      })
      .filter(Boolean);
  }
  function tzShort(iso) {
    var s = fmt.tz(iso);
    var i = s.indexOf(' (');
    return i === -1 ? s : s.slice(0, i);
  }
  function dLong(iso) {
    return fmt.date(iso, 'long');
  }
  function dShort(iso) {
    return fmt.date(iso, 'short');
  }
  function dTime(iso) {
    return fmt.date(iso, 'time') + ' ' + tzShort(iso);
  }
  function asOfText() {
    var a = st().asOf;
    return fmt.date(a, 'datetime') + ' ' + tzShort(a);
  }
  function period() {
    return fmt.date(st().periodEnd, 'monthYear');
  }
  /** Unsigned amount for prose ("reduced by 450.00 USBC"). */
  function amt(minor) {
    return '<span class="asst-num">' + esc(fmt.amount(Math.abs(minor), { sign: 'never' })) + '</span>';
  }
  /** Signed amount with spoken text for screen readers. */
  function samt(minor, sign) {
    return ui.amountHtml(minor, { sign: sign || 'always' });
  }
  function statusLabel(s) {
    return t({ posted: 1, pending: 1, failed: 1 }[s] ? 'status.' + s : 'status.unknown');
  }
  function railLabel(r) {
    var k = 'rail.' + r;
    return YES.i18n.dict[YES.i18n.lang][k] ? t(k) : String(r || '');
  }
  function methodLabel(m) {
    var k = 'method.' + m;
    return YES.i18n.dict[YES.i18n.lang][k] ? t(k) : String(m || '');
  }
  function feeKind(k) {
    var key = 'assistant.feeKind.' + (k || 'other');
    return YES.i18n.dict[YES.i18n.lang][key] ? t(key) : t('assistant.feeKind.other');
  }
  function largestOf(list2) {
    var best = null;
    list2.forEach(function (x) {
      if (!best || Math.abs(x.amount) > Math.abs(best.amount)) best = x;
    });
    return best;
  }
  function visible(el) {
    return !!(el && el.isConnected && (el.offsetParent !== null || el.getClientRects().length > 0));
  }
  function docked() {
    return !!(mqDock && mqDock.matches);
  }
  /** Attribute selector for a focus key, safe for any value. */
  function fkSel(fk) {
    var v = root.CSS && root.CSS.escape ? root.CSS.escape(fk) : String(fk).replace(/["\\]/g, '\\$&');
    return '[data-fk="' + v + '"]';
  }
  function bodyEl() {
    return els.dlg ? els.dlg.querySelector('.asst__body') : null;
  }
  /** What scrolls: the conversation body, or the whole drawer on very short viewports (CSS). */
  function scrollerEl() {
    var b = bodyEl();
    if (!b) return null;
    return root.getComputedStyle(b).overflowY === 'visible' ? els.dlg : b;
  }
  function isLang(l) {
    return YES.config.languages.indexOf(l) !== -1;
  }
  /**
   * Run `fn` with strings, numbers and dates in `lang`, then restore the UI
   * language. Synchronous and self-contained: every YES.t / YES.fmt / YES.L call
   * inside reads YES.i18n.lang, and their caches are keyed by language.
   */
  function withLang(lang, fn) {
    var ui0 = YES.i18n.lang;
    if (!isLang(lang) || lang === ui0) return fn();
    YES.i18n.lang = lang;
    try {
      return fn();
    } finally {
      YES.i18n.lang = ui0;
    }
  }
  /** A localised { en, es } value built by running `fn` in each language. */
  function localized(fn) {
    var out = {};
    YES.config.languages.forEach(function (l) {
      out[l] = withLang(l, fn);
    });
    return out;
  }

  /* Transaction ids never break at their hyphens. */
  function idHtml(id) {
    return '<span class="asst-id">' + esc(id) + '</span>';
  }
  /** Figure label with an unbroken id: { html }. */
  function idLabel(key, id, vars) {
    return { html: P(key, vars || {}, { id: idHtml(id) }) };
  }
  /* Figures used: rows of { label, html, total, txt }. */
  function fig(label, minor, sign, total) {
    return { label: label, html: samt(minor, sign), total: !!total };
  }
  function figText(label, text, opts) {
    return { label: label, html: mask(text), txt: true, mono: !!(opts && opts.mono) };
  }
  /**
   * The customer's own note, as they wrote it: never translated, so it keeps the
   * statement's language and says so with lang when that differs from the
   * language this answer is rendered in (WCAG 3.1.2).
   */
  function memoHtml(memo) {
    if (memo && typeof memo === 'object') return mask(YES.L(memo)); // localised: already in this language
    var l = String(st().language || '');
    var h = mask(memo);
    return l && l.split('-')[0].toLowerCase() !== YES.i18n.lang ? '<span lang="' + esc(l) + '">' + h + '</span>' : h;
  }
  /** An answer's supporting rows: each statement transaction once, in the answer's order. */
  function supportRows(m) {
    return (m.rows || []).filter(function (r, i, a) {
      return a.indexOf(r) === i && !!calc.tx(r);
    });
  }

  /* ------------------------------------------------------------------ */
  /* Conversation state (YES.state.assistant)                            */
  /* ------------------------------------------------------------------ */
  function copy(o) {
    var out = {};
    Object.keys(o || {}).forEach(function (k) {
      out[k] = o[k];
    });
    return out;
  }
  function S() {
    var a = YES.state.assistant;
    if (!a || typeof a !== 'object') a = {};
    return {
      open: !!a.open,
      seq: a.seq || 0,
      thread: Array.isArray(a.thread) ? a.thread.slice() : [],
      helpful: copy(a.helpful),
      expanded: copy(a.expanded),
      privacyOpen: !!a.privacyOpen,
      draft: typeof a.draft === 'string' ? a.draft : ''
    };
  }
  function save(s) {
    YES.set({ assistant: s });
  }
  function sameIntent(a, b) {
    return a && b && a.via === b.via && a.via !== 'typed' && a.topic === b.topic && (a.tid || null) === (b.tid || null) && (a.q || null) === (b.q || null);
  }
  /** Append an entry (deduplicating an identical repeat) and return its id. */
  function push(entry, patch) {
    var s = S();
    var last = s.thread[s.thread.length - 1];
    var e = {
      topic: entry.topic || null,
      tid: entry.tid != null ? String(entry.tid) : null,
      q: entry.q || null,
      via: entry.via || 'context',
      text: entry.text || null
    };
    // A typed question in the other language is answered in that language.
    if (entry.lang && isLang(entry.lang)) e.lang = entry.lang;
    // The language of the visitor's own words, when clear (for a lang attribute).
    if (entry.qlang && isLang(entry.qlang)) e.qlang = entry.qlang;
    var id;
    if (sameIntent(last, e)) {
      id = last.id;
    } else {
      s.seq += 1;
      e.id = 'a' + s.seq;
      id = e.id;
      s.thread.push(e);
      while (s.thread.length > MAX_THREAD) {
        var gone = s.thread.shift();
        delete s.helpful[gone.id];
        delete s.expanded[gone.id];
      }
      animateId = id;
    }
    if (patch) Object.keys(patch).forEach(function (k) {
      s[k] = patch[k];
    });
    save(s);
    return id;
  }
  function findEntry(id) {
    var th = S().thread;
    for (var i = 0; i < th.length; i++) if (th[i].id === id) return th[i];
    return null;
  }
  /** The topic an entry resolves to: curated questions map onto topics. */
  function resolve(e) {
    if (!e) return { topic: 'general', id: null };
    if (e.q) return Q_TOPIC[e.q] ? { topic: Q_TOPIC[e.q].topic, id: Q_TOPIC[e.q].id || null } : { topic: 'fallback', id: null };
    return { topic: e.topic || 'general', id: e.tid || null };
  }

  /* ------------------------------------------------------------------ */
  /* Free-text intent matching (EN + ES, deterministic)                  */
  /* ------------------------------------------------------------------ */
  function norm(s) {
    s = String(s || '').toLowerCase();
    try {
      s = s.normalize('NFD').replace(/[̀-ͯ]/g, '');
    } catch (e) {
      /* no normalize: accents stay, Spanish keywords still match unaccented text */
    }
    return s
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  var RX = {
    question: /^(what|whats|why|where|when|how|which|who|whom|whose|did|does|was|were|is|are|has|have|had|explain|tell me|show me|list|que|por que|porque|donde|a donde|adonde|cuando|como|cual|cuales|cuanto|cuanta|cuantos|cuantas|quien|explica|explicame|muestrame|dime|hay)\b/,
    actEn: /^(please |pls |can you |could you |would you |will you |i want to |i d like to |id like to |i would like to |i need to |help me |let me |go ahead and |now )?(send|transfer|pay|move|withdraw|redeem|cash out|cancel|reverse|refund|buy|sell|convert|swap|deposit|top up|make a payment|make a transfer)\b/,
    actEs: /^(por favor |puedes |podrias |quiero |quisiera |necesito |me gustaria |ayudame a |ahora )?(envia|enviar|envie|enviame|manda|mandar|transfiere|transferir|transfiereme|paga|pagar|mueve|mover|retira|retirar|canjea|canjear|cancela|cancelar|anula|anular|compra|comprar|vende|vender|deposita|depositar|convierte|convertir|haz un pago|haz un envio|haz una transferencia)\b/,
    actAny: /\b(can|could|would|will) you (please )?(send|transfer|pay|move|withdraw|redeem|cancel|reverse|buy|sell)\b|\b(puedes|podrias) (por favor )?(enviar|transferir|pagar|mover|retirar|canjear|cancelar|anular|comprar|vender)\b/,
    peg: /\b(peg|pegged|depeg|depegged|always (be )?worth|worth (exactly )?(one|1|a) (us )?(dollar|usd)|one to one|stay at (one|1) dollar|lose (its )?value|hold (its )?value|keep (its )?value|stable value|paridad|siempre vale|vale siempre|valdra siempre|vale (un|1) dolar|uno a uno|perder (su )?valor|pierde (su )?valor|mantener (su )?valor|mantiene (su )?valor|mantendra (su )?valor)\b/,
    advice: /\b(should i|shall i|do you recommend|would you recommend|recommend|recommendation|advice|advise|invest|invested|investing|investment|investments|good time|worth buying|buy|buying|sell|selling|profit|profits|yield|apy|deberia|conviene|recomiendas|recomiendo|recomendacion|consejo|aconsejas|invertir|inversion|inversiones|invierto|comprar|compro|vender|vendo|ganancia|ganancias|rentabilidad|rendimiento)\b/,
    future: /\b(will|going to|gonna|predict|prediction|forecast|expect|next week|next month|next year|tomorrow|future|prediccion|pronostico|futuro|manana|proximo mes|proximo ano)\b/,
    value: /\b(price|value|worth|go up|go down|rise|fall|increase|decrease|drop|crash|gain|lose|precio|valor|vale|valdra|subir|bajar|sube|baja)\b/,
    predictEs: /\b(subira|bajara|va a subir|va a bajar)\b/,
    human: /\b(person|human|agent|someone|representative|call|phone|email|support|complain|complaint|dispute|fraud|contact|speak|talk to|inquiry|persona|humano|agente|alguien|representante|llamar|telefono|correo|soporte|reclamo|reclamacion|queja|disputa|fraude|contacto|contactar|hablar con|consulta)\b/,
    /*
     * Two tiers per topic. A strong pattern names a statement topic on its own
     * ("fees", "blockchain", "pending"). A weak pattern (…Weak) is an everyday
     * word that means that topic only in a question about this statement
     * ("today", "network", "rate", "cost"), so it routes only when the question
     * also has an anchor (below). "What is the weather today?" or "network
     * password for wifi" then reach the honest fallback, not a curated answer.
     */
    anchor: /\b(statement|statements|account|accounts|balance|balances|transaction|transactions|movement|movements|money|funds|token|tokens|usbc|us bank coin|stablecoin|stablecoins|transfer|transfers|transferred|payment|payments|deposit|deposits|redemption|redemptions|fee|fees|sent|send|received|paid|dollar|dollars|usd|month|period|estado de cuenta|cuenta|saldo|saldos|movimiento|movimientos|dinero|fondos|transferencia|transferencias|pago|pagos|deposito|depositos|canje|canjes|comision|comisiones|envie|enviado|recibi|recibido|pague|dolar|dolares|mes|periodo)\b/,
    liveStrong: /\b(live (balance|balances|account|data|status|value|figures?)|real time|realtime|in the app|app balance|en vivo|tiempo real|en la app)\b/,
    liveNow: /\b(live|current|currently|right now|now|today|latest|up to date|actual|actualmente|ahora|hoy|al dia)\b/,
    liveWhat: /\b(balance|balances|account|holdings|saldo|saldos|cuenta)\b/,
    pending: /\b(pending|not included|excluded|awaiting|processing|in progress|on hold|not posted|unposted|pendiente|pendientes|en proceso|en curso|sin registrar)\b|\b(no registrad|no incluid|excluid)/,
    pendingWeak: /\b(missing|falta|faltan)\b/,
    fees: /\b(fee|fees|charges|charged|commission|commissions|comision|comisiones|cobraron|cobran)\b/,
    feesWeak: /\b(charge|cost|costs|cargo|cargos|cobro|cobros|coste|costes|costo|costos|cuesta)\b/,
    chart: /\b(chart|graph|running balance|grafico|grafica|saldo acumulado)\b/,
    chartWeak: /\b(peak|trend|tendencia)\b/,
    highLow: /\b(highest|lowest|maximum|minimum|max|min|high point|low point|mas alto|mas bajo|maximo|minimo|punto mas)\b/,
    balanceWord: /\b(balance|saldo)\b/,
    largest: /\b(highest|most|mas alto|maximo)\b.*\b(movement|transaction|amount|transfer|payment|movimiento|importe|transferencia|pago)\b/,
    largestWeak: /\b(largest|biggest|mayor|mas grande)\b/,
    onchain: /\b(on chain|onchain|blockchain|blockchains|external wallet|external wallets|hash|en cadena|cadena de bloques|monedero externo|monederos externos)\b/,
    onchainWeak: /\b(wallet|wallets|network|networks|explorer|confirmation|confirmations|monedero|monederos|billetera|billeteras|cartera|red|redes|confirmacion|confirmaciones)\b/,
    internal: /\b(internal|interna|interno|internas|internos)\b/,
    send: /\b(send|sent|sending|sends|paid|transfer|transferred|envie|envio|envios|enviado|enviados|enviar|mande|mandado|transferi)\b/,
    transparency: /\b(reserves|attestation|attestations|backing|issuer|issuers|custodian|collateral|transparency|reservas|certificacion|atestacion|respaldo|respaldada|respaldado|emisor|custodio|transparencia)\b/,
    transparencyWeak: /\b(reserve|backed|audit|audits|audited|auditor|custody|reserva|auditoria|auditada|auditado|custodia|garantia)\b/,
    usd: /\b(usd|dollar|dollars|fiat|exchange rate|conversion rate|dolar|dolares|tipo de cambio|tasa de cambio)\b/,
    usdWeak: /\b(rate|price|value|worth|conversion|equivalent|tasa|precio|valor|equivalente)\b/,
    define: /\b(what is a|what is an|whats a|what does|mean|means|meaning|define|definition|que es un|que es una|que significa|significa|significado)\b/,
    defineGeneral: /^(what are|que son)\b/,
    mine: /\b(my|mine|i|mi|mis|yo)\b/,
    redeem: /\b(redeem|redeemed|redemption|redemptions|cash out|cashed out|withdraw|withdrew|withdrawal|withdrawals|payout|canje|canjes|canjee|canjeado|canjear|retiro|retiros|retire|retirada)\b/,
    deposit: /\b(deposit|deposits|deposited|top up|topped up|deposito|depositos|deposite|depositado|ingreso|ingrese)\b/,
    depositWeak: /\b(card|cards|tarjeta|tarjetas)\b/,
    outGroup: /\b(outgoing|money out|spent|spend|spending|salidas|salida|gaste|gastado|gasto|gastos)\b/,
    inGroup: /\b(incoming|money in|entradas|entrada|ingresos)\b/,
    sent: /\b(sent|send|paid|payment|payments|transfers out|transfer out|transfer to|envie|enviado|enviados|enviadas|pague|pagado|pago|pagos)\b/,
    received: /\b(received|receive|transfers in|transfer in|transfer from|recibi|recibido|recibidos|recibidas|me enviaron|me pagaron)\b/,
    receivedWeak: /\b(got|get)\b/,
    token: /\b(token unit|token units|token|tokens|usbc|us bank coin|unidad de token|unidades de token)\b/,
    tokenWeak: /\b(unit|units|decimal|decimals|unidad|unidades|decimales)\b/,
    status: /\b(posted|settled|registrado|registrados|registrada|liquidado|transaction status)\b/,
    statusWeak: /\b(status|failed|fail|fails|failure|fallido|fallidos|fallo)\b|\bestado\b(?! de cuenta)/,
    balance: /\b(balance|saldo|went up|went down|net change|cambio neto)\b|\bhow much (money )?(do i have|have i got|is left|is (left )?in my)\b|\bcuanto (dinero )?(tengo|me queda|hay en mi)\b/,
    balanceWeak: /\b(change|changed|changes|closing|opening|net|final|inicial|neto|cambio|cambios|cambiado|cambia|cambiaron)\b/,
    greet: /^(hi|hello|hey|hola|buenas|buenos dias|good morning|good afternoon|help|ayuda|start|menu|inicio)\b|\b(thanks|thank you|gracias)\b/
  };

  /*
   * Spanish words that are different everyday words in English ("Red Sox", "final
   * score", "the mayor", "actual", "retire", "cargo"): ignored unless the
   * question reads as Spanish.
   */
  var ES_ONLY = /\b(red|final|mayor|actual|retire|cargo|cargos)\b/g;
  /* Function words and statement words that tell the two languages apart. */
  var LANG_WORDS = {
    es: /\b(que|por|porque|para|mi|mis|tu|tus|yo|el|la|los|las|del|de|en|un|una|unos|unas|es|son|fue|fueron|cual|cuales|cuanto|cuanta|cuantos|cuantas|donde|adonde|como|cuando|quien|esta|estan|estaba|hay|tengo|tiene|tuve|se|le|les|con|sin|al|y|pero|mas|muy|este|estos|esto|ese|esa|eso|si|saldo|comision|comisiones|movimiento|movimientos|cuenta|dinero|hola|gracias|ayuda|cambio|siempre|vale|dolar|dolares|pendiente|pendientes|deberia|puedes|quiero|hablar|persona|pague|envie|recibi|gaste|deposite|hoy|ahora|ayer|mes)\b/g,
    en: /\b(the|is|are|was|were|be|been|my|mine|what|whats|why|how|did|do|does|i|im|ive|you|your|of|to|for|in|on|at|and|or|it|its|this|that|these|those|much|many|where|when|which|who|can|could|will|would|should|have|had|get|got|about|from|with|money|fees|paid|sent|received|transaction|transactions|please|show|tell|explain|hello|hi|thanks|there|any|all|not|dont|didnt)\b/g
  };

  /**
   * The language a question is written in: { lang: 'en' | 'es' | null, sure }.
   * `sure` needs at least two signals and twice as many as the other language,
   * so a lone "fees" or "hola" never switches the answer language.
   */
  function detectLang(raw, n) {
    var es = (n.match(LANG_WORDS.es) || []).length;
    var en = (n.match(LANG_WORDS.en) || []).length;
    if (/[¿¡ñÑ]/.test(raw)) es += 2;
    if (/[áéíóúÁÉÍÓÚ]/.test(raw)) es += 1;
    var lang = es > en ? 'es' : en > es ? 'en' : null;
    var win = Math.max(es, en);
    var lose = Math.min(es, en);
    return { lang: lang, sure: !!lang && win >= 2 && win >= 2 * lose };
  }

  /** Counterparty first names / merchants the visitor might mention. */
  function counterparties() {
    var out = {};
    calc.all().forEach(function (x) {
      var w = norm(x.counterparty && x.counterparty.en).split(' ')[0];
      if (w && w.length >= 4 && !CP_STOP[w]) out[w] = true;
    });
    return Object.keys(out);
  }

  /**
   * Map free text to a supported intent: { topic, id, lang }. Order matters:
   * refusals first, then specific statement topics, then an honest fallback.
   * `lang` is the language the question is clearly written in (else null), so
   * the answer can be given in that language.
   */
  function match(text) {
    var raw = String(text || '');
    var n = norm(raw);
    var d = detectLang(raw, n);
    var m = route(raw, n, d.lang || YES.i18n.lang);
    m.lang = d.sure ? d.lang : null;
    return m;
  }

  function route(raw, n, lang) {
    function R(topic, id) {
      return { topic: topic, id: id || null };
    }
    if (lang !== 'es') n = n.replace(ES_ONLY, ' ').replace(/\s+/g, ' ').trim();
    if (!n) return R('fallback');
    var isQ = RX.question.test(n);
    var anchored = RX.anchor.test(n);
    // A curated question to offer first when only a weak word matched.
    var hint = null;
    function has(strong, weak, hintQ) {
      if (strong && strong.test(n)) return true;
      if (weak && weak.test(n)) {
        if (anchored) return true;
        if (hintQ && !hint) hint = hintQ;
      }
      return false;
    }

    if (RX.actAny.test(n) || (!isQ && (RX.actEn.test(n) || RX.actEs.test(n)))) return R('action');
    if (RX.peg.test(n)) return R('peg');
    if (RX.advice.test(n) || RX.predictEs.test(n) || (RX.future.test(n) && RX.value.test(n))) return R('advice');

    var txm = raw.match(/\bTX-?(\d{6})-?(\d{4})\b/i);
    if (txm) return R('transaction', 'TX-' + txm[1] + '-' + txm[2]);
    var refm = raw.match(/\bREF-[A-Z0-9]{4}-[A-Z0-9]{4}\b/i);
    if (refm) {
      var ref = refm[0].toUpperCase();
      var hit = calc.all().filter(function (x) {
        return x.reference === ref;
      })[0];
      return R('transaction', hit ? hit.id : ref);
    }

    if (RX.human.test(n)) return R('human');
    if (RX.liveStrong.test(n) || (RX.liveNow.test(n) && RX.liveWhat.test(n))) return R('edu', 'statement_vs_live');
    if (has(RX.pending, RX.pendingWeak, 'pending')) return R('pending');
    var def = RX.define.test(n) || (RX.defineGeneral.test(n) && !RX.mine.test(n));
    if (has(RX.fees, RX.feesWeak, 'fees_paid')) return def ? R('edu', 'fees') : R('fees');
    if (has(RX.chart, RX.chartWeak) || (RX.highLow.test(n) && RX.balanceWord.test(n))) return R('chart');
    if (has(RX.largest, RX.largestWeak, 'largest')) return R('largest');
    if (has(RX.onchain, RX.onchainWeak, 'onchain_sent')) return RX.send.test(n) && !def ? R('onchain_sent') : R('edu', 'onchain_vs_internal');
    if (RX.internal.test(n)) return R('edu', 'onchain_vs_internal');
    if (has(RX.transparency, RX.transparencyWeak)) return R('edu', 'transparency');
    if (has(RX.usd, RX.usdWeak)) return R('edu', 'usd_equivalent');
    var cps = counterparties();
    for (var i = 0; i < cps.length; i++) {
      if (new RegExp('\\b' + cps[i] + '\\b').test(n)) return R('counterparty', cps[i]);
    }
    if (RX.redeem.test(n)) return def ? R('edu', 'redemption') : R('step', 'redemptions');
    if (has(RX.deposit, RX.depositWeak)) return R('step', 'deposits');
    if (RX.outGroup.test(n)) return R('step', 'outgoing');
    if (RX.inGroup.test(n)) return R('step', 'incoming');
    if (RX.sent.test(n)) return R('step', 'transfers_out');
    if (has(RX.received, RX.receivedWeak)) return R('step', 'transfers_in');
    if (has(RX.token, RX.tokenWeak)) return R('edu', 'token_units');
    if (has(RX.status, RX.statusWeak)) return R('edu', 'tx_status');
    if (has(RX.balance, RX.balanceWeak)) return R('balance');
    if (RX.greet.test(n)) return R('general');
    // Out of scope. The id, if any, is a curated question to suggest first.
    return R('fallback', hint);
  }

  /* ------------------------------------------------------------------ */
  /* Explanation engine: each builder returns a render model             */
  /*   { title, paras[], bullets[], figs[], sum, rows[], rowsSubject,    */
  /*     more, suggest[], policy, plain }                                */
  /* All figures come from YES.calc / YES.data at render time.           */
  /* ------------------------------------------------------------------ */
  function sumHtml(terms, result) {
    var total = terms.reduce(function (a, b) {
      return a + b;
    }, 0);
    if (total !== result || terms.length < 2) return ''; // never show arithmetic that does not hold
    var vis = [];
    var spk = [];
    terms.forEach(function (v, i) {
      var num = fmt.amount(Math.abs(v), { sign: 'never', unit: false });
      if (i === 0) {
        vis.push((v < 0 ? fmt.MINUS : '') + num);
        spk.push((v < 0 ? t('fmt.minus') + ' ' : '') + num);
      } else {
        vis.push((v < 0 ? fmt.MINUS : '+') + ' ' + num);
        spk.push(t(v < 0 ? 'fmt.minus' : 'fmt.plus') + ' ' + num);
      }
    });
    return (
      '<p class="asst-sum"><span class="asst-sum__k">' +
      esc(t('assistant.addsUp')) +
      '</span><span class="asst-sum__eq" aria-hidden="true">' +
      vis
        .map(function (x) {
          return '<span>' + esc(x) + '</span>';
        })
        .join(' ') +
      ' <span class="asst-sum__res">= ' +
      esc(fmt.amount(result, { sign: 'auto' })) +
      '</span></span><span class="sr-only">' +
      esc(spk.join(' ') + ' ' + t('assistant.equals') + ' ' + fmt.amountSpoken(result)) +
      '</span></p>'
    );
  }

  var B = {};

  B.general = function () {
    return {
      plain: true,
      title: t('assistant.welcome.title', { name: st().customer.firstName }),
      paras: [P('assistant.welcome.p1', { period: period(), asOf: asOfText() }), P('assistant.welcome.p2')]
    };
  };

  B.balance = function () {
    var s = st();
    var cats = calc.categories();
    var groups = calc.groups();
    var pend = calc.notInBalance();
    var paras = [
      P('assistant.balance.p1', { start: dLong(s.periodStart), end: dLong(s.periodEnd) }, { opening: amt(s.opening), closing: amt(s.closing), net: samt(calc.netChange()) })
    ];
    ['incoming', 'outgoing'].forEach(function (g) {
      var gr = groups[g];
      if (!gr.count) return;
      var parts = cats
        .filter(function (c) {
          return c.group === g && c.count;
        })
        .map(function (c) {
          return esc(lc(t('cat.' + c.id))) + ' ' + amt(c.total);
        });
      paras.push(P('assistant.balance.' + g, { count: YES.txCount(gr.count) }, { amount: amt(gr.total), parts: list(parts) }));
    });
    if (pend.length) paras.push(P('assistant.balance.pending', { n: pend.length, count: YES.txCount(pend.length) }, { amount: amt(sumOf(pend)) }));

    var figs = [fig(t('cat.opening'), s.opening, 'auto')];
    cats.forEach(function (c) {
      figs.push(fig(t('assistant.fig.catCount', { label: t('cat.' + c.id), count: YES.txCount(c.count) }), c.total));
    });
    figs.push(fig(t('cat.closing'), s.closing, 'auto', true));
    if (pend.length) figs.push(fig(t('assistant.fig.pendingNot', { count: YES.txCount(pend.length) }), sumOf(pend)));
    return {
      title: t('assistant.balance.title'),
      paras: paras,
      figs: figs,
      sum: sumHtml(
        [s.opening].concat(
          cats.map(function (c) {
            return c.total;
          })
        ),
        s.closing
      ),
      rows: ids(calc.posted()),
      rowsSubject: t('term.statementBalance')
    };
  };

  function stepGroup(g) {
    var gr = calc.groups()[g];
    var cats = calc.categories().filter(function (c) {
      return c.group === g;
    });
    var paras = [P(g === 'incoming' ? 'assistant.group.in' : 'assistant.group.out', { n: gr.count, count: YES.txCount(gr.count), period: period() }, { amount: amt(gr.total) })];
    var parts = cats
      .filter(function (c) {
        return c.count;
      })
      .map(function (c) {
        return esc(lc(t('cat.' + c.id))) + ' ' + amt(c.total) + ' (' + esc(YES.txCount(c.count)) + ')';
      });
    if (parts.length) paras.push(P('assistant.group.parts', {}, { parts: list(parts) }));
    if (g === 'outgoing') {
      var pend = calc.notInBalance().filter(function (x) {
        return x.amount < 0;
      });
      if (pend.length) paras.push(P('assistant.step.pending', { count: YES.txCount(pend.length) }, { amount: amt(sumOf(pend)) }));
    }
    var figs = cats.map(function (c) {
      return fig(t('assistant.fig.catCount', { label: t('cat.' + c.id), count: YES.txCount(c.count) }), c.total);
    });
    figs.push(fig(t('assistant.fig.total'), gr.total, 'always', true));
    return {
      title: t('assistant.step.title', { label: t('group.' + g), amount: fmt.amount(gr.total, { sign: 'always' }) }),
      paras: paras,
      figs: figs,
      sum: sumHtml(
        cats.map(function (c) {
          return c.total;
        }),
        gr.total
      ),
      rows: gr.txIds.slice(),
      rowsSubject: t('group.' + g)
    };
  }

  B.step = function (id) {
    if (id === 'opening' || id === 'closing') return B.balance();
    if (id === 'fees') return B.fees();
    if (id === 'incoming' || id === 'outgoing') return stepGroup(id);
    var c = id ? calc.category(id) : null;
    if (!c) return B.balance();
    var list2 = txs(c.txIds);
    var label = t('cat.' + c.id);
    var inc = c.group === 'incoming';
    var paras = [];
    if (!c.count) paras.push(P('assistant.step.none', { period: period() }));
    else paras.push(P(inc ? 'assistant.step.added' : 'assistant.step.reduced', { n: c.count, count: YES.txCount(c.count), period: period() }, { amount: amt(c.total) }));
    var big = largestOf(list2);
    if (c.count > 1 && big) {
      paras.push(P('assistant.step.largest', { date: dLong(big.postedAt), description: YES.L(big.description), counterparty: YES.L(big.counterparty) }, { amount: amt(big.amount) }));
    }
    if (c.count) {
      var rails = {};
      list2.forEach(function (x) {
        rails[x.rail] = (rails[x.rail] || 0) + 1;
      });
      var rparts = RAILS.filter(function (r) {
        return rails[r];
      }).map(function (r) {
        return esc(t('assistant.step.rail.' + r, { n: rails[r], count: YES.txCount(rails[r]) }));
      });
      if (rparts.length) paras.push(P('assistant.step.rails', {}, { parts: list(rparts) }));
    }
    var linked = [];
    list2.forEach(function (x) {
      calc.feesFor(x.id).forEach(function (f) {
        if (f.status === 'posted') linked.push(f);
      });
    });
    if (linked.length) paras.push(P('assistant.step.linkedFees', { n: linked.length }, { amount: amt(sumOf(linked)) }));
    list2
      .filter(function (x) {
        return x.priorPeriodInitiation;
      })
      .forEach(function (x) {
        paras.push(P('assistant.step.prior', { id: x.id, initiated: dLong(x.initiatedAt), posted: dLong(x.postedAt) }));
      });
    var pend = calc.notInBalance().filter(function (x) {
      return c.types.indexOf(x.type) !== -1;
    });
    if (pend.length) paras.push(P('assistant.step.pending', { count: YES.txCount(pend.length) }, { amount: amt(sumOf(pend)) }));

    var figs = [fig(t('assistant.fig.total'), c.total, 'always', true), figText(t('assistant.fig.count'), YES.txCount(c.count))];
    if (c.count > 1 && big) figs.push(fig(idLabel('assistant.fig.largest', big.id), big.amount));
    if (linked.length) figs.push(fig(t('assistant.fig.linkedFees'), sumOf(linked)));
    if (pend.length) figs.push(fig(t('assistant.fig.pendingNot', { count: YES.txCount(pend.length) }), sumOf(pend)));
    return {
      title: t('assistant.step.title', { label: label, amount: fmt.amount(c.total, { sign: 'always' }) }),
      paras: paras,
      figs: figs,
      sum: c.count <= 8 ? sumHtml(list2.map(function (x) {
        return x.amount;
      }), c.total) : '',
      rows: c.txIds.slice(),
      rowsSubject: label
    };
  };

  B.transaction = function (id) {
    var tx = id && SAFE_ID.test(String(id)) ? calc.tx(String(id)) : null;
    if (!tx) return B.notFound(id);
    var s = st();
    var desc = YES.L(tx.description);
    var isPosted = tx.status === 'posted';
    var paras = [];
    var rows = [tx.id];
    var figs = [fig(t('assistant.fig.amount'), tx.amount)];
    var run = null;
    if (isPosted) {
      calc.running().forEach(function (r) {
        if (r.txId === tx.id) run = r;
      });
    }
    if (isPosted && run) {
      paras.push(
        P('assistant.tx.posted', { description: desc, date: dLong(tx.postedAt), time: dTime(tx.postedAt) }, { amount: samt(tx.amount), before: amt(run.balance - run.delta), after: amt(run.balance) })
      );
      figs.push(figText(t('assistant.fig.posted'), fmt.date(tx.postedAt, 'datetime') + ' ' + tzShort(tx.postedAt)));
    } else {
      paras.push(P(tx.status === 'pending' ? 'assistant.tx.pending' : 'assistant.tx.notPosted', { description: desc, initiated: dLong(tx.initiatedAt), asOf: asOfText(), status: statusLabel(tx.status) }, { amount: samt(tx.amount) }));
      paras.push(P('assistant.tx.excluded', {}, { closing: amt(s.closing) }));
      paras.push(P('assistant.tx.noLive'));
    }
    if (tx.initiatedAt && (!isPosted || fmt.isoDate(tx.initiatedAt) !== fmt.isoDate(tx.postedAt))) {
      figs.push(figText(t('assistant.fig.initiated'), fmt.date(tx.initiatedAt, 'datetime') + ' ' + tzShort(tx.initiatedAt)));
    }
    if (isPosted && run) {
      figs.push(fig(t('assistant.fig.before'), run.balance - run.delta, 'auto'));
      figs.push(fig(t('assistant.fig.after'), run.balance, 'auto'));
    }
    figs.push(figText(t('assistant.fig.status'), isPosted ? statusLabel(tx.status) : statusLabel(tx.status) + ' · ' + t('status.notInBalance')));

    // Channel: internal vs on-chain (PRD 5.6)
    if (tx.type === 'transfer_in' || tx.type === 'transfer_out') {
      if (tx.rail === 'internal') paras.push(P('assistant.tx.internal'));
      else if (tx.rail === 'onchain' && tx.onchain)
        paras.push(P('assistant.tx.onchain', { network: YES.L(tx.onchain.network), hash: tx.onchain.hashDisplay || tx.onchain.hash, confirmations: fmt.count(tx.onchain.confirmations || 0) }));
      else if (tx.rail === 'onchain') paras.push(P('assistant.tx.onchainUnverified'));
    }
    // Dates: prior-period initiation and the posted-date rule
    if (tx.priorPeriodInitiation) paras.push(P('assistant.tx.prior', { initiated: dLong(tx.initiatedAt), posted: dLong(tx.postedAt) }));
    else if (isPosted && fmt.isoDate(tx.initiatedAt) !== fmt.isoDate(tx.postedAt)) paras.push(P('assistant.tx.dates', { initiated: dLong(tx.initiatedAt), posted: dLong(tx.postedAt) }));
    // Linked fees on a parent, or the parent of a fee line
    calc.feesFor(tx.id).forEach(function (f) {
      paras.push(P('assistant.tx.hasFee', { kind: lc(feeKind(f.feeKind)), id: f.id }, { amount: amt(f.amount) }));
      figs.push(fig(idLabel('assistant.fig.fee', f.id), f.amount));
      rows.push(f.id);
    });
    if (tx.type === 'fee' && tx.parentId) {
      var p = calc.tx(tx.parentId);
      if (p) {
        paras.push(
          P('assistant.tx.feeOf', { kind: lc(feeKind(tx.feeKind)), parentId: p.id, parentDesc: YES.L(p.description), parentDate: dLong(p.postedAt || p.initiatedAt) }, { parentAmount: samt(p.amount) })
        );
        figs.push(fig(idLabel('assistant.fig.parent', p.id), p.amount));
        rows.push(p.id);
      }
    }
    if (tx.memo) paras.push(P('assistant.tx.memo', {}, { memo: memoHtml(tx.memo) }));

    figs.push(figText(t('assistant.fig.counterparty'), YES.L(tx.counterparty)));
    figs.push(figText(t('assistant.fig.rail'), railLabel(tx.rail) + ' · ' + methodLabel(tx.method)));
    figs.push(figText(t('assistant.fig.reference'), tx.reference, { mono: true }));
    if (tx.onchain) {
      figs.push(
        figText(t('assistant.fig.network'), t('assistant.fig.networkVal', { network: YES.L(tx.onchain.network), hash: tx.onchain.hashDisplay || tx.onchain.hash, confirmations: fmt.count(tx.onchain.confirmations || 0) }))
      );
    }
    return {
      title: desc,
      paras: paras,
      figs: figs,
      rows: rows,
      rowsSubject: tx.id,
      inquiry: tx.id,
      illustrative: !!tx.onchain
    };
  };

  B.notFound = function (id) {
    return {
      title: t('assistant.notFound.title'),
      paras: [P('assistant.notFound.p1', { id: String(id || '') })],
      suggest: ['why_balance', 'largest']
    };
  };

  B.fees = function () {
    var c = calc.category('fees');
    var lines = txs(c ? c.txIds : []);
    var total = c ? c.total : 0;
    var paras = [];
    var bullets = [];
    if (!lines.length) paras.push(P('assistant.fees.none', { period: period() }));
    else {
      paras.push(P('assistant.fees.p1', { count: YES.txCount(lines.length), period: period() }, { total: amt(total) }));
      paras.push(P('assistant.fees.p2'));
      lines.forEach(function (f) {
        var p = calc.tx(f.parentId);
        bullets.push(
          P('assistant.fees.item', { kind: feeKind(f.feeKind), parentId: p ? p.id : '—', parentDesc: p ? YES.L(p.description) : '—', date: dShort(f.postedAt) }, { amount: amt(f.amount) })
        );
      });
    }
    var foreign = calc.foreignFees();
    var tail = foreign.length ? P('assistant.fees.foreign', { count: YES.txCount(foreign.length), symbol: calc.asset().symbol }) : P('assistant.fees.noForeign');
    var figs = lines.map(function (f) {
      return fig(idLabel('assistant.fig.feeLine', f.id, { kind: feeKind(f.feeKind) }), f.amount);
    });
    figs.push(fig(t('assistant.fig.totalFees'), total, 'always', true));
    figs.push(figText(t('assistant.fig.foreignFees'), foreign.length ? YES.txCount(foreign.length) : t('common.none')));
    return {
      title: t('assistant.fees.title'),
      paras: paras,
      bullets: bullets,
      after: [tail],
      figs: figs,
      sum: lines.length <= 8 ? sumHtml(lines.map(function (f) {
        return f.amount;
      }), total) : '',
      rows: ids(lines),
      rowsSubject: t('cat.fees'),
      more: 'fees'
    };
  };

  B.chart = function () {
    var s = st();
    var run = calc.running();
    if (!run.length) return { title: t('assistant.chart.title'), paras: [P('assistant.chart.none')] };
    var hi = run[0];
    var lo = run[0];
    run.forEach(function (r) {
      if (r.balance > hi.balance) hi = r;
      if (r.balance < lo.balance) lo = r;
    });
    var paras = [P('assistant.chart.p1', { count: YES.txCount(run.length) }, { opening: amt(s.opening), closing: amt(s.closing) })];
    var figs = [fig(t('cat.opening'), s.opening, 'auto')];
    var rows = [];
    function point(r, key, figKey) {
      var x = calc.tx(r.txId);
      paras.push(P(key, { date: dLong(r.at), description: YES.L(x.description) }, { balance: amt(r.balance), amount: samt(x.amount) }));
      figs.push(fig(t(figKey, { date: dShort(r.at) }), r.balance, 'auto'));
      rows.push(x.id);
    }
    if (s.opening > hi.balance) {
      paras.push(P('assistant.chart.highOpening', {}, { balance: amt(s.opening) }));
    } else point(hi, 'assistant.chart.high', 'assistant.fig.highest');
    if (s.opening < lo.balance) {
      paras.push(P('assistant.chart.lowOpening', {}, { balance: amt(s.opening) }));
    } else point(lo, 'assistant.chart.low', 'assistant.fig.lowest');
    paras.push(P('assistant.chart.p4'));
    figs.push(fig(t('cat.closing'), s.closing, 'auto', true));
    return { title: t('assistant.chart.title'), paras: paras, figs: figs, rows: rows, rowsSubject: t('assistant.subject.chart') };
  };

  B.pending = function (id) {
    if (id && SAFE_ID.test(String(id)) && calc.tx(String(id))) return B.transaction(id);
    var pend = calc.notInBalance();
    var s = st();
    if (!pend.length) {
      return { title: t('assistant.pending.title'), paras: [P('assistant.pending.none', { asOf: asOfText() })], figs: [fig(t('term.statementBalance'), s.closing, 'auto', true)] };
    }
    return {
      title: t('assistant.pending.title'),
      paras: [P('assistant.pending.p1', { n: pend.length, count: YES.txCount(pend.length), asOf: asOfText() })],
      bullets: pend.map(function (x) {
        return P('assistant.pending.item', { description: YES.L(x.description), date: dLong(x.initiatedAt), status: lc(statusLabel(x.status)) }, { amount: samt(x.amount) });
      }),
      after: [P('assistant.pending.p2', {}, { closing: amt(s.closing) })],
      figs: [fig(t('assistant.fig.pendingNot', { count: YES.txCount(pend.length) }), sumOf(pend)), fig(t('term.statementBalance'), s.closing, 'auto', true)],
      rows: ids(pend),
      rowsSubject: t('status.notInBalance'),
      more: 'tx_status'
    };
  };

  B.largest = function () {
    var big = calc.largest();
    if (!big) return { title: t('assistant.largest.title'), paras: [P('assistant.largest.none')] };
    var paras = [P('assistant.largest.p1', { period: period(), description: YES.L(big.description), date: dLong(big.postedAt) }, { amount: samt(big.amount) })];
    var figs = [fig(idLabel('assistant.fig.largestMove', big.id), big.amount)];
    var rows = [big.id];
    var other = largestOf(
      calc.posted().filter(function (x) {
        return x.type !== 'fee' && (big.amount < 0 ? x.amount > 0 : x.amount < 0);
      })
    );
    if (other) {
      var k = other.amount < 0 ? 'out' : 'in';
      paras.push(P('assistant.largest.' + k, { description: YES.L(other.description), date: dLong(other.postedAt) }, { amount: samt(other.amount) }));
      figs.push(fig(idLabel(k === 'out' ? 'assistant.fig.largestOut' : 'assistant.fig.largestIn', other.id), other.amount));
      rows.push(other.id);
    }
    paras.push(P('assistant.largest.note'));
    return { title: t('assistant.largest.title'), paras: paras, figs: figs, rows: rows, rowsSubject: t('assistant.largest.title') };
  };

  function fiatInfo() {
    var f = calc.asset().fiat;
    var closingFiat = calc.fiat(st().closing);
    if (!f || closingFiat == null) return null;
    return {
      rate: fmt.number(Math.round(f.rateMicros / 100), 4),
      at: asOfTextFor(f.at),
      source: YES.L(f.source),
      currency: f.currency,
      closing: fmt.fiat(closingFiat, f.currency)
    };
  }
  function asOfTextFor(iso) {
    return fmt.date(iso, 'datetime') + ' ' + tzShort(iso);
  }

  B.peg = function () {
    var fi = fiatInfo();
    var paras = [P('assistant.peg.p1')];
    var figs = [];
    if (fi) {
      paras.push(P('assistant.peg.p2', { rate: fi.rate, at: fi.at }));
      figs.push(figText(t('assistant.fig.rate'), t('assistant.fig.rateVal', { rate: fi.rate })));
      figs.push(figText(t('assistant.fig.rateSource'), fi.source));
      figs.push(figText(t('assistant.fig.rateAt'), fi.at));
    } else paras.push(P('assistant.peg.noRate'));
    paras.push(P('assistant.peg.p3'));
    return { title: t('assistant.q.peg'), paras: paras, figs: figs, policy: true, more: 'transparency' };
  };

  B.onchain_sent = function () {
    var posted = calc.posted();
    var sends = posted.filter(function (x) {
      return x.rail === 'onchain' && x.amount < 0 && x.type !== 'fee';
    });
    var recv = posted.filter(function (x) {
      return x.rail === 'onchain' && x.amount > 0;
    });
    if (!sends.length) {
      return { title: t('assistant.onchain.title'), paras: [P('assistant.onchain.none', { period: period() })], more: 'onchain_vs_internal' };
    }
    var fees = [];
    sends.forEach(function (x) {
      fees = fees.concat(calc.feesFor(x.id));
    });
    var after = [];
    if (fees.length) after.push(P('assistant.onchain.fee', {}, { amount: amt(sumOf(fees)) }));
    after.push(P('assistant.onchain.ref'));
    if (recv.length) after.push(P('assistant.onchain.received', { count: YES.txCount(recv.length) }, { amount: amt(sumOf(recv)) }));
    var figs = sends.map(function (x) {
      return fig(idLabel('assistant.fig.sentTo', x.id), x.amount);
    });
    if (fees.length) figs.push(fig(t('assistant.fig.networkFees'), sumOf(fees)));
    sends.forEach(function (x) {
      if (x.onchain) figs.push(figText(t('assistant.fig.network'), t('assistant.fig.networkVal', { network: YES.L(x.onchain.network), hash: x.onchain.hashDisplay || x.onchain.hash, confirmations: fmt.count(x.onchain.confirmations || 0) })));
    });
    return {
      title: t('assistant.onchain.title'),
      paras: [P('assistant.onchain.p1', { n: sends.length, count: YES.txCount(sends.length), period: period() }, { amount: amt(sumOf(sends)) })],
      bullets: sends.map(function (x) {
        return P('assistant.onchain.item', { date: dLong(x.postedAt), counterparty: YES.L(x.counterparty) }, { amount: amt(x.amount) });
      }),
      after: after,
      figs: figs,
      rows: ids(sends).concat(ids(fees)),
      rowsSubject: t('assistant.onchain.title'),
      illustrative: sends.some(function (x) {
        return !!x.onchain;
      }),
      more: 'onchain_vs_internal'
    };
  };

  B.counterparty = function (key) {
    var rowsTx = calc.posted().filter(function (x) {
      return norm(x.counterparty && x.counterparty.en).split(' ')[0] === key;
    });
    if (!rowsTx.length) return B.fallback();
    var name = YES.L(rowsTx[0].counterparty);
    var out = rowsTx.filter(function (x) {
      return x.amount < 0;
    });
    var inn = rowsTx.filter(function (x) {
      return x.amount > 0;
    });
    var paras = [P('assistant.cp.p1', { n: rowsTx.length, count: YES.txCount(rowsTx.length), name: name, period: period() })];
    var figs = [];
    if (out.length) {
      paras.push(P('assistant.cp.sent', { count: YES.txCount(out.length) }, { amount: amt(sumOf(out)) }));
      figs.push(fig(t('assistant.fig.sent'), sumOf(out)));
    }
    if (inn.length) {
      paras.push(P('assistant.cp.received', { count: YES.txCount(inn.length) }, { amount: amt(sumOf(inn)) }));
      figs.push(fig(t('assistant.fig.received'), sumOf(inn)));
    }
    figs.push(fig(t('assistant.fig.net'), sumOf(rowsTx), 'always', true));
    return { title: t('assistant.cp.title', { name: name }), paras: paras, figs: figs, rows: ids(rowsTx), rowsSubject: t('assistant.subject.counterparty', { name: name }) };
  };

  B.action = function () {
    return { title: t('assistant.action.title'), paras: [P('assistant.action.p1'), P('assistant.action.p2')], policy: true };
  };
  B.advice = function () {
    return { title: t('assistant.advice.title'), paras: [P('assistant.advice.p1'), P('assistant.advice.p2')], policy: true, suggest: ['why_balance', 'fees_paid'] };
  };
  B.human = function () {
    return { title: t('assistant.talk'), paras: [P('assistant.human.p1'), P('assistant.human.p2'), P('assistant.human.p3')] };
  };
  /** `hint`: a curated question the visitor's words were close to, offered first. */
  B.fallback = function (hint) {
    var suggest = (Q_TOPIC[hint] ? [hint] : []).concat(['why_balance', 'fees_paid', 'pending']).filter(function (q, i, a) {
      return a.indexOf(q) === i;
    });
    return { title: t('assistant.fallback.title'), paras: [P('assistant.fallback.p1'), P('assistant.fallback.p2')], policy: true, suggest: suggest.slice(0, 3) };
  };

  /* ---------------------------- Education ---------------------------- */
  function example(x) {
    return P(x.amount < 0 ? 'assistant.example.out' : 'assistant.example.in', { date: dLong(x.postedAt), id: x.id }, { amount: amt(x.amount) });
  }
  var EDU_B = {
    token_units: function () {
      var a = calc.asset();
      var s = st();
      var posted = calc.posted();
      var small = null;
      posted.forEach(function (x) {
        if (!small || Math.abs(x.amount) < Math.abs(small.amount)) small = x;
      });
      var paras = [P('assistant.edu.token_units.p1', { product: YES.L(a.name), symbol: a.symbol, precision: fmt.count(a.precision) })];
      if (small) {
        paras.push(
          P('assistant.edu.token_units.p2', { units: fmt.amount(s.closing, { unit: false }), description: YES.L(small.description) }, { closing: amt(s.closing), smallest: amt(small.amount) })
        );
      }
      var figs = [fig(t('cat.closing'), s.closing, 'auto'), figText(t('assistant.fig.precision'), fmt.count(a.precision))];
      if (small) figs.push(fig(idLabel('assistant.fig.smallest', small.id), small.amount));
      return { paras: paras, figs: figs, rows: small ? [small.id] : [] };
    },
    usd_equivalent: function () {
      var fi = fiatInfo();
      if (!fi) return { paras: [P('assistant.edu.usd_equivalent.p1'), P('assistant.edu.usd_equivalent.none')] };
      return {
        paras: [
          P('assistant.edu.usd_equivalent.p1'),
          P('assistant.edu.usd_equivalent.p2', { rate: fi.rate, at: fi.at, fiat: fi.closing }, { closing: amt(st().closing) }),
          P('assistant.edu.usd_equivalent.p3')
        ],
        figs: [
          figText(t('assistant.fig.rate'), t('assistant.fig.rateVal', { rate: fi.rate })),
          figText(t('assistant.fig.rateSource'), fi.source),
          figText(t('assistant.fig.rateAt'), fi.at),
          fig(t('cat.closing'), st().closing, 'auto'),
          figText(t('assistant.fig.fiat'), fi.closing)
        ],
        illustrative: true
      };
    },
    onchain_vs_internal: function () {
      var transfers = calc.posted().filter(function (x) {
        return x.type === 'transfer_in' || x.type === 'transfer_out';
      });
      var internal = transfers.filter(function (x) {
        return x.rail === 'internal';
      });
      var onchain = transfers.filter(function (x) {
        return x.rail === 'onchain';
      });
      var paras = [P('assistant.edu.onchain_vs_internal.p1')];
      if (internal.length) paras.push(P('assistant.edu.onchain_vs_internal.internal', { n: internal.length, count: YES.txCount(internal.length) }, { example: example(internal[0]) }));
      paras.push(P('assistant.edu.onchain_vs_internal.p2'));
      if (onchain.length) paras.push(P('assistant.edu.onchain_vs_internal.onchain', { n: onchain.length, count: YES.txCount(onchain.length) }, { example: example(largestOf(onchain)) }));
      paras.push(P('assistant.edu.onchain_vs_internal.p3'));
      return {
        paras: paras,
        figs: [figText(t('assistant.fig.internalCount'), YES.txCount(internal.length)), figText(t('assistant.fig.onchainCount'), YES.txCount(onchain.length))],
        rows: (internal.length ? [internal[0].id] : []).concat(ids(onchain)),
        illustrative: onchain.some(function (x) {
          return !!x.onchain;
        })
      };
    },
    tx_status: function () {
      var posted = calc.posted();
      var not = calc.notInBalance();
      var pend = not.filter(function (x) {
        return x.status === 'pending';
      });
      var other = not.length - pend.length;
      var paras = [P('assistant.edu.tx_status.p1', { count: YES.txCount(posted.length) })];
      paras.push(pend.length ? P('assistant.edu.tx_status.pending', { asOf: asOfText(), count: YES.txCount(pend.length) }, { amount: amt(sumOf(pend)) }) : P('assistant.edu.tx_status.noPending'));
      paras.push(P('assistant.edu.tx_status.p3'));
      return {
        paras: paras,
        figs: [
          figText(t('assistant.fig.postedCount'), YES.txCount(posted.length)),
          figText(t('assistant.fig.pendingCount'), YES.txCount(pend.length)),
          figText(t('assistant.fig.otherCount'), YES.txCount(other))
        ],
        rows: ids(not)
      };
    },
    fees: function () {
      var c = calc.category('fees');
      var lines = txs(c ? c.txIds : []);
      var foreign = calc.foreignFees();
      var paras = [P('assistant.edu.fees.p1')];
      if (lines.length) paras.push(P('assistant.fees.p1', { count: YES.txCount(lines.length), period: period() }, { total: amt(c.total) }));
      paras.push(foreign.length ? P('assistant.fees.foreign', { count: YES.txCount(foreign.length), symbol: calc.asset().symbol }) : P('assistant.edu.fees.p3'));
      return {
        paras: paras,
        figs: [fig(t('assistant.fig.totalFees'), c ? c.total : 0, 'always', true), figText(t('assistant.fig.count'), YES.txCount(lines.length))],
        rows: ids(lines)
      };
    },
    redemption: function () {
      var c = calc.category('redemptions');
      var red = txs(c ? c.txIds : []);
      var fees = [];
      red.forEach(function (x) {
        fees = fees.concat(calc.feesFor(x.id));
      });
      var pend = calc.notInBalance().filter(function (x) {
        return x.type === 'redemption';
      });
      var paras = [P('assistant.edu.redemption.p1')];
      paras.push(red.length ? P('assistant.edu.redemption.p2', { n: red.length, count: YES.txCount(red.length) }, { amount: amt(sumOf(red)) }) : P('assistant.edu.redemption.none'));
      if (fees.length) paras.push(P('assistant.edu.redemption.fees', { n: fees.length }, { amount: amt(sumOf(fees)) }));
      if (pend.length) paras.push(P('assistant.step.pending', { count: YES.txCount(pend.length) }, { amount: amt(sumOf(pend)) }));
      var figs = [fig(t('assistant.fig.redeemed'), sumOf(red))];
      if (fees.length) figs.push(fig(t('assistant.fig.redemptionFees'), sumOf(fees)));
      if (pend.length) figs.push(fig(t('assistant.fig.pendingNot', { count: YES.txCount(pend.length) }), sumOf(pend)));
      return { paras: paras, figs: figs, rows: ids(red).concat(ids(fees), ids(pend)) };
    },
    statement_vs_live: function () {
      var s = st();
      var pend = calc.notInBalance();
      var paras = [P('assistant.edu.statement_vs_live.p1', { asOf: asOfText(), period: period() }, { closing: amt(s.closing) })];
      if (pend.length) {
        var x = largestOf(pend);
        paras.push(P('assistant.edu.statement_vs_live.p2', { description: YES.L(x.description) }, { amount: amt(x.amount) }));
      } else paras.push(P('assistant.edu.statement_vs_live.p2none'));
      paras.push(P('assistant.edu.statement_vs_live.p3'));
      var figs = [fig(t('assistant.fig.statementAsOf', { date: dShort(s.asOf) }), s.closing, 'auto')];
      if (pend.length) figs.push(fig(t('assistant.fig.pendingNot', { count: YES.txCount(pend.length) }), sumOf(pend)));
      figs.push(figText(t('assistant.fig.live'), t('assistant.fig.liveNA')));
      return { paras: paras, figs: figs, rows: ids(pend) };
    },
    transparency: function () {
      return {
        paras: [P('assistant.edu.transparency.p1'), P('assistant.edu.transparency.p2'), P('assistant.edu.transparency.p3')],
        figs: [figText(t('assistant.fig.issuer'), YES.L(YES.config.slots.ISSUER_OR_PARTNER)), figText(t('assistant.fig.evidence'), t('assistant.fig.evidenceNA'))],
        illustrative: true,
        policy: true
      };
    }
  };
  B.edu = function (id) {
    if (EDU.indexOf(id) === -1) return B.general();
    var m = EDU_B[id]();
    m.title = t('assistant.edu.' + id + '.name');
    m.more = id;
    if (m.rows && m.rows.length) m.rowsSubject = m.title;
    return m;
  };

  function model(e) {
    var r = resolve(e);
    switch (r.topic) {
      case 'balance':
        return B.balance();
      case 'step':
        return B.step(r.id);
      case 'transaction':
        return B.transaction(r.id);
      case 'fees':
        return B.fees();
      case 'edu':
        return B.edu(r.id);
      case 'chart':
        return B.chart();
      case 'pending':
        return B.pending(r.id);
      case 'largest':
        return B.largest();
      case 'peg':
        return B.peg();
      case 'onchain_sent':
        return B.onchain_sent();
      case 'counterparty':
        return B.counterparty(r.id);
      case 'action':
        return B.action();
      case 'advice':
        return B.advice();
      case 'human':
        return B.human();
      case 'fallback':
        return B.fallback(r.id);
      default:
        return B.general();
    }
  }

  /** What an entry is about: { label, amount, sign } for the context chip and bubble. */
  function subject(e) {
    var r = resolve(e);
    var s = st();
    switch (r.topic) {
      case 'balance':
        return { label: t('term.statementBalance'), amount: s.closing, sign: 'auto' };
      case 'step': {
        if (r.id === 'opening' || r.id === 'closing') return { label: t('cat.' + r.id), amount: r.id === 'opening' ? s.opening : s.closing, sign: 'auto' };
        if (r.id === 'incoming' || r.id === 'outgoing') return { label: t('group.' + r.id), amount: calc.groups()[r.id].total };
        var c = r.id ? calc.category(r.id) : null;
        return c ? { label: t('cat.' + c.id), amount: c.total } : { label: t('term.statementBalance'), amount: s.closing, sign: 'auto' };
      }
      case 'transaction':
      case 'pending': {
        var x = r.id && SAFE_ID.test(String(r.id)) ? calc.tx(String(r.id)) : null;
        if (x) return { label: YES.L(x.description) + ' · ' + dShort(x.postedAt || x.initiatedAt), amount: x.amount };
        if (r.topic === 'pending') return { label: t('status.notInBalance'), amount: sumOf(calc.notInBalance()) };
        return { label: t('assistant.subject.notFound', { id: String(r.id || '') }) };
      }
      case 'fees':
        return { label: t('cat.fees'), amount: calc.feesTotal() };
      case 'edu':
        return { label: EDU.indexOf(r.id) !== -1 ? t('assistant.edu.' + r.id + '.name') : t('assistant.subject.general', { period: period() }) };
      case 'chart':
        return { label: t('assistant.subject.chart') };
      case 'largest':
      case 'peg':
      case 'onchain_sent':
        return { label: t('assistant.q.' + { largest: 'largest', peg: 'peg', onchain_sent: 'onchain_sent' }[r.topic]) };
      case 'counterparty': {
        var m = B.counterparty(r.id);
        return { label: m.rowsSubject || t('assistant.subject.fallback') };
      }
      case 'action':
        return { label: t('assistant.subject.action') };
      case 'advice':
        return { label: t('assistant.subject.advice') };
      case 'human':
        return { label: t('assistant.talk') };
      case 'fallback':
        return { label: t('assistant.subject.fallback') };
      default:
        return { label: t('assistant.subject.general', { period: period() }) };
    }
  }
  function subjectHtml(sub) {
    return mask(sub.label) + (sub.amount != null ? ' · ' + samt(sub.amount, sub.sign || 'always') : '');
  }
  function subjectText(sub) {
    return sub.label + (sub.amount != null ? ' · ' + fmt.amount(sub.amount, { sign: sub.sign || 'always' }) : '');
  }

  /* ------------------------------------------------------------------ */
  /* Rendering                                                           */
  /* ------------------------------------------------------------------ */
  function demoTag(idAttr) {
    return '<span class="tag tag--ai"' + (idAttr ? ' id="' + esc(idAttr) + '"' : '') + '>' + ui.icon('sparkle', { size: 14 }) + '<span>' + esc(t('assistant.demoTag')) + '</span></span>';
  }

  function qButton(qid, fk) {
    return '<li><button type="button" class="asst-q" data-asst-q="' + esc(qid) + '" data-fk="' + esc(fk) + '">' + ui.icon('question', { size: 16 }) + '<span>' + esc(t('assistant.q.' + qid)) + '</span></button></li>';
  }

  function rowHtml(eid, x) {
    var dateIso = x.postedAt || x.initiatedAt;
    var dir = x.amount < 0 ? 'out' : x.amount > 0 ? 'in' : 'neutral';
    return (
      '<li><button type="button" class="asst-row" data-asst-tx="' +
      esc(x.id) +
      '" data-fk="' +
      esc('asst-' + eid + '-tx-' + x.id) +
      '"><span class="sr-only">' +
      esc(t('assistant.rowOpen')) +
      ' </span><span class="dir dir--' +
      dir +
      '">' +
      ui.icon(ui.typeIcon(x.type), { size: 16 }) +
      '</span><span class="asst-row__main"><span class="asst-row__top"><span class="asst-row__desc">' +
      mask(YES.L(x.description)) +
      '</span><span class="asst-row__amt">' +
      samt(x.amount) +
      '</span></span><span class="asst-row__meta">' +
      esc(dShort(dateIso)) +
      ' · ' +
      // Status-aware: a pending redemption reads "Redemption requested", never "Redeemed".
      esc(ui.typeLabel(x)) +
      ' · <span class="asst-row__id">' +
      esc(x.id) +
      '</span>' +
      (x.status !== 'posted' ? ' · ' + esc(statusLabel(x.status)) + ', ' + esc(lc(t('status.notInBalance'))) : '') +
      '</span></span>' +
      ui.icon('chevron', { size: 16, cls: 'asst-row__chev' }) +
      '</button></li>'
    );
  }

  /** The inquiry for a transaction, if one was started: see YES.inquiry.draftFor. */
  function inquiryFor(txId) {
    var d = null;
    try {
      d = YES.inquiry.draftFor(txId);
    } catch (err) {
      d = null;
    }
    return d && (!d.txId || d.txId === txId) ? d : null;
  }

  /** The inquiry state of every transaction answer in the thread, as one string. */
  function inquirySig() {
    return S()
      .thread.map(function (e) {
        var r = resolve(e);
        if ((r.topic !== 'transaction' && r.topic !== 'pending') || !r.id) return '';
        var d = inquiryFor(String(r.id));
        return d ? d.status + ':' + (d.ref || '') : '-';
      })
      .join('|');
  }

  /** Next step for a transaction answer: start, continue or view its demo inquiry. */
  function inquiryHtml(id, txId) {
    var d = inquiryFor(txId);
    var k = d && d.status === 'submitted' ? 'done' : d ? 'draft' : 'new';
    return (
      '<div class="asst-inq"><p class="asst-inq__text" id="' +
      id +
      '-inq-text">' +
      P('assistant.inquiry.' + k + 'Text', { ref: d && d.ref ? d.ref : '' }, { id: idHtml(txId) }) +
      '</p><button type="button" class="btn asst-inq__btn" data-asst-inquiry="' +
      esc(txId) +
      '" data-fk="' +
      id +
      '-inquiry" aria-describedby="' +
      id +
      '-inq-text">' +
      ui.icon('question', { size: 16 }) +
      '<span>' +
      esc(t('assistant.inquiry.' + k)) +
      '</span></button></div>'
    );
  }

  function answerHtml(e, m, s) {
    var id = 'asst-' + esc(e.id);
    var h = '<article class="asst-ans' + (m.policy ? ' asst-ans--policy' : '') + (m.plain ? ' asst-ans--welcome' : '') + '" aria-labelledby="' + id + '-h">';
    h += '<p class="asst-ans__tags">' + demoTag(id + '-tag') + (m.policy ? '<span class="tag asst-tag-policy">' + ui.icon('shield', { size: 14 }) + '<span>' + esc(t('assistant.policyTag')) + '</span></span>' : '') + (m.illustrative ? ui.illustrativeTag('assistant.illustrativeTag') : '') + '</p>';
    h += '<h3 id="' + id + '-h" class="asst-ans__title" tabindex="-1" data-fk="' + id + '-h" aria-describedby="' + id + '-tag">' + mask(m.title) + '</h3>';
    h += '<div class="asst-ans__text">';
    (m.paras || []).forEach(function (p) {
      h += '<p>' + p + '</p>';
    });
    if (m.bullets && m.bullets.length) {
      h += '<ul class="asst-ans__list">' + m.bullets.map(function (b) {
        return '<li>' + b + '</li>';
      }).join('') + '</ul>';
    }
    (m.after || []).forEach(function (p) {
      h += '<p>' + p + '</p>';
    });
    h += '</div>';

    if (m.figs && m.figs.length) {
      h += '<div class="asst-sec"><h4 class="asst-sec__h" id="' + id + '-figs-h">' + ui.icon('balance', { size: 16 }) + '<span>' + esc(t('assistant.figures')) + '</span></h4>';
      h += '<table class="asst-figs" aria-labelledby="' + id + '-figs-h"><tbody>';
      m.figs.forEach(function (f) {
        h += '<tr' + (f.total ? ' class="is-total"' : '') + '><th scope="row">' + (f.label && f.label.html ? f.label.html : esc(f.label)) + '</th><td class="' + (f.txt ? 'txt' : 'num') + (f.mono ? ' mono' : '') + '">' + f.html + '</td></tr>';
      });
      h += '</tbody></table>' + (m.sum || '') + '</div>';
    }

    var rowIds = supportRows(m);
    if (rowIds.length) {
      var expanded = !!s.expanded[e.id];
      var shown = expanded || rowIds.length <= ROW_PREVIEW + 1 ? rowIds : rowIds.slice(0, ROW_PREVIEW);
      h += '<div class="asst-sec"><h4 class="asst-sec__h" id="' + id + '-rows-h">' + ui.icon('search', { size: 16 }) + '<span>' + esc(t('assistant.rowsN', { n: fmt.count(rowIds.length) })) + '</span></h4>';
      h += '<ul class="asst-rows" id="' + id + '-rows">' + shown.map(function (r) {
        return rowHtml(e.id, calc.tx(r));
      }).join('') + '</ul>';
      h += '<div class="asst-sec__actions">';
      if (rowIds.length > ROW_PREVIEW + 1) {
        h +=
          '<button type="button" class="btn btn--ghost asst-more" data-asst-more="' +
          esc(e.id) +
          '" data-fk="' +
          id +
          '-more" aria-expanded="' +
          expanded +
          '" aria-controls="' +
          id +
          '-rows">' +
          ui.icon(expanded ? 'chevron-down' : 'chevron', { size: 16 }) +
          '<span>' +
          esc(expanded ? t('assistant.fewerRows') : t('assistant.moreRows', { n: fmt.count(rowIds.length) })) +
          '</span></button>';
      }
      h += '<button type="button" class="btn asst-showrows" data-asst-rows="' + esc(e.id) + '" data-fk="' + id + '-showrows">' + ui.icon('filter', { size: 16 }) + '<span>' + esc(t('assistant.showRows')) + '</span></button>';
      h += '</div></div>';
    }

    if (m.inquiry && calc.tx(m.inquiry)) h += inquiryHtml(id, m.inquiry);

    if (m.suggest && m.suggest.length) {
      h += '<div class="asst-inline-q"><p class="asst-inline-q__k">' + esc(t('assistant.tryThese')) + '</p><ul class="asst-qlist">' + m.suggest.map(function (q) {
        return qButton(q, id + '-q-' + q);
      }).join('') + '</ul></div>';
    }

    if (!m.plain && ((m.figs && m.figs.length) || (m.rows && m.rows.length))) {
      h += '<p class="asst-src">' + ui.icon('clock', { size: 14 }) + '<span>' + esc(t('assistant.source', { date: asOfText() })) + '</span></p>';
    }

    h += '<div class="asst-ans__foot">';
    if (!m.plain) {
      var v = s.helpful[e.id] || null;
      h +=
        '<div class="asst-fb"><div class="asst-fb__row" role="group" aria-labelledby="' +
        id +
        '-fbq"><span class="asst-fb__q" id="' +
        id +
        '-fbq">' +
        esc(t('assistant.helpful')) +
        '</span>' +
        ['yes', 'no']
          .map(function (k) {
            return (
              '<button type="button" class="asst-fb__btn" data-asst-fb="' +
              k +
              '" data-entry="' +
              esc(e.id) +
              '" aria-pressed="' +
              (v === k) +
              '" data-fk="' +
              id +
              '-fb-' +
              k +
              '">' +
              ui.icon(k === 'yes' ? 'thumbsUp' : 'thumbsDown', { size: 16 }) +
              '<span>' +
              esc(t(k === 'yes' ? 'assistant.helpfulYes' : 'assistant.helpfulNo')) +
              '</span></button>'
            );
          })
          .join('') +
        '</div><p class="asst-fb__note">' +
        (v ? ui.icon('check', { size: 14 }) : '') +
        '<span>' +
        esc(t(v ? 'assistant.helpfulThanks' : 'assistant.helpfulNote')) +
        '</span></p></div>';
    }
    h += '<div class="asst-ans__links">';
    if (m.more) h += '<button type="button" class="btn btn--ghost" data-asst-read="' + esc(m.more) + '" data-fk="' + id + '-read">' + ui.icon('book', { size: 16 }) + '<span>' + esc(t('assistant.readMore')) + '</span></button>';
    h += '<button type="button" class="btn btn--ghost" data-asst-talk data-fk="' + id + '-talk">' + ui.icon('user', { size: 16 }) + '<span>' + esc(t('assistant.talk')) + '</span></button>';
    h += '</div></div></article>';
    return h;
  }

  /**
   * An entry pinned to a language other than the page's (see push): a typed
   * question clearly written in the other language is answered in that language
   * (PRD 5.5 language-matched answers). The page language itself only changes in
   * the masthead (rule 7), and that choice unpins every answer (onState).
   */
  function pinned(e) {
    return !!(e && e.lang && e.lang !== YES.i18n.lang && isLang(e.lang));
  }
  /** A turn, rendered in its pinned language when it has one. */
  function turnFor(e, s) {
    if (!pinned(e)) return turnHtml(e, s, null);
    return withLang(e.lang, function () {
      return turnHtml(e, s, e.lang);
    });
  }

  function turnHtml(e, s, lang) {
    var m = model(e);
    var you = '';
    if (e.via === 'typed') you = esc(e.text || '');
    else if (e.via === 'suggested') you = esc(t('assistant.q.' + e.q));
    else if (e.via === 'context') you = ui.icon('sparkle', { size: 14 }) + '<span>' + P('assistant.explainAsk', {}, { subject: subjectHtml(subject(e)) }) + '</span>';
    return (
      '<li class="asst-turn' +
      (e.id === animateId ? ' asst-turn--new' : '') +
      '" id="asst-turn-' +
      esc(e.id) +
      '"' +
      (lang ? ' lang="' + esc(lang) + '"' : '') +
      '>' +
      (you ? '<p class="asst-you' + (e.via === 'context' ? ' asst-you--ctx' : '') + '"' + (e.via === 'typed' && e.qlang && e.qlang !== YES.i18n.lang ? ' lang="' + esc(e.qlang) + '"' : '') + '><span class="sr-only">' + esc(t('assistant.you')) + ' </span>' + you + '</p>' : '') +
      answerHtml(e, m, s) +
      '</li>'
    );
  }

  function drawerHtml() {
    var s = S();
    var last = s.thread[s.thread.length - 1];
    var sub = subject(last || { topic: 'general' });
    var h = '';
    h += '<div class="asst__head"><div class="asst__bar"><span class="asst__mark">' + ui.icon('chat', { size: 20 }) + '</span>';
    h += '<h2 id="asst-title" class="asst__title" tabindex="-1" data-fk="asst-title">' + esc(t('assistant.title')) + '</h2>';
    // Only the close button: no language switch here (rule 7, see the top of this file).
    h += '<div class="asst__tools">';
    h += '<button type="button" class="btn btn--icon btn--ghost asst__close" data-asst-close data-fk="asst-close" aria-label="' + esc(t('assistant.close')) + '">' + ui.icon('close', { size: 20 }) + '</button></div>';
    h += '<p class="asst__tagline">' + demoTag() + '</p></div>';
    h += '<p class="asst__ctx" data-asst-ctx><span class="asst__ctx-k">' + esc(t('assistant.about')) + '</span> <span class="asst__ctx-v">' + subjectHtml(sub) + '</span></p></div>';

    h += '<div class="asst__body">';
    h +=
      '<div class="notice notice--info asst__privacy">' +
      ui.icon('lock', { size: 18 }) +
      '<div><p><strong>' +
      esc(t('assistant.privacy.title')) +
      '</strong> ' +
      esc(t('assistant.privacy.body')) +
      '</p><details class="asst__prod" data-asst-privacy' +
      (s.privacyOpen ? ' open' : '') +
      '><summary data-fk="asst-privacy">' +
      esc(t('assistant.privacy.more')) +
      '</summary><p>' +
      esc(t('assistant.privacy.prod')) +
      '</p></details></div></div>';
    h += '<ol class="asst-thread" aria-label="' + esc(t('assistant.threadLabel')) + '">' + s.thread.map(function (e) {
      return turnFor(e, s);
    }).join('') + '</ol>';
    h += '<section class="asst-sugg" aria-labelledby="asst-sugg-h"><h3 id="asst-sugg-h" class="asst-sugg__h">' + esc(t('assistant.suggestTitle')) + '</h3><ul class="asst-qlist">' + QUESTIONS.map(function (q) {
      return qButton(q, 'asst-q-' + q);
    }).join('') + '</ul></section>';
    if (s.thread.length > 1) {
      h += '<p class="asst-clear"><button type="button" class="btn btn--ghost" data-asst-clear data-fk="asst-clear">' + ui.icon('close', { size: 16 }) + '<span>' + esc(t('assistant.clear')) + '</span></button></p>';
    }
    h += '</div>';

    h +=
      '<form class="asst__form" data-asst-form novalidate><label class="asst__label" for="asst-input">' +
      esc(t('assistant.form.label')) +
      '</label><div class="asst__row"><input id="asst-input" class="input" type="text" maxlength="200" autocomplete="off" enterkeyhint="send" data-fk="asst-input" aria-describedby="asst-hint" placeholder="' +
      esc(t('assistant.form.placeholder')) +
      '" value="' +
      esc(s.draft) +
      '"><button type="submit" class="btn btn--primary asst__send" data-fk="asst-submit">' +
      ui.icon('arrow-right', { size: 18 }) +
      '<span>' +
      esc(t('assistant.form.submit')) +
      '</span></button></div><p id="asst-hint" class="asst__hint">' +
      ui.icon('info', { size: 14 }) +
      '<span>' +
      esc(t('assistant.form.hint')) +
      '</span></p></form>';
    return h;
  }

  function render() {
    if (!els.dlg) return;
    var b = scrollerEl();
    var top = b ? b.scrollTop : 0;
    // ui.announce keeps live regions inside the open modal drawer: carry them
    // over, so a re-render never drops a region or a message on its way.
    var live = ui.$$(':scope > .dlg-live--polite, :scope > .dlg-live--assertive', els.dlg);
    ui.render(els.dlg, drawerHtml());
    live.forEach(function (r) {
      els.dlg.appendChild(r);
    });
    inqSig = inquirySig();
    animateId = null;
    b = scrollerEl();
    if (b) b.scrollTop = top;
  }

  /* ------------------------------------------------------------------ */
  /* Drawer open / close                                                 */
  /* ------------------------------------------------------------------ */
  function openAs(m) {
    var d = els.dlg;
    var html = doc.documentElement;
    mode = m;
    d.classList.toggle('asst--docked', m === 'docked');
    d.classList.toggle('asst--stacked', m === 'stacked');
    if (m === 'docked') {
      if (typeof d.show === 'function') d.show();
      else d.setAttribute('open', '');
      html.classList.add('assistant-docked');
    } else {
      html.classList.remove('assistant-docked');
      if (typeof d.showModal === 'function') d.showModal();
      else d.setAttribute('open', '');
      html.classList.add('has-modal');
    }
  }

  /** Open (or keep open) the drawer, remembering where focus should return. */
  function show(trigger) {
    var d = els.dlg;
    if (trigger && trigger.nodeType === 1 && !d.contains(trigger)) returnTo = trigger;
    if (d.open) return;
    if (!trigger || d.contains(trigger)) {
      var a = doc.activeElement;
      returnTo = a && a !== doc.body && !d.contains(a) ? a : null;
    }
    var stacked = ui.anyModalOpen();
    openAs(stacked ? 'stacked' : docked() ? 'docked' : 'modal');
    var s = S();
    if (!s.open) {
      s.open = true;
      save(s);
    }
  }

  function scrollToTurn(eid, smooth) {
    var b = scrollerEl();
    var el = eid && ENTRY_ID.test(eid) ? els.dlg.querySelector('#asst-turn-' + eid) : null;
    if (!b || !el) return;
    var top = el.getBoundingClientRect().top - b.getBoundingClientRect().top + b.scrollTop - 12;
    if (smooth && b.scrollTo && !ui.reducedMotion()) b.scrollTo({ top: top, behavior: 'smooth' });
    else b.scrollTop = top;
  }

  function focusEntry(eid, smooth) {
    var h = eid && ENTRY_ID.test(eid) ? els.dlg.querySelector('#asst-' + eid + '-h') : null;
    if (h) {
      h.focus({ preventScroll: true });
      scrollToTurn(eid, smooth);
    } else {
      var title = els.dlg.querySelector('#asst-title');
      if (title) title.focus({ preventScroll: true });
    }
  }

  function finishClose(opts) {
    if (mode === null) return;
    mode = null;
    var html = doc.documentElement;
    html.classList.remove('assistant-docked');
    html.classList.toggle('has-modal', ui.anyModalOpen());
    var s = S();
    if (s.open) {
      s.open = false;
      save(s);
    }
    var target = returnTo;
    returnTo = null;
    if (opts && opts.returnFocus === false) return;
    restoreFocus(target);
  }

  function restoreFocus(el) {
    if (el && visible(el)) {
      el.focus();
      return;
    }
    var fk = el && el.getAttribute && el.getAttribute('data-fk');
    var alt = fk ? doc.querySelector(fkSel(fk)) : null;
    if (alt && visible(alt)) {
      alt.focus();
      return;
    }
    var ask = doc.querySelector('[data-ask]');
    if (ask && visible(ask)) ask.focus();
  }

  function close(opts) {
    var d = els.dlg;
    if (!d || !d.open) return;
    d.close();
    finishClose(opts);
  }

  /** Close first when the drawer is modal and the next action reveals the page. */
  function handOff(fn) {
    if (mode && mode !== 'docked') close({ returnFocus: false });
    fn();
  }

  function onDockChange() {
    var d = els.dlg;
    if (!d || !d.open || mode === 'stacked' || mode === null) return;
    var want = docked() ? 'docked' : 'modal';
    if (want === mode) return;
    var a = doc.activeElement;
    var fk = a && d.contains(a) ? a.getAttribute('data-fk') : null;
    var b = scrollerEl();
    var top = b ? b.scrollTop : 0;
    d.close(); // the async 'close' event sees the dialog open again and is ignored
    openAs(want);
    if (want === 'docked') doc.documentElement.classList.toggle('has-modal', ui.anyModalOpen());
    // The content is the same in every mode: only the frame changes, so the
    // focused control is still there and gets focus back.
    b = scrollerEl();
    if (b) b.scrollTop = top;
    var target = fk ? d.querySelector(fkSel(fk)) : null;
    (target && visible(target) ? target : d.querySelector('#asst-title')).focus({ preventScroll: true });
  }

  /* ------------------------------------------------------------------ */
  /* Public actions                                                      */
  /* ------------------------------------------------------------------ */
  function open(opts) {
    opts = opts || {};
    if (!els.dlg) return;
    var topic = CONTEXT_TOPICS[opts.topic] ? opts.topic : 'general';
    var id = opts.id != null && opts.id !== '' ? String(opts.id) : null;
    var eid = null;
    if (topic === 'general') {
      if (!S().thread.length) eid = push({ topic: 'general', via: 'welcome' });
    } else {
      eid = push({ topic: topic, tid: id, via: 'context' });
    }
    var wasOpen = els.dlg.open;
    show(opts.trigger);
    render();
    if (topic !== 'general') focusEntry(eid, wasOpen);
    else {
      // General entry point: focus the drawer heading and show the latest answer.
      var title = els.dlg.querySelector('#asst-title');
      if (title) title.focus({ preventScroll: true });
      var th = S().thread;
      if (th.length) scrollToTurn(eid || th[th.length - 1].id);
    }
  }

  function ask(questionId, opts) {
    opts = opts || {};
    if (!els.dlg) return;
    var eid = Q_TOPIC[questionId] ? push({ q: questionId, via: 'suggested' }) : push({ topic: 'fallback', via: 'system' });
    var wasOpen = els.dlg.open;
    show(opts.trigger);
    render();
    focusEntry(eid, wasOpen);
  }

  function askText(text) {
    var q = String(text || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 200);
    if (!q) {
      var input = els.dlg.querySelector('#asst-input');
      if (input) input.focus();
      ui.announce(t('assistant.form.empty'), true);
      return null;
    }
    var m = match(q);
    var eid = push({ topic: m.topic, tid: m.id, via: 'typed', text: q, qlang: m.lang, lang: m.lang && m.lang !== YES.i18n.lang ? m.lang : null }, { draft: '' });
    show();
    render();
    focusEntry(eid, true);
    return eid;
  }

  function setFeedback(eid, value) {
    var s = S();
    if (!findEntry(eid)) return;
    s.helpful[eid] = value;
    save(s);
    render();
    ui.announce(t('assistant.helpfulThanks'));
  }

  function clearThread() {
    var s = S();
    s.thread = [];
    s.helpful = {};
    s.expanded = {};
    save(s);
    var eid = push({ topic: 'general', via: 'welcome' });
    render();
    focusEntry(eid);
    ui.announce(t('assistant.cleared'));
  }

  /** The thread entry a control in the drawer belongs to. */
  function entryOf(el) {
    var turn = el && el.closest ? el.closest('.asst-turn') : null;
    return turn ? findEntry(turn.id.replace(/^asst-turn-/, '')) : null;
  }
  /** The supporting rows a row button was shown with (undefined for a lone row). */
  function rowsAround(btn, id) {
    var en = entryOf(btn);
    var rows = en ? supportRows(model(en)) : [];
    return rows.length > 1 && rows.indexOf(id) !== -1 ? rows : undefined;
  }

  /* ------------------------------------------------------------------ */
  /* Events (bound once)                                                 */
  /* ------------------------------------------------------------------ */
  function bind() {
    var d = els.dlg;
    d.addEventListener('close', function () {
      if (d.open) return; // re-opened in another mode
      finishClose();
    });
    d.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && mode === 'docked') {
        e.preventDefault();
        close();
      }
    });
    // Backdrop click (modal modes) closes the drawer.
    d.addEventListener('click', function (e) {
      if (e.target !== d || mode === 'docked') return;
      var r = d.getBoundingClientRect();
      var inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      if (!inside) close();
    });
    ui.delegate(d, 'click', '[data-asst-close]', function () {
      close();
    });
    ui.delegate(d, 'click', '[data-asst-q]', function (e, b) {
      ask(b.getAttribute('data-asst-q'));
    });
    ui.delegate(d, 'click', '[data-asst-tx]', function (e, b) {
      var id = b.getAttribute('data-asst-tx');
      // Previous / Next in the detail stay within this explanation's rows, all of
      // them (also those behind "Show all"). A single row has no list of its own.
      var rows = rowsAround(b, id);
      if (mode === 'stacked') {
        // The drawer sits above another dialog: hand back to it so the detail is visible.
        var back = returnTo;
        close({ returnFocus: false });
        YES.explorer.openTx(id, { trigger: back && visible(back) ? back : null, list: rows });
      } else {
        YES.explorer.openTx(id, { trigger: b, list: rows });
      }
    });
    ui.delegate(d, 'click', '[data-asst-rows]', function (e, b) {
      var en = findEntry(b.getAttribute('data-asst-rows'));
      if (!en) return;
      var rowIds = supportRows(model(en));
      // Localised in every language, so the chip follows a later language switch.
      var label = localized(function () {
        var lm = model(en);
        return t('assistant.rowsChip', { subject: lm.rowsSubject || lm.title });
      });
      handOff(function () {
        YES.explorer.showRows(rowIds, label);
      });
    });
    ui.delegate(d, 'click', '[data-asst-more]', function (e, b) {
      var eid = b.getAttribute('data-asst-more');
      var s = S();
      s.expanded[eid] = !s.expanded[eid];
      save(s);
      render();
    });
    ui.delegate(d, 'click', '[data-asst-fb]', function (e, b) {
      setFeedback(b.getAttribute('data-entry'), b.getAttribute('data-asst-fb'));
    });
    ui.delegate(d, 'click', '[data-asst-inquiry]', function (e, b) {
      var id = b.getAttribute('data-asst-inquiry');
      if (mode === 'stacked') {
        // Above another dialog: hand back to it so the inquiry is not opened underneath.
        var back = returnTo;
        close({ returnFocus: false });
        YES.inquiry.start(id, { trigger: back && visible(back) ? back : null });
      } else {
        YES.inquiry.start(id, { trigger: b });
      }
    });
    ui.delegate(d, 'click', '[data-asst-talk]', function () {
      handOff(function () {
        YES.help.open('contact');
      });
    });
    ui.delegate(d, 'click', '[data-asst-read]', function (e, b) {
      var topic = b.getAttribute('data-asst-read');
      handOff(function () {
        YES.understand.openTopic(topic);
      });
    });
    ui.delegate(d, 'click', '[data-asst-clear]', function () {
      clearThread();
    });
    d.addEventListener('submit', function (e) {
      if (!e.target.matches || !e.target.matches('[data-asst-form]')) return;
      e.preventDefault();
      var input = d.querySelector('#asst-input');
      askText(input ? input.value : '');
    });
    d.addEventListener('input', function (e) {
      if (e.target && e.target.id === 'asst-input') {
        var s = S();
        s.draft = String(e.target.value || '').slice(0, 200);
        save(s);
      }
    });
    // <details> 'toggle' does not bubble: listen in the capture phase.
    d.addEventListener(
      'toggle',
      function (e) {
        if (e.target && e.target.hasAttribute && e.target.hasAttribute('data-asst-privacy')) {
          var s = S();
          s.privacyOpen = !!e.target.open;
          save(s);
        }
      },
      true
    );
    if (mqDock) {
      if (mqDock.addEventListener) mqDock.addEventListener('change', onDockChange);
      else if (mqDock.addListener) mqDock.addListener(onDockChange);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Public API + registration                                           */
  /* ------------------------------------------------------------------ */
  YES.assistant = {
    open: open,
    ask: ask,
    close: close,
    /* Extras for other modules and tests */
    askText: askText,
    match: match,
    isOpen: function () {
      return !!(els.dlg && els.dlg.open);
    },
    mode: function () {
      return mode;
    },
    questions: function () {
      return QUESTIONS.slice();
    }
  };

  YES.register({
    name: 'assistant',
    i18n: {
      en: {
        'assistant.title': 'Ask YES',
        'assistant.demoTag': 'Demo explanation',
        'assistant.policyTag': 'Limits of this assistant',
        'assistant.illustrativeTag': 'Illustrative details',
        'assistant.close': 'Close Ask YES',
        'assistant.about': 'About:',
        'assistant.privacy.title': 'Privacy in this demo.',
        'assistant.privacy.body': 'Answers are computed in this browser from this statement only. Nothing you ask is sent anywhere or saved after you close this page.',
        'assistant.privacy.more': 'How it would work in production',
        'assistant.privacy.prod':
          'Production would use an approved, governed AI service with a published privacy notice, a defined retention policy and an audit trail. Answers would be grounded in your statement and approved help content, and you could always reach a person.',
        'assistant.threadLabel': 'Conversation with Ask YES',
        'assistant.you': 'You:',
        'assistant.explainAsk': 'Explain: {subject}',
        'assistant.figures': 'Figures used',
        'assistant.addsUp': 'How it adds up',
        'assistant.equals': 'equals',
        'assistant.rowsN': 'Supporting rows ({n})',
        'assistant.rowOpen': 'Open transaction:',
        'assistant.showRows': 'Show these rows in Transactions',
        'assistant.rowsChip': 'Rows used to explain: {subject}',
        'assistant.moreRows': 'Show all {n} rows',
        'assistant.fewerRows': 'Show fewer rows',
        'assistant.source': 'Source: this statement as of {date}. Statement data, not your live account.',
        'assistant.helpful': 'Was this helpful?',
        'assistant.helpfulYes': 'Yes',
        'assistant.helpfulNo': 'No',
        'assistant.helpfulNote': 'Demo: your answer stays in this browser session only and is not sent.',
        'assistant.helpfulThanks': 'Thanks. Your feedback is kept only in this browser session for the demo. Nothing was sent.',
        'assistant.talk': 'Talk to a person',
        'assistant.readMore': 'Read more in Understand',
        'assistant.inquiry.new': 'Ask about this transaction',
        'assistant.inquiry.draft': 'Continue your inquiry',
        'assistant.inquiry.done': 'View your demo inquiry',
        'assistant.inquiry.newText': 'Something not right? Start a demo inquiry with {id} already filled in. Nothing is sent.',
        'assistant.inquiry.draftText': 'You have a draft inquiry about {id}. Pick up where you left off.',
        'assistant.inquiry.doneText': ifVar('ref', 'You completed a demo inquiry about {id} (reference {ref}). Nothing was sent.', 'You completed a demo inquiry about {id}. Nothing was sent.'),
        'assistant.suggestTitle': 'Suggested questions',
        'assistant.tryThese': 'Try one of these:',
        'assistant.clear': 'Clear conversation',
        'assistant.cleared': 'Conversation cleared',
        'assistant.form.label': 'Ask about this statement',
        'assistant.form.placeholder': 'Type your question',
        'assistant.form.submit': 'Ask',
        'assistant.form.hint': 'Demo answers from this statement only. No live AI model; nothing is sent.',
        'assistant.form.empty': 'Type a question first.',

        'assistant.q.why_balance': 'Why did my balance change?',
        'assistant.q.fees_paid': 'What did I pay in fees?',
        'assistant.q.largest': 'What was my largest movement?',
        'assistant.q.pending': 'What is pending?',
        'assistant.q.statement_vs_live': 'Is my statement balance my live balance?',
        'assistant.q.peg': 'Is one token always worth one US dollar?',
        'assistant.q.onchain_sent': 'Where did I send money on-chain?',

        'assistant.subject.general': 'Your statement for {period}',
        'assistant.subject.chart': 'Running balance',
        'assistant.subject.counterparty': 'Activity with {name}',
        'assistant.subject.action': 'Moving money',
        'assistant.subject.advice': 'Investment advice',
        'assistant.subject.fallback': 'A question outside this statement',
        'assistant.subject.notFound': 'Transaction {id}',

        'assistant.welcome.title': 'Hello, {name}. What would you like to understand?',
        'assistant.welcome.p1': 'I explain the figures in your statement for {period}, using only the statement data as of {asOf}. Choose a suggested question or type your own.',
        'assistant.welcome.p2': 'I can’t move money, give investment advice or see your live account.',

        'assistant.balance.title': 'Why your balance changed',
        'assistant.balance.p1': 'Your statement balance went from {opening} to {closing} between {start} and {end}, a net change of {net}.',
        'assistant.balance.incoming': 'Incoming activity added {amount} across {count}: {parts}.',
        'assistant.balance.outgoing': 'Outgoing activity and fees took away {amount} across {count}: {parts}.',
        'assistant.balance.pending': pl(
          '{count} of {amount} was still pending at the statement cut-off, so it is not included in this balance.',
          '{count} totalling {amount} were still pending at the statement cut-off, so they are not included in this balance.'
        ),

        'assistant.step.title': '{label}: {amount}',
        'assistant.step.added': pl('In {period}, {count} in this category added {amount} to your balance.', 'In {period}, {count} in this category added {amount} to your balance.'),
        'assistant.step.reduced': pl('In {period}, {count} in this category reduced your balance by {amount}.', 'In {period}, {count} in this category reduced your balance by {amount}.'),
        'assistant.step.none': 'There were no posted transactions in this category in {period}.',
        'assistant.step.largest': 'The largest was {amount} on {date}: {description} ({counterparty}).',
        'assistant.step.rail.internal': pl('{count} moved within YES', '{count} moved within YES'),
        'assistant.step.rail.onchain': pl('{count} went over a blockchain network', '{count} went over a blockchain network'),
        'assistant.step.rail.other': pl('{count} used a linked bank account or card', '{count} used a linked bank account or card'),
        'assistant.step.rails': '{parts}.',
        'assistant.step.linkedFees': pl('A linked fee of {amount} is counted separately under Fees, not in this step.', 'Linked fees of {amount} are counted separately under Fees, not in this step.'),
        'assistant.step.prior': '{id} was initiated on {initiated}, in the previous period, and posted on {posted}. Statements use the posted date, so it counts in this period.',
        'assistant.step.pending': 'A further {amount} ({count}) was pending at the statement cut-off and is not included.',

        'assistant.group.in': pl('In {period}, {count} added {amount} to your balance.', 'In {period}, {count} added {amount} to your balance.'),
        'assistant.group.out': pl('In {period}, {count} reduced your balance by {amount}.', 'In {period}, {count} reduced your balance by {amount}.'),
        'assistant.group.parts': 'That is made up of {parts}.',

        'assistant.tx.posted': '{amount} posted on {date} at {time}, taking your statement balance from {before} to {after}.',
        'assistant.tx.pending': 'This transaction ({amount}) was initiated on {initiated} and was still pending at the statement cut-off ({asOf}).',
        'assistant.tx.notPosted': 'This transaction ({amount}) was initiated on {initiated}; its status at the statement cut-off ({asOf}) was “{status}”.',
        'assistant.tx.excluded':
          'Only posted transactions count, so it is not included in the statement balance of {closing}, the balance journey or the chart. If it completes, it will appear on your next statement.',
        'assistant.tx.noLive': 'This statement can’t show its current status; your live account may have an update.',
        'assistant.tx.internal': 'It was an internal YES transfer: it moved between YES accounts and did not use a blockchain network.',
        'assistant.tx.onchain':
          'It went over a blockchain network. Its network details ({network}, reference {hash}, {confirmations} confirmations) are marked “Illustrative reference — no live blockchain verification”: they have not been checked on a live blockchain, and there is no explorer link.',
        'assistant.tx.onchainUnverified': 'It went over a blockchain network. Blockchain details are shown only when verified, and none are available for it in this demo.',
        'assistant.tx.prior': 'It was initiated on {initiated}, in the previous period, and posted on {posted}. Statements use the posted date, so it belongs to this statement.',
        'assistant.tx.dates': 'It was initiated on {initiated} and posted on {posted}. The statement uses the posted date.',
        'assistant.tx.hasFee': 'A separate {kind} of {amount} ({id}) was charged for it. It appears as its own line so each amount can be traced.',
        'assistant.tx.feeOf': 'This is a {kind} for {parentId}, “{parentDesc}” ({parentAmount}) on {parentDate}. Fees are recorded as separate lines linked to the transaction they belong to.',
        'assistant.tx.memo': 'Your note on it: “{memo}”.',

        'assistant.notFound.title': 'I couldn’t find that transaction',
        'assistant.notFound.p1': 'There is no transaction “{id}” in this statement, so I can’t explain it. Check the ID in Transactions, or ask about another part of the statement.',

        'assistant.fees.title': 'What you paid in fees',
        'assistant.fees.p1': 'You paid {total} in fees in {period}, across {count}.',
        'assistant.fees.p2': 'Each fee is its own line, linked to the transaction it belongs to:',
        'assistant.fees.item': '{amount}: {kind} for {parentId}, “{parentDesc}”, on {date}',
        'assistant.fees.none': 'You paid no fees in {period}.',
        'assistant.fees.noForeign': 'No fees were charged in any other asset, so nothing is left out of the balance journey.',
        'assistant.fees.foreign': '{count} with fees in another asset are shown separately and are not subtracted from your {symbol} balance.',
        'assistant.feeKind.network_transfer': 'Network transfer fee',
        'assistant.feeKind.card_deposit': 'Card deposit fee',
        'assistant.feeKind.redemption': 'Redemption fee',
        'assistant.feeKind.other': 'Service fee',

        'assistant.chart.title': 'Highs and lows of your running balance',
        'assistant.chart.p1': 'Your running balance started at {opening} and ended at {closing} after {count}, in posted-date order.',
        'assistant.chart.high': 'It was highest at {balance} on {date}, after “{description}” ({amount}).',
        'assistant.chart.low': 'It was lowest at {balance} on {date}, after “{description}” ({amount}).',
        'assistant.chart.highOpening': 'It was highest at the opening balance, {balance}.',
        'assistant.chart.lowOpening': 'It was lowest at the opening balance, {balance}.',
        'assistant.chart.p4': 'The chart uses posted transactions only; pending ones are not included.',
        'assistant.chart.none': 'There are no posted transactions to chart in this period.',

        'assistant.pending.title': 'What is pending',
        'assistant.pending.none': 'Nothing was pending at the statement cut-off ({asOf}). Every transaction in this statement is posted.',
        'assistant.pending.p1': pl(
          '{count} had not posted by the statement cut-off ({asOf}), so it is listed but not included in your balance:',
          '{count} had not posted by the statement cut-off ({asOf}), so they are listed but not included in your balance:'
        ),
        'assistant.pending.item': '{amount}: {description} (initiated {date}; {status})',
        'assistant.pending.p2': 'Anything that completes later will appear on your next statement. Your statement balance of {closing} does not change, and this demo can’t show live status.',

        'assistant.largest.title': 'Your largest movement',
        'assistant.largest.p1': 'Your largest single movement in {period} was “{description}”: {amount} on {date}.',
        'assistant.largest.out': 'The largest outgoing movement was “{description}”: {amount} on {date}.',
        'assistant.largest.in': 'The largest incoming movement was “{description}”: {amount} on {date}.',
        'assistant.largest.note': 'Size is compared without the sign. Fees are not counted as movements here, and pending transactions are excluded.',
        'assistant.largest.none': 'There are no posted movements in this period.',

        'assistant.peg.p1': 'I can’t guarantee that a token will always be worth one US dollar, and I can’t give investment advice.',
        'assistant.peg.p2': 'The USD equivalent in this statement uses an illustrative demo rate of {rate} USD per token as of {at}. It is not a market quote and not a promise of future value.',
        'assistant.peg.noRate': 'This statement shows no USD rate, because no rate with a source and timestamp is available.',
        'assistant.peg.p3': 'For how the stablecoin is designed to keep its value, including reserves and redemption terms, please see the approved issuer disclosures.',

        'assistant.onchain.title': 'Where you sent money on-chain',
        'assistant.onchain.p1': pl('In {period}, {count} went out over a blockchain network, for {amount} in total:', 'In {period}, {count} went out over a blockchain network, for {amount} in total:'),
        'assistant.onchain.item': '{amount} on {date}. Destination: {counterparty}',
        'assistant.onchain.fee': 'Network fees: {amount}, shown as separate lines.',
        'assistant.onchain.ref':
          'Network references in this statement are marked “Illustrative reference — no live blockchain verification”. They have not been checked on a live blockchain, and there is no explorer link.',
        'assistant.onchain.received': 'You also received {amount} on-chain in {count}.',
        'assistant.onchain.none': 'You didn’t send anything on-chain in {period}. Your outgoing transfers were internal or to your bank.',

        'assistant.cp.title': 'Your activity with {name}',
        'assistant.cp.p1': pl('In {period}, {count} with {name} posted.', 'In {period}, {count} with {name} posted.'),
        'assistant.cp.sent': 'You sent {amount} in total ({count}).',
        'assistant.cp.received': 'You received {amount} in total ({count}).',

        'assistant.action.title': 'I can’t move money or start transactions',
        'assistant.action.p1': 'Ask YES only explains this statement. It can’t send, transfer, redeem or cancel anything, and it will never ask for your password or security codes.',
        'assistant.action.p2': 'To make a transaction, use your YES account directly. If something in this statement doesn’t look right, you can talk to a person.',
        'assistant.advice.title': 'I can’t give investment advice',
        'assistant.advice.p1': 'I can’t recommend buying, selling or holding tokens, and I can’t predict prices or future values.',
        'assistant.advice.p2': 'I can explain what happened in this statement, such as why your balance changed or what you paid in fees.',
        'assistant.human.p1': 'You can reach YES support from the Help section. In this demo the contact details are placeholders and nothing is sent.',
        'assistant.human.p2': 'If a specific transaction doesn’t look right, open it and choose “Ask about this transaction” to try the demo inquiry.',
        'assistant.human.p3': 'Formal disputes and fraud reports need an approved process, so this demo doesn’t offer them.',
        'assistant.fallback.title': 'I can only answer questions about this statement',
        'assistant.fallback.p1': 'In this demo, Ask YES matches your question to the topics it can explain from this statement, and I couldn’t match this one. I won’t guess or make up an answer.',
        'assistant.fallback.p2': 'If you need something else, you can talk to a person.',

        'assistant.example.out': '{amount} sent on {date} ({id})',
        'assistant.example.in': '{amount} received on {date} ({id})',

        'assistant.edu.token_units.name': 'Token units',
        'assistant.edu.token_units.p1': 'Your balance is counted in {product} ({symbol}), to {precision} decimal places. It is a quantity of tokens, not a bank balance in dollars.',
        'assistant.edu.token_units.p2': 'For example, your closing balance of {closing} is {units} token units, and the smallest posted amount is {smallest} (“{description}”).',
        'assistant.edu.usd_equivalent.name': 'USD equivalent',
        'assistant.edu.usd_equivalent.p1': 'A US dollar equivalent is shown only when a rate, its source and a timestamp are all available.',
        'assistant.edu.usd_equivalent.p2': 'This statement uses an illustrative demo rate of {rate} USD per token as of {at}, which is not a market quote. At that rate, your closing balance of {closing} is shown as {fiat}.',
        'assistant.edu.usd_equivalent.p3': 'It is for reference only and does not guarantee that a token is always worth one US dollar.',
        'assistant.edu.usd_equivalent.none': 'This statement has no rate with a source and timestamp, so no USD equivalent is shown.',
        'assistant.edu.onchain_vs_internal.name': 'On-chain versus internal transfers',
        'assistant.edu.onchain_vs_internal.p1': 'An internal transfer moves tokens between YES accounts without using a blockchain network.',
        'assistant.edu.onchain_vs_internal.internal': pl('In this statement, {count} moved within YES, for example {example}.', 'In this statement, {count} moved within YES, for example {example}.'),
        'assistant.edu.onchain_vs_internal.p2': 'An on-chain transfer goes over a blockchain network to or from an external wallet.',
        'assistant.edu.onchain_vs_internal.onchain': pl('{count} went on-chain: {example}.', '{count} went on-chain, for example {example}.'),
        'assistant.edu.onchain_vs_internal.p3':
          'On-chain transfers can carry a network fee, shown as its own line. Network details in this demo are marked “Illustrative reference — no live blockchain verification”.',
        'assistant.edu.tx_status.name': 'Transaction status',
        'assistant.edu.tx_status.p1': 'Posted transactions are complete for this statement and count in the balance: {count} this period.',
        'assistant.edu.tx_status.pending': 'Pending transactions had not completed at the cut-off ({asOf}). They are listed but never counted: {count}, totalling {amount}.',
        'assistant.edu.tx_status.noPending': 'No transactions were pending at the cut-off.',
        'assistant.edu.tx_status.p3': 'Failed or unknown statuses are always shown explicitly and are never counted in the balance.',
        'assistant.edu.fees.name': 'Fees',
        'assistant.edu.fees.p1': 'Fees are charged as separate lines, each linked to the transaction it belongs to, so every amount can be traced.',
        'assistant.edu.fees.p3': 'Fees in another asset would be shown separately and never subtracted from your balance without a documented conversion. There are none in this statement.',
        'assistant.edu.redemption.name': 'Redemption',
        'assistant.edu.redemption.p1': 'A redemption exchanges tokens for US dollars paid to your linked bank account. The tokens leave your balance when the redemption posts.',
        'assistant.edu.redemption.p2': pl('This period, {count} posted for {amount} in total.', 'This period, {count} posted for {amount} in total.'),
        'assistant.edu.redemption.none': 'No redemptions posted this period.',
        'assistant.edu.redemption.fees': pl('A redemption fee of {amount} appears as its own line.', 'Redemption fees of {amount} in total appear as their own lines.'),
        'assistant.edu.statement_vs_live.name': 'Statement balance versus live balance',
        'assistant.edu.statement_vs_live.p1': 'This statement is a snapshot as of {asOf}. Its balance, {closing}, is the record for {period} and won’t change.',
        'assistant.edu.statement_vs_live.p2': 'Your live balance can differ because of activity after the cut-off. For example, “{description}” for {amount} was still pending at the cut-off.',
        'assistant.edu.statement_vs_live.p2none': 'Your live balance can differ because of activity after the cut-off.',
        'assistant.edu.statement_vs_live.p3': 'This demo isn’t connected to your live account, so I can only explain statement data.',
        'assistant.edu.transparency.name': 'Reserves and transparency',
        'assistant.edu.transparency.p1': 'The transparency panel shows where an approved issuer, reserve report, attestation date, redemption terms and source link would appear.',
        'assistant.edu.transparency.p2': 'In this demo it is marked “Illustrative layout; no reserve assertion”. I can’t make claims about reserves, custody or the issuer.',
        'assistant.edu.transparency.p3': 'In production, only verified facts with a source, date and responsible entity would be shown, and stale or missing evidence would be hidden with an explanation.',

        'assistant.fig.catCount': '{label} ({count})',
        'assistant.fig.pendingNot': 'Pending, not included ({count})',
        'assistant.fig.total': 'Total',
        'assistant.fig.count': 'Transactions',
        'assistant.fig.largest': 'Largest ({id})',
        'assistant.fig.linkedFees': 'Linked fees, counted under Fees',
        'assistant.fig.amount': 'Amount',
        'assistant.fig.posted': 'Posted',
        'assistant.fig.initiated': 'Initiated',
        'assistant.fig.before': 'Balance before',
        'assistant.fig.after': 'Balance after',
        'assistant.fig.status': 'Status',
        'assistant.fig.rail': 'Rail and method',
        'assistant.fig.counterparty': 'Counterparty',
        'assistant.fig.reference': 'Reference',
        'assistant.fig.fee': 'Linked fee ({id})',
        'assistant.fig.parent': 'Belongs to ({id})',
        'assistant.fig.network': 'Network details (illustrative)',
        'assistant.fig.networkVal': '{network} · {hash} · {confirmations} confirmations',
        'assistant.fig.feeLine': '{kind} ({id})',
        'assistant.fig.totalFees': 'Total fees',
        'assistant.fig.foreignFees': 'Fees in other assets',
        'assistant.fig.highest': 'Highest ({date})',
        'assistant.fig.lowest': 'Lowest ({date})',
        'assistant.fig.largestMove': 'Largest movement ({id})',
        'assistant.fig.largestOut': 'Largest outgoing ({id})',
        'assistant.fig.largestIn': 'Largest incoming ({id})',
        'assistant.fig.rate': 'Rate used (illustrative)',
        'assistant.fig.rateVal': '{rate} USD per token',
        'assistant.fig.rateSource': 'Rate source',
        'assistant.fig.rateAt': 'Rate time',
        'assistant.fig.fiat': 'USD equivalent (illustrative)',
        'assistant.fig.sentTo': 'Sent on-chain ({id})',
        'assistant.fig.networkFees': 'Network fees',
        'assistant.fig.sent': 'Sent',
        'assistant.fig.received': 'Received',
        'assistant.fig.net': 'Net',
        'assistant.fig.precision': 'Decimal places',
        'assistant.fig.smallest': 'Smallest posted amount ({id})',
        'assistant.fig.internalCount': 'Internal transfers',
        'assistant.fig.onchainCount': 'On-chain transfers',
        'assistant.fig.postedCount': 'Posted',
        'assistant.fig.pendingCount': 'Pending',
        'assistant.fig.otherCount': 'Failed or unknown',
        'assistant.fig.redeemed': 'Redemptions posted',
        'assistant.fig.redemptionFees': 'Redemption fees',
        'assistant.fig.statementAsOf': 'Statement balance, as of {date}',
        'assistant.fig.live': 'Live balance',
        'assistant.fig.liveNA': 'Not available in this demo',
        'assistant.fig.issuer': 'Issuer or partner',
        'assistant.fig.evidence': 'Verified evidence',
        'assistant.fig.evidenceNA': 'Not connected in this demo'
      },
      es: {
        'assistant.title': 'Pregunta a YES',
        'assistant.demoTag': 'Explicación de demostración',
        'assistant.policyTag': 'Límites de este asistente',
        'assistant.illustrativeTag': 'Datos ilustrativos',
        'assistant.close': 'Cerrar Pregunta a YES',
        'assistant.about': 'Sobre:',
        'assistant.privacy.title': 'Privacidad en esta demostración.',
        'assistant.privacy.body': 'Las respuestas se calculan en este navegador solo a partir de este estado de cuenta. Nada de lo que preguntes se envía a ningún sitio ni se guarda al cerrar esta página.',
        'assistant.privacy.more': 'Cómo funcionaría en producción',
        'assistant.privacy.prod':
          'En producción se usaría un servicio de IA aprobado y supervisado, con un aviso de privacidad publicado, una política de conservación definida y un registro de auditoría. Las respuestas se basarían en tu estado de cuenta y en contenido de ayuda aprobado, y siempre podrías hablar con una persona.',
        'assistant.threadLabel': 'Conversación con Pregunta a YES',
        'assistant.you': 'Tú:',
        'assistant.explainAsk': 'Explicar: {subject}',
        'assistant.figures': 'Cifras utilizadas',
        'assistant.addsUp': 'Cómo se suma',
        'assistant.equals': 'es igual a',
        'assistant.rowsN': 'Movimientos de respaldo ({n})',
        'assistant.rowOpen': 'Abrir movimiento:',
        'assistant.showRows': 'Mostrar estas filas en Movimientos',
        'assistant.rowsChip': 'Filas usadas para explicar: {subject}',
        'assistant.moreRows': 'Mostrar las {n} filas',
        'assistant.fewerRows': 'Mostrar menos filas',
        'assistant.source': 'Fuente: este estado de cuenta al {date}. Son datos del estado de cuenta, no de tu cuenta en vivo.',
        'assistant.helpful': '¿Te resultó útil?',
        'assistant.helpfulYes': 'Sí',
        'assistant.helpfulNo': 'No',
        'assistant.helpfulNote': 'Demostración: tu respuesta se queda solo en esta sesión del navegador y no se envía.',
        'assistant.helpfulThanks': 'Gracias. Tu opinión se guarda solo en esta sesión del navegador para la demostración. No se envió nada.',
        'assistant.talk': 'Hablar con una persona',
        'assistant.readMore': 'Leer más en Entender',
        'assistant.inquiry.new': 'Preguntar por este movimiento',
        'assistant.inquiry.draft': 'Continuar tu consulta',
        'assistant.inquiry.done': 'Ver tu consulta de demostración',
        'assistant.inquiry.newText': '¿Algo no te cuadra? Inicia una consulta de demostración con {id} ya indicado. No se envía nada.',
        'assistant.inquiry.draftText': 'Tienes un borrador de consulta sobre {id}. Continúa donde lo dejaste.',
        'assistant.inquiry.doneText': ifVar('ref', 'Completaste una consulta de demostración sobre {id} (referencia {ref}). No se envió nada.', 'Completaste una consulta de demostración sobre {id}. No se envió nada.'),
        'assistant.suggestTitle': 'Preguntas sugeridas',
        'assistant.tryThese': 'Prueba con una de estas:',
        'assistant.clear': 'Borrar conversación',
        'assistant.cleared': 'Conversación borrada',
        'assistant.form.label': 'Pregunta sobre este estado de cuenta',
        'assistant.form.placeholder': 'Escribe tu pregunta',
        'assistant.form.submit': 'Preguntar',
        'assistant.form.hint': 'Respuestas de demostración basadas solo en este estado de cuenta. Sin modelo de IA en vivo; no se envía nada.',
        'assistant.form.empty': 'Escribe primero una pregunta.',

        'assistant.q.why_balance': '¿Por qué cambió mi saldo?',
        'assistant.q.fees_paid': '¿Cuánto pagué en comisiones?',
        'assistant.q.largest': '¿Cuál fue mi mayor movimiento?',
        'assistant.q.pending': '¿Qué está pendiente?',
        'assistant.q.statement_vs_live': '¿El saldo del estado de cuenta es mi saldo en vivo?',
        'assistant.q.peg': '¿Un token siempre vale un dólar estadounidense?',
        'assistant.q.onchain_sent': '¿A dónde envié dinero en cadena?',

        'assistant.subject.general': 'Tu estado de cuenta de {period}',
        'assistant.subject.chart': 'Saldo acumulado',
        'assistant.subject.counterparty': 'Actividad con {name}',
        'assistant.subject.action': 'Mover dinero',
        'assistant.subject.advice': 'Consejos de inversión',
        'assistant.subject.fallback': 'Una pregunta fuera de este estado de cuenta',
        'assistant.subject.notFound': 'Movimiento {id}',

        'assistant.welcome.title': 'Hola, {name}. ¿Qué te gustaría entender?',
        'assistant.welcome.p1': 'Te explico las cifras de tu estado de cuenta de {period} usando solo los datos del estado de cuenta al {asOf}. Elige una pregunta sugerida o escribe la tuya.',
        'assistant.welcome.p2': 'No puedo mover dinero, darte consejos de inversión ni ver tu cuenta en vivo.',

        'assistant.balance.title': 'Por qué cambió tu saldo',
        'assistant.balance.p1': 'El saldo de tu estado de cuenta pasó de {opening} a {closing} entre el {start} y el {end}, un cambio neto de {net}.',
        'assistant.balance.incoming': 'Las entradas sumaron {amount} en {count}: {parts}.',
        'assistant.balance.outgoing': 'Las salidas y comisiones restaron {amount} en {count}: {parts}.',
        'assistant.balance.pending': pl(
          '{count} de {amount} seguía pendiente al cierre del estado de cuenta, por eso no se incluye en este saldo.',
          '{count} por un total de {amount} seguían pendientes al cierre del estado de cuenta, por eso no se incluyen en este saldo.'
        ),

        'assistant.step.title': '{label}: {amount}',
        'assistant.step.added': pl('En {period}, {count} de esta categoría sumó {amount} a tu saldo.', 'En {period}, {count} de esta categoría sumaron {amount} a tu saldo.'),
        'assistant.step.reduced': pl('En {period}, {count} de esta categoría redujo tu saldo en {amount}.', 'En {period}, {count} de esta categoría redujeron tu saldo en {amount}.'),
        'assistant.step.none': 'No hubo movimientos registrados en esta categoría en {period}.',
        'assistant.step.largest': 'El mayor fue de {amount} el {date}: {description} ({counterparty}).',
        'assistant.step.rail.internal': pl('{count} se hizo dentro de YES', '{count} se hicieron dentro de YES'),
        'assistant.step.rail.onchain': pl('{count} pasó por una red blockchain', '{count} pasaron por una red blockchain'),
        'assistant.step.rail.other': pl('{count} usó una cuenta bancaria o tarjeta vinculada', '{count} usaron una cuenta bancaria o tarjeta vinculada'),
        'assistant.step.rails': '{parts}.',
        'assistant.step.linkedFees': pl(
          'Una comisión vinculada de {amount} se cuenta aparte, en Comisiones, no en este paso.',
          'Las comisiones vinculadas, {amount} en total, se cuentan aparte, en Comisiones, no en este paso.'
        ),
        'assistant.step.prior': '{id} se inició el {initiated}, en el período anterior, y se registró el {posted}. Los estados de cuenta usan la fecha de registro, por eso cuenta en este período.',
        'assistant.step.pending': 'Otros {amount} ({count}) estaban pendientes al cierre del estado de cuenta y no se incluyen.',

        'assistant.group.in': pl('En {period}, {count} sumó {amount} a tu saldo.', 'En {period}, {count} sumaron {amount} a tu saldo.'),
        'assistant.group.out': pl('En {period}, {count} redujo tu saldo en {amount}.', 'En {period}, {count} redujeron tu saldo en {amount}.'),
        'assistant.group.parts': 'Se compone de {parts}.',

        'assistant.tx.posted': 'Se registraron {amount} el {date} a las {time}, y el saldo de tu estado de cuenta pasó de {before} a {after}.',
        'assistant.tx.pending': 'Este movimiento ({amount}) se inició el {initiated} y seguía pendiente al cierre del estado de cuenta ({asOf}).',
        'assistant.tx.notPosted': 'Este movimiento ({amount}) se inició el {initiated}; su estado al cierre del estado de cuenta ({asOf}) era «{status}».',
        'assistant.tx.excluded':
          'Solo cuentan los movimientos registrados, por eso no se incluye en el saldo del estado de cuenta de {closing}, ni en el recorrido del saldo ni en el gráfico. Si se completa, aparecerá en tu próximo estado de cuenta.',
        'assistant.tx.noLive': 'Este estado de cuenta no puede mostrar su estado actual; tu cuenta en vivo puede tener novedades.',
        'assistant.tx.internal': 'Fue una transferencia interna de YES: se movió entre cuentas de YES y no usó ninguna red blockchain.',
        'assistant.tx.onchain':
          'Pasó por una red blockchain. Sus datos de red ({network}, referencia {hash}, {confirmations} confirmaciones) están marcados como «Referencia ilustrativa — sin verificación en blockchain en vivo»: no se han comprobado en una blockchain en vivo y no hay enlace a ningún explorador.',
        'assistant.tx.onchainUnverified': 'Pasó por una red blockchain. Los detalles de blockchain solo se muestran cuando están verificados, y en esta demostración no hay ninguno disponible para este movimiento.',
        'assistant.tx.prior': 'Se inició el {initiated}, en el período anterior, y se registró el {posted}. Los estados de cuenta usan la fecha de registro, por eso pertenece a este estado de cuenta.',
        'assistant.tx.dates': 'Se inició el {initiated} y se registró el {posted}. El estado de cuenta usa la fecha de registro.',
        'assistant.tx.hasFee': 'Se cobró aparte una {kind} de {amount} ({id}). Aparece como una línea propia para que cada importe pueda rastrearse.',
        'assistant.tx.feeOf': 'Es una {kind} del movimiento {parentId}, «{parentDesc}» ({parentAmount}), del {parentDate}. Las comisiones se registran como líneas separadas vinculadas al movimiento al que corresponden.',
        'assistant.tx.memo': 'Tu nota: «{memo}».',

        'assistant.notFound.title': 'No encontré ese movimiento',
        'assistant.notFound.p1': 'No hay ningún movimiento «{id}» en este estado de cuenta, así que no puedo explicarlo. Comprueba el identificador en Movimientos o pregunta por otra parte del estado de cuenta.',

        'assistant.fees.title': 'Lo que pagaste en comisiones',
        'assistant.fees.p1': 'Pagaste {total} en comisiones en {period}, en {count}.',
        'assistant.fees.p2': 'Cada comisión es una línea propia, vinculada al movimiento al que corresponde:',
        'assistant.fees.item': '{amount}: {kind} del movimiento {parentId}, «{parentDesc}», del {date}',
        'assistant.fees.none': 'No pagaste comisiones en {period}.',
        'assistant.fees.noForeign': 'No se cobraron comisiones en ningún otro activo, así que nada queda fuera del recorrido del saldo.',
        'assistant.fees.foreign': '{count} con comisiones en otro activo se muestran aparte y no se restan de tu saldo en {symbol}.',
        'assistant.feeKind.network_transfer': 'Comisión por transferencia en red',
        'assistant.feeKind.card_deposit': 'Comisión por depósito con tarjeta',
        'assistant.feeKind.redemption': 'Comisión por canje',
        'assistant.feeKind.other': 'Comisión de servicio',

        'assistant.chart.title': 'Máximos y mínimos de tu saldo acumulado',
        'assistant.chart.p1': 'Tu saldo acumulado empezó en {opening} y terminó en {closing} tras {count}, en orden de fecha de registro.',
        'assistant.chart.high': 'Su punto más alto fue {balance} el {date}, después de «{description}» ({amount}).',
        'assistant.chart.low': 'Su punto más bajo fue {balance} el {date}, después de «{description}» ({amount}).',
        'assistant.chart.highOpening': 'Su punto más alto fue el saldo inicial, {balance}.',
        'assistant.chart.lowOpening': 'Su punto más bajo fue el saldo inicial, {balance}.',
        'assistant.chart.p4': 'El gráfico usa solo movimientos registrados; los pendientes no se incluyen.',
        'assistant.chart.none': 'No hay movimientos registrados que mostrar en el gráfico en este período.',

        'assistant.pending.title': 'Qué está pendiente',
        'assistant.pending.none': 'No había nada pendiente al cierre del estado de cuenta ({asOf}). Todos los movimientos de este estado de cuenta están registrados.',
        'assistant.pending.p1': pl(
          '{count} no se había registrado al cierre del estado de cuenta ({asOf}), por eso aparece en la lista pero no se incluye en tu saldo:',
          '{count} no se habían registrado al cierre del estado de cuenta ({asOf}), por eso aparecen en la lista pero no se incluyen en tu saldo:'
        ),
        'assistant.pending.item': '{amount}: {description} (inicio: {date}; {status})',
        'assistant.pending.p2': 'Lo que se complete más adelante aparecerá en tu próximo estado de cuenta. El saldo de tu estado de cuenta, {closing}, no cambia, y esta demostración no puede mostrar el estado en vivo.',

        'assistant.largest.title': 'Tu mayor movimiento',
        'assistant.largest.p1': 'Tu mayor movimiento individual en {period} fue «{description}»: {amount} el {date}.',
        'assistant.largest.out': 'La mayor salida fue «{description}»: {amount} el {date}.',
        'assistant.largest.in': 'La mayor entrada fue «{description}»: {amount} el {date}.',
        'assistant.largest.note': 'El tamaño se compara sin tener en cuenta el signo. Aquí las comisiones no cuentan como movimientos y se excluyen los pendientes.',
        'assistant.largest.none': 'No hay movimientos registrados en este período.',

        'assistant.peg.p1': 'No puedo garantizar que un token valga siempre un dólar estadounidense, y no puedo darte consejos de inversión.',
        'assistant.peg.p2': 'El equivalente en USD de este estado de cuenta usa una tasa ilustrativa de demostración de {rate} USD por token al {at}. No es una cotización de mercado ni una promesa de valor futuro.',
        'assistant.peg.noRate': 'Este estado de cuenta no muestra ninguna tasa en USD, porque no hay una tasa con fuente y marca de tiempo.',
        'assistant.peg.p3': 'Para saber cómo está diseñada la stablecoin para mantener su valor, incluidas las reservas y las condiciones de canje, consulta las divulgaciones aprobadas del emisor.',

        'assistant.onchain.title': 'A dónde enviaste dinero en cadena',
        'assistant.onchain.p1': pl('En {period}, {count} salió por una red blockchain, por un total de {amount}:', 'En {period}, {count} salieron por una red blockchain, por un total de {amount}:'),
        'assistant.onchain.item': '{amount} el {date}. Destino: {counterparty}',
        'assistant.onchain.fee': 'Comisiones de red: {amount}, que aparecen como líneas separadas.',
        'assistant.onchain.ref':
          'Las referencias de red de este estado de cuenta están marcadas como «Referencia ilustrativa — sin verificación en blockchain en vivo». No se han comprobado en una blockchain en vivo y no hay enlace a ningún explorador.',
        'assistant.onchain.received': 'También recibiste {amount} en cadena en {count}.',
        'assistant.onchain.none': 'No enviaste nada en cadena en {period}. Tus salidas fueron internas o a tu banco.',

        'assistant.cp.title': 'Tu actividad con {name}',
        'assistant.cp.p1': pl('Con {name} se registró {count} en {period}.', 'Con {name} se registraron {count} en {period}.'),
        'assistant.cp.sent': 'Enviaste {amount} en total ({count}).',
        'assistant.cp.received': 'Recibiste {amount} en total ({count}).',

        'assistant.action.title': 'No puedo mover dinero ni iniciar movimientos',
        'assistant.action.p1': 'Pregunta a YES solo explica este estado de cuenta. No puede enviar, transferir, canjear ni cancelar nada, y nunca te pedirá tu contraseña ni tus códigos de seguridad.',
        'assistant.action.p2': 'Para hacer un movimiento, usa directamente tu cuenta de YES. Si algo de este estado de cuenta no te cuadra, puedes hablar con una persona.',
        'assistant.advice.title': 'No puedo darte consejos de inversión',
        'assistant.advice.p1': 'No puedo recomendarte comprar, vender ni mantener tokens, y no puedo predecir precios ni valores futuros.',
        'assistant.advice.p2': 'Puedo explicarte lo que pasó en este estado de cuenta, como por qué cambió tu saldo o cuánto pagaste en comisiones.',
        'assistant.human.p1': 'Puedes contactar con el soporte de YES desde la sección Ayuda. En esta demostración, los datos de contacto son marcadores de posición y no se envía nada.',
        'assistant.human.p2': 'Si un movimiento concreto no te cuadra, ábrelo y elige «Preguntar por este movimiento» para probar la consulta de demostración.',
        'assistant.human.p3': 'Las disputas formales y los avisos de fraude necesitan un proceso aprobado, así que esta demostración no los ofrece.',
        'assistant.fallback.title': 'Solo puedo responder preguntas sobre este estado de cuenta',
        'assistant.fallback.p1': 'En esta demostración, Pregunta a YES asocia tu pregunta con los temas que puede explicar a partir de este estado de cuenta, y no he podido asociar esta. No voy a adivinar ni a inventar una respuesta.',
        'assistant.fallback.p2': 'Si necesitas otra cosa, puedes hablar con una persona.',

        'assistant.example.out': '{amount} enviados el {date} ({id})',
        'assistant.example.in': '{amount} recibidos el {date} ({id})',

        'assistant.edu.token_units.name': 'Unidades de token',
        'assistant.edu.token_units.p1': 'Tu saldo se cuenta en {product} ({symbol}), con {precision} decimales. Es una cantidad de tokens, no un saldo bancario en dólares.',
        'assistant.edu.token_units.p2': 'Por ejemplo, tu saldo final de {closing} son {units} unidades de token, y el importe registrado más pequeño es {smallest} («{description}»).',
        'assistant.edu.usd_equivalent.name': 'Equivalente en USD',
        'assistant.edu.usd_equivalent.p1': 'El equivalente en dólares estadounidenses solo se muestra cuando hay una tasa, su fuente y una marca de tiempo.',
        'assistant.edu.usd_equivalent.p2': 'Este estado de cuenta usa una tasa ilustrativa de demostración de {rate} USD por token al {at}, que no es una cotización de mercado. Con esa tasa, tu saldo final de {closing} se muestra como {fiat}.',
        'assistant.edu.usd_equivalent.p3': 'Es solo de referencia y no garantiza que un token valga siempre un dólar estadounidense.',
        'assistant.edu.usd_equivalent.none': 'Este estado de cuenta no tiene una tasa con fuente y marca de tiempo, así que no se muestra ningún equivalente en USD.',
        'assistant.edu.onchain_vs_internal.name': 'Transferencias en cadena frente a internas',
        'assistant.edu.onchain_vs_internal.p1': 'Una transferencia interna mueve tokens entre cuentas de YES sin usar una red blockchain.',
        'assistant.edu.onchain_vs_internal.internal': pl('En este estado de cuenta, {count} se hizo dentro de YES: {example}.', 'En este estado de cuenta, {count} se hicieron dentro de YES; por ejemplo, {example}.'),
        'assistant.edu.onchain_vs_internal.p2': 'Una transferencia en cadena pasa por una red blockchain hacia o desde un monedero externo.',
        'assistant.edu.onchain_vs_internal.onchain': pl('{count} pasó por una red blockchain: {example}.', '{count} pasaron por una red blockchain; por ejemplo, {example}.'),
        'assistant.edu.onchain_vs_internal.p3':
          'Las transferencias en cadena pueden tener una comisión de red, que aparece como una línea propia. Los datos de red de esta demostración están marcados como «Referencia ilustrativa — sin verificación en blockchain en vivo».',
        'assistant.edu.tx_status.name': 'Estado de los movimientos',
        'assistant.edu.tx_status.p1': 'Los movimientos registrados están completos para este estado de cuenta y cuentan en el saldo: {count} en este período.',
        'assistant.edu.tx_status.pending': 'Los movimientos pendientes no se habían completado al cierre ({asOf}). Aparecen en la lista, pero nunca se cuentan: {count}, por un total de {amount}.',
        'assistant.edu.tx_status.noPending': 'No había movimientos pendientes al cierre.',
        'assistant.edu.tx_status.p3': 'Los estados fallido o desconocido siempre se muestran de forma explícita y nunca se cuentan en el saldo.',
        'assistant.edu.fees.name': 'Comisiones',
        'assistant.edu.fees.p1': 'Las comisiones se cobran como líneas separadas, cada una vinculada a su movimiento, para que cada importe pueda rastrearse.',
        'assistant.edu.fees.p3': 'Las comisiones en otro activo se mostrarían aparte y nunca se restarían de tu saldo sin una conversión documentada. En este estado de cuenta no hay ninguna.',
        'assistant.edu.redemption.name': 'Canje',
        'assistant.edu.redemption.p1': 'Un canje cambia tokens por dólares estadounidenses que se pagan en tu cuenta bancaria vinculada. Los tokens salen de tu saldo cuando el canje se registra.',
        'assistant.edu.redemption.p2': pl('En este período se registró {count} por {amount} en total.', 'En este período se registraron {count} por {amount} en total.'),
        'assistant.edu.redemption.none': 'En este período no se registró ningún canje.',
        'assistant.edu.redemption.fees': pl('La comisión por canje, de {amount}, aparece como una línea propia.', 'Las comisiones por canje, {amount} en total, aparecen como líneas propias.'),
        'assistant.edu.statement_vs_live.name': 'Saldo del estado de cuenta frente a saldo en vivo',
        'assistant.edu.statement_vs_live.p1': 'Este estado de cuenta es una foto fija al {asOf}. Su saldo, {closing}, es el registro de {period} y no cambiará.',
        'assistant.edu.statement_vs_live.p2': 'Tu saldo en vivo puede ser distinto por la actividad posterior al cierre. Por ejemplo, «{description}» por {amount} seguía pendiente al cierre.',
        'assistant.edu.statement_vs_live.p2none': 'Tu saldo en vivo puede ser distinto por la actividad posterior al cierre.',
        'assistant.edu.statement_vs_live.p3': 'Esta demostración no está conectada a tu cuenta en vivo, así que solo puedo explicar los datos del estado de cuenta.',
        'assistant.edu.transparency.name': 'Reservas y transparencia',
        'assistant.edu.transparency.p1': 'El panel de transparencia muestra dónde aparecerían el emisor aprobado, el informe de reservas, la fecha de certificación, las condiciones de canje y el enlace a la fuente.',
        'assistant.edu.transparency.p2': 'En esta demostración está marcado como «Diseño ilustrativo; sin afirmación sobre reservas». No puedo hacer afirmaciones sobre reservas, custodia ni el emisor.',
        'assistant.edu.transparency.p3': 'En producción solo se mostrarían datos verificados con fuente, fecha y entidad responsable, y la evidencia desactualizada o ausente se ocultaría con una explicación.',

        'assistant.fig.catCount': '{label} ({count})',
        'assistant.fig.pendingNot': 'Pendiente, no incluido ({count})',
        'assistant.fig.total': 'Total',
        'assistant.fig.count': 'Movimientos',
        'assistant.fig.largest': 'Mayor ({id})',
        'assistant.fig.linkedFees': 'Comisiones vinculadas, contadas en Comisiones',
        'assistant.fig.amount': 'Importe',
        'assistant.fig.posted': 'Registrado',
        'assistant.fig.initiated': 'Iniciado',
        'assistant.fig.before': 'Saldo anterior',
        'assistant.fig.after': 'Saldo posterior',
        'assistant.fig.status': 'Estado',
        'assistant.fig.rail': 'Canal y método',
        'assistant.fig.counterparty': 'Contraparte',
        'assistant.fig.reference': 'Referencia',
        'assistant.fig.fee': 'Comisión vinculada ({id})',
        'assistant.fig.parent': 'Corresponde a ({id})',
        'assistant.fig.network': 'Datos de red (ilustrativos)',
        'assistant.fig.networkVal': '{network} · {hash} · {confirmations} confirmaciones',
        'assistant.fig.feeLine': '{kind} ({id})',
        'assistant.fig.totalFees': 'Total de comisiones',
        'assistant.fig.foreignFees': 'Comisiones en otros activos',
        'assistant.fig.highest': 'Máximo ({date})',
        'assistant.fig.lowest': 'Mínimo ({date})',
        'assistant.fig.largestMove': 'Mayor movimiento ({id})',
        'assistant.fig.largestOut': 'Mayor salida ({id})',
        'assistant.fig.largestIn': 'Mayor entrada ({id})',
        'assistant.fig.rate': 'Tasa usada (ilustrativa)',
        'assistant.fig.rateVal': '{rate} USD por token',
        'assistant.fig.rateSource': 'Fuente de la tasa',
        'assistant.fig.rateAt': 'Hora de la tasa',
        'assistant.fig.fiat': 'Equivalente en USD (ilustrativo)',
        'assistant.fig.sentTo': 'Enviado en cadena ({id})',
        'assistant.fig.networkFees': 'Comisiones de red',
        'assistant.fig.sent': 'Enviado',
        'assistant.fig.received': 'Recibido',
        'assistant.fig.net': 'Neto',
        'assistant.fig.precision': 'Decimales',
        'assistant.fig.smallest': 'Importe registrado más pequeño ({id})',
        'assistant.fig.internalCount': 'Transferencias internas',
        'assistant.fig.onchainCount': 'Transferencias en cadena',
        'assistant.fig.postedCount': 'Registrados',
        'assistant.fig.pendingCount': 'Pendientes',
        'assistant.fig.otherCount': 'Fallidos o desconocidos',
        'assistant.fig.redeemed': 'Canjes registrados',
        'assistant.fig.redemptionFees': 'Comisiones por canje',
        'assistant.fig.statementAsOf': 'Saldo del estado de cuenta al {date}',
        'assistant.fig.live': 'Saldo en vivo',
        'assistant.fig.liveNA': 'No disponible en esta demostración',
        'assistant.fig.issuer': 'Emisor o socio',
        'assistant.fig.evidence': 'Evidencia verificada',
        'assistant.fig.evidenceNA': 'No conectada en esta demostración'
      }
    },
    init: function () {
      els.root = doc.getElementById('assistant-root');
      if (!els.root) return;
      var d = doc.createElement('dialog');
      d.id = 'assistant-drawer';
      d.className = 'asst';
      d.setAttribute('aria-labelledby', 'asst-title');
      els.root.appendChild(d);
      els.dlg = d;
      bind();
      render();
    },
    render: function () {
      render();
    },
    onState: function (keys) {
      // An explicit language choice wins: every answer follows the page again.
      if (keys.indexOf('lang') !== -1) {
        var s = S();
        if (s.thread.some(function (e) {
          return e.lang;
        })) {
          s.thread = s.thread.map(function (e) {
            var c = copy(e);
            delete c.lang;
            return c;
          });
          save(s);
        }
      }
      // "Ask about this transaction" becomes "Continue" / "View" as the inquiry moves
      // on. The inquiry saves on every keystroke, so re-render only when a label changes.
      if (keys.indexOf('inquiry') !== -1 && els.dlg && els.dlg.open && inquirySig() !== inqSig) render();
    }
  });
})(window);
