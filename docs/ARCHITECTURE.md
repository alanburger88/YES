# Architecture and module contract

The showcase is **one HTML file** (`dist/yes-statement.html`) assembled by `build.mjs` from small sources in `src/`. Plain JavaScript, no framework, no runtime network dependency. This document is the contract every module follows.

## Source layout

| Path | Owner | Purpose |
| --- | --- | --- |
| `src/index.html` | foundation | Page skeleton with mount points, dialogs, live regions |
| `src/css/00-tokens.css` | foundation | Design tokens (light + dark), brand slots |
| `src/css/01-base.css` | foundation | Reset, typography, focus, motion, utilities |
| `src/css/02-components.css` | foundation | Shared components (buttons, cards, chips, forms, table, dialog, notices, status, amounts) |
| `src/css/03-shell.css` | foundation | Masthead, navigation, footer, withheld state |
| `src/css/90-print.css` | foundation | Print base: hides UI, shows `#print-root`, watermark |
| `src/js/00-config.js` | foundation | Brand/legal/support slots, feature flags, locales, UserWay integration point |
| `src/js/01-data.js` | foundation | Canonical statement data (illustrative) |
| `src/js/02-calc.js` | foundation | Pure arithmetic + reconciliation (also run by the build's release gate) |
| `src/js/03-i18n.js` | foundation | `YES.t`, `YES.L`, `YES.fmt.*`, shared EN/ES strings |
| `src/js/04-core.js` | foundation | Events, state, module registry, router, UI toolkit, icons, API stubs |
| `src/js/05-shell.js` | foundation | Masthead, nav, language switch, footer, withheld state |
| `src/js/06-userway.js` | foundation | UserWay loader (online only, once, graceful failure) |
| `src/js/99-boot.js` | foundation | Boot sequence |
| `src/js/10-overview.js`, `src/css/10-overview.css` | overview | First screen, balance card, statement details, balance journey, running-balance chart, video card |
| `src/js/20-explorer.js`, `src/css/20-explorer.css` | explorer | Transactions view: search, filters, sort, table/cards, transaction detail dialog, CSV export |
| `src/js/30-inquiry.js`, `src/css/30-inquiry.css` | inquiry | Mock inquiry flow dialog |
| `src/js/40-assistant.js`, `src/css/40-assistant.css` | assistant | “Ask YES” drawer and deterministic demo explanations |
| `src/js/50-understand.js`, `src/css/50-understand.css` | understand | Stablecoin education, illustrative transparency and on-chain panels, statement vs live |
| `src/js/60-help.js`, `src/css/60-help.css` | help | Help/contact, feedback, statement record, integrity, accessibility status, print view |
| `tests/NN-<module>.test.mjs` | module | Browser tests for that module |

Files are concatenated in filename order, so module files run after the foundation and before `99-boot.js`.

## Module pattern

```js
(function (root) {
  'use strict';
  var YES = root.YES, ui = YES.ui, t = YES.t, esc = ui.esc;

  // Public API (replaces the stub defined in 04-core.js)
  YES.explorer = { applyFilter: ..., openTx: ..., ... };

  YES.register({
    name: 'explorer',
    i18n: { en: { 'explorer.title': 'Transactions', ... }, es: { 'explorer.title': 'Movimientos', ... } },
    init: function () { /* bind delegated events once; first render */ },
    render: function () { /* full re-render from YES.state (called on language change) */ },
    onState: function (changedKeys) { /* optional: react to state changes */ }
  });
})(window);
```

Rules:

1. **Strings**: every user-visible string comes from `YES.t(key)` with keys prefixed by the module name (`explorer.*`). Provide **both** `en` and `es`; `YES.i18n.audit()` must return `{}`. Localised data fields use `YES.L(obj)`.
2. **Numbers and dates**: only via `YES.fmt.amount`, `YES.fmt.amountSpoken`, `YES.fmt.date(iso, style)`, `YES.fmt.isoDate`, `YES.fmt.range`, `YES.fmt.tz`, `YES.fmt.fiat`, `YES.fmt.count`, `YES.txCount(n)`. Amounts are **integer minor units**; never do float arithmetic on them.
3. **Figures** come from `YES.calc.*` (categories, journey, running, posted, notInBalance, tx, feesFor, largest, fiat, reconcile). Never hard-code a total.
4. **Rendering**: build HTML strings with `esc()` on every interpolated value and write them with `ui.render(el, html)`. Give every interactive control a stable `data-fk` (focus key) so focus survives re-renders and language switches. Bind events once in `init()` with `ui.delegate(rootEl, 'click', selector, fn)`.
5. **State**: shared state lives in `YES.state` (a module may add its own key named after itself, e.g. `YES.state.understand`); change it with `YES.set({ key: newValue })` (shallow; replace nested objects). Language switch re-renders everything from state, so anything that must survive it (filters, selected transaction, inquiry draft, assistant conversation, open step) must be in `YES.state` — not only in the DOM.
6. **Views**: each view root renders exactly one `<h1 id="h-<view>" class="view-title" data-view-heading tabindex="-1">`. The router shows/hides `#view-*` sections and focuses the heading on navigation.
7. **Dialogs**: use the native `<dialog>` elements in `index.html` with `ui.openDialog(dlg, { trigger, initialFocus, onClose })` and `ui.closeDialog(dlg, { returnFocus })`. Each dialog has a heading with the id named in its `aria-labelledby`, and a visible close button. Under 720px wide, dialogs are full-screen sheets automatically.
8. **Accessibility**: semantic HTML, keyboard operable, visible focus, 44px targets on touch, `ui.announce()` for results counts and confirmations, never colour alone (use `ui.amountHtml`, `ui.statusHtml`, icons, words), every chart has a text/table equivalent, motion respects `ui.reducedMotion()` and the global reduced-motion CSS.
9. **Demo honesty**: illustrative content is labelled (`ui.illustrativeTag()`, `.notice--illustrative`); demo-only behaviour says so; nothing claims to be sent, verified or live.
10. **No network**: no external URLs for scripts, styles, fonts, images or links that fetch. The only network request in the file is the UserWay loader in `06-userway.js`.

## Shared UI toolkit (`YES.ui`)

| Function | Use |
| --- | --- |
| `esc(v)` | Escape for HTML text/attributes |
| `$`, `$$`, `delegate(root, evt, sel, fn)` | DOM helpers |
| `render(el, html)` | Replace content and restore focus by `data-fk` |
| `focusKey(key)`, `focusView(view)` | Focus helpers |
| `announce(msg, assertive)` | Screen-reader announcement |
| `toast(msg)` | Short visual + announced confirmation |
| `reducedMotion()`, `isNarrow()` | Media checks |
| `copy(text)`, `download(name, content, mime)` | Clipboard and local file save |
| `openDialog(dlg, opts)`, `closeDialog(dlg, opts)`, `anyModalOpen()` | Native dialog management |
| `icon(name, { size, label, cls })` | Inline SVG icons (see `ICONS` in 04-core.js) |
| `amountHtml(minor, { sign, unit, cls })` | Signed amount with spoken text for screen readers |
| `statusHtml(status)` | Status chip with icon + label |
| `typeLabel(type)`, `typeIcon(type)` | Customer-friendly type label and icon |
| `illustrativeTag(key)` | “Illustrative” tag |
| `explainButton({ topic, id }, topicLabel, { compact, fk })` | “Explain with AI” entry point (handled globally) |

Global delegated attributes: `[data-explain="topic"][data-explain-id="id"]` opens the assistant; `[data-nav="view"][data-nav-param="x"]` navigates.

## Cross-module APIs

| API | Owner | Behaviour |
| --- | --- | --- |
| `YES.overview.selectStep(stepId)` / `clearStep()` | overview | Select a balance-journey step (`deposits`, `transfers_in`, `transfers_out`, `redemptions`, `fees`, or group `incoming` / `outgoing`). Navigates to Overview if needed. |
| `YES.explorer.applyFilter(partialFilters, { navigate=true, focus='results' })` | explorer | Merge into `YES.state.filters` (unspecified keys keep current values unless `{ reset: true }` is passed in options), navigate to Transactions, announce the result count. `step` filters to exactly `YES.calc.category(step).txIds` (or a group's `txIds`); `ids` filters to an explicit id list. |
| `YES.explorer.showRows(ids, labelText)` | explorer | Shortcut for `applyFilter({ ids, ... }, { reset: true })` with a visible chip naming `labelText`. |
| `YES.explorer.clearFilters()` | explorer | Restore the full ledger. |
| `YES.explorer.openTx(id, { trigger })` | explorer | Open the transaction detail dialog; sets `YES.state.selectedTx`; route `#/transactions/<id>`. |
| `YES.explorer.closeTx()` | explorer | Close the detail dialog. |
| `YES.explorer.filtered()` | explorer | Currently filtered + sorted transactions. |
| `YES.explorer.exportCsv('all' | 'filtered')` | explorer | Download CSV in the current language. |
| `YES.inquiry.start(txId, { trigger })` | inquiry | Start (or resume) the inquiry for a transaction. Draft lives in `YES.state.inquiry`. |
| `YES.inquiry.resume()` | inquiry | Reopen an in-progress draft. |
| `YES.inquiry.draftFor(txId)` | inquiry | The draft/submitted inquiry for that transaction (`{ txId, step, status: 'draft' \| 'submitted', ref }`) or `null` — lets the transaction detail offer “Continue your inquiry”. |
| `YES.assistant.open({ topic, id, trigger })` | assistant | Open the drawer with context. Topics: `general`, `balance`, `step` (id = step id), `transaction` (id = tx id), `fees`, `edu` (id = education topic id), `chart`, `pending`. |
| `YES.assistant.ask(questionId)` | assistant | Ask a curated question. |
| `YES.assistant.close()` | assistant | Close the drawer. |
| `YES.understand.openTopic(topicId)` | understand | Navigate to Understand and expand a topic: `token_units`, `usd_equivalent`, `onchain_vs_internal`, `tx_status`, `fees`, `redemption`, `statement_vs_live`, `transparency`. |
| `YES.help.open(sectionId)` | help | Navigate to Help and focus a section: `contact`, `feedback`, `record`, `integrity`, `accessibility`, `about`. |

Events (`YES.on(evt, fn)`): `state` (changed keys), `route` ({ view, param, params }), `view` (view id), `lang` (lang), `rendered`, `ready`, `userway` (status).

## Dates, periods and amounts

- Statement period, timezone and date basis: `YES.data.statement` (`periodStart`, `periodEnd`, `asOf`, `generatedAt`, `timezone`, `dateBasis: 'posted'`).
- Posted transactions are in the balance; anything else (`pending`, `failed`, `unknown`) is listed but **never** included in balances, categories or the chart, and is labelled explicitly.
- Same-time ties are ordered by `seq`. `calc.posted()` is chronological.
- Fees are separate ledger lines linked by `parentId` ↔ `fees[].feeTxId`. Fees in another asset would be shown separately and never bridged (`calc.foreignFees()`; none in the demo data).

## Testing

```
npm install            # playwright (uses the preinstalled Chromium) + axe-core
npm test               # build + every tests/*.test.mjs, offline
node build.mjs --modules explorer --out test-results/explorer.html
node tests/run.mjs --file test-results/explorer.html --only explorer
```

The runner blocks all network requests (only the UserWay attempt is expected), fails on console errors, and provides `t.axe()` (axe-core WCAG 2.x A/AA) and `t.shot()` screenshots in `test-results/screens/`.
