# InfoSlips × YES — Statement feature review (walkthrough app)

This is the build contract for the walkthrough app. Every module builds against it, and anyone changing a contract below must update this file in the same change.

## 1. Purpose and audience

InfoSlips is showing YES stakeholders what a new YES statement could do. A person at YES opens one link, takes a guided tour of the interactive YES statement (the existing SPA, `dist/yes-statement.html`, **unchanged**), and gives their view on every feature. Their view has four parts: include or exclude, with an optional reason; a priority; and a comment. Everyone with the link can see everyone's answers as charts and text, with an image of the part of the statement each answer is about. For the features people want, they can also open the **data requirements** as an explorable JSON structure. YES will use the results to decide what goes into the production statement build.

**Branding notice (must be visible).** The YES branding in the statement is a placeholder. It will be updated once YES supplies its final brand assets. Show this on the start page, keep a compact version visible in the tour panel, and show it on the results page.

**Decisions already made by the client.**
- **Language:** the app is English only. The statement inside keeps its own English/Spanish switch.
- **Access:** anyone with the link (no access code). There is an **admin code** for moderation only.
- **Database:** Netlify Blobs.
- **Hosting:** a new Netlify project, deployed from this folder with the Netlify CLI.
- **Theme:** light and dark, with a switch.
- **Brand:** InfoSlips (section 4).

## 2. Layout of `walkthrough/`

```
walkthrough/
  package.json            # type: module; deps: @netlify/blobs; devDeps: @fontsource-variable/inter
  netlify.toml            # publish = "public", functions = "netlify/functions", headers
  build.mjs               # src → public (or --out <dir>)
  server/
    api-core.mjs          # createApi({ store, env, features }) → async (Request) => Response  (pure, Web Fetch API)
    stores.mjs            # memoryStore(), fileStore(dir) — same interface as the Blobs adapter
    dev.mjs               # local server: static files from public (or --root) + /api/* via api-core; --port (0 = random), --store memory|file
  netlify/functions/api.mjs   # Netlify Functions v2: wraps api-core with getStore({ name: 'reviews', consistency: 'strong' }); config.path = '/api/*'
  shared/features.json    # the feature list (ids, order, titles, section) — read by build, server and app
  src/
    index.html            # page template (build injects asset names)
    brand/                # logos (approved artwork — never edit pixels)
    css/NN-*.css          # concatenated in filename order → public/app.<hash>.css
    js/NN-*.js            # concatenated in filename order → public/app.<hash>.js (each file an IIFE on window.WT)
    shots/<featureId>.jpg # generated screenshots of each statement part (committed), plus <featureId>-thumb.jpg
  scripts/
    shots.mjs             # regenerates src/shots/* with Playwright from the built statement
  tests/
    run.mjs               # builds into a temp dir, starts dev server on port 0 with memory store, runs tests/*.test.mjs
    *.test.mjs
  docs/SPEC.md            # this file
```

### Build
`node build.mjs [--out dir]` (default `public/`) does the following:
- Copies `../dist/yes-statement.html` **byte for byte** to `<out>/statement/index.html`, and fails if the copy's SHA-256 differs from the source. The statement is never modified. If `../dist/yes-statement.html` is missing, it runs `node ../build.mjs` first.
- Concatenates JS and CSS and writes content-hashed file names into `index.html`.
- Copies `src/brand`, `src/shots` and the Inter variable woff2 (from `@fontsource-variable/inter`, latin subset only) into `<out>/assets/`.
- Writes `<out>/features.json` and `<out>/robots.txt` (`Disallow: /`).
- Is deterministic: the same inputs give the same output.

### Ownership (parallel build — never edit a file you don't own; read anything)

| Files | Owner |
|---|---|
| `package.json`, `netlify.toml`, `build.mjs`, `server/*`, `netlify/functions/*`, `src/index.html`, `src/js/00-core.js`, `src/js/05-shell.js`, `src/js/10-start.js`, `src/js/99-boot.js`, `src/css/00-tokens.css`, `src/css/01-base.css`, `src/css/02-components.css`, `src/css/05-shell.css`, `src/css/10-start.css`, `tests/run.mjs`, `tests/00-api.test.mjs`, `tests/01-shell.test.mjs` | foundation |
| `docs/STATEMENT-MAP.md` | explore (read-only on the statement) |

