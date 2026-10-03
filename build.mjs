#!/usr/bin/env node
/*
 * Builds the single distributable file: dist/yes-statement.html
 *
 *   node build.mjs [--out path/to/file.html]
 *
 * - Inlines every src/css/*.css and src/js/*.js (sorted by filename) into
 *   src/index.html. No external CSS, fonts, scripts or media are referenced.
 * - Release gate: evaluates the data + reconciliation code and refuses to build
 *   if the statement does not reconcile (PRD 5.2, 6).
 * - Generates a static <noscript> summary from the same data object.
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = dirname(fileURLToPath(import.meta.url));
const SRC = join(ROOT, 'src');
const args = process.argv.slice(2);
const outArg = args.indexOf('--out');
const OUT = resolve(outArg !== -1 ? args[outArg + 1] : join(ROOT, 'dist', 'yes-statement.html'));

// --modules overview,explorer → build only the foundation plus the named feature
// modules (lets several modules be developed and tested in isolation).
const modArg = args.indexOf('--modules');
const ONLY = modArg !== -1 ? args[modArg + 1].split(',').filter(Boolean) : null;
const isFoundation = (f) => /^(0\d|9\d)-/.test(f);
const list = (dir, ext) =>
  readdirSync(join(SRC, dir))
    .filter((f) => f.endsWith(ext))
    .filter((f) => !ONLY || isFoundation(f) || ONLY.some((m) => f.includes(m)))
    .sort()
    .map((f) => ({ name: `${dir}/${f}`, body: readFileSync(join(SRC, dir, f), 'utf8') }));

const cssFiles = list('css', '.css');
const jsFiles = list('js', '.js');

// ---------------------------------------------------------------- Release gate
const sandbox = { console, Intl, Date, Math, JSON };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
for (const f of jsFiles.filter((f) => /^js\/0[0-2]-/.test(f.name))) {
  vm.runInContext(f.body, sandbox, { filename: f.name });
}
const YES = sandbox.YES;
const result = YES.calc.reconcile(YES.data);
if (!result.ok) {
  console.error('\n✖ Release gate: statement does not reconcile. Build refused.\n');
  for (const c of result.checks.filter((c) => !c.ok)) console.error(`  - ${c.id}: ${JSON.stringify(c.detail)}`);
  process.exit(1);
}

// -------------------------------------------------------------- Syntax check
const js = jsFiles.map((f) => `/* ---- ${f.name} ---- */\n${f.body}`).join('\n');
try {
  new vm.Script(js, { filename: 'bundle.js' });
} catch (e) {
  console.error('✖ JavaScript syntax error:', e.message);
  process.exit(1);
}
if (/<\/script/i.test(js)) {
  console.error('✖ A JS source contains "</script" — escape it (e.g. "<\\/script").');
  process.exit(1);
}
const css = cssFiles.map((f) => `/* ---- ${f.name} ---- */\n${f.body}`).join('\n');
if (/@import|url\((?!\s*['"]?data:)/i.test(css)) {
  console.error('✖ CSS references an external resource (@import or url()). Inline it as a data: URI.');
  process.exit(1);
}

// ------------------------------------------------------------ Noscript summary
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const s = YES.data.statement;
const asset = YES.data.assets[s.assetId];
const amt = (m, sign = false) => {
  const v = (Math.abs(m) / 10 ** asset.precision).toLocaleString('en-US', { minimumFractionDigits: asset.precision, maximumFractionDigits: asset.precision });
  return (m < 0 ? '−' : sign && m > 0 ? '+' : '') + v + ' ' + asset.symbol;
};
const day = (iso) => new Date(iso).toLocaleDateString('en-US', { timeZone: s.timezone, day: 'numeric', month: 'short', year: 'numeric' });
const label = { deposit: 'Deposit', transfer_in: 'Received', transfer_out: 'Sent', redemption: 'Redeemed', fee: 'Fee' };
const catLabel = { deposits: 'Deposits', transfers_in: 'Incoming transfers', transfers_out: 'Outgoing transfers', redemptions: 'Redemptions', fees: 'Fees' };
const rows = YES.calc
  .posted(YES.data)
  .map((t) => `<tr><td>${esc(day(t.postedAt))}</td><td>${esc(label[t.type])}</td><td>${esc(t.description.en)}</td><td>${esc(t.counterparty.en)}</td><td style="text-align:right">${esc(amt(t.amount, true))}</td><td style="text-align:right">${esc(amt(t.balanceAfter))}</td></tr>`)
  .join('');
const pending = YES.calc
  .notInBalance(YES.data)
  .map((t) => `<li>${esc(day(t.initiatedAt))} — ${esc(t.description.en)}: ${esc(amt(t.amount, true))} (${esc(t.status)}, not included in the statement balance)</li>`)
  .join('');
const cats = YES.calc
  .categories(YES.data)
  .map((c) => `<li>${esc(catLabel[c.id])}: ${esc(amt(c.total, true))}</li>`)
  .join('');
const noscript = `<div class="noscript-summary">
<p><strong>ILLUSTRATIVE DEMO DATA.</strong> This interactive statement needs JavaScript. A static summary follows.</p>
<h1>YES statement — ${esc(day(s.periodStart))} to ${esc(day(s.periodEnd))}</h1>
<p>Statement ${esc(s.id)}, version ${esc(s.version)}. Account ${esc(s.account.maskedId)}. Dates use the posted date; times in ${esc(s.timezone)}.</p>
<p>Opening balance ${esc(amt(s.opening))}. Closing statement balance <strong>${esc(amt(s.closing))}</strong>.</p>
<ul>${cats}</ul>
<table><caption>Posted transactions</caption><thead><tr><th>Posted</th><th>Type</th><th>Description</th><th>Counterparty</th><th>Amount</th><th>Balance after</th></tr></thead><tbody>${rows}</tbody></table>
${pending ? `<h2>Not included in the statement balance</h2><ul>${pending}</ul>` : ''}
</div>`;

// ------------------------------------------------------------------- Assemble
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
let html = readFileSync(join(SRC, 'index.html'), 'utf8');
html = html
  .replace('/*{{CSS}}*/', () => css)
  .replace('/*{{JS}}*/', () => js)
  .replace('{{NOSCRIPT}}', () => noscript)
  .replace('{{VERSION}}', () => pkg.version);

const leftovers = html.match(/\{\{[A-Z]+\}\}/g);
if (leftovers) {
  console.error('✖ Unreplaced template markers:', leftovers.join(', '));
  process.exit(1);
}
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, html);
const kb = (Buffer.byteLength(html) / 1024).toFixed(1);
console.log(`✔ Release gate passed (${result.summary.postedCount} posted, ${result.summary.pendingCount} not in balance; ${result.checks.length} checks).`);
console.log(`✔ Built ${OUT.replace(ROOT + '/', '')} — ${kb} KB, ${cssFiles.length} CSS + ${jsFiles.length} JS sources inlined.`);
