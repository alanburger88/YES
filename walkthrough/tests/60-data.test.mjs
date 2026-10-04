/*
 * 60-data — the data-requirements explorer (WT.json, 60-json.js) and the Data
 * requirements view (#/data, 61-data.js). Owner: data view.
 *
 * Covers: the merge (deduplicated paths, "needed by"), the sample payload and
 * the JSON Schema against an independent reference built from 32-datareq.js;
 * the WAI-ARIA tree (states, roving tabindex, keyboard, type-ahead); search;
 * copy and download (under the app's CSP); the scope switch with answers seeded
 * through the API; the deep link; the empty state; the results API being down;
 * the compact explorer inside a dialog; layout at phone and desktop widths;
 * axe; screenshots in both themes.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import {
  assertNoErrors,
  axe,
  focused,
  formatViolations,
  gotoApp,
  openPage,
  seedBrowserReviewer,
  seedReviewer,
  shot,
  sleep,
  waitForView
} from './helpers.mjs';

export const meta = { timeout: 420000 };

/* ------------------------------------------------------------------ */
/* Independent reference (Node side)                                   */
/* ------------------------------------------------------------------ */

function loadDataReq(root) {
  const code = readFileSync(join(root, 'src/js/32-datareq.js'), 'utf8');
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: '32-datareq.js' });
  return JSON.parse(JSON.stringify(sandbox.window.WT.dataReq));
}

/** path → { …field, listedBy, common, neededBy } for the given ids (tour order). */
function referenceMerge(dr, ids) {
  const map = new Map();
  const take = (f) => {
    if (!map.has(f.path)) map.set(f.path, { ...f, listedBy: [], common: false });
    return map.get(f.path);
  };
  for (const id of ids) for (const f of dr[id].fields) take(f).listedBy.push(id);
  if (ids.length) for (const f of dr.$common.fields) take(f).common = true;
  for (const m of map.values()) m.neededBy = m.common ? ids.slice() : m.listedBy.slice();
  return map;
}

/** The sample payload, rebuilt from the field list alone: lists hold one item. */
function referenceSample(fields) {
  const out = {};
  for (const f of fields) {
    const segs = f.path.split('.');
    let cur = out;
    segs.forEach((seg, i) => {
      const arr = seg.endsWith('[]');
      const key = arr ? seg.slice(0, -2) : seg;
      const last = i === segs.length - 1;
      if (last) cur[key] = arr ? [f.example] : f.example;
      else if (arr) {
        cur[key] = cur[key] || [{}];
        cur = cur[key][0];
      } else {
        cur[key] = cur[key] || {};
        cur = cur[key];
      }
    });
  }
  return out;
}

/** Walk a value by a field path (index 0 into lists). */
function valueAt(obj, path) {
  let cur = obj;
  for (const seg of path.split('.')) {
    const arr = seg.endsWith('[]');
    const key = arr ? seg.slice(0, -2) : seg;
    if (cur === null || typeof cur !== 'object' || !(key in cur)) return undefined;
    cur = cur[key];
    if (arr) {
      if (!Array.isArray(cur)) return undefined;
      cur = cur[0];
    }
  }
  return cur;
}

const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;

function jsonType(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (Number.isInteger(v)) return 'integer';
  return typeof v;
}

/** A small JSON Schema validator for the keywords the generator uses. Returns error strings. */
function validate(schema, value, at = '$', errs = []) {
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  const t = jsonType(value);
  if (!types.includes(t) && !(t === 'integer' && types.includes('number'))) {
    errs.push(`${at}: ${t} is not ${types.join('|')}`);
    return errs;
  }
  if (schema.enum && !schema.enum.includes(value)) errs.push(`${at}: ${JSON.stringify(value)} not in enum`);
  if (typeof value === 'string') {
    if (schema.format === 'date-time' && !DATE_TIME.test(value)) errs.push(`${at}: not a date-time`);
    if (schema.format === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(value)) errs.push(`${at}: not a date`);
    if (schema.format === 'uri') {
      try {
        new URL(value);
      } catch {
        errs.push(`${at}: not a URI`);
      }
    }
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errs.push(`${at}: does not match ${schema.pattern}`);
  }
  if (t === 'object') {
    for (const k of schema.required || []) if (!(k in value)) errs.push(`${at}: missing required ${k}`);
    for (const [k, v] of Object.entries(value)) if (schema.properties && schema.properties[k]) validate(schema.properties[k], v, at + '.' + k, errs);
  }
  if (t === 'array' && schema.items) value.forEach((v, i) => validate(schema.items, v, `${at}[${i}]`, errs));
  return errs;
}

const BASE = {
  string: 'string',
  'string<date-time>': 'string',
  'string<date>': 'string',
  'string<currency>': 'string',
  'string<uri>': 'string',
  'string<masked>': 'string',
  'integer<minor units>': 'integer',
  integer: 'integer',
  number: 'number',
  boolean: 'boolean',
  object: 'object',
  array: 'array'
};

