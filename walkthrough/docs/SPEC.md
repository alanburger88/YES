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
  - `#/results`, `#/results/features` (every feature ranked), `#/results/<featureId>`, `#/results/people`
  - `#/data`, `#/data/<featureId>`
  - `#/admin`
  
  The default is `#/start`. Use `WT.go(path)` to navigate (pushState plus a synchronous route; Back and Forward work). On a view change, focus the view's `h1` (`tabindex="-1"`) and update `document.title` to "<View> · YES statement review · InfoSlips". Any route change (including Back/Forward within a view) closes open WT dialogs first, without returning focus to their triggers; focus goes to the new view instead.
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
- **Primary button:** "Start the walkthrough", or, when there is progress, "Continue where you left off: <Title> (step k of N)" (the `lastStep`), or "Continue with <Title> (step k of N)" (the first unanswered feature when there is no `lastStep`). It goes to the same step as `#/tour` without an id. Once every feature is answered, the primary button is "You've answered every feature: see the results" and the continue label becomes a link under it. A secondary "Start from the beginning" link goes to the first feature.
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

**Documented accessibility and brand exceptions.** Each one keeps to the palette; they are recorded here because they bend a rule above.
- **Priority colours in the light-mode charts** (`51-charts.js`): High = **Slate 1 #0F172A** (17.85:1 on white), Medium = **Dark Green #1D5941** (8.21:1), Low = **Medium Green #277656** (5.51:1). Priority is an ordinal ramp, so it needs three steps of monotone lightness that all reach 3:1 on the white card. Only two brand greens do (Green #4EAF60 is 2.75:1, Acorn and Lime are lower), so the darkest step is the near-neutral Slate 1 rather than a third green. Low shares Medium Green with "include" and the score bars; the charts tell them apart by position, legend and the data table. In dark mode (on Slate 2 cards) the ramp is Lime #DBE64C / Acorn #80D100 / Green #4EAF60 (7.61 / 5.44 / 3.76:1). Segments are separated by 2px surface gaps and labelled in place when the label fits. The priority *badges* use the `--high-*`/`--medium-*`/`--low-*` tokens (Dark Green / Medium Green / Slate 7 with a Slate 3 border in light), which are text-on-fill pairs rather than chart marks.
- **Dark-mode control borders** use **Slate 4 #94A3B8** (`--control-border`) instead of the table's #64748B: #64748B is only 2.18:1 on a Slate 2 card, while Slate 4 is 4.04:1 on Slate 2 and 6.96:1 on Slate 1.
- **Selected and current indicators** (tab underline, the nav "current" bar, the current step in "All steps", selected chips and segmented options) use `--highlight` / `--selected-bg`: **Dark Green** in light mode, and **Lime** (or a Green fill with Slate 1 text) in dark mode, because Green #4EAF60 is only 2.75:1 on white.
- **Progress fill** is Medium Green #277656 in light mode (4.47:1 on its #E2E8F0 track, 5.51:1 on white).
- **Muted text on grey fills** is Slate 2 in light mode (`.wt-band`, `.wt-notice`, `.wt-fill`, `.wt-card--fill`), since Slate 3 is 4.36:1 on #F5F5F5. In dark mode it is Slate 5 on Slate 2 and Dark Green surfaces and Slate 4 on Slate 1 (`.wt-fill`).
- **No true error colour** is used: errors are `--error-text` (Dark Green / Lime) with an alert icon and a bold label.

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
- **Tag:** a small label anchored to the outline, "k · Title". It goes above, on the top edge of, below, beside or (last) inside the outline, wherever it hides the least of the statement, and never over a button, link or form control when another spot avoids one.
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

**`WT.tour`** (read-only helpers, used by tests): `current()` (the step id), `frame()` (the `<iframe>`) and `target()` (the highlighted element in the statement, or null).

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

