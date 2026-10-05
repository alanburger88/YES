# Statement map: the 22 features in `dist/yes-statement.html`

Owner: explore (read-only on the statement). This is the reference that the steps (`30-driver.js`, `31-steps.js`, `scripts/shots.mjs`), tour and data-requirements modules build from. It maps every frozen feature id in `shared/features.json` to the statement's UI and APIs. Every setup and target below was **run and verified with Playwright** against `file:///home/user/YES/dist/yes-statement.html` (statement `1.0.0-showcase`; `dist` was rebuilt from `src` and is byte-identical).

**Verification results** (section 6):
- 132/132 checks passed: 22 features × 6 sizes, each with setup, target, data and reset, plus a clean-state check after every reset. The sizes were 880×900, 390×844, 1280×900, 390×440, 683×836 and 1480×836.
- 44/44 passed with reduced motion.
- 44/44 passed **inside a same-origin iframe**, driven from the parent page as `WT.driver` will be. The parent pushed `#/tour/<id>` on every step, and the statement never moved it.
- No console errors. The only outbound request is the UserWay script, which is aborted in tests.

Contents:
1. [Feature → target table](#1-feature--target-table)
2. [Driving the statement: JS API surface](#2-driving-the-statement-js-api-surface)
3. [Reset (verified)](#3-reset-verified)
4. [Gotchas: read before writing the driver or the tour](#4-gotchas-read-before-writing-the-driver-or-the-tour)
5. [Features, one by one](#5-features-one-by-one)
6. [Coverage notes: capabilities to mention under a feature](#6-coverage-notes-capabilities-to-mention-under-a-feature)
7. [Verification scripts](#7-verification-scripts)

Conventions:
- **desktop** means frame width ≥ 720 and **phone** means frame width < 720, matching `WT.driver.isPhone(win)`. The statement switches to its phone layout below 720px, because 45em equals 720px at the default text size.
- "Verified sizes" are `width×height` of the target's bounding rect. The frame sizes are:
  - 880×900: the tour frame on a 1280 desktop.
  - 390×844: a phone-width frame at full height.
  - 1280×900: the SPEC §6 screenshot size, where the assistant **docks**.
  - 390×440: the real phone tour frame (about 52svh).
  - 683×836: the frame when the app is 720–1023 wide. It gets the **phone** layout.
- Every selector list follows the SPEC rule: the **first visible match wins**. Targets are scoped to a module root (`#overview-root`, `#transactions-root`, …) or to a dialog id, so they never match hidden copies, for example the phone Menu's duplicate controls.

---

## 1. Feature → target table

| # | id | Where | Setup (summary) | Target, desktop | Target, phone |
|---|---|---|---|---|---|
| 1 | `summary` | Overview, balance card | route `#/overview` | `#overview-root .ov-balance__grid` | same |
| 2 | `video` | Overview, last card | route, `overview.video.seek(20)` | `#overview-root .ov-video` | `#overview-root [data-vp-player]` |
| 3 | `journey` | Overview, Balance journey | route, `overview.selectStep('transfers_out')` | `#overview-root #ov-journey-body` | same |
| 4 | `why` | Ask YES drawer, "Why your balance changed" (= *Explain this balance*) | route, `assistant.open({topic:'balance'})` | `#assistant-drawer[open] .asst-turn:last-child .asst-ans__text` | same |
| 5 | `running-balance` | Overview › Why it changed | route, scroll | `#overview-root .ov-chartcard` | same |
| 6 | `fees` | Overview › Why it changed | route, scroll | `#overview-root .ov-fees` | same |
| 7 | `largest` | Overview › Why it changed | route, scroll | `#overview-root .ov-insight` | same |
| 8 | `explorer` | Transactions | route, `explorer.applyFilter({q:'Daniel'})` | `#transactions-root .tx-bar` | same |
| 9 | `detail` | Transaction detail dialog | route, `explorer.openTx('TX-260920-0900')` | `#tx-dialog[open]` | same (full-screen sheet) |
| 10 | `pending` | Overview, balance card notice | route, scroll | `#overview-root .ov-notin` | same |
| 11 | `explain-ai` | Ask YES drawer, transaction answer | route, `assistant.open({topic:'transaction', id:'TX-260909-2051'})` | `#assistant-drawer[open] .asst-turn:last-child .asst-ans__text` | same |
| 12 | `inquiry` | Inquiry dialog | route, `inquiry.start('TX-260924-1327')` | `#inquiry-dialog[open]` | same (sheet) |
| 13 | `assistant` | Ask YES drawer | route, `assistant.ask('fees_paid')` | `#assistant-drawer[open]` | same (sheet) |
| 14 | `basics` | Understand › Bank-issued digital dollar basics | `understand.openTopic('token_units')` | `#understand-root #und-basics` | `#understand-root #und-topic-token_units` |
| 15 | `live-balance` | Understand › Statement vs live | route `#/understand/live` | `#understand-root #und-live` | same |
| 16 | `transparency` | Understand › Reserves and transparency | route `#/understand/transparency` | `#understand-root #und-transparency` | same |
| 17 | `download` | Help › Download or print | `help.open('record')` | `#help-root #help-record .help-dl` | same |
| 18 | `help-record` | Help › Contact support | `help.open('contact')` | `#help-root #help-contact` | same |
| 19 | `integrity` | Help › Statement integrity | `help.open('integrity')` | `#help-root #help-integrity` | same |
| 20 | `language` | Masthead language switch (phone: Menu) | route, `{lang:'es'}`, `{menu:true}` | `#masthead .mast-wide .seg--lang` | `#mast-menu .mast-menu__pref` |
| 21 | `theme` | Masthead Dark mode (phone: Menu) | route, `{theme:'dark'}`, `{menu:true}` | `#masthead .mast-wide [data-theme-toggle]` | `#mast-menu .mast-menu__theme` |
| 22 | `accessibility` | Help › Accessibility | `help.open('accessibility')` | `#help-root #help-accessibility` | same |

Section 5 has the full fallback lists and the measured sizes.

---

## 2. Driving the statement: JS API surface

Everything is on `frameWin.YES`. The frame is same-origin, so `frame.contentWindow.YES` and the DOM are directly usable. All APIs are synchronous unless stated otherwise.

### 2.1 Readiness
- **Ready** when `YES.ready === true`. `YES.on('ready', fn)` fires once at boot. Boot is synchronous at `DOMContentLoaded`, so the statement is ready almost as soon as the frame fires `load`.
- A **frame reload** replaces `frameWin.YES` with a new object; this happens with the integrity preview (§5.19). Always read `frameWin.YES` again, and never cache it.

### 2.2 Routes and views (`YES.nav`)
- Views: `overview | transactions | understand | help`. Each view lives at `section#view-<view>` (the others are `hidden`), and its heading is `#h-<view>`.
- The current view is `YES.state.view`. `YES.nav.current()` returns `{ view, param, params }`.
- Routes:
  - `#/overview[/<stepId>]`;
  - `#/transactions[/<txId>]`, which opens the detail;
  - `#/understand[/<topicId>|basics|live|onchain|transparency]`;
  - `#/help[/<contact|feedback|record|integrity|accessibility|about>]`, with the aliases `download`, `print` and `pdf` for `record`;
  - the integrity preview `#/overview?simulate=mismatch`, which **reloads** the frame.
- `YES.nav.go(view, { param, focus, replace })` navigates and **pushes** a history entry, unless `replace: true`. `YES.nav.setParam(p)` replaces the current entry's sub-route.
- `{route: '#/…'}` driver action. The router listens to `hashchange`. Two safe ways to change the frame's hash from the parent:
  - `frameWin.location.hash = '#/help'`. This pushes a history entry.
  - `frameWin.location.replace(frameWin.location.href.split('#')[0] + '#/help')`. This replaces the entry, still fires `hashchange`, and keeps the joint history flat. The verified driver uses it.
  
  **Never** pass a relative URL to `frameWin.location.replace()` from the parent (see Gotcha G2). Wait until `YES.state.view === view` and `!document.getElementById('view-'+view).hidden`.

### 2.3 Dialogs and drawers

| Surface | Element | Open | Close | Is open |
|---|---|---|---|---|
| Transaction detail | `dialog#tx-dialog` (modal; a full-screen sheet < 720) | `YES.explorer.openTx(id, { trigger?, list? })` | `YES.explorer.closeTx()`: the default `how:'replace'`, **safe**. `{how:'back'}` calls `history.back()` | `#tx-dialog[open]`, `YES.state.selectedTx` |
| Inquiry | `dialog#inquiry-dialog` (modal; sheet < 720) | `YES.inquiry.start(txId, { trigger? })`, `YES.inquiry.resume()` | **No API**: `YES.ui.closeDialog(document.getElementById('inquiry-dialog'))`, then `YES.set({ inquiry: null })` to drop the draft | `#inquiry-dialog[open]`, `YES.state.inquiry` |
| Ask YES | `dialog#assistant-drawer` (in `#assistant-root`) | `YES.assistant.open({ topic, id?, trigger? })`, `YES.assistant.ask(questionId)`, `YES.assistant.askText(text)` | `YES.assistant.close({ returnFocus:false })`, then `YES.set({ assistant: null })` to clear the conversation | `YES.assistant.isOpen()`, `YES.assistant.mode()` → `'docked'\|'modal'\|'stacked'\|null` |
| Any `<dialog>` | – | `YES.ui.openDialog(dlg, opts)` | `YES.ui.closeDialog(dlg, { returnFocus:false })` | `YES.ui.anyModalOpen()`, `html.has-modal` |

- **Assistant topics:** `general`, `balance`, `step` (id = step id), `transaction` (id = tx id), `fees`, `edu` (id = topic id), `chart` and `pending`.
- **Curated question ids:** `why_balance`, `fees_paid`, `largest`, `pending`, `statement_vs_live`, `peg` and `onchain_sent`. `YES.assistant.questions()` lists them.
- **Drawer presentation:**
  - **Docked** and non-modal at ≥ 1100px frame width. It adds `html.assistant-docked`, and the page reflows narrower.
  - A **modal side drawer** from 720 to 1099.
  - A **full-screen sheet** under 720.
  - **Stacked**, a modal on top, when opened while another modal is open.
- **Hand-overs.** The detail's *Explain with AI* and *Ask about this transaction* close the detail first, using `{how:'back'}` internally, then open the drawer or the inquiry.
- **Every `[data-explain]` button** anywhere opens the drawer through a global click handler.

### 2.4 Balance journey (`YES.overview`)
- `YES.overview.selectStep(id)` selects a step and navigates to Overview if needed.
  - Step ids: `deposits`, `transfers_in`, `transfers_out`, `redemptions`, `fees`, and the groups `incoming` and `outgoing`.
  - It sets `YES.state.journeyStep`, pushes `#/overview/<id>` and marks that entry, moves focus to `#ov-panel-title` and smooth-scrolls the panel into view.
  - It also sets `YES.state.filters` to the defaults plus `{ step }`.
- `YES.overview.clearStep()` clears the selection. **Read Gotcha G1 first.**

### 2.5 Transactions (`YES.explorer`)
- `applyFilter(partial, { reset, navigate=true, focus='results'|'heading'|false, announce })` merges into `YES.state.filters` (or starts from the defaults with `reset:true`) and navigates to Transactions. `focus:false` avoids moving focus or scrolling to the results.
- Other calls:
  - `showRows(ids, label)`;
  - `clearFilters({ focus:false })`;
  - `filtered()` returns the current rows;
  - `exportCsv('all'|'filtered')` downloads a file;
  - `csv('all'|'filtered')` returns the CSV text without downloading.
- Filter shape (`YES.defaultFilters()`): `{ q, from, to, direction:'all'|'in'|'out', types[], statuses[], rails[], min, max, step, ids, idsLabel, amountLang }`.
- Sort is `YES.state.sort = { key:'posted'|'initiated'|'amount', dir:'asc'|'desc' }`, with the default `posted/desc`.
- Filter panel state lives in `YES.state.explorer.filtersOpen`. It **only syncs to the DOM** on a filter or sort change, or through the toggle `[data-tx-toggle]`. Below a 960px container the panel is collapsible (`#tx-filter-panel[data-open]`); at 960 and above it is always-visible sidebar and the toggle is hidden.
- Layout: a table (`.tx-table`) when not narrow and the results are ≥ 540px wide, otherwise cards (`.tx-cards`).

### 2.6 Understand (`YES.understand`)
- `openTopic(id)` expands an accordion topic and navigates to `#/understand/<id>`, which smooth-scrolls and focuses it. Topics: `token_units`, `usd_equivalent`, `onchain_vs_internal`, `tx_status`, `fees`, `redemption` and `statement_vs_live`. `openTopic('transparency')` focuses the transparency panel.
- Panels are reached by route: `#/understand/basics|live|onchain|transparency`. This focuses `#und-<panel>-title` and smooth-scrolls to it.
- `contentState(id)` returns `'visible'|'unavailable'`. `evidenceState(id)` returns `'verified'|'stale'|'illustrative'|'unavailable'`.
- State lives in `YES.state.understand = { expanded:[], fullHash:false, meta:{} }`. Setting it re-renders the view.

### 2.7 Help (`YES.help`)
- `open(section)`: sections `contact`, `feedback`, `record`, `integrity`, `accessibility` and `about`. It navigates to `#/help/<section>` and, after `setTimeout(0)`, focuses `#help-<section>-title` and smooth-scrolls the section to the top.
- `downloadPdf()` saves the file and returns the file name. `buildPdf()` returns `{ name, bytes, pages, size }` without downloading. `renderPrint()` refreshes `#print-root`. `sections` lists the section ids.

### 2.8 Language
- `YES.setLang('en'|'es', { silent })` re-renders every module and keeps all state. It writes `sessionStorage['yes.lang']` and emits `lang`.
- Current language: `YES.i18n.lang` (also `<html lang>`). Available: `YES.config.languages` = `['en','es']`. At boot the language comes from `#…?lang=xx`, then `sessionStorage`, then `YES.data.statement.language` (`'en'`).
- The masthead holds the **only** switch. On phones it is in the Menu. Dialogs and the drawer have none.

### 2.9 Theme
- `YES.theme`:
  - `get()` returns the choice, or `null` while following the device;
  - `set('light'|'dark'|null)` stores the choice in `localStorage['yes.theme']`, which is on the **shared origin**;
  - `effective()`, `device()` and `toggle()`.
- The effective theme is mirrored to `<html data-theme>`, and a change emits `theme`. The masthead re-renders on `theme`; an open phone Menu stays open. Print and PDF are always light.

### 2.10 Phone Menu (no API)
- **Phone layout** is active when `#masthead [data-mast-menu]` is displayed, which is below 720px of frame width.
- **Open** by clicking it. The verified driver uses `{menu:true}`, which does `button.click()` when `aria-expanded="false"`. The panel is `#mast-menu`. It contains the four sections (`#mast-menu [data-nav]`), Download or print (`[data-mast-record]`), the language switch (`.mast-menu__pref`) and the theme row (`.mast-menu__theme`).
- **Closes on:** a route change, a click outside, Escape, tabbing out within the frame, or leaving the phone layout.
- **Stays open** on a language or theme switch, and when focus moves to the **parent** page (verified).
- **Close** by clicking the button again while `aria-expanded="true"`.

### 2.11 Video (`YES.overview.video`)
- `play()`, `pause()`, `seek(sec, { play })`, `state()`, `chapters()`, `cues()` and `scriptHash()`.
- `state()` returns `{ t, playing, started, ended, duration:60, cue, chapter, captions, muted, mode:'recorded'|'voice'|'pending'|'none', recording }`.
- It never autoplays, and it pauses on view change, language switch or a hidden document.

### 2.12 Events, state and data
- **Events:** `YES.on(evt, fn)` returns an off function. Events: `state` (changed keys), `route` ({ view, param, params }), `view`, `lang`, `theme`, `rendered`, `ready` and `userway`.
- **State:** `YES.state` holds `lang`, `view`, `journeyStep`, `filters`, `sort`, `selectedTx`, `inquiry`, `assistant`, `feedback`, `overview` (disclosures, cc, muted), `explorer`, `understand` and `help`. Change it with `YES.set({ key: value })`, a shallow replace.
- **Data:** `YES.data` is the canonical statement. Amounts are **integer minor units**, precision 2: `114750` = 1,147.50.
- **Figures:** `YES.calc` provides `posted`, `notInBalance`, `tx`, `categories`, `category`, `groups`, `journey`, `running`, `netChange`, `feesTotal`, `foreignFees`, `largest`, `fiatAvailable`, `fiat`, `feesFor`, `reconcile` and `simulateMismatch`. The release-gate result is `YES.integrity`.
- **Formatters:** `YES.fmt.amount(minor, {sign, unit})` and `YES.fmt.date(iso, style)`. Dates always render in the statement's time zone (EDT), whatever the browser's time zone, so screenshots are deterministic.

---

## 3. Reset (verified)

The reset below returned the statement to a clean state after every feature, at all six sizes, with and without reduced motion, and inside the iframe. Clean means:
- no `dialog[open]`, no `html.has-modal`, no `html.assistant-docked`;
- `journeyStep` null, default filters and sort, `selectedTx` null, no inquiry draft, no assistant thread;
- Menu closed, baseline language and theme, `scrollY` 0, no expanded Understand topics, filter panel closed, video not playing;
- no `#/overview/<step>` or `#/transactions/<id>` left in the address.

The full source is in `driver.js` (section 7). The order matters:

```js
// win = frame.contentWindow; Y = win.YES (re-read after a reload); baseline = { lang, theme }
// 0. Integrity preview: leaving it reloads the frame.
if (doc.documentElement.classList.contains('is-withheld') || (Y.data && Y.data.simulated)) {
  win.location.hash = '#/overview';                      // boot's hashchange listener reloads without ?simulate
  await until(() => win.YES && win.YES.ready && !withheld());   // then re-read win.YES
}
// 1. Phone Menu
if (menuBtn && menuBtn.getAttribute('aria-expanded') === 'true') menuBtn.click();
// 2. Ask YES drawer (docked or modal) and its conversation
if (Y.assistant.isOpen()) Y.assistant.close({ returnFocus: false });
if (Y.state.assistant && (Y.state.assistant.thread || []).length) Y.set({ assistant: null });
// 3. Inquiry dialog (no close API)
if (inquiryDlg.open) Y.ui.closeDialog(inquiryDlg, { returnFocus: false });
// 4. Transaction detail: the default 'replace', never { how: 'back' }
Y.explorer.closeTx();
// 5. Anything else
doc.querySelectorAll('dialog[open]').forEach(d => Y.ui.closeDialog(d, { returnFocus: false }));
await tick();                                            // the async 'close' handlers save the inquiry draft
if (Y.state.inquiry) Y.set({ inquiry: null });           // a draft past step 1 would otherwise survive
// 6. Journey: drop the overview's history marker FIRST (Gotcha G1)
if (Y.state.journeyStep) { win.history.replaceState(null, '', win.location.href); Y.overview.clearStep(); }
// 7. Transactions
if (JSON.stringify(Y.state.filters) !== JSON.stringify(Y.defaultFilters())) Y.explorer.clearFilters({ focus: false });
if (Y.state.sort.key !== 'posted' || Y.state.sort.dir !== 'desc') Y.set({ sort: { key: 'posted', dir: 'desc' } });
if (Y.state.explorer && Y.state.explorer.filtersOpen) doc.querySelector('[data-tx-toggle]').click(); // YES.set alone does not sync the DOM
// 8. Understand
if ((Y.state.understand?.expanded || []).length || Y.state.understand?.fullHash) Y.set({ understand: { expanded: [], fullHash: false, meta: {} } });
// 9. Video
if (Y.overview.video.state().playing) Y.overview.video.pause();
// 10. Language and theme back to the visitor's (theme = the app theme, read at reset time)
if (Y.i18n.lang !== baseline.lang) Y.setLang(baseline.lang, { silent: true });
if (Y.theme.effective() !== baseline.theme) Y.theme.set(baseline.theme);
// 11. Top of the page
await twoFrames(); win.scrollTo(0, 0);
```

Notes:
- The reset does **not** change the view. Every step's setup starts with its own route (or an API that navigates), so this is not needed. It also avoids an extra frame history entry.
- `video.seek()` marks the player as *started*, and there is no API to show the poster again. The reset only pauses. Seek again in the setup if the frame matters.
- After a reset, focus may be left on a hidden element in the frame. That is harmless, because the tour re-focuses its own `h1` (Gotcha G4).

---

## 4. Gotchas: read before writing the driver or the tour

**G1. The statement's `history.back()` moves the PARENT page.** An iframe shares the tab's *joint session history*. Two statement code paths call `history.back()`:
- `YES.overview.clearStep()`, when the current entry is the one `selectStep` pushed. The same path runs when the user clicks *Clear selection* or re-clicks the selected step.
- `closeTx({how:'back'})`, after a detail opened over Transactions. This is the dialog's **X** button, and the hand-over from the detail to the inquiry or Explain with AI.

If the tour has pushed `#/tour/<next>` since, that `back()` takes the **parent** back one step. Verified: after `selectStep`, the parent pushed `#/tour/why`; then `clearStep()` moved the parent back to `#/tour/journey`. Mitigations, both verified:
- Before `clearStep()`, run `frameWin.history.replaceState(null, '', frameWin.location.href)`. This drops the overview's marker, so it uses `replaceState` instead.
- Close the detail with `YES.explorer.closeTx()` (the default `'replace'`). Never use `{how:'back'}`.

User-driven `back()` calls *within* a step are fine: the newest entry is then the frame's own.

Do **not** monkey-patch the frame's `history.pushState` to `replaceState`. `selectStep` would still mark its entry, so the user's *Clear selection* would call `back()` and leave the tour step.

**G2. Relative URLs given to `frameWin.location.replace()` from the parent resolve against the PARENT's address.** `frameWin.location.replace('#/help')` called from the parent page loaded `http://…/index.html#/help`, the tour app itself, into the frame. Use the hash setter, or an absolute URL built from `frameWin.location.href`.

**G3. Schedule the driver's waits on the PARENT's timers.** The integrity preview reloads the frame, and a reload discards the frame's pending `setTimeout` and `requestAnimationFrame` callbacks. A driver that waited on `frameWin.setTimeout` hung forever (verified). Use the parent's `setTimeout` and `requestAnimationFrame`.

**G4. The statement pulls focus into the iframe.** `openTx`, `inquiry.start`, `assistant.open`/`ask`, `selectStep`, `help.open`, `understand.openTopic` and the routes `#/understand/<panel>` and `#/help/<section>` focus something in the frame. Some do it in a deferred `setTimeout(0)`. Afterwards the parent's `document.activeElement` is the iframe (verified for every one of these). The tour must focus its step `h1` **after** `apply()` and the target resolve, and after the scroll settles (G5). Re-focusing the parent did not close the frame's dialogs, drawer or phone Menu (verified). `{lang}`, `{theme}` and `{menu}` do not move focus.

**G5. Smooth scrolling and animations after setup** (880×900, motion allowed, measured):

| Setup | The statement's own scroll settles | Animations end |
|---|---|---|
| `selectStep` | ~590 ms | ~430 ms |
| `help.open(...)` | ~730–760 ms | ~230 ms |
| `understand.openTopic` | ~420 ms | ~220 ms |
| route `#/understand/<panel>` | ~720 ms | – |
| dialogs and drawer | none | ~220–270 ms (fade-in) |

With reduced motion, all of these are instant (≤ 70 ms). If the tour scrolls the target while the statement's smooth scroll is still running, they fight. Wait until `scrollY` is unchanged for about 3 frames (cap 1200 ms) before scrolling and drawing. The statement already scrolls help, understand and journey targets to the top, under its sticky masthead, which is where the tour wants them.

For screenshots, also wait for `document.getAnimations()` to finish, and blur `document.activeElement`. Statement headings and dialog titles receive programmatic focus and show a focus ring.

**G6. The frame's browser history grows.** `{route}` via the hash setter, `help.open`, `understand.openTopic`, `selectStep` and `openTx` over Transactions each **push** an entry in the joint history. The parent's browser **Back** then first steps back through the frame's entries (verified: three Backs to leave two frame navigations). The tour's own Back button uses `WT.go`, so it is unaffected. To keep history flatter, implement `{route}` with `location.replace` on an absolute URL (G2). Shallow API pushes cannot be avoided.

**G7. The assistant docks at ≥ 1100px of frame width.**
- On a 1280 desktop the frame is about 870 wide, so the drawer is a **modal** side drawer on the right, 440px, and the page behind is inert.
- When the app is ≥ ~1540px wide (frame = width − 440 ≥ 1100), and in the 1280×900 screenshots, it **docks**. It is non-modal at 400px, and `html.assistant-docked` reflows the page narrower. Overview targets then move.
- Both modes were verified, and the reset closes both.
- On phones it is a full-screen sheet.

**G8. Layouts depend on the container, not the viewport.**
- Journey: a **list** at the 880 frame, with the selected step's panel inserted under the step. A **waterfall** at 1280, with the panel below. CSS publishes the active layout as `--jr-layout`.
- Transactions filters: collapsible below a 960px container, a sidebar at 960 and above.
- Transaction list: table or cards.

So target sizes differ by width (section 5 gives them). All targets were verified at every size.

**G9. The tablet range gets the phone layout.** For an app 720–1023 wide, the frame is 380–683 wide, so the statement uses its **phone** layout: the Menu, sheets and cards. `isPhone` must use the **frame** width (`frameWin.innerWidth < 720`), not the app's breakpoints.

**G10. The phone tour frame is short (about 390×440).** Below 500px of height, the statement's masthead is **not pinned** (`--masthead-h: 0`). Below 520px, dialogs scroll as one sheet. Below 640px, the drawer compacts. Most targets are taller than the frame there, so align them to the top. All phone targets were verified at 390×440.

**G11. `{menu: true}` must be the last action.** A route change, or any later navigation, closes the Menu.

**G12. The integrity preview reloads the frame.**
- `#/overview?simulate=mismatch` triggers `location.reload()` through boot's `hashchange` listener. After it, `frameWin.YES` is a new object (re-read it), and while withheld only the shell runs.
- Leaving the preview: set the hash to `#/overview`, which reloads again.
- After either reload the tour must **re-apply the app theme** (`frameWin.YES.theme.set(appTheme)`) on the frame's `load` event, as SPEC §5 says.
- Boot logs `console.warn('[YES] statement withheld…')`. It is a warning, not an error.
- `YES.nav.go` carries `?simulate` into later navigation, so always leave the preview explicitly.

**G13. Language and theme persist across reloads.**
- `setLang` writes `sessionStorage['yes.lang']`, so a reloaded frame comes back in the last language.
- `theme.set` writes `localStorage['yes.theme']` on the **app's own origin**, a different key from the app's `infoslips.wt.theme`.
- The "visitor's language before the tour" baseline should be captured when the frame loads, or tracked through `frameWin.YES.on('lang', …)` for changes the driver did not make.

**G14. UserWay is live on the deployed site.** `/statement/*` has no CSP, so online the statement loads `https://cdn.userway.org/widget.js` and shows a launcher at the **bottom left** of the frame (`position: 5`). In tests the network is blocked: `YES.userway.status` is `'unavailable'`, and the Help chip reads "Unavailable offline". Expect different screenshots and the launcher under the overlay online.

**G15. Print and downloads.**
- *Print statement* calls the frame's `print()`, which opens the browser's print dialog for the frame document. Never click it in automation. To show the print layout, use `page.emulateMedia({ media: 'print' })`.
- PDF and CSV are saved through blob links, which work in a same-origin iframe. Playwright needs `acceptDownloads`.
- Full screen on the video works in a same-origin iframe; `document.fullscreenEnabled` is true under the default `'self'` policy.

**G16. Inquiry drafts persist.** Moving past step 1, or picking a reason, a channel or a note, keeps a draft after the dialog closes. The detail then says *Continue your inquiry*, and Help shows the draft. The reset must `YES.set({ inquiry: null })` **after** the dialog's async `close` handler has run (one tick).

**G17. `{theme: 'dark'}` is invisible when the app is already dark.** The statement follows the app theme. For the `theme` step, apply the **opposite** of the app theme, for example by supporting `{ theme: 'toggle' }` or `'opposite'` in the driver, and reset to the app theme.

**G18. Driver `{call}` details.** Call `fn.apply(parentObject, args)`. The statement APIs don't rely on `this`, but `video` and `help` are objects. Arguments built in the parent realm work: the statement uses `Array.isArray` and `JSON`, never `instanceof Array`.

---

## 5. Features, one by one

Each feature lists:
- **Setup:** SPEC §6 driver actions, exactly as verified.
- **Targets:** the first visible match wins.
- **Verified sizes** at 880×900 / 390×844 / 1280×900 / 390×440 / 683×836.
- **Reset and gotchas.**
- **Data shown:** fields from `YES.data`, `YES.calc` and `YES.config` with example values. Amounts are minor units.
- **Try it:** draft panel text, using the statement's real labels.

### 5.1 `summary`: Balance at a glance (overview)
- **What it is.** The first card on the Overview, under "Your September 2026 statement" and the greeting "Hello, Sam…". It shows the closing statement balance in token units, when it was taken, the net change since the opening balance, and an illustrative US-dollar equivalent with its rate, source and time. It has two actions: *Explore transactions* and *Explain this balance*.
- **Where.** View `overview`, `#overview-root section.ov-balance` (the card). The target is its top grid `.ov-balance__grid`. The pending notice (`.ov-notin`, feature `pending`) and *Statement details* (`.ov-details`) sit below it, inside the same card.
- **Setup:** `[{ "route": "#/overview" }]`
- **Targets:** desktop `["#overview-root .ov-balance__grid", "#overview-root .ov-balance"]`; phone the same.
- **Verified sizes:** 782×282 / 316×579 / 1022×268 / 316×579 / 609×362.
- **Reset and gotchas:** nothing to undo. If you want the masked identifiers in view, open *Statement details* with `{ "click": "#overview-root [data-fk=\"ov-details\"]" }`. That is a `<details>`; its state is kept in `YES.state.overview.details`. Reset it with `YES.set({ overview: { ...YES.state.overview, details: false } })` or by clicking it again.
- **Data shown:**
  - `YES.data.statement.closing` = `114750` → hero "1,147.50 USBC";
  - `YES.calc.asset()`: `symbol` "USBC", `name.en` "US Bank Coin", `unitLabel.en` "token units", `precision` 2;
  - `YES.data.statement.asOf` = `2026-09-30T23:59:59-04:00` and `timezone` "America/New_York" → "As of Sep 30, 2026, 11:59 PM EDT (America/New_York)";
  - `YES.calc.netChange()` = `14750` → "+147.50 USBC". With `YES.data.statement.opening` = `100000` and `periodStart` → "Since your opening balance of 1,000.00 USBC on September 1, 2026.";
  - `YES.calc.fiatAvailable()` = `true` (demo mode plus an illustrative rate) and `YES.calc.fiat(114750)` = `114750` → "≈ USD 1,147.50 USD equivalent [Illustrative]";
  - `YES.data.assets.USBC.fiat` = `{ currency:"USD", rate:"1.0000", rateMicros:1000000, source.en:"Illustrative demo rate — not a market quote", at:"2026-09-30T23:59:59-04:00", verified:false, illustrative:true }` → "Rate 1 USBC = 1.0000 USD · Source: … · Sep 30, 2026, 11:59 PM EDT (America/New_York). Shown for reference only; it is not a guarantee of value.";
  - greeting: `statement.customer.firstName` "Sam" and the period "September 1 – 30, 2026";
  - *Statement details* (collapsed): `statement.id` "YES-STM-202609-000184", `version` "1.0", `issueStatus` "original" → "Original", `account.label`, `account.maskedId` "•••• 7316" and `account.walletMasked` "0x5A…E19C" (each with a **Masked** tag), the period start and end, as-of, `generatedAt` "2026-10-01T06:15:00-04:00", the time zone, and the date basis "Posted date · Dates and totals use the posted date."
- **Try it:** "Start at the top of the Overview. The statement balance is shown in tokens, with the exact time it was taken. Beside it are the change since your opening balance and an illustrative US-dollar equivalent. Open **Statement details** to see the statement ID and the masked account and wallet numbers."

### 5.2 `video`: Your statement in 60 seconds (overview)
- **What it is.** An animated, narrated walkthrough drawn in the page from this statement's own figures; it is not a video file. It has five chapters: greeting, opening and closing balance, largest movement, how to inspect a transaction, and where to get help. It has captions (on by default), a transcript, chapters, mute and full screen. It never plays on its own. Narration is an approved **recorded voiceover in English and in Spanish**, packaged in the file. Without a recording, the device voice narrates.
- **Where.** View `overview`, `#overview-root section.ov-video` (the last card). The player is `[data-vp-player]`, with chapters `.ov-vchap__wrap` and the transcript `.ov-vtr`.
- **Setup:** `[{ "route": "#/overview" }, { "call": "overview.video.seek", "args": [20, { "play": false }] }, { "scroll": "#overview-root .ov-video" }]`. Seeking to 20 s shows the "Opening and closing balance" frame with a caption. Without the seek, the player shows its poster frame.
- **Targets:** desktop `["#overview-root .ov-video", "#overview-root [data-vp-player]"]`; phone `["#overview-root [data-vp-player]", "#overview-root .ov-video"]`.
- **Verified sizes:** 832×904 / 356×555 / 1072×1039 / 356×555 / 649×365. The desktop card is slightly taller than the frame, so align it to the top.
- **Reset and gotchas:**
  - The reset pauses with `overview.video.pause()`. `seek` marks the player as started, and there is no way back to the poster.
  - Pressing Play produces **sound** from the recording.
  - The player pauses on view change, language switch and a hidden document.
  - With reduced motion it uses fades and cuts.
- **Data shown:**
  - `YES.overview.video.state()` at 20 s = `{ t:20, playing:false, started:true, ended:false, duration:60, cue:5, chapter:1, captions:true, muted:false, mode:"recorded", recording:"ready" }`;
  - `YES.overview.video.chapters()` = `greet@0` "Personal greeting", `balance@6.6` "Opening and closing balance", `largest@24.5` "Largest meaningful movement", `inspect@35` "How to inspect a transaction", `help@50.4` "Where to get help";
  - `YES.overview.video.cues()` has 14 cues, e.g. "Hello, Sam.", "This is your YES statement for September 1 – 30, 2026.", "You started the period with 1,000.00 USBC." The caption at 20 s is "You closed the period with 1,147.50 USBC." (es: "Cerraste el período con 1.147,50 USBC.");
  - figures: `statement.customer.firstName`, `opening` 100000, `closing` 114750, `YES.calc.groups()` incoming 70000 / outgoing −55250, and `YES.calc.largest()` (+250.00 on Sep 1);
  - `YES.config.slots.VIDEO_VOICEOVER` = `{ en: { src:"data:audio/mpeg;base64,…" (~626 KB), scriptHash:"20e64774", voice:"Sarah" }, es: { …, scriptHash:"9e36f329", voice:"Sarah" } }`. A recording plays only when its `scriptHash` matches `YES.overview.video.scriptHash()`.
- **Try it:** "Press **Play** for a one-minute narrated tour of this statement, built from its own figures. Captions are on, and you can jump to a chapter or open the **Transcript**. Switch to **Español** in the header to hear the recorded Spanish voiceover."

### 5.3 `journey`: Balance journey (overview)
- **What it is.** The signature path from the opening balance to the closing balance, grouped as *Incoming activity* (deposits, incoming transfers) and *Outgoing activity and fees* (outgoing transfers, redemptions, fees). Every step and group is a toggle. Selecting one reveals exactly the transactions behind it, with a sum line proving they add up, and scopes Transactions to the same rows (*Show in Transactions*). Below sit a text equation, "In numbers", and *Show the journey as a table*.
- **Where.** View `overview`, `#overview-root section.ov-journey`. The interactive part is `#ov-journey-body`, and the selected step's panel is `#ov-panel-section`.
- **Setup:** `[{ "route": "#/overview" }, { "call": "overview.selectStep", "args": ["transfers_out"] }]`
- **Targets:** desktop `["#overview-root #ov-journey-body", "#overview-root .ov-journey"]`; phone the same. A compact alternative is the selected step's rows only: `#ov-panel-section` (766×625 at 880).
- **Verified sizes:** 782×1171 / 316×1603 / 1022×1003 / 316×1603 / 609×1266. It is taller than the frame, so align it to the top. The opening balance, the groups and the selected step with its rows are then in view.
- **Reset and gotchas:**
  - `selectStep` pushes `#/overview/transfers_out` and marks the entry. **Reset per G1:** `history.replaceState(null,'',location.href)`, then `YES.overview.clearStep()`, then `YES.explorer.clearFilters({focus:false})`, because selecting a step also sets `filters.step`.
  - Focus moves to `#ov-panel-title`.
  - The panel smooth-scrolls in (~590 ms) and the steps animate (~430 ms).
  - The layout is a list at 880 and a waterfall at 1280 (G8).
  - Valid ids: `deposits`, `transfers_in`, `transfers_out`, `redemptions`, `fees`, `incoming` and `outgoing`.
- **Data shown:**
  - `YES.calc.journey()`:
    - `opening` 100000;
    - `deposits` +50000 (3);
    - `transfers_in` +20000 (3);
    - `transfers_out` −45000 (5);
    - `redemptions` −10000 (1);
    - `fees` −250 (3);
    - `closing` 114750.

    Each step carries `start`/`end` levels.
  - `YES.calc.groups()` = `{ incoming: { total:70000, count:6 }, outgoing: { total:-55250, count:9 } }`.
  - `YES.calc.category('transfers_out')` = `{ total:-45000, count:5, txIds:["TX-260903-1127","TX-260909-2051","TX-260918-2011","TX-260924-1327","TX-260929-1952"] }`.
  - Panel rows (posted date, type label, counterparty, amount): e.g. "Sep 24, 2026 · Sent · Northside Market · −45.50 USBC". The sum line reads "−450.00 USBC … matches Outgoing transfers".
  - Labels: Opening balance, Deposits, Incoming transfers, Outgoing transfers, Redemptions, Fees, Closing balance; Incoming activity; Outgoing activity and fees.
  - Equation: "1,000.00 + 500.00 + 200.00 − 450.00 − 100.00 − 2.50 = 1,147.50 USBC".
- **Try it:** "Select any step in the journey, such as **Outgoing transfers**. You'll see exactly which transactions make it up, and a sum that proves they add up. **Show in Transactions** opens the same rows in the full list. Select the step again, or **Clear selection**, to go back."

### 5.4 `why`: Why it changed (overview → Ask YES)
- **What it is.** A short, plain-language account of what moved the balance: from the opening to the closing balance, what added to it, what took away from it (with fees), and what is pending and therefore not included. It also shows the figures it used. It opens from **Explain this balance** on the balance card. The answer is computed in the browser from approved sentence templates; it is labelled "Demo explanation" and is **not** generated by an AI service.
- **Mapping note.** The statement also has a section headed **"Why it changed"** (`#overview-root .ov-why`, h2 `#ov-why-title`, lede "When your balance moved, what moved it, and what it cost."). It groups the next three features: `running-balance`, `fees` and `largest`. Mention it in this step's text. The balance explanation is used as the target because it *is* the plain-language explanation, matching `32-datareq.js` ("InfoSlips writes the explanation from approved sentence templates").
- **Where.** The Ask YES drawer `dialog#assistant-drawer`, answer "Why your balance changed". In the UI: `#overview-root [data-fk="ov-explain-balance"]`.
- **Setup:** `[{ "route": "#/overview" }, { "call": "assistant.open", "args": [{ "topic": "balance" }] }]`. The equivalent click is `{ "click": "#overview-root [data-fk=\"ov-explain-balance\"]" }`.
- **Targets:** desktop `["#assistant-drawer[open] .asst-turn:last-child .asst-ans__text", "#assistant-drawer[open] .asst-turn:last-child .asst-ans"]`; phone the same. `.asst-ans__text` is the four paragraphs. The whole answer, with its figures table, is about 1,800px tall.
- **Verified sizes:** 365×318 / 316×360 / 325×360 (docked) / 316×360 / 609×192.
- **Reset and gotchas:**
  - `YES.assistant.close({returnFocus:false})`, then `YES.set({assistant:null})`. Without the second call, the thread grows across steps and `:last-child` stays right but the drawer shows old turns.
  - The drawer is **modal** at 880 (the page is inert), docked at ≥ 1100 (G7), and a sheet on phones.
  - Focus moves to the answer heading (`#asst-a1-h`).
- **Data shown:**
  - `statement.opening` 100000 → "1,000.00 USBC" and `statement.closing` 114750 → "1,147.50 USBC";
  - `periodStart` and `periodEnd` → "between September 1, 2026 and September 30, 2026";
  - `YES.calc.netChange()` → "+147.50 USBC";
  - `YES.calc.groups().incoming` = `{ total:70000, count:6, categories:["deposits","transfers_in"] }` → "Incoming activity added 700.00 USBC across 6 transactions: deposits 500.00 USBC and incoming transfers 200.00 USBC.";
  - `YES.calc.groups().outgoing` = `{ total:-55250, count:9 }` → "… outgoing transfers 450.00 USBC, redemptions 100.00 USBC, and fees 2.50 USBC.";
  - `YES.calc.notInBalance()` = `[{ id:"TX-260930-2247", amount:-3000, status:"pending" }]` → "1 transaction of 30.00 USBC was still pending at the statement cut-off…";
  - a *Figures used* table (the `YES.calc.categories()` totals), and the source line "as of".
- **Try it:** "Select **Explain this balance** on the balance card. The statement explains, in plain words, what added to your balance, what took away from it, and what is still pending, and lists the figures it used. Further down the Overview, **Why it changed** shows the same story as a chart, your fees and your largest movement."

### 5.5 `running-balance`: Running balance chart (overview)
- **What it is.** A step chart of the balance after each posted transaction across the period. Incoming and outgoing markers are told apart by shape and icon, not by colour alone. It has a hover/focus crosshair and tooltip, keyboard-navigable points (each opens its transaction), a summary sentence, and *Show the chart data as a table*. Pending transactions are never plotted.
- **Where.** View `overview`, inside *Why it changed*: `#overview-root section.ov-chartcard`. The figure is `.ov-chart`, the plot `#ov-chart-plot`, the points `[data-ov-pt]`, and the table toggle `[data-fk="ov-ctable"]`.
- **Setup:** `[{ "route": "#/overview" }, { "scroll": "#overview-root .ov-chartcard" }]`
- **Targets:** desktop `["#overview-root .ov-chartcard"]`; phone the same.
- **Verified sizes:** 832×553 / 358×665 / 1072×553 / 358×665 / 651×566.
- **Reset and gotchas:**
  - Nothing to undo. If the table was opened, `YES.state.overview.chartTable` keeps it open; reset it with `YES.set({ overview: { ...YES.state.overview, chartTable: false } })`.
  - The plot draws at its own width through a ResizeObserver. It was verified drawn (`#ov-chart-plot svg`, 15 points) even when the frame booted on another view.
- **Data shown:**
  - `YES.calc.running()` gives 15 points `{ txId, at, delta, balance, stated }`, plus the opening point (`statement.opening` 100000 on `periodStart`). The first point is `{ txId:"TX-260901-0418", at:"2026-09-01T09:02:00-04:00", delta:25000, balance:125000, stated:125000 }`; the last is `{ txId:"TX-260929-1952", delta:-2450, balance:114750 }`.
  - The minimum is 97400 and the maximum 125000. The summary reads "Your balance was highest at 1,250.00 USBC on September 1, 2026 and lowest at 974.00 USBC on September 9, 2026. It closed the period at 1,147.50 USBC."
  - The tooltip and table show the date and time (EDT), the type label and the masked counterparty, the change, and the balance after.
- **Try it:** "Move along the chart, or tab to its points, to see each movement and the balance after it. Select a point to open that transaction. **Show the chart data as a table** lists the same figures."

### 5.6 `fees`: Fees this period (overview)
- **What it is.** Every fee in one card: the total, the count, and each fee line with what it was for and its date. Each fee is its own ledger line linked to the transaction it belongs to. Fees in another asset would be listed separately and never subtracted; there are none here. Actions: *Show fees in the journey* and *Explain with AI*.
- **Where.** View `overview`, inside *Why it changed*: `#overview-root section.ov-fees`.
- **Setup:** `[{ "route": "#/overview" }, { "scroll": "#overview-root .ov-fees" }]`
- **Targets:** desktop `["#overview-root .ov-fees"]`; phone the same.
- **Verified sizes:** 434×569 / 358×552 / 563×480 / 358×552 / 651×464.
- **Reset and gotchas:** nothing to undo. *Show fees in the journey* calls `selectStep('fees')`, so G1 applies if the user clicks it.
- **Data shown:**
  - `YES.calc.category('fees')` = `{ total:-250, count:3, txIds:["TX-260909-2052","TX-260912-0806","TX-260920-0901"] }` → "Total fees −2.50 USBC · 3 fees". `YES.calc.feesTotal()` = −250.
  - The fee rows, `YES.calc.tx(id)`:
    - `{ amount:-100, feeKind:"network_transfer", parentId:"TX-260909-2051", postedAt:"2026-09-09T10:34", description.en:"Fee for sending to an external wallet" }`;
    - `{ -50, "card_deposit", parent "TX-260912-0805", "Fee for depositing by debit card" }`;
    - `{ -100, "redemption", parent "TX-260920-0900", "Fee for redeeming tokens" }`.
  - `YES.calc.foreignFees()` = `[]` → "Fees in other assets: none".
- **Try it:** "See every fee for the period, what each one was for and the total. Select a fee to open it and the transaction it belongs to, or choose **Show fees in the journey**."

### 5.7 `largest`: Your largest movement (overview)
- **What it is.** An "Insight" card that names the single biggest posted movement of the period (fees excluded), with *View this transaction* and *What are token units?*.
- **Where.** View `overview`, inside *Why it changed*: `#overview-root section.ov-insight`.
- **Setup:** `[{ "route": "#/overview" }, { "scroll": "#overview-root .ov-insight" }]`
- **Targets:** desktop `["#overview-root .ov-insight"]`; phone the same.
- **Verified sizes:** 378×295 / 358×311 / 489×243 / 358×311 / 651×211.
- **Reset and gotchas:** nothing to undo. *View this transaction* opens the detail over the Overview, which pushes no history. *What are token units?* calls `understand.openTopic('token_units')`.
- **Data shown:** `YES.calc.largest()` = `{ id:"TX-260901-0418", type:"deposit", amount:25000, postedAt:"2026-09-01T09:02:00-04:00", description.en:"Deposit from linked bank account", counterparty.en:"Linked bank account •••• 4821" }` → "The largest single movement this period was +250.00 USBC on September 1, 2026: Deposit from linked bank account."
- **Try it:** "The statement picks out your biggest movement of the period. Select **View this transaction** to see its details."

### 5.8 `explorer`: Transaction search and filters (transactions)
- **What it is.** Every transaction for the period, posted or not (16), in a compact table or, on small screens, readable cards.
  - Free-text search covers description, counterparty, memo, type, status, rail, reference, transaction ID and amount.
  - Filters: date range on the posted date, direction, type, status, rail, and amount minimum and maximum. Each filter shows a count of matches.
  - Sort by posted date, initiated date or amount, in either order.
  - Active filters appear as removable chips, with *Clear all*.
  - A filtered total, and a CSV of the current view.
- **Where.** View `transactions`, `#transactions-root`:
  - the search and tools bar `.tx-bar` (`#tx-q`, `[data-tx-toggle]`, `#tx-sort`);
  - the filter panel `#tx-filter-panel`;
  - the chips `#tx-chips`;
  - the results `#tx-results` (`.tx-table` or `.tx-cards`);
  - the export card `.tx-export`.
- **Setup:** `[{ "route": "#/transactions" }, { "call": "explorer.applyFilter", "args": [{ "q": "Daniel" }, { "reset": true, "focus": false }] }]`
- **Targets:** desktop `["#transactions-root .tx-bar", "#transactions-root"]`; phone the same. The chips and the 2 matching rows sit directly under the bar. Other measured parts at 880: `.tx-layout` 832×421, `#tx-results` 832×361.
- **Verified sizes:** 832×196 / 358×240 / 1072×110 / 358×240 / 651×196. At 1280 the filters are an always-visible sidebar, so the bar is a single row.
- **Reset and gotchas:**
  - `YES.explorer.clearFilters({focus:false})`, and restore the sort if it changed.
  - To show the filter panel open, click `[data-tx-toggle]` (only below a 960px container). Alternatively, call `{ "call": "set", "args": [{ "explorer": { "filtersOpen": true } }] }` **before** a filter change, because `YES.set` alone does not sync the DOM.
  - The reset closes an open panel by clicking the toggle (verified).
  - `applyFilter` with `focus:false` still navigates and announces the count.
- **Data shown:**
  - `YES.state.filters` = `{ q:"Daniel", from:"", to:"", direction:"all", types:[], statuses:[], rails:[], min:"", max:"", step:null, ids:null, idsLabel:null, amountLang:null }` and `YES.state.sort` = `{ key:"posted", dir:"desc" }`.
  - `YES.explorer.filtered()` → `["TX-260929-1952","TX-260903-1127"]`; "Showing 2 of 16 transactions"; chip "Search: “Daniel”".
  - `YES.calc.all().length` = 16.
  - Per row: `postedAt` (or "Initiated …" when not posted), `description`, `type` label, `counterparty` (masked), `memo`, `status`, `amount`, `balanceAfter`.
  - The caption: "Order: Posted date, newest first · Dates: posted date · Amounts in USBC · Times in EDT (America/New_York)".
- **Try it:** "Type a name, amount or reference into **Search transactions**; try *Daniel*. Open **Filters** to narrow by date, direction, type, status, rail or amount, and use **Sort by** to order by posted date, initiated date or amount. Each filter appears as a chip you can remove."

### 5.9 `detail`: Transaction details (transactions)
- **What it is.** The detail for one transaction:
  - the signed amount and its unit, the status, and both dates (posted and initiated, in EDT);
  - the type, with the canonical event type;
  - the rail and method;
  - the **masked counterparty** ("Linked bank account •••• 4821", which screen readers hear as "ending in 4821");
  - the description and memo, the balance after, and the reference and transaction ID, each with Copy;
  - the fee as its own linked line ("Open fee line"), and the total with fees;
  - notes, and for on-chain rails the illustrative network reference.

  Previous and Next move within the list it was opened from. *Explain with AI* and *Ask about this transaction* are in the footer.
- **Where.** `dialog#tx-dialog`: a centred modal on desktop, a full-screen sheet below 720. Over Transactions it routes to `#/transactions/<id>`.
- **Setup:** `[{ "route": "#/transactions" }, { "call": "explorer.openTx", "args": ["TX-260920-0900"] }, { "wait": "#tx-dialog[open] #tx-dialog-title" }]`. TX-260920-0900 is a redemption with two different dates, a masked bank account, a linked fee and a note. Use TX-260909-2051 to show the on-chain section, and TX-260901-0418 for the "Previous period" initiated tag.
- **Targets:** desktop `["#tx-dialog[open]"]`; phone the same. The parts are `.tx-dlg__body`, the details list `.tx-kv`, the fees `.tx-fees` and the notes `.tx-notes`.
- **Verified sizes:** 680×792 / 390×844 / 680×792 / 390×440 / 683×836.
- **Reset and gotchas:**
  - `YES.explorer.closeTx()` with the default replace (**never** `{how:'back'}`, per G1).
  - Opening over Transactions pushes a history entry. Opened over another view it opens in place, with no push.
  - The dialog is modal, so the page behind is inert.
  - Focus moves to `#tx-dialog-title`.
  - The fade-in takes ~270 ms.
- **Data shown:** `YES.calc.tx("TX-260920-0900")` =
  - `type:"redemption"` → "Redeemed" (event type `redemption`);
  - `status:"posted"`;
  - `postedAt:"2026-09-20T09:00:00-04:00"` → "Sep 20, 2026, 9:00 AM EDT";
  - `initiatedAt:"2026-09-19T15:30:00-04:00"` → "Sep 19, 2026, 3:30 PM EDT";
  - `rail:"other"` and `method:"bank_payout"`;
  - `counterparty.en:"Linked bank account •••• 4821"`;
  - `description.en:"Redeemed tokens for US dollars paid to your bank"`;
  - `amount:-10000` → "−100.00 USBC";
  - `balanceAfter:99350` → "993.50 USBC";
  - `reference:"REF-X1R7-5GN2"`;
  - `fees:[{ asset:"USBC", amount:100, kind:"redemption", feeTxId:"TX-260920-0901" }]`, with `YES.calc.feesFor("TX-260920-0900")` = `[{ id:"TX-260920-0901", amount:-100 }]`;
  - `notes[0].en:"Requested on 19 September and posted on 20 September."`;
  - the sections "Details", "Fees" and "Notes".

  `YES.state.selectedTx` = "TX-260920-0900". On-chain example: `YES.calc.tx("TX-260909-2051").onchain` = `{ network.en:"Example Network (illustrative)", hashDisplay:"0xDE40…E19C", confirmations:64, verified:false, illustrative:true }`.
- **Try it:** "Select any transaction to open its details: when it was started and when it posted, its reference (with **Copy**), the balance after it, and any fee as its own linked line. Account numbers are masked. Use the arrows to move to the previous or next transaction."

### 5.10 `pending`: Pending transactions (transactions)
- **What it is.** Movements that started but had not posted at the cut-off. They are listed, but never counted in the balance, the journey or the chart, and they are labelled explicitly.
  - On the Overview, a notice in the balance card: "1 pending transaction (−30.00 USBC) is not included in this balance." It has *View transaction* and *Explain with AI*.
  - In Transactions, the row is marked "Not included in statement balance", has no balance after ("—"), and a note sits above the list.
  - A pending redemption reads "Redemption requested", never "Redeemed".
- **Where.** View `overview`, `#overview-root .ov-notin`. In Transactions, `[data-tx-row="TX-260930-2247"]` and `.tx-pending-note`.
- **Setup:** `[{ "route": "#/overview" }, { "scroll": "#overview-root .ov-notin" }]`
- **Targets:** desktop `["#overview-root .ov-notin"]`; phone the same. Alternative in Transactions: route `#/transactions`, target `#transactions-root [data-tx-row="TX-260930-2247"]` (830×135 at 880).
- **Verified sizes:** 782×126 / 316×287 / 1022×99 / 316×287 / 609×193.
- **Reset and gotchas:** nothing to undo.
- **Data shown:**
  - `YES.calc.notInBalance()` = `[{ id:"TX-260930-2247", type:"redemption", status:"pending", amount:-3000, initiatedAt:"2026-09-30T22:47:00-04:00", postedAt:null, balanceAfter:null }]`;
  - `description.en` "Redemption request awaiting bank settlement";
  - `notes[0].en` "Pending at the statement cut-off, so it is not included in this statement balance. If it completes, it will appear on your next statement.";
  - shown as "Pending · Redemption request awaiting bank settlement · initiated Sep 30, 2026, 10:47 PM".
- **Try it:** "A redemption you requested on the last evening hadn't settled by the cut-off. The statement lists it but leaves it out of the balance, and says so. Select **View transaction** or **Explain with AI** to see why."

### 5.11 `explain-ai`: Explain with AI (transactions)
- **What it is.** A plain-language explanation of any transaction. It covers what happened, the balance before and after, the rail, any linked fee and any illustrative network reference. It includes a *Figures used* table and the supporting rows (each one opens), *Ask about this transaction*, *Was this helpful?*, and *Talk to a person*.
- **Entry points.** Every **Explain with AI** button (`[data-explain]`): on the transaction detail, the balance card, a journey step panel, the chart, fees, the pending notice, and Understand topics. In this demo the answer is computed in the browser from the statement and labelled "Demo explanation". Production would use a governed AI service.
- **Where.** The Ask YES drawer `dialog#assistant-drawer`, a context answer for a transaction.
- **Setup:** `[{ "route": "#/transactions" }, { "call": "assistant.open", "args": [{ "topic": "transaction", "id": "TX-260909-2051" }] }]`. The UI path is `explorer.openTx('TX-260909-2051')`, then `{ "click": "#tx-dialog [data-fk=\"txd-explain\"]" }`; the detail closes itself first.
- **Targets:** desktop `["#assistant-drawer[open] .asst-turn:last-child .asst-ans__text", "#assistant-drawer[open] .asst-turn:last-child .asst-ans"]`; phone the same. The figures table is `.asst-figs` (365×487) and the rows `.asst-rows` (365×189).
- **Verified sizes:** 365×268 / 316×331 / 325×331 / 316×331 / 609×184.
- **Reset and gotchas:** as for `why`: close, then `YES.set({assistant:null})`. The `[data-explain]` hand-over from the detail uses `{how:'back'}` internally. That is safe inside a step (the newest entry is the frame's own), but don't script it after the tour has pushed.
- **Data shown:**
  - `YES.calc.tx("TX-260909-2051")`: `amount:-20000` → "−200.00 USBC", and `postedAt` → "posted on September 9, 2026 at 10:34 AM EDT";
  - the balance before 117500 and after 97500, from `YES.calc.running()` / `balanceAfter` → "taking your statement balance from 1,175.00 USBC to 975.00 USBC";
  - `rail:"onchain"` and `method:"network_send"`;
  - `onchain` `{ network:"Example Network (illustrative)", hashDisplay:"0xDE40…E19C", confirmations:64, verified:false }` → "marked ‘Illustrative reference — no live blockchain verification’";
  - the linked fee `YES.calc.feesFor` → TX-260909-2052 −100 → "A separate network transfer fee of 1.00 USBC (TX-260909-2052) was charged for it.";
  - `counterparty` "External wallet 0x9C1D…44B7" and `reference` "REF-N8C4-2VB9";
  - the thread `YES.state.assistant.thread[0]` = `{ topic:"transaction", tid:"TX-260909-2051", via:"context", id:"a1" }`.
- **Try it:** "Open any transaction and select **Explain with AI**. You get a short explanation built from that transaction's own figures, with the rows it used and a way to ask about the transaction. In this demo it is worked out in your browser, and nothing is sent anywhere."

### 5.12 `inquiry`: Ask about a transaction (transactions)
- **What it is.** A four-step guided question about one transaction: **Transaction → Details → Review → Confirmation**.
  - The transaction and its reference are carried in.
  - Only the reasons that fit the transaction are offered. A pending one adds "It's still pending".
  - There is an optional note (≤ 500 characters, with a warning not to share passwords or account numbers) and a preferred reply channel.
  - No contact details are asked for.
  - The draft survives closing and language switches.
  - The confirmation says "Demo only — no inquiry was sent" and gives a fictional local reference.
  
  It explains the difference from a formal dispute and from a fraud report.
- **Where.** `dialog#inquiry-dialog`: modal on desktop, a sheet below 720. Entry points: the detail's *Ask about this transaction* (`[data-txd-ask]`), assistant transaction answers (`[data-asst-inquiry]`) and Help (*Continue your inquiry*).
- **Setup:** `[{ "route": "#/transactions" }, { "call": "inquiry.start", "args": ["TX-260924-1327"] }, { "wait": "#inquiry-dialog[open] #inquiry-dialog-title" }]`. Optionally show step 2 with `{ "click": "#inquiry-dialog [data-inq-next]" }`.
- **Targets:** desktop `["#inquiry-dialog[open]"]`; phone the same.
- **Verified sizes:** 640×773 / 390×844 / 640×773 / 390×440 / 683×836.
- **Reset and gotchas:** there is **no close API**. Use `YES.ui.closeDialog(document.getElementById('inquiry-dialog'), {returnFocus:false})`, wait one tick, then `YES.set({ inquiry: null })` (G16). The dialog has no language switch; its language is fixed when it opens. Focus moves to `#inquiry-dialog-title`.
- **Data shown:**
  - `YES.state.inquiry` = `{ txId:"TX-260924-1327", step:"transaction", reason:"", description:"", channel:"", status:"draft", ref:null, attempt:1, seq:1, errors:null, notice:null, prior:null, others:{} }`.
  - The transaction card: type "Sent", `description` "Payment to a YES merchant", `amount` −4550 → "−45.50 USBC", `counterparty` "Northside Market", posted "Sep 24, 2026, 1:27 PM", status, `reference` "REF-M8Q2-4DK9" and `id`.
  - Reasons for this transaction: `unrecognized` ("I don't recognize this transaction"), `amount` ("The amount looks wrong") and `other` ("Something else"). A pending transaction adds `pending`.
  - Channels: `in_app`, `email` and `phone`.
  - `YES.inquiry.draftFor(txId)` → `null` until the user touches the draft.
- **Try it:** "In a transaction's details, select **Ask about this transaction**. Check the transaction, choose a reason, add a note if you like, pick how YES should reply, then review and send. In this demo nothing is sent; you get a demo reference."

### 5.13 `assistant`: Ask YES assistant (everywhere)
- **What it is.** A built-in assistant that answers questions about *this* statement.
  - It offers seven suggested questions, or the customer can type their own (≤ 200 characters).
  - Every answer shows the figures and transactions it used, with *Show these rows in Transactions*.
  - It has *Was this helpful?*, *Talk to a person*, *Read more in Understand* and a privacy notice ("Answers are computed in this browser… Nothing you ask is sent anywhere").
  - Questions outside the statement get an honest "can't answer" with suggestions.
  - A question typed in the other language is answered in that language.
  
  It is docked beside the page on wide screens, a side drawer on tablets and laptops, and full screen on phones.
- **Where.** Masthead **Ask YES** (`#masthead [data-ask]`, "Ask" on phones) and Help › Ask YES. The drawer is `dialog#assistant-drawer`.
- **Setup:** `[{ "route": "#/overview" }, { "call": "assistant.ask", "args": ["fees_paid"] }]`. Use `assistant.open({topic:'general'})` for just the welcome and suggestions.
- **Targets:** desktop `["#assistant-drawer[open]"]`; phone the same. The parts are the suggestions `.asst-sugg`, the composer `.asst__form` and the privacy notice `.asst__privacy`.
- **Verified sizes:** 440×900 (modal) / 390×844 (sheet) / 400×900 (**docked**) / 390×440 / 683×836.
- **Reset and gotchas:** close, then `YES.set({assistant:null})`. G7 applies: when docked the page reflows, and when modal the page is inert. Escape closes a docked drawer.
- **Data shown:**
  - `YES.assistant.questions()` = `["why_balance","fees_paid","largest","pending","statement_vs_live","peg","onchain_sent"]` → "Why did my balance change?", "What did I pay in fees?", "What was my largest movement?", "What is pending?", "Is my statement balance my live balance?", "Is each USBC always worth one US dollar?", "Where did I send money on-chain?".
  - The `fees_paid` answer is titled "What you paid in fees", from `YES.calc.category('fees')` and the fee rows.
  - `YES.assistant.mode()` returns "modal" at 880 and "docked" at 1280.
  - `YES.state.assistant` = `{ open, seq, thread[], helpful{}, expanded{}, privacyOpen, draft }`.
- **Try it:** "Select **Ask YES** at the top of the statement. Pick a suggested question or type your own, such as *What did I pay in fees?* Each answer shows the figures and transactions it used, and you can always choose **Talk to a person**."

### 5.14 `basics`: Bank-issued digital dollar basics (understand)
- **What it is.** Short, plain-language explanations of seven terms used in the statement. It acts as the statement's **glossary**. Each topic has an *In your statement* example built from the customer's own figures, an *Explain with AI* button, and its content record: copy ID, version, source, owner, validity and visibility rule, the way approved copy would be governed.
- **Where.** View `understand`, `#understand-root section#und-basics`. The accordion is `.und-acc`, an item is `#und-topic-<id>` and a panel is `#und-panel-<id>`.
- **Setup:** `[{ "call": "understand.openTopic", "args": ["token_units"] }]`. This navigates to `#/understand/token_units`, expands the topic and smooth-scrolls to it.
- **Targets:** desktop `["#understand-root #und-basics"]`; phone `["#understand-root #und-topic-token_units", "#understand-root #und-basics"]`.
- **Verified sizes:** 832×1104 / 316×837 / 1072×1104 / 316×837 / 609×663 (the phone target at 683).
- **Reset and gotchas:** `YES.set({ understand: { expanded: [], fullHash: false, meta: {} } })`, which re-renders the view. The scroll takes ~420 ms. Focus moves to `#und-btn-token_units`.
- **Data shown:**
  - `YES.understand.topics` = `["token_units","usd_equivalent","onchain_vs_internal","tx_status","fees","redemption","statement_vs_live"]` → "Token units", "USD equivalent", "On-chain versus internal transfers", "Transaction status", "Fees", "Redemption", "Statement balance versus live balance";
  - `YES.understand.contentState(id)` = "visible" for all seven;
  - the token-units example: `statement.closing` → "1,147.50 USBC", `asset.precision` 2 → "Smallest unit: 0.01 USBC", and the smallest posted amount → "−0.50 USBC · Fee for depositing by debit card";
  - the content record: "EDU-001-TOKEN-UNITS · Demo copy — pending YES approval", validity 2026-09-01 to 2027-03-31;
  - `YES.state.understand` = `{ expanded:["token_units"], fullHash:false, meta:{} }`.
- **Try it:** "Open any topic, such as **Token units**, for a short explanation with an example from your own statement. **Expand all** opens every topic, and **Explain with AI** asks YES about it."

### 5.15 `live-balance`: Statement balance versus live balance (understand)
- **What it is.** It explains why the statement balance can differ from the balance in the app today.
  - It sets the fixed *Statement snapshot* (closing balance, as-of time, period, "Fixed for this period — it does not change") beside a separate *Live account data* area. That area is "Not connected" in this demo; in production it would show the current balance and when it was checked.
  - A *Why the two could differ* list names the pending redemption, with a button to open it.
  
  The same idea is the accordion topic `statement_vs_live` and the assistant question "Is my statement balance my live balance?".
- **Where.** View `understand`, `#understand-root section#und-live`. The parts are `.und-live__snap` and `.und-live__live`.
- **Setup:** `[{ "route": "#/understand/live" }]`
- **Targets:** desktop `["#understand-root #und-live"]`; phone the same.
- **Verified sizes:** 404×1079 (it pairs side by side with the on-chain panel at 880) / 358×1181 / 524×946 / 358×1181 / 651×844.
- **Reset and gotchas:** nothing to undo. The route focuses `#und-live-title` and smooth-scrolls (~720 ms).
- **Data shown:**
  - `statement.closing` 114750 → "1,147.50 USBC";
  - `statement.asOf` → "As of Sep 30, 2026, 11:59 PM EDT", and the period "September 1 – 30, 2026";
  - `YES.config.features.liveBalance` = `false` → "Live balance: Not available · Last updated: [Timestamp appears here when connected]";
  - `YES.calc.notInBalance()` → "“Redemption request awaiting bank settlement” for −30.00 USBC was pending at the cut-off, so it is not in the statement balance…".
- **Try it:** "Compare the statement balance, a fixed record as of 30 September, with the separate live balance area (not connected in this demo). The panel lists what explains the difference, such as the pending redemption."

### 5.16 `transparency`: Reserves, transparency and on-chain reference (understand)
- **What it is.**
  - **Reserves and transparency:** where verified facts about the bank-issued digital dollar would appear, each with its source, date and owner. The facts are the approved issuer, reserve report, attestation date, redemption terms and source link. Today they are placeholders, clearly labelled "Illustrative layout; no reserve assertion".
  - It also gives three production rules, and an example of what a customer sees when evidence is unavailable.
  - **On-chain reference** (a separate panel, `#und-onchain`): one sample network reference for an on-chain transfer. It shows the network, the hash (with Copy and *Show full hash*), the confirmations and "Not verified", says there is no explorer link, and has a button to open the transaction.
- **Where.** View `understand`: `#understand-root section#und-transparency` and `section#und-onchain` (route `#/understand/onchain`).
- **Setup:** `[{ "route": "#/understand/transparency" }]`
- **Targets:** desktop `["#understand-root #und-transparency"]`; phone the same. For the on-chain panel use route `#/understand/onchain` and target `#understand-root #und-onchain` (404×1079 at 880).
- **Verified sizes:** 832×1106 / 358×1838 / 1072×958 / 358×1838 / 651×1236.
- **Reset and gotchas:** nothing to undo. *Show full hash* sets `YES.state.understand.fullHash`, which the reset clears.
- **Data shown:**
  - `YES.understand.evidenceState(id)` = "illustrative" for `issuer`, `reserve_report`, `attestation_date`, `redemption_terms`, `source_link`, `onchain_reference` and `transparency_panel`, and "unavailable" for `attestation_example`;
  - `YES.config.slots.ISSUER_OR_PARTNER.en` = "[Issuer or partner — pending YES approval]", and the record IDs "EVD-201-ISSUER" to "EVD-205-SOURCE-LINK";
  - `YES.config.features.verifiedEvidence` = `false`;
  - `YES.calc.tx("TX-260909-2051").onchain` = `{ network.en:"Example Network (illustrative)", hash:"0xDE40…(64 hex)…E19C", hashDisplay:"0xDE40…E19C", confirmations:64, verified:false, illustrative:true }`.
- **Try it:** "See where verified facts about reserves and the issuer would appear, each with its source and date. They are placeholders in this demo. **On-chain reference** shows a sample network reference with **Copy** and **Show full hash**. Nothing here links to a real blockchain explorer."

### 5.17 `download`: Download, print, PDF and CSV (help)
- **What it is.** Every way to keep the statement of record, side by side:
  - **Print**: a dedicated print layout, always light, with the demo watermark;
  - **PDF file**: a statement of record drawn by the statement's own PDF writer, in the current language; Letter in English, A4 in Spanish;
  - **Spreadsheet (CSV)**: the complete record, all 16 transactions with the statement facts on every row.

  Files are created on the device, offline. Transactions has the same options plus *Download CSV — current view*.
- **Where.**
  - Help › *Download or print*: `#help-root section#help-record`, options `.help-dl`.
  - The masthead *Download or print* button: `#masthead [data-mast-record]` ("Download" below 880; on phones, Menu → Download or print). It calls `YES.help.open('record')`.
  - The Transactions export card `#transactions-root .tx-export`.
- **Setup:** `[{ "call": "help.open", "args": ["record"] }]`
- **Targets:** desktop `["#help-root #help-record .help-dl", "#help-root #help-record"]`; phone the same.
- **Verified sizes:** 782×330 / 316×598 / 774×330 / 316×598 / 609×393.
- **Reset and gotchas:** nothing to undo. Don't click Print in automation (G15). The scroll settles in ~760 ms, and focus moves to `#help-record-title`.
- **Data shown:**
  - `YES.help.buildPdf()` = `{ name:"YES-statement-YES-STM-202609-000184-DEMO.pdf", pages:3, size:"letter" }` (about 31 KB). In Spanish `size:"a4"`.
  - `YES.explorer.csv('all')` has 33 columns: Statement ID, Transaction ID, Posted date and time, Initiated date and time, Time zone, Event type, Type, Description, Counterparty, Memo, Direction, Amount, Asset, Balance after, Status, Included in statement balance, Rail, Method, Reference, Related transaction ID, Statement version, Issue status, Period start, Period end, Statement as of, Generated, Date basis, Opening balance, Closing balance, Export scope and Data classification.
  - The CSV has 16 data rows and a UTF-8 BOM, and formula injection is neutralised. The file is "YES-STM-202609-000184_complete-record_DEMO.csv".
  - The print view `#print-root` shows the customer `statement.customer.displayName` "Sam Ortega" and `address[]`, and the account `•••• 7316`.
  - The option titles are "Print", "PDF file" and "Spreadsheet (CSV)".
- **Try it:** "Choose **Print statement**, **Download PDF** or **Download CSV — complete record**. The files are made on your device, and nothing is sent. You'll also find these under **Download or print** at the top of every page."

### 5.18 `help-record`: Help and statement record (help)
- **What it is.** The Help page, "Help and statement record".
  - **Contact support:** phone, email and hours (placeholders, labelled), and chat status. It also explains the three routes: a *transaction inquiry*, a *formal dispute*, and *fraud or unauthorized activity*.
  - A one-question **Feedback** prompt: "How clear was this statement?" with four ratings and an optional comment. It is saved for this browser session only.
  - The **statement record facts**: ID, version, issue status (Original or Corrected), period, generated and as-of times, time zone and date basis.
  - Quick help cards ("Question about a transaction?", "Ask YES", resume an inquiry draft), and *About this demo* (what is connected or illustrative, and the brand slots).
- **Where.** View `help`: `#help-root section#help-contact`, `#help-feedback` and `#help-record .help-kv`. The other parts are `.help-quick`, the table of contents `.help-toc` and `#help-about`.
- **Setup:** `[{ "call": "help.open", "args": ["contact"] }]`
- **Targets:** desktop `["#help-root #help-contact"]`; phone the same.
- **Verified sizes:** 832×895 / 358×1605 / 824×895 / 358×1605 / 651×1125.
- **Reset and gotchas:** nothing to undo. Submitted feedback lives in `YES.state.feedback.clarity` and `YES.state.help`, for the session only. Clear them with `YES.set({ feedback: {}, help: {} })` if a step writes them.
- **Data shown:**
  - `YES.config.support` = `{ phone:"+1 (555) 010-0142", email:"help@example.com", hours.en:"Mon–Fri, 8 am–8 pm ET (placeholder)", chatAvailable:false, connected:false }`;
  - the record facts: `statement.id` "YES-STM-202609-000184", `version` "1.0", `issueStatus` "original" → "Original", the period "September 1 – 30, 2026", `generatedAt` → "Oct 1, 2026, 6:15 AM EDT", `asOf` → "Sep 30, 2026, 11:59 PM EDT", the time zone "EDT (America/New_York)", and the date basis "Posted date";
  - feedback ratings `very_clear`, `mostly_clear`, `little_confusing` and `confusing`;
  - `YES.help.sections`.
- **Try it:** "See how a customer would reach YES, and how an inquiry differs from a formal dispute or a fraud report. Further down, rate how clear the statement was, and check the statement's ID, version and dates."

### 5.19 `integrity`: Built-in integrity check (everywhere)
- **What it is.** Before anything is shown, the statement checks its own numbers. There are nine checks:
  - unique IDs;
  - exact precision;
  - a single asset;
  - every posted date inside the period;
  - opening + movements = closing;
  - every running balance;
  - every transaction in exactly one category;
  - fee links in both directions;
  - pending items excluded from the balance.

  Help shows the equation and the nine checks ("9 of 9 checks passed"). If any check fails, the whole statement is **withheld**, not shown with wrong figures. *Preview the exception state* shows this using a copy with one amount altered by 0.01.
- **Where.** View `help`, `#help-root section#help-integrity` (the equation `.help-eq`, the checks `.help-checks`, the preview `.help-preview`). The withheld state is `#integrity-root .withheld`, at `#/overview?simulate=mismatch`.
- **Setup:** `[{ "call": "help.open", "args": ["integrity"] }]`
- **Targets:** desktop `["#help-root #help-integrity"]`; phone the same.
- **Verified sizes:** 832×1059 / 358×1904 / 824×1062 / 358×1904 / 651×1149.
- **Optional withheld variant, verified in the iframe:**
  - Setup: `[{ "route": "#/overview?simulate=mismatch" }, { "wait": "#withheld-title" }]`.
  - Target: `["#integrity-root .withheld"]` (760×758 in an 870 frame; 390×1077 on a phone).
  - **The frame reloads twice:** in, and out on reset. See G3 and G12. The reset must set `#/overview` and wait for a fresh `YES.ready`. The tour must re-apply its theme after each reload.
- **Reset and gotchas:** nothing to undo for the default setup. The variant needs the withheld handling at the top of the reset.
- **Data shown:**
  - `YES.integrity` = `{ ok:true, checks:[unique_ids, precision, single_asset, period_basis, equation, running_balance, categories, fee_links, pending_excluded] (all ok), summary:{ opening:100000, net:14750, closing:114750, postedCount:15, pendingCount:1 } }`;
  - the badge "9 of 9 checks passed";
  - the equation from `YES.calc.journey()`.
  - In the preview, `YES.data.simulated` = `{ kind:"mismatch", txId:"TX-260903-1127" }`. The failed checks are `equation` and `running_balance`, the title is "This statement is being withheld", and the return link reads "Return to the valid demo statement".
- **Try it:** "Read the checks the statement ran on its own numbers before you saw them. Select **Preview the exception state** to see what a customer would get if the numbers didn't add up: the statement is withheld rather than shown with wrong figures."

### 5.20 `language`: English and Spanish (everywhere)
- **What it is.** The whole statement in English or Spanish, switchable at any time from the header (on phones, from the Menu). It covers:
  - every label, explanation, date and number format ("1,147.50" / "1.147,50");
  - the video, with a recorded Spanish voiceover;
  - the PDF (A4 in Spanish), the CSV headers and the assistant.

  The switch keeps the customer's place, filters, selected transaction, inquiry draft and conversation. Memos stay as written. Dialogs have no switch of their own.
- **Where.** The masthead language switch: `#masthead .mast-wide .seg--lang` (`[data-lang="en"|"es"]`; "EN | ES" below 992, "English | Español" above). On phones it is in the Menu: `#mast-menu .mast-menu__pref`.
- **Setup:** `[{ "route": "#/overview" }, { "lang": "es" }, { "menu": true }]`. `{menu:true}` does nothing on desktop, and it must be the last action (G11).
- **Targets:** desktop `["#masthead .mast-wide .seg--lang"]`; phone `["#mast-menu .mast-menu__pref", "#masthead [data-mast-menu]"]`.
- **Verified sizes:** 99×44 / 358×48 / 207×44 / 358×48 / 651×48.
- **Reset and gotchas:**
  - `YES.setLang(baseline, { silent: true })`, then close the Menu. G13 covers the baseline and sessionStorage.
  - `setLang` re-renders every module. The video pauses, and state is kept.
  - An open phone Menu survives the switch.
- **Data shown:**
  - `YES.i18n.lang` "es" and `<html lang="es">`;
  - `YES.config.languages` `["en","es"]` and `YES.config.locales` `{ en:"en-US", es:"es-ES" }`;
  - `YES.data.statement.language` "en" (the statement's own language);
  - the h1 "Tu estado de cuenta de septiembre de 2026", the hero "1.147,50", and the title "Resumen · Estado de cuenta de YES, septiembre de 2026 · Demostración ilustrativa";
  - `sessionStorage['yes.lang']` "es";
  - `YES.i18n.audit()` → `{}`: no missing strings.
- **Try it:** "Switch between **English** and **Español** at the top (on a phone: **Menu**, then the language). Everything changes: labels, dates, numbers, explanations and the video. You stay exactly where you were."

### 5.21 `theme`: Dark mode (everywhere)
- **What it is.** A light and a dark version. Without a choice it follows the device setting, live; once the customer chooses, the choice is remembered on that device. Print and PDF are always light. Every component uses design tokens, so both themes keep WCAG contrast.
- **Where.** The masthead **Dark mode** toggle: `#masthead .mast-wide [data-theme-toggle]`, a moon icon, `aria-pressed`. On phones: Menu → *Dark mode* switch, `#mast-menu .mast-menu__theme`.
- **Setup:** `[{ "route": "#/overview" }, { "theme": "dark" }, { "menu": true }]`. If the app is already dark, use `"light"` instead (G17).
- **Targets:** desktop `["#masthead .mast-wide [data-theme-toggle]"]`; phone `["#mast-menu .mast-menu__theme", "#masthead [data-mast-menu]"]`. The desktop target is a small 44×44 button. The overlay tag needs room, or the tour can widen the spotlight padding.
- **Verified sizes:** 44×44 / 358×48 / 44×44 / 358×48 / 651×48.
- **Reset and gotchas:** `YES.theme.set(appTheme)`. The masthead re-renders on `theme`, and the Menu stays open. The choice is stored in `localStorage['yes.theme']` (G13).
- **Data shown:**
  - `YES.theme.get()` "dark", `effective()` "dark", `device()` "light";
  - `<html data-theme="dark">`, `localStorage['yes.theme']` "dark", and every `[data-theme-toggle]` with `aria-pressed="true"`;
  - the brand slots `YES.config.slots` `{ YES_PRIMARY:"#000000", YES_PRIMARY_DARK:"#ffffff", YES_ACCENT:"#0004ff" }` (the YES brand book palette).
- **Try it:** "Select the moon button at the top (on a phone: **Menu**, then **Dark mode**) to switch between light and dark. Until the customer chooses, the statement follows their device's setting."

### 5.22 `accessibility`: Accessibility and mobile (everywhere)
- **What it is.** It is built to WCAG 2.2 AA without add-ons:
  - keyboard operation and screen-reader support;
  - visible focus and reduced motion;
  - zoom and reflow;
  - text alternatives for every chart (tables);
  - never relying on colour alone;
  - two languages;
  - masked numbers read as "ending in 4821".

  The official **UserWay** widget (account B3W9A2mgGs) adds more tools when online; it sits bottom left and loads once, and the page works without it. On phones the layout adapts: a Menu instead of tabs, full-screen sheets, cards instead of the table, and a sticky one-row header.
- **Where.** View `help`, `#help-root section#help-accessibility`. The features are `.help-features`, and the UserWay card `.help-uw` with the live status chip `[data-help-uw-status]`.
- **Setup:** `[{ "call": "help.open", "args": ["accessibility"] }]`
- **Targets:** desktop `["#help-root #help-accessibility"]`; phone the same.
- **Verified sizes:** 832×985 / 358×1749 / 824×1006 / 358×1749 / 651×1053.
- **Reset and gotchas:** nothing to undo. The UserWay status is "Unavailable offline" in tests but loads online (G14).
- **Data shown:**
  - `YES.config.userway` = `{ enabled:true, accountId:"B3W9A2mgGs", src:"https://cdn.userway.org/widget.js", timeoutMs:8000, position:5 }`;
  - `YES.userway.status` = `"unavailable"` offline; the other states are `idle`, `loading`, `loaded`, `host` and `disabled`;
  - the feature titles: "Keyboard", "Screen readers", "Visible focus", "Reduced motion", "Zoom and reflow", "Text alternatives for charts", "Never color alone", "Two languages".
- **Try it:** "Read what is built in: keyboard use, screen readers, visible focus, reduced motion, zoom, tables behind every chart, and never relying on colour. When you're online, the UserWay button in the bottom-left corner adds more tools. On a phone, the statement switches to a single column with a **Menu**."

---

## 6. Coverage notes: capabilities to mention under a feature

No customer-facing capability falls outside the 22 ids. The ones below have no id of their own, so the steps agent should mention each in the named feature's text.

| Capability | Where in the statement | Mention under |
|---|---|---|
| **Masked identifiers and privacy**: account and wallet "•••• 7316" / "0x5A…E19C" with a *Masked* tag; masked counterparties read aloud as "ending in 4821"; "Showing them in full is not available" | *Statement details* (`.ov-details`), rows, detail dialog | `summary` (account and wallet) and `detail` (counterparties) |
| **Privacy of the AI and demo**: "Answers are computed in this browser… nothing is sent"; the footer says the statement sends nothing, while UserWay is third-party | Drawer `.asst__privacy`, footer | `assistant` (and `accessibility` for UserWay) |
| **Fiat equivalent**: "≈ USD 1,147.50", the rate, source and time, labelled *Illustrative*, shown only when verified (or in demo mode) | Balance card `.ov-fiat`; Understand topic *USD equivalent* | `summary` |
| **Time zone and date basis**: "As of … EDT (America/New_York)"; "Dates and totals use the posted date."; initiated versus posted; a "Previous period" tag; times in EDT whatever the device's time zone | Balance card, Statement details, Transactions lede and caption, detail dialog, Help record facts | `summary` (as-of), `explorer` (posted vs initiated sort, caption), `detail` (both dates, previous period) |
| **Glossary**: seven plain-language term explanations with examples and governed content records | Understand › Bank-issued digital dollar basics | `basics` |
| **Statement details panel**: ID, version, issue status, account, asset, period, generated, time zone, date basis | `.ov-details` disclosure | `summary` |
| **Corrected-statement handling**: `issueStatus` "original" or "corrected", shown as "Original" / "Corrected (new version)" in the details, the record facts, the CSV `Issue status` column and the PDF; the version "1.0" | Statement details, Help record facts, CSV and PDF | `help-record` (and `integrity`, whose datareq covers `statement.correction`) |
| **Help contact and routes**: phone, email, hours and chat status (placeholders); inquiry versus formal dispute versus fraud | Help › Contact support | `help-record` |
| **Feedback**: "How clear was this statement?" (four ratings and a comment, session only); assistant "Was this helpful?" thumbs | Help › Feedback; each assistant answer | `help-record` (and `assistant` for the thumbs) |
| **Integrity and withheld statement** (`?simulate=mismatch`) | Help › Statement integrity, *Preview the exception state* | `integrity` |
| **Video captions, transcript, chapters, and the recorded Spanish voiceover** | Video player and card | `video` (and `language`, `accessibility`) |
| **Phone Menu**: sections, Download or print, language and Dark mode in one panel | Masthead on phones | `accessibility` (mobile), and `language`/`theme` on phones |
| **UserWay** | Help › Accessibility; launcher bottom left (online) | `accessibility` |
| **Print, PDF and CSV**, including **Download CSV — current view** in Transactions and the masthead *Download or print* | Help › Download or print; `.tx-export` | `download` (mention the current-view CSV under `explorer` too) |
| **Explain with AI everywhere**: balance, steps, chart, fees, pending, Understand topics, transactions | `[data-explain]` buttons | `explain-ai` |
| **Text alternatives**: *Show the journey as a table*, *In numbers* equation, *Show the chart data as a table*, chart summary sentence, keyboard chart points | Overview | `journey`, `running-balance` (and `accessibility`) |
| **Selecting a step scopes Transactions**: *Show in Transactions*, the "Step:" chip, *Back to balance journey* | Journey panel, Transactions chips | `journey` |
| **Previous / Next in the detail**, **Copy** reference and ID, **Open fee line** / parent transaction | Detail dialog | `detail` |
| **Deep links and Back**: `#/transactions/<id>`, `#/overview/<step>`; Back closes the detail and clears a step | Router | `detail` / `journey` (one line at most) |
| **Personal greeting**: "Hello, Sam. Here is your YES activity for September 1 – 30, 2026…" | Overview header | `summary` |
| **About this demo**: what is connected, local, mock or illustrative, and the brand replacement slots (logo, colours, font, product name, issuer, video poster and voiceover, disclosures, support) | Help › About this demo | `help-record` (and `theme` for the brand slots) |
| **Footer**: statement ID, version, generated time, the disclosures slot, the demo notice, "Interactive statement delivered via InfoSlips" | `#site-footer` | `help-record` |
| **Inquiry resume and duplicate notices**: *Continue your inquiry*, *View your demo inquiry*, the Help draft card | Detail, assistant, Help | `inquiry` |

---

## 7. Verification scripts

Location (scratchpad; not committed): `/tmp/claude-0/-home-user-YES/eafa4f48-be7c-5ed9-9b2f-1627e0e30963/scratchpad/wt/explore/`. Playwright is loaded through `createRequire('/home/user/YES/package.json')`. Every request other than `file:`, `data:` and `blob:` is aborted. The fake origin `http://wt.test/` is served from disk with `route.fulfill`, so no network is used.

| File | What it does |
|---|---|
| `driver.js` | The reference driver, `makeDriver(win, { lang, theme })` → `{ apply, target, reset, ready, withheld, isPhone, … }`. It implements the SPEC §6 actions and the reset in §3, including the G1–G3 fixes. It runs on the top window or, from a parent, on `frame.contentWindow`. **Port this into `30-driver.js`.** |
| `features.mjs` | The 22 feature definitions (`setup`, `target`, alternate selectors, and an in-page `data()` reader). Section 5 is generated from these runs. |
| `verify.mjs` | `node verify.mjs [--vp desktop,phone,shot,phoneFrame,tabletFrame,wide] [--only id,…] [--motion reduce]`. For each feature it runs reset → clean check → apply → target (non-zero rect) → stability → data → outlined screenshot (`shots/<vp>-NN-<id>.png`) → reset → clean check. The report goes to `verify-report-<motion>.json`. |
| `iframe-verify.mjs` | The tour-realistic run. The parent page frames the statement (870×836 at 1280, and 390×440), runs the driver in the parent against `contentWindow`, pushes `#/tour/<id>` per step, and asserts the parent URL never moves. |
| `iframe-history.mjs` | Reproduces G1 and G6 (and the mitigations) with joint session history. |
| `iframe-integrity.mjs` | The withheld preview in a frame (reload in and out), and the Spanish recorded voiceover. |
| `iframe-focus.mjs`, `iframe-focus-phone.mjs` | G4: focus stealing, and that the Menu and dialogs survive the parent re-focusing. |
| `timing.mjs` | G5: scroll and animation settle times with and without reduced motion; the integrity reload; language persistence. |
| `probe1.mjs`, `facts.mjs`, `chartcheck.mjs` | Selector survey per view, labels and inquiry reasons, chart draw after boot on another view, and full screen in a frame. |

Results at the time of writing:
- `verify.mjs`: 132/132 OK across six sizes, with motion allowed.
- `verify.mjs --motion reduce`: 44/44 OK, at desktop and phone.
- `iframe-verify.mjs`: 44/44 OK, at 1280 desktop and phone frames. The parent hash was unchanged on every step.
- Zero console errors and zero reset problems.
