# YES Interactive Stablecoin Statement — Phase A showcase

A YES-branded, mobile-first statement that tells the account story instead of printing a long ledger. In about 30 seconds a customer can see their closing stablecoin balance, what changed during the period, and where to look into any single movement. Every number traces back to a transaction, and there is a direct route to ask for help.

**Deliverable:** [`dist/yes-statement.html`](dist/yes-statement.html), one self-contained HTML file. It includes the styles, logic, English and Spanish copy, accessible graphics and fictional statement data. Open it straight from disk with no server and no network connection.

> **Illustrative demo data.** The customer, account, amounts, references, blockchain and reserve details are all invented. Nothing you do in the file is sent anywhere.

## Try it

1. Open `dist/yes-statement.html` in a current browser (Chrome, Edge, Safari or Firefox). Double-clicking the file works.
2. Follow the PRD walkthrough:
   1. Read the closing balance on **Overview**.
   2. In the balance journey, select **Outgoing transfers**. The matching transactions slide into view.
   3. Open one transaction and choose **Explain with AI**.
   4. Choose **Ask about this transaction** and complete the demo inquiry. Its confirmation says *Demo only — no inquiry was sent*.
   5. Switch to **Español**. You stay in the same section, with the same filters and the same open transaction.
   6. Under **Understand**, look at the illustrative transparency panel.
   7. Print the statement, or export a CSV, from **Transactions** or **Help**.

To see the reconciliation guard at work, open `dist/yes-statement.html#/overview?simulate=mismatch`, or use the link under **Help → Statement integrity**. It loads a copy of the data with one amount changed by 0.01. The statement is withheld instead of shown with numbers that don't reconcile.

## What is in the file

| PRD area | Where |
| --- | --- |
| 5.1 Header and brand system | Masthead (logo slot, period, demo badge, language switcher, Ask YES), statement details panel, replacement slots in `src/js/00-config.js` |
| 5.2 Interactive balance journey (signature) | Overview: bridge from opening to closing balance, selectable steps that list their contributing transactions, an equation and table equivalent, and a running-balance chart with a text alternative |
| 5.3 Transaction explorer and query | Transactions: search with highlighting, combined filters, sorting with an explicit date basis, table and mobile cards, detail dialog, CSV export (complete and current view), print |
| 5.4 Transaction inquiry | Multi-step demo inquiry started from a transaction: validation, review, a confirmation that nothing was sent, and the draft is kept |
| 5.5 AI assistant drawer | Ask YES drawer (docked on desktop, sheet on mobile) with deterministic, statement-grounded demo explanations, supporting rows, feedback and a route to a person |
| 5.6 Stablecoin understanding and transparency | Understand: seven explanations, statement vs live balance, an illustrative on-chain reference, an illustrative reserve panel |
| 5.7 Personalized video | “Your statement in 60 seconds” placeholder card and storyboard. It never autoplays. |
| 5.8 Language, accessibility, comfort | Full EN/ES, locale formatting, WCAG 2.2 AA patterns, reduced motion, dark scheme, UserWay integration point |
| 5.9 Help, feedback, statement record | Help: contact placeholders, session-only feedback, statement record, integrity checks, accessibility status, about this demo, a print view of the statement of record |
| 6 Data and reconciliation rules | `src/js/01-data.js` (integer minor units) and `src/js/02-calc.js`. The release gate runs in the browser and also in `build.mjs`, which refuses to build a statement that doesn't reconcile. |

### Illustrative figures

1,000.00 opening + 500.00 deposits + 200.00 incoming transfers − 450.00 outgoing transfers − 100.00 redemptions − 2.50 fees = **1,147.50 closing token units (EXUSD)**.

- There are 15 posted transactions and 1 pending redemption. The pending one is listed, but it never counts toward the balance.
- One deposit was started in the previous period and posted in this one. It shows how the posted-date basis works.
- Fees are separate, linked ledger lines.
- Exactly one transaction carries the sample on-chain reference. It is labelled *Illustrative reference — no live blockchain verification* and doesn't link to any explorer.

## Connected enhancements (network required, never blocking)

| Enhancement | In this file |
| --- | --- |
| UserWay accessibility widget | Loads once, online only, with account **B3W9A2mgGs** (`YES.config.userway`). If it can't load, the page says so and keeps working. If the host viewer already provides UserWay, the file doesn't add a second launcher. |
| Governed AI | Not connected. Explanations are computed locally and labelled *Demo explanation*. |
| Inquiry or case management | Not connected. It is a complete local mock. |
| Personalized video | Placeholder and storyboard only |
| Feedback and analytics | Feedback stays in session memory only. There is no analytics. |
| Reserve and blockchain evidence | Illustrative layout only. Nothing is asserted. |
| Live balance | Not connected. A separate area marks where it would go. |

## Configure

All brand, legal, support and integration values live in `src/js/00-config.js`:

- **Brand and legal slots:** `YES_LOGO`, `YES_PRIMARY`, `YES_ACCENT`, `YES_FONT`, `PRODUCT_NAME`, `ISSUER_OR_PARTNER`, `VIDEO_POSTER` and `DISCLOSURES`.
- **Support destinations:** fictional placeholders for now.
- **Feature flags**
- **Locale tags:** Spanish defaults to `es-ES` formatting. Change it to `es-US` or `es-MX` for audiences in the Americas.
- **UserWay integration point:** confirm with InfoSlips whether the viewer injects the widget centrally. If it does, set `enabled: false`.

The statement data lives in `src/js/01-data.js`.

## Build and test

```bash
npm install          # playwright (preinstalled Chromium) + axe-core, dev only
npm run build        # → dist/yes-statement.html (release gate + inline everything)
npm test             # build, then every browser test offline (desktop + mobile)
```

The test runner blocks all network access. The only request the file is expected to attempt is UserWay. Any console error fails a test, and tests include axe-core WCAG checks and screenshots (`test-results/screens/`).

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the module contract and [`docs/PRD.md`](docs/PRD.md) for the requirements.

## Phase B (production) — not in this file

Phase B replaces the fictional data and brand tokens, approves terminology, disclosures and Spanish copy, and connects:

- secure inquiry and case management
- governed AI
- an approved video asset
- verified evidence
- analytics
- InfoSlips delivery, access control and archive

Launch also requires security and privacy review, legal and issuer/custody approval, an accessibility review, Spanish language review, device performance testing and statement-data sign-off. Don't reuse this showcase with real data until those gates pass.