Methods (every one is safe to call at any time and never rejects; the full notes are in the header of `30-driver.js`):
- `WT.driver.reset(win, { top = true })` → `{ ok, problems[] }`: close dialogs via the statement's own APIs (`YES.explorer.closeTx`, `YES.ui.closeDialog` for open `<dialog open>`, the assistant close API), clear the journey selection (`YES.overview.clearStep`), filters and disclosures, pause the video, leave the integrity preview, restore the baseline language and theme, and return to the top. `{ top: false }` keeps the scroll position so the next `scrollToTarget()` glides from where the reader was. A newer `reset()` aborts a running `apply()`.
- `WT.driver.apply(win, step)` → `{ ok, errors[], aborted? }`: runs `step.setup` in order (`{ menu }` actions last) and waits for the frame's scroll to settle.
- `WT.driver.target(win, step, { timeout = 4000 })` → the first visible match of `step.target.phone|desktop`, or null.
- `WT.driver.scrollToTarget(win, el, { behavior, block = 'auto', margin = 12 })` → the target's final rect: scrolls only inside the frame (centred, or to the top when taller than the space), never the parent page; instant with reduced motion.
- `WT.driver.settle(win, { el, minMs, maxMs, frames, animations })`: resolves when the frame's scroll (and `el`) has stopped moving.
- `WT.driver.baseline({ theme, lang })`: sets and returns the state `reset()` restores (the tour passes the app theme).
- `WT.driver.isPhone(win)` (frame width < 720), `ready(win, ms)`, `check(win)`, `selectors(win, step)`, `topInset(win)`, `visible(win, el)`, `firstVisible(win, selector)`.

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
- `mount()` returns an instance with `update(opts)` (keeps the tab, search, expansion and selection) and `destroy()`. Mounting again on the same element updates it. Options: `mode: 'tree' | 'sample' | 'sources'` (the first tab; "By source" is a summary per data source), `compact` (the dense layout; **on by default inside a dialog**), `headingLevel`, `label`.
- Pure helpers: `WT.json.merge(ids)` → `{ features, fields }`, `sample(ids)`, `schema(ids)` (draft 2020-12), `stats(ids)`, `plainType(type)`. `WT.json.openDialog({ features, trigger, title })` shows the compact explorer in a standard dialog with a link to `#/data/<id>`.

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
- **Sub-views.** `#/results` (overview: summary, KPI tiles and charts), `#/results/features` ("Every feature, ranked": the feature cards with a sort), `#/results/<featureId>` and `#/results/people`, linked by a sub-navigation.
- **`WT.results`** (`50-results.js`): `refreshMs` (30000), `load({ manual, force })`, `data()` (the last results object), `model()` (one derived row per feature) and `sentences()` (the summary in words). The module emits `results` with each fresh object.
- **`WT.moderation`** (`52-admin.js`): `enabled()`, `hide({ rid, featureId, field, hidden }, trigger)`, `deleteReviewer(rid, name, trigger)` (confirms), `reset(trigger)` (type RESET) and `signOut()`. Each successful change emits **`moderated`** (true; false when the reviewer was already gone), and the results reload on it.
- **`WT.charts`** (`51-charts.js`): the chart builders and `PALETTE` (see the exceptions in section 4).
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

## 12. Components and helpers reference

Written by foundation. **Reuse these instead of re-inventing them.** Everything below is in `src/js/00-core.js`, `05-shell.js` and `src/css/00-tokens.css` … `05-shell.css`. The demo is the start view (`10-start.js`).

### 12.1 Rules every module must follow

