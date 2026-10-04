/*
 * 30-steps.test.mjs — the tour steps and the statement driver (SPEC sections 6
 * and 10). Owner: steps.
 *
 *   node tests/run.mjs --only 30-steps
 *
 * 1. Content: every feature in shared/features.json has a complete step
 *    (what in 2–3 sentences, 3–4 bullets of value for YES and for customers,
 *    a "Try it", a setup and desktop and phone targets), and nothing else.
 * 2. In the statement page itself (driver + steps injected, standalone: only
 *    window.WT), at 880×900 and 390×844, in light and dark: for every feature
 *    reset → clean, apply → no errors, target → found, scrollToTarget → a
 *    visible, unobscured element inside the viewport. One pass runs Next order,
 *    one Back order, one a shuffled jump order. Afterwards: no open dialog or
 *    drawer, the baseline language and theme, and no new history entries.
 * 3. In a same-origin iframe (closer to production), at the real tour frame
 *    sizes (870×836 and 390×440): the parent pushes #/tour/<id> per step, the
 *    statement never moves the parent's address or scroll, and history grows
 *    only by the parent's own pushes. Plus: the integrity preview reload,
 *    baseline language tracking, aborting a running apply, and print refusal.
 * 4. The built app bundle carries WT.driver and WT.steps for every feature.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { openPage, gotoApp } from './helpers.mjs';

export const meta = { timeout: 600000 };

const ACTIONS = ['route', 'call', 'click', 'wait', 'scroll', 'theme', 'lang', 'menu', 'delay'];

function sentences(text) {
  return String(text)
    .split(/(?<=[.!?])\s+(?=[“"‘(A-Z0-9])/)
    .filter((s) => s.trim()).length;
}

/** Load 31-steps.js in Node with a minimal window, as the bundle would. */
function loadSteps(root, features) {
  const window = { WT: { features } };
  vm.runInNewContext(readFileSync(join(root, 'src', 'js', '31-steps.js'), 'utf8'), { window });
  return window.WT;
}

/** Runs inside the page: one tour step, as the tour does it. */
async function runStep({ id, behavior, pushTour }) {
  const win = window.__frameWin ? window.__frameWin() : window;
  if (pushTour) history.pushState(null, '', '#/tour/' + id);
  const step = WT.steps[id];
  const before = await WT.driver.reset(win);
  const applied = await WT.driver.apply(win, step);
  const out = { id, before, applied, lang: win.YES.i18n.lang, theme: win.YES.theme.effective(), phone: WT.driver.isPhone(win) };
  const el = await WT.driver.target(win, step);
  if (!el) {
    out.found = false;
    out.selectors = WT.driver.selectors(win, step);
    return out;
  }
  out.found = true;
  out.matched = WT.driver.selectors(win, step).find((s) => [...win.document.querySelectorAll(s)].includes(el));
  await WT.driver.scrollToTarget(win, el, { behavior });
  const r = el.getBoundingClientRect();
  const de = win.document.documentElement;
  const vw = de.clientWidth;
  const vh = de.clientHeight;
  const x = Math.min(vw - 2, Math.max(1, r.left + Math.min(r.width, vw) / 2));
  const y = Math.min(vh - 2, Math.max(1, (Math.max(r.top, 0) + Math.min(r.bottom, vh)) / 2));
  const hit = win.document.elementFromPoint(x, y);
  out.hit = !!hit && (hit === el || el.contains(hit));
  out.hitDesc = hit ? hit.tagName.toLowerCase() + (hit.id ? '#' + hit.id : '') + (hit.className && typeof hit.className === 'string' ? '.' + hit.className.split(' ')[0] : '') : null;
  out.rect = { top: Math.round(r.top), left: Math.round(r.left), width: Math.round(r.width), height: Math.round(r.height), bottom: Math.round(r.bottom), right: Math.round(r.right) };
  out.vw = vw;
  out.vh = vh;
  out.inset = WT.driver.topInset(win);
  out.parentHash = location.hash;
  out.parentScroll = window.__frameWin ? window.scrollY : 0;
  return out;
}

