# Architecture and module contract

The showcase is **one HTML file** (`dist/yes-statement.html`) assembled by `build.mjs` from small sources in `src/`. Plain JavaScript, no framework, no runtime network dependency. This document is the contract every module follows.

## Source layout

| Path | Owner | Purpose |
| --- | --- | --- |
| `src/index.html` | foundation | Page skeleton with mount points, dialogs, live regions |
| `src/css/00-tokens.css` | foundation | Design tokens (light default; dark from the device setting or the visitor's choice), brand slots |
| `src/css/01-base.css` | foundation | Reset, typography, focus, motion, utilities |
| `src/css/02-components.css` | foundation | Shared components (buttons, cards, chips, forms, table, dialog, notices, status, amounts) |
| `src/css/03-shell.css` | foundation | Masthead, section tabs, phone menu, light/dark toggle, footer, withheld state |
| `src/css/90-print.css` | foundation | Print base: always light, hides UI, shows `#print-root`, watermark |
| `src/js/00-config.js` | foundation | Brand/legal/support slots (including the video poster and voiceover), feature flags, locales, UserWay integration point |
| `src/js/01-data.js` | foundation | Canonical statement data (illustrative) |
| `src/js/02-calc.js` | foundation | Pure arithmetic + reconciliation (also run by the build's release gate) |
| `src/js/03-i18n.js` | foundation | `YES.t`, `YES.L`, `YES.fmt.*`, shared EN/ES strings |
| `src/js/04-core.js` | foundation | Events, state, module registry, router, light/dark theme (`YES.theme`), UI toolkit, icons, API stubs |
| `src/js/05-shell.js` | foundation | Skip link, masthead (language switch, light/dark toggle, Download or print, Ask YES), section tabs and the phone Menu, footer, document title, withheld state |
| `src/js/06-userway.js` | foundation | UserWay loader (online only, once, graceful failure, launcher corner from config) |
| `src/js/07-pdf.js` | foundation | `YES.pdf`: dependency-free PDF 1.4 writer (the help module composes the statement of record with it) |
| `src/js/99-boot.js` | foundation | Boot sequence |
| `src/js/10-overview.js`, `src/css/10-overview.css` | overview | First screen, balance card, statement details, balance journey, running-balance chart, “Your statement in 60 seconds” player |
| `src/js/20-explorer.js`, `src/css/20-explorer.css` | explorer | Transactions view: search, filters, sort, table/cards, transaction detail dialog, CSV export |
| `src/js/30-inquiry.js`, `src/css/30-inquiry.css` | inquiry | Mock inquiry flow dialog |
| `src/js/40-assistant.js`, `src/css/40-assistant.css` | assistant | “Ask YES” drawer and deterministic demo explanations |
| `src/js/50-understand.js`, `src/css/50-understand.css` | understand | Stablecoin education, illustrative transparency and on-chain panels, statement vs live |
| `src/js/60-help.js`, `src/css/60-help.css` | help | Help/contact, feedback, Download or print (statement record: print, PDF, CSV), integrity, accessibility status, print view, PDF composition |
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
2. **Numbers and dates**: only via `YES.fmt.plain` (machine-readable, CSV), `YES.fmt.isoTime`, `YES.fmt.amount` (value and unit joined by a no-break space, U+00A0; four-digit amounts are always grouped), `YES.fmt.amountSpoken`, `YES.fmt.date(iso, style)`, `YES.fmt.isoDate`, `YES.fmt.range`, `YES.fmt.tz`, `YES.fmt.fiat` (grouped like token amounts), `YES.fmt.count`, `YES.txCount(n)`, `YES.fmt.maskedSpoken(text)`. `YES.fmt.range` is worded to read naturally on its own and after a preposition ("September 1–30, 2026"; "1 al 30 de septiembre de 2026", so Spanish templates say "del {period}"). Amounts are **integer minor units**; never do float arithmetic on them.
3. **Figures** come from `YES.calc.*` (categories, journey, running, posted, notInBalance, tx, feesFor, largest, fiat, fiatAvailable, reconcile). Never hard-code a total. `calc.fiat()` returns `null` unless the asset's rate has a source and timestamp **and** is `verified` (in demo mode an `illustrative` rate is allowed and must be labelled Illustrative).
4. **Rendering**: build HTML strings with `esc()` on every interpolated value and write them with `ui.render(el, html)`. Give every interactive control a stable `data-fk` (focus key) so focus survives re-renders and language switches. Bind events once in `init()` with `ui.delegate(rootEl, 'click', selector, fn)`.
5. **State**: shared state lives in `YES.state` (a module may add its own key named after itself, e.g. `YES.state.understand`); change it with `YES.set({ key: newValue })` (shallow; replace nested objects). Language switch re-renders everything from state, so anything that must survive it (filters, selected transaction, inquiry draft, assistant conversation, open step) must be in `YES.state` — not only in the DOM.
6. **Views**: each view root renders exactly one `<h1 id="h-<view>" class="view-title" data-view-heading tabindex="-1">`. The router shows/hides `#view-*` sections and focuses the heading on navigation.
7. **Dialogs**: there is ONE language switch, in the masthead (the phone Menu on small screens). Dialogs, sheets and the assistant drawer do not include `ui.langSwitchHtml` and render in the language chosen before they opened. To change language mid-flow the visitor closes the dialog, and the draft or conversation is kept in `YES.state`. Use the native `<dialog>` elements in `index.html` with `ui.openDialog(dlg, { trigger, initialFocus, onClose })` and `ui.closeDialog(dlg, { returnFocus })`. Each dialog has a heading with the id named in its `aria-labelledby`, and a visible close button. Under 720px wide, dialogs are full-screen sheets automatically. A module that hands over from another module's dialog (e.g. the inquiry taking over from the transaction detail) reads that dialog's return target with `ui.dialogTrigger(dlg)` and releases it with `ui.setDialogReturn(dlg, null)`, never through `dlg._trigger`.
8. **Theme**: style with the design tokens only (`var(--surface)`, `var(--ink)`, …), so a component is right in both the light and dark schemes and in print. A rule that must differ in dark (rare) uses the two dark entry points from `00-tokens.css`, never a bare `prefers-color-scheme` query (that would ignore the visitor's choice):
   `@media screen and (prefers-color-scheme: dark) { :root:not([data-theme='light']) .x { … } }` and `@media screen { :root[data-theme='dark'] .x { … } }`. Both are screen-only: print is always light. Never read colours from JavaScript at render time. If a script must know the theme, use `YES.theme.effective()` and the `theme` event.
9. **Accessibility**: semantic HTML, keyboard operable, visible focus, 44px targets on touch, `ui.announce()` for results counts and confirmations, never colour alone (use `ui.amountHtml`, `ui.statusHtml`, icons, words), every chart has a text/table equivalent, motion respects `ui.reducedMotion()` and the global reduced-motion CSS. A focus style that uses a box-shadow ring also sets `outline: 2px solid transparent` (forced colours drop box-shadows; 01-base.css adds a system-colour outline as a safety net). Masked identifiers render through `ui.maskedHtml` (aria-labels: `YES.fmt.maskedSpoken`), so assistive technology hears "ending in 4821", not "bullet bullet…". Text that is not in the UI language (e.g. a customer's own memo, written in `YES.data.statement.language`) carries a `lang` attribute.
10. **Demo honesty**: illustrative content is labelled (`ui.illustrativeTag()`, `.notice--illustrative`); demo-only behaviour says so; nothing claims to be sent, verified or live. The header carries no demo badge (see *Demo labels* below), so a module that shows fictional figures in its own section keeps its own tag (`.demo-badge` with `t('demo.badge')`, or `ui.illustrativeTag()`).
11. **No network**: no external URLs for scripts, styles, fonts, images or links that fetch. The only network request in the file is the UserWay loader in `06-userway.js`.

## Shared UI toolkit (`YES.ui`)

| Function | Use |
| --- | --- |
| `esc(v)` | Escape for HTML text/attributes |
| `$`, `$$`, `delegate(root, evt, sel, fn)` | DOM helpers |
| `render(el, html)` | Replace content and restore focus by `data-fk` |
| `focusKey(key)`, `focusView(view)` | Focus helpers |
| `announce(msg, assertive)` | Screen-reader announcement. While a modal dialog is open the page behind it is inert, so the message goes to a live region inside the topmost modal dialog. |
| `toast(msg)` | Short visual + announced confirmation. A manual popover, re-shown each time, so it paints above any open modal dialog or sheet. It may use the full width less the gutters; one line is a pill, a wrapped message takes the card radius (`.is-multiline`) |
| `reducedMotion()`, `isNarrow()` | Media checks |
| `copy(text)`, `download(name, content, mime)` | Clipboard and local file save. `content` is a string or bytes (e.g. `YES.pdf` output with `'application/pdf'`). |
| `openDialog(dlg, opts)`, `closeDialog(dlg, opts)`, `anyModalOpen()` | Native dialog management (a late `close` event after a quick reopen is ignored) |
| `dialogTrigger(dlg)`, `setDialogReturn(dlg, el)` | Read / change where focus returns when an open dialog closes |
| `registerIcons({ name: '<path …/>' })` | Add icons in the shared 24×24 stroke style |
| `icon(name, { size, label, cls })` | Inline SVG icons (see `ICONS` in 04-core.js; includes `moon`, `sun`, `file-down`, `menu`) |
| `amountHtml(minor, { sign, unit, cls })` | Signed amount with spoken text for screen readers |
| `statusHtml(status)` | Status chip with icon + label |
| `typeLabel(tx)` / `typeLabel(type[, status])`, `typeIcon(type)` | Customer-friendly type label and icon. Pass the transaction: a transaction that is not posted never gets a completed-sounding label ("Redemption requested", not "Redeemed"). A bare type (filter facets) gets the canonical label |
| `maskedHtml(text)` | Text with masked identifiers ("•••• 4821"): bullets hidden from assistive technology, "ending in 4821" spoken instead |
| `langSwitchHtml({ fk, compact })` | The language switch, for the shell only (masthead and phone Menu). Dialogs must not include one (rule 7). Buttons are named "English"/"Español" at every width; `compact` shows EN/ES. Clicks on any `[data-lang]` button are handled globally |
| `logoHtml({ cls, size, decorative })` | The `[YES_LOGO]` slot as one element (masthead, video poster, print header). Uses approved SVG markup (`slot.svg`) or a `data:` image (`slot.src`; a URL that would fetch is ignored). Otherwise it shows the text placeholder (`slot.text`), outlined as a placeholder. The element is named "YES" (`role="img"`); with `decorative: true` it is hidden from assistive technology instead, for when nearby text already names YES. `cls` adds classes, and the first one also gets the state modifier, like `yes-logo` itself (`<cls>--art` / `<cls>--placeholder`). `size` is the height, as px or a CSS length (`'28pt'`). It sets `--logo-h`, and the lettering and artwork scale with it. The placeholder prints legibly without background colours |
| `illustrativeTag(key)` | “Illustrative” tag |
| `explainButton({ topic, id }, topicLabel, { compact, fk })` | “Explain with AI” entry point (handled globally) |

Global delegated attributes: `[data-explain="topic"][data-explain-id="id"]` opens the assistant; `[data-nav="view"][data-nav-param="x"]` navigates; `button[data-lang="es"]` switches language.

Module lifecycle: boot calls `YES.initModules(allow)`. A module left out (every feature module while a statement is withheld) is never initialised, rendered or told about state changes, so a language switch cannot render withheld figures.

## Cross-module APIs

| API | Owner | Behaviour |
| --- | --- | --- |
| `YES.overview.selectStep(stepId)` / `clearStep()` | overview | Select a balance-journey step (`deposits`, `transfers_in`, `transfers_out`, `redemptions`, `fees`, or group `incoming` / `outgoing`). Navigates to Overview if needed. Selecting a step also sets `YES.state.filters` to `YES.defaultFilters()` plus `{ step }`, so Transactions opens on exactly those rows. Clearing it (Back, or Clear) sets `filters.step` to `null` only if the filter is still on that step. A filter the customer has changed in Transactions is left alone. |
| `YES.explorer.applyFilter(partialFilters, { navigate=true, focus='results' })` | explorer | Merge into `YES.state.filters` (unspecified keys keep current values unless `{ reset: true }` is passed in options), navigate to Transactions, announce the result count. `step` filters to exactly `YES.calc.category(step).txIds` (or a group's `txIds`); `ids` filters to an explicit id list. |
| `YES.explorer.showRows(ids, label)` | explorer | Shortcut for `applyFilter({ ids, ... }, { reset: true })` with a visible chip naming `label`. `label` is a string or a localised `{ en, es }` object. The explorer resolves it with `YES.L` when it renders, so the chip follows a language switch. Callers should pass the object. |
| `YES.explorer.clearFilters()` | explorer | Restore the full ledger. |
| `YES.explorer.openTx(id, { trigger, list })` | explorer | Open the transaction detail dialog. Sets `YES.state.selectedTx`; route `#/transactions/<id>`. `trigger` is where focus returns on close. `list` holds the ids of the list it was opened from, in order, and Previous / Next stay within it. Without `list`, the list is taken from the trigger's own list or table, else from the current results. Opened by the customer over the Transactions view, the detail adds a history entry, so Back (or a phone's back gesture) closes it and stays in the list. Over another view it opens in place. The detail dialog has no language switch: it uses the language chosen in the masthead (rule 7). |
| `YES.explorer.closeTx({ how: 'back' \| 'replace' })` | explorer | Close the detail dialog. `'replace'` (the default) rewrites the address. `'back'` steps back over the detail's history entry, as when the customer closes it. Use `'back'` when handing over to another dialog (e.g. the inquiry). |
| `YES.explorer.filtered()` | explorer | Currently filtered + sorted transactions. |
| `YES.explorer.exportCsv('all' | 'filtered')` | explorer | Download CSV in the current language. |
| `YES.inquiry.start(txId, { trigger })` | inquiry | Start (or resume) the inquiry for a transaction. Draft lives in `YES.state.inquiry`. |
| `YES.inquiry.resume()` | inquiry | Reopen an in-progress draft. |
| `YES.inquiry.draftFor(txId)` | inquiry | The draft/submitted inquiry for that transaction (`{ txId, step, status: 'draft' \| 'submitted', ref }`) or `null` — lets the transaction detail offer “Continue your inquiry”. |
| `YES.assistant.open({ topic, id, trigger })` | assistant | Open the drawer with context. Topics: `general`, `balance`, `step` (id = step id), `transaction` (id = tx id), `fees`, `edu` (id = education topic id), `chart`, `pending`. |
| `YES.assistant.ask(questionId)` | assistant | Ask a curated question. |
| `YES.assistant.close()` | assistant | Close the drawer. |
| `YES.understand.openTopic(topicId)` | understand | Navigate to Understand and expand a topic: `token_units`, `usd_equivalent`, `onchain_vs_internal`, `tx_status`, `fees`, `redemption`, `statement_vs_live`, `transparency`. |
| `YES.help.open(sectionId)` | help | Navigate to Help and focus a section: `contact`, `feedback`, `record`, `integrity`, `accessibility`, `about`. `record` is the **Download or print** section (Print, Download PDF and CSV with the statement-record facts). The masthead's Download or print button calls `YES.help.open('record')`. |
| `YES.help.downloadPdf()` | help | Build the statement-of-record PDF with `YES.pdf` in the current language and save it as `YES-statement-<id>-DEMO.pdf` (Letter for English, A4 for Spanish; `YES.config.pdf.pageSize` may override with `'letter' \| 'a4'` or `{ en, es }`). It shows its own confirmation toast and returns the file name, or `null` if it failed. The Transactions toolbar's Download PDF button calls it too. `#/help/download` (also `print`, `pdf`) is an alias route for the Download or print section. |
| `YES.theme` | foundation | Light/dark. `get()` returns the visitor's choice (`'light'`/`'dark'`) or `null` while following the device. `device()` and `effective()` return the device setting and the theme on screen. `set('light'\|'dark')` records a choice (localStorage `yes.theme`, in try/catch), and `set(null)` follows the device again. `toggle()` switches. The effective theme is mirrored into `<html data-theme>`, and a change emits `theme`. While there is no choice, the theme follows `prefers-color-scheme` live. A script in `<head>` applies a saved choice before the first paint. |
| `YES.pdf` | foundation | Dependency-free PDF 1.4 writer (see below). |

Routes: `#/overview[/<stepId>]`, `#/transactions[/<txId>]`, `#/understand[/<topicId>|basics|live|onchain|transparency]`, `#/help[/<sectionId>]`. Selecting a step from the full journey pushes `#/overview/<stepId>`, and Back to `#/overview` clears the selection. Likewise, opening a transaction from the Transactions view pushes `#/transactions/<txId>`, and Back closes the detail. The showcase-only integrity preview is `#/overview?simulate=mismatch`. Only fragments starting with `#/` are routes: any other fragment (e.g. `#main`) is an in-page anchor and keeps the current view. A piece of the address that cannot be percent-decoded is kept as typed (an unknown param), so a truncated link never stops the statement from booting. When the browser changes the route (Back, Forward, an edited address) and the view changes, the new view's heading is focused and announced, exactly as for a click in the navigation. `YES.nav.setParam(param)` replaces the current entry's sub-route, but never while a newer address is waiting for its `hashchange`: that navigation wins.

Module-owned state keys: `YES.state.overview` (disclosure states), `YES.state.understand` (expanded topics), `YES.state.assistant` (open flag, conversation intents, feedback), `YES.state.inquiry` (draft), `YES.state.feedback` (help feedback).

Filters (`YES.state.filters`, shape from `YES.defaultFilters()`): `from` / `to` are on the statement's date basis (`YES.data.statement.dateBasis`), and sorting never changes it. `idsLabel` names an explicit `ids` list for its chip (a string or `{ en, es }`). `amountLang` is the language the min/max text was typed in, set by the explorer, so "1,000" and "1.000" keep their meaning after a language switch.

Overview layout: the balance card and the balance journey lay out by their container's width, not the viewport's (`--jr-layout` tells the script which journey layout is active), so they adapt while the assistant is docked.

Assistant presentation: docked and non-modal at ≥1100px (`html.assistant-docked` reflows the page so the drawer never covers the balance), a modal side drawer from 720px to 1099px, and a full-screen sheet under 720px. Under 640px tall the drawer compacts its header and composer. Under 520px tall it scrolls as a whole, like the other dialogs, with the composer pinned at the bottom. Transaction answers offer `YES.inquiry.start`, labelled from `YES.inquiry.draftFor`: "Ask about this transaction", "Continue your inquiry" or "View your demo inquiry". A typed question clearly written in the other language is answered in that language until the visitor next chooses a language.

Masthead: a size container (`container: mast`) with em breakpoints, so it lays out for the width it actually has (including while the assistant is docked) and very large text moves to the roomier layouts. Every language gets the same layout at a given width (Spanish, the longest, sets the thresholds). The brand row is a second size container (`container: mastrow`): the labels follow the room inside it, and it stops at the page's 1120px column, so large text on a wide screen gets the shorter labels it needs instead of wrapping (the pixel widths below are for the default text size). From 45em (720px) it is one row: brand, language switch, light/dark toggle (one button named "Dark mode", `aria-pressed`), **Download or print** and Ask YES, then the section tabs. From 992px (row content 59em) every label is in full: the language switch shows the globe and "English | Español", and the button reads "Download or print" / "Descargar o imprimir" (Spanish needs about 950px for this row). Below that the switch is compact (EN/ES; the full names stay each button's accessible name) and the button keeps its full label. Below 880px (row under 52em) it reads "Download" / "Descargar", though its name stays "Download or print". Below 832px (row under 49em) Ask YES shows "Ask". The masthead sticks at `top: 0`, so the whole header (brand row and tabs) stays pinned. Below 45em (720px) is the phone layout: logo, short period, Ask and a **Menu** button (☰ and the visible word, `aria-expanded`, `aria-controls="mast-menu"`). Menu opens a dropdown panel under the header with the four sections (`aria-current` on the current one), Download or print, the language switch (full names) and the light/dark toggle. Click, Enter or Space toggles it. Escape closes it and returns focus to Menu. A click outside, tabbing out or any navigation closes it. Choosing a section closes it and focuses the view heading. Language and theme keep it open, with focus on the pressed control. The panel never scrolls the page sideways, scrolls inside itself when taller than the room left, and closes when the layout leaves the phone range. On a phone the header is one row under 60px tall (57px at the default text size), all of it pinned. On viewports under 500px tall, or when very large text would make the pinned part over 30% of the screen, nothing is pinned. `--masthead-h` always equals the pinned height (it drives `scroll-padding-top`, WCAG 2.4.11). Dialogs on viewports under 520px tall scroll as a whole sheet. When a dialog is opened while another modal dialog is open, it stacks as a modal on top of that dialog. The transaction detail closes itself before handing over to the assistant, and closing the drawer returns focus to the transaction's row. The UserWay launcher sits bottom left (`YES.config.userway.position = 5`, UserWay's `data-position`: 1 top right, 2 middle right, 3 bottom right, 4 bottom middle, 5 bottom left, 6 middle left, 7 top left, 8 top middle), clear of the drawer's close button and the masthead's controls.

Demo labels: the header carries **no** "Illustrative demo data" badge. PRD §4.1 asked for a visible badge on the first screen; the product owner removed it from the header on 2026-10-04 (both the inline badge in English and the slim full-width band used in Spanish and on narrower screens). The fictional data stays marked by the footer demo notice (`footer.demo`), the document title ("… · Illustrative demo"), the noscript "ILLUSTRATIVE DEMO DATA" line, the print and PDF watermarks, the "Illustrative" tags (fictional rate, on-chain reference, reserve panel, transaction detail) and module section tags such as Help's (`.demo-badge`, `demo.badge`). The `.demo-badge` class and the `demo.badge` / `demo.badgeLong` / `demo.watermark` strings stay available to modules.

Personalized video (overview module, PRD §5.7): "Your statement in 60 seconds" is an animated player drawn in the page (no video file, no network) that follows the storyboard: greeting → opening and closing balance → largest meaningful movement → how to inspect a transaction → where to get help, with every figure from the same statement snapshot. It behaves like a video player (play/pause and progress), never autoplays, is narrated and captioned, keeps a transcript, and respects reduced motion. Narration uses the approved recorded voiceover for the current language when `YES.config.slots.VIDEO_VOICEOVER[lang]` holds one (a `data:` audio URI, so the file still fetches nothing); otherwise the device's built-in voice (Web Speech API) reads the captions. The written statement stays complete without it.

Content entities (understand module): `YES.content.education[]` and `YES.content.evidence[]` follow the PRD §6 education/evidence contract (copy ID, locale variants, source, date, responsible entity, validity window, visibility rule, illustrative flag).

Events (`YES.on(evt, fn)`): `state` (changed keys), `route` ({ view, param, params }), `view` (view id), `lang` (lang), `theme` (`'light'`/`'dark'`), `rendered`, `ready`, `userway` (status).

## PDF writer (`YES.pdf`, `src/js/07-pdf.js`)

The writer is small, offline and has no library. It covers what a statement of record needs: text in the standard fonts Helvetica and Helvetica-Bold (WinAnsiEncoding, not embedded, so the text is real and selectable), lines, rectangles and a watermark. Coordinates are points from the **top-left** of the page.

```js
var doc = YES.pdf.create({ size: 'letter' /* or 'a4' */, margin: 54 /* or { top, right, bottom, left } */,
  title, author, subject, keywords, creator, lang: YES.i18n.locale() /* catalog /Lang */, date /* default now */ });
doc.width; doc.height; doc.margin;            // points (letter 612 × 792, A4 595.28 × 841.89)
doc.text(str, x, y, { font: 'regular' | 'bold', size: 10, color: '#111820', align: 'left' | 'right' | 'center', width, baseline: 'top' | 'alphabetic' });
doc.paragraph(str, x, y, { width, font, size, color, lineHeight, align }); // → y below the last line
doc.measure(str, font, size); doc.wrap(str, font, size, maxWidth);         // → width in pt; → lines
doc.line(x1, y1, x2, y2, { width: 0.75, color, dash: [2, 2] });
doc.rect(x, y, w, h, { fill: '#f0f2f5', stroke: '#888', lineWidth });
doc.watermark('ILLUSTRATIVE DEMO DATA', { size, color: '#dadada', angle });  // every page, beneath content
doc.addPage(); doc.setPage(i); doc.pageCount(); doc.page;                    // the document starts with one page
YES.ui.download('YES-statement-<id>-DEMO.pdf', doc.save(), 'application/pdf'); // save() → Uint8Array
```

- **Text.** With the default `baseline: 'top'`, `y` is the top of the text (Helvetica's ascender), and the baseline sits `0.718 × size` below it (`doc.ascent(size)`). `align: 'right'` ends the text exactly at `x`, using the real Adobe AFM advance widths. Use it for amounts. With `width`, the text is aligned inside `[x, x + width]`.
- **Encoding.** Text is written in Windows-1252, which covers Spanish accents, ñ, ¿ ¡, €, typographic quotes, dashes, ellipsis and •. Characters outside it are mapped: U+2212 minus → `-`, no-break, thin and narrow spaces → space, `≈` → `~`, `→` → `->`, `✓` → `OK`. Anything else becomes `?` (`YES.pdf.encode`). `wrap()` breaks at ordinary spaces and line breaks, never at a no-break space, so `YES.fmt.amount` values keep their unit.
- **Watermark.** It is drawn first on every page, including pages added later, so content paints over it. Light fills (table stripes) hide it where they sit. It is real text too. Diagonal text is extracted one letter per line by some tools, but it never splits a content line.
- **File.** PDF 1.4 with byte-exact xref offsets, `/Info` (Title, Author, Subject, Creator, Producer, CreationDate), catalog `/Lang` and `/ViewerPreferences << /DisplayDocTitle true >>`. The file is not tagged. Streams are uncompressed, at a few kB per page. The output does not depend on the screen theme.
- **Composition** belongs to the caller. The help module draws the statement of record (every page, demo watermark, running footer) from the same data and strings as the print view.

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

`tests/07-pdf.test.mjs` builds sample documents in the page and checks them with the poppler tools (`pdfinfo`, `pdftotext -layout`, `pdftoppm`, from `poppler-utils`). The walkthrough checks the statement-of-record PDF the same way. The build also draws a fixed sample with the writer and refuses to ship a minified writer whose bytes differ.

The runner blocks all network requests (only the UserWay attempt is expected), fails on console errors, and provides `t.axe()` (axe-core WCAG 2.x A/AA; the sticky masthead is unpinned during the scan, so results don't depend on the scroll position) and `t.shot()` screenshots in `test-results/screens/`.

The build strips comments and indentation from the inlined CSS and JS. It never touches strings, template literals or regular expressions, and it keeps line breaks. It checks that the result parses, has the same JavaScript token stream as the sources, and yields the same data, config, strings and release-gate result. `node build.mjs --no-minify` inlines the sources verbatim for debugging.
