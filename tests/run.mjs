#!/usr/bin/env node
/*
 * Minimal browser test runner for the single-file statement.
 *
 *   node tests/run.mjs                 run every tests/*.test.mjs
 *   node tests/run.mjs --only explorer run test files whose name contains "explorer"
 *   node tests/run.mjs --file dist/other.html
 *
 * Every page runs OFFLINE: all non-file:// requests are aborted and recorded.
 * The only external request the statement may attempt is the UserWay widget.
 * Console errors and uncaught exceptions fail the test.
 *
 * Test file shape:
 *   export const meta = { name: 'smoke', viewports: ['desktop', 'mobile'], hash: '#/overview' };
 *   export default async function (t) { await t.page.click(...); t.assert(cond, 'message'); }
 *
 * t: { page, viewport, assert(cond,msg), eq(a,b,msg), shot(name), axe(selector?), step(name), goto(hash), external }
 * t.axe() waits for running animations to finish and scans with the sticky
 * masthead unpinned (see below), so results depend neither on the scroll
 * position nor on the frame at the moment of the scan.
 */
import { chromium } from 'playwright';
import { readdirSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? null : args[i + 1];
};
const only = opt('--only');
const FILE = resolve(ROOT, opt('--file') || 'dist/yes-statement.html');
const URL_BASE = pathToFileURL(FILE).href;
const SHOTS = join(ROOT, 'test-results', 'screens');
mkdirSync(SHOTS, { recursive: true });

const require = createRequire(import.meta.url);
const AXE_SRC = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

export const VIEWPORTS = {
  desktop: { width: 1280, height: 900 },
  mobile: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  narrow: { width: 320, height: 640, isMobile: true, hasTouch: true }
};

const ALLOWED_CONSOLE = [/userway/i, /net::ERR_/i, /Failed to load resource/i];

const files = readdirSync(join(ROOT, 'tests'))
  .filter((f) => f.endsWith('.test.mjs'))
  .filter((f) => !only || f.includes(only))
  .sort();

const browser = await chromium.launch();
let failures = 0;
let passes = 0;
const started = Date.now();

for (const f of files) {
  const mod = await import(pathToFileURL(join(ROOT, 'tests', f)).href);
  const meta = mod.meta || {};
  const name = meta.name || f.replace('.test.mjs', '');
  for (const vpName of meta.viewports || ['desktop']) {
    const vp = VIEWPORTS[vpName];
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      isMobile: !!vp.isMobile,
      hasTouch: !!vp.hasTouch,
      deviceScaleFactor: vp.deviceScaleFactor || 1,
      reducedMotion: meta.reducedMotion ? 'reduce' : 'no-preference',
      colorScheme: meta.colorScheme || 'light',
      locale: meta.locale || 'en-US',
      timezoneId: meta.timezoneId || 'America/Los_Angeles',
      acceptDownloads: true
    });
    const external = [];
    await context.route('**/*', (route) => {
      const url = route.request().url();
      if (url.startsWith('file:') || url.startsWith('data:') || url.startsWith('blob:')) return route.continue();
      external.push(url);
      return route.abort('internetdisconnected');
    });
    const page = await context.newPage();
    const errors = [];
    page.on('console', (m) => {
      if (m.type() === 'error' && !ALLOWED_CONSOLE.some((r) => r.test(m.text()))) errors.push('console: ' + m.text());
    });
    page.on('pageerror', (e) => errors.push('pageerror: ' + (e.stack || e.message)));

    const failed = [];
    let currentStep = '';
    const t = {
      page,
      viewport: vpName,
      external,
      step: (s) => {
        currentStep = s;
      },
      assert: (cond, msg) => {
        if (!cond) failed.push((currentStep ? `[${currentStep}] ` : '') + msg);
      },
      eq: (a, b, msg) => {
        if (JSON.stringify(a) !== JSON.stringify(b)) failed.push((currentStep ? `[${currentStep}] ` : '') + `${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
      },
      shot: async (label, opts = {}) => {
        await page.screenshot({ path: join(SHOTS, `${name}-${vpName}-${label}.png`), fullPage: !!opts.fullPage });
      },
      axe: async (include) => {
        await page.addScriptTag({ content: AXE_SRC });
        return page.evaluate(async (inc) => {
          // Scan the settled page, not a frame in the middle of a transition: a
          // fading-in panel would report blended (too light) text colours.
          const finite = document.getAnimations().filter((a) => {
            const timing = a.effect && a.effect.getComputedTiming();
            return timing && Number.isFinite(timing.endTime) && a.playState === 'running';
          });
          await Promise.race([Promise.all(finite.map((a) => a.finished.catch(() => null))), new Promise((r) => setTimeout(r, 2000))]);
          // The sticky masthead paints over whatever happens to be scrolled beneath
          // it, and axe's target-size rule counts its overlapping links as
          // obscuring the content underneath — a result that depends only on the
          // scroll position at scan time. Unpin it for the scan: a sticky box keeps
          // its place in the flow, so nothing else moves.
          const mast = document.getElementById('masthead');
          if (mast) mast.style.setProperty('position', 'static', 'important');
          try {
            const r = await window.axe.run(inc ? { include: [inc] } : document, {
              runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] }
            });
            return r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 5).map((n) => n.target.join(' ') + ' :: ' + n.failureSummary) }));
          } finally {
            if (mast) mast.style.removeProperty('position');
          }
        }, include || null);
      },
      goto: async (hash = '') => {
        try {
          await page.goto(URL_BASE + hash);
        } catch (e) {
          // The statement may rewrite its own address while it boots (e.g. a link
          // to an unknown transaction drops the id), which Playwright can report
          // as an interrupted navigation. The document still loads: wait for boot.
          if (!/interrupted by another navigation/i.test(String((e && e.message) || ''))) throw e;
        }
        await page.waitForFunction(() => window.YES && window.YES.ready === true, null, { timeout: 10000 });
      }
    };

    const t0 = Date.now();
    try {
      await t.goto(meta.hash || '');
      await mod.default(t);
    } catch (e) {
      failed.push((currentStep ? `[${currentStep}] ` : '') + 'threw: ' + (e.stack || e.message).split('\n').slice(0, 4).join(' | '));
      try {
        await t.shot('FAILED');
      } catch {}
    }
    const unexpectedExternal = external.filter((u) => !/cdn\.userway\.org/.test(u));
    if (unexpectedExternal.length) failed.push('unexpected network requests: ' + unexpectedExternal.join(', '));
    if (errors.length) failed.push(...errors.map((e) => e.slice(0, 600)));

    const ms = Date.now() - t0;
    if (failed.length) {
      failures++;
      console.log(`✖ ${name} [${vpName}] (${ms}ms)`);
      for (const m of failed) console.log('    - ' + m);
    } else {
      passes++;
      console.log(`✔ ${name} [${vpName}] (${ms}ms)`);
    }
    await context.close();
  }
}

await browser.close();
console.log(`\n${passes} passed, ${failures} failed in ${((Date.now() - started) / 1000).toFixed(1)}s`);
process.exit(failures ? 1 : 0);
