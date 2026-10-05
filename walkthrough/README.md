# YES statement review (InfoSlips walkthrough app)

A guided, shareable review of the new interactive YES statement. People at YES open one link, walk through the live statement feature by feature, and say for each one:

- **include or exclude** it in the production statement, with an optional reason;
- a **priority** (High, Medium or Low);
- a **comment**.

Every answer is saved as they go and shown to everyone with the link as **results**: a summary in words, charts, every feature ranked, every response with a screenshot of the part of the statement it is about, and a reviewer × feature matrix. For the features people want, the **data requirements** can be explored as a JSON structure, with a sample payload and a JSON Schema to download.

The statement itself (`../dist/yes-statement.html`) is shown **unchanged** inside the tour, in a same-origin frame. Reviewers can switch the frame between **Mobile, Tablet and Desktop** ("View as") to see the statement as it lays out on each, and can **open the statement in a new tab** (from the tour bar, at the statement view the frame is showing, or from the start page) to explore it on its own. The app around it is InfoSlips-branded, works in light and dark mode, and targets WCAG 2.2 AA.

> **Branding notice.** The YES branding in the statement (colours, logo and typography) is a placeholder. It will be updated once YES supplies its final brand assets. The app says so on the start page (full notice), and in a compact notice in the tour bar, the tour's All steps dialog, and on the results and data requirements pages. It asks reviewers to judge the features, not the look. Keep this notice until the statement carries YES's final branding.

The build contract is [`docs/SPEC.md`](docs/SPEC.md). [`docs/STATEMENT-MAP.md`](docs/STATEMENT-MAP.md) maps each of the 22 features to the statement's UI and APIs.

---

## For the InfoSlips / YES owner

