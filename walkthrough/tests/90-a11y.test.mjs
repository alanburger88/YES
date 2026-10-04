/*
 * 90-a11y — accessibility across the whole app (SPEC section 4). Owner: integration.
 *
 * 1. axe-core (WCAG 2.0–2.2 A/AA + best practice) with zero violations on every
 *    view and the tour's dialogs, at 1280×800 and 390×844, in light and dark.
 *    The four runs also cover the four ways a theme is chosen: device light,
 *    device dark, a saved "light" on a dark device and a saved "dark" on a light
 *    device. Only the app document is checked: axe runs with iframes: false, so
 *    the statement inside the tour frame (tested on its own) is left out.
 * 2. No horizontal page scroll, and nothing cut off at the right edge, at 320px.
 * 3. A visible focus indicator on every tab stop of the shell and a sample of
 *    views (keyboard Tab), never hidden under the sticky masthead.
 * 4. prefers-reduced-motion: no CSS animation or transition longer than 0.01s,
 *    no running animations, no smooth scrolling, no overlay tween.
 * 5. 200% zoom (a 640×400 CSS viewport at deviceScaleFactor 2): the tour panel's
 *    navigation buttons are fully visible, at least 24×24 and never overlap.
 * 6. Dialogs and navigation: every WT dialog closes when the route changes (Back,
 *    or a link inside the dialog), focus goes to the new view instead of a
 *    trigger on the old one, and a normal close still returns focus.
 *
 *   node tests/run.mjs --only 90-a11y
 */
import { assertNoErrors, axe, formatViolations, gotoApp, openPage, seedBrowserReviewer, sleep } from './helpers.mjs';
import { seedResults } from './50-results.test.mjs';

export const meta = { timeout: 900000 };

const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const NARROW = { width: 320, height: 640, isMobile: true, hasTouch: true };
const ZOOM200 = { width: 640, height: 400, deviceScaleFactor: 2 };

