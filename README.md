# YES Interactive Stablecoin Statement — Phase A showcase

A YES-branded, mobile-first statement that tells the account story instead of printing a long ledger. In about 30 seconds a customer can see their closing stablecoin balance, what changed during the period, and where to look into any single movement. Every number traces back to a transaction, and there is a direct route to ask for help.

**Deliverable:** [`dist/yes-statement.html`](dist/yes-statement.html), one self-contained HTML file. It includes the styles, logic, English and Spanish copy, accessible graphics and fictional statement data. Open it straight from disk with no server and no network connection.

> **Illustrative demo data.** The customer, account, amounts, references, blockchain and reserve details are all invented. Nothing you do in the file is sent anywhere by the statement itself. When you are online, the page also loads the third-party UserWay accessibility widget (see below).
>
> The page header no longer shows an "Illustrative demo data" badge (product owner decision, 2026-10-04; see [Demo labels](#demo-labels)). The footer notice, the document title, the print and PDF watermarks and the "Illustrative" tags still mark the fictional data.

## Try it

1. Open `dist/yes-statement.html` in a current browser (Chrome, Edge, Safari or Firefox). Double-clicking the file works.
2. Follow the PRD walkthrough:
   1. Read the closing balance on **Overview**.
   2. In the balance journey, select **Outgoing transfers**. The matching transactions slide into view.
   3. Open one transaction and choose **Explain with AI**.
   4. Choose **Ask about this transaction** and complete the demo inquiry. Its confirmation says *Demo only — no inquiry was sent*.
   5. Switch to **Español** in the header (on a phone, open **Menu**). The header is the only language switch: a dialog keeps the language chosen before it opened, so close it first. You stay in the same section, with the same filters, selected transaction, inquiry draft and assistant conversation.
   6. Under **Understand**, look at the illustrative transparency panel.
   7. Choose **Download or print** in the header. It opens the **Download or print** section, where you can print the statement of record, download it as a PDF, or export a CSV.
   8. Try the **Dark mode** toggle in the header (on a phone, in **Menu**).

To see the reconciliation guard at work, open `dist/yes-statement.html#/overview?simulate=mismatch`, or use the link under **Help → Statement integrity**. It loads a copy of the data with one amount changed by 0.01. The statement is withheld instead of shown with numbers that don't reconcile.

## What is in the file

| PRD area | Where |
| --- | --- |
| 5.1 Header and brand system | Masthead (logo slot, period, language switch, light/dark toggle, **Download or print**, Ask YES), one row at every width. On phones it keeps the logo, period, Ask YES and a **Menu** whose dropdown holds the four sections, Download or print, the language switch and the light/dark toggle. Statement details panel, replacement slots in `src/js/00-config.js` |
| 5.2 Interactive balance journey (signature) | Overview: bridge from opening to closing balance, selectable steps that list their contributing transactions, an equation and table equivalent, and a running-balance chart with a text alternative |
| 5.3 Transaction explorer and query | Transactions: search with highlighting, combined filters, sorting with an explicit date basis, table and mobile cards, detail dialog, CSV export (complete and current view), print |
| 5.4 Transaction inquiry | Multi-step demo inquiry started from a transaction: validation, review, a confirmation that nothing was sent, and the draft is kept |
| 5.5 AI assistant drawer | Ask YES drawer (docked on desktop, sheet on mobile) with deterministic, statement-grounded demo explanations, supporting rows, feedback and a route to a person |
| 5.6 Stablecoin understanding and transparency | Understand: seven explanations, statement vs live balance, an illustrative on-chain reference, an illustrative reserve panel |
| 5.7 Personalized video | “Your statement in 60 seconds”: an animated player drawn in the page that follows the storyboard, with play/pause, narration, captions and a transcript. Its figures come from the statement. It never autoplays. |
| 5.8 Language, accessibility, comfort | Full EN/ES with one language switch, in the header. Locale formatting, WCAG 2.2 AA patterns and reduced motion. A light/dark mode starts from the device setting and remembers the visitor's choice in this browser. Print and PDF always stay light. UserWay integration point, launcher bottom left |
| 5.9 Help, feedback, statement record | Help: contact placeholders, session-only feedback, **Download or print** (print the statement of record, download it as a PDF, export CSV, record facts), integrity checks, accessibility status, about this demo |
| 6 Data and reconciliation rules | `src/js/01-data.js` (integer minor units) and `src/js/02-calc.js`. The release gate runs in the browser and also in `build.mjs`, which refuses to build a statement that doesn't reconcile. |

### Illustrative figures

1,000.00 opening + 500.00 deposits + 200.00 incoming transfers − 450.00 outgoing transfers − 100.00 redemptions − 2.50 fees = **1,147.50 closing token units (EXUSD)**.

- There are 15 posted transactions and 1 pending redemption. The pending one is listed, but it never counts toward the balance.
- One deposit was started in the previous period and posted in this one. It shows how the posted-date basis works.
- Fees are separate, linked ledger lines.
- Exactly one transaction carries the sample on-chain reference. It is labelled *Illustrative reference — no live blockchain verification* and doesn't link to any explorer.

## Demo labels

PRD §4.1 asked for a visible **Illustrative demo data** badge on the first screen. On 2026-10-04 the product owner removed it from the header: both the inline badge (English, wide screens) and the slim full-width band (Spanish and narrower screens). This frees room in the header's single row. The full **Download or print** label now shows from 880px wide and the full language names from 992px, the same in every language (both used to need 1088px). On phones the header is one row under 60px tall, all of it pinned.

The fictional data is still marked:

- the demo notice in the footer
- the document title (“… · Illustrative demo”)
- the *ILLUSTRATIVE DEMO DATA* line shown when JavaScript is off
- the watermark on the printed statement of record and on every PDF page
- the *Illustrative* tags on the fictional rate, the blockchain reference, the reserve panel and the transaction detail
- the demo tags inside sections, such as Help's

## Download or print, PDF and light/dark

- **Download or print.** The header button, or the Menu item on phones, opens the record section of Help. It holds the statement-record facts with Print, Download PDF and the CSV exports.
- **PDF.** The PDF is built in the browser by a small PDF 1.4 writer (`src/js/07-pdf.js`), with no library and no network. It downloads in one click (e.g. `YES-statement-<id>-DEMO.pdf`). Every page of the statement of record carries a demo watermark. The text is real and selectable, set in the standard Helvetica fonts with exact widths, so amounts align.
- **Light/dark.** The page starts from the device setting and follows it until the visitor uses the toggle. The choice is then remembered in this browser (`localStorage`, key `yes.theme`; if storage is blocked, the page still works). Print and PDF always use the light scheme.

## Connected enhancements (network required, never blocking)

| Enhancement | In this file |
| --- | --- |
| UserWay accessibility widget | Loads once, online only, with account **B3W9A2mgGs** (`YES.config.userway`). The launcher sits in the bottom-left corner (`position: 5`, UserWay's `data-position`), clear of the Ask YES drawer's close button. If it can't load, the page says so and keeps working. If the host viewer already provides UserWay, the file doesn't add a second launcher. |
| Governed AI | Not connected. Explanations are computed locally and labelled *Demo explanation*. |
| Inquiry or case management | Not connected. It is a complete local mock. |
| Personalized video | The player runs offline: it draws the animation in the page and narrates with an approved recorded voiceover if one is configured, otherwise with the device's built-in voice. An approved video asset or rendering service is a Phase B connection. |
| Feedback and analytics | Feedback stays in session memory only. There is no analytics. |
| Reserve and blockchain evidence | Illustrative layout only. Nothing is asserted. |
| Live balance | Not connected. A separate area marks where it would go. |

## Configure

All brand, legal, support and integration values live in `src/js/00-config.js`:

- **Brand and legal slots:** `YES_LOGO`, `YES_PRIMARY`, `YES_ACCENT`, `YES_FONT`, `PRODUCT_NAME`, `ISSUER_OR_PARTNER`, `VIDEO_POSTER`, `VIDEO_VOICEOVER` and `DISCLOSURES`. For the logo, set `YES_LOGO.svg` to approved SVG markup, or `YES_LOGO.src` to a `data:` image. Until then, a text placeholder is shown. The shared helper `YES.ui.logoHtml()` renders the slot.
- **Video voiceover:** `VIDEO_VOICEOVER = { en, es }` holds the approved recorded narration for “Your statement in 60 seconds”, one per language, as `data:` audio URIs (for example `data:audio/mpeg;base64,…`), so the file still fetches nothing. When the current language has one, the player plays it in step with the animation. Otherwise (`null`, the default) it narrates with the device's built-in voice (Web Speech API). Captions and the transcript are available either way.
- **Support destinations:** fictional placeholders for now.
- **Feature flags**
- **Locale tags:** Spanish defaults to `es-ES` formatting. Change it to `es-US` or `es-MX` for audiences in the Americas.
- **UserWay integration point:** confirm with InfoSlips whether the viewer injects the widget centrally. If it does, set `enabled: false`. `position` picks the launcher's corner. The values are UserWay's `data-position` codes: 1 top right, 2 middle right, 3 bottom right, 4 bottom middle, 5 bottom left (the default here), 6 middle left, 7 top left, 8 top middle.

The statement data lives in `src/js/01-data.js`.

## Recorded voiceover (ElevenLabs)

The narration for “Your statement in 60 seconds” can be a recorded female voice made once with ElevenLabs and kept inside the file, so the statement never calls ElevenLabs and works offline. Until a recording exists, the device's built-in voice narrates.

```bash
# Key: add it as an API credential on the cloud environment (host api.elevenlabs.io,
# header xi-api-key, no prefix) so the session never sees it — or, locally:
# export ELEVENLABS_API_KEY=…   (never written to any file)
node build.mjs                                                 # the generator reads the player's script from dist/
node scripts/voiceover.mjs check                               # offline: spoken lines match every caption
node scripts/voiceover.mjs voices                              # the account's female voices
node scripts/voiceover.mjs samples --voices <id1>,<id2>,<id3>  # short English + Spanish samples in .cache/samples/
node scripts/voiceover.mjs record --voice <id>                 # English and Spanish → src/media/
node scripts/voiceover.mjs restamp                             # re-stamp fingerprints, no re-recording
node build.mjs                                                 # packages the recordings into the file
```

- **What gets spoken:** `scripts/voiceover-script.json` holds one line per caption, in both languages. Each line uses the caption's words, with amounts and dates written out so they're read exactly. The generator refuses to record if a line no longer matches its caption.
- **Staying in step:** each line is recorded separately, with its neighbouring lines passed as context so the delivery flows. It is placed at its caption's start time and the track is levelled. A line that runs slightly long is sped up by at most 15%. Anything longer fails, so the cue can be retimed instead.
- **Model and format:** `eleven_multilingual_v2`, with the same voice for English and Spanish. The result is a mono 64 kbps MP3, about 0.5 MB per language.
- **Outdated recordings are never played:** each recording carries the fingerprint of the script it was made for (`YES.overview.video.scriptHash()`). The fingerprint is built from the statement's facts (name, ISO dates, raw amounts) and the caption templates, never from formatted text, so every browser computes the same value. If the figures or wording change, the player ignores the outdated recording, uses the device voice and warns in the console. To fix that, run `record` again. If only the fingerprint method changes, run `restamp` instead: it re-stamps the existing audio after checking every caption still matches its recorded line.
- **Diagnostics:** `YES.overview.video.state().recording` is `ready`, `stale` (made for another script), `failed` (the audio can't play here) or `none`, and `state().mode` shows what is narrating (`recorded`, `voice` or `none`). If the browser blocks sound until a fresh tap, the video pauses and the next press of Play tries the recording again. It doesn't fall back to the device voice.
- **Network:** an API credential for `api.elevenlabs.io` also lets the session reach that host. Without one, the environment must allow it under Custom network access. Generated lines are cached in `.cache/voiceover/`, which is not committed, so a re-run doesn't spend credits on unchanged lines.

## Build and test

```bash
npm install          # playwright (preinstalled Chromium) + axe-core, dev only
npm run build        # → dist/yes-statement.html (release gate + inline everything, comments stripped)
node build.mjs --no-minify   # same, with the sources inlined verbatim (debugging)
npm test             # build, then every browser test offline (desktop + mobile)
```

The test runner blocks all network access. The only request the file is expected to attempt is UserWay. Any console error fails a test, and tests include axe-core WCAG checks and screenshots (`test-results/screens/`). The PDF tests check the generated files with the poppler tools `pdfinfo`, `pdftotext` and `pdftoppm` (package `poppler-utils`).

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
