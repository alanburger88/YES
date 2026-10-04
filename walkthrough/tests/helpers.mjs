/*
 * Shared test helpers for the walkthrough app (SPEC section 10). Owner: foundation.
 *
 * Test files export `default async function (ctx)`; tests/run.mjs passes
 *   ctx = { base, browser, api, assert, log, step, reset, adminCode, features, root, out, file, shotsDir }
 * and these helpers work with it. Everything here is safe to use in parallel
 * test runs: no fixed ports, no writes to walkthrough/public.
 *
 *   import { openPage, gotoApp, axe, shot, VIEWPORTS, newSecret } from './helpers.mjs';
 *   const { page, errors, close } = await openPage(ctx, { viewport: 'phone', colorScheme: 'dark' });
 *   await gotoApp(page, ctx.base, '#/results');
 *   ...
 *   assertNoErrors(errors, ctx.assert);
 *   await close();
 */
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const REPO = resolve(ROOT, '..');

export const VIEWPORTS = {
  desktop: { width: 1280, height: 900 },
  wide: { width: 1920, height: 1080 },
  tablet: { width: 900, height: 1100, isMobile: true, hasTouch: true },
  phone: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  narrow: { width: 320, height: 640, isMobile: true, hasTouch: true }
};

/** Console messages that are expected offline and never fail a test. */
export const IGNORED_CONSOLE = [/userway/i, /net::ERR_/i, /Failed to load resource/i];

/** shared/features.json, read fresh (never hard-code ids or counts). */
export function features() {
  return JSON.parse(readFileSync(join(ROOT, 'shared', 'features.json'), 'utf8'));
}

/** A reviewer secret: 32 random bytes as 64 hex characters. */
export function newSecret() {
  return randomBytes(32).toString('hex');
}

/** The reviewer id the server derives from a secret. */
export function ridFor(secret) {
  return createHash('sha256').update(String(secret).toLowerCase()).digest('hex').slice(0, 24);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Small fetch client for the API.
 *   const r = await api('/api/me', { method: 'PUT', body: {...}, secret, admin, headers, rawBody });
 *   r → { status, ok, headers, json, text, bytes } (text keeps a leading BOM)
 */
export function apiClient(base) {
  return async function api(path, opts = {}) {
    const headers = { Accept: 'application/json', ...(opts.headers || {}) };
    let body;
    if (opts.rawBody !== undefined) body = opts.rawBody;
    else if (opts.body !== undefined) {
      body = JSON.stringify(opts.body);
      headers['Content-Type'] = 'application/json';
    }
    if (opts.secret) headers['X-Reviewer-Secret'] = opts.secret;
    if (opts.admin) headers['X-Admin-Code'] = opts.admin;
    const res = await fetch(base + path, { method: opts.method || 'GET', headers, body });
    const bytes = new Uint8Array(await res.arrayBuffer());
    const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes); // keeps a BOM visible
    let json = null;
    try {
      json = text ? JSON.parse(text.replace(/^\uFEFF/, '')) : null;
    } catch {
      json = null;
    }
    return { status: res.status, ok: res.ok, headers: res.headers, json, text, bytes };
  };
}

/**
 * New browser context + page with all non-local network blocked.
 * opts: { viewport: name | {width,height}, colorScheme, reducedMotion, storage: { key: value },
 *         locale, timezoneId, javaScriptEnabled }
 * storage values are written to localStorage before the app's scripts run, once per page.
 * Returns { context, page, errors, ignored, external, close }.
 */
export async function openPage(ctx, opts = {}) {
  const { browser, base } = ctx;
  const vp = typeof opts.viewport === 'object' ? opts.viewport : VIEWPORTS[opts.viewport || 'desktop'];
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    isMobile: !!vp.isMobile,
    hasTouch: !!vp.hasTouch,
    deviceScaleFactor: vp.deviceScaleFactor || 1,
    colorScheme: opts.colorScheme || 'light',
    reducedMotion: opts.reducedMotion || 'no-preference',
    locale: opts.locale || 'en-GB',
    timezoneId: opts.timezoneId || 'Europe/London',
    acceptDownloads: true,
    javaScriptEnabled: opts.javaScriptEnabled !== false
  });
  const external = [];
  await context.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith(base) || url.startsWith('data:') || url.startsWith('blob:') || url === 'about:blank') return route.continue();
    external.push(url);
    return route.abort('internetdisconnected');
  });
  if (opts.storage) {
    await context.addInitScript((seed) => {
      if (window.top !== window) return;
      try {
        if (sessionStorage.getItem('__wt_seeded')) return;
        for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
        sessionStorage.setItem('__wt_seeded', '1');
      } catch {
        /* storage blocked */
      }
    }, opts.storage);
  }
  const page = await context.newPage();
  const errors = [];
  const ignored = [];
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    if (IGNORED_CONSOLE.some((r) => r.test(text))) ignored.push(text);
    else errors.push('console: ' + text);
  });
  page.on('pageerror', (e) => errors.push('pageerror: ' + (e.stack || e.message)));
  return {
    context,
    page,
    errors,
    ignored,
    external,
    close: () => context.close()
  };
}

