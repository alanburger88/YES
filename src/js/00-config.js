/*
 * YES Interactive Stablecoin Statement — configuration.
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
    /* Showcase mode: shows the "Illustrative demo data" badge, print watermark,
       local-only inquiry/AI/feedback behaviour and demo labels everywhere. */
    demo: true,

    /* Brand replacement slots (PRD 5.1). Values are placeholders, not YES assets. */
    slots: {
      // Replace with approved artwork: `svg` (SVG markup) or `src` (a data: image URI;
      // the file fetches nothing). Rendered by YES.ui.logoHtml().
      YES_LOGO: { text: 'YES', placeholder: true },
      YES_PRIMARY: '#0e5a8a',
      YES_PRIMARY_DARK: '#6cb4ee', // primary tuned for dark colour scheme
      YES_ACCENT: '#e8a33d',
      YES_FONT: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
      PRODUCT_NAME: { en: 'Example USD Stablecoin', es: 'Example USD Stablecoin' },
      ISSUER_OR_PARTNER: { en: '[Issuer or partner — pending YES approval]', es: '[Emisor o socio — pendiente de aprobación de YES]' },
      VIDEO_POSTER: null, // approved poster image (data URI or packaged asset) — placeholder SVG is drawn when null
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
