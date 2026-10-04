/*
 * 01-shell — the app shell in a real browser: headers and CSP, boot, routing
 * with Back and Forward, placeholders, theme, phone Menu, the name dialog, the
 * start view, the answer save queue, core helpers and accessibility.
 * Owner: foundation.
 */
import {
  assertNoErrors,
  axe,
  focused,
  formatViolations,
  gotoApp,
  openPage,
  reviewerStorage,
  seedBrowserReviewer,
  shot,
  sleep,
  waitForView
} from './helpers.mjs';

export const meta = { timeout: 300000 };

const TITLE_SUFFIX = ' · YES statement review · InfoSlips';
const BRAND_FULL =
  'YES branding is not final. The colours, logo and typography in the YES statement are placeholders. They will be updated once YES supplies its final brand assets. Please judge the features, not the look.';

export default async function (ctx) {
  const { base, api, assert, step, features } = ctx;
  const N = features.length;
  const first = features[0].id;

  async function until(fn, ms = 6000, label = 'condition') {
    const t0 = Date.now();
    for (;;) {
      const v = await fn();
      if (v) return v;
      if (Date.now() - t0 > ms) throw new Error('timed out waiting for ' + label);
      await sleep(100);
    }
  }

  /* ------------------------------------------------------------------ */
  await step('headers: CSP and security headers on / and /index.html; none on /statement/', async () => {
    const dev = await import(new URL('../server/dev.mjs', import.meta.url).href);
    for (const path of ['/', '/index.html']) {
      const r = await fetch(base + path);
      assert.equal(r.status, 200, path);
      assert.equal(r.headers.get('content-security-policy'), dev.CSP, path + ' CSP');
      assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(r.headers.get('referrer-policy'), 'same-origin');
      assert.equal(r.headers.get('x-frame-options'), 'SAMEORIGIN');
      assert.equal(r.headers.get('x-robots-tag'), 'noindex, nofollow');
      assert.match(r.headers.get('content-type'), /^text\/html/);
    }
    const csp = (await fetch(base + '/')).headers.get('content-security-policy');
    for (const d of ["default-src 'self'", "script-src 'self'", "style-src 'self'", "frame-ancestors 'self'", "base-uri 'none'", "form-action 'self'"]) assert.ok(csp.includes(d), d);
    const st = await fetch(base + '/statement/index.html');
    assert.equal(st.status, 200);
    assert.equal(st.headers.get('content-security-policy'), null, 'no CSP on the statement');
    assert.equal(st.headers.get('x-frame-options'), 'SAMEORIGIN');
    const html = await (await fetch(base + '/')).text();
    const js = html.match(/src="(app\.[0-9a-f]+\.js)"/)[1];
    const css = html.match(/href="(app\.[0-9a-f]+\.css)"/)[1];
    const boot = html.match(/src="(assets\/theme-boot\.[0-9a-f]+\.js)"/)[1];
    for (const f of [js, css, boot]) {
      const r = await fetch(base + '/' + f);
      assert.equal(r.status, 200, f);
      assert.match(r.headers.get('cache-control'), /immutable/, f);
    }
    assert.equal((await fetch(base + '/robots.txt')).status, 200);
    assert.equal((await fetch(base + '/nope.html')).status, 404);
    assert.equal((await fetch(base + '/../package.json')).status, 404);
  });

  /* ------------------------------------------------------------------ */
  await step('boot: #/start, landmarks, title, brand notice, footer; no errors, CSP violations or external requests', async () => {
    const P = await openPage(ctx);
    try {
      await gotoApp(P.page, base, '');
      assert.equal(await P.page.evaluate(() => location.hash), '#/start');
      assert.equal(await P.page.title(), 'Start' + TITLE_SUFFIX);
      assert.equal(await P.page.locator('header.wt-mast').count(), 1);
      assert.equal(await P.page.locator('nav[aria-label="Main"]').count(), 1);
      assert.equal(await P.page.locator('main#main').count(), 1);
      assert.equal(await P.page.locator('footer.wt-foot').count(), 1);
      assert.equal(await P.page.locator('html').getAttribute('lang'), 'en-GB');
      assert.ok(await P.page.locator('.wt-mast .wt-logo--light').isVisible(), 'light logo visible');
      assert.ok(!(await P.page.locator('.wt-mast .wt-logo--dark').isVisible()), 'dark logo hidden');
      assert.equal(await P.page.locator('.wt-mast .wt-logo--light').getAttribute('alt'), 'InfoSlips');
      const box = await P.page.locator('.wt-mast .wt-logo--light').boundingBox();
      assert.equal(Math.round(box.height), 32);
      assert.ok(box.width >= 120, 'logo at least the 120px brand minimum');
      assert.equal(await P.page.locator('.wt-mast__app').innerText(), 'YES statement review');
      const notice = P.page.locator('#view-start [data-brand-notice="full"]');
      assert.equal(await notice.count(), 1, 'full branding notice on the start page');
      assert.equal((await notice.innerText()).replace(/\s+/g, ' ').trim(), BRAND_FULL);
      assert.equal(
        (await P.page.locator('.wt-foot__text').innerText()).trim(),
        'Prepared by InfoSlips to showcase a possible new YES statement. All statement data is fictional.'
      );
      assert.equal(await P.page.locator('.wt-foot a[href="#/admin"]').count(), 1);
      assert.equal(await P.page.locator('#view-start h1').innerText(), 'Help shape the new YES statement');
      assert.ok(await P.page.evaluate(() => window.WT.ready === true));
      // Every view section exists; only start is shown.
      for (const v of ['start', 'tour', 'results', 'data', 'admin']) {
        assert.equal(await P.page.locator('#view-' + v).count(), 1);
        assert.equal(await P.page.locator('#view-' + v).isVisible(), v === 'start', v);
      }
      // The brand notice markup from WT.brandNotice
      const compact = await P.page.evaluate(() => {
        const d = document.createElement('div');
        d.innerHTML = window.WT.brandNotice({ compact: true });
        return d.textContent.trim();
      });
      assert.equal(compact, 'YES branding is a placeholder and will be updated.');
      assertNoErrors(P.errors, assert, P.external);
    } finally {
      await P.close();
    }
  });

  /* ------------------------------------------------------------------ */
  await step('router: nav, aria-current, titles, h1 focus, Back and Forward, unknown routes, skip link', async () => {
    const P = await openPage(ctx);
    const { page } = P;
    try {
      await gotoApp(page, base, '#/start');
      await page.click('.wt-nav__link[data-nav="results"]');
      await waitForView(page, 'results');
      assert.match(await page.title(), /^Results\b.* · YES statement review · InfoSlips$/);
      assert.equal(await page.locator('.wt-nav__link[aria-current="page"]').count(), 1);
      assert.equal(await page.locator('.wt-nav__link[data-nav="results"]').getAttribute('aria-current'), 'page');
      await until(async () => (await focused(page)).tag === 'h1', 4000, 'results h1 focus');
      assert.ok(await page.evaluate(() => document.getElementById('view-results').contains(document.activeElement)));
      assert.ok(!(await page.locator('#view-start').isVisible()));
      assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-view')), 'results');

      await page.click('.wt-nav__link[data-nav="data"]');
      await waitForView(page, 'data');
      assert.match(await page.title(), /^Data requirements\b/);
      assert.equal(await page.locator('.wt-nav__link[data-nav="data"]').getAttribute('aria-current'), 'page');

      await page.goBack();
      await waitForView(page, 'results');
      await page.goBack();
      await waitForView(page, 'start');
      assert.equal(await page.locator('.wt-nav__link[aria-current]').count(), 0, 'no nav item is current on start');
      await page.goForward();
      await waitForView(page, 'results');
      await page.goForward();
      await waitForView(page, 'data');

      // WT.go pushes history synchronously.
      const len = await page.evaluate(() => history.length);
      await page.evaluate(() => window.WT.go('/admin'));
      await waitForView(page, 'admin');
      assert.equal(await page.evaluate(() => location.hash), '#/admin');
      assert.equal(await page.evaluate(() => history.length), len + 1);
      await page.evaluate(() => window.WT.go('#/start', { replace: true }));
      await waitForView(page, 'start');
      assert.equal(await page.evaluate(() => history.length), len + 1, 'replace does not add an entry');
      const r = await page.evaluate(() => window.WT.parseRoute('#/tour/' + 'abc'));
      assert.deepEqual(r, { view: 'tour', param: 'abc', path: '/tour/abc' });

      // Unknown routes fall back to start.
      await page.evaluate(() => (location.hash = '#/nope/x'));
      await waitForView(page, 'start');
      assert.equal(await page.evaluate(() => location.hash), '#/start');

      // A plain in-page anchor is not a route.
      await page.evaluate(() => window.WT.go('/results'));
      await waitForView(page, 'results');
      await page.evaluate(() => (location.hash = '#main'));
      await sleep(150);
      assert.equal(await page.evaluate(() => window.WT.route().view), 'results');

      // Skip link: first Tab stop on a fresh load, moves focus to the view heading without changing the URL.
      await page.evaluate(() => window.WT.go('/start'));
      await page.reload();
      await page.waitForFunction(() => document.documentElement.getAttribute('data-wt-ready') === '1');
      await page.keyboard.press('Tab');
      const f = await focused(page);
      assert.equal(f.text, 'Skip to main content');
      assert.ok(await page.locator('.wt-skip').isVisible(), 'skip link visible on focus');
      await page.keyboard.press('Enter');
      const after = await focused(page);
      assert.equal(after.tag, 'h1');
      assert.equal(await page.evaluate(() => location.hash), '#/start');
      assertNoErrors(P.errors, assert, P.external);
    } finally {
      await P.close();
    }
  });

  /* ------------------------------------------------------------------ */
  await step('views without a loaded module show a polite placeholder', async () => {
    const P = await openPage(ctx);
    const { page } = P;
    try {
      // Serve a bundle with only the foundation modules in it.
      await page.route(/\/app\.[0-9a-f]+\.js$/, async (route) => {
        const res = await route.fetch();
        const code = await res.text();
        const parts = code.split(/\n(?=\/\* ---- \d\d-[\w-]+\.js ---- \*\/)/);
        const keep = parts.filter((p) => !/^\/\* ---- (\d\d)-/.test(p) || /^\/\* ---- (00|05|10|99)-/.test(p));
        await route.fulfill({ response: res, body: keep.join('\n') });
      });
      await gotoApp(page, base, '#/start');
      const views = { tour: 'Walkthrough', results: 'Results', data: 'Data requirements', admin: 'Admin' };
      for (const [view, title] of Object.entries(views)) {
        await page.evaluate((v) => window.WT.go('/' + v), view);
        await waitForView(page, view);
        const sec = page.locator('#view-' + view);
        assert.equal(await sec.locator('h1').innerText(), title);
        assert.match(await sec.innerText(), /still putting this page together/);
        assert.equal(await sec.locator('a[href="#/start"]').count(), 1);
        assert.equal(await page.title(), title + TITLE_SUFFIX);
      }
      assertNoErrors(P.errors, assert, P.external);
    } finally {
      await P.close();
    }
  });

  /* ------------------------------------------------------------------ */
  await step('theme: toggle, aria-pressed, persistence across reloads (applied before first paint), device preference', async () => {
    const P = await openPage(ctx);
    const { page } = P;
    try {
      await gotoApp(page, base, '#/start');
      const toggle = page.locator('#wt-theme-toggle');
      assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
      assert.equal(await toggle.getAttribute('aria-pressed'), 'false');
      assert.equal((await toggle.innerText()).trim(), 'Dark mode', 'accessible name');
      await toggle.click();
      assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
      assert.equal(await toggle.getAttribute('aria-pressed'), 'true');
      assert.equal(await page.evaluate(() => localStorage.getItem('infoslips.wt.theme')), 'dark');
      assert.ok(await page.locator('.wt-mast .wt-logo--dark').isVisible(), 'white logo in dark');
      assert.ok(!(await page.locator('.wt-mast .wt-logo--light').isVisible()));
      assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(15, 23, 42)');

      await page.reload({ waitUntil: 'domcontentloaded' });
      assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark', 'set by the head script');
      await page.waitForFunction(() => document.documentElement.getAttribute('data-wt-ready') === '1');
      assert.equal(await toggle.getAttribute('aria-pressed'), 'true');
      assert.equal(await page.evaluate(() => window.WT.theme.get()), 'dark');

      await toggle.click();
      assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
      assert.equal(await page.evaluate(() => localStorage.getItem('infoslips.wt.theme')), 'light');
      const events = await page.evaluate(() => {
        const seen = [];
        window.WT.on('theme', (t) => seen.push(t));
        window.WT.theme.toggle();
        window.WT.theme.set(null);
        return seen;
      });
      assert.deepEqual(events, ['dark', 'light']);
      assert.equal(await page.evaluate(() => localStorage.getItem('infoslips.wt.theme')), null, 'set(null) follows the device');
      assertNoErrors(P.errors, assert, P.external);
    } finally {
      await P.close();
    }
    const D = await openPage(ctx, { colorScheme: 'dark' });
    try {
      await gotoApp(D.page, base, '#/start');
      assert.equal(await D.page.locator('html').getAttribute('data-theme'), 'dark', 'follows the device');
      assert.equal(await D.page.locator('#wt-theme-toggle').getAttribute('aria-pressed'), 'true');
      assert.equal(await D.page.evaluate(() => window.WT.theme.get()), null);
      await D.page.emulateMedia({ colorScheme: 'light' });
      await until(async () => (await D.page.locator('html').getAttribute('data-theme')) === 'light', 3000, 'live device change');
      assertNoErrors(D.errors, assert, D.external);
    } finally {
      await D.close();
    }
  });

  /* ------------------------------------------------------------------ */
  await step('phone Menu: hidden nav, opens, Escape closes and returns focus, links and outside clicks close it', async () => {
    const P = await openPage(ctx, { viewport: 'phone' });
    const { page } = P;
    try {
      await gotoApp(page, base, '#/start');
      const btn = page.locator('#wt-menu-btn');
      assert.ok(await btn.isVisible());
      assert.equal(await btn.getAttribute('aria-expanded'), 'false');
      assert.equal(await btn.getAttribute('aria-controls'), 'wt-menu');
      assert.ok(!(await page.locator('.wt-nav__link[data-nav="results"]').isVisible()));
      assert.ok(!(await page.locator('#wt-reviewer-chip').isVisible()));
      assert.ok(!(await page.locator('#wt-theme-toggle').isVisible()));

      await btn.click();
      assert.equal(await btn.getAttribute('aria-expanded'), 'true');
      for (const sel of ['.wt-nav__link[data-nav="tour"]', '.wt-nav__link[data-nav="results"]', '.wt-nav__link[data-nav="data"]', '#wt-reviewer-chip', '#wt-theme-toggle']) {
        assert.ok(await page.locator(sel).isVisible(), sel + ' visible in the Menu');
      }
      assert.ok(await page.locator('.wt-theme-toggle__label').isVisible(), '"Dark mode" label shown in the Menu');
      await shot(page, 'shell-phone-menu-open');

      await page.keyboard.press('Escape');
      assert.equal(await btn.getAttribute('aria-expanded'), 'false');
      assert.equal((await focused(page)).id, 'wt-menu-btn', 'focus returns to Menu');
      assert.ok(!(await page.locator('.wt-nav__link[data-nav="results"]').isVisible()));

      await btn.click();
      await page.click('.wt-nav__link[data-nav="results"]');
      await waitForView(page, 'results');
      assert.equal(await btn.getAttribute('aria-expanded'), 'false', 'closes after navigating');

      await btn.click();
      assert.equal(await btn.getAttribute('aria-expanded'), 'true');
      await page.mouse.click(200, 700);
      assert.equal(await btn.getAttribute('aria-expanded'), 'false', 'closes on an outside click');

      // The theme toggle works from the Menu.
      await btn.click();
      await page.click('#wt-theme-toggle');
      assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
      assertNoErrors(P.errors, assert, P.external);
    } finally {
      await P.close();
    }
    const W = await openPage(ctx, { viewport: 'desktop' });
    try {
      await gotoApp(W.page, base, '#/start');
      assert.ok(!(await W.page.locator('#wt-menu-btn').isVisible()), 'no Menu button on desktop');
      assert.ok(await W.page.locator('.wt-nav__link[data-nav="results"]').isVisible());
    } finally {
      await W.close();
    }
  });

  /* ------------------------------------------------------------------ */
  await step('name dialog: save, Escape, Cancel, 60-character limit, focus return, saved to the server', async () => {
    const P = await openPage(ctx);
    const { page } = P;
    try {
      await gotoApp(page, base, '#/start');
      const chip = page.locator('#wt-reviewer-chip');
      assert.equal((await chip.innerText()).trim(), 'Add your name');
      assert.equal(await chip.getAttribute('aria-haspopup'), 'dialog');
      await chip.click();
      const dlg = page.locator('#wt-name-dialog');
      assert.ok(await dlg.evaluate((d) => d.open && d.matches(':modal')));
      assert.equal(await dlg.getAttribute('aria-labelledby'), 'wt-name-dialog-title');
      assert.equal(await page.locator('#wt-name-dialog-title').innerText(), 'Your name');
      assert.match(await dlg.innerText(), /everyone with the link can see/);
      assert.match(await dlg.innerText(), /Anonymous reviewer/);
      assert.equal((await focused(page)).id, 'wt-name-input');
      await page.keyboard.type('Sam Ortega');
      assert.equal((await page.locator('#wt-name-input-count').innerText()).trim(), '10 / 60');
      await page.keyboard.press('Enter');
      assert.ok(!(await dlg.evaluate((d) => d.open)), 'closed on save');
      assert.equal((await focused(page)).id, 'wt-reviewer-chip', 'focus back on the chip');
      assert.match((await chip.innerText()).trim(), /Sam Ortega$/);
      const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('infoslips.wt.reviewer')));
      assert.equal(stored.name, 'Sam Ortega');
      assert.match(stored.secret, /^[0-9a-f]{64}$/);
      // A name on its own stays in this browser: the server stores it with the first answer.
      await sleep(900);
      assert.equal((await api('/api/me', { secret: stored.secret })).json.createdAt, undefined, 'a name alone creates no record');
      assert.equal(await page.evaluate(() => window.WT.answers.pending()), 0, 'nothing queued for a name alone');

      // Escape discards an edit.
      await chip.click();
      assert.equal(await page.locator('#wt-name-input').inputValue(), 'Sam Ortega');
      await page.keyboard.type(' Jr');
      await page.keyboard.press('Escape');
      assert.ok(!(await dlg.evaluate((d) => d.open)));
      assert.match((await chip.innerText()).trim(), /Sam Ortega$/);
      assert.equal((await focused(page)).id, 'wt-reviewer-chip');

      // Cancel button, and the 60-character limit.
      await chip.click();
      await page.fill('#wt-name-input', 'x'.repeat(75));
      assert.equal((await page.locator('#wt-name-input').inputValue()).length, 60);
      await page.locator('#wt-name-input').dispatchEvent('input');
      assert.equal((await page.locator('#wt-name-input-count').innerText()).trim(), '60 / 60');
      await shot(page, 'shell-name-dialog');
      await page.click('#wt-name-dialog .wt-dialog__foot [data-wt-close]');
      assert.ok(!(await dlg.evaluate((d) => d.open)));

      // Start as a new reviewer (confirmed). The old answers stay on the server.
      await page.evaluate((id) => window.WT.answers.set(id, { vote: 'include' }), first);
      await page.evaluate(() => window.WT.answers.flush());
      assert.equal((await api('/api/me', { secret: stored.secret })).json.name, 'Sam Ortega', 'the name went with the first answer');
      await chip.click();
      await page.click('[data-wt-new-reviewer]');
      const confirm = page.locator('#wt-confirm');
      assert.ok(await confirm.evaluate((d) => d.open));
      assert.equal(await page.locator('#wt-confirm-title').innerText(), 'Start as a new reviewer?');
      assert.equal((await focused(page)).text, 'Cancel', 'safe default focus');
      await page.click('#wt-confirm [data-wt-confirm]');
      await until(async () => !(await dlg.evaluate((d) => d.open)), 4000, 'name dialog closed');
      assert.equal((await chip.innerText()).trim(), 'Add your name');
      const fresh = await page.evaluate(() => JSON.parse(localStorage.getItem('infoslips.wt.reviewer')));
      assert.notEqual(fresh.secret, stored.secret);
      assert.equal(fresh.name, '');
      assert.deepEqual(fresh.answers, {});
      const old = await api('/api/me', { secret: stored.secret });
      assert.equal(old.json.name, 'Sam Ortega');
      assert.equal(old.json.answers[first].vote, 'include');
      assertNoErrors(P.errors, assert, P.external);
    } finally {
      await P.close();
    }
  });

  await step('name dialog: "Remove my answers" deletes the record after confirmation', async () => {
    const P = await openPage(ctx);
    const { page } = P;
    try {
      await gotoApp(page, base, '#/start');
      await page.evaluate((id) => {
        window.WT.reviewer.setName('Temp');
        window.WT.answers.set(id, { vote: 'exclude' });
        return window.WT.answers.flush();
      }, first);
      const secret = await page.evaluate(() => window.WT.reviewer.get().secret);
      assert.equal((await api('/api/me', { secret })).json.name, 'Temp');
      await page.click('#wt-reviewer-chip');
      await page.click('[data-wt-remove-answers]');
      // Cancel first: nothing happens.
      await page.keyboard.press('Escape');
      assert.equal((await api('/api/me', { secret })).json.name, 'Temp');
      await page.click('[data-wt-remove-answers]');
      await page.click('#wt-confirm [data-wt-confirm]');
      await until(async () => (await api('/api/me', { secret })).json.name === '', 4000, 'record removed');
      assert.deepEqual((await api('/api/me', { secret })).json.answers, {});
      assertNoErrors(P.errors, assert, P.external);
    } finally {
      await P.close();
    }
  });

  /* ------------------------------------------------------------------ */
  await step('start view: first visit, continue state, start from the beginning', async () => {
    const P = await openPage(ctx);
    try {
      await gotoApp(P.page, base, '#/start');
      const primary = P.page.locator('[data-start="begin"]');
      assert.equal((await primary.innerText()).trim(), 'Start the walkthrough');
      assert.equal(await primary.getAttribute('href'), '#/tour/' + first);
      assert.equal(await P.page.locator('[data-start="restart"]').count(), 0);
      assert.equal(await P.page.locator('#view-start progress').count(), 0);
      const text = await P.page.locator('#view-start').innerText();
      assert.match(text, /How it works/);
      assert.match(text, new RegExp(`about 15 minutes, ${N} features`, 'i'));
      assert.match(text, /vote to include or exclude it, set a priority and comment/);
      assert.match(text, /Your answers are saved to a shared database as you go and are visible to everyone with this link\. They’re linked to this browser, not to an account\./);
      assert.equal(await P.page.locator('#view-start a[href="#/results"]').count(), 1);
      assert.equal(await P.page.locator('#view-start a[href="#/data"]').count(), 1);
      assert.equal(await P.page.locator('#view-start .wt-start__feature').count(), N, 'every feature listed');
    } finally {
      await P.close();
    }

    const k = Math.min(5, N);
    const answers = { [features[0].id]: { vote: 'include', priority: 'high' }, [features[1].id]: { vote: 'exclude' } };
    const S = await openPage(ctx, { storage: await seedBrowserReviewer(api, { name: 'Robin', answers, lastStep: features[k - 1].id }) });
    try {
      await gotoApp(S.page, base, '#/start');
      const cont = S.page.locator('[data-start="continue"]');
      assert.equal((await cont.innerText()).trim(), `Continue where you left off: ${features[k - 1].title} (step ${k} of ${N})`);
      assert.equal(await cont.getAttribute('href'), '#/tour/' + features[k - 1].id);
      const restart = S.page.locator('[data-start="restart"]');
      assert.equal((await restart.innerText()).trim(), 'Start from the beginning');
      assert.equal(await restart.getAttribute('href'), '#/tour/' + first);
      assert.equal((await S.page.locator('#start-progress-label').innerText()).trim(), `You’ve answered 2 of ${N} features`);
      assert.equal(await S.page.locator('#start-progress').getAttribute('value'), '2');
      assert.equal(await S.page.locator('#start-progress').getAttribute('max'), String(N));
      const rows = S.page.locator('.wt-start__feature');
      assert.match(await rows.nth(0).innerText(), /Include/);
      assert.match(await rows.nth(1).innerText(), /Exclude/);
      assert.equal(await S.page.locator('#start-name').inputValue(), 'Robin');
      assert.match((await S.page.locator('#wt-reviewer-chip').innerText()).trim(), /Robin$/);
      await shot(S.page, 'start-continue-desktop-light');
      assertNoErrors(S.errors, assert, S.external);
    } finally {
      await S.close();
    }

    // Answers but no lastStep: continue at the first unanswered feature.
    const U = await openPage(ctx, { storage: await seedBrowserReviewer(api, { answers: { [features[0].id]: { vote: 'include' } } }) });
    try {
      await gotoApp(U.page, base, '#/start');
      assert.equal(await U.page.locator('[data-start="continue"]').getAttribute('href'), '#/tour/' + features[1].id);
      assert.equal((await U.page.locator('[data-start="continue"]').innerText()).trim(), `Continue with ${features[1].title} (step 2 of ${N})`);
      // The tour opened without an id (the masthead's Walkthrough link) resumes at the same step.
      await U.page.click('#wt-mast a[data-nav="tour"]');
      await U.page.waitForFunction((id) => window.WT.route().path === '/tour/' + id && window.WT.tour.current() === id, features[1].id);
    } finally {
      await U.close();
    }

    // Every feature answered: the results lead, and "continue" stays as a link.
    const all = Object.fromEntries(features.map((f) => [f.id, { vote: 'include' }]));
    const C = await openPage(ctx, { storage: await seedBrowserReviewer(api, { answers: all, lastStep: features[N - 1].id }) });
    try {
      await gotoApp(C.page, base, '#/start');
      const lead = C.page.locator('[data-fk="start-primary"]');
      assert.equal(await lead.getAttribute('data-start'), 'results');
      assert.equal(await lead.getAttribute('href'), '#/results');
      assert.equal((await lead.innerText()).trim(), 'You’ve answered every feature: see the results');
      assert.equal((await C.page.locator('[data-start="continue"]').innerText()).trim(), `Continue where you left off: ${features[N - 1].title} (step ${N} of ${N})`);
      assertNoErrors(C.errors, assert, C.external);
    } finally {
      await C.close();
    }
  });

  await step('start view: the name field saves on change', async () => {
    const P = await openPage(ctx);
    const { page } = P;
    try {
      await gotoApp(page, base, '#/start');
      await page.fill('#start-name', '  Jo  Bloggs ');
      await page.keyboard.press('Tab');
      await until(async () => /Jo Bloggs$/.test((await page.locator('#wt-reviewer-chip').innerText()).trim()), 3000, 'chip updated');
      assert.equal(await page.locator('#start-name').inputValue(), 'Jo Bloggs', 'cleaned value shown');
      const secret = await page.evaluate(() => window.WT.reviewer.get().secret);
      // Kept in this browser; the server stores it with the first answer.
      await page.evaluate((id) => window.WT.answers.set(id, { vote: 'include' }), first);
      await until(async () => (await api('/api/me', { secret })).json.name === 'Jo Bloggs', 6000, 'saved to server with the first answer');
      assertNoErrors(P.errors, assert, P.external);
    } finally {
      await P.close();
    }
  });

  /* ------------------------------------------------------------------ */
  await step('answers: saved after a short delay; queued offline and sent on "online" and on the next load', async () => {
    const P = await openPage(ctx);
    const { page, context } = P;
    const [a, b, c] = features.map((f) => f.id);
    try {
      await gotoApp(page, base, '#/start');
      await page.evaluate(() => {
        window.__saved = [];
        window.WT.on('saved', (s) => window.__saved.push(s));
      });
      const ans = await page.evaluate((id) => window.WT.answers.set(id, { vote: 'include', priority: 'high', comment: 'Yes' }), a);
      assert.equal(ans.vote, 'include');
      assert.ok(Date.parse(ans.updatedAt));
      const secret = await page.evaluate(() => window.WT.reviewer.get().secret);
      assert.equal((await api('/api/me', { secret })).json.answers[a], undefined, 'not sent before the debounce');
      await until(async () => (await api('/api/me', { secret })).json.answers[a], 4000, 'debounced save');
      await until(() => page.evaluate(() => window.__saved.some((s) => s.ok === true && s.pending === 0)), 3000, 'saved event');
      const stats = await page.evaluate(() => window.WT.answers.stats());
      assert.equal(stats.answered, 1);
      assert.equal(stats.include, 1);
      assert.equal(stats.total, features.length);

      // Patches merge; clearing removes.
      await page.evaluate((id) => window.WT.answers.set(id, { comment: 'Changed' }), a);
      assert.deepEqual(await page.evaluate((id) => { const x = window.WT.answers.get(id); return [x.vote, x.priority, x.comment]; }, a), ['include', 'high', 'Changed']);

      // Offline: stays queued in localStorage.
      await context.setOffline(true);
      await page.evaluate((id) => window.WT.answers.set(id, { vote: 'exclude' }), b);
      await until(() => page.evaluate(() => window.__saved.some((s) => s.ok === false)), 4000, 'failed save reported');
      const pending = await page.evaluate(() => JSON.parse(localStorage.getItem('infoslips.wt.pending')));
      assert.equal(pending.answers[b].vote, 'exclude');
      assert.ok(await page.evaluate(() => window.WT.answers.pending() >= 1));
      await context.setOffline(false);
      await until(async () => ((await api('/api/me', { secret })).json.answers[b] || {}).vote === 'exclude', 6000, 'sent when back online');
      await until(() => page.evaluate(() => localStorage.getItem('infoslips.wt.pending') === null), 3000, 'queue emptied');
      assert.equal((await api('/api/me', { secret })).json.answers[a].comment, 'Changed');

      // Offline again, leave the page, come back online: sent on load.
      await context.setOffline(true);
      await page.evaluate((id) => window.WT.answers.set(id, { priority: 'low' }), c);
      await sleep(900);
      await page.goto('about:blank');
      await context.setOffline(false);
      assert.equal((await api('/api/me', { secret })).json.answers[c], undefined);
      await gotoApp(page, base, '#/start');
      await until(async () => ((await api('/api/me', { secret })).json.answers[c] || {}).priority === 'low', 6000, 'sent on load');

      // Clearing an answer reaches the server.
      await page.evaluate((id) => window.WT.answers.clear(id), a);
      await page.evaluate(() => window.WT.answers.flush());
      await until(async () => !(await api('/api/me', { secret })).json.answers[a], 4000, 'cleared on server');
      assertNoErrors(P.errors, assert, P.external);
    } finally {
      await P.close();
    }
  });

  await step('answers: answers only in this browser (not queued, not on the server) are dropped on load', async () => {
    const P = await openPage(ctx, { storage: reviewerStorage({ answers: { [first]: { vote: 'include' } } }) });
    try {
      await gotoApp(P.page, base, '#/start');
      await until(() => P.page.evaluate((id) => window.WT.answers.get(id) === null, first), 4000, 'local-only answer dropped');
    } finally {
      await P.close();
    }
  });

  await step('answers: on load the server wins for answers that are not queued', async () => {
    const answers = { [features[0].id]: { vote: 'include' }, [features[2].id]: { vote: 'exclude' } };
    const seed = reviewerStorage({ answers });
    const secret = seed['infoslips.wt.reviewer'].secret;
    // The server has a newer view: feature 0 changed, feature 2 was cleared (e.g. by an admin).
    await api('/api/me', { method: 'PUT', secret, body: { name: 'Server name', answers: { [features[0].id]: { vote: 'exclude', priority: 'medium' } } } });
    const P = await openPage(ctx, { storage: seed });
    try {
      await gotoApp(P.page, base, '#/start');
      await until(() => P.page.evaluate((id) => (window.WT.answers.get(id) || {}).vote === 'exclude', features[0].id), 4000, 'server answer adopted');
      assert.equal(await P.page.evaluate((id) => window.WT.answers.get(id), features[2].id), null);
      assert.equal(await P.page.evaluate(() => window.WT.reviewer.name()), 'Server name');
    } finally {
      await P.close();
    }
  });

  /* ------------------------------------------------------------------ */
  await step('core helpers: esc, h, render focus restore, fmt, icons, confirm dialog', async () => {
    const P = await openPage(ctx, { timezoneId: 'UTC' });
    const { page } = P;
    try {
      await gotoApp(page, base, '#/start');
      const res = await page.evaluate(() => {
        const WT = window.WT;
        const out = {};
        out.esc = WT.esc(`<a href="x" onclick='y'>&\``);
        out.h = String(WT.h`<p>${'<b>'}${['<i>', WT.raw('<em>ok</em>')]}${null}${false}${0}</p>`);
        const host = document.createElement('div');
        document.body.appendChild(host);
        WT.render(host, '<input data-fk="a" value="hello world"><button data-fk="b">b</button>');
        const input = host.querySelector('input');
        input.focus();
        input.setSelectionRange(2, 5);
        WT.render(host, '<button data-fk="b">b</button><input data-fk="a" value="hello world">');
        out.focusKept = document.activeElement.getAttribute('data-fk');
        out.selection = [document.activeElement.selectionStart, document.activeElement.selectionEnd];
        host.remove();
        out.date = WT.fmt.date('2026-10-04T18:40:00Z');
        out.day = WT.fmt.day('2026-10-04T18:40:00Z');
        out.pct = [WT.fmt.pct(2, 3), WT.fmt.pct(0.5), WT.fmt.pct(1, 0), WT.fmt.pct(null)];
        out.rel = [WT.fmt.relative(new Date().toISOString()), WT.fmt.relative(new Date(Date.now() - 5 * 60000).toISOString())];
        out.plural = [WT.fmt.plural(1, 'reviewer'), WT.fmt.plural(1234, 'reviewer')];
        const need = ['arrow-left', 'arrow-right', 'restart', 'check', 'x', 'minus', 'list', 'sun', 'moon', 'user', 'chart', 'braces', 'download', 'copy', 'search', 'chevron-down', 'chevron-right', 'external', 'info', 'eye', 'eye-off', 'trash', 'refresh', 'lock'];
        out.missingIcons = need.filter((n) => !/^<svg [^>]*aria-hidden="true"/.test(WT.icon(n)));
        out.labelled = WT.icon('info', { label: 'Info' });
        out.feature = WT.feature(WT.features[0].id).title === WT.features[0].title && WT.feature('nope') === null;
        out.storageSafe = WT.storage.get('missing-key', 'fallback');
        return out;
      });
      assert.equal(res.esc, '&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&#96;');
      assert.equal(res.h, '<p>&lt;b&gt;&lt;i&gt;<em>ok</em>0</p>');
      assert.equal(res.focusKept, 'a');
      assert.deepEqual(res.selection, [2, 5]);
      assert.equal(res.date, '4 Oct 2026, 18:40');
      assert.match(res.day, /^4 Oct 2026$/);
      assert.deepEqual(res.pct, ['67%', '50%', '–', '–']);
      assert.deepEqual(res.rel, ['just now', '5 minutes ago']);
      assert.deepEqual(res.plural, ['1 reviewer', '1,234 reviewers']);
      assert.deepEqual(res.missingIcons, []);
      assert.match(res.labelled, /role="img" aria-label="Info"/);
      assert.ok(res.feature);
      assert.equal(res.storageSafe, 'fallback');

      // WT.dialog.confirm with type-to-confirm.
      await page.evaluate(() => {
        const b = document.createElement('button');
        b.id = 'trigger';
        b.textContent = 'Reset';
        document.querySelector('#view-start').appendChild(b);
        b.focus();
        window.__answer = window.WT.dialog.confirm({ title: 'Reset all results?', body: 'This deletes everything.', confirmLabel: 'Reset', danger: true, typeToConfirm: 'RESET', trigger: b });
      });
      const ok = page.locator('#wt-confirm [data-wt-confirm]');
      assert.ok(await ok.isDisabled(), 'disabled until RESET is typed');
      assert.equal((await focused(page)).id, 'wt-confirm-type');
      await page.keyboard.type('RESE');
      assert.ok(await ok.isDisabled());
      await page.keyboard.type('T');
      assert.ok(!(await ok.isDisabled()));
      await ok.click();
      assert.equal(await page.evaluate(() => window.__answer), true);
      assert.equal((await focused(page)).id, 'trigger', 'focus returns to the trigger');
      await page.evaluate(() => {
        window.__answer = window.WT.dialog.confirm({ title: 'Sure?', body: 'Really.' });
      });
      await page.keyboard.press('Escape');
      assert.equal(await page.evaluate(() => window.__answer), false, 'Escape cancels');
      assertNoErrors(P.errors, assert, P.external);
    } finally {
      await P.close();
    }
  });

  await step('without JavaScript: a clear message, no dead controls, dark device setting still applies', async () => {
    const P = await openPage(ctx, { javaScriptEnabled: false, colorScheme: 'dark' });
    try {
      await P.page.goto(base + '/');
      assert.match(await P.page.locator('main').innerText(), /This review needs JavaScript/);
      assert.equal(await P.page.locator('main a[href="statement/index.html"]').count(), 1);
      assert.ok(!(await P.page.locator('#wt-menu').isVisible()), 'nav and tools hidden');
      assert.ok(!(await P.page.locator('#wt-menu-btn').isVisible()));
      assert.equal(await P.page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(15, 23, 42)');
    } finally {
      await P.close();
    }
  });

  /* ------------------------------------------------------------------ */
  await step('layout: no horizontal scroll at 320px, 390px and 1920px', async () => {
    for (const vp of ['narrow', 'phone', 'wide']) {
      const P = await openPage(ctx, { viewport: vp });
      try {
        await gotoApp(P.page, base, '#/start');
        const [sw, cw] = await P.page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
        assert.ok(sw <= cw, `${vp}: scrollWidth ${sw} > ${cw}`);
        if (vp === 'narrow') {
          await P.page.click('#wt-menu-btn');
          const [sw2, cw2] = await P.page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
          assert.ok(sw2 <= cw2, 'menu open at 320px');
        }
      } finally {
        await P.close();
      }
    }
  });

  await step('accessibility: axe finds no violations on the start view, Menu and dialogs, light and dark', async () => {
    const problems = [];
    for (const vp of ['desktop', 'phone']) {
      for (const scheme of ['light', 'dark']) {
        const P = await openPage(ctx, { viewport: vp, colorScheme: scheme, storage: await seedBrowserReviewer(api, { name: 'Robin', answers: { [first]: { vote: 'include' } }, lastStep: first }) });
        const { page } = P;
        try {
          await gotoApp(page, base, '#/start');
          await sleep(300);
          const label = `${vp}/${scheme}`;
          let v = await axe(page);
          if (v.length) problems.push(`${label} start:\n    ${formatViolations(v)}`);
          await shot(page, `start-${vp}-${scheme}`, { fullPage: true });
          if (vp === 'phone') {
            await page.click('#wt-menu-btn');
            v = await axe(page, { include: '#wt-mast' });
            if (v.length) problems.push(`${label} menu:\n    ${formatViolations(v)}`);
            await page.keyboard.press('Escape');
            await page.click('#wt-menu-btn');
          }
          await page.click('#wt-reviewer-chip');
          await sleep(350);
          v = await axe(page, { include: '#wt-name-dialog' });
          if (v.length) problems.push(`${label} name dialog:\n    ${formatViolations(v)}`);
          await shot(page, `name-dialog-${vp}-${scheme}`);
          await page.click('[data-wt-new-reviewer]');
          await sleep(350);
          v = await axe(page, { include: '#wt-confirm' });
          if (v.length) problems.push(`${label} confirm dialog:\n    ${formatViolations(v)}`);
          assertNoErrors(P.errors, assert, P.external);
        } finally {
          await P.close();
        }
      }
    }
    assert.equal(problems.length, 0, '\n  ' + problems.join('\n  '));
  });
}
