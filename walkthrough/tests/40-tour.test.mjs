/*
 * 40-tour — the guided walkthrough (SPEC section 5) in a real browser.
 * Owner: tour.
 *
 * Layout and deep links, Next/Back/Restart, the All steps list, browser Back
 * and Forward (and no history leaks from the statement, STATEMENT-MAP G1/G6),
 * the highlight for EVERY feature at 1280×800 and 390×844, answers that
 * autosave (also offline and after a server error), keyboard-only use, focus
 * after each step (G4), theme sync into the statement (also after the
 * integrity reload, G12), the phone layout, Dim the rest, Show it and the data
 * requirements dialog. Screenshots go to test-results/screens/tour-*.png.
 */
import { assertNoErrors, axe, focused, formatViolations, gotoApp, openPage, seedBrowserReviewer, reviewerStorage, shot, sleep } from './helpers.mjs';

export const meta = { timeout: 900000 };

const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const TABLET = { width: 900, height: 1100, isMobile: true, hasTouch: true };
const BRAND_COMPACT = 'YES branding is a placeholder and will be updated.';

/**
 * In the page: where the overlay drew the outline, and where it should be,
 * computed independently from the statement's DOM: the first visible match of
 * the step's selectors, padded by 8px, mapped through the frame's position and
 * clamped to what the frame shows (below the statement's sticky masthead for
 * targets in the page flow, inside any clipping scroll box, 2px in from the edge).
 */
function geometry() {
  const fr = document.getElementById('wt-frame');
  const w = fr.contentWindow;
  const d = w.document;
  const id = window.WT.tour.current();
  const step = window.WT.steps[id];
  const ov = document.getElementById('wt-tour-overlay');
  const edge = document.querySelector('.wt-tour__edge');
  const ringR = document.querySelector('.wt-spot__ring').getBoundingClientRect();
  const fRect = fr.getBoundingClientRect();
  const ovRect = ov.getBoundingClientRect();
  const hole = document.querySelector('.wt-spot__hole');
  const vis = (c) => {
    const r = c.getBoundingClientRect();
    const cs = w.getComputedStyle(c);
    return r.width >= 1 && r.height >= 1 && cs.visibility !== 'hidden' && cs.display !== 'none' && !c.closest('[hidden]') && !c.closest('dialog:not([open])');
  };
  let el = null;
  for (const sel of window.WT.driver.selectors(w, step)) {
    el = Array.from(d.querySelectorAll(sel)).find(vis) || null;
    if (el) break;
  }
  const out = {
    id,
    state: ov.getAttribute('data-state'),
    edge: !edge.hidden && edge.getBoundingClientRect().height > 0,
    edgeText: edge.textContent.trim(),
    found: !!el,
    ring: { l: ringR.left, t: ringR.top, r: ringR.right, b: ringR.bottom },
    hole: {
      l: ovRect.left + Number(hole.getAttribute('x')),
      t: ovRect.top + Number(hole.getAttribute('y')),
      r: ovRect.left + Number(hole.getAttribute('x')) + Number(hole.getAttribute('width')),
      b: ovRect.top + Number(hole.getAttribute('y')) + Number(hole.getAttribute('height'))
    },
    frame: { l: fRect.left, t: fRect.top, r: fRect.right, b: fRect.bottom },
    ringOpacity: Number(getComputedStyle(document.querySelector('.wt-spot__ring')).opacity),
    tag: document.querySelector('.wt-spot__tag').textContent
  };
  if (!el) return out;
  let pinned = !!el.closest('dialog[open], #masthead, #mast-menu');
  const v = { l: 0, t: 0, r: d.documentElement.clientWidth, b: d.documentElement.clientHeight };
  for (let p = el.parentElement; p && p !== d.body && p !== d.documentElement; p = p.parentElement) {
    const cs = w.getComputedStyle(p);
    if (cs.position === 'fixed') pinned = true;
    if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
      const pr = p.getBoundingClientRect();
      const bl = parseFloat(cs.borderLeftWidth) || 0;
      const bt = parseFloat(cs.borderTopWidth) || 0;
      v.l = Math.max(v.l, pr.left + bl);
      v.t = Math.max(v.t, pr.top + bt);
      v.r = Math.min(v.r, pr.left + bl + p.clientWidth);
      v.b = Math.min(v.b, pr.top + bt + p.clientHeight);
    }
  }
  if (!pinned) v.t = Math.max(v.t, window.WT.driver.topInset(w));
  const r = el.getBoundingClientRect();
  out.target = { l: r.left + fRect.left, t: r.top + fRect.top, r: r.right + fRect.left, b: r.bottom + fRect.top };
  out.expected = {
    l: Math.max(r.left - 8, v.l + 2) + fRect.left,
    t: Math.max(r.top - 8, v.t + 2) + fRect.top,
    r: Math.min(r.right + 8, v.r - 2) + fRect.left,
    b: Math.min(r.bottom + 8, v.b - 2) + fRect.top
  };
  out.visibleH = Math.min(r.bottom, v.b) - Math.max(r.top, v.t);
  return out;
}

