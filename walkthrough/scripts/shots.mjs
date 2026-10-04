#!/usr/bin/env node
/*
 * scripts/shots.mjs — regenerates src/shots/<id>.jpg and <id>-thumb.jpg, one
 * picture of the statement part each feature is about (SPEC section 6).
 * Owner: steps.
 *
 *   node scripts/shots.mjs                 all features → src/shots/
 *   node scripts/shots.mjs --only why,fees only these
 *   node scripts/shots.mjs --out <dir>     write somewhere else (e.g. to compare)
 *
 * For each feature: the statement (../dist/yes-statement.html, built first if
 * missing) at 1280×900, light theme, English, deviceScaleFactor 1, reduced
 * motion, every network request blocked (so UserWay shows "Unavailable
 * offline"). The step's own setup runs through WT.driver (src/js/30-driver.js,
 * src/js/31-steps.js), then the target's box (or step.shot.selector's boxes,
 * unioned) plus step.shot.pad (default 16; a number or { top, right, bottom,
 * left }) is captured, cut by step.shot.clip and step.shot.maxRatio (height ÷
 * width, default 2.2) and clamped to the page. Each element's box is first
 * clipped to what its scroll container shows, so nothing hidden under a pinned
 * bar gets in. Targets in the page flow that are taller than the viewport are
 * captured by making the viewport taller (same width, so nothing reflows);
 * dialogs and the drawer are captured at step.shot.height (default 900).
 *
 * Output: <id>.jpg at most 1200px wide and <id>-thumb.jpg 320px wide, JPEG
 * quality 82. Resizing and encoding run in Chromium too (no other tools), so
 * the same inputs give the same files.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const HERE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(HERE, '..');
const STATEMENT = join(REPO, 'dist', 'yes-statement.html');
const ORIGIN = 'http://statement.shots.invalid';
const PAGE_URL = ORIGIN + '/statement/index.html';
const VIEWPORT = { width: 1280, height: 900 };
const FULL_MAX = 1200;
const THUMB = 320;
const QUALITY = 82;

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? null : args[i + 1] || '';
};
const outDir = resolve(opt('--out') || join(HERE, 'src', 'shots'));
const only = opt('--only') ? opt('--only').split(',').map((s) => s.trim()) : null;

if (!existsSync(STATEMENT)) {
  console.log('Statement not built yet: running node ../build.mjs');
  const r = spawnSync(process.execPath, ['build.mjs'], { cwd: REPO, stdio: 'inherit' });
  if (r.status !== 0 || !existsSync(STATEMENT)) {
    console.error('Could not build ../dist/yes-statement.html');
    process.exit(1);
  }
}

const features = JSON.parse(readFileSync(join(HERE, 'shared', 'features.json'), 'utf8'));
const ids = features.map((f) => f.id).filter((id) => !only || only.includes(id));
if (only) for (const id of only) if (!features.some((f) => f.id === id)) throw new Error('Unknown feature id: ' + id);
const inject =
  `window.WT = window.WT || {}; WT.features = ${JSON.stringify(features)};\n` +
  readFileSync(join(HERE, 'src', 'js', '30-driver.js'), 'utf8') +
  '\n;\n' +
  readFileSync(join(HERE, 'src', 'js', '31-steps.js'), 'utf8');
const statementHtml = readFileSync(STATEMENT);

/** Width and height from a PNG's IHDR chunk. */
function pngSize(buf) {
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/** Everything in the page: run the step and measure what to capture (CSS px, viewport coordinates). */
async function prepare(id) {
  const s = WT.steps[id];
  const win = window;
  await WT.driver.reset(win);
  const applied = await WT.driver.apply(win, s);
  const el = await WT.driver.target(win, s);
  if (!el) return { error: 'no visible target for ' + id + ' ' + JSON.stringify(applied.errors) };
  const shot = s.shot || {};
  const sels = shot.selector ? [].concat(shot.selector) : null;
  let els = sels ? sels.map((q) => WT.driver.firstVisible(win, q)).filter(Boolean) : [el];
  if (!els.length) els = [el];
  const isFixed = (e) => {
    for (let n = e; n && n !== document.documentElement; n = n.parentElement) if (getComputedStyle(n).position === 'fixed') return true;
    return false;
  };
  const fixed = els.some(isFixed);
  if (fixed) await WT.driver.scrollToTarget(win, els[0], { behavior: 'instant', block: 'start' });
  else win.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  await WT.driver.settle(win, { animations: true, minMs: 60 });
  return { fixed, applied, docHeight: document.documentElement.scrollHeight };
}

async function measure(id) {
  const s = WT.steps[id];
  const shot = s.shot || {};
  if (document.activeElement && document.activeElement !== document.body && document.activeElement.blur) document.activeElement.blur();
  const el = await WT.driver.target(window, s, { timeout: 1000 });
  const sels = shot.selector ? [].concat(shot.selector) : null;
  let els = sels ? sels.map((q) => WT.driver.firstVisible(window, q)).filter(Boolean) : [el];
  if (!els.length) els = [el];
  /** The element's box, cut to what its scroll containers actually show. */
  const shown = (e) => {
    const q = e.getBoundingClientRect();
    let [l, t, r, b] = [q.left, q.top, q.right, q.bottom];
    for (let p = e.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (!/(auto|scroll|overlay|hidden|clip)/.test(cs.overflowY) || p.scrollHeight <= p.clientHeight + 1) continue;
      const pr = p.getBoundingClientRect();
      const top = pr.top + p.clientTop;
      t = Math.max(t, top);
      b = Math.min(b, top + p.clientHeight);
    }
    return { l, t, r, b };
  };
  let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
  for (const e of els) {
    const q = shown(e);
    l = Math.min(l, q.l);
    t = Math.min(t, q.t);
    r = Math.max(r, q.r);
    b = Math.max(b, q.b);
  }
  return { left: l, top: t, width: r - l, height: b - t, vw: document.documentElement.clientWidth, vh: window.innerHeight, scrollY: window.scrollY };
}

function padOf(shot) {
  const pad = shot.pad != null ? shot.pad : 16;
  return typeof pad === 'number' ? { top: pad, right: pad, bottom: pad, left: pad } : { top: 0, right: 0, bottom: 0, left: 0, ...pad };
}

function frameBox(box, shot) {
  let { left, top, width, height } = box;
  if (shot.clip) {
    const c = shot.clip;
    left += c.left || 0;
    top += c.top || 0;
    width = c.width != null ? c.width : width - (c.left || 0);
    height = c.height != null ? c.height : height - (c.top || 0);
  }
  const p = padOf(shot);
  left -= p.left;
  top -= p.top;
  width += p.left + p.right;
  height += p.top + p.bottom;
  const ratio = shot.maxRatio || 2.2;
  if (height > width * ratio) height = width * ratio;
  // clamp to the page
  const x0 = Math.max(0, Math.floor(left));
  const y0 = Math.max(0, Math.floor(top));
  const x1 = Math.min(box.vw, Math.ceil(left + width));
  const y1 = Math.min(box.vh, Math.ceil(top + height));
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    colorScheme: 'light',
    reducedMotion: 'reduce',
    locale: 'en-US',
    timezoneId: 'America/New_York'
  });
  await context.route('**/*', (route) => {
    const url = route.request().url();
    if (url.split('#')[0] === PAGE_URL) return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: statementHtml });
    if (/^(data|blob):/.test(url)) return route.continue();
    return route.abort('internetdisconnected');
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/userway|net::ERR_|Failed to load resource/i.test(m.text()) && errors.push(m.text()));
  await page.goto(PAGE_URL + '#/overview');
  await page.waitForFunction(() => window.YES && window.YES.ready === true, null, { timeout: 15000 });
  await page.addScriptTag({ content: inject });
  await page.evaluate(() => WT.driver.baseline({ theme: 'light', lang: 'en' }));

  // A second page encodes: PNG in, scaled JPEG out (Chromium's resampling and encoder).
  const encCtx = await browser.newContext({ deviceScaleFactor: 1 });
  await encCtx.route('**/*', (route) => (/^(data|blob|about):/.test(route.request().url()) ? route.continue() : route.abort()));
  const enc = await encCtx.newPage();
  async function jpeg(png, maxWidth) {
    const src = pngSize(png);
    const width = Math.min(maxWidth, src.width);
    const height = Math.max(1, Math.round((src.height * width) / src.width));
    await enc.setViewportSize({ width, height });
    await enc.setContent(
      `<!doctype html><style>html,body{margin:0;background:#fff}img{display:block;width:${width}px;height:${height}px}</style><img alt="" src="data:image/png;base64,${png.toString('base64')}">`
    );
    await enc.waitForFunction(() => document.images[0] && document.images[0].complete && document.images[0].naturalWidth > 0);
    return { buf: await enc.screenshot({ type: 'jpeg', quality: QUALITY, clip: { x: 0, y: 0, width, height } }), width, height };
  }

  const report = [];
  for (const id of ids) {
    const shot = (await page.evaluate((id) => WT.steps[id].shot || {}, id)) || {};
    await page.setViewportSize({ width: VIEWPORT.width, height: shot.height || VIEWPORT.height });
    const prep = await page.evaluate(prepare, id);
    if (prep.error) throw new Error(prep.error);
    if (!prep.applied.ok) console.warn(`  ${id}: setup reported ${JSON.stringify(prep.applied.errors)}`);
    let box = await page.evaluate(measure, id);
    if (!prep.fixed) {
      // In the page flow: at scroll 0, grow the viewport until the whole box is in it.
      const need = Math.ceil(box.top + box.height + padOf(shot).bottom + 8);
      if (need > (shot.height || VIEWPORT.height)) {
        await page.setViewportSize({ width: VIEWPORT.width, height: Math.min(need, 8000) });
        await page.evaluate(() => WT.driver.settle(window, { animations: true, minMs: 120 }));
        box = await page.evaluate(measure, id);
      }
    }
    const clip = frameBox(box, shot);
    const png = await page.screenshot({ clip, type: 'png', animations: 'disabled', caret: 'hide' });
    const full = await jpeg(png, FULL_MAX);
    const thumb = await jpeg(png, THUMB);
    writeFileSync(join(outDir, `${id}.jpg`), full.buf);
    writeFileSync(join(outDir, `${id}-thumb.jpg`), thumb.buf);
    const kb = (f) => Math.round(statSync(join(outDir, f)).size / 1024);
    report.push(`${id.padEnd(16)} ${String(full.width + '×' + full.height).padEnd(10)} ${String(kb(id + '.jpg')).padStart(4)} KB   thumb ${thumb.width}×${thumb.height} ${kb(id + '-thumb.jpg')} KB${prep.fixed ? '   (dialog/drawer)' : ''}`);
    console.log(report[report.length - 1]);
  }
  await page.evaluate(() => WT.driver.reset(window));
  await browser.close();
  if (errors.length) {
    console.error('Console errors:\n' + errors.join('\n'));
    process.exit(1);
  }
  console.log(`\n${ids.length} features → ${outDir}`);
}

main().catch((e) => {
  console.error(e.stack || e.message || e);
  process.exit(1);
});