export default async function (ctx) {
  const { base, api, assert, step, log, features, adminCode } = ctx;
  const ids = features.map((f) => f.id);
  const has = (id) => ids.includes(id);
  // A dialog-based step: the statement's transaction detail (falls back to any step).
  const dialogStep = has('detail') ? 'detail' : ids[Math.min(8, ids.length - 1)];
  const journey = has('journey') ? 'journey' : ids[0];
  const detailId = ids[1]; // has responses, a debate and a comment (seedResults)

  async function until(fn, ms = 10000, label = 'condition') {
    const t0 = Date.now();
    for (;;) {
      const v = await fn();
      if (v) return v;
      if (Date.now() - t0 > ms) throw new Error('timed out waiting for ' + label);
      await sleep(80);
    }
  }

  /* ---- Seed: everyone's answers, and a browser reviewer with some of their own ---- */
  await seedResults(api, features);
  const reviewerSeed = () =>
    seedBrowserReviewer(api, {
      name: 'Alex Accessibility',
      answers: {
        [ids[0]]: { vote: 'include', priority: 'high', reason: 'Customers ask for this.' },
        [ids[2]]: { vote: 'include', priority: 'medium', comment: 'Keep the wording short.' },
        [ids[3]]: { vote: 'exclude', priority: 'low' }
      },
      lastStep: ids[3]
    });

  /* ---- Navigation helpers ---- */
  async function go(page, path) {
    await page.evaluate((p) => window.WT.go(p), path);
    const [view, param = ''] = path.replace(/^\//, '').split('/');
    await page.waitForFunction(
      ([v, p]) => {
        const r = window.WT.route();
        const sec = document.getElementById('view-' + v);
        return r && r.view === v && r.param === p && sec && !sec.hidden;
      },
      [view, param],
      { timeout: 10000 }
    );
    await ready(page, view, param);
  }

  /** Wait until a view has finished loading what it shows. */
  async function ready(page, view, param) {
    if (view === 'tour') return activated(page, param);
    if (view === 'results') {
      const sel = !param ? '.wt-ov' : param === 'features' ? '.wt-rank' : param === 'people' ? '.wt-people' : '.wt-detail';
      await page.waitForFunction((s) => document.getElementById('view-results').getAttribute('aria-busy') === 'false' && !!document.querySelector('#view-results ' + s), sel, { timeout: 15000 });
    } else if (view === 'data') {
      await page.waitForFunction(() => !!document.querySelector('#view-data .wt-jx [role="tree"], #view-data .wt-dv__empty, #view-data .wt-empty'), null, { timeout: 15000 });
    } else if (view === 'admin') {
      await page.waitForFunction(() => !!document.querySelector('#view-admin .wt-admin__card'), null, { timeout: 10000 });
    }
    await sleep(150);
  }

  /** Wait until a tour step's activation (reset → apply → target → scroll → draw) has finished. */
  async function activated(page, id) {
    await page.waitForFunction(
      (i) => {
        const r = document.querySelector('.wt-tour');
        return !!(r && r.getAttribute('data-activated') === i && window.WT.route().param === i);
      },
      id,
      { timeout: 25000 }
    );
    await page.waitForFunction(() => !document.getElementById('wt-tour-overlay').hasAttribute('data-anim'), null, { timeout: 5000 });
    await sleep(150);
  }

  async function noViolations(page, label, opts) {
    const v = await axe(page, opts);
    assert.deepEqual(v, [], label + ':\n    ' + formatViolations(v));
  }

  /* ------------------------------------------------------------------ */
  /* 1. axe on every view, 2 sizes × 2 themes                            */
  /* ------------------------------------------------------------------ */
  const RUNS = [
    { name: 'desktop light (device light)', viewport: DESKTOP, colorScheme: 'light', saved: null, theme: 'light' },
    { name: 'desktop dark (device dark)', viewport: DESKTOP, colorScheme: 'dark', saved: null, theme: 'dark' },
    { name: 'phone light (saved light on a dark device)', viewport: PHONE, colorScheme: 'dark', saved: 'light', theme: 'light' },
    { name: 'phone dark (saved dark on a light device)', viewport: PHONE, colorScheme: 'light', saved: 'dark', theme: 'dark' }
  ];

  for (const run of RUNS) {
    await step(`axe, zero violations on every view and dialog: ${run.name}`, async () => {
      const storage = await reviewerSeed();
      if (run.saved) storage['infoslips.wt.theme'] = run.saved;
      const P = await openPage(ctx, { viewport: run.viewport, colorScheme: run.colorScheme, storage });
      const { page } = P;
      const checked = [];
      try {
        await gotoApp(page, base, '#/start');
        assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), run.theme, 'theme in use');
        await ready(page, 'start');
        await noViolations(page, '#/start');
        checked.push('#/start');

        // The name dialog (from the masthead chip, or the phone Menu).
        await page.evaluate(() => window.WT.shell.openNameDialog());
        await page.locator('#wt-name-dialog').waitFor({ state: 'visible' });
        await noViolations(page, 'name dialog', { include: '#wt-name-dialog' });
        await page.keyboard.press('Escape');
        await page.locator('#wt-name-dialog').waitFor({ state: 'hidden' });
        checked.push('name dialog');

        // Tour: a page step, its dialogs, then a step the statement shows in a dialog.
        await go(page, '/tour/' + journey);
        await noViolations(page, '#/tour/' + journey);
        checked.push('#/tour/' + journey);

        await page.click('[data-act="steps"]');
        await page.locator('#tour-steps').waitFor({ state: 'visible' });
        await sleep(200);
        await noViolations(page, 'All steps dialog', { include: '#tour-steps' });
        await page.keyboard.press('Escape');
        await page.locator('#tour-steps').waitFor({ state: 'hidden' });
        checked.push('All steps');

        await page.click('[data-act="datareq"]');
        await page.locator('#tour-datareq').waitFor({ state: 'visible' });
        await page.locator('#tour-datareq [role="tree"]').waitFor({ state: 'visible' });
        await sleep(200);
        await noViolations(page, 'data requirements dialog', { include: '#tour-datareq' });
        await page.keyboard.press('Escape');
        await page.locator('#tour-datareq').waitFor({ state: 'hidden' });
        checked.push('data requirements dialog');

        await go(page, '/tour/' + dialogStep);
        await noViolations(page, '#/tour/' + dialogStep);
        checked.push('#/tour/' + dialogStep);

        // Results (seeded), every sub-view.
        for (const path of ['/results', '/results/features', '/results/' + detailId, '/results/people']) {
          await go(page, path);
          await noViolations(page, '#' + path);
          checked.push('#' + path);
        }

        // Data requirements: my included features, then one feature.
        for (const path of ['/data', '/data/' + ids[2]]) {
          await go(page, path);
          await noViolations(page, '#' + path);
          checked.push('#' + path);
        }

        // Admin: the sign-in form, then signed in, with moderation on a feature's answers.
        await go(page, '/admin');
        await noViolations(page, '#/admin (sign in)');
        checked.push('#/admin');
        assert.equal(await page.evaluate((c) => window.WT.api.admin.check(c), adminCode), true, 'admin sign-in');
        await page.locator('#admin-state-h').waitFor({ state: 'visible' });
        await noViolations(page, '#/admin (signed in)');
        checked.push('#/admin signed in');
        await go(page, '/results/' + detailId);
        await page.locator('#view-results [data-mod="hide"]').first().waitFor({ state: 'visible', timeout: 15000 });
        await noViolations(page, '#/results/' + detailId + ' (admin)');
        checked.push('#/results/<id> admin');

        assertNoErrors(P.errors, assert, P.external);
        log(`${run.name}: ${checked.length} checked`);
      } finally {
        await P.close();
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /* 2. 320px: no horizontal page scroll, nothing cut off                */
  /* ------------------------------------------------------------------ */
  await step('320px: no horizontal page scroll and nothing cut off on every view', async () => {
    const P = await openPage(ctx, { viewport: NARROW, storage: await reviewerSeed() });
    const { page } = P;
    const problems = [];
    try {
      await gotoApp(page, base, '#/start');
      await ready(page, 'start');
      const paths = ['/start', '/tour/' + journey, '/tour/' + dialogStep, '/results', '/results/features', '/results/' + detailId, '/results/people', '/data', '/data/' + ids[2], '/admin'];
      for (const path of paths) {
        if (path !== '/start') await go(page, path);
        const r = await page.evaluate(() => {
          const de = document.documentElement;
          const W = de.clientWidth;
          const out = { scroll: [de.scrollWidth, document.body.scrollWidth, W], cut: [] };
          const view = document.querySelector('.wt-view:not([hidden])');
          const roots = [document.getElementById('wt-mast'), view, document.getElementById('wt-foot')].filter(Boolean);
          const clipsInside = (el) => {
            for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
              const cs = getComputedStyle(p);
              if (cs.overflowX !== 'visible' && p.getBoundingClientRect().right <= W + 1) return true;
            }
            return false;
          };
          for (const root of roots) {
            for (const el of root.querySelectorAll('*')) {
              if (el.closest('.wt-sr-only, [hidden], dialog:not([open])')) continue;
              const rect = el.getBoundingClientRect();
              if (!rect.width || !rect.height) continue;
              if (rect.right > W + 1 && !clipsInside(el)) {
                out.cut.push((el.className && el.className.baseVal === undefined ? '.' + String(el.className).trim().split(/\s+/).join('.') : el.tagName.toLowerCase()) + ' → ' + Math.round(rect.right));
              }
            }
          }
          out.cut = out.cut.slice(0, 6);
          return out;
        });
        if (r.scroll[0] > r.scroll[2] || r.scroll[1] > r.scroll[2]) problems.push(`#${path}: page scrolls sideways (${r.scroll.join(' / ')})`);
        if (r.cut.length) problems.push(`#${path}: cut off at the right: ${r.cut.join(', ')}`);
      }
      assert.deepEqual(problems, [], problems.join('\n'));
      assertNoErrors(P.errors, assert, P.external);
    } finally {
      await P.close();
    }
  });

  /* ------------------------------------------------------------------ */
  /* 3. Focus is visible on every tab stop (shell + a sample of views)   */
  /* ------------------------------------------------------------------ */
  /** Tab through the page; for each stop, check a visible indicator that the masthead doesn't hide. */
  async function tabAudit(page, label, max, stopAt) {
    const problems = [];
    const seen = [];
    await page.evaluate(() => {
      document.activeElement && document.activeElement.blur && document.activeElement.blur();
      window.scrollTo(0, 0);
    });
    for (let i = 0; i < max; i++) {
      await page.keyboard.press('Tab');
      await sleep(40);
      const f = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body || el === document.documentElement) return null;
        const label = el.labels && el.labels[0] ? el.labels[0].textContent : '';
        const name = (el.getAttribute('aria-label') || el.textContent || label || el.getAttribute('title') || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 50);
        const key = el.getAttribute('data-fk') || (el.name ? el.name + '=' + el.value : '');
        const desc = el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (key ? '[' + key + ']' : '') + ' "' + name + '"';
        if (el.tagName === 'IFRAME') return { desc, iframe: true };
        const ring = (cs) => !!cs && cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2;
        const cands = [getComputedStyle(el), getComputedStyle(el, '::after'), getComputedStyle(el, '::before')];
        if (el.nextElementSibling) cands.push(getComputedStyle(el.nextElementSibling)); // radio/switch styled on the next sibling
        if (el.firstElementChild) cands.push(getComputedStyle(el.firstElementChild)); // tree items styled on their row
        const r = el.getBoundingClientRect();
        const target = el.nextElementSibling && /wt-segmented__label|wt-switch__track|wt-dv__opt-body/.test(el.nextElementSibling.className) ? el.nextElementSibling.getBoundingClientRect() : r;
        const mast = document.getElementById('wt-mast');
        const mb = mast ? mast.getBoundingClientRect().bottom : 0;
        // Under the sticky masthead: the top of the indicator is above the masthead's
        // bottom edge and the masthead is what is drawn there (the skip link sits above it).
        let hidden = false;
        if (mast && !mast.contains(el) && target.height > 0 && target.top < mb - 1) {
          const x = Math.min(Math.max(target.left + target.width / 2, 0), innerWidth - 1);
          const top = document.elementFromPoint(x, Math.max(0, target.top + 1));
          hidden = !!(top && mast.contains(top));
        }
        return {
          desc,
          visible: el.matches(':focus-visible'),
          ring: cands.some(ring),
          hidden,
          offscreen: target.bottom < 0 || target.top > innerHeight || target.right < 0 || target.left > innerWidth
        };
      });
      if (!f) continue;
      if (f.iframe || (stopAt && seen.includes(f.desc))) break;
      seen.push(f.desc);
      if (!f.visible) problems.push(`${label}: ${f.desc} does not match :focus-visible`);
      else if (!f.ring) problems.push(`${label}: ${f.desc} has no visible focus indicator`);
      if (f.hidden) problems.push(`${label}: ${f.desc} is hidden under the sticky masthead`);
      if (f.offscreen) problems.push(`${label}: ${f.desc} is off screen`);
    }
    return { problems, count: seen.length };
  }

  await step('keyboard focus is visible on every tab stop of the shell and on samples of each view', async () => {
    const problems = [];
    const counts = [];
    // Desktop light: the whole start page (skip link, masthead, content, footer).
    let P = await openPage(ctx, { viewport: DESKTOP, storage: await reviewerSeed() });
    try {
      await gotoApp(P.page, base, '#/start');
      await ready(P.page, 'start');
      let a = await tabAudit(P.page, '#/start desktop light', 90, true);
      problems.push(...a.problems);
      counts.push('start ' + a.count);
      assert.ok(a.count >= 20, 'tabbed through the start page: ' + a.count);
      await go(P.page, '/results');
      a = await tabAudit(P.page, '#/results desktop light', 40);
      problems.push(...a.problems);
      counts.push('results ' + a.count);
      await go(P.page, '/tour/' + journey);
      a = await tabAudit(P.page, '#/tour desktop light', 60, true);
      problems.push(...a.problems);
      counts.push('tour ' + a.count);
      assertNoErrors(P.errors, assert, P.external);
    } finally {
      await P.close();
    }
    // Desktop dark (Lime focus ring): data requirements and admin.
    P = await openPage(ctx, { viewport: DESKTOP, colorScheme: 'dark', storage: await reviewerSeed() });
    try {
      await gotoApp(P.page, base, '#/data');
      await ready(P.page, 'data');
      let a = await tabAudit(P.page, '#/data desktop dark', 40);
      problems.push(...a.problems);
      counts.push('data ' + a.count);
      await go(P.page, '/admin');
      a = await tabAudit(P.page, '#/admin desktop dark', 20, true);
      problems.push(...a.problems);
      counts.push('admin ' + a.count);
    } finally {
      await P.close();
    }
    // Phone dark: the masthead with its Menu open.
    P = await openPage(ctx, { viewport: PHONE, colorScheme: 'dark' });
    try {
      await gotoApp(P.page, base, '#/start');
      await P.page.click('#wt-menu-btn');
      await P.page.locator('#wt-menu.is-open').waitFor();
      const a = await tabAudit(P.page, '#/start phone menu', 8);
      problems.push(...a.problems);
      counts.push('phone menu ' + a.count);
      assert.ok(a.count >= 5, 'menu items reached: ' + a.count);
    } finally {
      await P.close();
    }
    log('tab stops checked: ' + counts.join(', '));
    assert.deepEqual(problems, [], problems.join('\n'));
  });

  /* ------------------------------------------------------------------ */
  /* 4. prefers-reduced-motion                                           */
  /* ------------------------------------------------------------------ */
  await step('prefers-reduced-motion: no animation or transition longer than 0.01s, no smooth scroll, no tween', async () => {
    const P = await openPage(ctx, { viewport: DESKTOP, reducedMotion: 'reduce', storage: await reviewerSeed() });
    const { page } = P;
    const problems = [];
    const audit = async (label) => {
      const bad = await page.evaluate(() => {
        const out = [];
        const secs = (v) => String(v || '0s').split(',').map((s) => parseFloat(s) * (/ms\s*$/.test(s) ? 0.001 : 1));
        const name = (el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/)[0] : '');
        for (const el of document.querySelectorAll('*')) {
          for (const pseudo of [null, '::before', '::after']) {
            const cs = getComputedStyle(el, pseudo);
            if (cs.animationName !== 'none' && Math.max(...secs(cs.animationDuration)) > 0.01) out.push(name(el) + (pseudo || '') + ' animation ' + cs.animationName + ' ' + cs.animationDuration);
            if (cs.transitionProperty !== 'none' && Math.max(...secs(cs.transitionDuration)) > 0.01) out.push(name(el) + (pseudo || '') + ' transition ' + cs.transitionDuration);
          }
        }
        for (const a of document.getAnimations()) {
          const t = a.effect && a.effect.getComputedTiming();
          if (t && a.playState === 'running' && t.duration > 10) out.push('running animation ' + (a.animationName || a.transitionProperty || a.id || 'script') + ' ' + t.duration + 'ms');
        }
        if (getComputedStyle(document.documentElement).scrollBehavior === 'smooth') out.push('html scroll-behavior: smooth');
        return out.slice(0, 10);
      });
      for (const b of bad) problems.push(label + ': ' + b);
    };
    try {
      await gotoApp(page, base, '#/start');
      assert.equal(await page.evaluate(() => window.WT.reducedMotion()), true, 'WT.reducedMotion()');
      await ready(page, 'start');
      await audit('#/start');
      // Tour: watch for the outline tween while the step activates.
      await page.evaluate(() => {
        window.__tween = false;
        new MutationObserver(() => {
          const ov = document.getElementById('wt-tour-overlay');
          if (ov && ov.hasAttribute('data-anim')) window.__tween = true;
        }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['data-anim'] });
      });
      await go(page, '/tour/' + journey);
      await audit('#/tour/' + journey);
      await page.click('[data-act="next"]');
      await activated(page, ids[ids.indexOf(journey) + 1] || journey);
      assert.equal(await page.evaluate(() => window.__tween), false, 'no outline tween with reduced motion');
      await page.click('[data-act="steps"]');
      await page.locator('#tour-steps').waitFor({ state: 'visible' });
      await audit('All steps dialog');
      await page.keyboard.press('Escape');
      for (const path of ['/results', '/results/' + detailId, '/data', '/admin']) {
        await go(page, path);
        await audit('#' + path);
      }
      assertNoErrors(P.errors, assert, P.external);
    } finally {
      await P.close();
    }
    assert.deepEqual(problems, [], problems.join('\n'));
  });

  /* ------------------------------------------------------------------ */
  /* 5. 200% zoom: the tour panel's navigation                           */
  /* ------------------------------------------------------------------ */
  await step('200% zoom (640×400 at 2×): the tour navigation is fully visible and never overlaps', async () => {
    const P = await openPage(ctx, { viewport: ZOOM200, storage: await reviewerSeed() });
    const { page } = P;
    const navCheck = () =>
      page.evaluate(() => {
        const out = [];
        const nav = document.querySelector('.wt-tour__nav');
        const btns = Array.from(nav.querySelectorAll('button')).filter((b) => b.getClientRects().length);
        const rects = btns.map((b) => ({ b, r: b.getBoundingClientRect(), name: (b.getAttribute('title') || b.textContent).trim() }));
        if (rects.length < 4) out.push('only ' + rects.length + ' navigation buttons shown');
        for (const { b, r, name } of rects) {
          if (r.width < 24 || r.height < 24) out.push(`${name} is ${r.width}×${r.height}`);
          if (r.left < -0.5 || r.top < -0.5 || r.right > innerWidth + 0.5 || r.bottom > innerHeight + 0.5) out.push(`${name} is outside the viewport`);
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          if (!hit || !b.contains(hit)) out.push(`${name} is covered by ${hit ? hit.className || hit.tagName : 'nothing'}`);
          const label = b.querySelector('span:not(.wt-sr-only)');
          const lr = label && label.getClientRects().length ? label.getBoundingClientRect() : null;
          if (lr && lr.width > 1 && lr.height > 1) {
            // (icon-only tools keep their label for screen readers only)
            if (lr.right > r.right + 0.5 || lr.left < r.left - 0.5 || label.scrollWidth > label.clientWidth + 1) out.push(`${name}: its label overflows the button`);
          }
        }
        for (let i = 0; i < rects.length; i++)
          for (let j = i + 1; j < rects.length; j++) {
            const a = rects[i].r;
            const c = rects[j].r;
            const w = Math.min(a.right, c.right) - Math.max(a.left, c.left);
            const h = Math.min(a.bottom, c.bottom) - Math.max(a.top, c.top);
            if (w > 0.5 && h > 0.5) out.push(`${rects[i].name} overlaps ${rects[j].name}`);
          }
        const nr = nav.getBoundingClientRect();
        const sc = document.querySelector('.wt-tour__scroll').getBoundingClientRect();
        if (sc.bottom > nr.top + 0.5 && sc.height > 0) out.push('the panel content runs under the navigation');
        const de = document.documentElement;
        if (de.scrollWidth > de.clientWidth) out.push('the page scrolls sideways');
        return out;
      });
    try {
      await gotoApp(page, base, '#/tour/' + journey);
      await activated(page, journey);
      let problems = (await navCheck()).map((p) => 'split view: ' + p);
      // "Show panel" maximises the panel; check again, and after Next.
      const panelBtn = page.locator('[data-pane-btn="panel"]');
      if (await panelBtn.isVisible()) {
        await panelBtn.click();
        await sleep(300);
        problems = problems.concat((await navCheck()).map((p) => 'panel view: ' + p));
        await panelBtn.click();
        await sleep(300);
      }
      await page.click('[data-act="next"]');
      await activated(page, ids[ids.indexOf(journey) + 1] || journey);
      problems = problems.concat((await navCheck()).map((p) => 'after Next: ' + p));
      // The last step's longer "Finish and see results" label.
      await go(page, '/tour/' + ids[ids.length - 1]);
      problems = problems.concat((await navCheck()).map((p) => 'last step: ' + p));
      assert.deepEqual(problems, [], problems.join('\n'));
      assertNoErrors(P.errors, assert, P.external);
    } finally {
      await P.close();
    }
  });

  /* ------------------------------------------------------------------ */
  /* 6. Dialogs close on navigation; focus goes to the new view          */
  /* ------------------------------------------------------------------ */
  await step('a route change closes any open dialog and focuses the new view; Escape still returns focus to the trigger', async () => {
    const P = await openPage(ctx, { viewport: DESKTOP, storage: await reviewerSeed() });
    const { page } = P;
    const openDialogs = () => page.evaluate(() => Array.from(document.querySelectorAll('dialog[open]')).map((d) => d.id));
    const settled = async (label, view) => {
      await until(async () => (await openDialogs()).length === 0, 4000, label + ': dialogs closed');
      await sleep(200);
      const f = await page.evaluate(() => {
        const a = document.activeElement;
        const sec = a && a.closest && a.closest('.wt-view');
        return { tag: a ? a.tagName.toLowerCase() : '', view: sec ? sec.id : '', hidden: !!(sec && sec.hidden), modal: document.documentElement.classList.contains('wt-modal-open') };
      });
      assert.equal(f.tag, 'h1', label + ': focus on the new view’s h1, not ' + f.tag);
      assert.equal(f.view, 'view-' + view, label + ': focus in the shown view');
      assert.equal(f.hidden, false, label + ': focus is not in a hidden view');
      assert.equal(f.modal, false, label + ': page scroll unlocked');
    };
    try {
      // Results: the screenshot dialog, then Back. (History: start → results → features.)
      await gotoApp(page, base, '#/start');
      await ready(page, 'start');
      await page.click('#wt-mast a[data-nav="results"]');
      await ready(page, 'results');
      await page.click('.wt-subnav a[href="#/results/features"]');
      await ready(page, 'results', 'features');
      await page.locator('.wt-rank__thumb').first().click();
      await page.locator('#wt-shot-dialog').waitFor({ state: 'visible' });
      await page.goBack();
      await ready(page, 'results');
      await settled('screenshot dialog + Back', 'results');

      // The name dialog with a confirm on top, then Back (to the start): both close, nothing is reset.
      const secret = await page.evaluate(() => window.WT.reviewer.get().secret);
      await page.click('#wt-reviewer-chip');
      await page.locator('#wt-name-dialog').waitFor({ state: 'visible' });
      await page.click('[data-wt-new-reviewer]');
      await page.locator('#wt-confirm').waitFor({ state: 'visible' });
      await page.goBack();
      await ready(page, 'start');
      await settled('name + confirm dialogs + Back', 'start');
      assert.equal(await page.evaluate(() => window.WT.reviewer.get().secret), secret, 'the confirm resolved as cancelled');

      // Tour: All steps, then Back (same view, previous step).
      await go(page, '/tour/' + ids[1]);
      await go(page, '/tour/' + ids[2]);
      await page.click('[data-act="steps"]');
      await page.locator('#tour-steps').waitFor({ state: 'visible' });
      await page.goBack();
      await activated(page, ids[1]);
      await settled('All steps + Back', 'tour');

      // Tour: Restart confirm, then Back: closed, no restart.
      await page.click('[data-act="restart"]');
      await page.locator('#wt-confirm').waitFor({ state: 'visible' });
      await page.goBack();
      await ready(page, 'start');
      await settled('restart confirm + Back', 'start');

      // Tour: the data requirements dialog, then Forward.
      await page.goForward();
      await activated(page, ids[1]);
      await page.click('[data-act="datareq"]');
      await page.locator('#tour-datareq [role="tree"]').waitFor({ state: 'visible' });
      await page.goForward();
      await activated(page, ids[2]);
      await settled('data requirements dialog + Forward', 'tour');

      // The explorer dialog (WT.json.openDialog): a "Needed by" link inside it navigates away.
      await go(page, '/data');
      await page.evaluate((id) => window.WT.json.openDialog({ features: [id], trigger: document.querySelector('#view-data h1') }), ids[2]);
      await page.locator('#wt-json-dialog [role="tree"]').waitFor({ state: 'visible' });
      await page.locator('#wt-json-dialog [role="treeitem"][aria-expanded] [role="group"] [role="treeitem"]').first().click();
      const link = page.locator('#wt-json-dialog a[href^="#/results/"]').first();
      await link.waitFor({ state: 'visible' });
      await link.click();
      await ready(page, 'results', await page.evaluate(() => window.WT.route().param));
      await settled('explorer dialog + link', 'results');

      // A normal close still returns focus to the trigger.
      await page.click('#wt-reviewer-chip');
      await page.locator('#wt-name-dialog').waitFor({ state: 'visible' });
      await page.keyboard.press('Escape');
      await until(async () => (await openDialogs()).length === 0, 4000, 'Escape closes');
      await sleep(150);
      assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), 'wt-reviewer-chip', 'focus back on the chip');
      assertNoErrors(P.errors, assert, P.external);
    } finally {
      await P.close();
    }
  });
}