### Sharing the review
Send the site link (https://infoslips-yes-statement-review.netlify.app) to the reviewers. There is no sign-in: anyone with the link can take part and see the results. Each browser is one reviewer (a random secret in the browser's local storage); people can add a name or stay "Anonymous reviewer". From the name dialog, reviewers can also start as a new reviewer on a shared browser, or remove their own answers from the results. The pages ask search engines not to index them (`noindex`, `robots.txt`).

### Moderation (admin)
- The admin code is the **Netlify environment variable `ADMIN_CODE`** of the project (in the Netlify UI: the project's configuration → Environment variables). It must be **at least 16 characters**; if it is unset or shorter, admin is turned off. On the free Netlify plan, variables can't be scoped or marked secret, so it is set without scopes (it applies everywhere, the function included). Change it there and redeploy.
- After **10 wrong codes from one address within 10 minutes**, that address is locked out of admin for 10 minutes (counted per function instance, so best effort).
- To moderate, open **Admin** (the small link in the footer, or `/#/admin`) and enter the code. It is kept only in that browser tab (session storage) until you sign out or close the tab.
- While signed in, the results pages show inline controls to **hide or unhide a reason or comment** (hidden text disappears for everyone, including the exports), **delete a reviewer's answers** (with a confirmation), and **reset all results** (type `RESET` to confirm).

### Where the answers are stored
- **Netlify Blobs**, store **`reviews`** (site-wide, strong consistency). One JSON record per reviewer at the key `r/<rid>`, where `rid` is the first 24 hex characters of the SHA-256 of the browser's secret. Nothing else is stored; the record format is in SPEC section 9.
- **Export:** the **Export CSV** and **Export JSON** buttons on the results pages (or `GET /api/export.csv` / `GET /api/export.json`) give one row per reviewer × answered feature. The CSV is UTF-8 with a BOM and is safe to open in Excel. Hidden text is left out.
- **Reset:** Admin → **Reset all results** (type `RESET`), or from a terminal:
  ```sh
  curl -X POST https://<site>/api/admin/reset -H "X-Admin-Code: $ADMIN_CODE" \
       -H "Content-Type: application/json" -d '{"confirm":"RESET"}'
  ```
  The Netlify CLI can also inspect the store directly: `npx netlify-cli blobs:list reviews`, `blobs:get reviews r/<rid>`, `blobs:delete reviews r/<rid>`.
- Export a copy before a reset: it can't be undone.

### Accepted risks
- **UserWay.** The statement inside the tour runs the third-party UserWay accessibility widget on the same origin as the app, so a compromised UserWay CDN could read the admin code from session storage (and this browser's reviewer secret from local storage). This is accepted for this showcase because UserWay is part of the statement being reviewed. Mitigations: rotate `ADMIN_CODE` after the review period, and sign out of admin when you're done.
- **Public data.** All answers (names, votes, priorities, reasons and comments) are public to anyone with the link, by design.

---

## For developers

### Requirements
- Node.js 22.12 or later.
- `npm install` in the repository root (Playwright 1.56.1 and axe-core, used by the tests and the screenshot script) and in `walkthrough/` (`@netlify/blobs`, and the Inter font package used by the build).
- Chromium for Playwright (preinstalled in the InfoSlips build environment).

### Run it locally
```sh
cd walkthrough
npm run dev            # node build.mjs → public/, then serves http://localhost:8888 with a file store in .data/
ADMIN_CODE=dev-admin-code-1234 npm run dev   # with admin turned on (the code needs 16+ characters)
```
`node server/dev.mjs --root <dir> --port 0 --store memory` serves any build on a free port with an in-memory store (it prints `WT_LISTENING <url>`).

### Build
`node build.mjs [--out dir]` (default `public/`) copies `../dist/yes-statement.html` **byte for byte** to `statement/index.html` (and fails if the SHA-256 differs), bundles `src/js/NN-*.js` and `src/css/NN-*.css` into content-hashed files, and copies the logos, screenshots, icons and the Inter font. The build is deterministic. There is no framework and no CDN: the app page runs under a strict CSP (no inline script or style).

Layout: `src/js/00-core.js` (runtime, router, API client, dialogs, UI builders), `05-shell.js`, `10-start.js`, `30-driver.js` + `31-steps.js` (driving the statement), `32-datareq.js` (data requirements), `40-tour.js`, `50-results.js` + `51-charts.js` + `52-admin.js`, `60-json.js` + `61-data.js`; the API is `server/api-core.mjs`, wrapped for Netlify by `netlify/functions/api.mjs`. SPEC section 12 lists every shared helper and CSS class.

### What the app keeps in the browser
- **localStorage:** `infoslips.wt.reviewer` (this browser's reviewer: secret, name, answers, resume point), `infoslips.wt.pending` (changes waiting to be saved, shared by every tab), `infoslips.wt.hold` (a short hold while another tab removes this reviewer's answers), `infoslips.wt.theme` (light/dark choice), `infoslips.wt.device` (the tour's "View as" choice) and `infoslips.wt.tour.dim` ("Dim the rest").
- **sessionStorage** (this tab only, shared with the same-origin statement frame): `infoslips.wt.admin` (the verified admin code) and `infoslips.wt.stepLang` (set while a tour step has changed the statement's language, so the tour never makes Spanish its baseline; the statement keeps its own language in `yes.lang`).

### Test
```sh
cd walkthrough
node tests/run.mjs                  # build to a temp dir, serve with a memory store, run tests/*.test.mjs
node tests/run.mjs --only 90-a11y   # one file (substring match)
node tests/run.mjs --keep           # keep the temp build
```
The tests block all outbound network. Screenshots they take go to `test-results/screens/` (git-ignored). The suite covers the API, the shell, every tour step at desktop and phone sizes, the data requirements, results and moderation, the data view, and accessibility (`tests/90-a11y.test.mjs`: axe with zero violations on every view in light and dark at 1280×800 and 390×844, 320px reflow, visible keyboard focus, reduced motion, 200% zoom, and dialogs closing on navigation). A full run takes about 10 minutes.

### Regenerate the feature screenshots
```sh
cd walkthrough
node scripts/shots.mjs                    # all features → src/shots/<id>.jpg and <id>-thumb.jpg
node scripts/shots.mjs --only why,fees    # just these
```
They are taken from the built statement at 1280×900, light theme, English, and are committed. Rebuild the app afterwards.

### Update the statement
1. Change the statement in `../src` and rebuild it from the repository root: `node build.mjs` (writes `dist/yes-statement.html`). Run the statement's own tests there.
2. Rebuild the walkthrough: `cd walkthrough && node build.mjs`. The copy is checked byte for byte against `dist`.
3. If the statement's UI changed, run `node tests/run.mjs --only 30-steps` (every feature's setup and highlight target, at several sizes) and update `src/js/31-steps.js` / `docs/STATEMENT-MAP.md` if a target moved, then regenerate the screenshots (above).
4. Run the full test suite, then deploy.

The 22 feature ids in `shared/features.json` are frozen (answers and data requirements are keyed by them); only their titles and one-line summaries may change.

### Deploy (Netlify, SPEC section 11)
The live project is **`infoslips-yes-statement-review`** (https://infoslips-yes-statement-review.netlify.app). From `walkthrough/`, with the Netlify CLI (`npx netlify-cli@latest`):
```sh
node build.mjs                                                     # → public/
export NODE_USE_ENV_PROXY=1                                        # only behind an HTTPS proxy (e.g. a cloud sandbox)
npx netlify-cli@latest sites:create --name infoslips-yes-statement-review   # first time only (or the next free name)
npx netlify-cli@latest env:set ADMIN_CODE "<a long random code, 16+ characters>" --site infoslips-yes-statement-review
npx netlify-cli@latest deploy --prod --dir public --functions netlify/functions --site infoslips-yes-statement-review --no-build
```
What we learned deploying with the CLI from a cloud sandbox:
- **Behind an HTTPS proxy**, set `NODE_USE_ENV_PROXY=1` so the CLI (Node.js) sends its requests through the proxy in `HTTPS_PROXY`.
- **Pass `--site <project name>`**: the project's name, not its id. **Pass `--no-build`** to `deploy`: the CLI otherwise runs the build itself first, and `public/` is already built.
- **On the free Netlify plan**, environment variables can't be scoped or marked secret, so set `ADMIN_CODE` without `--scope` or `--secret`.

`netlify.toml` sets the publish and functions folders and the security headers for static files (a strict CSP on the app page; none on `/statement/*`, which needs its inline code and UserWay). The API runs as one Netlify Function at `/api/*`, sets its own headers (`no-store`, `nosniff`, same-origin referrer, `noindex`) and stores answers in Netlify Blobs. After changing `ADMIN_CODE`, redeploy so the function picks it up.

### Accessibility and brand notes
The InfoSlips palette and type are in `src/css/00-tokens.css`, with light and dark tokens. The few documented exceptions (the light-mode priority chart colours, Slate 4 control borders in dark mode, Dark Green/Acorn selected indicators, no true error colour) are recorded in SPEC section 4 with their contrast ratios.