**The 22 feature ids in `shared/features.json` are frozen** (`32-datareq.js` is already keyed by them). Only `title`/`short` wording may change (owner: steps).
| `shared/features.json` (title/short wording only), `src/js/30-driver.js`, `src/js/31-steps.js`, `scripts/shots.mjs`, `src/shots/*`, `tests/30-steps.test.mjs` | steps |
| `src/js/32-datareq.js`, `tests/32-datareq.test.mjs` | data requirements |
| `src/js/40-tour.js`, `src/css/40-tour.css`, `tests/40-tour.test.mjs` | tour |
| `src/js/50-results.js`, `src/js/51-charts.js`, `src/js/52-admin.js`, `src/css/50-results.css`, `tests/50-results.test.mjs` | results |
| `src/js/60-json.js`, `src/js/61-data.js`, `src/css/60-data.css`, `tests/60-data.test.mjs` | data view |
| `tests/90-a11y.test.mjs` (and cross-module fixes after all modules land) | integration |

## 3. Front-end architecture (vanilla JS, no framework, no CDN)

`window.WT` is the namespace. Every `src/js/NN-*.js` file is `(function (WT) { 'use strict'; … })(window.WT = window.WT || {});`.

### 00-core.js (foundation)
- `WT.esc(s)`: HTML-escape. **Every** interpolated value goes through it, and user text is never inserted as HTML.
- `WT.h(strings, ...values)`: optional tagged template that auto-escapes.
- `WT.render(el, html)`: replaces the content and restores focus by `data-fk` (as in the statement).
- `WT.on(evt, fn)` / `WT.emit(evt, payload)`. Events:
  - `route` ({ view, param });
  - `theme` ('light' | 'dark');
  - `reviewer` (reviewer object changed);
  - `answers` (featureId);
  - `saved` ({ ok, pending });
  - `results` (fresh results object).
- `WT.features`: the array from `shared/features.json`, inlined at build. `WT.feature(id)` looks one up.
- `WT.register({ name, view?, init(), render(param), onRoute?(param) })`. A module that owns a view sets `view` (`'start' | 'tour' | 'results' | 'data' | 'admin'`). The router shows `<section id="view-<view>">` and calls `render(param)`.
- **Router.** Hash routes:
  - `#/start`
  - `#/tour/<featureId>` (no id = first feature, or resume where the reviewer left off)
  - `#/results`, `#/results/<featureId>`, `#/results/people`
  - `#/data`, `#/data/<featureId>`
  - `#/admin`
  
  The default is `#/start`. Use `WT.go(path)` to navigate (pushState plus a synchronous route; Back and Forward work). On a view change, focus the view's `h1` (`tabindex="-1"`) and update `document.title` to "<View> · YES statement review · InfoSlips".
- `WT.theme`:
  - `get()`, `set('light' | 'dark' | null)`, `toggle()`, `effective()`;
  - localStorage key `infoslips.wt.theme`; mirrored to `<html data-theme>`;
  - a head script applies it before first paint;
  - follows `prefers-color-scheme` while no choice is saved.
- `WT.reviewer` (identity; localStorage `infoslips.wt.reviewer`):
  - `{ secret, name }`, where `secret` is 32 random bytes as hex, created lazily;
  - `get()`, `setName(name)`, `reset()` (new secret: "Start as a new reviewer");
  - `answers` is the cache `{ [featureId]: { vote, reason, priority, comment, updatedAt } }`;
  - `lastStep` is the featureId to resume from.
- `WT.api` (fetch wrapper; JSON; throws `WT.ApiError` with status):
  - `me()`, `saveMe({ name?, answers? })`, `deleteMe()`, `results()`, `exportUrl('csv' | 'json')`, `admin.check(code)`, `admin.hide(...)`, `admin.deleteReviewer(rid)`, `admin.reset()`.
  - Sends `X-Reviewer-Secret` for `/api/me`, and `X-Admin-Code` for admin calls. The admin code is kept in sessionStorage `infoslips.wt.admin`.