- **CSP** (section 9) applies to the app page: no `style="…"` attributes, no `<style>` elements (in SVG too), no inline `<script>` or `on…=` handlers, and no external URLs. For dynamic sizes, set CSSOM from JS (`el.style.setProperty('--w', pct + '%')`, which is allowed) or use SVG geometry attributes (`width`, `x`, `d` …). Colour SVG marks with classes in your CSS (`.bar--include { fill: var(--…) }`), because `fill="var(--…)"` does not work as an attribute. `img-src` allows `'self'` and `data:` only, so `blob:` images won't load. Downloads through `WT.download` work.
- **Escaping.** Interpolate with `WT.esc(v)` or the `WT.h` tagged template, and render with `WT.render(el, html)`. Give every control a stable `data-fk` so re-renders keep focus and the text selection.
- **Colour.** Use semantic tokens (`var(--heading)`, `var(--link)` …), never raw hex. Palette tokens (`--c-green`, `--c-slate-3` …) are only for charts and must be checked for 3:1 in both themes. For a rule that differs in dark mode, write it twice: `:root[data-theme='dark'] .x {…}` and `@media (prefers-color-scheme: dark) { :root:not([data-theme='light']) .x {…} }`.
- **Surfaces re-scope the text tokens**, so text on them stays legible. Inside `.wt-card`, `.wt-dialog`, `.wt-notice` and `.wt-surface` in dark mode (Slate 2 #334155), `--body`/`--muted` become Slate 5, `--link` becomes Lime and `--border` becomes Slate 3. Inside `.wt-band`, `.wt-fill`, `.wt-card--fill` and `.wt-notice` in light mode, `--muted` becomes Slate 2 (Slate 3 is only 4.36:1 on #F5F5F5). A dark `.wt-fill` (Slate 1) takes `--muted` back to Slate 4.
- **Accessibility and brand exceptions** (dark control borders, selected indicators, progress fill, the priority chart colours, no error colour) are recorded in section 4, "Documented accessibility and brand exceptions".
- **Layout contract.**
  - The masthead is sticky and `var(--mast-h)` (64px) tall.
  - `<html data-view="start|tour|results|data|admin">` names the current view.
  - `#view-tour` has no padding and the footer is hidden on the tour, so the tour can fill `calc(100svh - var(--mast-h))`.
  - Other views get `padding-block: 32px 64px`. Wrap content in `.wt-container`.
  - Breakpoints: phone below 720px; tablet 720–1023px; desktop 1024px and up (`WT.isNarrow()` means below 720px).
  - `<html class="wt-js">` is present whenever JavaScript runs.
- **Views.** Render exactly one `<h1 class="wt-title" tabindex="-1" data-fk="h1">` per view. The router focuses it on navigation, except on first load.

### 12.2 `window.WT` helpers (`00-core.js`)

**Escaping, DOM, utilities**

| Helper | Use |
|---|---|
| `WT.esc(v)` | HTML-escape any value (text and attributes; also escapes `` ` ``). |
| ``WT.h`…${v}…` `` | Tagged template that escapes every value. Arrays are joined; `null`/`undefined`/`false` render nothing; nested `WT.h` and `WT.raw(html)` pass through. Returns a Raw object, so use `String(x)` for the string. |
| `WT.raw(html)` | Mark trusted HTML for `WT.h`, such as `WT.raw(WT.icon('check'))`. Never wrap user text in it. |
| `WT.render(el, html)` | Replace content, then restore focus, the selection and the scroll position to the element with the same `data-fk`. |
| `WT.$(sel, root?)`, `WT.$$(sel, root?)` | `querySelector`; `querySelectorAll` as an array. |
| `WT.delegate(root, evt, selector, fn)` | Delegated listener: `fn(event, matchedEl)`. |
| `WT.debounce(fn, ms)` | Debounced function with `.cancel()`. |
| `WT.uid(prefix)` | Unique id for aria wiring (`'fld-3'`). |
| `WT.attrs({ k: v })` | Escaped attribute string (`false`/`null` dropped, `true` → bare attribute). |
| `WT.cssEscape(s)` | `CSS.escape` with a fallback. |
| `WT.reducedMotion()`, `WT.isNarrow()` | Media checks. |
| `WT.storage` / `WT.session` | localStorage / sessionStorage that never throw: `get(key, fallback)` (JSON), `getRaw(key)`, `set(key, value)`, `remove(key)`. |

**Events, features, constants**

| Helper | Use |
|---|---|
| `WT.on(evt, fn)` → `off()`, `WT.off`, `WT.emit` | Event bus. A listener that throws is logged and skipped. |
| Events | `route` {view, param, path, prev} · `theme` ('light'\|'dark') · `reviewer` (reviewer copy) · `answers` (featureId, or null for "many changed") · `saving` {pending} · `saved` {ok, pending, savedAt?, error?, status?, offline?} · `admin` (true\|false) · `ready` · `results` (emitted by the results module) · `moderated` (emitted by `WT.moderation`). |
| `WT.features` | Array from `shared/features.json`, inlined by the build. `WT.feature(id)` returns a feature with an extra `index` (0-based), or null. |
| `WT.featureIndex(id)` | 0-based position, or -1. |
| `WT.SECTIONS`, `WT.sectionLabel(section)` | `overview` → "Overview" … `everywhere` → "Throughout the statement". |
| `WT.shot(id, thumb?)` | `'assets/shots/<id>.jpg'` or `'-thumb.jpg'`. |
| `WT.ANONYMOUS` | "Anonymous reviewer". |
| `WT.LIMITS` | `{ name: 60, reason: 500, comment: 2000 }`. |
| `WT.VOTE_LABEL`, `WT.PRIORITY_LABEL`, `WT.VIEWS` | Display labels. |

**Router**

| Helper | Use |
|---|---|
| `WT.register({ name, view?, init(), render(param, route), onRoute?(param, route), leave?(), keepScroll?, manageFocus? })` | Register a module. `render` runs when the view is entered. `onRoute` (optional) runs instead when only the param changes within the same view (the tour uses this to avoid reloading the frame). `leave` runs when another view takes over (stop timers there). `manageFocus: true` stops the router focusing the h1. `keepScroll: true` keeps the scroll position on param changes. `render` may return a promise. A view with no module shows a polite placeholder. |
| `WT.go(path, { replace?, force? })` | Navigate (`'/tour/journey'` or `'#/results'`). Pushes history and routes synchronously. Every route change closes open WT dialogs (focus goes to the new view, not the trigger). |
| `WT.refresh()` | Re-render the current route. |
| `WT.route()` | Returns `{ view, param, path }`. |
| `WT.parseRoute(hash)` | Parse a hash, or return null for non-route hashes such as `#main`. |
| `WT.setTitle(part)` | `document.title = part + ' · YES statement review · InfoSlips'`. The router sets the view name before `render`, and modules may override it. |
| `WT.focusView(view?)` | Focus the view's h1. |
| `WT.module(name)` | A registered module, by name. |

**Theme.** `WT.theme.get()` returns the saved choice or null; also `set('light'|'dark'|null)`, `toggle()`, `effective()` and `device()`. The choice is stored in localStorage `infoslips.wt.theme`. The tour mirrors `effective()` into the statement frame and listens to the `theme` event.

**Reviewer** (localStorage `infoslips.wt.reviewer` = `{ secret, name, rid, answers, lastStep }`)

| Helper | Use |
|---|---|
| `WT.reviewer.get()` | A copy of the record. `secret` is `''` until the first save. |
| `WT.reviewer.secret()` | The secret; creates it if missing. |
| `WT.reviewer.name()`, `WT.reviewer.displayName()` | The name, or "Anonymous reviewer". |
| `WT.reviewer.setName(name)` | Clean, save locally, queue for the server; emits `reviewer`. |
| `WT.reviewer.lastStep()`, `WT.reviewer.setLastStep(id)` | Resume point (no event). |
| `WT.reviewer.rid()` | Promise of this browser's reviewer id, so results can mark "you". |
| `WT.reviewer.hasProgress()` | True when there is a lastStep or any answer. |
| `WT.reviewer.reset()` | Promise. "Start as a new reviewer": flushes, then sets a fresh identity. |
| `WT.cleanName(s)` | The same cleaning as the server. |

**Answers**

| Helper | Use |
|---|---|
| `WT.answers.get(id)` | `{ vote, reason, priority, comment, updatedAt }` or null. |
| `WT.answers.all()` | All answers. |
| `WT.answers.set(id, patch)` | Merge, save locally, debounce to the server (600 ms); emits `answers`. An answer left empty is cleared. |
| `WT.answers.clear(id)` | "Clear my answer". |
| `WT.answers.stats()` | `{ total, answered, voted, include, exclude, prioritised, commented, firstUnanswered }`. |
| `WT.answers.status()` | `{ saving, ok, pending, error, savedAt }`. Use with the `saving`/`saved` events for the autosave line. |
| `WT.answers.pending()` | Number of queued changes. |
| `WT.answers.flush()` / `WT.answers.retry()` | Send queued changes now. Promise<boolean>. |
| `WT.answers.sync()` | Re-read the server. Runs at boot. |

Failed saves stay in localStorage `infoslips.wt.pending` and are retried on the next change, on `online`, on load, and with backoff (5–60 s) after network or 5xx errors. **On load the server wins** for anything not queued: answers that exist only in the browser (deleted by an admin or a reset) are dropped. Bodies over about 60 KB are split across requests.

**API client.** `WT.api` sends JSON, times out after 15 s, and throws `WT.ApiError { status, code, message }`; status 0 means offline or network.

| Helper | Use |
|---|---|
| `WT.api.health()`, `me()`, `saveMe(body, secret?)`, `deleteMe()` | Health check and the reviewer's own record. |
| `WT.api.results({ admin? })` | `{ admin: true }` adds `?admin=1` and the stored code. |
| `WT.api.exportUrl('csv'|'json')` | Use as `<a href download>`. |
| `WT.api.request(method, path, opts)` | Low-level request. |
| `WT.api.admin.check(code)` | Promise: true (code stored in sessionStorage `infoslips.wt.admin`, emits `admin`) or false on 401. Rejects with status 503 when `ADMIN_CODE` isn't set. |
| `WT.api.admin.code()`, `signedIn()`, `signOut()` | Stored-code helpers. Any admin call that gets 401 signs out. |
| `WT.api.admin.hide({ rid, featureId, field, hidden })`, `deleteReviewer(rid)`, `reset()` | Moderation calls. |

**Feedback**

| Helper | Use |
|---|---|
| `WT.announce(msg, assertive?)` | Live-region message. It goes inside the top modal dialog when one is open. |
| `WT.toast(msg, { kind: 'info'|'success'|'error', timeout })` | Short visual confirmation (also announced), shown above dialogs. No controls inside. |
| `WT.copy(text)` | Promise<boolean>. |
| `WT.download(filename, content, mime)` | Save a file. |

**Icons.** `WT.icon(name, { size = 20, cls, label })` returns an inline SVG, `aria-hidden` unless `label` is given (`role="img"`). Names (`WT.ICONS`): arrow-left/right/up/down, restart, refresh, check, check-circle, x, x-circle, minus, plus, list, menu, sun, moon, user, users, chart, braces, download, upload, copy, search, chevron-down/up/left/right, external, info, alert, help, eye, eye-off, trash, lock, unlock, edit, comment, flag, play, image, filter, home, logout, target, expand, collapse, keyboard, sparkle, layers, dot.

**Formatting** (en-GB):
- `WT.fmt.date(iso)` → "4 Oct 2026, 18:40"
- `WT.fmt.day(iso)` → "4 Oct 2026"
- `WT.fmt.relative(iso)` → "just now" / "5 minutes ago" / "yesterday" / the date
- `WT.fmt.pct(fraction)` or `pct(n, total)` → "67%", or "–" when there's nothing to divide
- `WT.fmt.num(n)` → "1,234"
- `WT.fmt.plural(n, one, many?)` → "3 reviewers"

**Dialogs** (native `<dialog>`, a bottom sheet under 720px)

| Helper | Use |
|---|---|
| `WT.dialog.create({ id, title, body, foot, size: 'sm'|'lg', wide })` | Build a standard dialog once and append it to `<body>`. It is labelled by `#<id>-title`, has a close button, and any `[data-wt-close]` button closes it. |
| `WT.dialog.open(el, { trigger, initialFocus, lightDismiss, onClose(returnValue) })` | Open as a modal; focus returns to `trigger` on close. |
| `WT.dialog.close(el, value)` | Close. |
| `WT.dialog.setReturn(el, target)` | Change where focus returns. |
| `WT.dialog.confirm({ title, body, html, confirmLabel, cancelLabel, danger, typeToConfirm: 'RESET', trigger })` | Promise<boolean>. Focus starts on Cancel, or on the type-to-confirm input. |

**UI builders** (return HTML strings that use the classes in 12.3)

| Helper | Use |
|---|---|
| `WT.ui.segmented({ name, legend, options: [{ value, label, icon? }], value, variant: 'vote'|'priority', size: 'lg', hint, fk, legendHidden, disabled })` | Segmented radio group. |
| `WT.ui.voteGroup({ value, name?, fk?, hint? })` | Include / Exclude (big, with icons). |
| `WT.ui.priorityGroup({ value, … })` | High / Medium / Low, legend "Priority if included", with help text. |
| `WT.ui.field({ id, label, value, max, hint, multiline, rows, optional, placeholder, autocomplete, fk })` | Labelled input or textarea with a live counter ("120 / 500"). Counters update automatically on `input` for any control with `data-counter`, and announce the last 10% and the limit. |
| `WT.ui.counter(id, n, max)` | The counter element on its own. |
| `WT.ui.switch({ id, label, checked, hint, fk })` | Checkbox with `role="switch"` (for example "Dim the rest"). |
| `WT.ui.badge(kind, text, icon?)`, `WT.ui.voteBadge(vote)`, `WT.ui.priorityBadge(p)` | Badges. |
| `WT.ui.notice({ kind: 'info'|'brand'|'error'|'success', title, text \| html, compact, role })` | Notice box. |
| `WT.ui.skeleton({ lines, title, block, label })` | Loading state (`aria-busy`, "Loading…" for screen readers). |
| `WT.ui.progress({ id, value, max, label, hideLabel })` | Labelled native `<progress>`. |
| `WT.ui.tableWrap(tableHtml, label, cls?)` | Focusable scroll region with a sticky header. |
| `WT.ui.tabs(rootEl, onChange?)` | Wires a `role="tablist"`: arrow keys, Home/End, automatic activation, and toggling panels by `aria-controls`. |

**Shell** (`05-shell.js`): `WT.brandNotice({ compact })` returns the section 3 branding text (`[data-brand-notice="full"|"compact"]`). `WT.shell.openNameDialog(trigger)` and `WT.shell.closeMenu()` are also available.

### 12.3 CSS classes (`02-components.css` unless noted)

**Base** (`01-base.css`)
- Layout and type: `.wt-container` (max 1200px + gutters), `.wt-stack` (vertical rhythm via `--stack`), `.wt-cluster` (wrapping row via `--gap`) with `--end` and `--between`, `.wt-grid` (auto-fill via `--min`), `.wt-list-plain`, `.wt-prose`.
- Headings and text: `.wt-display` (48/800), `.wt-title` (adds the 4px Green accent bar under a title), `.wt-eyebrow` (12/600 caps), `.wt-lead` (18px), `.wt-caption`, `.wt-label-caps`, `.wt-muted`, `.wt-num` (tabular figures).
- `.wt-view` (view section padding).

**Accessibility**
- `.wt-sr-only` (visually hidden) and `.wt-sr-only-focusable`.
- `.wt-skip` (skip link).
- `:focus-visible` gives a global 3px `--focus` ring with a 2px offset; `forced-colors` and `prefers-reduced-motion` are handled globally. Headings that receive programmatic focus (`h1`/`h2` with `tabindex="-1"`) show nothing after mouse or touch use and, after a keyboard action, a quiet `--focus` line instead of a box (the `.wt-title` accent bar turns the focus colour and runs the full width).

**Buttons:** `.wt-btn` plus one of:
- `--primary` (Green, 6.5:1 text)
- `--secondary` (outlined link colour)
- `--ghost`
- `--danger` (strong Slate 1/White, for destructive confirms)
- `--link` (looks like a link, 24px target)
- `--icon` (44×44; give it an `aria-label`)

Sizes: `--sm` (36px), `--lg` (52px), `--block`. `:disabled` and `[aria-busy="true"]` (spinner) are styled. Put icons inside as `WT.icon(…)`.

**Forms**
- Field parts: `.wt-field`, `.wt-label`, `.wt-optional`, `.wt-hint`.
- Controls: `.wt-input`, `.wt-textarea` and `.wt-select` (44px; `[aria-invalid="true"]` thickens the border).
- Messages: `.wt-counter` (`[data-state="near"|"full"]`) and `.wt-error` (Dark Green/Lime, bold, with an icon).
- Groups: `.wt-fieldset` (+ `--boxed`) and `.wt-legend`.

**Segmented radio group:** `.wt-segmented` (on a fieldset) › `.wt-segmented__options` › `label.wt-segmented__option[--include|--exclude]` › `input.wt-segmented__input[type=radio]` + `span.wt-segmented__label`. The variants are:
- `.wt-segmented--vote`: Include is Green; Exclude is Slate 2 in light and Slate 4 in dark.
- `.wt-segmented--priority`.
- `.wt-segmented--lg`: 56px.

The radio covers its label, so the whole button is the click target. A radio dot shows the state, so colour is never the only signal.

**Switch:** `label.wt-switch` › `input.wt-switch__input[type=checkbox][role=switch]` + `span.wt-switch__track` + `span.wt-switch__label`.

**Surfaces**
- `.wt-card`, with `--flat` (no shadow), `--fill` (grey), `--compact` and `--link` (the whole card is an `<a>`); `.wt-card__title`.
- `.wt-band`: a full-width feature section with `--section` (#F5F5F5 / Dark Green).
- `.wt-surface`: a card-coloured panel with no padding.
- `.wt-fill`: a subtle grey.
- `.wt-divider`.
- `.wt-details`: a styled `<details>` disclosure.

**Chips and badges**
- `.wt-chip`: a pill button or link. `[aria-pressed="true"]`, `[aria-current]` and `.is-selected` style the selected state; `--static` makes it non-interactive.
- `.wt-badge` with `--include` (✓, Green), `--exclude` (✗, Slate), `--high`, `--medium`, `--low`, `--none` / `--neutral` (no vote, counts), `--hidden` (dashed: "Hidden by admin") and `--brand`.

**Notices:** `.wt-notice` › `.wt-notice__icon` + `.wt-notice__body` (+ `.wt-notice__title`), with `--info`, `--brand`, `--error`, `--success` and `--compact`. Use `WT.brandNotice()` for the branding notice.

**Status:** `.wt-status[data-state="saving"|"saved"|"error"]` is the inline autosave line, with an icon and text.

**Tables:** `.wt-table-wrap` (a scroll container; give it `role="region"`, `tabindex="0"` and an `aria-label`; `--table-max-h` caps its height) › `table.wt-table`. The `thead th` row is sticky. The variants are:
- `.wt-table--sticky-col`: the first column is sticky too, for the people × features matrix.
- `.wt-table--compact`.

Use `.wt-num`, `td.is-num` or `th.is-num` to right-align numbers.

**Loading:** `.wt-skeleton-group` › `.wt-skeleton` with `--title`, `--text`, `--block` or `--circle` (it pulses unless reduced motion is on).

**Dialog:** `dialog.wt-dialog` with `--sm` or `--wide`. Its structure is `.wt-dialog__inner` › `.wt-dialog__head` (`.wt-dialog__title`, `.wt-dialog__close`), then `.wt-dialog__body` (scrolls) and `.wt-dialog__foot` (actions, right-aligned). `.wt-dialog__text` holds body copy. Under 720px the dialog becomes a bottom sheet with full-width actions.

**Tabs:** `.wt-tabs[role=tablist]` › `button.wt-tab[role=tab][aria-selected]` and `.wt-tabpanel[role=tabpanel]`. Wire them with `WT.ui.tabs`.

**Progress:** `.wt-progress` › `.wt-progress__label` + `progress.wt-progress__bar`.

**Lists and states**
- `.wt-steps` › `.wt-steps__item` › `.wt-steps__n` + `.wt-steps__h` (numbered steps).
- `.wt-empty` (+ `.wt-empty__icon`) is the empty state; `.wt-placeholder` is the "not ready" view.
- `.wt-kbd` / `kbd` styles key caps (for the Alt+→ help).

**Toasts:** `.wt-toasts` › `.wt-toast` (`--error`). Created by `WT.toast`.

**Shell** (`05-shell.css`)
- Masthead: `.wt-mast` and its parts `__inner`, `__brand`, `__app`, `__menu`, `__menu-btn` and `__tools`.
- Logos: `.wt-logo`, with `--light` / `--dark` showing one per theme.
- Nav: `.wt-nav__list` and `.wt-nav__link` (`[aria-current="page"]`).
- Controls: `.wt-reviewer-chip` and `.wt-theme-toggle` (with `__track`, `__knob`, `__sun`, `__moon` and `__label`).
- Footer: `.wt-foot` and its parts `__inner`, `__logo`, `__text`, `__links` and `__admin`.
- Name dialog: `.wt-name-form`, `.wt-name-dialog__other` and `.wt-name-dialog__h`.

**Start** (`10-start.css`): the `.wt-start__*` classes are private to the start view.

**Token quick list** (`00-tokens.css`):
- Page and surfaces: `--bg`, `--section`, `--surface` (+ `--surface-shadow`, `--surface-border`), `--surface-2`, `--dialog-bg`.
- Text and lines: `--heading`, `--body`, `--muted`, `--border`, `--border-strong`.
- Controls: `--control-bg`, `--control-border`, `--hover-fill`.
- Brand and links: `--accent`, `--link`, `--link-hover`, `--highlight`.
- Buttons: `--btn-bg`, `--btn-text`, `--btn-hover-bg`, `--btn-hover-text`, `--btn-strong-bg`, `--btn-strong-text`.
- Focus and states: `--focus`, `--spot`, `--selected-bg`, `--selected-text`.
- Votes and priorities: `--include-bg`/`-text`, `--exclude-bg`/`-text`, `--high-*`, `--medium-*`, `--low-*` (+ `--low-border`).
- Indicators: `--track`, `--fill`, `--switch-off`, `--switch-on`, `--switch-knob`.
- Notices and errors: `--notice-bg`, `--notice-text`, `--error-text`.
- Loading and tables: `--skeleton`, `--table-head-bg`, `--table-row-hover`.
- Overlays: `--backdrop`, `--overlay-dim` (the tour spotlight, rgb(15 23 42 / .55)), `--toast-bg`, `--toast-text`, `--shadow-pop`, `--code-bg`.
- Type: `--font-sans`, `--font-mono`, `--fs-*`, `--lh-*`, `--tracking-caps`.
- Space and shape: `--sp-1…8`, `--radius-sm`, `--radius`, `--radius-lg`, `--radius-pill`, `--gutter`, `--container`.
- Layout and layers: `--mast-h`, `--target` (44px), `--z-*`.
- Motion: `--dur`, `--dur-slow`, `--ease`.
- Brand palette: `--c-*`.

### 12.4 API details beyond section 9

**Response extras**
- `GET /api/health` also returns `adminConfigured`.
- `GET/PUT /api/me` return `{ rid, name, createdAt, updatedAt, answers, hidden }`, or `{ rid, name: '', answers: {} }` when nothing is stored. A PUT that would store nothing creates no record.
- `DELETE /api/me` returns `{ ok, deleted, rid }`.
- `GET /api/results` adds:
  - `admin` (boolean);
  - `features[id].comments` and `.reasons` (visible counts), with `score` rounded to 2 decimals (null with no priorities);
  - `people[].createdAt`.
  
  People are reviewers with at least one answer, newest first. Responses are newest first.
- Exports name anonymous reviewers `Anonymous reviewer (<first 6 of rid>)` so rows can be told apart. JSON export is `{ generatedAt, columns, rows }`. Both are sent as attachments named `yes-statement-review-YYYY-MM-DD.csv|json`.

**Errors**

| Status | `error.code` |
|---|---|
| 401 | `no_secret` |
| 400 | `bad_secret`, `bad_json` |
| 422 | `invalid`, `unknown_feature`, `too_long`, `confirm_required` |
| 413 | `too_large` |
| 401 | `bad_admin_code` |
| 503 | `admin_not_configured` |
| 404 | `not_found` |
| 405 | `method_not_allowed` (with an `Allow` header) |
| 409 | `conflict` (Blobs write kept conflicting; very rare) |
| 500 | `server_error` |

**Text cleaning**
- Control characters except `\n`, bidi overrides/isolates and BOMs are stripped. CRLF becomes `\n`.
- Names collapse whitespace to single spaces.
- Limits are measured after trimming.

**Stores** also implement `update(key, fn)`, an atomic read-modify-write. Memory and file stores use a per-key lock. The Blobs store uses `getWithMetadata` and `setJSON` with `onlyIfMatch`/`onlyIfNew`, retrying on conflict.

**Local development**
- `npm run dev` builds to `public/` and serves on :8888 with a file store in `walkthrough/.data/`.
- `node server/dev.mjs --root <dir> --port 0 --store memory` prints `WT_LISTENING <url>`.
- Set `ADMIN_CODE=… node server/dev.mjs …` to enable admin.
- `startServer({ root, port, store, adminCode })` is exported for in-process use.

**Build:** `build({ out, quiet })` is exported. It refuses to empty a non-empty directory that isn't a previous build. JS files must match `NN-name.js`; `src/js/theme-boot.js` is the only non-bundled script. Assets are copied to `assets/brand/`, `assets/shots/`, `assets/icons/` and `assets/fonts/`.

### 12.5 Writing tests (`tests/run.mjs`, `tests/helpers.mjs`)

- **Shape.** A test file exports `export default async function (ctx)`, plus an optional `export const meta = { timeout }` (180 s by default).
- **`ctx`** is `{ base, browser, api, assert, log, step, reset, adminCode, features, root, out, file, shotsDir }`:
  - `assert` is `node:assert/strict`.
  - `step(name, async fn)` records a failure and carries on, so name every check.
  - `api(path, { method, body, secret, admin, headers, rawBody })` returns `{ status, ok, headers, json, text, bytes }`.
  - `reset()` empties the database. The runner calls it before each file, so every file starts with no reviewers.
  - `features` is read from `shared/features.json`. Never hard-code ids or counts.
- **Commands.**
  - `node tests/run.mjs --only <substring>` runs matching files.
  - `--keep` keeps the temp build.
  - Each file is also importable directly; see `tests/32-datareq.test.mjs`, which also runs standalone.
- **`helpers.mjs` exports**

| Helper | Use |
|---|---|
| `openPage(ctx, { viewport, colorScheme, reducedMotion, storage, timezoneId, javaScriptEnabled })` | Returns `{ context, page, errors, ignored, external, close }`. Everything except `base` is blocked and recorded in `external`. Console errors and page errors are collected (offline noise is filtered by `IGNORED_CONSOLE`). `storage` seeds localStorage once, before the app runs. |
| `VIEWPORTS` | desktop 1280×900, wide 1920×1080, tablet 900×1100, phone 390×844, narrow 320×640. |
| `gotoApp(page, base, '#/results')` | Waits for `<html data-wt-ready="1">`. |
| `waitForView(page, view, param?)` | Waits for the router to show a view. |
| `focused(page)` | `{ tag, id, text, fk, role, label }`. |
| `axe(page, { include, exclude, disableRules, tags })` | Injects via `page.evaluate`, which works under the CSP. Returns violations; use `formatViolations` for the message. |
| `shot(page, name, { fullPage })` | Writes `$WT_SHOTS/<name>.png` (`walkthrough/test-results/screens`, gitignored). |
| `assertNoErrors(errors, assert, external?)` | Fails on errors and unexpected requests. |
| `features()`, `newSecret()`, `ridFor(secret)`, `sleep(ms)`, `apiClient(base)` | Data and timing utilities. |
| `seedReviewer(api, { secret?, name?, answers })` | Server only. |
| `seedBrowserReviewer(api, { name, answers, lastStep })` | Server and the matching localStorage seed. **Use this to show answers in the app.** |
| `reviewerStorage({ … })` | Local only; the load-time sync drops answers the server doesn't have. |

- **Tour tests** run the statement in a same-origin frame. UserWay requests are aborted, as in the statement's own tests.
