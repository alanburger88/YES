#!/usr/bin/env node
/*
 * Test runner for the walkthrough app (SPEC section 10). Owner: foundation.
 *
 *   node tests/run.mjs                 build, serve and run every tests/*.test.mjs
 *   node tests/run.mjs --only shell    run test files whose name contains "shell"
 *   node tests/run.mjs --keep          keep the temp build (path is printed)
 *
 * 1. Builds into a fresh temp dir (never walkthrough/public).
 * 2. Starts server/dev.mjs --store memory --port 0 --root <tmp> with a random
 *    ADMIN_CODE, and sets process.env.WT_BASE to its URL.
 * 3. Launches Chromium once, then for each test file: empties the database
 *    (admin reset) and calls its default export with
 *      { base, browser, api, assert, log, step, reset, adminCode, features, root, out, file, shotsDir }
 *    A file passes when the function resolves and no ctx.step() failed.
 * Prints pass/fail per file and exits non-zero on any failure.
 *
 * Test file shape:
 *   export const meta = { timeout: 120000 };            // optional
 *   export default async function ({ base, browser, api, assert, log, step }) {
 *     await step('health', async () => { assert.equal((await api('/api/health')).status, 200); });
 *   }
 * step(name, fn) records a failure and carries on, so one run shows every broken step.
 * Browser helpers (openPage, gotoApp, axe, shot, …) are in tests/helpers.mjs.
 */
import nodeAssert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { ROOT, apiClient, features as readFeatures } from './helpers.mjs';

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? null : args[i + 1] || '';
};
const only = opt('--only');
const keep = args.includes('--keep');
const started = Date.now();

const files = readdirSync(join(ROOT, 'tests'))
  .filter((f) => f.endsWith('.test.mjs'))
  .filter((f) => !only || f.includes(only))
  .sort();
if (!files.length) {
  console.error(`No test files match ${only ? `"${only}"` : 'tests/*.test.mjs'}`);
  process.exit(1);
}

/* ---- 1. Build ---- */
const out = mkdtempSync(join(tmpdir(), 'wt-test-'));
const shotsDir = process.env.WT_SHOTS || join(ROOT, 'test-results', 'screens');
process.env.WT_SHOTS = shotsDir;
const { build } = await import(pathToFileURL(join(ROOT, 'build.mjs')).href);
try {
  await build({ out, quiet: true });
} catch (e) {
  console.error('Build failed: ' + (e.message || e));
  process.exit(1);
}

/* ---- 2. Server ---- */
const adminCode = 'test-' + randomBytes(12).toString('hex');
const server = spawn(process.execPath, [join(ROOT, 'server', 'dev.mjs'), '--store', 'memory', '--port', '0', '--root', out], {
  cwd: ROOT,
  env: { ...process.env, ADMIN_CODE: adminCode },
  stdio: ['ignore', 'pipe', 'pipe']
});
let serverLog = '';
server.stderr.on('data', (d) => (serverLog += d));
const base = await new Promise((resolve, reject) => {
  let buf = '';
  const timer = setTimeout(() => reject(new Error('dev server did not start in 15s\n' + serverLog)), 15000);
  server.stdout.on('data', (d) => {
    buf += d;
    serverLog += d;
    const m = buf.match(/WT_LISTENING (\S+)/);
    if (m) {
      clearTimeout(timer);
      resolve(m[1]);
    }
  });
  server.once('exit', (code) => {
    clearTimeout(timer);
    reject(new Error(`dev server exited (${code})\n${serverLog}`));
  });
}).catch((e) => {
  console.error(e.message);
  process.exit(1);
});
process.env.WT_BASE = base;

let browser = null;
async function cleanup() {
  try {
    if (browser) await browser.close();
  } catch {
    /* ignore */
  }
  server.kill('SIGTERM');
  if (!keep) rmSync(out, { recursive: true, force: true });
}
process.on('SIGINT', () => cleanup().then(() => process.exit(130)));

/* ---- 3. Run ---- */
const { chromium } = await import('playwright');
browser = await chromium.launch();
const api = apiClient(base);
const features = readFeatures();
const reset = async () => {
  const r = await api('/api/admin/reset', { method: 'POST', body: { confirm: 'RESET' }, admin: adminCode });
  if (r.status !== 200) throw new Error('reset failed: ' + r.status + ' ' + r.text);
};

console.log(`Walkthrough tests · ${base} · build ${out}${keep ? ' (kept)' : ''}\n`);
let passed = 0;
let failed = 0;

for (const file of files) {
  const name = file.replace(/\.test\.mjs$/, '');
  const t0 = Date.now();
  const problems = [];
  const lines = [];
  let mod;
  try {
    mod = await import(pathToFileURL(join(ROOT, 'tests', file)).href);
  } catch (e) {
    problems.push('could not load: ' + (e.stack || e.message));
  }
  if (mod && typeof mod.default !== 'function') problems.push('has no default export function');

  if (!problems.length) {
    const log = (...a) => lines.push('    ' + a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '));
    const step = async (label, fn) => {
      const s0 = Date.now();
      try {
        await fn();
        lines.push(`  ✔ ${label} (${Date.now() - s0}ms)`);
        return true;
      } catch (e) {
        const msg = (e && (e.stack || e.message)) || String(e);
        lines.push(`  ✖ ${label}\n      ${msg.split('\n').slice(0, 8).join('\n      ')}`);
        problems.push(label);
        return false;
      }
    };
    const ctx = { base, browser, api, assert: nodeAssert, log, step, reset, adminCode, features, root: ROOT, out, file, shotsDir };
    const timeout = (mod.meta && mod.meta.timeout) || 180000;
    try {
      await reset();
      let timer;
      await Promise.race([
        Promise.resolve(mod.default(ctx)),
        new Promise((_, rej) => {
          timer = setTimeout(() => rej(new Error(`timed out after ${timeout / 1000}s`)), timeout);
        })
      ]).finally(() => clearTimeout(timer));
    } catch (e) {
      const msg = (e && (e.stack || e.message)) || String(e);
      lines.push(`  ✖ threw: ${msg.split('\n').slice(0, 8).join('\n      ')}`);
      problems.push('threw');
    }
  }

  const ms = Date.now() - t0;
  if (problems.length) {
    failed++;
    console.log(`✖ ${name} (${ms}ms)`);
  } else {
    passed++;
    console.log(`✔ ${name} (${ms}ms)`);
  }
  for (const l of lines) console.log(l);
  if (problems.length && !lines.length) for (const p of problems) console.log('    - ' + p);
}

await cleanup();
console.log(`\n${passed} passed, ${failed} failed in ${((Date.now() - started) / 1000).toFixed(1)}s`);
if (failed && serverLog.trim()) console.log('\nServer log:\n' + serverLog.trim().split('\n').slice(-30).join('\n'));
process.exit(failed ? 1 : 0);