- `WT.answers`:
  - `get(featureId)`;
  - `set(featureId, patch)`: merges and saves to the local cache immediately, then debounces the save (600 ms) to the server. A failed save stays queued in localStorage (`infoslips.wt.pending`) and is retried on the next change, on `online`, and on load. It emits `saved` with `{ ok: true | false, pending: n }`.
  - `stats()`: answered counts.
- `WT.announce(msg)`: polite live region in the shell.
- `WT.icon(name)`: inline SVG icons (`aria-hidden="true"`). At least these: arrow-left, arrow-right, restart, check, x, minus, list, sun, moon, user, chart, braces, download, copy, search, chevron-down, chevron-right, external, info, eye, eye-off, trash, refresh, lock.
- `WT.fmt.date(iso)`, `WT.fmt.relative(iso)` and `WT.fmt.pct(n)`, all in en-GB style ("4 Oct 2026, 18:40").
- `WT.dialog.open(el, { trigger })` / `close(el)`: native `<dialog>` with focus return.

### 05-shell.js (foundation)
- **Skip link.**
- **Header (`<header class="wt-mast">`):**
  - the InfoSlips logo (light theme: `infoslips-logo-on-light.png`; dark theme: `infoslips-logo-white.png`; both `<img>` with `alt="InfoSlips"`, one hidden per theme with CSS; height 32px, so 136px wide, above the brand minimum of 120px), followed by the app name "YES statement review";
  - nav with Walkthrough, Results and Data requirements, with `aria-current` on the current one;
  - the reviewer chip (name or "Add your name") opening the name dialog;
  - the light/dark toggle (one button, `aria-pressed`, named "Dark mode").
  
  Under 720px the nav, the chip and the theme toggle move into a Menu dropdown (button with `aria-expanded`; Escape closes it).
- **Footer.** "Prepared by InfoSlips to showcase a possible new YES statement. All statement data is fictional." plus a link to the admin view (small).
- **Name dialog.** An optional name (max 60 characters) with an explanation: your name appears next to your votes and comments, which everyone with the link can see; leave it blank to appear as "Anonymous reviewer". It also has "Start as a new reviewer", which clears the identity on this browser after confirmation.
- **`WT.brandNotice({ compact })`.** Returns the branding-notice HTML. Full text:

  > **YES branding is not final.** The colours, logo and typography in the YES statement are placeholders. They will be updated once YES supplies its final brand assets. Please judge the features, not the look.
  
  Compact text: "YES branding is a placeholder and will be updated."

### 10-start.js (foundation): `#/start`
- **Hero:** "Help shape the new YES statement", with an intro paragraph. InfoSlips built this interactive statement for YES to show the art of the possible. Walk through it, say which features belong in the production statement, how important each one is, and why.
- **How it works:**
  1. Take the guided walkthrough (about 15 minutes, N features).
  2. For each feature, vote to include or exclude it, set a priority and comment.
  3. See what everyone thinks and the data each feature needs.
- **Optional name field.** It saves on change.
- **Primary button:** "Start the walkthrough", or "Continue (step k of N)" when there is progress. A secondary "Start from the beginning" link goes to the first feature.
- **Links** to Results and Data requirements. The full branding notice.
- **Privacy note:** "Your answers are saved to a shared database as you go and are visible to everyone with this link. They're linked to this browser, not to an account."

## 4. Visual design (InfoSlips brand, WCAG 2.2 AA)

**Typography.** Inter variable, self-hosted, with `font-display: swap` and a system-ui fallback.
- Display: 48/800.
- H1: 36/700 (28 on phones).
- H2: 28/700 (22 on phones).
- H3: 22/600.
- Body: 16/400, line-height 1.5.
- Caption: 14/500.

Headline line-height is 1.1. All-caps labels are 12/600 with +0.08em tracking.

