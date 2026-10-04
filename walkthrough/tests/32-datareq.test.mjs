/*
 * Data requirements (WT.dataReq) — static checks, no browser needed.
 *
 * Loads src/js/32-datareq.js in a sandbox and checks it against
 * shared/features.json and the contract in docs/SPEC.md section 7.
 *
 * Runs under tests/run.mjs (default export) or on its own:
 *   node tests/32-datareq.test.mjs
 */
import nodeAssert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const SOURCES = [
  'Core ledger',
  'Customer profile',
  'Blockchain / on-chain data',
  'Pricing & FX',
  'Content management',
  'Support / case management',
  'AI service',
  'Document generation',
  'Accessibility service',
  'Preferences'
];
const BASE_TYPES = ['string', 'string<date-time>', 'string<date>', 'string<currency>', 'integer<minor units>', 'integer', 'number', 'boolean', 'object', 'array', 'string<uri>', 'string<masked>'];
const ENUM = /^string<enum: ([a-z0-9_]+(?:\|[a-z0-9_]+)*)>$/;
const SEGMENT = '[A-Za-z_][A-Za-z0-9_]*(?:\\[\\])?';
const PATH = new RegExp('^\\$?' + SEGMENT + '(?:\\.' + SEGMENT + ')*$');
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CURRENCY = /^[A-Z][A-Z0-9]{2,9}$/;
const MASK = /[•…*]/;

function loadDataReq() {
  const code = readFileSync(join(ROOT, 'src/js/32-datareq.js'), 'utf8');
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: '32-datareq.js' });
  // Round-trip through JSON so objects from the sandbox compare as plain data.
  return JSON.parse(JSON.stringify(sandbox.window.WT.dataReq));
}

/** Returns an error message, or '' when the example fits the type. */
function exampleProblem(type, ex) {
  const m = ENUM.exec(type);
  if (m) return typeof ex === 'string' && m[1].split('|').includes(ex) ? '' : 'not one of ' + m[1];
  switch (type) {
    case 'string':
      return typeof ex === 'string' && ex.length ? '' : 'expected a non-empty string';
    case 'string<date-time>':
      return typeof ex === 'string' && DATE_TIME.test(ex) && !Number.isNaN(Date.parse(ex)) ? '' : 'expected ISO 8601 date-time with offset';
    case 'string<date>':
      return typeof ex === 'string' && DATE.test(ex) && !Number.isNaN(Date.parse(ex)) ? '' : 'expected YYYY-MM-DD';
    case 'string<currency>':
      return typeof ex === 'string' && CURRENCY.test(ex) ? '' : 'expected an upper-case currency or asset code';
    case 'integer<minor units>':
    case 'integer':
      return Number.isSafeInteger(ex) ? '' : 'expected an integer';
    case 'number':
      return typeof ex === 'number' && Number.isFinite(ex) ? '' : 'expected a finite number';
    case 'boolean':
      return typeof ex === 'boolean' ? '' : 'expected a boolean';
    case 'object':
      return ex && typeof ex === 'object' && !Array.isArray(ex) ? '' : 'expected an object';
    case 'array':
      return Array.isArray(ex) && ex.length ? '' : 'expected a non-empty array';
    case 'string<uri>': {
      if (typeof ex !== 'string') return 'expected a URI string';
      try {
        const u = new URL(ex);
        return ['https:', 'data:', 'mailto:', 'tel:'].includes(u.protocol) ? '' : 'unexpected scheme ' + u.protocol;
      } catch {
        return 'not a valid URI';
      }
    }
    case 'string<masked>':
      return typeof ex === 'string' && MASK.test(ex) && !/\d{5,}/.test(ex) ? '' : 'expected a masked value (•, … or *) with no long digit runs';
    default:
      return 'unknown type';
  }
}

