/*
 * YES Interactive Bank-Issued Digital Dollar Statement — configuration.
 *
 * Every brand, legal, support and integration value that YES must approve lives
 * here as a named replacement slot. The showcase ships with neutral placeholder
 * values; Phase B replaces them without touching feature code.
 */
(function (root) {
  'use strict';
  var YES = (root.YES = root.YES || {});

  YES.version = '1.0.0-showcase';

  YES.config = {
    /* Showcase mode: shows the footer demo notice, the print and PDF
       watermark, local-only inquiry/AI/feedback behaviour and the Illustrative
       labels. (The header's demo badge was removed on 2026-10-04.) */
    demo: true,

    /* Brand replacement slots (PRD 5.1). The YES logo, the USBC symbol,
       the colours and the typeface follow the YES brand book (v2, June 2026);
       the legal, partner and media slots are still placeholders. */
    slots: {
      /* Approved artwork: `svg` (SVG markup) or `src` (a data: image URI; the
         file fetches nothing), plus an optional `srcDark` for dark
         backgrounds, swapped with the colour scheme by CSS (print always uses
         `src`). Rendered by YES.ui.logoHtml(). A brand/<file> path is
         inlined from src/brand/ as a data: URI by build.mjs; unbuilt, the
         `text` placeholder shows instead. Never redraw, recolour or stretch. */
      YES_LOGO: { text: 'YES', src: 'brand/yes-logo-black.png', srcDark: 'brand/yes-logo-white.png' },
      /* The USBC symbol (brand book: wallets, transaction flows, balance
         displays), decorative beside text that already says USBC. Rendered
         by YES.ui.symbolHtml(); same `src` / `srcDark` rules as the logo. */
      USBC_SYMBOL: { src: 'brand/usbc-symbol-black.png', srcDark: 'brand/usbc-symbol-white.png' },
      YES_PRIMARY: '#000000', // primary actions on light (black); text and fills read tokens, see 00-tokens.css
      YES_PRIMARY_DARK: '#ffffff', // primary actions on dark (white)
      YES_ACCENT: '#0004ff', // YES accent blue: links, current and selected states, focus, key highlights
      YES_FONT: '"IBM Plex Sans", system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
      PRODUCT_NAME: { en: 'US Bank Coin', es: 'US Bank Coin' },
      ISSUER_OR_PARTNER: { en: '[Issuer or partner — pending YES approval]', es: '[Emisor o socio — pendiente de aprobación de YES]' },
      VIDEO_POSTER: null, // approved poster image (data URI); when null the player shows its own opening frame
      /* Approved recorded voiceover for "Your statement in 60 seconds", one per
         language, as data: audio URIs (e.g. data:audio/mpeg;base64,…) so the file
         still fetches nothing. When a language has one, the player plays it in
         sync with the animation; otherwise it narrates with the device's
         built-in voice (Web Speech API), and captions are always available. */
      VIDEO_VOICEOVER: { en: null, es: null },
      DISCLOSURES: {
        en: '[Approved YES disclosures appear here. Final wording for holdings, custody, issuance, reserves, redemption and protections requires YES legal approval.]',
        es: '[Aquí aparecerán las divulgaciones aprobadas por YES. La redacción final sobre tenencias, custodia, emisión, reservas, canje y protecciones requiere la aprobación legal de YES.]'
      }
    },

    /* Support destinations (PRD 5.9). 555-01xx numbers and example.com are reserved for fiction. */
    support: {
      phone: '+1 (555) 010-0142',
      email: 'help@example.com',
      hours: { en: 'Mon–Fri, 8 am–8 pm ET (placeholder)', es: 'Lun–vie, 8:00–20:00 ET (marcador de posición)' },
      chatAvailable: false,
      connected: false // production: true once secure destinations are approved
    },

    /* Locale tags used for number and date formatting. Change `es` to 'es-US'
       or 'es-MX' if the Spanish audience is in the Americas. */
    locales: { en: 'en-US', es: 'es-ES' },
    languages: ['en', 'es'],
    defaultLanguage: 'en',

    /* Feature flags: connected enhancements are explicit, never silent (PRD 2). */
    features: {
      liveAI: false, // production: governed AI service
      liveInquiry: false, // production: authenticated case-management service
      liveVideo: false, // production: approved video asset / rendering service
      analytics: false, // production: approved, minimised engagement measurement
      verifiedEvidence: false, // production: verified reserve / blockchain evidence
      liveBalance: false, // production: separate, timestamped live-balance area
      revealAccountId: false // deliberate reveal of identifiers requires approval
    },

    /*
     * Accessibility widget integration point (PRD 2, 5.8).
     * The official UserWay widget loads once, online only, with the supplied
     * account ID. If the InfoSlips viewer already injects UserWay centrally, set
     * `enabled: false` (or the loader detects the existing instance and skips),
     * so there is never a duplicate launcher. Loading instructions must be
     * confirmed with YES/InfoSlips before production.
     */
    userway: {
      enabled: true,
      accountId: 'B3W9A2mgGs',
      src: 'https://cdn.userway.org/widget.js',
      timeoutMs: 8000,
      /* Launcher corner, UserWay's data-position attribute:
         1 top right · 2 middle right · 3 bottom right · 4 bottom middle ·
         5 bottom left · 6 middle left · 7 top left · 8 top middle.
         Bottom left keeps it clear of the Ask YES drawer's close button
         (top right) and of Ask YES / Menu in the masthead. */
      position: 5
    },

    /* Reconciliation tolerance is zero: amounts are integer minor units. */
    reconciliation: { blockOnMismatch: true },

    /*
     * "From YES" promotions (What's new): content YES can change without code.
     * Rendered by the promos module (src/js/70-promos.js) on screen only: never
     * in print, the PDF, the CSV or the noscript summary. Everything here is
     * ILLUSTRATIVE and subject to YES approval; demo mode labels every
     * promotion "From YES" and "Illustrative".
     *
     * Each item:
     *   id          stable id, also the deep link #/whatsnew/<id>
     *   theme       identity | trust | currencies | interest
     *   priority    higher shows first on the Overview
     *   icon        a key of the shared icon set (YES.ui.icon)
     *   placements  where it may appear: overview (the What's new card),
     *               whatsnew (the tab), fees (note in the Fees card),
     *               txDetail (note in the transaction detail), assistant (Ask YES)
     *   rule        eligibility, evaluated against YES.data and YES.calc:
     *                 { kind: 'always' }
     *                 { kind: 'networkFeePaid', feeKind, min }  posted fees of that
     *                   kind this period total at least `min` minor units
     *                 { kind: 'trustBelow', level }  the customer's illustrative
     *                   trust level (statement.customer.trust) is below `level`
     *                 { kind: 'balanceAtLeast', amount }  closing balance ≥ amount
     *               An unknown kind is never eligible.
     *   copy        { en, es } per field: eyebrow, title, body, personal (shown
     *               only when eligible), note (one-line in-context note), cta,
     *               feature (the toast names it), footnote (optional),
     *               teaser (the one line inside the balance card, for the top
     *               update), hook (optional: the Overview card's headline when
     *               eligible, the customer's own figure) and support (the line
     *               under the hook; without it the body is used). Copy
     *               may use {fee}, {handle}, {sent}, {limit}, {level}, {next},
     *               {closing}: the module fills them from YES.calc and YES.fmt,
     *               never from typed numbers. Short sentences; no em dashes.
     *   handle      the example YES identity in the copy (illustrative)
     *   tiers       trust levels in order, with labels (trust theme)
     *   codes       planned currencies (currencies theme)
     * Interest copy never states a rate, APY or return and never projects
     * earnings; its footnote must say it is subject to regulatory approval.
     */
    promotions: {
      enabled: true,
      storageKey: 'yes.promos', // dismissed and seen ids, Ask YES opened; this browser only (localStorage)
      /* Where the Overview's "What's new from YES" card sits:
         'afterBalance'  below the balance card and its pending notice, before
                         the balance journey (approved plan, 2026-10-15). At
                         1280×900 the journey's heading then starts just below
                         the first screen while an update is shown.
         'afterJourney'  below the balance journey, so the balance and the
                         reconciliation keep the whole first screen (PRD 5.1:
                         a promotional module never displaces them). */
      overviewPosition: 'afterBalance',
      items: [
        {
          id: 'pay-identity',
          theme: 'identity',
          priority: 40,
          icon: 'send',
          placements: ['overview', 'whatsnew', 'fees', 'txDetail', 'assistant'],
          rule: { kind: 'networkFeePaid', feeKind: 'network_transfer', min: 1 },
          handle: 'yes.danielk',
          eyebrow: { en: 'New: YES identities', es: 'Novedad: identidades YES' },
          title: { en: 'Pay a YES identity', es: 'Paga a una identidad YES' },
          body: {
            en: 'Send to a YES identity, like {handle}, instantly and with no network fee.',
            es: 'Envía a una identidad YES, como {handle}, al instante y sin comisión de red.'
          },
          personal: {
            en: 'You paid {fee} in network fees this month sending to external wallets.',
            es: 'Este mes pagaste {fee} en comisiones de red por envíos a monederos externos.'
          },
          note: {
            en: 'Next time, pay a YES identity. No network fee.',
            es: 'La próxima vez, paga a una identidad YES. Sin comisión de red.'
          },
          teaser: {
            en: 'Pay a YES identity next time. No network fee.',
            es: 'La próxima vez, paga a una identidad YES. Sin comisión de red.'
          },
          hook: {
            en: 'You paid {fee} in network fees this month',
            es: 'Este mes pagaste {fee} en comisiones de red'
          },
          support: {
            en: 'Pay a YES identity, like {handle}, instantly and with no network fee.',
            es: 'Paga a una identidad YES, como {handle}, al instante y sin comisión de red.'
          },
          cta: { en: 'Find a YES identity', es: 'Busca una identidad YES' },
          feature: { en: 'YES identities', es: 'las identidades YES' },
          footnote: {
            en: '{handle} is an example handle. Network fees apply only when you send to a wallet outside YES.',
            es: '{handle} es un identificador de ejemplo. Las comisiones de red solo se aplican cuando envías a un monedero fuera de YES.'
          }
        },
        {
          id: 'trust',
          theme: 'trust',
          priority: 30,
          icon: 'shield-check',
          placements: ['overview', 'whatsnew', 'assistant'],
          rule: { kind: 'trustBelow', level: 'gold' },
          tiers: [
            { id: 'bronze', label: { en: 'Bronze', es: 'Bronce' } },
            { id: 'silver', label: { en: 'Silver', es: 'Plata' } },
            { id: 'gold', label: { en: 'Gold', es: 'Oro' } }
          ],
          eyebrow: { en: 'Progressive trust', es: 'Confianza progresiva' },
          title: { en: "You're at {level}", es: 'Estás en el nivel {level}' },
          body: {
            en: 'Verify your address to reach {next} and raise your monthly send limit.',
            es: 'Verifica tu dirección para llegar a {next} y aumentar tu límite mensual de envío.'
          },
          personal: {
            en: 'You sent {sent} this month. Your {level} limit is {limit} a month.',
            es: 'Este mes enviaste {sent}. Tu límite {level} es de {limit} al mes.'
          },
          note: {
            en: 'Verify your address to reach {next}.',
            es: 'Verifica tu dirección para llegar a {next}.'
          },
          teaser: {
            en: 'Verify your address to reach {next}.',
            es: 'Verifica tu dirección para llegar a {next}.'
          },
          hook: {
            en: 'You sent {sent} of your {limit} monthly limit',
            es: 'Enviaste {sent} de tu límite mensual de {limit}'
          },
          support: {
            en: 'Verify your address to reach {next} and raise your limit.',
            es: 'Verifica tu dirección para llegar a {next} y aumentar tu límite.'
          },
          cta: { en: 'Verify your address', es: 'Verifica tu dirección' },
          feature: { en: 'address verification', es: 'la verificación de dirección' },
          footnote: {
            en: 'Trust levels and limits shown here are illustrative.',
            es: 'Los niveles de confianza y los límites que se muestran son ilustrativos.'
          }
        },
        {
          id: 'currencies',
          theme: 'currencies',
          priority: 20,
          icon: 'globe',
          placements: ['overview', 'whatsnew', 'assistant'],
          rule: { kind: 'always' },
          codes: [
            { code: 'EUBC', name: { en: 'Euro', es: 'Euro' } },
            { code: 'UKBC', name: { en: 'British pound', es: 'Libra esterlina' } },
            { code: 'MXBC', name: { en: 'Mexican peso', es: 'Peso mexicano' } },
            { code: 'NZBC', name: { en: 'New Zealand dollar', es: 'Dólar neozelandés' } }
          ],
          eyebrow: { en: 'Coming soon', es: 'Próximamente' },
          title: { en: 'More currencies', es: 'Más monedas' },
          body: {
            en: 'Coming soon: hold EUBC, UKBC, MXBC and NZBC alongside USBC.',
            es: 'Próximamente: ten EUBC, UKBC, MXBC y NZBC junto a tus USBC.'
          },
          note: {
            en: 'More currencies are coming to YES.',
            es: 'Llegan más monedas a YES.'
          },
          teaser: {
            en: 'More currencies are coming: EUBC, UKBC, MXBC and NZBC.',
            es: 'Llegan más monedas: EUBC, UKBC, MXBC y NZBC.'
          },
          cta: { en: 'Notify me', es: 'Avísame' },
          feature: { en: 'currency updates', es: 'las novedades de monedas' },
          footnote: {
            en: 'Planned currencies are subject to regulatory approval.',
            es: 'Las monedas previstas están sujetas a aprobación regulatoria.'
          }
        },
        {
          id: 'interest',
          theme: 'interest',
          priority: 10,
          icon: 'percent',
          placements: ['overview', 'whatsnew', 'assistant'],
          rule: { kind: 'balanceAtLeast', amount: 1 },
          eyebrow: { en: 'Coming soon', es: 'Próximamente' },
          title: { en: 'Interest on USBC', es: 'Intereses en USBC' },
          body: {
            en: 'Coming soon: earn interest on your USBC balance.',
            es: 'Próximamente: gana intereses sobre tu saldo en USBC.'
          },
          personal: {
            en: 'Your statement balance: {closing}.',
            es: 'Saldo de tu estado de cuenta: {closing}.'
          },
          note: {
            en: 'Interest on USBC is coming soon.',
            es: 'Pronto llegan los intereses en USBC.'
          },
          teaser: {
            en: 'Interest on USBC is coming soon.',
            es: 'Pronto llegan los intereses en USBC.'
          },
          cta: { en: 'Notify me', es: 'Avísame' },
          feature: { en: 'interest updates', es: 'las novedades sobre intereses' },
          footnote: {
            en: 'Subject to regulatory approval. Rates and terms to be confirmed.',
            es: 'Sujeto a aprobación regulatoria. Tasas y condiciones por confirmar.'
          }
        }
      ]
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