**Tokens** (`00-tokens.css`). Each theme is defined under `:root` / `:root[data-theme='dark']`, and under `@media (prefers-color-scheme: dark) { :root:not([data-theme='light']) }`.

| Token | Light | Dark |
|---|---|---|
| --bg | #FFFFFF | #0F172A |
| --section | #F5F5F5 | #1D5941 *(feature sections only; text White/Slate 5/Lime)* |
| --surface (cards) | #FFFFFF + shadow 0 1px 2px rgb(15 23 42 / .06), 0 4px 16px rgb(15 23 42 / .06) | #334155 (Slate 2); text on it only White / Slate 5 / Lime |
| --surface-2 (subtle fills, inputs) | #F8F8F8 | #0F172A with a #64748B border |
| --heading | #0F172A | #FFFFFF |
| --body | #334155 | #CBD5E1 |
| --muted | #64748B | #94A3B8 (not on Slate 2 surfaces for small text — use Slate 5 there) |
| --border | #E2E8F0 | #334155 (on Slate 2 cards use #64748B for visible control borders) |
| --accent (rules, bars, logo-adjacent marks) | #4EAF60 | #4EAF60 |
| --link | #1D5941 *(Green on white is only 2.8:1, so links use Dark Green, underlined)* | #80D100 |
| --highlight / callout | #1D5941 | #DBE64C |
| --btn-bg / --btn-text | #4EAF60 / #0F172A (6.5:1) | #4EAF60 / #0F172A |
| --btn-hover-bg / text | #277656 / #FFFFFF | #80D100 / #0F172A |
| --focus | #1D5941 (3px ring with 2px offset) | #DBE64C |
| --spot (tour outline) | #277656 | #DBE64C |