/** Navigate to the app (hash defaults to #/start) and wait for WT to boot. */
export async function gotoApp(page, base, hash = '#/start') {
  await page.goto(base + '/' + (hash || ''));
  await page.waitForFunction(() => document.documentElement.getAttribute('data-wt-ready') === '1', null, { timeout: 15000 });
}

/** Wait until the router shows a view (and optionally a param). */
export async function waitForView(page, view, param) {
  await page.waitForFunction(
    ([v, p]) => {
      const r = window.WT && window.WT.route && window.WT.route();
      const sec = document.getElementById('view-' + v);
      return r && r.view === v && (p === undefined || r.param === p) && sec && !sec.hidden;
    },
    [view, param],
    { timeout: 10000 }
  );
}

/** Information about the focused element: { tag, id, text, fk, role, label }. */
export async function focused(page) {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!el) return null;
    return {
      tag: el.tagName.toLowerCase(),
      id: el.id || '',
      text: (el.textContent || '').trim().slice(0, 120),
      fk: el.getAttribute('data-fk') || '',
      role: el.getAttribute('role') || '',
      label: el.getAttribute('aria-label') || ''
    };
  });
}

const require = createRequire(import.meta.url);
let AXE_SRC = null;
function axeSource() {
  if (!AXE_SRC) {
    let file;
    try {
      file = require.resolve('axe-core/axe.min.js');
    } catch {
      file = join(REPO, 'node_modules', 'axe-core', 'axe.min.js');
    }
    AXE_SRC = readFileSync(file, 'utf8');
  }
  return AXE_SRC;
}

/**
 * Run axe-core (WCAG 2.0–2.2 A/AA + best practice) and return violations as
 * [{ id, impact, help, nodes: ['selector :: summary'] }]. Injected through
 * page.evaluate, which the app's CSP allows (addScriptTag would be blocked).
 * opts: { include: 'selector', exclude: ['selector'], disableRules: ['rule-id'], tags }
 */
export async function axe(page, opts = {}) {
  await page.evaluate(axeSource() + '\n;void 0;');
  return page.evaluate(async (o) => {
    const finite = document.getAnimations().filter((a) => {
      const t = a.effect && a.effect.getComputedTiming();
      return t && Number.isFinite(t.endTime) && a.playState === 'running';
    });
    await Promise.race([Promise.all(finite.map((a) => a.finished.catch(() => null))), new Promise((r) => setTimeout(r, 1500))]);
    const context = o.include || o.exclude ? { include: o.include ? [o.include] : [document], exclude: (o.exclude || []).map((s) => [s]) } : document;
    const rules = {};
    for (const id of o.disableRules || []) rules[id] = { enabled: false };
    const r = await window.axe.run(context, {
      runOnly: { type: 'tag', values: o.tags || ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] },
      rules,
      iframes: false
    });
    return r.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      nodes: v.nodes.slice(0, 6).map((n) => n.target.join(' ') + ' :: ' + (n.failureSummary || '').replace(/\s+/g, ' ').slice(0, 300))
    }));
  }, opts);
}

/** Format axe violations for an assertion message. */
export function formatViolations(violations) {
  return violations.map((v) => `${v.id} (${v.impact}): ${v.help}\n      ${v.nodes.join('\n      ')}`).join('\n    ');
}

/** Screenshot to $WT_SHOTS (or walkthrough/test-results/screens). Returns the file path. */
export async function shot(page, name, opts = {}) {
  const dir = process.env.WT_SHOTS || join(ROOT, 'test-results', 'screens');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, name.replace(/[^\w.-]+/g, '-') + '.png');
  await page.screenshot({ path: file, fullPage: !!opts.fullPage });
  return file;
}

/** Fail with every unexpected console error / page error / external request. */
export function assertNoErrors(errors, assert, external) {
  assert.deepEqual(errors, [], 'console or page errors:\n' + errors.join('\n'));
  if (external) assert.deepEqual(external.filter((u) => !/cdn\.userway\.org/.test(u)), [], 'unexpected external requests');
}

/** Save answers (and optionally a name) for a reviewer straight through the API. */
export async function seedReviewer(api, { secret = newSecret(), name, answers = {} } = {}) {
  const now = new Date().toISOString();
  const body = { answers: {} };
  if (name !== undefined) body.name = name;
  for (const [id, a] of Object.entries(answers)) body.answers[id] = a === null ? null : { vote: null, priority: null, reason: '', comment: '', updatedAt: now, ...a };
  const r = await api('/api/me', { method: 'PUT', body, secret });
  if (r.status !== 200) throw new Error(`seedReviewer failed: ${r.status} ${r.text}`);
  return { secret, rid: r.json.rid, record: r.json };
}

/** localStorage seed for openPage({ storage }) that makes this browser a reviewer with answers. */
export function reviewerStorage({ secret = newSecret(), name = '', answers = {}, lastStep = '' } = {}) {
  const now = new Date().toISOString();
  const full = {};
  for (const [id, a] of Object.entries(answers)) full[id] = { vote: null, priority: null, reason: '', comment: '', updatedAt: now, ...a };
  return { 'infoslips.wt.reviewer': { secret, name, rid: ridFor(secret), answers: full, lastStep } };
}