function checkStep(assert, r, label) {
  const where = `${label} ${r.id}`;
  assert.deepEqual(r.before.problems || [], [], `${where}: reset left problems`);
  assert.ok(r.applied.ok, `${where}: apply failed: ${JSON.stringify(r.applied.errors)}`);
  assert.ok(r.found, `${where}: no visible target among ${JSON.stringify(r.selectors)}`);
  const { rect, vw, vh, inset } = r;
  assert.ok(rect.width > 0 && rect.height > 0, `${where}: empty rect ${JSON.stringify(rect)}`);
  assert.ok(rect.left >= -1 && rect.right <= vw + 1, `${where}: outside horizontally ${JSON.stringify(rect)} vw=${vw}`);
  assert.ok(rect.top >= -1 && rect.top < vh - 16, `${where}: top not in view ${JSON.stringify(rect)} vh=${vh}`);
  if (rect.height <= vh - inset - 24) assert.ok(rect.bottom <= vh + 1, `${where}: fits but is cut off ${JSON.stringify(rect)} vh=${vh}`);
  assert.ok(r.hit, `${where}: target covered by ${r.hitDesc} at its centre`);
  if (r.id === 'language') assert.equal(r.lang, 'es', `${where}: language not switched`);
}

function shuffled(list, seed) {
  const a = list.slice();
  let s = seed;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) % 2147483648;
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default async function (ctx) {
  const { base, assert, log, root, features } = ctx;
  // WT_STEPS_ONLY=iframe (any substring of a step label) runs a subset while developing.
  const only = process.env.WT_STEPS_ONLY;
  const step = (label, fn) => (!only || label.includes(only) ? ctx.step(label, fn) : Promise.resolve(true));
  const ids = features.map((f) => f.id);
  const driverSrc = readFileSync(join(root, 'src', 'js', '30-driver.js'), 'utf8');
  const stepsSrc = readFileSync(join(root, 'src', 'js', '31-steps.js'), 'utf8');
  const inject = `window.WT = window.WT || {}; WT.features = ${JSON.stringify(features)};\n${driverSrc}\n;\n${stepsSrc}\n;`;

  /* ---------------- 1. Content ---------------- */
  await step('every feature has a complete step', async () => {
    const WT = loadSteps(root, features);
    assert.deepEqual(Object.keys(WT.steps).sort(), ids.slice().sort(), 'steps and features.json ids differ');
    assert.deepEqual(WT.stepIds, ids, 'WT.stepIds is not the features.json order');
    for (const id of ids) {
      const s = WT.steps[id];
      assert.equal(s.id, id);
      for (const k of ['what', 'tryIt']) {
        assert.ok(typeof s[k] === 'string' && s[k].trim().length > 40, `${id}.${k} is missing or too short`);
        assert.ok(!/<[a-z]|\*\*|\s{2,}/i.test(s[k]), `${id}.${k} has markup or double spaces`);
      }
      const n = sentences(s.what);
      assert.ok(n >= 2 && n <= 3, `${id}.what has ${n} sentences (2–3 wanted)`);
      for (const k of ['valueYes', 'valueCustomer']) {
        assert.ok(Array.isArray(s[k]) && s[k].length >= 3 && s[k].length <= 4, `${id}.${k} needs 3–4 bullets, has ${s[k] && s[k].length}`);
        for (const b of s[k]) assert.ok(typeof b === 'string' && b.trim().length > 10 && /[.!?]$/.test(b.trim()), `${id}.${k} bullet: ${JSON.stringify(b)}`);
      }
      assert.ok(Array.isArray(s.setup) && s.setup.length > 0, `${id}.setup is empty`);
      for (const a of s.setup) assert.ok(a && ACTIONS.some((k) => k in a), `${id}.setup has an unknown action ${JSON.stringify(a)}`);
      const menuAt = s.setup.findIndex((a) => 'menu' in a);
      assert.ok(menuAt === -1 || menuAt === s.setup.length - 1, `${id}: {menu} must be the last action`);
      for (const k of ['desktop', 'phone']) {
        assert.ok(Array.isArray(s.target[k]) && s.target[k].length > 0 && s.target[k].every((x) => typeof x === 'string' && x), `${id}.target.${k}`);
      }
      if (s.shot !== undefined) assert.equal(typeof s.shot, 'object', `${id}.shot`);
    }
    log(`${ids.length} steps complete`);
  });

  /* ---------------- 2. In the statement page ---------------- */
  const sizes = { '880x900': { width: 880, height: 900 }, '390x844': { width: 390, height: 844 }, '1480x836': { width: 1480, height: 836 } };
  const passes = [
    { size: '880x900', scheme: 'light', order: 'next' },
    { size: '880x900', scheme: 'dark', order: 'back' },
    { size: '390x844', scheme: 'light', order: 'jump' },
    { size: '390x844', scheme: 'dark', order: 'next' },
    { size: '1480x836', scheme: 'light', order: 'next' } // the frame on a wide screen: Ask YES docks beside the page
  ];
  for (const p of passes) {
    await step(`statement page ${p.size} ${p.scheme}: all ${ids.length} steps (${p.order} order)`, async () => {
      const { page, errors, close } = await openPage(ctx, { viewport: sizes[p.size], colorScheme: p.scheme });
      try {
        await page.goto(base + '/statement/index.html#/overview');
        await page.waitForFunction(() => window.YES && window.YES.ready === true, null, { timeout: 15000 });
        await page.addScriptTag({ content: inject });
        await page.evaluate((theme) => WT.driver.baseline({ theme, lang: 'en' }), p.scheme);
        const h0 = await page.evaluate(() => history.length);
        const order = p.order === 'back' ? ids.slice().reverse() : p.order === 'jump' ? shuffled(ids, 7) : ids;
        const sizesSeen = [];
        for (const id of order) {
          const r = await page.evaluate(runStep, { id, behavior: 'instant', pushTour: false });
          checkStep(assert, r, `${p.size} ${p.scheme}`);
          if (id === 'theme') assert.notEqual(r.theme, p.scheme, `theme step did not switch to the opposite theme`);
          sizesSeen.push(`${id} ${r.rect.width}×${r.rect.height}`);
        }
        // Idempotent: the same step applied twice without a reset still resolves.
        const twice = await page.evaluate(async () => {
          await WT.driver.apply(window, WT.steps.basics);
          const a = await WT.driver.apply(window, WT.steps.basics);
          const el = await WT.driver.target(window, WT.steps.basics);
          return { ok: a.ok, found: !!el, expanded: YES.state.understand.expanded };
        });
        assert.ok(twice.ok && twice.found && twice.expanded.includes('token_units'), 'basics applied twice: ' + JSON.stringify(twice));
        const end = await page.evaluate(async () => {
          const r = await WT.driver.reset(window);
          return {
            r,
            dialogs: [...document.querySelectorAll('dialog[open]')].map((d) => d.id),
            lang: YES.i18n.lang,
            theme: YES.theme.effective(),
            hist: history.length,
            drawer: YES.assistant.isOpen(),
            menu: document.querySelector('#masthead [data-mast-menu]').getAttribute('aria-expanded')
          };
        });
        assert.deepEqual(end.r.problems, [], 'final reset problems');
        assert.deepEqual(end.dialogs, [], 'dialogs left open');
        assert.equal(end.drawer, false, 'Ask YES left open');
        assert.notEqual(end.menu, 'true', 'phone Menu left open');
        assert.equal(end.lang, 'en', 'language not restored');
        assert.equal(end.theme, p.scheme, 'theme not restored');
        assert.equal(end.hist, h0, `history grew by ${end.hist - h0} entries`);
        assert.deepEqual(errors, [], 'console errors: ' + errors.join('\n'));
        log(`${p.size} ${p.scheme}: ${sizesSeen.join(', ')}`);
      } finally {
        await close();
      }
    });
  }

  /* ---------------- 3. In a same-origin iframe ---------------- */
  const frames = [
    { name: 'desktop 1280 (frame 870×836)', viewport: { width: 1280, height: 900 }, frame: [870, 836], scheme: 'light', behavior: undefined },
    { name: 'phone 390 (frame 390×440)', viewport: { width: 390, height: 844 }, frame: [390, 440], scheme: 'dark', behavior: undefined, reducedMotion: 'reduce' }
  ];
  for (const f of frames) {
    await step(`iframe ${f.name} ${f.scheme}${f.reducedMotion ? ' reduced motion' : ''}: all steps, parent address and scroll never move`, async () => {
      const { page, errors, close } = await openPage(ctx, { viewport: f.viewport, colorScheme: f.scheme, reducedMotion: f.reducedMotion });
      try {
        const hostUrl = base + '/__steps-host.html';
        const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>steps host</title>
<style>body{margin:0;background:#fff}header{height:56px;background:#0F172A}iframe{display:block;border:0;width:${f.frame[0]}px;height:${f.frame[1]}px}.tail{height:1600px}</style></head>
<body><header></header><iframe id="wt-frame" src="statement/index.html#/overview" title="YES statement (interactive demo)"></iframe><div class="tail"></div>
<script>${inject.replace(/<\/script/gi, '<\\/script')}
window.__frameWin = function () { return document.getElementById('wt-frame').contentWindow; };</script></body></html>`;
        await page.route(hostUrl, (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }));
        await page.goto(hostUrl + '#/tour');
        await page.waitForFunction(() => {
          const w = window.__frameWin && window.__frameWin();
          return w && w.YES && w.YES.ready === true;
        }, null, { timeout: 15000 });
        await page.evaluate((theme) => WT.driver.baseline({ theme, lang: 'en' }), f.scheme);
        const h0 = await page.evaluate(() => history.length);
        let pushes = 0;
        for (const id of ids) {
          const r = await page.evaluate(runStep, { id, behavior: f.behavior, pushTour: true });
          pushes++;
          checkStep(assert, r, `iframe ${f.frame.join('×')}`);
          await page.waitForTimeout(150); // any late statement history call would land here
          const after = await page.evaluate(() => ({ hash: location.hash, scroll: window.scrollY }));
          assert.equal(after.hash, '#/tour/' + id, `${id}: the statement moved the parent's address`);
          assert.equal(r.parentScroll, 0, `${id}: the parent page scrolled`);
          assert.equal(after.scroll, 0, `${id}: the parent page scrolled`);
        }

        // Integrity preview: the frame reloads in, and out on reset (G3, G12).
        const wh = await page.evaluate(async () => {
          history.pushState(null, '', '#/tour/integrity');
          const win = __frameWin();
          await WT.driver.reset(win);
          const ap = await WT.driver.apply(win, [{ route: '#/overview?simulate=mismatch' }, { wait: '#withheld-title' }]);
          const el = await WT.driver.target(win, { target: { desktop: ['#integrity-root .withheld'], phone: ['#integrity-root .withheld'] } });
          const r = await WT.driver.reset(win);
          return { ap, found: !!el, r, withheld: win.document.documentElement.classList.contains('is-withheld'), ready: win.YES.ready, parent: location.hash };
        });
        pushes++;
        assert.ok(wh.ap.ok && wh.found, 'withheld preview not shown: ' + JSON.stringify(wh.ap));
        assert.deepEqual(wh.r.problems, [], 'reset after the preview');
        assert.ok(!wh.withheld && wh.ready, 'still withheld after reset');
        assert.equal(wh.parent, '#/tour/integrity', 'preview moved the parent address');

        // Baseline language: the visitor's own choice is kept, a step's is not.
        const lang = await page.evaluate(async () => {
          const win = __frameWin();
          const out = {};
          await WT.driver.reset(win);
          await WT.driver.apply(win, WT.steps.summary);
          win.YES.setLang('es'); // the visitor switches during a step that did not set a language
          out.afterVisitor = (await WT.driver.reset(win)).problems.length === 0 && win.YES.i18n.lang;
          await WT.driver.apply(win, WT.steps.language);
          // A step's language is marked in sessionStorage, so a reload on this step can't become the baseline.
          out.marked = sessionStorage.getItem('infoslips.wt.stepLang');
          win.YES.setLang('en'); // explored during the language step: not the visitor's baseline
          await WT.driver.reset(win);
          out.afterLanguageStep = win.YES.i18n.lang;
          out.cleared = sessionStorage.getItem('infoslips.wt.stepLang');
          win.YES.setLang('en'); // the visitor goes back to English between steps
          await WT.driver.reset(win);
          out.final = win.YES.i18n.lang;
          out.baseline = WT.driver.baseline().lang;
          return out;
        });
        assert.deepEqual(lang, { afterVisitor: 'es', marked: '1', afterLanguageStep: 'es', cleared: null, final: 'en', baseline: 'en' }, 'baseline language tracking');

        // A newer reset aborts a running apply; never trigger print.
        const misc = await page.evaluate(async () => {
          const win = __frameWin();
          const pending = WT.driver.apply(win, WT.steps.journey);
          const r = await WT.driver.reset(win);
          const a = await pending;
          let printed = 0;
          win.print = () => printed++;
          await WT.driver.apply(win, WT.steps.download);
          const p = await WT.driver.apply(win, [{ click: '#help-root [data-help-print]' }]);
          // reset({ top: false }) keeps the reader's place, so the next scroll can glide from it.
          await WT.driver.apply(win, WT.steps.fees);
          await WT.driver.scrollToTarget(win, await WT.driver.target(win, WT.steps.fees), { behavior: 'instant' });
          const y0 = win.scrollY;
          const kept = await WT.driver.reset(win, { top: false });
          const keptY = win.scrollY;
          const end = await WT.driver.reset(win);
          return { aborted: !!a.aborted, resetOk: r.ok, step: win.YES.state.journeyStep, printed, refused: p.errors.join(' '), end: end.problems, parent: location.hash, y0, keptY, kept: kept.problems, topY: win.scrollY };
        });
        assert.ok(misc.y0 > 0 && misc.keptY === misc.y0 && misc.topY === 0, 'reset({ top: false }) scroll: ' + JSON.stringify(misc));
        assert.deepEqual(misc.kept, [], 'reset({ top: false }) problems');
        assert.ok(misc.aborted && misc.resetOk && !misc.step, 'abort: ' + JSON.stringify(misc));
        assert.equal(misc.printed, 0, 'print was triggered');
        assert.match(misc.refused, /refusing/, 'print click not refused');
        assert.deepEqual(misc.end, [], 'final reset problems');

        const hist = await page.evaluate(() => history.length);
        assert.equal(hist - h0, pushes, `history grew by ${hist - h0}, the parent pushed ${pushes}`);
        assert.deepEqual(errors, [], 'console errors: ' + errors.join('\n'));
      } finally {
        await close();
      }
    });
  }

  /* ---------------- 4. The built app ---------------- */
  await step('the built app carries WT.driver and WT.steps', async () => {
    const bundle = readdirSync(ctx.out).find((n) => /^app\.[\w-]+\.js$/.test(n));
    assert.ok(bundle, 'no app.<hash>.js in the build');
    const { page, errors, close } = await openPage(ctx, { viewport: 'desktop' });
    try {
      await gotoApp(page, base, '#/start');
      const r = await page.evaluate(() => ({
        driver: ['reset', 'apply', 'target', 'isPhone', 'baseline', 'settle', 'scrollToTarget'].filter((k) => typeof (WT.driver || {})[k] !== 'function'),
        missing: WT.features.map((f) => f.id).filter((id) => !(WT.steps || {})[id])
      }));
      assert.deepEqual(r.driver, [], 'WT.driver is missing methods');
      assert.deepEqual(r.missing, [], 'WT.steps is missing features');
      assert.deepEqual(errors, [], 'console errors: ' + errors.join('\n'));
    } finally {
      await close();
    }
  });
}