**Brand rules.** No colours outside the palette (Greens, Slates, Neutrals, White, plus Black #111827), and no gradients. Green carries the brand. Lime is used sparingly. Never put dark text on a dark surface (except dark text on a Green button). Use a Green accent bar (4px) under page titles. Keep the logo's clear space (the height of the "i" dot, about 14px at 32px tall). The logo is never recoloured or stretched. Semantic states use the palette: success uses Green or Dark Green, "exclude" uses Slate 2/Slate 4, and errors use Dark Green text with an icon and a bold label. If a true error colour is unavoidable, document the exception in this file.

**Accessibility.**
- All text meets 4.5:1 (3:1 for 24px+ or bold 19px+). UI boundaries and chart marks meet 3:1 against their background.
- Targets are at least 24×24 px (44 px preferred for primary actions).
- Focus is always visible and never hidden by sticky elements (`scroll-padding-top`).
- `prefers-reduced-motion` turns off animated scrolling and pulses.
- Forced-colours mode keeps outlines and focus.
- Every chart has a text equivalent (table or list).
- Pages work at 320px wide and at 200% zoom. Landmarks: header, nav, main and footer.

## 5. Tour (`#/tour/<featureId>`), owned by tour; uses the driver

**Layout.**
- **≥1024px:** the statement frame on the left (fills the height under the header) and the panel on the right (width clamp(360px, 32vw, 440px)), each scrolling independently.
- **720–1023px:** the panel is 340px wide.
- **<720px:** the frame takes the top ~52svh and the panel is a scrollable area below it. A "Show statement / Show panel" toggle maximises either one.

**Frame.** `<iframe id="wt-frame" src="statement/index.html" title="YES statement (interactive demo)">`. It is same origin, so the tour and driver can use `frame.contentWindow.YES` and the DOM. The statement's theme follows the app theme (`frameWin.YES.theme.set(appTheme)` on load and on every app theme change).

**Panel, per step:**
- "Step k of N" with a progress bar (`role="progressbar"` or a native `<progress>` with a label) and the section label (Overview / Transactions / Understand / Help / Throughout the statement);
- the title (`h1`, focused on step change), "What it is", and **Value for YES** and **Value for your customers** (bullets);
- "Try it" (what to click in the statement);
- a button "View data requirements" (opens a dialog with the JSON explorer for this feature, via `WT.json.mount`; see section 7);
- the compact branding notice.

Then **Your view** (a fieldset group):
- **Include in the production statement?** A radio group: "Include" / "Exclude" (big segmented buttons, real radio inputs).
- **Why? (optional):** a textarea (max 500 characters), always visible, with a counter.
- **Priority:** a radio group: "High" / "Medium" / "Low", with help text ("How important is this for the first release?"). It's available whatever the vote, and labelled "Priority if included".
- **Comment (optional):** a textarea (max 2,000 characters).
- An autosave status (polite live region): "Saved", "Saving…", or "Not saved yet — we'll retry" with a Retry button.
- A "Clear my answer" link.

**Navigation (sticky at the bottom of the panel):**
- Back, Next (on the last step: "Finish and see results"), and Restart (goes to the first step; answers are kept, and a confirm dialog says so).
- A "All steps" button opens a step list (dialog/drawer): every feature with its thumbnail, title, section and answered state (✓ Include / ✗ Exclude / not answered). Choosing one jumps to it.
- Keyboard: Alt+→ / Alt+← for next and previous, only when focus isn't in a text field. These are documented in the panel help.

The tour also stores `lastStep`.

**Highlight overlay.** This lives in the parent page, absolutely positioned over the frame, `pointer-events: none` and `aria-hidden="true"`.
- **Spotlight:** an SVG with a full-size dim rect (rgb(15 23 42 / .55)) masked by a rounded cut-out around the target rect (padding 8px, radius 12px).
- **Outline:** 3px solid `--spot`, with a 2px inner white or Slate 1 ring for contrast on any background.
- **Tag:** a small label anchored to the outline, "k · Title".
- It updates every animation frame while it moves, then idles (watch frame scroll, frame resize, a ResizeObserver on the target, and a MutationObserver on the frame body that re-resolves the target).
- If the target is off-screen in the frame (scrolled away by the user), show an edge arrow "Highlighted part is above / below — Show it" that re-scrolls.
- A "Dim the rest" switch (default on) turns the dimming off so people can explore. The outline stays.
- The dimming never blocks clicks: people may use the statement freely during any step.
- With reduced motion, there is no pulse or animated scroll.

**Step activation:**
1. `await WT.driver.reset(frameWin)` closes any open statement dialog or drawer and clears selections.
2. `await WT.driver.apply(frameWin, step)` navigates and runs the setup actions.
3. `const el = await WT.driver.target(frameWin, step)` resolves the visible element; it times out after 4s and returns null.
4. The target is scrolled into view (centred, or to the top if taller than the viewport).
5. The overlay draws.

A failed step still shows the panel, with a polite note: "We couldn't highlight this part automatically. Try it: …".

## 6. Steps and driver (owned by steps)

**`shared/features.json`.** An array in tour order:
`[{ "id": "journey", "order": 3, "section": "overview", "title": "Balance journey", "short": "One-line summary" }]`.
- Ids are kebab-case and stable; server validation uses them.
- Sections are `overview`, `transactions`, `understand`, `help` and `everywhere`.
- The list has 22 features that together cover every feature of the statement. The ids are frozen.

**`WT.steps`.** An object keyed by feature id, defined in `31-steps.js`:
```js
{
  id, what: 'What it is (2–3 sentences)',
  valueYes: ['3–4 bullets: business value for YES'],
  valueCustomer: ['3–4 bullets: value for the recipient'],
  tryIt: 'What to click, in the statement',
  setup: [ /* driver actions, run in order */ ],
  target: { desktop: ['css selector', 'fallback selector'], phone: ['…'] },   // first visible match wins; phone = frame width < 720
  shot: { pad: 16 }   // optional screenshot tweaks
}
```

**Driver actions** (`30-driver.js`, `WT.driver`). Each is a plain object, so the screenshot script can use the same definitions.
- `{ route: '#/overview' }` sets `location.hash` in the frame and waits for the view.
- `{ call: 'overview.selectStep', args: ['incoming'] }` calls `frameWin.YES.<path>(...args)`.
- `{ click: 'selector' }`
- `{ wait: 'selector' }`
- `{ scroll: 'selector' }`
- `{ theme: 'dark' }`
- `{ lang: 'es' }`
- `{ menu: true }` opens the phone Menu when the frame is narrow.
- `{ delay: ms }`

Methods:
- `WT.driver.reset(win)`: close dialogs via the statement's own APIs (`YES.explorer.closeTx`, `YES.ui.closeDialog` for open `<dialog open>`, the assistant close API), clear the journey selection (`YES.overview.clearStep`), set the language back to the one the visitor had chosen before the tour changed it, and return to the top.
- `WT.driver.apply(win, step)`
- `WT.driver.target(win, step)`
- `WT.driver.isPhone(win)`

Study the statement's real APIs in `../src/js/*.js` and `../docs/ARCHITECTURE.md` (for example `YES.overview.selectStep`, `YES.explorer.openTx`, `YES.explorer.applyFilter`, `YES.inquiry.start`, `YES.help.*`, `YES.theme`) and prefer them to synthetic clicks.

**Content voice.** Clear, confident, warm (InfoSlips). Short sentences, active voice, no jargon. Value for YES covers fewer support calls and disputes, trust and regulatory transparency, engagement, cost to serve and differentiation. Value for customers covers understanding, control, confidence, accessibility and saved time. Don't invent statistics. Everything describes the statement as it is.

**Screenshots** (`scripts/shots.mjs`). For each feature: 1280×900 viewport, light theme, English, `deviceScaleFactor: 1`. Apply the step, then screenshot the target's bounding box plus padding (clamped to the page). Save `src/shots/<id>.jpg` (quality 82, max 1200px wide) and `<id>-thumb.jpg` (320px wide). The screenshots are deterministic and committed.

## 7. Data requirements (owned by data requirements; viewer owned by data view)

**`WT.dataReq`.** Defined in `32-datareq.js` and keyed by feature id:
```js
{
  summary: 'What data this feature needs, in one sentence',
  notes: ['optional implementation notes, e.g. "amounts in minor units"'],
  fields: [
    { path: 'statement.period.start', type: 'string<date-time>', required: true, example: '2026-09-01T00:00:00-04:00',
      description: 'Start of the statement period (inclusive)', source: 'Core ledger' }
  ]
}
```

- **Paths** use dots and `[]` for arrays (`transactions[].amount.minor`).
- **Types:** `string`, `string<date-time>`, `string<date>`, `string<enum: a|b|c>`, `string<currency>`, `integer<minor units>`, `number`, `boolean`, `object`, `array`, `string<uri>`, `string<masked>`.
- **Sources:** Core ledger, Customer profile, Blockchain / on-chain data, Pricing & FX, Content management, Support / case management, AI service, Document generation, Accessibility service, Preferences.

The fields are derived from the statement's real data model (`../src/js/01-data.js`, `../src/js/02-calc.js`) and what each feature displays. Field paths shared by several features must be identical, so they merge. There is also a shared `WT.dataReq.$common`, the statement envelope every feature needs (id, period, customer display name, account, asset, language, generatedAt).

**Viewer** (`60-json.js`, `WT.json`). `WT.json.mount(el, { features: [ids], mode })` builds a tree from the merged field paths.
- Every node shows key, type badge, required/optional, and an example value preview. Selecting a node shows its details: description, source, example, and "needed by" features (with links to their tour step and results).
- Controls: expand all / collapse all, a search filter (key, description or source), a "Sample JSON" tab (pretty-printed sample payload built from the examples, with copy and download), and a "Schema" download (JSON Schema draft 2020-12 generated from the fields).
- The tree is a WAI-ARIA tree view: `role="tree"`/`treeitem`, `aria-expanded`, arrow keys, Home/End and type-ahead.

**Data view** (`61-data.js`, `#/data`): "Data requirements".
- A scope switch: **"Features I included"** (from my answers), **"Features the group wants"** (include share ≥ 50% with at least 1 vote), and **"All features"**, plus a list of feature checkboxes.
- The merged explorer for the chosen scope, and per-feature cards with a thumbnail, summary and field count.
- `#/data/<featureId>` preselects one feature.
- An empty state explains how to include features.

## 8. Results (`#/results`), owned by results

- **Header.** "What reviewers think". It shows the number of reviewers and answers, a "last updated" time, a Refresh button, and auto-refresh every 30s while the tab is visible (announce politely only when numbers change). It has Export CSV / Export JSON buttons and the compact branding notice.
- **Summary in words.** Auto-generated sentences covering:
  - the strongest support (top 3 by include share, with priority);
  - the most debated (closest to 50/50 with ≥2 votes);
  - the most excluded;
  - the most commented;
  - how many features have no votes yet.
- **Charts** (inline SVG, no libraries; load the `dataviz` skill before writing chart code):
  1. **Support by feature:** diverging horizontal bars, exclude to the left and include to the right, sorted by net support, with feature thumbnails beside the labels.
  2. **Priority mix:** 100% stacked bars (High / Medium / Low) per feature, among those who set a priority.
  3. **Priority score ranking:** a lollipop or bar chart of the score = (High×3 + Medium×2 + Low×1) ÷ priority responses, shown only for features with ≥1 include.
  4. **KPI tiles:** reviewers, answers, comments, and features with majority support.
  
  Every chart is a `<figure>` with a `<figcaption>`, has a visually adjacent data table toggle ("Show as table"), uses colours from the brand palette validated for 3:1 against the background in both themes, and has direct labels where possible.
- **Feature cards / ranking table.** Rank, thumbnail (opens the full screenshot), title, include % (n), priority split, and a comments count, linking to the feature detail.
- **Feature detail** (`#/results/<featureId>`):
  - the full screenshot of the statement part (`src/shots/<id>.jpg`, alt "<title> in the YES statement");
  - the feature description, a mini chart and stats;
  - every response: name (or "Anonymous reviewer"), vote, priority, reason, comment, and time;
  - links: "See it in the walkthrough" and "Data requirements".
- **People** (`#/results/people`). A matrix of reviewers × features (a table with sticky headers and horizontal scroll inside its own container): ✓ include / ✗ exclude / – none, plus a priority letter, with a text legend.
- **Admin moderation.** Only when an admin code is stored and verified. Controls are added inline: hide/unhide a comment or reason, delete a reviewer's answers (with confirmation), and Reset all results (confirmation by typing RESET).
- **`#/admin`.** An admin code form (verifies with `/api/admin/check`), "Sign out of admin", and an explanation that the code is set as the Netlify environment variable `ADMIN_CODE`.
- **States.** Loading (skeleton), error (with retry), and empty ("No answers yet — be the first: start the walkthrough").

## 9. API (`server/api-core.mjs`), owned by foundation

The store interface, implemented by memory, file and Netlify Blobs:

```js
{ get(key) → object|null, set(key, obj), delete(key), list(prefix) → [key] }
```

The Blobs adapter wraps `getStore({ name: 'reviews', consistency: 'strong' })` with `get(key, { type: 'json' })`, `setJSON`, `delete` and `list({ prefix })` (paginate).

**Reviewer key.** `rid = sha256hex(secret).slice(0, 24)`, and the record is stored at `r/<rid>`. The secret never leaves the client except in the `X-Reviewer-Secret` header, which must be 64 hex characters.

**Record:**
```json
{ "rid": "…", "name": "", "createdAt": "…", "updatedAt": "…",
  "answers": { "<featureId>": { "vote": "include|exclude|null", "reason": "", "priority": "high|medium|low|null", "comment": "", "updatedAt": "…" } },
  "hidden": { "<featureId>": { "reason": true, "comment": true } } }
```

**Endpoints.** Everything is JSON and every response has `Cache-Control: no-store`.

| Method & path | Who | Behaviour |
|---|---|---|
| GET `/api/health` | anyone | `{ ok: true, store: 'blobs'\|'memory'\|'file', features: N }` |
| GET `/api/me` | secret | Own record, or `{ rid, name:'', answers:{} }` |
| PUT `/api/me` | secret | Body `{ name?, answers? }`; merged **per feature** (a feature's object replaces the stored one only if its `updatedAt` ≥ the stored one); `answers[f] = null` clears it. Returns the record |
| DELETE `/api/me` | secret | Deletes own record |
| GET `/api/results` | anyone | `{ generatedAt, reviewers, answers, comments, features: { [id]: { include, exclude, undecided, priority: { high, medium, low }, score, responses: [ { rid, name, vote, priority, reason, comment, updatedAt, hiddenReason, hiddenComment } ] } }, people: [ { rid, name, answered, updatedAt } ] }`. Hidden text is returned as `null` with its flag (admins also get the text via `?admin=1` + a valid code) |
| GET `/api/export.csv` / `/api/export.json` | anyone | One row per reviewer × answered feature: `reviewer, feature_id, feature_title, vote, priority, reason, comment, updated_at`. CSV is RFC 4180, has a UTF-8 BOM, and neutralises formula injection (prefix `'` when a cell starts with = + - @ tab CR). Hidden text is omitted |
| GET `/api/admin/check` | admin | 204 or 401 |
| POST `/api/admin/hide` | admin | `{ rid, featureId, field: 'reason'\|'comment', hidden: bool }` |
| POST `/api/admin/delete` | admin | `{ rid }` |
| POST `/api/admin/reset` | admin | `{ confirm: 'RESET' }` deletes all `r/*` |

**Validation.**
- Bodies are at most 64 KB.
- Feature ids must exist in `shared/features.json`.
- `vote` is `include`, `exclude` or null; `priority` is `high`, `medium`, `low` or null.
- `name` is at most 60, `reason` at most 500, and `comment` at most 2,000 characters, trimmed, with control characters stripped (keep `\n`). A string over the limit gets 413/422 with a message.
- Unknown keys are ignored.
- `updatedAt` must be ISO 8601 and is clamped to the server time.

**Admin.** The admin code comes from `env.ADMIN_CODE`. Compare it timing-safely; if it isn't set, admin endpoints return 503 "Admin is not configured".

**Errors.** `{ error: { code, message } }` with the correct status (400, 401, 404, 405, 413, 422, 500). Never echo secrets.

**Security headers** (in `netlify.toml` and mirrored in `dev.mjs`):
- everywhere: `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`, `X-Frame-Options: SAMEORIGIN`, `X-Robots-Tag: noindex, nofollow`;
- on `/` and `/index.html`: a CSP of `default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; font-src 'self'; connect-src 'self'; frame-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'`. The theme head script must therefore be an external file (`assets/theme-boot.<hash>.js`, loaded with no `defer`) or use a hash;
- no CSP on `/statement/*`: the statement needs inline code and UserWay.

## 10. Testing (Playwright 1.56.1 from the repo root's node_modules; Chromium preinstalled; no network)

`node tests/run.mjs [--only name]`:
- builds into a temp dir;
- starts `server/dev.mjs` with `--store memory --port 0 --root <tmp>` and passes the base URL in `process.env.WT_BASE`;
- runs each `tests/*.test.mjs` (each exports `default async function ({ base, browser, api, assert, log })`, or uses the helpers in `tests/helpers.mjs` from foundation);
- prints pass/fail and exits non-zero on failure.

Tests block outbound network (route `**/*` except the base URL → abort), so UserWay stays offline as in the statement's own tests. The axe tests use `../node_modules/axe-core/axe.min.js`.

Parallel agents **must** build into their own temp dir and use port 0, never `public/`, so they don't collide.

## 11. Deployment

From `walkthrough/`, the Netlify CLI (`npx netlify-cli@latest`):
1. `sites:create --name infoslips-yes-statement-review` (or the next free name);
2. `env:set ADMIN_CODE <generated>` (functions scope);
3. `deploy --prod --dir public --functions netlify/functions`.

The API credential is injected by the environment proxy for `api.netlify.com`.