export default async function run(ctx = {}) {
  const assert = ctx.assert || nodeAssert;
  const log = ctx.log || ((...a) => console.log(...a));

  const features = JSON.parse(readFileSync(join(ROOT, 'shared/features.json'), 'utf8'));
  const ids = features.map((f) => f.id);
  const req = loadDataReq();
  const problems = [];
  const fail = (msg) => problems.push(msg);

  // 1. Every feature has an entry, $common exists, and there are no stray keys.
  assert.ok(req && typeof req === 'object', 'WT.dataReq is defined');
  assert.ok(req.$common, 'WT.dataReq.$common exists');
  for (const id of ids) if (!req[id]) fail(`missing entry for feature "${id}"`);
  for (const key of Object.keys(req)) if (key !== '$common' && !ids.includes(key)) fail(`entry "${key}" is not a feature in shared/features.json`);

  const seen = new Map(); // path → { def, by }
  const counts = {};

  for (const key of ['$common', ...ids]) {
    const e = req[key];
    if (!e) continue;
    if (typeof e.summary !== 'string' || e.summary.trim().length < 20) fail(`${key}: summary is missing or too short`);
    if (e.notes !== undefined && (!Array.isArray(e.notes) || e.notes.some((n) => typeof n !== 'string' || !n.trim()))) fail(`${key}: notes must be an array of strings`);
    if (!Array.isArray(e.fields)) {
      fail(`${key}: fields is not an array`);
      continue;
    }
    counts[key] = e.fields.length;
    // 6. No feature has fewer than 3 fields.
    if (e.fields.length < 3) fail(`${key}: only ${e.fields.length} fields (minimum 3)`);

    const local = new Set();
    for (const f of e.fields) {
      const where = `${key} › ${f && f.path}`;
      // 2. Every field has path, type, required, example, description and source.
      for (const prop of ['path', 'type', 'required', 'example', 'description', 'source']) {
        if (!f || !(prop in f) || f[prop] === undefined || f[prop] === null) fail(`${where}: missing ${prop}`);
      }
      if (!f || typeof f.path !== 'string') continue;
      if (typeof f.required !== 'boolean') fail(`${where}: required must be a boolean`);
      if (typeof f.description !== 'string' || f.description.trim().length < 8) fail(`${where}: description is missing or too short`);
      if (!SOURCES.includes(f.source)) fail(`${where}: source "${f.source}" is not in the SPEC list`);

      // 4. Valid path syntax, no duplicates within a feature.
      if (!PATH.test(f.path)) fail(`${where}: invalid path syntax`);
      if (local.has(f.path)) fail(`${where}: duplicate path in this feature`);
      local.add(f.path);

      // 3. Allowed types; the example matches its type.
      if (!BASE_TYPES.includes(f.type) && !ENUM.test(f.type)) fail(`${where}: type "${f.type}" is not allowed`);
      else {
        const p = exampleProblem(f.type, f.example);
        if (p) fail(`${where}: example ${JSON.stringify(f.example)} does not match ${f.type} (${p})`);
      }

      // 5. Shared paths have identical definitions across features.
      const def = JSON.stringify({ type: f.type, required: f.required, example: f.example, description: f.description, source: f.source });
      const prev = seen.get(f.path);
      if (!prev) seen.set(f.path, { def, by: [key] });
      else {
        if (prev.def !== def) fail(`${f.path}: definition in "${key}" differs from "${prev.by[0]}"`);
        prev.by.push(key);
      }
    }
  }

  // The merged paths form a consistent tree: a leaf is never also a parent,
  // and a key is never both an array and a plain object.
  const all = [...seen.keys()];
  for (const p of all) {
    const def = JSON.parse(seen.get(p).def);
    const children = all.filter((q) => q.startsWith(p + '.') || q.startsWith(p + '[]'));
    if (children.length && def.type !== 'object' && !(def.type === 'array' && !p.endsWith('[]'))) fail(`${p}: is a ${def.type} leaf but also has children (${children[0]})`);
    const segs = p.split('.');
    for (let i = 1; i <= segs.length; i++) {
      const prefix = segs.slice(0, i).join('.');
      const bare = prefix.replace(/\[\]$/, '');
      const clash = all.find((q) => (bare !== prefix ? q === bare || q.startsWith(bare + '.') : q.startsWith(bare + '[]')));
      if (clash) fail(`${p}: "${bare}" is used both as an array and as a non-array (${clash})`);
    }
  }

  // AI input lists only name fields that exist.
  const aiInput = seen.get('ai.inputFields');
  if (aiInput) {
    for (const p of JSON.parse(aiInput.def).example) if (!seen.has(p)) fail(`ai.inputFields lists "${p}", which is not a defined field`);
  }

  // The SPEC's envelope is in $common.
  const common = new Set((req.$common.fields || []).map((f) => f.path));
  for (const p of ['statement.id', 'statement.period.start', 'statement.period.end', 'statement.generatedAt', 'statement.language', 'customer.id', 'customer.firstName', 'account.maskedId', 'asset.id']) {
    if (!common.has(p)) fail(`$common is missing ${p}`);
  }
  // Data minimisation: the full name is only displayed in print and PDF, so
  // only "download" asks for it (not every feature through $common).
  const listing = (path) => ['$common', ...ids].filter((k) => req[k] && (req[k].fields || []).some((f) => f.path === path));
  assert.deepEqual(listing('customer.displayName'), ['download'].filter((k) => req[k]), 'customer.displayName is needed only by download');

  // The AI notes and inputs (SPEC section 7): the inputs name every transaction
  // field the explanation describes, and the customer's question is covered.
  const has = (k, path) => !!req[k] && (req[k].fields || []).some((f) => f.path === path);
  if (aiInput) {
    const inputs = JSON.parse(aiInput.def).example;
    for (const p of ['transactions[].balanceAfter', 'transactions[].onchain.network', 'transactions[].onchain.hash']) if (!inputs.includes(p)) fail(`ai.inputFields is missing ${p}`);
    for (const k of ['explain-ai', 'assistant']) {
      if (!req[k]) continue;
      for (const p of inputs.filter((x) => x.startsWith('transactions[]') || x.startsWith('statement.opening') || x.startsWith('statement.closing'))) if (!has(k, p)) fail(`${k} sends ${p} to the AI service but does not list it`);
      if (!has(k, 'ai.retentionDays')) fail(`${k} is missing ai.retentionDays`);
    }
  }
  if (req.assistant && !req.assistant.notes.some((n) => /customer’s own question/.test(n) && /ai\.retentionDays/.test(n))) fail('assistant: the notes must say the typed question is sent and retained');
  for (const k of Object.keys(req)) for (const n of req[k].notes || []) if (/never sent/.test(n) && /memos/.test(n) && !/question/.test(n)) fail(`${k}: a note says data is never sent but ignores the typed question`);
  for (const [k, p] of [['inquiry', 'transactions[].amount'], ['inquiry', 'transactions[].counterparty.en'], ['explorer', 'transactions[].balanceAfter'], ['integrity', 'integrity.alertEndpoint']]) {
    if (req[k] && !has(k, p)) fail(`${k} is missing ${p}`);
  }

  if (problems.length) {
    assert.fail(`${problems.length} data-requirement problem(s):\n  - ` + problems.join('\n  - '));
  }

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  log(`32-datareq: ${ids.length} features + $common, ${total} field entries, ${seen.size} unique paths`);
  log('  ' + Object.entries(counts).map(([k, n]) => `${k} ${n}`).join(', '));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().then(
    () => console.log('PASS 32-datareq'),
    (err) => {
      console.error('FAIL 32-datareq\n' + (err && err.message ? err.message : err));
      process.exit(1);
    }
  );
}