export default async function (ctx) {
  const { base, api, assert, step, features, root, reset } = ctx;
  const dr = loadDataReq(root);
  const ALL = features.map((f) => f.id).filter((id) => dr[id]);
  const id = (i) => features[i].id;

  async function until(fn, ms = 6000, label = 'condition') {
    const t0 = Date.now();
    for (;;) {
      const v = await fn();
      if (v) return v;
      if (Date.now() - t0 > ms) throw new Error('timed out waiting for ' + label);
      await sleep(80);
    }
  }

  /** Open the app at hash (default #/data) and collect CSP violations too. */
  async function openData(hash = '#/data', opts = {}) {
    const P = await openPage(ctx, opts);
    await P.context.addInitScript(() => {
      window.__csp = [];
      document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI));
    });
    if (opts.before) await opts.before(P.page);
    await gotoApp(P.page, base, hash);
    await waitForView(P.page, (hash.match(/^#\/(\w+)/) || [0, 'data'])[1]);
    return P;
  }
  const cards = (page) => page.$$eval('#view-data [data-dv-card]', (els) => els.map((e) => e.getAttribute('data-dv-card')));
  const scopeChecked = (page) => page.$eval('#view-data input[name="dv-scope"]:checked', (e) => e.value).catch(() => null);
  const explorerFeatures = (page) => page.evaluate(() => {
    const el = document.querySelector('#view-data [data-dv="explorer"]');
    return el && el._wtJson && el._wtJson.m ? el._wtJson.m.features : null;
  });
  async function chooseScope(page, value) {
    await page.click(`#view-data input[name="dv-scope"][value="${value}"]`);
  }
  async function noCsp(page) {
    assert.deepEqual(await page.evaluate(() => window.__csp), [], 'no CSP violations');
  }

  /* ------------------------------------------------------------------ */
  /* Merge, sample, schema                                               */
  /* ------------------------------------------------------------------ */

  const P0 = await openData('#/data');
  const page0 = P0.page;

  await step('merge: shared paths appear once and "needed by" is correct', async () => {
    const pick = ['journey', 'why', 'fees'].filter((x) => ALL.includes(x));
    assert.equal(pick.length, 3, 'reference features exist');
    for (const ids of [pick, ['theme'], ALL]) {
      const m = await page0.evaluate((x) => window.WT.json.merge(x), ids);
      const ref = referenceMerge(dr, ids);
      assert.deepEqual(m.features, ids);
      const paths = m.fields.map((f) => f.path);
      assert.equal(new Set(paths).size, paths.length, 'no duplicate paths');
      assert.equal(paths.length, ref.size, 'every distinct path, plus $common');
      for (const f of m.fields) {
        const r = ref.get(f.path);
        assert.ok(r, 'unexpected path ' + f.path);
        assert.deepEqual(f.neededBy, r.neededBy, 'neededBy ' + f.path);
        assert.deepEqual(f.listedBy, r.listedBy, 'listedBy ' + f.path);
        assert.equal(f.common, r.common, 'common ' + f.path);
        assert.equal(f.type, r.type);
        assert.equal(f.required, r.required);
        assert.deepEqual(f.example, r.example);
        assert.equal(f.source, r.source);
      }
    }
    const m = await page0.evaluate((x) => window.WT.json.merge(x), pick);
    const by = Object.fromEntries(m.fields.map((f) => [f.path, f]));
    assert.deepEqual(by['statement.opening'].neededBy, ['journey', 'why'], 'shared by two features');
    assert.deepEqual(by['transactions[].id'].neededBy, ['journey', 'why', 'fees'], 'shared by three');
    assert.deepEqual(by['transactions[].feeKind'].neededBy, ['why', 'fees']);
    assert.deepEqual(by['content.feeSchedule.uri'].neededBy, ['fees']);
    assert.equal(by['statement.id'].common, true);
    assert.deepEqual(by['statement.id'].neededBy, pick, 'the envelope is needed by every feature');
    // Ids are normalised to tour order; unknown ids are ignored; nothing selected → nothing merged.
    assert.deepEqual((await page0.evaluate(() => window.WT.json.merge(['fees', 'journey', 'nope']))).features, ['journey', 'fees']);
    assert.equal((await page0.evaluate(() => window.WT.json.merge([]))).fields.length, 0);
    assert.equal((await page0.evaluate(() => window.WT.json.merge('fees'))).features[0], 'fees');
  });

  await step('sample JSON: built from the examples, with the structure of the paths', async () => {
    for (const ids of [['fees'], ['journey', 'detail', 'download'], ALL]) {
      const sample = await page0.evaluate((x) => window.WT.json.sample(x), ids);
      const fields = [...referenceMerge(dr, ids).values()];
      assert.deepEqual(sample, referenceSample(fields), 'sample = reference built from paths and examples');
      for (const f of fields) {
        const v = valueAt(sample, f.path);
        assert.deepEqual(v, f.example, 'example at ' + f.path);
      }
    }
    const s = await page0.evaluate(() => window.WT.json.sample(['download']));
    assert.ok(Array.isArray(s.transactions) && s.transactions.length === 1, 'lists show one item');
    assert.ok(Array.isArray(s.customer.address), 'customer.address[] is a list of strings');
  });

  await step('schema: valid draft 2020-12 structure that matches the paths and validates the sample', async () => {
    for (const ids of [['fees'], ['explorer', 'video'], ALL]) {
      const schema = await page0.evaluate((x) => window.WT.json.schema(x), ids);
      const ref = referenceMerge(dr, ids);
      const fields = [...ref.values()];
      assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
      assert.equal(schema.type, 'object');
      assert.ok(typeof schema.title === 'string' && schema.description.length > 20);
      // Every object node: properties + required ⊆ properties; every array: items.
      (function walk(s, at) {
        const types = Array.isArray(s.type) ? s.type : [s.type];
        assert.ok(types.length && types.every((t) => ['object', 'array', 'string', 'integer', 'number', 'boolean', 'null'].includes(t)), at + ' type');
        assert.ok(typeof s.description === 'string' || at === '$', at + ' has a description');
        if (types.includes('object') && s.properties) {
          assert.ok(Array.isArray(s.required), at + ' has a required array');
          for (const k of s.required) assert.ok(k in s.properties, `${at}.required ${k} is a property`);
          assert.equal(new Set(s.required).size, s.required.length);
          for (const [k, v] of Object.entries(s.properties)) walk(v, at + '.' + k);
        }
        if (types.includes('array')) {
          assert.ok(s.items && typeof s.items === 'object', at + ' has items');
          walk({ description: '', ...s.items }, at + '[]');
        }
      })(schema, '$');
      // Each field path resolves to a leaf with the right type, description, example and required flag.
      const anyRequiredUnder = (prefix) => fields.some((f) => f.required && (f.path === prefix || f.path.startsWith(prefix + '.') || f.path.startsWith(prefix + '[]')));
      for (const f of fields) {
        const segs = f.path.split('.');
        let s = schema;
        let prefix = '';
        segs.forEach((seg, i) => {
          const arr = seg.endsWith('[]');
          const key = arr ? seg.slice(0, -2) : seg;
          const parentObj = s.type === 'array' ? s.items : s;
          assert.ok(parentObj.properties && parentObj.properties[key], `${f.path}: ${key} in properties`);
          const isReq = (parentObj.required || []).includes(key);
          const p = prefix ? prefix + '.' + key : key;
          const last = i === segs.length - 1;
          if (last) assert.equal(isReq, f.required, `${f.path} required flag`);
          else assert.equal(isReq, anyRequiredUnder(prefix ? prefix + '.' + seg.replace('[]', '') : key) || anyRequiredUnder(p), `${p} required when something inside is`);
          s = parentObj.properties[key];
          if (arr) {
            assert.equal(s.type, 'array', `${p} is an array`);
            assert.ok(s.items, `${p} has items`);
          }
          prefix = prefix ? prefix + '.' + seg : seg;
          if (!last && arr) s = { type: 'array', items: s.items };
        });
        const leaf = f.path.endsWith('[]') ? s.items : s;
        const lt = Array.isArray(leaf.type) ? leaf.type[0] : leaf.type;
        assert.equal(lt, f.type.startsWith('string<enum') ? 'string' : BASE[f.type], `${f.path} type`);
        if (f.type.startsWith('string<enum')) assert.ok(leaf.enum.includes(f.example), `${f.path} enum has the example`);
        if (f.type === 'string<date-time>') assert.equal(leaf.format, 'date-time');
        if (f.type === 'string<uri>') assert.equal(leaf.format, 'uri');
        assert.equal(s.description, f.description, `${f.path} description`);
        assert.ok(Array.isArray(s.examples) && s.examples.length === 1, `${f.path} examples`);
        assert.deepEqual(f.path.endsWith('[]') ? s.examples[0][0] : s.examples[0], f.example, `${f.path} example`);
        assert.match(s.$comment || '', /Source: /, `${f.path} names its source`);
      }
      const sample = await page0.evaluate((x) => window.WT.json.sample(x), ids);
      assert.deepEqual(validate(schema, sample), [], 'the sample validates against the schema');
      // And the schema really constrains: dropping a required field is an error.
      const broken = JSON.parse(JSON.stringify(sample));
      delete broken.statement.id;
      assert.ok(validate(schema, broken).some((e) => /missing required id/.test(e)), 'required is enforced');
    }
  });

  /* ------------------------------------------------------------------ */
  /* Tree view                                                           */
  /* ------------------------------------------------------------------ */

  await step('tree: WAI-ARIA roles and states, roving tabindex, keyboard and type-ahead', async () => {
    const page = page0;
    await chooseScope(page, 'all');
    await until(async () => (await cards(page)).length === ALL.length, 6000, 'all cards');
    const tree = page.locator('#view-data [role="tree"]');
    assert.equal(await tree.count(), 1);
    assert.ok((await tree.getAttribute('aria-label')).length > 0, 'tree is labelled');

    const audit = () =>
      page.evaluate(() => {
        const tree = document.querySelector('#view-data [role="tree"]');
        const items = [...tree.querySelectorAll('[role="treeitem"]')];
        const problems = [];
        for (const li of items) {
          const depth = (() => {
            let d = 1;
            for (let p = li.parentElement.closest('[role="treeitem"]'); p; p = p.parentElement.closest('[role="treeitem"]')) d++;
            return d;
          })();
          if (Number(li.getAttribute('aria-level')) !== depth) problems.push('level ' + li.id);
          const group = li.querySelector(':scope > [role="group"]');
          if (group && !['true', 'false'].includes(li.getAttribute('aria-expanded'))) problems.push('expanded missing ' + li.id);
          if (!group && li.hasAttribute('aria-expanded')) problems.push('leaf with aria-expanded ' + li.id);
          if (group && group.hidden !== (li.getAttribute('aria-expanded') === 'false')) problems.push('group visibility ' + li.id);
          if (!['true', 'false'].includes(li.getAttribute('aria-selected'))) problems.push('aria-selected ' + li.id);
          const label = document.getElementById(li.getAttribute('aria-labelledby'));
          if (!label || !label.textContent.trim()) problems.push('label ' + li.id);
        }
        // setsize/posinset among the siblings that are shown.
        for (const list of [tree, ...tree.querySelectorAll('[role="group"]')]) {
          const kids = [...list.children].filter((c) => c.getAttribute('role') === 'treeitem' && !c.hidden);
          kids.forEach((c, i) => {
            if (Number(c.getAttribute('aria-setsize')) !== kids.length || Number(c.getAttribute('aria-posinset')) !== i + 1) problems.push('set ' + c.id);
          });
        }
        const zero = items.filter((li) => li.tabIndex === 0);
        return { problems, n: items.length, zero: zero.length, zeroIsFocused: zero[0] === document.activeElement };
      });
    let a = await audit();
    assert.deepEqual(a.problems, []);
    assert.ok(a.n > 150, 'all nodes rendered');
    assert.equal(a.zero, 1, 'exactly one treeitem is in the tab order');

    // Tab from the search box reaches the tree (one stop), then leaves it.
    await page.click('#view-data .wt-jx__q');
    for (let i = 0; i < 4 && (await focused(page)).role !== 'treeitem'; i++) await page.keyboard.press('Tab');
    let f = await focused(page);
    assert.equal(f.role, 'treeitem', 'Tab reaches the tree');
    const key = () => page.evaluate(() => document.activeElement.querySelector('.wt-jx__key').textContent);
    const attr = (name) => page.evaluate((n) => document.activeElement.getAttribute(n), name);
    assert.equal(await key(), 'statement', 'the first node');
    assert.equal(await attr('aria-level'), '1');

    await page.keyboard.press('ArrowDown');
    assert.equal(await key(), 'id');
    assert.equal(await attr('aria-level'), '2');
    a = await audit();
    assert.ok(a.zeroIsFocused && a.zero === 1, 'roving tabindex follows focus');

    await page.keyboard.press('ArrowUp');
    assert.equal(await key(), 'statement');
    // Type-ahead: "p" jumps to the next node starting with p.
    await page.keyboard.press('p');
    assert.equal(await key(), 'period');
    assert.equal(await attr('aria-expanded'), 'false', 'nested groups start collapsed');
    await page.keyboard.press('ArrowRight');
    assert.equal(await attr('aria-expanded'), 'true', 'Right opens');
    await page.keyboard.press('ArrowRight');
    assert.equal(await key(), 'start', 'Right again moves to the first child');
    assert.equal(await attr('aria-level'), '3');
    await page.keyboard.press('ArrowLeft');
    assert.equal(await key(), 'period', 'Left moves to the parent');
    await page.keyboard.press('ArrowLeft');
    assert.equal(await attr('aria-expanded'), 'false', 'Left closes');
    // * expands every sibling group.
    await page.keyboard.press('*');
    const sibs = await page.evaluate(() =>
      [...document.activeElement.parentElement.children].filter((c) => c.hasAttribute('aria-expanded')).map((c) => c.getAttribute('aria-expanded'))
    );
    assert.ok(sibs.length >= 3 && sibs.every((v) => v === 'true'), '* expanded the siblings: ' + sibs);
    // Enter/Space select and show details.
    await page.keyboard.press('Home');
    assert.equal(await key(), 'statement', 'Home');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    assert.equal(await attr('aria-selected'), 'true');
    assert.equal(await page.locator('#view-data .wt-jx__path-code').innerText(), 'statement.id');
    assert.equal(await page.locator('#view-data .wt-jx__dtitle').innerText(), 'id');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press(' ');
    assert.equal(await page.locator('#view-data .wt-jx__path-code').innerText(), 'statement.version', 'Space selects');
    assert.equal(await page.locator('#view-data [role="treeitem"][aria-selected="true"]').count(), 1, 'single selection');
    // Multi-character type-ahead.
    await page.keyboard.type('tr');
    assert.equal(await key(), 'transactions[]', 'type-ahead with several letters');
    assert.equal(await page.evaluate(() => document.activeElement.querySelector('.wt-jx__brackets').textContent), '[]', 'arrays show []');
    assert.match(await page.evaluate(() => document.activeElement.querySelector('.wt-jx__type').textContent), /^List of records$/);
    await page.keyboard.press('End');
    const last = await page.evaluate(() => {
      const items = [...document.querySelectorAll('#view-data [role="treeitem"]')].filter((li) => li.offsetParent !== null);
      return items[items.length - 1] === document.activeElement;
    });
    assert.ok(last, 'End goes to the last visible node');
    // Each node shows key, type, required/optional and an example.
    const row = await page.evaluate(() => {
      const li = [...document.querySelectorAll('#view-data [role="treeitem"]')].find((x) => x.querySelector('.wt-jx__key').textContent === 'asOf');
      return {
        type: li.querySelector('.wt-jx__type').textContent,
        tech: li.querySelector('.wt-jx__type').getAttribute('title'),
        req: li.querySelector('.wt-jx__req').textContent,
        ex: li.querySelector('.wt-jx__ex').textContent
      };
    });
    assert.equal(row.type, 'Text (date and time)');
    assert.equal(row.tech, 'string<date-time>');
    assert.equal(row.req, 'Required');
    assert.match(row.ex, /"2026-09-30T23:59:59-04:00"/);
    // Tab leaves the tree.
    await page.keyboard.press('Tab');
    assert.notEqual((await focused(page)).role, 'treeitem', 'Tab leaves the tree');
    // Mouse: the twisty toggles without selecting; a row click selects.
    const ctl = page.locator('#view-data [role="treeitem"]', { has: page.locator(':scope > .wt-jx__row .wt-jx__key', { hasText: /^controlTotals$/ }) });
    const before = await ctl.getAttribute('aria-expanded');
    await ctl.locator(':scope > .wt-jx__row .wt-jx__twisty').click();
    assert.notEqual(await ctl.getAttribute('aria-expanded'), before, 'twisty toggles');
    assert.equal(await ctl.getAttribute('aria-selected'), 'false');
    await ctl.locator(':scope > .wt-jx__row .wt-jx__key').click();
    assert.equal(await ctl.getAttribute('aria-selected'), 'true');
    assert.match(await page.locator('#view-data .wt-jx__details').innerText(), /Contains\s+2 fields/i);
    // Details for a leaf: type in plain words and technically, required, source, example, needed-by links.
    await page.evaluate(() => document.querySelector('#view-data [data-dv="explorer"]')._wtJson.select('transactions[].amount'));
    const d = page.locator('#view-data .wt-jx__details');
    const text = await d.innerText();
    assert.match(text, /Whole number \(minor units\)/);
    assert.match(text, /integer<minor units>/);
    assert.match(text, /Required/);
    assert.match(text, /Core ledger/);
    assert.match(text, /-20000/);
    const links = await d.locator('.wt-jx__nb a').evaluateAll((as) => as.map((x) => x.getAttribute('href')));
    const needs = referenceMerge(dr, ALL).get('transactions[].amount').neededBy;
    for (const nid of needs) {
      assert.ok(links.includes('#/tour/' + nid), 'tour link ' + nid);
      assert.ok(links.includes('#/results/' + nid), 'results link ' + nid);
    }
    assert.match(await d.locator('.wt-jx__nb-n').innerText(), new RegExp('^' + needs.length + '$'));
    // Expand all / collapse all.
    await page.click('#view-data [data-jx-act="expand"]');
    assert.equal(await page.locator('#view-data [role="treeitem"][aria-expanded="false"]').count(), 0);
    await page.click('#view-data [data-jx-act="collapse"]');
    assert.equal(await page.locator('#view-data [role="treeitem"][aria-expanded="true"]').count(), 0);
    assert.equal(await page.locator('#view-data [role="treeitem"][aria-level="2"]').evaluateAll((els) => els.filter((e) => e.offsetParent !== null).length), 0);
    a = await audit();
    assert.deepEqual(a.problems, []);
    assert.equal(a.zero, 1);
    assertNoErrors(P0.errors, assert, P0.external);
  });

  await step('search: filters by key, description or source, keeps ancestors, highlights, counts and announces', async () => {
    const page = page0;
    const q = page.locator('#view-data .wt-jx__q');
    await q.fill('fee');
    await until(async () => /matches for “fee”/.test(await page.locator('#view-data .wt-jx__count').innerText()), 3000, 'count');
    const res = await page.evaluate(() => {
      const items = [...document.querySelectorAll('#view-data [role="treeitem"]')];
      const shown = items.filter((li) => !li.hidden);
      const matched = shown.filter((li) => li.querySelector(':scope > .wt-jx__row .wt-jx__mark'));
      const marks = [...document.querySelectorAll('#view-data [role="tree"] .wt-jx__mark')].map((m) => m.textContent.toLowerCase());
      const hiddenAncestor = matched.some((li) => {
        for (let p = li.parentElement.closest('[role="treeitem"]'); p; p = p.parentElement.closest('[role="treeitem"]')) if (p.hidden || p.getAttribute('aria-expanded') !== 'true') return true;
        return false;
      });
      return {
        count: document.querySelector('#view-data .wt-jx__count').textContent,
        shownPaths: shown.map((li) => li.getAttribute('data-fk').replace(/^[^:]+:/, '')),
        matched: matched.length,
        marks: [...new Set(marks)],
        hiddenAncestor
      };
    });
    const n = Number(res.count.match(/^(\d+)/)[1]);
    assert.equal(n, res.matched, 'the count is the number of highlighted nodes');
    assert.deepEqual(res.marks, ['fee'], 'matches are highlighted');
    assert.ok(!res.hiddenAncestor, 'every match is shown with its ancestors expanded');
    // Every field whose key, description or source mentions "fee" is shown; statement.id is not.
    for (const f of referenceMerge(dr, ALL).values()) {
      const key = f.path.split('.').pop().replace('[]', '');
      if ((key + ' ' + f.description + ' ' + f.source).toLowerCase().includes('fee')) assert.ok(res.shownPaths.includes(f.path), 'shown ' + f.path);
    }
    assert.ok(!res.shownPaths.includes('statement.id'), 'non-matching fields are hidden');
    assert.ok(res.shownPaths.includes('transactions[]'), 'ancestors are kept');
    await until(async () => /matches for fee/.test(await page.locator('#wt-live').innerText()), 3000, 'polite announcement');
    // Description and source matches show where they matched.
    await q.fill('AI service');
    await until(async () => /matches for “AI service”/.test(await page.locator('#view-data .wt-jx__count').innerText()), 3000, 'source count');
    assert.ok((await page.locator('#view-data .wt-jx__snip', { hasText: 'Source:' }).count()) > 3, 'source snippets');
    // No match: a message and a way out.
    await q.fill('zzqx');
    await until(async () => !(await page.locator('#view-data .wt-jx__nomatch').isHidden()), 3000, 'no-match message');
    assert.match(await page.locator('#view-data .wt-jx__count').innerText(), /No matches/);
    assert.ok(await page.locator('#view-data [role="tree"]').isHidden());
    await until(async () => /No fields match zzqx/.test(await page.locator('#wt-live').innerText()), 3000, 'no-match announcement');
    await page.click('#view-data [data-jx-act="clear"]');
    assert.equal(await q.inputValue(), '');
    assert.equal((await focused(page)).tag, 'input', 'focus returns to the search box');
    assert.ok(await page.locator('#view-data [role="tree"]').isVisible());
    assert.equal(await page.locator('#view-data [role="treeitem"][hidden]').count(), 0, 'everything is back');
    // Escape clears a search.
    await q.fill('ledger');
    await sleep(200);
    await q.press('Escape');
    assert.equal(await q.inputValue(), '');
    await sleep(200);
    assert.match(await page.locator('#view-data .wt-jx__count').innerText(), /fields in \d+ groups/);
    assertNoErrors(P0.errors, assert, P0.external);
  });

  await step('copy: the path and the sample JSON reach the clipboard', async () => {
    const page = page0;
    await P0.context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
    await page.locator('#view-data .wt-jx__q').fill('balanceAfter');
    await sleep(250);
    const item = page.locator('#view-data [role="treeitem"]:not([hidden])', { has: page.locator(':scope > .wt-jx__row .wt-jx__key', { hasText: /^balanceAfter$/ }) });
    await item.locator(':scope > .wt-jx__row').click();
    await page.click('#view-data [data-jx-act="copy-path"]');
    await until(async () => (await page.evaluate(() => navigator.clipboard.readText())) === 'transactions[].balanceAfter', 3000, 'path on the clipboard');
    assert.match(await page.locator('#view-data [data-jx-act="copy-path"]').innerText(), /Copied/);
    await page.click('#view-data [role="tab"][data-jx-tab="sample"]');
    assert.ok(await page.locator('#view-data .wt-jx__sample').isVisible());
    const want = await page.evaluate((x) => window.WT.json.sample(x), ALL);
    assert.equal(await page.locator('#view-data .wt-jx__sample').evaluate((e) => e.textContent), JSON.stringify(want, null, 2), 'the shown JSON is the sample');
    await page.click('#view-data [data-jx-act="copy-json"]');
    await until(async () => (await page.evaluate(() => navigator.clipboard.readText())).startsWith('{'), 3000, 'JSON on the clipboard');
    assert.deepEqual(JSON.parse(await page.evaluate(() => navigator.clipboard.readText())), want);
    assertNoErrors(P0.errors, assert, P0.external);
  });

  await step('download: sample and JSON Schema files save under the CSP', async () => {
    const page = page0;
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#view-data [data-jx-act="download-sample"]')]);
    assert.equal(dl.suggestedFilename(), 'yes-statement-sample.json');
    const sample = JSON.parse(readFileSync(await dl.path(), 'utf8'));
    assert.deepEqual(sample, await page.evaluate((x) => window.WT.json.sample(x), ALL));
    const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('#view-data [data-jx-act="schema"]')]);
    assert.equal(dl2.suggestedFilename(), 'yes-statement-data-requirements.schema.json');
    const schema = JSON.parse(readFileSync(await dl2.path(), 'utf8'));
    assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
    assert.deepEqual(schema, await page.evaluate((x) => window.WT.json.schema(x), ALL));
    assert.deepEqual(validate(schema, sample), []);
    // The "By source" tab adds up.
    await page.click('#view-data [role="tab"][data-jx-tab="sources"]');
    const stats = await page.evaluate((x) => window.WT.json.stats(x), ALL);
    const rows = await page.locator('#view-data .wt-jx__srctable tbody tr').count();
    assert.equal(rows, stats.sources.length);
    assert.equal(stats.sources.reduce((a, s) => a + s.fields, 0), stats.fields);
    assert.equal(stats.required + stats.optional, stats.fields);
    assert.equal(await page.locator('#view-data .wt-jx__stat--fields dd').innerText(), String(stats.fields));
    await noCsp(page);
    assertNoErrors(P0.errors, assert, P0.external);
  });
  await P0.close();

  /* ------------------------------------------------------------------ */
  /* Scopes                                                              */
  /* ------------------------------------------------------------------ */

  await step('scope switch: mine and the group, from answers seeded through the API; fine-tuning; live updates', async () => {
    await reset();
    const [A, B, C, D, E, F, G] = [0, 1, 2, 3, 4, 5, 6].map(id);
    const storage = await seedBrowserReviewer(api, {
      name: 'Robin',
      answers: { [A]: { vote: 'include', priority: 'high' }, [B]: { vote: 'include' }, [C]: { vote: 'exclude' } },
      lastStep: C
    });
    await seedReviewer(api, { name: 'Sam', answers: { [B]: { vote: 'exclude' }, [C]: { vote: 'include' }, [D]: { vote: 'include' }, [E]: { vote: 'include' } } });
    await seedReviewer(api, { answers: { [C]: { vote: 'exclude' }, [E]: { vote: 'exclude' }, [F]: { vote: 'exclude' } } });
    await seedReviewer(api, { answers: { [E]: { vote: 'exclude' }, [G]: { priority: 'high' } } });
    // Expected from the API itself, by the one shared rule (WT.results.wanted,
    // also the Results tile): more include than exclude votes. B is a 1–1 tie,
    // so it is not wanted.
    const results = (await api('/api/results')).json;
    const group = ALL.filter((x) => results.features[x].include > results.features[x].exclude);
    assert.deepEqual(group, [A, D], 'the seeded votes give the expected group');

    const P = await openData('#/data', { storage });
    const { page } = P;
    try {
      assert.equal(await scopeChecked(page), 'mine', 'mine is the default');
      await until(async () => (await cards(page)).join() === [A, B].join(), 6000, 'my cards');
      assert.deepEqual(await explorerFeatures(page), [A, B]);
      const mergeAB = await page.evaluate((x) => window.WT.json.merge(x).fields.length, [A, B]);
      assert.equal(await page.locator('#view-data .wt-jx__stat--fields dd').innerText(), String(mergeAB));
      assert.match(await page.locator('#view-data [data-dv="summary"]').innerText(), new RegExp('2 features: ' + mergeAB + ' fields'));
      // The vote badges on the cards.
      assert.match(await page.locator(`[data-dv-card="${A}"] .wt-dv__votes`).innerText(), /You:\s*Include/);

      await chooseScope(page, 'group');
      await until(async () => (await cards(page)).join() === group.join(), 6000, 'group cards');
      assert.deepEqual(await explorerFeatures(page), group);
      assert.match(await page.locator('#view-data input[value="group"] ~ .wt-dv__opt-body .wt-dv__opt-title').innerText(), /^Features most reviewers want$/);
      assert.match(await page.locator('#view-data input[value="group"] ~ .wt-dv__opt-body .wt-dv__opt-desc').innerText(), /^2 features with more include than exclude votes$/);
      assert.match(await page.locator(`[data-dv-card="${A}"] .wt-dv__votes`).innerText(), /Group:\s*100% include · 1 vote/);
      // The shared rule: a tie, no votes or a missing feature is not wanted.
      assert.equal(
        await page.evaluate(() => [{ include: 2, exclude: 1 }, { include: 1, exclude: 1 }, { include: 0, exclude: 0 }, null].map((x) => window.WT.results.wanted(x)).join()),
        'true,false,false,false'
      );
      // The page shows statement screenshots, so it carries the compact branding notice under the intro.
      assert.equal(await page.locator('#view-data .wt-dv__head [data-brand-notice="compact"]').count(), 1, 'branding notice');

      await chooseScope(page, 'all');
      await until(async () => (await cards(page)).length === ALL.length, 6000, 'all cards');
      // Fine-tune: unticking a feature switches to Custom.
      await page.click('#view-data .wt-dv__fine > summary');
      assert.equal(await page.locator('#view-data .wt-dv__fine').getAttribute('open'), '');
      await page.click(`#view-data [data-dv-feature="${A}"]`);
      await until(async () => (await scopeChecked(page)) === 'custom', 3000, 'custom');
      assert.deepEqual(await cards(page), ALL.filter((x) => x !== A));
      assert.equal((await focused(page)).fk, 'dv-f-' + A, 'focus stays on the checkbox');
      assert.match(await page.locator('#view-data .wt-dv__fine-count').innerText(), new RegExp(`${ALL.length - 1} of ${ALL.length} selected`));
      await page.click('#view-data [data-dv-act="select-none"]');
      assert.deepEqual(await cards(page), []);
      assert.match(await page.locator('#view-data .wt-dv__empty').innerText(), /No features selected/);
      await page.click(`#view-data [data-dv-feature="${E}"]`);
      assert.deepEqual(await cards(page), [E]);
      // Back to "mine"; a new Include in this browser shows up straight away.
      await chooseScope(page, 'mine');
      assert.deepEqual(await cards(page), [A, B]);
      await page.evaluate((x) => window.WT.answers.set(x, { vote: 'include' }), D);
      await until(async () => (await cards(page)).join() === [A, B, D].join(), 3000, 'live update');
      await page.evaluate((x) => window.WT.answers.set(x, { vote: 'exclude' }), A);
      await until(async () => (await cards(page)).join() === [B, D].join(), 3000, 'live update after exclude');
      await shot(page, 'data-scope-mine-desktop-light', { fullPage: true });
      await noCsp(page);
      assertNoErrors(P.errors, assert, P.external);
    } finally {
      await P.close();
    }
  });

  await step('deep link: #/data/<featureId> preselects that feature; param changes and scope changes', async () => {
    await reset();
    const fid = ALL.includes('fees') ? 'fees' : ALL[0];
    const P = await openData('#/data/' + fid);
    const { page } = P;
    try {
      assert.equal(await scopeChecked(page), 'custom');
      assert.deepEqual(await cards(page), [fid]);
      assert.deepEqual(await explorerFeatures(page), [fid]);
      assert.equal(await page.locator(`[data-dv-card="${fid}"] a[href="#/data/${fid}"]`).count(), 0, 'no "only this feature" link when it is alone');
      assert.equal(await page.locator(`[data-dv-card="${fid}"] a[href="#/tour/${fid}"]`).count(), 1);
      assert.equal(await page.locator(`[data-dv-card="${fid}"] a[href="#/results/${fid}"]`).count(), 1);
      assert.equal(await page.locator(`[data-dv-card="${fid}"] img`).getAttribute('src'), `assets/shots/${fid}-thumb.jpg`);
      const title = features.find((f) => f.id === fid).title;
      assert.equal(await page.title(), `Data requirements: ${title} · YES statement review · InfoSlips`);
      assert.equal(await page.locator('#view-data h1').innerText(), 'Data requirements');
      // A single feature's tree is fully expanded.
      assert.equal(await page.locator('#view-data [role="treeitem"][aria-expanded="false"]').count(), 0);
      // Another deep link within the view.
      await page.evaluate(() => window.WT.go('/data/journey'));
      await until(async () => (await cards(page)).join() === 'journey', 3000, 'journey');
      assert.equal((await focused(page)).tag, 'h1', 'the heading takes focus on navigation');
      // Picking another scope drops the id from the URL and keeps focus on the choice.
      await chooseScope(page, 'all');
      assert.equal(await page.evaluate(() => location.hash), '#/data');
      assert.equal((await focused(page)).fk, 'dv-scope-all');
      assert.equal(await page.title(), 'Data requirements · YES statement review · InfoSlips');
      // Card link "Only this feature".
      await page.click(`[data-dv-card="explorer"] a[href="#/data/explorer"]`);
      await until(async () => (await cards(page)).join() === 'explorer', 3000, 'only this feature');
      assert.equal(await page.evaluate(() => location.hash), '#/data/explorer');
      // An unknown id explains itself and keeps the default scope.
      await page.evaluate(() => (location.hash = '#/data/no-such-feature'));
      await until(async () => (await page.locator('#view-data .wt-dv__status').innerText()).includes('We couldn’t find that feature.'), 3000, 'unknown feature notice');
      // Coming back to plain #/data after a deep link shows "mine" again.
      await page.evaluate(() => window.WT.go('/start'));
      await waitForView(page, 'start');
      await page.evaluate(() => window.WT.go('/data/fees'));
      await waitForView(page, 'data');
      await page.evaluate(() => window.WT.go('/data'));
      await until(async () => (await scopeChecked(page)) === 'mine', 3000, 'mine after a deep link');
      await noCsp(page);
      assertNoErrors(P.errors, assert, P.external);
    } finally {
      await P.close();
    }
  });

  await step('empty state: explains how to include features and links to the walkthrough', async () => {
    await reset();
    const P = await openData('#/data');
    const { page } = P;
    try {
      const empty = page.locator('#view-data .wt-dv__empty');
      assert.ok(await empty.isVisible());
      assert.equal(await empty.locator('h2').innerText(), 'You haven’t included any features yet');
      assert.match(await empty.innerText(), /vote Include on each feature/);
      assert.equal(await empty.locator('a[href="#/tour"]').innerText(), 'Start the walkthrough');
      assert.ok(await page.locator('#view-data [data-dv="explore"]').isHidden(), 'no explorer');
      assert.ok(await page.locator('#view-data [data-dv="features"]').isHidden(), 'no cards');
      await shot(page, 'data-empty-desktop-light');
      await empty.locator('[data-dv-act="scope-all"]').click();
      await until(async () => (await cards(page)).length === ALL.length, 3000, 'all');
      assert.equal((await focused(page)).fk, 'dv-scope-all', 'focus moves to the chosen option');
      // The group's empty state when nobody has voted.
      await chooseScope(page, 'group');
      await until(async () => (await page.locator('#view-data .wt-dv__empty h2').count()) === 1, 6000, 'group empty');
      assert.equal(await page.locator('#view-data .wt-dv__empty h2').innerText(), 'No feature has more include than exclude votes yet');
      assert.equal(await page.locator('#view-data .wt-dv__empty a[href="#/results"]').count(), 1);
      assertNoErrors(P.errors, assert, P.external);
    } finally {
      await P.close();
    }
  });

  await step('results API down: the group option shows a notice; the other scopes still work; retry recovers', async () => {
    await reset();
    const [A, B] = [id(0), id(1)];
    const storage = await seedBrowserReviewer(api, { answers: { [A]: { vote: 'include' }, [B]: { vote: 'include' } } });
    let down = true;
    const P = await openData('#/data', {
      storage,
      before: (page) =>
        page.route('**/api/results*', (route) => {
          if (down) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'server_error', message: 'The results are unavailable right now.' } }) });
          return route.continue();
        })
    });
    const { page } = P;
    try {
      assert.deepEqual(await cards(page), [A, B], 'mine works without the results API');
      await chooseScope(page, 'group');
      const notice = page.locator('#view-data .wt-dv__status .wt-notice');
      await until(async () => (await notice.count()) === 1 && /couldn’t load everyone’s votes/.test(await notice.innerText()), 6000, 'notice');
      assert.equal(await notice.getAttribute('role'), 'status');
      assert.match(await notice.innerText(), /The other options still work/);
      assert.match(await page.locator('#view-data input[value="group"] ~ .wt-dv__opt-body .wt-dv__opt-desc').innerText(), /couldn’t be loaded/);
      assert.ok(await page.locator('#view-data [data-dv="explore"]').isHidden());
      assert.equal(await page.locator('#view-data .wt-dv__empty').count(), 0, 'not mistaken for an empty result');
      await chooseScope(page, 'all');
      await until(async () => (await cards(page)).length === ALL.length, 3000, 'all still works');
      assert.equal(await notice.count(), 0, 'the notice belongs to the group option');
      await chooseScope(page, 'mine');
      assert.deepEqual(await cards(page), [A, B]);
      // Network failure, then recovery with "Try again".
      await page.unroute('**/api/results*');
      await page.route('**/api/results*', (route) => (down ? route.abort('connectionfailed') : route.continue()));
      await chooseScope(page, 'group');
      await until(async () => (await page.locator('#view-data [data-dv-act="retry"]').count()) === 1, 6000, 'retry button');
      down = false;
      await page.click('#view-data [data-dv-act="retry"]');
      await until(async () => (await cards(page)).join() === [A, B].join(), 6000, 'group after retry');
      assert.equal(await page.locator('#view-data .wt-dv__status .wt-notice').count(), 0);
      await noCsp(page);
      assertNoErrors(P.errors, assert, P.external);
    } finally {
      await P.close();
    }
  });

  /* ------------------------------------------------------------------ */
  /* Compact mode, layout, accessibility, screenshots                    */
  /* ------------------------------------------------------------------ */

  await step('compact: WT.json.mount inside a dialog fits a phone, works by keyboard and announces in the dialog', async () => {
    await reset();
    for (const vp of ['phone', 'narrow', 'desktop']) {
      const Q = await openData('#/start', { viewport: vp, colorScheme: vp === 'phone' ? 'dark' : 'light' });
      const { page } = Q;
      try {
        await page.evaluate(() => {
          const btn = document.createElement('button');
          btn.id = 't-trigger';
          btn.textContent = 'View data requirements';
          document.querySelector('#view-start').appendChild(btn);
          const d = window.WT.dialog.create({ id: 't-dlg', title: 'Data requirements: Fees this period', wide: true, body: '<div id="t-host"></div>' });
          window.__x = window.WT.json.mount(d.querySelector('#t-host'), { features: ['fees'], compact: true });
          window.WT.dialog.open(d, { trigger: btn });
        });
        const dlg = page.locator('#t-dlg');
        assert.ok(await dlg.isVisible());
        assert.equal(await dlg.locator('.wt-jx--compact').count(), 1);
        const fit = await page.evaluate(() => {
          const d = document.getElementById('t-dlg');
          const body = d.querySelector('.wt-dialog__body');
          const r = d.getBoundingClientRect();
          const tree = d.querySelector('.wt-jx__treewrap').getBoundingClientRect();
          const det = d.querySelector('.wt-jx__details').getBoundingClientRect();
          return {
            bodyOverflow: body.scrollWidth - body.clientWidth,
            pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
            inside: tree.left >= r.left - 1 && tree.right <= r.right + 1,
            stacked: det.top >= tree.bottom - 1,
            side: det.left >= tree.right - 1,
            w: window.innerWidth
          };
        });
        assert.ok(fit.bodyOverflow <= 1, 'no horizontal scroll in the dialog body: ' + fit.bodyOverflow);
        assert.ok(fit.pageOverflow <= 0, 'no horizontal page scroll');
        assert.ok(fit.inside, 'the tree fits the dialog');
        if (vp === 'desktop') assert.ok(fit.side, 'tree and details side by side in a wide dialog');
        else assert.ok(fit.stacked, 'tree and details stack on phones');
        // Keyboard inside the dialog.
        await page.locator('#t-dlg [role="treeitem"][tabindex="0"]').focus();
        const k0 = await page.evaluate(() => document.activeElement.querySelector('.wt-jx__key').textContent);
        await page.keyboard.press('ArrowDown');
        const k1 = await page.evaluate(() => document.activeElement.querySelector('.wt-jx__key').textContent);
        assert.notEqual(k0, k1, 'arrow keys move');
        await page.keyboard.press('Enter');
        assert.ok((await page.locator('#t-dlg .wt-jx__path-code').count()) === 1, 'details shown');
        // Search announces inside the modal (so screen readers hear it).
        await page.locator('#t-dlg .wt-jx__q').fill('fee');
        await until(async () => /matches for fee/.test(await page.locator('#t-dlg .wt-dialog-live--polite').innerText().catch(() => '')), 3000, 'announcement in the dialog');
        // Escape in a non-empty search clears it and keeps the dialog open.
        await page.locator('#t-dlg .wt-jx__q').press('Escape');
        assert.ok(await dlg.isVisible(), 'Escape cleared the search, not the dialog');
        assert.equal(await page.locator('#t-dlg .wt-jx__q').inputValue(), '');
        if (vp === 'phone') await shot(page, 'data-dialog-phone-dark');
        if (vp === 'desktop') await shot(page, 'data-dialog-desktop-light');
        // A "needed by" link leaves the dialog.
        await page.evaluate(() => window.__x.select('content.feeSchedule.uri'));
        await page.locator('#t-dlg .wt-jx__nb a[href="#/results/fees"]').click();
        await until(async () => !(await dlg.isVisible()), 3000, 'dialog closed');
        assert.equal(await page.evaluate(() => location.hash), '#/results/fees');
        await noCsp(page);
        assertNoErrors(Q.errors, assert, Q.external);
      } finally {
        await Q.close();
      }
    }
    // Inside any dialog the explorer is compact by default; destroy() cleans up.
    const D = await openData('#/start');
    try {
      const r = await D.page.evaluate(() => {
        const d = window.WT.dialog.create({ id: 't-dlg2', title: 'Data', body: '<div id="t-host2"></div>' });
        const host = d.querySelector('#t-host2');
        const x = window.WT.json.mount(host, { features: ['theme'] });
        const compact = !!host.querySelector('.wt-jx--compact');
        const same = window.WT.json.mount(host, { features: ['theme', 'language'] }) === x;
        const merged = x.m.features.join();
        x.destroy();
        const cleared = host.innerHTML === '' && !host._wtJson;
        const again = window.WT.json.mount(host, { features: ['theme'] });
        return { compact, same, merged, cleared, fresh: again !== x && !!host.querySelector('[role="tree"]') };
      });
      assert.deepEqual(r, { compact: true, same: true, merged: 'language,theme', cleared: true, fresh: true });
      const notCompact = await D.page.evaluate(() => {
        const host = document.createElement('div');
        document.querySelector('#view-start').appendChild(host);
        window.WT.json.mount(host, { features: ['theme'] });
        return !!host.querySelector('.wt-jx--compact');
      });
      assert.equal(notCompact, false, 'not compact on a page');
      assertNoErrors(D.errors, assert, D.external);
    } finally {
      await D.close();
    }
    // WT.json.openDialog: the ready-made compact dialog.
    const P = await openPage(ctx, { viewport: 'phone' });
    try {
      await gotoApp(P.page, base, '#/start');
      await P.page.evaluate(() => {
        const b = document.createElement('button');
        b.id = 't-open';
        b.textContent = 'Open';
        document.querySelector('#view-start').appendChild(b);
        b.addEventListener('click', () => window.WT.json.openDialog({ features: ['journey'], trigger: b }));
      });
      await P.page.click('#t-open');
      const d = P.page.locator('#wt-json-dialog');
      assert.ok(await d.isVisible());
      assert.match(await d.locator('.wt-dialog__title').innerText(), /Balance journey/);
      assert.equal((await focused(P.page)).role, 'treeitem', 'focus starts in the tree');
      assert.equal(await d.locator('a[href="#/data/journey"]').count(), 1);
      await P.page.keyboard.press('Escape');
      assert.ok(!(await d.isVisible()));
      assert.equal((await focused(P.page)).id, 't-open', 'focus returns to the trigger');
      assertNoErrors(P.errors, assert, P.external);
    } finally {
      await P.close();
    }
  });

  await step('layout: 320–1920px without horizontal scroll; tree and details stack on phones', async () => {
    await reset();
    for (const vp of ['narrow', 'phone', 'tablet', 'desktop', 'wide']) {
      const P = await openData('#/data', { viewport: vp });
      const { page } = P;
      try {
        await chooseScope(page, 'all');
        await until(async () => (await cards(page)).length === ALL.length, 6000, 'all');
        await page.evaluate(() => document.querySelector('#view-data [data-dv="explorer"]')._wtJson.select('transactions[].onchain.explorerUri'));
        await page.click('#view-data .wt-dv__fine > summary');
        const m = await page.evaluate(() => {
          const tree = document.querySelector('#view-data .wt-jx__treewrap').getBoundingClientRect();
          const det = document.querySelector('#view-data .wt-jx__details').getBoundingClientRect();
          const wide = [...document.querySelectorAll('#view-data *')].filter((e) => {
            const r = e.getBoundingClientRect();
            return r.width && r.right > window.innerWidth + 1 && !e.closest('.wt-jx__treewrap, .wt-jx__code, .wt-table-wrap, .wt-tabs');
          });
          return {
            overflow: document.documentElement.scrollWidth - window.innerWidth,
            stacked: det.top >= tree.bottom - 1,
            side: det.left >= tree.right - 1,
            wide: wide.slice(0, 5).map((e) => e.className || e.tagName)
          };
        });
        assert.ok(m.overflow <= 0, `${vp}: no horizontal scroll (${m.overflow}px)`);
        assert.deepEqual(m.wide, [], `${vp}: nothing sticks out`);
        if (vp === 'phone' || vp === 'narrow') assert.ok(m.stacked, `${vp}: stacked`);
        if (vp === 'desktop' || vp === 'wide') assert.ok(m.side, `${vp}: side by side`);
        assertNoErrors(P.errors, assert, P.external);
      } finally {
        await P.close();
      }
    }
  });

  await step('accessibility: axe on the data view (light and dark) and on the compact dialog', async () => {
    await reset();
    const storage = await seedBrowserReviewer(api, { answers: { [id(0)]: { vote: 'include' }, [id(5)]: { vote: 'include' } } });
    for (const colorScheme of ['light', 'dark']) {
      for (const vp of ['desktop', 'phone']) {
        const P = await openData('#/data', { storage, colorScheme, viewport: vp });
        const { page } = P;
        try {
          await chooseScope(page, 'all');
          await until(async () => (await cards(page)).length === ALL.length, 6000, 'all');
          await page.click('#view-data .wt-dv__fine > summary');
          await page.evaluate(() => document.querySelector('#view-data [data-dv="explorer"]')._wtJson.select('transactions[].fees[].amount'));
          await page.locator('#view-data .wt-jx__q').fill('fee');
          await sleep(300);
          let v = await axe(page);
          assert.deepEqual(v, [], `${colorScheme} ${vp}:\n    ` + formatViolations(v));
          for (const tab of ['sample', 'sources']) {
            await page.click(`#view-data [role="tab"][data-jx-tab="${tab}"]`);
            v = await axe(page, { include: '#view-data' });
            assert.deepEqual(v, [], `${colorScheme} ${vp} ${tab}:\n    ` + formatViolations(v));
          }
          await page.click('#view-data [role="tab"][data-jx-tab="tree"]');
          await page.locator('#view-data .wt-jx__q').fill('');
          await sleep(200);
          await page.evaluate(() => document.querySelector('#view-data [data-dv="explorer"]')._wtJson.select('statement.id'));
          await shot(page, `data-${vp}-${colorScheme}`, { fullPage: true });
          await page.locator('#view-data [data-dv="explore"]').screenshot({ path: join(ctx.shotsDir, `data-explorer-${vp}-${colorScheme}.png`) });
          // The compact dialog.
          await page.evaluate(() => window.WT.json.openDialog({ features: ['detail'] }));
          await sleep(300);
          v = await axe(page, { include: '#wt-json-dialog' });
          assert.deepEqual(v, [], `${colorScheme} ${vp} dialog:\n    ` + formatViolations(v));
          assertNoErrors(P.errors, assert, P.external);
        } finally {
          await P.close();
        }
      }
    }
    // The empty state in dark mode.
    await reset();
    const P = await openData('#/data', { colorScheme: 'dark', viewport: 'phone' });
    try {
      const v = await axe(P.page);
      assert.deepEqual(v, [], 'empty state:\n    ' + formatViolations(v));
      await shot(P.page, 'data-empty-phone-dark', { fullPage: true });
    } finally {
      await P.close();
    }
  });
}