export default async function (ctx) {
  const { base, api, assert, step, features, log } = ctx;
  const N = features.length;
  const ids = features.map((f) => f.id);
  const first = ids[0];
  const has = (id) => ids.includes(id);

  async function until(fn, ms = 8000, label = 'condition') {
    const t0 = Date.now();
    for (;;) {
      const v = await fn();
      if (v) return v;
      if (Date.now() - t0 > ms) throw new Error('timed out waiting for ' + label);
      await sleep(80);
    }
  }
  /** Wait until a step's activation (reset → apply → target → scroll → draw) has finished. */
  async function activated(page, id, ms = 20000) {
    await page.waitForFunction(
      (i) => {
        const r = document.querySelector('.wt-tour');
        return !!(r && r.getAttribute('data-activated') === i && window.WT.route().param === i);
      },
      id,
      { timeout: ms }
    );
    await page.waitForFunction(() => !document.getElementById('wt-tour-overlay').hasAttribute('data-anim'), null, { timeout: 5000 });
    await sleep(120);
  }
  async function openTour(opts, hash) {
    const P = await openPage(ctx, opts);
    await gotoApp(P.page, base, hash);
    return P;
  }
  const secretOf = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('infoslips.wt.reviewer')).secret);
  async function serverAnswer(secret, id) {
    const r = await api('/api/me', { secret });
    return (r.json && r.json.answers && r.json.answers[id]) || null;
  }
  const frameTheme = (page) => page.evaluate(() => document.getElementById('wt-frame').contentDocument.documentElement.getAttribute('data-theme'));
  const statusOf = (page) => page.evaluate(() => {
    const s = document.querySelector('.wt-tour__status');
    return { state: s.getAttribute('data-state'), text: s.textContent.trim(), retry: !document.querySelector('[data-act="retry"]').hidden };
  });

  /* ------------------------------------------------------------------ */
  await step('deep link: layout at 1280×800, panel content, frame, branding, no page scroll', async () => {
    const P = await openTour({ viewport: DESKTOP }, '#/tour/' + ids[2]);
    const { page } = P;
    try {
      await activated(page, ids[2]);
      const f = features[2];
      assert.equal((await page.locator('#tour-title').innerText()).trim(), f.title);
      assert.equal((await page.locator('#tour-count').innerText()).trim(), `Step 3 of ${N}`);
      assert.equal(await page.locator('.wt-tour__progress').getAttribute('value'), '3');
      assert.equal(await page.locator('.wt-tour__progress').getAttribute('max'), String(N));
      assert.equal(await page.locator('.wt-tour__progress').getAttribute('aria-labelledby'), 'tour-count');
      assert.ok((await page.locator('.wt-tour__section').innerText()).trim().length > 2, 'section label');
      const text = await page.locator('.wt-tour__content').innerText();
      for (const h of ['WHAT IT IS', 'VALUE FOR YES', 'VALUE FOR YOUR CUSTOMERS', 'TRY IT']) assert.ok(text.toUpperCase().includes(h), 'panel has ' + h);
      assert.equal(await page.locator('[data-act="datareq"]').innerText(), 'View data requirements');
      const notice = page.locator('#view-tour [data-brand-notice="compact"]');
      assert.equal(await notice.count(), 1, 'compact branding notice');
      assert.equal((await notice.innerText()).trim(), BRAND_COMPACT);
      assert.ok(await notice.isVisible());
      // Your view
      assert.equal(await page.locator('input[name="tour-vote"]').count(), 2);
      assert.equal(await page.locator('input[name="tour-priority"]').count(), 3);
      assert.match(await page.locator('#view-tour').innerText(), /Include in the production statement\?/);
      assert.match(await page.locator('#view-tour').innerText(), /Priority if included/);
      assert.equal(await page.locator('#tour-reason').getAttribute('maxlength'), '500');
      assert.equal(await page.locator('#tour-comment').getAttribute('maxlength'), '2000');
      assert.equal(await page.locator('.wt-tour__status').getAttribute('role'), 'status');
      // Frame
      const frame = page.locator('#wt-frame');
      assert.equal(await frame.getAttribute('title'), 'YES statement (interactive demo)');
      assert.equal(await frame.getAttribute('src'), 'statement/index.html');
      assert.equal(await page.evaluate(() => document.getElementById('wt-frame').contentWindow.YES.ready), true, 'same-origin statement booted');
      assert.equal(await page.locator('#wt-tour-overlay').getAttribute('aria-hidden'), 'true');
      assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('wt-tour-overlay')).pointerEvents), 'none');
      // Layout: frame left, panel right, each scrolling on its own, no page scroll
      const L = await page.evaluate(() => {
        const fr = document.getElementById('wt-frame').getBoundingClientRect();
        const pa = document.querySelector('.wt-tour__panel').getBoundingClientRect();
        const sc = document.querySelector('.wt-tour__scroll');
        const nav = document.querySelector('.wt-tour__nav').getBoundingClientRect();
        const se = document.scrollingElement;
        return {
          fr: [fr.left, fr.right, fr.top, fr.bottom],
          pa: [pa.left, pa.right, pa.width, pa.bottom],
          nav: [nav.top, nav.bottom],
          scroll: [sc.scrollHeight, sc.clientHeight, getComputedStyle(sc).overflowY],
          page: [se.scrollWidth, se.scrollHeight, innerWidth, innerHeight]
        };
      });
      assert.ok(L.fr[1] <= L.pa[0] + 1, 'frame is left of the panel');
      assert.ok(Math.abs(L.pa[2] - 0.32 * 1280) <= 2, 'panel is clamp(360px, 32vw, 440px) wide: ' + L.pa[2]);
      assert.ok(Math.abs(L.pa[3] - 800) <= 1 && Math.abs(L.fr[3] - 800) <= 1, 'frame and panel fill the height');
      assert.ok(Math.abs(L.nav[1] - 800) <= 1, 'navigation sits at the bottom');
      assert.equal(L.scroll[2], 'auto');
      assert.ok(L.scroll[0] > L.scroll[1], 'panel content scrolls inside the panel');
      assert.ok(L.page[0] <= L.page[2] && L.page[1] <= L.page[3], 'no page scroll: ' + JSON.stringify(L.page));
      assert.match(await page.title(), new RegExp(f.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '.* · YES statement review · InfoSlips$'));
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('infoslips.wt.reviewer') || '{}').lastStep), ids[2], 'lastStep stored');
      assert.equal(await page.locator('.wt-nav__link[data-nav="tour"]').getAttribute('aria-current'), 'page');
      await shot(page, 'tour-desktop-light');
      assertNoErrors(P.errors, assert, P.external);
    } finally {
      await P.close();
    }
  });

  /* ------------------------------------------------------------------ */
  await step('#/tour resumes from lastStep, then the first unanswered feature; unknown ids go to step 1', async () => {
    const P = await openTour({ viewport: DESKTOP, storage: reviewerStorage({ lastStep: ids[4] }) }, '#/tour');
    try {
      await activated(P.page, ids[4]);
      assert.equal(await P.page.evaluate(() => location.hash), '#/tour/' + ids[4]);
      assertNoErrors(P.errors, assert, P.external);
    } finally {
      await P.close();
    }
    const storage = await seedBrowserReviewer(api, { answers: { [ids[0]]: { vote: 'include' }, [ids[1]]: { vote: 'exclude' } } });
    const Q = await openTour({ viewport: DESKTOP, storage }, '#/tour');
    try {
      await activated(Q.page, ids[2]);
      assert.equal(await Q.page.evaluate(() => location.hash), '#/tour/' + ids[2], 'first unanswered');
      await Q.page.evaluate(() => window.WT.go('/tour/no-such-feature'));
      await activated(Q.page, first);
      assert.equal(await Q.page.evaluate(() => location.hash), '#/tour/' + first);
      assertNoErrors(Q.errors, assert, Q.external);
    } finally {
      await Q.close();
    }
  });

  /* ------------------------------------------------------------------ */
  await step('Next, Back and Restart (confirm; answers are kept); Finish on the last step', async () => {
    const P = await openTour({ viewport: DESKTOP }, '#/tour/' + first);
    const { page } = P;
    try {
      await activated(page, first);
      assert.equal(await page.locator('[data-act="prev"]').isDisabled(), true, 'Back is disabled on step 1');
      await page.locator('input[name="tour-vote"][value="include"]').click();
      await page.click('[data-act="next"]');
      await activated(page, ids[1]);
      assert.equal((await focused(page)).id, 'tour-title', 'focus on the step h1 after Next');
      await page.click('[data-act="prev"]');
      await activated(page, first);
      assert.equal((await focused(page)).id, 'tour-title', 'focus on the step h1 after Back');
      assert.ok(await page.locator('input[name="tour-vote"][value="include"]').isChecked(), 'answer shown again');
      await page.click('[data-act="next"]');
      await activated(page, ids[1]);
      await page.click('[data-act="next"]');
      await activated(page, ids[2]);

      // Restart → Cancel keeps the step; Restart → confirm goes to step 1, answers kept
      await page.click('[data-act="restart"]');
      const dlg = page.locator('#wt-confirm');
      await dlg.waitFor({ state: 'visible' });
      assert.match(await dlg.innerText(), /Restart the walkthrough\?/);
      assert.match(await dlg.innerText(), /answers are kept/);
      assert.equal((await focused(page)).text, 'Stay here', 'focus starts on Cancel');
      await page.keyboard.press('Enter');
      await dlg.waitFor({ state: 'hidden' });
      assert.equal(await page.evaluate(() => location.hash), '#/tour/' + ids[2]);
      assert.equal((await focused(page)).label || (await focused(page)).text, 'Restart', 'focus back on Restart');
      await page.click('[data-act="restart"]');
      await dlg.waitFor({ state: 'visible' });
      await dlg.locator('[data-wt-confirm]').click();
      await activated(page, first);
      assert.equal((await focused(page)).id, 'tour-title');
      assert.ok(await page.locator('input[name="tour-vote"][value="include"]').isChecked(), 'answers kept after Restart');
      const secret = await secretOf(page);
      await until(async () => (await serverAnswer(secret, first)) && (await serverAnswer(secret, first)).vote === 'include', 8000, 'saved include');

      // Last step
      const last = ids[N - 1];
      await page.evaluate((i) => window.WT.go('/tour/' + i), last);
      await activated(page, last);
      assert.equal((await page.locator('[data-act="next"]').innerText()).trim(), 'Finish and see results');
      await page.click('[data-act="next"]');
      await page.waitForFunction(() => window.WT.route().view === 'results');
      assert.equal(await page.evaluate(() => location.hash), '#/results');
      assertNoErrors(P.errors, assert, P.external);
    } finally {
      await P.close();
    }
  });

  /* ------------------------------------------------------------------ */
  await step('All steps: every feature with thumbnail, title, section and answered state; choosing one jumps there', async () => {
    const storage = await seedBrowserReviewer(api, {
      answers: { [ids[0]]: { vote: 'include' }, [ids[1]]: { vote: 'exclude', priority: 'low' }, [ids[2]]: { priority: 'high' } }
    });
    const P = await openTour({ viewport: DESKTOP, storage }, '#/tour/' + ids[3]);
    const { page } = P;
    try {
      await activated(page, ids[3]);
      await page.click('[data-act="steps"]');
      const dlg = page.locator('#tour-steps');
      await dlg.waitFor({ state: 'visible' });
      assert.equal((await dlg.locator('.wt-dialog__title').innerText()).trim(), 'All steps');
      const items = await dlg.locator('.wt-steplist__item').evaluateAll((list) =>
        list.map((a) => ({
          id: a.getAttribute('data-goto'),
          href: a.getAttribute('href'),
          img: a.querySelector('img').getAttribute('src'),
          title: a.querySelector('.wt-steplist__title').textContent.replace(/^:\s*/, '').trim(),
          section: a.querySelector('.wt-steplist__section').textContent.replace(/^,\s*/, '').trim(),
          state: a.querySelector('.wt-steplist__state .wt-badge').textContent.trim(),
          current: a.getAttribute('aria-current')
        }))
      );
      assert.equal(items.length, N);
      const labels = await page.evaluate(() => window.WT.SECTIONS);
      items.forEach((it, i) => {
        assert.equal(it.id, ids[i]);
        assert.equal(it.href, '#/tour/' + ids[i]);
        assert.equal(it.img, 'assets/shots/' + ids[i] + '-thumb.jpg');
        assert.equal(it.title, features[i].title);
        assert.equal(it.section, labels[features[i].section]);
        assert.equal(it.current, i === 3 ? 'step' : null);
      });
      assert.equal(items[0].state, 'Include');
      assert.equal(items[1].state, 'Exclude');
      assert.equal(items[2].state, 'Answered');
      assert.equal(items[4].state, 'Not answered');
      assert.equal((await focused(page)).fk, 'steplist-' + ids[3], 'focus starts on the current step');
      const thumbs = await dlg.locator('.wt-steplist__thumb img').evaluateAll((imgs) => imgs.map((i) => i.complete));
      assert.equal(thumbs.length, N);
      await dlg.locator(`[data-goto="${ids[5]}"]`).click();
      await dlg.waitFor({ state: 'hidden' });
      await activated(page, ids[5]);
      assert.equal((await focused(page)).id, 'tour-title', 'focus on the h1 after a jump');
      // Keyboard: open, Escape closes, focus returns to the button
      await page.locator('[data-act="steps"]').focus();
      await page.keyboard.press('Enter');
      await dlg.waitFor({ state: 'visible' });
      await page.keyboard.press('Escape');
      await dlg.waitFor({ state: 'hidden' });
      assert.equal((await focused(page)).text, 'All steps');
      await page.locator('[data-act="steps"]').click();
      await dlg.waitFor({ state: 'visible' });
      await shot(page, 'tour-steplist-desktop');
      await page.keyboard.press('Escape');
      assertNoErrors(P.errors, assert, P.external);
    } finally {
      await P.close();
    }
  });

  /* ------------------------------------------------------------------ */
  await step('browser Back and Forward between steps; the statement never moves the tour (G1, G6)', async () => {
    const P = await openTour({ viewport: DESKTOP }, '#/tour/' + first);
    const { page } = P;
    try {
      await activated(page, first);
      const len0 = await page.evaluate(() => history.length);
      const path = ids.slice(0, 6);
      for (let i = 1; i < path.length; i++) {
        await page.click('[data-act="next"]');
        await activated(page, path[i]);
        assert.equal(await page.evaluate(() => history.length), len0 + i, 'one history entry per step (' + path[i] + ')');
      }
      for (let i = path.length - 2; i >= 0; i--) {
        await page.goBack();
        await activated(page, path[i]);
        assert.equal((await focused(page)).id, 'tour-title', 'h1 after browser Back');
      }
      await page.goForward();
      await activated(page, path[1]);
      await page.goForward();
      await activated(page, path[2]);

      // G1: user-driven "Clear selection" on the journey step, then moving on, never moves the parent
      if (has('journey')) {
        await page.evaluate(() => window.WT.go('/tour/journey'));
        await activated(page, 'journey');
        const len = await page.evaluate(() => history.length);
        const clear = page.frameLocator('#wt-frame').locator('#overview-root [data-ov-clear]');
        if (await clear.count()) {
          await clear.first().click();
          await sleep(600);
          assert.equal(await page.evaluate(() => location.hash), '#/tour/journey', 'Clear selection kept the tour step');
        }
        const next = ids[ids.indexOf('journey') + 1];
        await page.click('[data-act="next"]');
        await activated(page, next);
        await sleep(800);
        assert.equal(await page.evaluate(() => location.hash), '#/tour/' + next, 'resetting the journey did not move the parent');
        assert.ok((await page.evaluate(() => history.length)) <= len + 1);
      }
      // The transaction detail's own close button
      if (has('detail')) {
        await page.evaluate(() => window.WT.go('/tour/detail'));
        await activated(page, 'detail');
        await page.frameLocator('#wt-frame').locator('#tx-dialog [data-txd-close]').click();
        await sleep(700);
        assert.equal(await page.evaluate(() => location.hash), '#/tour/detail', 'closing the detail kept the tour step');
        assert.equal(await page.evaluate(() => document.getElementById('wt-tour-overlay').dataset.state), 'lost', 'target gone');
        await page.click('[data-act="showit"]');
        await activated(page, 'detail');
        assert.equal(await page.evaluate(() => document.getElementById('wt-tour-overlay').dataset.state), 'shown', 'Show it set the step up again');
      }
      assertNoErrors(P.errors, assert, P.external);
    } finally {
      await P.close();
    }
  });

  /* ------------------------------------------------------------------ */
  async function sweep(viewport, label, opts = {}) {
    const list = opts.only || ids;
    const P = await openTour({ viewport, colorScheme: opts.colorScheme, reducedMotion: opts.reducedMotion }, '#/tour/' + list[0]);
    const { page } = P;
    const problems = [];
    try {
      await activated(page, list[0]);
      const len0 = await page.evaluate(() => history.length);
      for (let n = 0; n < list.length; n++) {
        const id = list[n];
        const i = ids.indexOf(id);
        if (n > 0) await page.evaluate((x) => window.WT.go('/tour/' + x), id);
        try {
          await activated(page, id);
        } catch (e) {
          problems.push(`${id}: activation did not finish`);
          continue;
        }
        let g = await page.evaluate(geometry);
        if (g.state === 'shown' && g.ringOpacity < 0.99) {
          await sleep(300);
          g = await page.evaluate(geometry);
        }
        const tol = 3;
        if (!g.found) problems.push(`${id}: target not found in the statement`);
        else if (g.state === 'shown') {
          for (const k of ['l', 't', 'r', 'b']) {
            if (Math.abs(g.ring[k] - g.expected[k]) > tol) problems.push(`${id}: outline ${k} ${g.ring[k].toFixed(1)} ≠ ${g.expected[k].toFixed(1)}`);
            if (Math.abs(g.hole[k] - g.ring[k]) > 1) problems.push(`${id}: cut-out ${k} ${g.hole[k].toFixed(1)} ≠ outline ${g.ring[k].toFixed(1)}`);
          }
          if (g.ring.l < g.frame.l - 0.5 || g.ring.t < g.frame.t - 0.5 || g.ring.r > g.frame.r + 0.5 || g.ring.b > g.frame.b + 0.5) problems.push(`${id}: outline outside the frame`);
          if (g.ringOpacity < 0.99) problems.push(`${id}: outline not visible`);
          if (g.tag !== `${i + 1} · ${features[i].title}`) problems.push(`${id}: tag "${g.tag}"`);
          if (g.edge) problems.push(`${id}: edge indicator shown while the target is visible`);
        } else if (g.state === 'offscreen') {
          if (!g.edge) problems.push(`${id}: off-screen without the indicator`);
        } else problems.push(`${id}: overlay state ${g.state}`);
        // Focus is back on the step heading (the statement pulls it into the frame, G4)
        // (On first load the router leaves focus alone, but it must not be left in the frame.)
        await sleep(450);
        const fo = await focused(page);
        if (n === 0 ? fo.tag === 'iframe' : fo.id !== 'tour-title') problems.push(`${id}: focus on ${fo.tag}#${fo.id}`);
        // No history leaks: the parent stays on the step, one entry per step
        const h = await page.evaluate(() => [location.hash, history.length]);
        if (h[0] !== '#/tour/' + id) problems.push(`${id}: parent moved to ${h[0]}`);
        if (h[1] !== len0 + n) problems.push(`${id}: history.length ${h[1]}, expected ${len0 + n}`);
        if (opts.check) {
          const extra = await opts.check(page, id);
          if (extra) problems.push(`${id}: ${extra}`);
        }
        if (opts.shots && opts.shots.includes(id)) await shot(page, `tour-${label}-${id}`);
      }
      assertNoErrors(P.errors, assert, P.external);
    } finally {
      await P.close();
    }
    if (problems.length) log(label + ': ' + problems.join('\n      '));
    assert.deepEqual(problems, [], label + ' highlight problems');
  }

  await step('every feature at 1280×800: the outline matches the target mapped through the frame, or the edge indicator shows; h1 focus; no history leaks', async () => {
    await sweep(DESKTOP, 'desktop', { shots: ['journey', 'detail', 'inquiry', 'theme'] });
  });

  await step('every feature at 390×844 (phone): outline matches, or the edge indicator shows', async () => {
    await sweep(PHONE, 'phone', { shots: ['summary', 'detail', 'language'] });
  });

  await step('1920×1080 with reduced motion: the docked Ask YES drawer (G7) and its reflow; no glide or pulse', async () => {
    const only = ['summary', 'why', 'explain-ai', 'assistant', 'journey', 'fees'].filter(has);
    await sweep({ width: 1920, height: 1080 }, 'wide', {
      only,
      reducedMotion: 'reduce',
      check: async (page, id) => {
        const r = await page.evaluate(() => ({
          anim: document.getElementById('wt-tour-overlay').hasAttribute('data-anim'),
          pulse: getComputedStyle(document.querySelector('.wt-spot__ring'), '::after').animationName,
          docked: document.getElementById('wt-frame').contentDocument.documentElement.classList.contains('assistant-docked'),
          mode: document.getElementById('wt-frame').contentWindow.YES.assistant.mode()
        }));
        if (r.anim) return 'glide with reduced motion';
        if (r.pulse && r.pulse !== 'none') return 'pulse with reduced motion';
        if (id === 'assistant' && r.mode !== 'docked') return 'drawer is ' + r.mode + ', expected docked';
        if (id === 'summary' && r.docked) return 'drawer still docked';
        return '';
      }
    });
  });

  /* ------------------------------------------------------------------ */
  await step('a target that cannot be found: the panel shows the polite note with Try it; no outline', async () => {
    const id = ids[1];
    const P = await openTour({ viewport: DESKTOP }, '#/tour/' + first);
    const { page } = P;
    try {
      await activated(page, first);
      await page.evaluate((x) => {
        const st = window.WT.steps[x];
        st.target = { desktop: ['#no-such-part'], phone: ['#no-such-part'] };
        window.WT.go('/tour/' + x);
      }, id);
      await activated(page, id, 25000);
      const r = await page.evaluate(() => ({
        state: document.getElementById('wt-tour-overlay').dataset.state,
        note: document.querySelector('[data-tour="note"]').textContent.trim(),
        role: document.querySelector('[data-tour="note"]').getAttribute('role'),
        edge: document.querySelector('.wt-tour__edge').hidden,
        ring: getComputedStyle(document.querySelector('.wt-spot__ring')).opacity
      }));
      assert.equal(r.state, 'failed');
      assert.equal(r.role, 'status');
      assert.match(r.note, /^We couldn’t highlight this part automatically\. Try it: .{20,}/);
      assert.equal(r.edge, true, 'no Show it for a part that was never found');
      assert.equal(r.ring, '0');
      assert.equal((await focused(page)).id, 'tour-title');
      await page.click('[data-act="next"]');
      await activated(page, ids[2]);
      assert.equal(await page.evaluate(() => document.querySelector('[data-tour="note"]').textContent), '', 'the note goes with the step');
      assertNoErrors(P.errors, assert, P.external);
    } finally {
      await P.close();
    }
  });

  /* ------------------------------------------------------------------ */
  await step('answers: vote, reason, priority and comment autosave to the server and persist across reload; Clear my answer', async () => {
    const id = ids[3];
    const P = await openTour({ viewport: DESKTOP }, '#/tour/' + id);
    const { page } = P;
    try {
      await activated(page, id);
      assert.equal((await statusOf(page)).text, 'Your answers save automatically.');
      await page.locator('input[name="tour-vote"][value="include"]').click();
      await page.locator('#tour-reason').fill('Customers ask about this every month.');
      await page.locator('input[name="tour-priority"][value="high"]').click();
      await page.locator('#tour-comment').fill('Ship it in the first release.\nWith Spanish too.');
      assert.equal((await page.locator('#tour-reason-count').innerText()).trim(), '37 / 500');
      await until(async () => (await statusOf(page)).state === 'saved', 8000, 'Saved');
      assert.equal((await statusOf(page)).text, 'Saved');
      const secret = await secretOf(page);
      const a = await until(async () => {
        const s = await serverAnswer(secret, id);
        return s && s.comment === 'Ship it in the first release.\nWith Spanish too.' && s;
      }, 8000, 'server answer');
      assert.equal(a.vote, 'include');
      assert.equal(a.reason, 'Customers ask about this every month.');
      assert.equal(a.priority, 'high');
      assert.ok(await page.locator('[data-act="clear"]').isVisible());

      await page.reload();
      await page.waitForFunction(() => document.documentElement.getAttribute('data-wt-ready') === '1');
      await activated(page, id);
      assert.ok(await page.locator('input[name="tour-vote"][value="include"]').isChecked());
      assert.ok(await page.locator('input[name="tour-priority"][value="high"]').isChecked());
      assert.equal(await page.locator('#tour-reason').inputValue(), 'Customers ask about this every month.');
      assert.equal(await page.locator('#tour-comment').inputValue(), 'Ship it in the first release.\nWith Spanish too.');

      // Change the vote: the server follows
      await page.locator('input[name="tour-vote"][value="exclude"]').click();
      await until(async () => (await serverAnswer(secret, id) || {}).vote === 'exclude', 8000, 'exclude saved');

      await page.click('[data-act="clear"]');
      assert.equal(await page.locator('input[name="tour-vote"]:checked').count(), 0);
      assert.equal(await page.locator('#tour-reason').inputValue(), '');
      assert.equal((await focused(page)).fk, 'tour-vote-include', 'focus moves to the vote after clearing');
      await until(async () => (await serverAnswer(secret, id)) === null, 8000, 'answer cleared on the server');
      assert.ok(await page.locator('[data-act="clear"]').isHidden());
      assertNoErrors(P.errors, assert, P.external);
    } finally {
      await P.close();
    }
  });

  /* ------------------------------------------------------------------ */
  await step('answers: an offline save stays queued and is sent when back online; a server error shows Retry', async () => {
    const id = ids[4];
    const P = await openTour({ viewport: DESKTOP }, '#/tour/' + id);
    const { page, context } = P;
    try {
      await activated(page, id);
      await context.setOffline(true);
      await page.locator('input[name="tour-vote"][value="exclude"]').click();
      await page.locator('#tour-reason').fill('Not needed at launch.');
      await until(async () => (await statusOf(page)).state === 'error', 8000, 'offline error status');
      const s = await statusOf(page);
      assert.equal(s.text, 'Not saved yet — we’ll retry');
      assert.ok(s.retry, 'Retry button shown');
      const queued = await page.evaluate((i) => JSON.parse(localStorage.getItem('infoslips.wt.pending') || 'null'), id);
      assert.ok(queued && queued.answers[id] && queued.answers[id].vote === 'exclude', 'answer queued locally');
      const secret = await secretOf(page);
      assert.equal(await serverAnswer(secret, id), null, 'nothing reached the server');
      await context.setOffline(false);
      await until(async () => (await serverAnswer(secret, id) || {}).reason === 'Not needed at launch.', 15000, 'retried after going online');
      await until(async () => (await statusOf(page)).state === 'saved', 8000, 'Saved after retry');
      assert.ok(!(await statusOf(page)).retry);

      // A server error: Retry sends it
      await page.route('**/api/me', (route) =>
        route.request().method() === 'PUT'
          ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":{"code":"server_error","message":"Try again"}}' })
          : route.fallback()
      );
      await page.locator('input[name="tour-priority"][value="medium"]').click();
      await until(async () => (await statusOf(page)).state === 'error', 8000, 'server error status');
      await page.unroute('**/api/me');
      await page.click('[data-act="retry"]');
      await until(async () => (await serverAnswer(secret, id) || {}).priority === 'medium', 8000, 'Retry saved');
      await until(async () => (await statusOf(page)).state === 'saved', 8000, 'Saved after Retry');
      assertNoErrors(P.errors, assert, P.external);
    } finally {
      await P.close();
    }
  });

  /* ------------------------------------------------------------------ */
  await step('keyboard only: Alt+→ / Alt+← outside text fields, radios, fields, Next, All steps and Restart', async () => {
    const P = await openTour({ viewport: DESKTOP }, '#/tour/' + first);
    const { page } = P;
    try {
      await activated(page, first);
      await page.locator('#tour-title').focus();
      await page.keyboard.press('Alt+ArrowRight');
      await activated(page, ids[1]);
      assert.equal((await focused(page)).id, 'tour-title', 'Alt+→ moves on and focuses the h1');
      await page.keyboard.press('Alt+ArrowLeft');
      await activated(page, first);
      assert.equal((await focused(page)).id, 'tour-title');
      // Tab to the vote, choose with the keyboard
      await until(async () => {
        await page.keyboard.press('Tab');
        return (await focused(page)).fk === 'tour-vote-include';
      }, 8000, 'Tab to Include');
      await page.keyboard.press('Space');
      assert.ok(await page.locator('input[name="tour-vote"][value="include"]').isChecked());
      await page.keyboard.press('ArrowRight');
      assert.ok(await page.locator('input[name="tour-vote"][value="exclude"]').isChecked(), 'arrow keys move within the vote');
      await page.keyboard.press('Tab');
      assert.equal((await focused(page)).id, 'tour-reason');
      await page.keyboard.type('Typed with the keyboard');
      await page.keyboard.press('Alt+ArrowRight');
      await sleep(300);
      assert.equal(await page.evaluate(() => window.WT.route().param), first, 'Alt+→ does nothing while typing');
      await page.keyboard.press('Tab');
      assert.equal((await focused(page)).fk, 'tour-priority-high');
      await page.keyboard.press('Space');
      assert.ok(await page.locator('input[name="tour-priority"][value="high"]').isChecked());
      // On to Next with Tab, activate with Enter
      await until(async () => {
        await page.keyboard.press('Tab');
        return (await focused(page)).text === 'Next';
      }, 8000, 'Tab to Next');
      await page.keyboard.press('Enter');
      await activated(page, ids[1]);
      assert.equal((await focused(page)).id, 'tour-title');
      // All steps by keyboard
      await until(async () => {
        await page.keyboard.press('Tab');
        return (await focused(page)).text === 'All steps';
      }, 8000, 'Tab to All steps');
      await page.keyboard.press('Enter');
      await page.locator('#tour-steps').waitFor({ state: 'visible' });
      await page.keyboard.press('Tab'); // the next step in the list
      assert.equal((await focused(page)).fk, 'steplist-' + ids[2]);
      await page.keyboard.press('Enter');
      await activated(page, ids[2]);
      assert.equal((await focused(page)).id, 'tour-title');
      // Restart by keyboard
      await until(async () => {
        await page.keyboard.press('Tab');
        return (await focused(page)).text === 'Restart';
      }, 8000, 'Tab to Restart');
      await page.keyboard.press('Enter');
      await page.locator('#wt-confirm').waitFor({ state: 'visible' });
      await page.keyboard.press('Tab');
      await page.keyboard.press('Enter');
      await activated(page, first);
      assert.equal((await focused(page)).id, 'tour-title');
      assert.equal(await page.locator('#tour-reason').inputValue(), 'Typed with the keyboard');
      assertNoErrors(P.errors, assert, P.external);
    } finally {
      await P.close();
    }
  });

  /* ------------------------------------------------------------------ */
  await step('focus lands on the step h1 after dialog-based steps reached with real clicks (G4)', async () => {
    const dialogSteps = ['why', 'detail', 'explain-ai', 'inquiry', 'assistant'].filter(has);
    const P = await openTour({ viewport: DESKTOP }, '#/tour/' + first);
    const { page } = P;
    try {
      await activated(page, first);
      for (const id of dialogSteps) {
        const before = ids[ids.indexOf(id) - 1];
        await page.evaluate((x) => window.WT.go('/tour/' + x), before);
        await activated(page, before);
        await page.click('[data-act="next"]');
        await activated(page, id);
        await sleep(600);
        const fo = await focused(page);
        assert.equal(fo.id, 'tour-title', id + ': focus on ' + fo.tag + '#' + fo.id);
        const open = await page.evaluate(() => document.getElementById('wt-frame').contentDocument.querySelectorAll('dialog[open]').length);
        assert.ok(open >= 1, id + ': the statement dialog stays open');
      }
      assertNoErrors(P.errors, assert, P.external);
    } finally {
      await P.close();
    }
  });

  /* ------------------------------------------------------------------ */
  await step('theme: the statement follows the app theme (also on load in dark and after the integrity reload); the Dark mode step shows the other theme', async () => {
    const P = await openTour({ viewport: DESKTOP }, '#/tour/' + first);
    const { page } = P;
    try {
      await activated(page, first);
      assert.equal(await frameTheme(page), 'light');
      await page.click('#wt-theme-toggle');
      await until(async () => (await frameTheme(page)) === 'dark', 4000, 'frame dark');
      await page.click('#wt-theme-toggle');
      await until(async () => (await frameTheme(page)) === 'light', 4000, 'frame light');
      if (has('theme')) {
        await page.evaluate(() => window.WT.go('/tour/theme'));
        await activated(page, 'theme');
        assert.equal(await frameTheme(page), 'dark', 'Dark mode step shows the opposite of the app (light)');
        await page.click('#wt-theme-toggle');
        await until(async () => (await frameTheme(page)) === 'light', 4000, 'still the opposite after the app switched to dark');
        await page.click('[data-act="prev"]');
        await activated(page, ids[ids.indexOf('theme') - 1]);
        assert.equal(await frameTheme(page), 'dark', 'back to the app theme');
      }
      if (has('integrity')) {
        // App dark; the integrity preview reloads the frame, which must come back dark (G12)
        if ((await page.evaluate(() => window.WT.theme.effective())) !== 'dark') await page.click('#wt-theme-toggle');
        await page.evaluate(() => window.WT.go('/tour/integrity'));
        await activated(page, 'integrity');
        const y0 = await page.evaluateHandle(() => document.getElementById('wt-frame').contentWindow.YES);
        await page.evaluate(() => {
          const w = document.getElementById('wt-frame').contentWindow;
          w.location.hash = '#/overview?simulate=mismatch';
        });
        await page.waitForFunction((y) => {
          const w = document.getElementById('wt-frame').contentWindow;
          return w.YES && w.YES !== y && w.YES.ready;
        }, y0, { timeout: 15000 });
        await until(async () => (await frameTheme(page)) === 'dark', 6000, 'dark after the reload');
        assert.equal(await page.evaluate(() => location.hash), '#/tour/integrity', 'the reload did not move the tour');
        await until(async () => (await page.evaluate(() => document.getElementById('wt-tour-overlay').dataset.state)) === 'lost', 6000, 'target lost');
        assert.match(await page.locator('.wt-tour__edge').innerText(), /isn’t on screen/);
        await page.click('[data-act="showit"]');
        await activated(page, 'integrity');
        assert.equal(await page.evaluate(() => document.getElementById('wt-tour-overlay').dataset.state), 'shown');
        assert.equal(await frameTheme(page), 'dark');
        assert.equal(await page.evaluate(() => !!document.getElementById('wt-frame').contentWindow.YES.data.simulated), false, 'left the preview');
      }
      assertNoErrors(P.errors, assert, P.external);
    } finally {
      await P.close();
    }
    const D = await openTour({ viewport: DESKTOP, colorScheme: 'dark' }, '#/tour/' + first);
    try {
      await activated(D.page, first);
      assert.equal(await frameTheme(D.page), 'dark', 'dark on load');
      await shot(D.page, 'tour-desktop-dark');
      assertNoErrors(D.errors, assert, D.external);
    } finally {
      await D.close();
    }
  });

  /* ------------------------------------------------------------------ */
  await step('phone layout: statement on top (~52svh), panel below, Show statement / Show panel; tablet panel 340px; no horizontal scroll', async () => {
    for (const scheme of ['light', 'dark']) {
      const P = await openTour({ viewport: PHONE, colorScheme: scheme }, '#/tour/' + ids[5]);
      const { page } = P;
      try {
        await activated(page, ids[5]);
        const L = await page.evaluate(() => {
          const fr = document.getElementById('wt-frame').getBoundingClientRect();
          const bar = document.querySelector('.wt-tour__bar').getBoundingClientRect();
          const sc = document.querySelector('.wt-tour__scroll').getBoundingClientRect();
          const nav = document.querySelector('.wt-tour__nav').getBoundingClientRect();
          const se = document.scrollingElement;
          return { fr: [fr.top, fr.height, fr.width], bar: [bar.top, bar.bottom], sc: [sc.top, sc.bottom], nav: [nav.top, nav.bottom], page: [se.scrollWidth, se.scrollHeight] };
        });
        assert.ok(Math.abs(L.fr[1] - 0.52 * 844) <= 2, 'frame ~52svh: ' + L.fr[1]);
        assert.equal(L.fr[2], 390);
        assert.ok(L.bar[0] >= L.fr[0] + L.fr[1] - 1 && L.sc[0] >= L.bar[1] - 1, 'bar between frame and panel');
        assert.ok(Math.abs(L.nav[1] - 844) <= 1, 'navigation at the bottom');
        assert.ok(L.page[0] <= 390 && L.page[1] <= 844, 'no page scroll: ' + L.page);
        for (const sel of ['[data-act="steps"]', '[data-act="restart"]', '[data-act="prev"]', '[data-act="next"]']) {
          const b = await page.locator(sel).boundingBox();
          assert.ok(b.width >= 44 && b.height >= 44, sel + ' is a 44px target');
        }
        assert.equal(await page.locator('[data-act="steps"]').innerText(), 'All steps', 'icon button keeps its name');
        await shot(page, 'tour-phone-' + scheme);

        await page.click('[data-pane-btn="statement"]');
        assert.equal(await page.locator('[data-pane-btn="statement"]').getAttribute('aria-pressed'), 'true');
        await sleep(300);
        const S = await page.evaluate(() => ({
          fr: document.getElementById('wt-frame').getBoundingClientRect().height,
          scroll: getComputedStyle(document.querySelector('.wt-tour__scroll')).display,
          nav: document.querySelector('.wt-tour__nav').getBoundingClientRect().height
        }));
        assert.ok(S.fr > 0.52 * 844 + 100, 'statement maximised: ' + S.fr);
        assert.equal(S.scroll, 'none', 'panel text hidden');
        assert.ok(S.nav >= 44, 'navigation still there');
        await page.click('[data-pane-btn="panel"]');
        await sleep(300);
        const Pn = await page.evaluate(() => ({
          pressed: document.querySelector('[data-pane-btn="statement"]').getAttribute('aria-pressed'),
          stage: getComputedStyle(document.querySelector('.wt-tour__stage')).visibility,
          inert: document.querySelector('.wt-tour__stage').inert,
          sc: document.querySelector('.wt-tour__scroll').getBoundingClientRect().height
        }));
        assert.equal(Pn.pressed, 'false');
        assert.equal(Pn.stage, 'hidden');
        assert.equal(Pn.inert, true);
        assert.ok(Pn.sc > 500, 'panel maximised: ' + Pn.sc);
        await page.click('[data-pane-btn="panel"]');
        assert.equal(await page.evaluate(() => document.querySelector('.wt-tour').getAttribute('data-pane')), 'split');
        assertNoErrors(P.errors, assert, P.external);
      } finally {
        await P.close();
      }
    }
    const N2 = await openTour({ viewport: { width: 320, height: 640, isMobile: true, hasTouch: true } }, '#/tour/' + first);
    try {
      await activated(N2.page, first);
      const w = await N2.page.evaluate(() => document.scrollingElement.scrollWidth);
      assert.ok(w <= 320, 'no horizontal scroll at 320px: ' + w);
      assertNoErrors(N2.errors, assert, N2.external);
    } finally {
      await N2.close();
    }
    const T = await openTour({ viewport: TABLET }, '#/tour/' + first);
    try {
      await activated(T.page, first);
      const pw = await T.page.evaluate(() => document.querySelector('.wt-tour__panel').getBoundingClientRect().width);
      assert.ok(Math.abs(pw - 340) <= 1, 'tablet panel is 340px: ' + pw);
      assert.equal(await T.page.evaluate(() => window.WT.driver.isPhone(document.getElementById('wt-frame').contentWindow)), true, 'mid-width frame uses the phone layout (G9)');
      assertNoErrors(T.errors, assert, T.external);
    } finally {
      await T.close();
    }
  });

  /* ------------------------------------------------------------------ */
  await step('Dim the rest, clicks through the overlay, the off-screen indicator and Show it', async () => {
    const P = await openTour({ viewport: DESKTOP }, '#/tour/' + first);
    const { page } = P;
    try {
      await activated(page, first);
      const dim = page.locator('#tour-dim');
      assert.equal(await dim.getAttribute('role'), 'switch');
      assert.ok(await dim.isChecked(), 'Dim the rest is on by default');
      const op = () => page.evaluate(() => [getComputedStyle(document.querySelector('.wt-spot')).opacity, getComputedStyle(document.querySelector('.wt-spot__ring')).opacity]);
      await until(async () => (await op())[0] === '1', 3000, 'dim shown');
      await dim.click();
      await until(async () => (await op())[0] === '0', 3000, 'dim off');
      assert.equal((await op())[1], '1', 'outline stays');
      assert.equal(await page.evaluate(() => localStorage.getItem('infoslips.wt.tour.dim')), '0');
      await dim.click();
      // The overlay never takes clicks: the statement gets them
      const hit = await page.evaluate(() => {
        const r = document.querySelector('.wt-spot__ring').getBoundingClientRect();
        const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        const out = document.elementFromPoint(r.left + 4, r.bottom + 40);
        return [el && el.id, out && out.id];
      });
      assert.deepEqual(hit, ['wt-frame', 'wt-frame']);
      // Scroll the statement away: the indicator offers Show it
      await page.evaluate(() => document.getElementById('wt-frame').contentWindow.scrollTo(0, 4000));
      await until(async () => (await page.evaluate(() => document.getElementById('wt-tour-overlay').dataset.state)) === 'offscreen', 4000, 'offscreen');
      const edge = page.locator('.wt-tour__edge');
      assert.ok(await edge.isVisible());
      assert.match(await edge.innerText(), /Highlighted part is above/);
      assert.equal(await edge.getAttribute('aria-hidden'), null, 'the indicator is not inside the aria-hidden overlay');
      await page.click('[data-act="showit"]');
      await until(async () => (await page.evaluate(() => document.getElementById('wt-tour-overlay').dataset.state)) === 'shown', 4000, 'shown again');
      await until(async () => await edge.isHidden(), 3000, 'indicator gone');
      // Navigating inside the statement (a real click through the overlay) loses the target; Show it sets the step up again
      await page.frameLocator('#wt-frame').locator('#masthead [data-nav="help"]').first().click();
      await until(async () => (await page.evaluate(() => document.getElementById('wt-tour-overlay').dataset.state)) === 'lost', 4000, 'lost');
      assert.equal(await page.evaluate(() => location.hash), '#/tour/' + first);
      await page.click('[data-act="showit"]');
      await activated(page, first);
      assert.equal(await page.evaluate(() => document.getElementById('wt-tour-overlay').dataset.state), 'shown');
      assertNoErrors(P.errors, assert, P.external);
    } finally {
      await P.close();
    }
  });

  /* ------------------------------------------------------------------ */
  await step('resizing across the statement’s phone breakpoint sets the step up again and the outline follows', async () => {
    const id = has('language') ? 'language' : ids[0];
    const P = await openTour({ viewport: DESKTOP }, '#/tour/' + id);
    const { page } = P;
    try {
      await activated(page, id);
      const check = async () => {
        const g = await page.evaluate(geometry);
        if (g.state !== 'shown' || !g.expected) return false;
        return ['l', 't', 'r', 'b'].every((k) => Math.abs(g.ring[k] - g.expected[k]) <= 3);
      };
      assert.ok(await check(), 'desktop outline');
      await page.setViewportSize({ width: 600, height: 900 });
      await until(async () => (await page.evaluate(() => window.WT.driver.isPhone(document.getElementById('wt-frame').contentWindow))) && (await check()), 15000, 'phone outline');
      await page.waitForFunction((i) => document.querySelector('.wt-tour').getAttribute('data-activated') === i, id, { timeout: 15000 });
      await until(check, 6000, 'phone outline after re-activation');
      await page.setViewportSize({ width: 1280, height: 800 });
      await until(async () => !(await page.evaluate(() => window.WT.driver.isPhone(document.getElementById('wt-frame').contentWindow))) && (await check()), 15000, 'desktop outline again');
      assertNoErrors(P.errors, assert, P.external);
    } finally {
      await P.close();
    }
  });

  /* ------------------------------------------------------------------ */
  await step('View data requirements: the JSON explorer for this feature, or the list of field paths', async () => {
    const id = ids[2];
    const P = await openTour({ viewport: DESKTOP }, '#/tour/' + id);
    const { page } = P;
    try {
      await activated(page, id);
      await page.click('[data-act="datareq"]');
      const dlg = page.locator('#tour-datareq');
      await dlg.waitFor({ state: 'visible' });
      assert.equal((await dlg.locator('.wt-dialog__title').innerText()).trim(), 'Data requirements: ' + features[2].title);
      assert.equal(await dlg.locator('[data-tour="dr-link"]').getAttribute('href'), '#/data/' + id);
      const info = await page.evaluate((fid) => ({
        json: !!(window.WT.json && window.WT.json.mount),
        paths: (window.WT.dataReq[fid].fields || []).map((f) => f.path),
        text: document.getElementById('tour-datareq').innerText
      }), id);
      assert.ok(info.paths.length > 0);
      if (info.json) {
        assert.ok((await dlg.locator('.wt-tour__dr').innerHTML()).length > 50, 'explorer mounted');
      } else {
        for (const p of info.paths) assert.ok(info.text.includes(p), 'lists ' + p);
      }
      await sleep(400);
      await shot(page, 'tour-datareq-desktop');
      await page.keyboard.press('Escape');
      await dlg.waitFor({ state: 'hidden' });
      assert.equal((await focused(page)).text, 'View data requirements', 'focus returns to the button');
      // Without the explorer, the dialog lists the field paths
      await page.evaluate(() => {
        window.__json = window.WT.json;
        delete window.WT.json;
      });
      await page.click('[data-act="datareq"]');
      await dlg.waitFor({ state: 'visible' });
      const text = await dlg.innerText();
      assert.match(text, /The interactive explorer isn’t available right now/);
      for (const p of info.paths) assert.ok(text.includes(p), 'fallback lists ' + p);
      await page.keyboard.press('Escape');
      await page.evaluate(() => {
        window.WT.json = window.__json;
      });
      await dlg.waitFor({ state: 'hidden' });
      assertNoErrors(P.errors, assert, P.external);
    } finally {
      await P.close();
    }
  });

  /* ------------------------------------------------------------------ */
  await step('accessibility: axe on the tour panel and dialogs (desktop and phone)', async () => {
    for (const viewport of [DESKTOP, PHONE]) {
      const P = await openTour({ viewport }, '#/tour/' + ids[1]);
      const { page } = P;
      try {
        await activated(page, ids[1]);
        let v = await axe(page, { include: '#view-tour', exclude: ['#wt-frame'] });
        assert.deepEqual(v, [], formatViolations(v));
        await page.click('[data-act="steps"]');
        await page.locator('#tour-steps').waitFor({ state: 'visible' });
        v = await axe(page, { include: '#tour-steps' });
        assert.deepEqual(v, [], formatViolations(v));
        await page.keyboard.press('Escape');
      } finally {
        await P.close();
      }
    }
  });
}
