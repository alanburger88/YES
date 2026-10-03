# YES Interactive Stablecoin Statement — Product Requirements Document

**Status:** Draft for concept and implementation planning  
**Date:** 3 October 2026  
**Product owner:** YES (to be assigned)  
**Reference:** [Current InfoSlips statement](https://viewer.infoslips.us/#/link/9EFFA82B6C0AE46F2A74DAFFD6F8156E0CE14A805769DDF7C057EC717806FD28/0)

## 1. Product vision

Create a YES-branded, mobile-first statement that feels like a clear account story rather than a long ledger. Within 30 seconds, a customer should understand their closing stablecoin balance, what changed during the period, and where to investigate a particular movement. Deeper layers should make every number traceable to transactions and give the customer a direct route to ask for help.

The **showcase** is one distributable HTML file containing its own styles, logic, English and Spanish copy, accessible graphics, and fictional statement data. Its core statement experience works without a network connection. The **production** version uses the same interaction model with verified YES data, approved brand and legal language, secure services, and InfoSlips delivery and measurement.

The signature interaction is an **interactive balance journey**. A customer starts with the opening balance, sees how credits and debits produce the closing balance, and can select any step to reveal its contributing transactions. Motion should help explain the arithmetic and never be required to understand it.

### Desired outcomes

1. Make the statement understandable at a glance and reconcilable down to the transaction.
2. Help customers find, interpret, and inquire about an individual transaction without leaving the statement.
3. Show the potential of InfoSlips personalization, interactivity, governed assistance, accessibility, localization, and engagement insight.
4. Build trust by distinguishing the statement-of-record snapshot from live account data, illustrative content, and any externally verified facts.

## 2. Decisions and boundaries

| Decision | Requirement |
| --- | --- |
| Brand | YES is the customer-facing crypto-services brand. Use configurable placeholders for logo, colors, typography, voice, imagery, product name, and partner marks. Do not imply YES is a bank, issuer, or custodian until approved. |
| Demo asset | One HTML file, including sample data and both locales. No CDN, framework, API, external font, or media request is needed for the core experience. |
| Demo product | A **fictional USD stablecoin**. All sample balances, transaction references, reserve panels, and blockchain details are visibly marked **Illustrative demo data**. Use no real customer's personal or account data. |
| Transaction query | Search and filters are functional in the showcase. Natural-language transaction queries are a possible later enhancement, separate from the requested AI explanation feature. |
| AI | A right-side assistant drawer and “Explain with AI” entry points use curated, local, statement-aware demo answers. Production connects to an approved, governed AI service. |
| Inquiry | The showcase contains a complete local mock inquiry flow. Its confirmation clearly states that nothing was sent. Production connects to a secure case-management workflow. |
| Video | Provide a personalized-video placement, poster, and storyboard placeholder. No autoplay or fabricated finished video. |
| Accessibility | Use the official UserWay widget with the supplied account ID **B3W9A2mgGs** when online. Specify the integration point; do not reproduce or invent a script snippet. The underlying SPA must remain accessible when the widget cannot load. |

**Meaning of “self-contained.”** The record, navigation, visualizations, local explanations, language switcher, search, filters, and demo inquiry flow work from the single file. UserWay, a future live AI service, live video, support submission, analytics, and verified external evidence are connected enhancements that require network access. Their unavailable states must be explicit and must not break the statement.

## 3. What the current statement teaches us

The linked InfoSlip already provides a personalized greeting, summary, detailed deposit-account ledger, fee summary, transaction inquiry checkboxes, contact options, a virtual-assistant invitation, feedback, and UserWay. These are useful foundations. The new experience should retain the essential statement facts and improve how people navigate and understand them.

| Observation in the reference | Product response |
| --- | --- |
| The summary shows an ending balance of **$35.08**, while the account page says “Total Balance of **$1.00**.” | Use one canonical statement data object and block release when displayed totals fail reconciliation. |
| The shown statement start date is **25 May 2026**, while some ledger entries are dated **24 May 2026**. | Define transaction, effective, posting, and period dates; label prior-period or opening-balance entries accurately. |
| The mobile summary requires horizontal scrolling to see all columns. | Use a compact balance card and tappable journey on narrow screens; show transaction details as stacked cards. |
| The generic online-banking promotion dominates part of the summary. | Replace it with concise, relevant stablecoin education and a customer-specific insight only when supported by data. |
| Inquiry requires selecting ledger checkboxes before using a separate action. | Put “Ask about this transaction” in each detail view, with a clear multi-step flow and reference number. |
| The assistant is introduced on the contact page. | Make contextual help available at the point of confusion through a persistent but unobtrusive drawer and “Explain with AI” controls. |
| The directly opened statement page has an unrelated browser title, and the details page displays a change-request confirmation before a change is made. | Validate metadata and show success messages only after the corresponding action succeeds. |

The reference link contains personal statement information. It is a design reference only; the showcase must use invented names, accounts, addresses, amounts, and transaction identifiers.

## 4. Customer journey and information architecture

### First screen: calm, useful, personal

1. YES placeholder brand, statement period, language switcher, accessible navigation, and a visible **Illustrative demo data** badge in the showcase.
2. A warm handshake paragraph that names the period and invites exploration without marketing claims.
3. The closing stablecoin balance in **token units**, with an optional USD equivalent only if a rate, source, and timestamp are available. Show the statement's “as of” time.
4. The balance journey: opening balance → incoming activity → outgoing activity and fees → closing balance. Each step opens its contributing transactions.
5. Two clear actions: **Explore transactions** and **Explain this balance**. A personalized-video card sits below the essential facts, not above them.

Suggested English handshake:

> Hello, [first name]. Here is your YES activity for [statement period]. Start with the highlights, then explore any movement you would like to understand. If something does not look right, we are here to help.

Suggested Spanish handshake, subject to native-language review:

> Hola, [nombre]. Aquí tienes tu actividad de YES del [período]. Empieza por lo esencial y explora cualquier movimiento que quieras entender mejor. Si algo no te cuadra, estamos aquí para ayudarte.

### Progressive uncover

| Layer | Customer sees | Interaction |
| --- | --- | --- |
| 1. Snapshot | Period, closing balance, concise change summary | Choose a balance-journey step or “Explore transactions” |
| 2. Why it changed | Incoming/outgoing categories and a running-balance chart | Open the transactions behind a category or a point in time |
| 3. Transaction | Dates, type, amount, running balance, status, fees, rail, counterparty label, references | Explain, copy an appropriate reference, or start an inquiry |
| 4. Trust and help | Stablecoin terms, statement versus live balance, illustrative on-chain/reserve panels | Read evidence when available, ask AI, or contact support |

Navigation should offer **Overview**, **Transactions**, **Understand**, and **Help**. These are views of the same statement snapshot, not separate account balances. Deep links may open a specific transaction or section in production, subject to access control; the single-file demo may use local anchors or hash routes.

## 5. Functional requirements

### 5.1 Statement header and brand system — P0

- Define replacement slots for `[YES_LOGO]`, `[YES_PRIMARY]`, `[YES_ACCENT]`, `[YES_FONT]`, `[PRODUCT_NAME]`, `[ISSUER_OR_PARTNER]`, contact details, disclosures, video poster, and support destinations.
- Show statement ID, period start/end, generation time, timezone, and “statement as of” time in a secondary details panel. Mask account or wallet identifiers by default; allow deliberate reveal only if approved.
- Keep core labels factual: “statement balance,” “incoming,” “outgoing,” “fees,” and “transaction status.” Final legal terminology for holdings, custody, issuance, reserves, redemption, and protections requires YES approval.
- Separate any promotional or educational content from statement facts. Never let a promotional module displace the balance and reconciliation on the first screen.

### 5.2 Interactive balance journey — P0, signature feature

- Render a responsive balance bridge showing opening balance, categorized credits, categorized debits, fees, and closing balance. Values are exact token quantities, with a consistent decimal policy defined per asset.
- Selecting a step filters the transaction explorer to exactly the transactions that produced that step. A back or “Clear filter” action restores the full ledger.
- Provide a text/table equivalent that states the same arithmetic. Animated transitions are short, optional, and suppressed under reduced-motion preferences.
- Include a running-balance line or step chart only when dates and balances are reliable. A low-data state should use a simple list instead of an empty or misleading chart.
- Show an exception message and suppress publication if the opening balance plus signed movements does not equal the closing balance. Do not visually “fix” a mismatch through rounding or animation.

**Illustrative demo equation:** 1,000.00 opening + 500.00 deposits + 200.00 incoming transfers − 450.00 outgoing transfers − 100.00 redemptions − 2.50 fees = **1,147.50 closing token units**. Every displayed category must have underlying sample transactions whose exact amounts sum to that value.

### 5.3 Transaction explorer and query — P0

- Search description, counterparty label, type, status, and permitted reference fields. Highlight the matching field and show a result count.
- Filter by date range, incoming/outgoing, transaction type, status, rail (internal/on-chain/other), and amount range. Support combined filters, clear all, and a meaningful zero-results state.
- Sort by transaction date, effective/posted date, amount, and newest/oldest. Make the active date basis clear.
- Offer a compact desktop table and readable mobile cards. The transaction detail shows signed amount, asset/unit, relevant dates and timezone, running balance, fee breakdown, status, reference, and explanatory notes. Show blockchain network, transaction hash, confirmations, and explorer link only when they apply and are verified.
- Use customer-friendly labels such as “Sent,” “Received,” “Deposit,” “Redeemed,” and “Fee,” while retaining the canonical event type in the data model. Unknown or pending states must be shown explicitly.
- Allow a complete-record export and a current-filter CSV export in the demo. Print styling should produce a readable statement with all mandatory facts and a clear demo watermark. Production exports must use approved formats and controls.

### 5.4 Transaction inquiry — P0

- Start from a transaction detail, carry the transaction reference into the inquiry, then collect reason, optional description, and a preferred response channel. Show a review step before mock submission.
- The demo confirmation must say **“Demo only — no inquiry was sent”** and may issue a clearly fictional local reference. Do not request real contact details or imply a service case exists.
- Provide an accessible error state for missing fields and a way back to the selected transaction without losing the draft.
- Production must submit through an authenticated, auditable service; provide a genuine case ID/status, prevent duplicates, redact sensitive fields from analytics, and distinguish inquiry from a formal dispute or fraud report. Formal dispute/fraud routes require approved policy and timing copy.

### 5.5 AI assistant drawer and “Explain with AI” — P0 demo / P1 live

- A persistent **Ask YES** control opens a right-side drawer on desktop and a full-screen sheet on small screens. It must not cover the core balance without a clear close control. Escape closes it; focus moves into the drawer and returns to the trigger.
- “Explain with AI” is available on the balance journey, each transaction, fees, and stablecoin education. It opens the drawer with the selected fact in context, then gives a concise explanation and links back to the exact supporting rows.
- The offline showcase uses deterministic, curated responses computed from embedded sample data. Label these **Demo explanation** inside the drawer; do not imply that a live model produced them. Include suggested questions and a fallback when a question is outside the supported set.
- Production answers must be grounded in the immutable statement snapshot and approved help content; show the figures and transactions used, refuse to invent missing facts, and distinguish statement data from live data. Do not provide investment advice, guarantee a peg, initiate transactions, or claim reserve/custody facts without approved evidence.
- Provide language-matched answers, “Was this helpful?” feedback, a human-help route, privacy notice, and a governed audit trail. Define data retention, model/provider, permitted fields, and escalation policy before launch.

### 5.6 Stablecoin understanding and transparency — P0 demo / P1 verified data

- Include short expandable explanations for **token units**, **USD equivalent**, **on-chain versus internal transfer**, **transaction status**, **fees**, **redemption**, and **statement versus live balance**. The product-specific wording remains configurable.
- Show a sample on-chain reference in one fictional transaction, labeled **Illustrative reference — no live blockchain verification**. Do not link a fake reference to a real explorer.
- Provide an illustrative reserve/transparency panel that shows where an approved issuer, reserve report, attestation date, redemption terms, and source link would appear. The demo panel must say **Illustrative layout; no reserve assertion**.
- In production, display only verified facts with source, date, responsible entity, and an external-link warning where appropriate. If evidence is absent or stale, hide the claim and explain that the information is unavailable.

### 5.7 Personalized video — P1

- Reserve a modest card titled “Your statement in 60 seconds” with a YES-branded poster placeholder, play control, duration, and a short description. It must be optional and never autoplay.
- The placeholder storyboard: personal greeting → opening and closing balance → largest meaningful movement → how to inspect a transaction → where to get help. All figures must come from the same statement snapshot.
- Production requires an approved video asset or rendering service, captions, transcript, pause controls, localization, and a static fallback. If the video cannot load, the written statement remains complete.

### 5.8 Language, accessibility, and comfort — P0

- Ship complete English and Spanish UI strings in the single file. Switching language preserves current section, filters, and selected transaction. Localize dates, number separators, support copy, explanations, and inquiry form. Never machine-translate unapproved legal text at runtime.
- Target [WCAG 2.2 AA](https://www.w3.org/WAI/standards-guidelines/wcag/) through semantic structure, keyboard operation, visible focus, descriptive controls, sufficient contrast, text alternatives for every chart, readable zoom/reflow, and screen-reader announcements for filter results and inquiry confirmation.
- Integrate the official UserWay widget once, using account ID **B3W9A2mgGs** and YES/InfoSlips-approved loading instructions. The PRD intentionally contains no widget script. Avoid a duplicate launcher if InfoSlips already supplies the widget in its viewer.
- Support reduced motion. Avoid using color alone to distinguish incoming/outgoing activity. Video requires captions and transcript when supplied. The widget augments an accessible base experience; it is not the accessibility implementation.

### 5.9 Help, feedback, and statement record — P1

- Include contextual contact/help options and a brief feedback prompt about clarity. The demo records feedback only in local session state and says so. Production routes it to an approved feedback service.
- Mark the record as a period snapshot. If production also shows live balance or current transaction status, place it in a clearly separate, timestamped area. Never silently mutate a previously issued statement.
- Provide statement ID/version and an approved downloadable/printable statement-of-record view. Define retention, archival, and correction handling with YES and InfoSlips before live use.

## 6. Data and content contract

The showcase should embed a small, internally consistent data object. Production should map the same logical fields from an authoritative source. At minimum:

| Entity | Required fields |
| --- | --- |
| Statement | ID, version, period start/end, generation timestamp/timezone, language, account display name, masked identifier, product/asset ID, opening and closing quantities, issue/correction status |
| Asset | Display name, symbol, precision, unit label; optional verified fiat-equivalent rate, source, and timestamp |
| Transaction | Stable ID, transaction and effective/posted dates, signed quantity, type, customer label, rail, status, balance after, fees by asset, counterparty display label, internal reference; optional verified network/hash/confirmations |
| Education/evidence | Approved copy ID, locale, source, date, responsible entity, validity window, and visibility rule |
| Brand/configuration | YES design tokens and assets, approved legal labels, support destinations, UserWay account ID, feature flags |

**Reconciliation and release rules**

1. Opening quantity + signed transactions = closing quantity at the asset's declared precision. Category totals and the chart must derive from these same transactions.
2. The first and subsequent running balances must reconcile in chronological order. Tie-breaking rules are required for transactions sharing a date/time.
3. Define whether a period filter uses transaction, effective, or posting date; use the same basis in totals, charts, and exports. Explicitly classify prior-period adjustments.
4. Fees denominated in another asset are shown separately and are never subtracted from the stablecoin bridge without a documented conversion.
5. A production statement with conflicting totals, missing required legal text, invalid localization, or unverified evidence must fail publication and be routed for correction.
6. Never embed actual customer information in the public showcase. Use synthetic data throughout, including names, transaction references, and support interactions.

## 7. Visual and motion direction

The visual tone should be calm and credible with one moment of delight: the balance journey animates as a customer selects a step, then the matching transactions slide into view. Use simple SVG or CSS graphics embedded in the HTML. Avoid decorative crypto imagery, price-ticker aesthetics, and charts that suggest investment performance when this is an account statement.

Use a clear information hierarchy: large closing balance, modest period metadata, concise reconciliation, then optional insight cards. Micro-interactions can confirm selection, expand detail, and connect a chart point to a ledger row. No animation may delay access to a fact, block keyboard use, or obscure a value. The full experience must remain understandable with motion disabled.

## 8. Delivery phases

### Phase A — self-contained showcase

Deliver one HTML file with fictional data, placeholder YES identity, bilingual copy, balance journey, search and filters, responsive transaction details, contextual local explanations, full mock inquiry, illustrative transparency/on-chain panels, video placeholder, print/CSV, and accessible fallbacks. The official UserWay integration is configured for online viewing using the supplied account ID; offline loss of the widget is handled gracefully.

**Showcase walkthrough:** open statement → understand closing balance → select outgoing transfers → see matching ledger rows → open one transaction → “Explain with AI” → start and complete a demo inquiry → switch to Spanish without losing context → inspect illustrative transparency panel → print or export.

### Phase B — production integration

Replace fictional data and brand tokens; approve terminology and disclosures; reconcile against YES source systems; connect secure inquiry, governed AI, approved video, verified evidence, analytics, delivery, access control, archive, and support destinations. Validate with InfoSlips how the SPA is packaged, signed/delivered, embedded, and measured as a statement of record.

Production launch requires security/privacy review, legal and issuer/custody approval, accessibility review, Spanish language review, performance testing on representative devices, and statement-data sign-off. The showcase must not be reused with real data until those gates pass.

## 9. Acceptance criteria

| Area | Phase A acceptance | Phase B additional acceptance |
| --- | --- | --- |
| Single-file operation | Open the HTML locally with no network; overview, balance journey, filters, details, explanations, language switch, and mock inquiry work. | Approved InfoSlips delivery preserves the intended interactions and record integrity. |
| Trust in numbers | Every shown total and chart reconciles to the embedded ledger; no conflicting balance labels. | Automated reconciliation blocks release of inconsistent statements. |
| Discoverability | From the first screen, reach any transaction in no more than three deliberate interactions; filters visibly report results. | Search/index performance meets agreed volume and device targets. |
| Explanation | “Explain with AI” identifies the selected fact and points to supporting statement rows; demo label is visible. | Grounded answers cite statement fields, respect policy, and offer human escalation. |
| Inquiry | User can select a transaction, enter a reason, review, and receive an unmistakable no-send demo confirmation. | Secure submission returns genuine case tracking and audit evidence. |
| Localization | All core flows work in English and Spanish, preserving context on switch. | Legal/support copy and Spanish quality are approved. |
| Accessibility | Core flows work with keyboard and screen reader; reduced motion and chart text alternatives work; widget loading failure does not block use. | Formal WCAG 2.2 AA review and UserWay integration sign-off. |
| Claims | Fictional blockchain/reserve content is visibly illustrative; no fake explorer or live attestation link. | Every external claim has approved source, date, and owner. |

## 10. Measures of success

For the showcase, assess whether five representative viewers can state the closing balance, explain the largest change, find a specified transaction, and finish the mock inquiry without coaching. Capture time to answer, misunderstandings, and qualitative reaction to the balance journey.

For production, measure statement opens, balance-journey use, transaction search success, explanation helpfulness, inquiry starts/completions, language choice, video engagement, accessibility issues, and support-contact reasons. Analyze in aggregate with minimal personal data. Define targets after a baseline pilot rather than inventing unsupported conversion claims.

## 11. Inputs still needed before production build

- YES logo, colors, fonts, tone of voice, approved product name, and image/video assets.
- Legal product model and wording: issuer, custodian, banking partner if any, stablecoin rights, reserve/redemption disclosures, geographic eligibility, and required statement text.
- Authoritative transaction schema, decimal precision, date semantics, fee treatment, corrections, and sample datasets that include edge cases.
- Secure inquiry destination and operational policy; approved AI provider, content boundaries, privacy/retention policy; verified blockchain and reserve-evidence sources.
- InfoSlips packaging and widget ownership: confirm whether the platform injects UserWay centrally or the SPA is responsible for the one approved integration.

These are production dependencies. They do not prevent the Phase A showcase because it uses visibly fictional data and placeholders.

## Sources and design basis

- [Reference InfoSlips statement](https://viewer.infoslips.us/#/link/9EFFA82B6C0AE46F2A74DAFFD6F8156E0CE14A805769DDF7C057EC717806FD28/0), reviewed 3 October 2026.
- [InfoSlips platform](https://www.infoslips.com/platform/): structured interactive documents, contextual explanations, video, localization, AI guidance, delivery, and engagement insight.
- [InfoSlips accessibility statement](https://www.infoslips.com/legal/): UserWay is made available within InfoSlips correspondence.
- [W3C WCAG overview](https://www.w3.org/WAI/standards-guidelines/wcag/): accessibility target and reference.

Product ideas, sample figures, interface copy, and suggested acceptance criteria in this PRD are proposals for YES; they are not claims that the current statement or InfoSlips already implements every described behavior.
