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
    reconciliation: { blockOnMismatch: true }
  };
})(typeof window !== 'undefined' ? window : globalThis);
