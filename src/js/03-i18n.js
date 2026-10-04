/*
 * Localisation: string dictionaries, interpolation and locale-aware formatting
 * (PRD 5.8). English and Spanish ship in the file; modules add their own strings
 * with YES.i18n.add({ en: {...}, es: {...} }). Spanish copy is subject to
 * native-language review and no legal text is machine-translated at runtime.
 */
(function (root) {
  'use strict';
  var YES = (root.YES = root.YES || {});

  var dict = { en: {}, es: {} };
  var warned = {};

  var i18n = (YES.i18n = {
    lang: 'en',
    dict: dict,

    /** Merge a { en: {...}, es: {...} } block into the dictionaries. */
    add: function (block) {
      Object.keys(block).forEach(function (lang) {
        dict[lang] = dict[lang] || {};
        Object.keys(block[lang]).forEach(function (k) {
          dict[lang][k] = block[lang][k];
        });
      });
    },

    /** Keys present in one language but missing in another (used by tests). */
    audit: function () {
      var langs = Object.keys(dict);
      var report = {};
      langs.forEach(function (a) {
        langs.forEach(function (b) {
          if (a === b) return;
          Object.keys(dict[a]).forEach(function (k) {
            if (!(k in dict[b])) (report[b] = report[b] || []).push(k);
          });
        });
      });
      return report;
    },

    locale: function (lang) {
      return YES.config.locales[lang || i18n.lang] || 'en-US';
    }
  });

  /**
   * Translate `key`, interpolating {name} placeholders from `vars`.
   * A localised object ({ en, es }) can be passed instead of a key.
   */
  YES.t = function (key, vars) {
    var s;
    if (key && typeof key === 'object') {
      s = key[i18n.lang] != null ? key[i18n.lang] : key.en;
    } else {
      var table = dict[i18n.lang] || {};
      s = table[key];
      if (s == null) {
        if (!warned[i18n.lang + key] && root.console) {
          warned[i18n.lang + key] = true;
          console.warn('[i18n] missing "' + key + '" for ' + i18n.lang);
        }
        s = dict.en[key] != null ? dict.en[key] : key;
      }
    }
    if (typeof s === 'function') return s(vars || {});
    if (vars) {
      s = String(s).replace(/\{(\w+)\}/g, function (m, name) {
        return vars[name] != null ? vars[name] : m;
      });
    }
    return s;
  };

  /** Localised value of a { en, es } object (or a plain string). */
  YES.L = function (obj) {
    if (obj == null) return '';
    if (typeof obj === 'string') return obj;
    return obj[i18n.lang] != null ? obj[i18n.lang] : obj.en;
  };

  /* ------------------------------------------------------------------ */
  /* Formatting                                                          */
  /* ------------------------------------------------------------------ */

  var MINUS = '−';
  var cache = {};
  function nf(digits) {
    var k = 'n' + i18n.lang + digits;
    // useGrouping 'always' groups four-digit amounts too (es-ES: 1.147,50 rather
    // than 1147,50), matching how statements print amounts. Older engines treat
    // the string as `true` and fall back to the locale default.
    return (cache[k] = cache[k] || new Intl.NumberFormat(i18n.locale(), { minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: 'always' }));
  }
  function dtf(opts, key) {
    var k = 'd' + i18n.lang + key;
    if (!cache[k]) {
      var o = { timeZone: YES.data.statement.timezone };
      for (var p in opts) o[p] = opts[p];
      cache[k] = new Intl.DateTimeFormat(i18n.locale(), o);
    }
    return cache[k];
  }
  var DATE_STYLES = {
    short: { day: 'numeric', month: 'short' },
    medium: { day: 'numeric', month: 'short', year: 'numeric' },
    long: { day: 'numeric', month: 'long', year: 'numeric' },
    weekday: { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' },
    time: { hour: 'numeric', minute: '2-digit' },
    datetime: { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' },
    monthYear: { month: 'long', year: 'numeric' },
    monthYearShort: { month: 'short', year: 'numeric' },
    tz: { timeZoneName: 'short', hour: 'numeric' },
    iso: { year: 'numeric', month: '2-digit', day: '2-digit' }
  };

  /* Range wording per language (see fmt.range). {d1}/{d2} days, {m1}/{m2} months,
     {y} year, {a}/{b} full dates. */
  var RANGE_RULES = {
    es: { sameMonth: '{d1} al {d2} de {m1} de {y}', sameYear: '{d1} de {m1} al {d2} de {m2} de {y}', other: '{a} al {b}' }
  };
  function dateParts(f, date) {
    var o = {};
    f.formatToParts(date).forEach(function (p) {
      o[p.type] = p.value;
    });
    return o;
  }
  /* A masked identifier: bullets, an optional space, then the visible tail. */
  var MASK_RE = /(\u2022+)\s?([0-9A-Za-z]+)/g;

  var fmt = (YES.fmt = {
    MASK_RE: MASK_RE,
    MINUS: MINUS,

    /** Plain number from minor units at the asset precision, unsigned. */
    number: function (minor, precision) {
      var p = precision == null ? YES.calc.asset().precision : precision;
      return nf(p).format(Math.abs(minor) / Math.pow(10, p));
    },

    /**
     * Amount in token units.
     *   sign: 'auto' (− only when negative) | 'always' (+/−) | 'never'
     *   unit: true to append the asset symbol (default true)
     */
    amount: function (minor, opts) {
      opts = opts || {};
      var asset = YES.data.assets[opts.asset || YES.data.statement.assetId];
      var sign = opts.sign || 'auto';
      var s = fmt.number(minor, asset.precision);
      var prefix = '';
      if (minor < 0 && sign !== 'never') prefix = MINUS;
      else if (minor > 0 && sign === 'always') prefix = '+';
      var out = prefix + s;
      if (opts.unit !== false) out += ' ' + asset.symbol;
      return out;
    },

    /** Words for screen readers, e.g. "minus 120.00 EXUSD" / "menos 120,00 EXUSD". */
    amountSpoken: function (minor, opts) {
      var unsigned = fmt.amount(Math.abs(minor), { sign: 'never', unit: !(opts && opts.unit === false) });
      if (minor < 0) return YES.t('fmt.minus') + ' ' + unsigned;
      if (minor > 0 && opts && opts.sign === 'always') return YES.t('fmt.plus') + ' ' + unsigned;
      return unsigned;
    },

    /**
     * Fiat equivalent (e.g. USD) from fiat minor units. Grouped like token
     * amounts (es-ES: "1.147,50 USD", never "1147,50 USD") so the same figure
     * never appears in two formats side by side.
     */
    fiat: function (fiatMinor, currency) {
      var k = 'f' + i18n.lang + currency;
      cache[k] = cache[k] || new Intl.NumberFormat(i18n.locale(), { style: 'currency', currency: currency, currencyDisplay: 'code', useGrouping: 'always' });
      return cache[k].format(fiatMinor / 100);
    },

    /** Date/time in the statement timezone. style: short|medium|long|weekday|time|datetime|monthYear|monthYearShort|iso */
    date: function (iso, style) {
      if (!iso) return '';
      style = style || 'medium';
      if (style === 'iso') {
        var parts = dtf(DATE_STYLES.iso, 'iso').formatToParts(new Date(iso));
        var get = function (t) {
          return parts.filter(function (p) {
            return p.type === t;
          })[0].value;
        };
        // en-US gives MM/DD/YYYY parts; assemble ISO-like YYYY-MM-DD regardless of locale.
        return get('year') + '-' + get('month') + '-' + get('day');
      }
      return dtf(DATE_STYLES[style] || DATE_STYLES.medium, style).format(new Date(iso));
    },

    /** Calendar date (YYYY-MM-DD) in the statement timezone — for filters and CSV. */
    isoDate: function (iso) {
      if (!iso) return '';
      var parts = new Intl.DateTimeFormat('en-CA', { timeZone: YES.data.statement.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(iso));
      var o = {};
      parts.forEach(function (p) {
        o[p.type] = p.value;
      });
      return o.year + '-' + o.month + '-' + o.day;
    },

    /**
     * Date range in the statement timezone, worded so it reads naturally both on
     * its own and after a preposition: "September 1–30, 2026" (en),
     * "1 al 30 de septiembre de 2026" (es, so templates can say "del {period}").
     * Languages without a RANGE_RULES entry use Intl's formatRange.
     */
    range: function (fromIso, toIso) {
      var f = dtf(DATE_STYLES.long, 'long');
      var a = new Date(fromIso);
      var b = new Date(toIso);
      var rule = RANGE_RULES[i18n.lang];
      if (rule && f.formatToParts) {
        var pa = dateParts(f, a);
        var pb = dateParts(f, b);
        var tpl = pa.year !== pb.year ? rule.other : pa.month !== pb.month ? rule.sameYear : pa.day !== pb.day ? rule.sameMonth : null;
        if (!tpl) return f.format(a);
        return tpl.replace(/\{(\w+)\}/g, function (m, name) {
          return { d1: pa.day, d2: pb.day, m1: pa.month, m2: pb.month, y: pb.year, a: f.format(a), b: f.format(b) }[name];
        });
      }
      if (f.formatRange) return f.formatRange(a, b);
      return f.format(a) + ' – ' + f.format(b);
    },

    /**
     * Plain-text spoken form of masked identifiers for aria-labels:
     * "Debit card •••• 1190" → "Debit card ending in 1190". Visible text keeps the
     * bullets (see ui.maskedHtml), so screen readers never read "bullet bullet…".
     */
    maskedSpoken: function (text) {
      return String(text == null ? '' : text).replace(MASK_RE, function (m, dots, tail) {
        return YES.t('fmt.maskedEnding', { tail: tail });
      });
    },

    /**
     * Timezone label, e.g. "EDT (America/New_York)". The abbreviation comes from
     * en-US in every language: some locales only offer "GMT-4", which hides the
     * zone's name.
     */
    tz: function (iso) {
      var k = 'tzname';
      cache[k] = cache[k] || new Intl.DateTimeFormat('en-US', { timeZone: YES.data.statement.timezone, timeZoneName: 'short' });
      var parts = cache[k].formatToParts(new Date(iso || YES.data.statement.asOf));
      var name = parts.filter(function (p) {
        return p.type === 'timeZoneName';
      })[0];
      return (name ? name.value : '') + ' (' + YES.data.statement.timezone + ')';
    },

    /** 24-hour HH:MM in the statement timezone — machine-readable (CSV). */
    isoTime: function (iso) {
      if (!iso) return '';
      var k = 'isotime';
      cache[k] = cache[k] || new Intl.DateTimeFormat('en-GB', { timeZone: YES.data.statement.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
      return cache[k].format(new Date(iso));
    },

    /** Machine-readable decimal ("-120.00") at the asset precision — exact, from integers. */
    plain: function (minor, precision) {
      var p = precision == null ? YES.calc.asset().precision : precision;
      var abs = Math.abs(minor);
      var unit = Math.pow(10, p);
      var whole = Math.floor(abs / unit);
      var frac = String(abs % unit);
      while (frac.length < p) frac = '0' + frac;
      return (minor < 0 ? '-' : '') + whole + (p ? '.' + frac : '');
    },

    /** Locale-aware integer/count. */
    count: function (n) {
      return nf(0).format(n);
    }
  });

  /* ------------------------------------------------------------------ */
  /* Shared strings: shell, navigation, common vocabulary                */
  /* ------------------------------------------------------------------ */

  /* The demo notice must not claim that nothing leaves the page while the
     page itself loads a third-party widget: name it whenever it is enabled. */
  function footerDemo() {
    var uw = YES.config && YES.config.userway;
    return YES.t('footer.demoBase') + (uw && uw.enabled ? ' ' + YES.t('footer.userwayNote') : '');
  }

  i18n.add({
    en: {
      'fmt.minus': 'minus',
      'fmt.plus': 'plus',
      'fmt.maskedEnding': 'ending in {tail}',

      'app.title': 'YES statement',
      'app.docTitle': '{view} · YES statement, {period}',
      'app.docTitleWithheld': 'Statement withheld · YES statement, {period}',
      'app.docTitleDemo': '{title} · Illustrative demo',
      'app.skip': 'Skip to statement',
      'app.noscript': 'This interactive statement needs JavaScript. A static summary follows.',

      'brand.logoAlt': 'YES',
      'brand.logoPlaceholder': 'Logo placeholder',
      'brand.statement': 'Statement',

      // Demo labels for the modules (Help's section tag, the transaction
      // detail's tag, the print and PDF record). The header has no demo badge
      // since 2026-10-04; the footer notice uses 'footer.demo'.
      'demo.badge': 'Illustrative demo data',
      'demo.badgeLong': 'Illustrative demo data — fictional customer, amounts and references',
      'demo.watermark': 'ILLUSTRATIVE DEMO DATA',
      'demo.only': 'Demo only',

      'nav.label': 'Statement sections',
      'nav.overview': 'Overview',
      'nav.transactions': 'Transactions',
      'nav.understand': 'Understand',
      'nav.help': 'Help',

      'lang.label': 'Language',
      'lang.en': 'English',
      'lang.es': 'Español',
      'lang.switchTo': 'Cambiar a español',
      'lang.changed': 'Language changed to English',

      'ask.button': 'Ask YES',
      'ask.buttonShort': 'Ask',
      'ask.buttonLong': 'Ask YES about this statement',

      /* Masthead: light/dark toggle, Download or print (help 'record'), phone menu. */
      'theme.dark': 'Dark mode',
      'theme.on': 'On',
      'theme.off': 'Off',
      'record.button': 'Download or print',
      'record.buttonShort': 'Download',
      'menu.button': 'Menu',
      'explain.button': 'Explain with AI',
      'explain.buttonFor': 'Explain with AI: {topic}',

      'common.close': 'Close',
      'common.back': 'Back',
      'common.next': 'Next',
      'common.cancel': 'Cancel',
      'common.clear': 'Clear',
      'common.clearAll': 'Clear all',
      'common.apply': 'Apply',
      'common.show': 'Show',
      'common.hide': 'Hide',
      'common.copy': 'Copy',
      'common.copied': 'Copied to clipboard',
      'common.copyFailed': 'Copy is not available here. Select the text to copy it.',
      'common.more': 'More',
      'common.details': 'Details',
      'common.learnMore': 'Learn more',
      'common.yes': 'Yes',
      'common.no': 'No',
      'common.optional': 'optional',
      'common.required': 'required',
      'common.none': 'None',
      'common.notAvailable': 'Not available',
      'common.unavailable': 'Unavailable',
      'common.placeholder': 'placeholder',
      'common.illustrative': 'Illustrative',
      'common.txCount1': '1 transaction',
      'common.txCountN': '{n} transactions',
      'common.of': '{a} of {b}',
      'common.print': 'Print statement',
      'common.loading': 'Loading…',

      'type.deposit': 'Deposit',
      'type.transfer_in': 'Received',
      'type.transfer_out': 'Sent',
      'type.redemption': 'Redeemed',
      'type.fee': 'Fee',
      'type.unknown': 'Unknown type',
      /* Not posted (pending, failed, unknown): never a completed-sounding label. */
      'type.transfer_in.notPosted': 'Incoming transfer',
      'type.transfer_out.notPosted': 'Send requested',
      'type.redemption.notPosted': 'Redemption requested',

      'cat.opening': 'Opening balance',
      'cat.deposits': 'Deposits',
      'cat.transfers_in': 'Incoming transfers',
      'cat.transfers_out': 'Outgoing transfers',
      'cat.redemptions': 'Redemptions',
      'cat.fees': 'Fees',
      'cat.closing': 'Closing balance',
      'group.incoming': 'Incoming activity',
      'group.outgoing': 'Outgoing activity and fees',

      'status.posted': 'Posted',
      'status.pending': 'Pending',
      'status.failed': 'Failed',
      'status.unknown': 'Status unknown',
      'status.notInBalance': 'Not included in statement balance',

      'rail.internal': 'Internal (YES)',
      'rail.onchain': 'On-chain',
      'rail.other': 'Bank or card',

      'method.bank_transfer': 'Bank transfer',
      'method.debit_card': 'Debit card',
      'method.yes_transfer': 'YES transfer',
      'method.yes_payment': 'YES payment',
      'method.network_send': 'Blockchain network send',
      'method.network_receive': 'Blockchain network receipt',
      'method.bank_payout': 'Payout to bank',
      'method.fee': 'Service fee',

      'dir.in': 'Incoming',
      'dir.out': 'Outgoing',

      'term.statementBalance': 'Statement balance',
      'term.tokenUnits': 'token units',
      'term.asOf': 'As of {date}',
      'term.period': 'Statement period',
      'term.postedDate': 'Posted date',
      'term.initiatedDate': 'Initiated date',
      'term.dateBasisNote': 'Dates and totals use the posted date.',
      'term.timezone': 'Times shown in {tz}',

      'integrity.title': 'This statement is being withheld',
      'integrity.body': 'Its totals do not reconcile, so we are not showing balances that could be wrong. Nothing on this page has been rounded or adjusted to hide the difference.',
      'integrity.routed': 'It has been routed for correction.',
      'integrity.routedSimulated': 'In production, a statement like this would be routed for correction. This is a showcase preview, so nothing was sent.',
      'integrity.simulated': 'You are viewing a simulated integrity failure (showcase only).',
      'integrity.return': 'Return to the valid demo statement',
      'integrity.checks': 'Release checks',
      'integrity.pass': 'Passed',
      'integrity.fail': 'Failed',
      'check.unique_ids': 'Every transaction has a unique ID',
      'check.precision': 'Amounts use exact whole minor units',
      'check.single_asset': 'Only the statement asset is in the balance journey',
      'check.period_basis': 'Every posted transaction falls inside the period (posted-date basis)',
      'check.equation': 'Opening balance plus movements equals closing balance',
      'check.running_balance': 'Running balances reconcile in date order',
      'check.categories': 'Journey categories add up to the net change',
      'check.fee_links': 'Every fee links to the transaction it belongs to',
      'check.pending_excluded': 'Pending transactions are excluded from the balance',

      'footer.demo': footerDemo,
      'footer.demoBase': 'Showcase statement with illustrative demo data. No real customer, account or blockchain information is used. Nothing you do on this page is sent anywhere by the statement itself.',
      'footer.userwayNote': 'When you are online, the page also loads the UserWay accessibility widget, a third-party service with its own privacy terms.',
      'footer.statementId': 'Statement {id} · version {version}',
      'footer.generated': 'Generated {date}',
      'footer.disclosures': 'Disclosures',
      'footer.poweredBy': 'Interactive statement delivered via InfoSlips',

      'route.announce': '{view} section',

      /* Static summary generated at build time for browsers without JavaScript. */
      'noscript.heading': 'YES statement — {period}',
      'noscript.ids': 'Statement {id}, version {version}. Account {account}.',
      'noscript.times': 'Statement as of {asOf} · generated {generated}.',
      'noscript.basis': 'Dates and totals use the posted date. Times are shown in {tz}.',
      'noscript.balances': 'Opening balance {opening}. Closing statement balance {closing}.',
      'noscript.posted': 'Posted transactions',
      'noscript.type': 'Type',
      'noscript.description': 'Description',
      'noscript.counterparty': 'Counterparty',
      'noscript.amount': 'Amount',
      'noscript.balanceAfter': 'Balance after',
      'noscript.notInBalance': 'Not included in the statement balance',
      'noscript.pendingItem': '{date} — {description}: {amount} ({status})'
    },
    es: {
      'fmt.minus': 'menos',
      'fmt.plus': 'más',
      'fmt.maskedEnding': 'que termina en {tail}',

      'app.title': 'Estado de cuenta de YES',
      'app.docTitle': '{view} · Estado de cuenta de YES, {period}',
      'app.docTitleWithheld': 'Estado de cuenta retenido · Estado de cuenta de YES, {period}',
      'app.docTitleDemo': '{title} · Demostración ilustrativa',
      'app.skip': 'Ir al estado de cuenta',
      'app.noscript': 'Este estado de cuenta interactivo necesita JavaScript. A continuación verás un resumen estático.',

      'brand.logoAlt': 'YES',
      'brand.logoPlaceholder': 'Marcador de logotipo',
      'brand.statement': 'Estado de cuenta',

      'demo.badge': 'Datos ilustrativos de demostración',
      'demo.badgeLong': 'Datos ilustrativos de demostración — cliente, importes y referencias ficticios',
      'demo.watermark': 'DATOS ILUSTRATIVOS DE DEMOSTRACIÓN',
      'demo.only': 'Solo demostración',

      'nav.label': 'Secciones del estado de cuenta',
      'nav.overview': 'Resumen',
      'nav.transactions': 'Movimientos',
      'nav.understand': 'Entender',
      'nav.help': 'Ayuda',

      'lang.label': 'Idioma',
      'lang.en': 'English',
      'lang.es': 'Español',
      'lang.switchTo': 'Switch to English',
      'lang.changed': 'Idioma cambiado a español',

      'ask.button': 'Pregunta a YES',
      'ask.buttonShort': 'Pregunta',
      'ask.buttonLong': 'Pregunta a YES sobre este estado de cuenta',

      'theme.dark': 'Modo oscuro',
      'theme.on': 'Activado',
      'theme.off': 'Desactivado',
      'record.button': 'Descargar o imprimir',
      'record.buttonShort': 'Descargar',
      'menu.button': 'Menú',
      'explain.button': 'Explicar con IA',
      'explain.buttonFor': 'Explicar con IA: {topic}',

      'common.close': 'Cerrar',
      'common.back': 'Atrás',
      'common.next': 'Siguiente',
      'common.cancel': 'Cancelar',
      'common.clear': 'Borrar',
      'common.clearAll': 'Borrar todo',
      'common.apply': 'Aplicar',
      'common.show': 'Mostrar',
      'common.hide': 'Ocultar',
      'common.copy': 'Copiar',
      'common.copied': 'Copiado al portapapeles',
      'common.copyFailed': 'Copiar no está disponible aquí. Selecciona el texto para copiarlo.',
      'common.more': 'Más',
      'common.details': 'Detalles',
      'common.learnMore': 'Más información',
      'common.yes': 'Sí',
      'common.no': 'No',
      'common.optional': 'opcional',
      'common.required': 'obligatorio',
      'common.none': 'Ninguno',
      'common.notAvailable': 'No disponible',
      'common.unavailable': 'No disponible',
      'common.placeholder': 'marcador de posición',
      'common.illustrative': 'Ilustrativo',
      'common.txCount1': '1 movimiento',
      'common.txCountN': '{n} movimientos',
      'common.of': '{a} de {b}',
      'common.print': 'Imprimir estado de cuenta',
      'common.loading': 'Cargando…',

      'type.deposit': 'Depósito',
      'type.transfer_in': 'Recibido',
      'type.transfer_out': 'Enviado',
      'type.redemption': 'Canjeado',
      'type.fee': 'Comisión',
      'type.unknown': 'Tipo desconocido',
      'type.transfer_in.notPosted': 'Transferencia entrante',
      'type.transfer_out.notPosted': 'Envío solicitado',
      'type.redemption.notPosted': 'Canje solicitado',

      'cat.opening': 'Saldo inicial',
      'cat.deposits': 'Depósitos',
      'cat.transfers_in': 'Transferencias recibidas',
      'cat.transfers_out': 'Transferencias enviadas',
      'cat.redemptions': 'Canjes',
      'cat.fees': 'Comisiones',
      'cat.closing': 'Saldo final',
      'group.incoming': 'Entradas',
      'group.outgoing': 'Salidas y comisiones',

      'status.posted': 'Registrado',
      'status.pending': 'Pendiente',
      'status.failed': 'Fallido',
      'status.unknown': 'Estado desconocido',
      'status.notInBalance': 'No incluido en el saldo del estado de cuenta',

      'rail.internal': 'Interno (YES)',
      'rail.onchain': 'En cadena',
      'rail.other': 'Banco o tarjeta',

      'method.bank_transfer': 'Transferencia bancaria',
      'method.debit_card': 'Tarjeta de débito',
      'method.yes_transfer': 'Transferencia YES',
      'method.yes_payment': 'Pago YES',
      'method.network_send': 'Envío por red blockchain',
      'method.network_receive': 'Recepción por red blockchain',
      'method.bank_payout': 'Pago a banco',
      'method.fee': 'Comisión de servicio',

      'dir.in': 'Entrada',
      'dir.out': 'Salida',

      'term.statementBalance': 'Saldo del estado de cuenta',
      'term.tokenUnits': 'unidades de token',
      'term.asOf': 'Al {date}',
      'term.period': 'Período del estado de cuenta',
      'term.postedDate': 'Fecha de registro',
      'term.initiatedDate': 'Fecha de inicio',
      'term.dateBasisNote': 'Las fechas y los totales usan la fecha de registro.',
      'term.timezone': 'Horas mostradas en {tz}',

      'integrity.title': 'Este estado de cuenta está retenido',
      'integrity.body': 'Sus totales no cuadran, así que no mostramos saldos que podrían ser incorrectos. Nada en esta página se ha redondeado ni ajustado para ocultar la diferencia.',
      'integrity.routed': 'Se ha enviado para su corrección.',
      'integrity.routedSimulated': 'En producción, un estado de cuenta así se enviaría para su corrección. Esto es una vista previa de demostración, así que no se envió nada.',
      'integrity.simulated': 'Estás viendo una falla de integridad simulada (solo demostración).',
      'integrity.return': 'Volver al estado de cuenta de demostración válido',
      'integrity.checks': 'Controles de publicación',
      'integrity.pass': 'Superado',
      'integrity.fail': 'Fallido',
      'check.unique_ids': 'Cada movimiento tiene un identificador único',
      'check.precision': 'Los importes usan unidades mínimas exactas',
      'check.single_asset': 'Solo el activo del estado de cuenta está en el recorrido del saldo',
      'check.period_basis': 'Cada movimiento registrado está dentro del período (según fecha de registro)',
      'check.equation': 'El saldo inicial más los movimientos es igual al saldo final',
      'check.running_balance': 'Los saldos acumulados cuadran en orden cronológico',
      'check.categories': 'Las categorías del recorrido suman el cambio neto',
      'check.fee_links': 'Cada comisión está vinculada a su movimiento',
      'check.pending_excluded': 'Los movimientos pendientes se excluyen del saldo',

      'footer.demo': footerDemo,
      'footer.demoBase': 'Estado de cuenta de muestra con datos ilustrativos de demostración. No se usa información real de clientes, cuentas ni blockchain. El propio estado de cuenta no envía a ningún sitio nada de lo que hagas en esta página.',
      'footer.userwayNote': 'Si tienes conexión, la página también carga el widget de accesibilidad de UserWay, un servicio de terceros con sus propias condiciones de privacidad.',
      'footer.statementId': 'Estado de cuenta {id} · versión {version}',
      'footer.generated': 'Generado el {date}',
      'footer.disclosures': 'Divulgaciones',
      'footer.poweredBy': 'Estado de cuenta interactivo entregado a través de InfoSlips',

      'route.announce': 'Sección {view}',

      'noscript.heading': 'Estado de cuenta de YES — {period}',
      'noscript.ids': 'Estado de cuenta {id}, versión {version}. Cuenta {account}.',
      'noscript.times': 'Estado de cuenta al {asOf} · generado el {generated}.',
      'noscript.basis': 'Las fechas y los totales usan la fecha de registro. Las horas se muestran en {tz}.',
      'noscript.balances': 'Saldo inicial {opening}. Saldo final del estado de cuenta {closing}.',
      'noscript.posted': 'Movimientos registrados',
      'noscript.type': 'Tipo',
      'noscript.description': 'Descripción',
      'noscript.counterparty': 'Contraparte',
      'noscript.amount': 'Importe',
      'noscript.balanceAfter': 'Saldo después',
      'noscript.notInBalance': 'No incluido en el saldo del estado de cuenta',
      'noscript.pendingItem': '{date} — {description}: {amount} ({status})'
    }
  });

  /** "1 transaction" / "5 transactions" in the current language. */
  YES.txCount = function (n) {
    return n === 1 ? YES.t('common.txCount1') : YES.t('common.txCountN', { n: fmt.count(n) });
  };
})(typeof window !== 'undefined' ? window : globalThis);
