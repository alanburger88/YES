/*
 * 50-results — the results view, charts and admin moderation (SPEC section 8).
 * Owner: results.
 *
 * Seeds reviewers through the API, then checks in a real browser: counts, the
 * summary sentences, KPI tiles, each chart and its table equivalent against
 * /api/results, the ranking, the feature detail, the people matrix, CSV/JSON
 * export links, auto-refresh, admin (wrong and right code, hide, delete, reset),
 * the empty and error states, chart colour contrast in both themes, 320px
 * layouts and axe. Screenshots go to test-results/screens/results-*.png.
 *
 *   node tests/run.mjs --only 50-results
 */
import { assertNoErrors, axe, formatViolations, gotoApp, openPage, ridFor, seedBrowserReviewer, seedReviewer, shot, sleep, waitForView } from './helpers.mjs';

export const meta = { timeout: 420000 };

/* ------------------------------------------------------------------ */
/* Seed data                                                           */
/* ------------------------------------------------------------------ */

/** Deterministic pseudo-random numbers (mulberry32). */
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PEOPLE = [
  { name: 'Thandi Mokoena', include: 0.85, prio: 0.9, talk: 0.45, seed: 11 },
  { name: 'Pieter van der Merwe', include: 0.6, prio: 0.8, talk: 0.25, seed: 23 },
  { name: '', include: 0.7, prio: 0.6, talk: 0.2, seed: 37 },
  { name: 'Aisha Patel', include: 0.4, prio: 0.85, talk: 0.35, seed: 41 },
  { name: 'Lerato Dlamini', include: 0.75, prio: 0.7, talk: 0.3, seed: 53 },
  { name: 'Sam <Okafor> & Co', include: 0.55, prio: 0.75, talk: 0.3, seed: 67 },
  { name: '', include: 0.5, prio: 0.9, talk: 0.1, seed: 79, noVotes: true }
];
const REASONS = [
  'Customers ask about this every month.',
  'Cuts calls to the contact centre.',
  'Nice, but not for the first release.',
  'Regulators will like the transparency.',
  'Too much for a statement; keep it simple.'
];
const COMMENTS = [
  'Would love this in the app too.\nAnd in the PDF.',
  'Check the wording with legal before launch.',
  'Our older customers will need this.',
  '<img src=x onerror=alert(1)> should show as text',
  'Could we A/B test it first?'
];

/**
 * Saves 7 varied reviewers. The last three features get no answers, the
 * seventh reviewer sets priorities without voting, and one comment carries
 * HTML that must render as text. Returns [{ secret, rid, name }].
 */
export async function seedResults(api, features, opts = {}) {
  const out = [];
  const quiet = features.slice(-3).map((f) => f.id);
  const now = Date.now();
  for (let i = 0; i < PEOPLE.length; i++) {
    const p = PEOPLE[i];
    const rnd = prng(p.seed);
    const answers = {};
    features.forEach((f, k) => {
      if (quiet.includes(f.id)) return;
      if (rnd() > 0.82) return; // skipped
      const a = {};
      if (!p.noVotes) a.vote = k === 0 ? 'include' : rnd() < p.include ? 'include' : 'exclude';
      if (rnd() < p.prio) a.priority = ['high', 'medium', 'low'][Math.floor(rnd() * 3)];
      if (rnd() < p.talk) a.reason = REASONS[Math.floor(rnd() * REASONS.length)];
      if (rnd() < p.talk) a.comment = COMMENTS[Math.floor(rnd() * COMMENTS.length)];
      if (!a.vote && !a.priority && !a.reason && !a.comment) a.priority = 'medium';
      a.updatedAt = new Date(now - (i * 50 + k) * 60000 - (opts.offsetMs || 0)).toISOString();
      answers[f.id] = a;
    });
    // A guaranteed debate and a guaranteed comment on the second feature.
    if (features[1] && !quiet.includes(features[1].id) && !p.noVotes) {
      answers[features[1].id] = {
        ...(answers[features[1].id] || {}),
        vote: i % 2 ? 'exclude' : 'include',
        updatedAt: new Date(now - (i * 50 + 1) * 60000).toISOString()
      };
      if (i === 0) answers[features[1].id].comment = COMMENTS[3];
    }
    const r = await seedReviewer(api, { name: p.name, answers });
    out.push({ secret: r.secret, rid: r.rid, name: p.name });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Expected values, computed independently from /api/results           */
/* ------------------------------------------------------------------ */

const pct = (n, d) => (d ? Math.round((n / d) * 100) + '%' : '–');
const plural = (n, one, many) => n.toLocaleString('en-GB') + ' ' + (n === 1 ? one : many || one + 's');
/** What a sighted reader sees: the text without visually hidden parts. */
const visibleText = (loc) =>
  loc.evaluate((el) => {
    const c = el.cloneNode(true);
    c.querySelectorAll('.wt-sr-only').forEach((x) => x.remove());
    return c.textContent.replace(/\s+/g, ' ').trim();
  });
const join = (a) => (a.length <= 1 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]);
const LABEL = { high: 'High', medium: 'Medium', low: 'Low' };

/**
 * Priorities count only responses whose vote is not Exclude (an Exclude
 * vote's priority means "if included"). Recomputed from responses, so the
 * expectation holds whether or not the server already applies the rule.
 */
function priorityOf(x) {
  const p = { high: 0, medium: 0, low: 0 };
  for (const r of x.responses) if (r.vote !== 'exclude' && r.priority in p) p[r.priority]++;
  return p;
}
function rowsOf(res, features) {
  return features.map((f, index) => {
    const x = res.features[f.id];
    const votes = x.include + x.exclude;
    const priority = priorityOf(x);
    const pn = priority.high + priority.medium + priority.low;
    const score = pn ? Math.round(((priority.high * 3 + priority.medium * 2 + priority.low) / pn) * 100) / 100 : null;
    return { id: f.id, title: f.title, index, ...x, priority, score, votes, pn, share: votes ? x.include / votes : null, net: x.include - x.exclude };
  });
}
function supportOrder(rows) {
  return rows.slice().sort((a, b) => {
    if (!a.votes !== !b.votes) return a.votes ? -1 : 1;
    return b.net - a.net || (b.share || 0) - (a.share || 0) || b.include - a.include || (b.score || 0) - (a.score || 0) || a.index - b.index;
  });
}
function mixOrder(rows) {
  return rows.slice().sort((a, b) => {
    if (!a.pn !== !b.pn) return a.pn ? -1 : 1;
    if (!a.pn) return a.index - b.index;
    return b.priority.high / b.pn - a.priority.high / a.pn || b.priority.medium / b.pn - a.priority.medium / a.pn || b.pn - a.pn || a.index - b.index;
  });
}
function scoreOrder(rows) {
  return rows
    .filter((r) => r.include > 0 && r.score !== null)
    .sort((a, b) => b.score - a.score || b.pn - a.pn || b.priority.high - a.priority.high || a.index - b.index);
}
function prioPhrase(r) {
  if (!r.pn) return 'no priority set';
  const counts = ['high', 'medium', 'low'].map((k) => [k, r.priority[k]]);
  const max = Math.max(...counts.map((c) => c[1]));
  const top = counts.filter((c) => c[1] === max);
  if (top.length > 1) return 'mixed priority';
  return (max === r.pn ? 'all ' : 'mostly ') + LABEL[top[0][0]] + ' priority';
}
function expectedSentences(rows) {
  const s = {};
  const sup = rows
    .filter((r) => r.include > 0)
    .sort((a, b) => b.share - a.share || b.include - a.include || (b.score || 0) - (a.score || 0) || a.index - b.index)
    .slice(0, 3);
  s.support = sup.length
    ? 'Strongest support goes to ' + join(sup.map((r) => `${r.title} (${pct(r.include, r.votes)} include, ${r.include} of ${plural(r.votes, 'vote')}, ${prioPhrase(r)})`)) + '.'
    : 'Nobody has voted to include a feature yet.';
  const deb = rows
    .filter((r) => r.include > 0 && r.exclude > 0)
    .sort((a, b) => Math.abs(a.share - 0.5) - Math.abs(b.share - 0.5) || b.votes - a.votes || a.index - b.index);
  if (!deb.length) s.debated = 'No feature has votes on both sides yet, so nothing is debated.';
  else {
    const d0 = Math.abs(deb[0].share - 0.5);
    const tied = deb.filter((r) => Math.abs(r.share - 0.5) === d0 && r.votes === deb[0].votes).slice(0, 3);
    s.debated =
      tied.length === 1
        ? `The most debated feature is ${tied[0].title}, split ${tied[0].include} include to ${tied[0].exclude} exclude.`
        : 'The most debated features are ' + join(tied.map((r) => `${r.title} (${r.include} include, ${r.exclude} exclude)`)) + '.';
  }
  const maxExc = Math.max(0, ...rows.map((r) => r.exclude));
  const exc = maxExc ? rows.filter((r) => r.exclude === maxExc).slice(0, 3) : [];
  s.excluded = !exc.length
    ? 'Nobody has voted to exclude a feature yet.'
    : exc.length === 1
      ? `The most excluded feature is ${exc[0].title}, with ${plural(exc[0].exclude, 'exclude vote')} (${pct(exc[0].exclude, exc[0].votes)} of its votes).`
      : `The most excluded features are ${join(exc.map((r) => r.title))}, with ${plural(maxExc, 'exclude vote')} each.`;
  const maxCom = Math.max(0, ...rows.map((r) => r.comments));
  const com = maxCom ? rows.filter((r) => r.comments === maxCom).slice(0, 3) : [];
  s.commented = !com.length
    ? 'No comments yet.'
    : com.length === 1
      ? `The most commented feature is ${com[0].title}, with ${plural(maxCom, 'comment')}.`
      : `The most commented features are ${join(com.map((r) => r.title))}, with ${plural(maxCom, 'comment')} each.`;
  const none = rows.filter((r) => !r.votes);
  const shown = none.length > 5 ? none.slice(0, 4) : none;
  const names = shown.map((r) => r.title);
  if (none.length > shown.length) names.push(none.length - shown.length + ' more');
  s.novotes = !none.length
    ? 'Every feature has at least one vote.'
    : (none.length === 1 ? '1 feature has no votes yet: ' : none.length + ' features have no votes yet: ') + join(names) + '.';
  return s;
}

/* ------------------------------------------------------------------ */
/* Colour maths (WCAG 2.x relative luminance)                          */
/* ------------------------------------------------------------------ */

function parseRgb(s) {
  const m = String(s).match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
  return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
}
function lum({ r, g, b }) {
  const f = (c) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function ratio(a, b) {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
const hex = ({ r, g, b }) => '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
/** The InfoSlips palette (SPEC section 4): chart marks may only use these. */
const BRAND = ['#1d5941', '#277656', '#4eaf60', '#80d100', '#dbe64c', '#ffffff', '#111827', '#f8f8f8', '#f5f5f5', '#0f172a', '#334155', '#64748b', '#94a3b8', '#cbd5e1', '#e2e8f0', '#f1f5f9'];

/* ------------------------------------------------------------------ */
/* The test                                                            */
/* ------------------------------------------------------------------ */

export default async function (ctx) {
  const { base, api, assert, step, features, adminCode, reset, log } = ctx;
  const N = features.length;
  let seeded = [];
  let res = null;

  async function results(admin) {
    const r = await api('/api/results' + (admin ? '?admin=1' : ''), admin ? { admin: adminCode } : {});
    assert.equal(r.status, 200);
    return r.json;
  }
  async function until(fn, ms = 8000, label = 'condition') {
    const t0 = Date.now();
    for (;;) {
      const v = await fn();
      if (v) return v;
      if (Date.now() - t0 > ms) throw new Error('timed out waiting for ' + label);
      await sleep(100);
    }
  }
  async function openResults(P, hash = '#/results') {
    await gotoApp(P.page, base, hash);
    await waitForView(P.page, 'results');
    await P.page.waitForFunction(() => {
      const s = document.getElementById('view-results');
      return s && s.getAttribute('aria-busy') === 'false' && !s.querySelector('.wt-skeleton-group');
    });
  }
  const text = (s) => String(s || '').replace(/\s+/g, ' ').trim();

  /* ------------------------------------------------------------------ */
  await step('seed: 7 reviewers with varied answers', async () => {
    seeded = await seedResults(api, features);
    res = await results();
    assert.equal(res.reviewers, 7);
    assert.ok(res.answers > 60, 'plenty of answers: ' + res.answers);
    assert.ok(res.comments > 3, 'some comments');
    const rows = rowsOf(res, features);
    assert.ok(rows.some((r) => r.include && r.exclude), 'a debated feature');
    assert.equal(rows.slice(-3).every((r) => !r.votes && !r.responses.length), true, 'the last three features have no answers');
    assert.ok(rows.some((r) => r.undecided > 0), 'answers without a vote');
    assert.ok(rows.some((r) => r.responses.some((x) => x.vote === 'exclude' && x.priority)), 'an Exclude vote with a priority');
  });

  /* ------------------------------------------------------------------ */
  await step('overview: header counts, last updated, refresh, exports, brand notice, sub-navigation', async () => {
    const P = await openPage(ctx);
    try {
      await openResults(P);
      const { page } = P;
      assert.equal(await page.title(), 'Results · YES statement review · InfoSlips');
      assert.equal(text(await page.locator('#view-results h1').innerText()), 'What reviewers think');
      assert.equal(await page.locator('#view-results h1').count(), 1);
      for (const k of ['reviewers', 'answers', 'comments']) {
        const t = text(await page.locator(`[data-count="${k}"]`).innerText());
        assert.equal(t, `${res[k]} ${res[k] === 1 ? k.slice(0, -1) : k}`, k);
      }
      const time = page.locator('.wt-rs__time');
      assert.ok(Date.parse(await time.getAttribute('datetime')) > 0, 'last updated has a datetime');
      assert.match(await time.innerText(), /^\d\d:\d\d:\d\d$/);
      assert.match(text(await page.locator('.wt-rs__updated').innerText()), /Last updated \d\d:\d\d:\d\d · updates every 30 seconds/);
      assert.equal(await page.locator('#view-results [data-brand-notice="compact"]').count(), 1);
      const csv = page.locator('a[data-export="csv"]');
      const json = page.locator('a[data-export="json"]');
      assert.equal(await csv.getAttribute('href'), '/api/export.csv');
      assert.equal(await json.getAttribute('href'), '/api/export.json');
      assert.equal(await csv.getAttribute('download'), '');
      assert.equal(text(await csv.innerText()), 'Export CSV');
      assert.equal(text(await json.innerText()), 'Export JSON');
      // Sub-navigation
      const nav = page.locator('nav[aria-label="Results sections"] a');
      assert.deepEqual(await nav.allInnerTexts(), ['Overview', 'By feature', 'People']);
      assert.equal(await page.locator('nav[aria-label="Results sections"] a[aria-current="page"]').innerText(), 'Overview');
      // Refresh button refetches and announces
      await page.locator('[data-action="refresh"]').click();
      await until(async () => (await page.locator('#wt-live').textContent()) === 'Results are up to date.', 5000, 'refresh announcement');
      assert.ok(await page.locator('[data-action="refresh"]').evaluate((b) => document.activeElement === b), 'focus stays on Refresh');
      // Main nav marks Results as current
      assert.equal(await page.locator('.wt-nav__link[aria-current="page"]').getAttribute('data-nav'), 'results');
      assertNoErrors(P.errors, assert, P.external);
    } finally {
      await P.close();
    }
  });

  /* ------------------------------------------------------------------ */
  await step('overview: summary sentences and KPI tiles are accurate', async () => {
    const P = await openPage(ctx);
    try {
      await openResults(P);
      const rows = rowsOf(res, features);
      const exp = expectedSentences(rows);
      for (const k of ['support', 'debated', 'excluded', 'commented', 'novotes']) {
        const got = text(await P.page.locator(`[data-summary="${k}"]`).innerText());
        assert.equal(got, exp[k], 'summary ' + k);
      }
      // The summary names link to the feature detail.
      const first = supportOrder(rows).filter((r) => r.include)[0];
      assert.ok((await P.page.locator(`[data-summary="support"] a[href="#/results/${first.id}"]`).count()) >= 0);
      const kpi = async (k) => text(await P.page.locator(`[data-kpi="${k}"] .wt-kpi__value`).innerText());
      assert.equal(await kpi('reviewers'), String(res.reviewers));
      assert.equal(await kpi('answers'), String(res.answers));
      assert.equal(await kpi('comments'), String(res.comments));
      // One rule everywhere (WT.results.wanted, also the Data page): more include than exclude votes.
      assert.equal(await kpi('majority'), String(rows.filter((r) => r.include > r.exclude).length));
      assert.equal(text(await P.page.locator('[data-kpi="majority"] .wt-kpi__label').innerText()).toLowerCase(), 'features most reviewers want');
      assert.equal(text(await P.page.locator('[data-kpi="majority"] .wt-kpi__sub').innerText()), 'of ' + N + ', with more include than exclude votes');
      assert.equal(await P.page.evaluate(() => window.WT.features.filter((f) => window.WT.results.wanted(window.WT.results.data().features[f.id])).length), rows.filter((r) => r.include > r.exclude).length);
      assertNoErrors(P.errors, assert, P.external);
    } finally {
      await P.close();
    }
  });

  /* ------------------------------------------------------------------ */
  await step('charts: support, priority mix and score ranking match the API, in chart and table form', async () => {
    const P = await openPage(ctx);
    try {
      await openResults(P);
      const { page } = P;
      const rows = rowsOf(res, features);

      // Every chart is a figure with a figcaption and a pressed/unpressed table toggle.
      for (const id of ['support', 'mix', 'score']) {
        const fig = page.locator(`figure#fig-${id}`);
        assert.equal(await fig.count(), 1, id);
        assert.equal(await fig.locator('> figcaption').count(), 1, id + ' figcaption');
        const btn = fig.locator('[data-fig-toggle]');
        assert.equal(text(await btn.innerText()), 'Show as table');
        assert.equal(await btn.getAttribute('aria-pressed'), 'false');
        assert.ok(await fig.locator('.wt-fig__chart').isVisible());
        assert.ok(!(await fig.locator('.wt-fig__table').isVisible()));
      }

      // 1. Support: order by net support; values; thumbnails beside labels.
      const sup = supportOrder(rows);
      const ids = await page.locator('#fig-support .wt-sup__row').evaluateAll((els) => els.map((e) => e.getAttribute('data-id')));
      assert.deepEqual(ids, sup.map((r) => r.id), 'support order');
      for (const r of sup) {
        const row = page.locator(`#fig-support .wt-sup__row[data-id="${r.id}"]`);
        const sr = text(await row.locator('.wt-sr-only').textContent());
        const want = r.votes
          ? `: ${r.include} include, ${r.exclude} exclude, ${pct(r.include, r.votes)} include` + (r.undecided ? `, ${r.undecided} without a vote` : '')
          : ': no votes yet';
        assert.equal(sr, want, 'support sr ' + r.id);
        // The values are part of the link's name, not a sibling it leaves out.
        assert.equal(text(await row.locator('a.wt-chart__label').textContent()), r.title + want, 'support link name ' + r.id);
        assert.equal(await row.locator('.wt-shot-box--thumb').count(), 1, 'thumbnail ' + r.id);
        assert.equal(await row.locator('a.wt-chart__label').getAttribute('href'), '#/results/' + r.id);
        if (r.include) {
          const w = Number(await row.locator('.wt-mark--include').getAttribute('data-w'));
          const max = Math.max(...rows.map((x) => Math.max(x.include, x.exclude)));
          assert.ok(Math.abs(w - r.include / max) < 0.001, 'include bar length ' + r.id);
        }
      }
      // The include bar of the top feature is drawn longer than a shorter one's.
      const topW = await page.locator(`#fig-support .wt-sup__row[data-id="${sup[0].id}"] .wt-mark--include`).evaluate((e) => e.getBoundingClientRect().width);
      assert.ok(topW > 20, 'top bar has width');

      // Toggle to the table: values match the API.
      await page.locator('#fig-support [data-fig-toggle]').click();
      assert.equal(await page.locator('#fig-support [data-fig-toggle]').getAttribute('aria-pressed'), 'true');
      assert.ok(await page.locator('#fig-support .wt-fig__table').isVisible());
      assert.ok(!(await page.locator('#fig-support .wt-fig__chart').isVisible()));
      const supTable = await page.locator('#fig-support table tbody tr').evaluateAll((trs) => trs.map((tr) => Array.from(tr.children, (c) => c.textContent.trim())));
      assert.deepEqual(
        supTable,
        sup.map((r) => [r.title, String(r.include), String(r.exclude), String(r.undecided), (r.net > 0 ? '+' : r.net < 0 ? '−' : '') + Math.abs(r.net), pct(r.include, r.votes)]),
        'support table'
      );
      await page.locator('#fig-support [data-fig-toggle]').click();
      assert.ok(await page.locator('#fig-support .wt-fig__chart').isVisible());

      // 2. Priority mix: order, stacked segment counts, table.
      const mix = mixOrder(rows);
      const mixIds = await page.locator('#fig-mix .wt-mix__row').evaluateAll((els) => els.map((e) => e.getAttribute('data-id')));
      assert.deepEqual(mixIds, mix.map((r) => r.id), 'mix order');
      for (const r of mix) {
        const segs = await page.locator(`#fig-mix .wt-mix__row[data-id="${r.id}"] .wt-mark`).evaluateAll((els) =>
          els.map((e) => [e.className.match(/wt-mark--(\w+)/)[1], Number(e.getAttribute('data-g'))])
        );
        assert.deepEqual(segs, ['high', 'medium', 'low'].filter((k) => r.priority[k]).map((k) => [k, r.priority[k]]), 'mix segments ' + r.id);
      }
      // In-segment labels name the priority by letter, so colour is never needed to read them.
      const labs = await page.locator('#fig-mix .wt-mark .wt-seg__lab').evaluateAll((els) => els.map((e) => [e.parentElement.className.match(/wt-mark--(\w+)/)[1], e.textContent]));
      assert.ok(labs.length > 10, 'segment labels');
      for (const [k, t] of labs) assert.match(t, new RegExp('^' + k[0].toUpperCase() + ' \\d+%$'), 'segment label ' + t);
      assert.match(text(await page.locator('#fig-mix .wt-fig__desc').innerText()), /Priorities come only from reviewers who didn’t vote Exclude\. The number on the right is how many set a priority \(Exclude votes not counted\)\.$/);
      const mixTable = await page.locator('#fig-mix table tbody tr').evaluateAll((trs) => trs.map((tr) => Array.from(tr.children, (c) => c.textContent.replace(/\s+/g, ' ').trim())));
      assert.deepEqual(
        mixTable,
        mix.map((r) => [
          r.title,
          ...['high', 'medium', 'low'].map((k) => (r.pn ? `${r.priority[k]} (${pct(r.priority[k], r.pn)})` : String(r.priority[k]))),
          String(r.pn)
        ]),
        'mix table'
      );
      // Segments of a 100% bar fill the track (2px gaps aside).
      const one = mix[0];
      const geo = await page.locator(`#fig-mix .wt-mix__row[data-id="${one.id}"] .wt-hbar`).evaluate((s) => ({
        track: s.getBoundingClientRect().width,
        segs: Array.from(s.children, (c) => c.getBoundingClientRect().width)
      }));
      const sum = geo.segs.reduce((a, b) => a + b, 0) + 2 * (geo.segs.length - 1);
      assert.ok(Math.abs(sum - geo.track) < 1.5, 'segments fill the bar');
      geo.segs.forEach((w, i) => {
        const k = ['high', 'medium', 'low'].filter((x) => one.priority[x])[i];
        const want = (one.priority[k] / one.pn) * (geo.track - 2 * (geo.segs.length - 1));
        assert.ok(Math.abs(w - want) < 2 || w <= 3.5, `segment ${k} width ${w} vs ${want}`);
      });

      // 3. Score ranking: only features with an include and a score, ordered by score.
      const sc = scoreOrder(rows);
      const scIds = await page.locator('#fig-score .wt-score__row').evaluateAll((els) => els.map((e) => e.getAttribute('data-id')));
      assert.deepEqual(scIds, sc.map((r) => r.id), 'score order');
      const vals = await page.locator('#fig-score .wt-score__row .wt-score__val').allInnerTexts();
      assert.deepEqual(vals, sc.map((r) => r.score.toFixed(2)), 'score values');
      for (const r of sc) {
        const x = Number(await page.locator(`#fig-score .wt-score__row[data-id="${r.id}"] .wt-score__dot`).getAttribute('data-x'));
        assert.ok(Math.abs(x - (r.score - 1) / 2) < 0.001, 'dot position ' + r.id);
      }
      await page.locator('#fig-score [data-fig-toggle]').click();
      const scTable = await page.locator('#fig-score table tbody tr').evaluateAll((trs) => trs.map((tr) => Array.from(tr.children, (c) => c.textContent.trim())));
      assert.deepEqual(
        scTable,
        sc.map((r, i) => [String(i + 1), r.title, r.score.toFixed(2), String(r.priority.high), String(r.priority.medium), String(r.priority.low), String(r.include)]),
        'score table'
      );
      // The table choice survives an auto-refresh re-render.
      await page.evaluate(() => window.WT.results.load({ force: true }));
      assert.ok(await page.locator('#fig-score .wt-fig__table').isVisible(), 'table stays open after a refresh');

      // Tab stops: one link per feature in the Support chart; the Priority mix
      // and Score labels repeat those destinations, so they stay out of the tab order.
      const stops = await page.evaluate(() => ['support', 'mix', 'score'].map((id) => {
        const links = Array.from(document.querySelectorAll('#fig-' + id + ' .wt-fig__chart a'));
        return [links.length, links.filter((a) => a.tabIndex >= 0).length];
      }));
      assert.deepEqual(stops[0], [N, N], 'support: one tab stop per feature');
      assert.equal(stops[1][1], 0, 'priority mix labels are not tab stops');
      assert.equal(stops[2][1], 0, 'score labels are not tab stops');
      assert.match(text(await page.locator('#fig-mix .wt-mix__row a.wt-chart__label').first().textContent()), /: (High \d+ \(\d+%\), Medium \d+ \(\d+%\), Low \d+ \(\d+%\), from \d+ priority responses?|no priorities yet)$/);

      // Tooltips: hovering a row shows its values (as text), Escape hides it.
      const r0 = page.locator(`#fig-support .wt-sup__row[data-id="${sup[0].id}"] .wt-sup__plot`);
      await r0.hover();
      const tip = page.locator('.wt-tip');
      await tip.waitFor({ state: 'visible' });
      assert.equal(text(await tip.locator('.wt-tip__title').innerText()), sup[0].title);
      assert.match(text(await tip.innerText()), new RegExp(`${sup[0].include} Include`));
      await page.keyboard.press('Escape');
      assert.ok(!(await tip.isVisible()));
      assertNoErrors(P.errors, assert, P.external);
    } finally {
      await P.close();
    }
  });

  /* ------------------------------------------------------------------ */
  await step('by feature: ranking cards in net-support order, with include %, priority split and comments', async () => {
    const P = await openPage(ctx);
    try {
      await openResults(P, '#/results/features');
      const { page } = P;
      assert.equal(await page.locator('nav[aria-label="Results sections"] a[aria-current="page"]').innerText(), 'By feature');
      const rows = rowsOf(res, features);
      const sup = supportOrder(rows);
      const ids = await page.locator('.wt-rank__item').evaluateAll((els) => els.map((e) => e.getAttribute('data-id')));
      assert.deepEqual(ids, sup.map((r) => r.id), 'ranking order');
      for (const [i, r] of sup.entries()) {
        const card = page.locator(`.wt-rank__item[data-id="${r.id}"]`);
        assert.equal(text(await card.locator('.wt-rank__n').innerText()), 'Rank ' + (i + 1));
        assert.equal(text(await card.locator('.wt-rank__title').innerText()), r.title);
        assert.equal(await card.locator('.wt-rank__title a').getAttribute('href'), '#/results/' + r.id);
        assert.equal(text(await card.locator('[data-stat="include"]').innerText()), r.votes ? pct(r.include, r.votes) : '–');
        assert.equal(text(await card.locator('[data-stat="votes"]').innerText()), r.votes ? `(${r.include} of ${plural(r.votes, 'vote')})` : 'No votes yet');
        assert.equal(text(await card.locator('[data-stat="priority"]').innerText()), `High ${r.priority.high} · Medium ${r.priority.medium} · Low ${r.priority.low}`);
        assert.equal(text(await card.locator('[data-stat="comments"]').innerText()), String(r.comments));
      }
      // The thumbnail opens the full screenshot in a dialog.
      const firstThumb = page.locator(`.wt-rank__item[data-id="${sup[0].id}"] .wt-rank__thumb`);
      assert.equal(await firstThumb.getAttribute('aria-label'), 'Open the screenshot of ' + sup[0].title);
      await firstThumb.click();
      const dlg = page.locator('#wt-shot-dialog');
      await dlg.waitFor({ state: 'visible' });
      assert.equal(text(await dlg.locator('.wt-dialog__title').innerText()), sup[0].title);
      const big = dlg.locator('.wt-shot-box');
      await until(async () => (await big.locator('img').count()) === 0 || (await big.locator('img').evaluate((i) => i.complete)), 5000, 'image settles');
      if (await big.locator('img').count()) {
        assert.equal(await big.locator('img').getAttribute('alt'), sup[0].title + ' in the YES statement');
        assert.equal(await big.locator('img').getAttribute('src'), 'assets/shots/' + sup[0].id + '.jpg');
      } else {
        assert.equal(await big.locator('.wt-shot-box__ph').getAttribute('aria-label'), sup[0].title + ' in the YES statement (screenshot not available yet)');
      }
      await page.keyboard.press('Escape');
      await dlg.waitFor({ state: 'hidden' });
      assert.ok(await firstThumb.evaluate((b) => document.activeElement === b), 'focus returns to the thumbnail');
      // Sorting by comments re-orders.
      await page.selectOption('#rank-sort', 'comments');
      const byCom = await page.locator('.wt-rank__item [data-stat="comments"]').allInnerTexts();
      const nums = byCom.map(Number);
      assert.deepEqual(nums, nums.slice().sort((a, b) => b - a), 'sorted by comments');
      assertNoErrors(P.errors, assert, P.external);
    } finally {
      await P.close();
    }
  });

  /* ------------------------------------------------------------------ */
  await step('feature detail: screenshot, description, stats, mini chart, every response and links', async () => {
    const rows = rowsOf(res, features);
    const f = rows[1]; // the feature with a guaranteed debate and an HTML comment
    // This browser is one of the seeded reviewers, so its answer is marked "You".
    const me = seeded[0];
    const P = await openPage(ctx, {
      storage: { 'infoslips.wt.reviewer': { secret: me.secret, name: me.name, rid: ridFor(me.secret), answers: {}, lastStep: '' } }
    });
    try {
      await openResults(P, '#/results/' + f.id);
      const { page } = P;
      assert.equal(text(await page.locator('#view-results h1').innerText()), f.title);
      assert.equal(await page.title(), f.title + ' · Results · YES statement review · InfoSlips');
      assert.equal(await page.locator('nav[aria-label="Results sections"] a[aria-current="page"]').innerText(), 'By feature');
      // Screenshot (or its neutral placeholder) with the right alt text.
      const box = page.locator('.wt-detail__shot .wt-shot-box');
      await until(async () => (await box.locator('img').count()) === 0 || (await box.locator('img').evaluate((i) => i.complete)), 5000, 'image settles');
      if (await box.locator('img').count()) {
        assert.equal(await box.locator('img').getAttribute('src'), 'assets/shots/' + f.id + '.jpg');
        assert.equal(await box.locator('img').getAttribute('alt'), f.title + ' in the YES statement');
      } else {
        assert.ok(await box.locator('.wt-shot-box__ph').isVisible(), 'placeholder shows');
        assert.match(await box.locator('.wt-shot-box__ph').getAttribute('aria-label'), new RegExp('^' + f.title + ' in the YES statement'));
      }
      // Opens larger.
      await page.locator('[data-fk="detail-shot"]').click();
      await page.locator('#wt-shot-dialog').waitFor({ state: 'visible' });
      await page.keyboard.press('Escape');
      // Description from WT.steps (or the short line).
      const what = await page.evaluate((id) => (window.WT.steps && window.WT.steps[id] ? window.WT.steps[id].what : window.WT.feature(id).short), f.id);
      assert.equal(text(await page.locator('.wt-detail__what').innerText()), text(what));
      // Stats
      assert.equal(text(await page.locator('[data-glance="include"] .wt-glance__v').innerText()), pct(f.include, f.votes));
      assert.equal(text(await page.locator('[data-glance="votes"] .wt-glance__v').innerText()), `${f.include} / ${f.exclude}`);
      assert.equal(text(await page.locator('[data-glance="score"] .wt-glance__v').innerText()), f.score === null ? '–' : f.score.toFixed(2));
      assert.equal(text(await page.locator('[data-glance="comments"] .wt-glance__v').innerText()), String(f.comments));
      assert.ok((await page.locator('.wt-detail__mini .wt-mark').count()) >= 2, 'mini chart marks');
      // Links
      assert.equal(await page.locator('a[data-fk="detail-tour"]').getAttribute('href'), '#/tour/' + f.id);
      assert.equal(text(await page.locator('a[data-fk="detail-tour"]').innerText()), 'See it in the walkthrough');
      assert.equal(await page.locator('a[data-fk="detail-data"]').getAttribute('href'), '#/data/' + f.id);
      assert.equal(text(await page.locator('a[data-fk="detail-data"]').innerText()), 'Data requirements');
      // Every response, newest first.
      const items = page.locator('.wt-resp');
      assert.equal(await items.count(), f.responses.length);
      for (const [i, r] of f.responses.entries()) {
        const it = items.nth(i);
        assert.equal(await it.getAttribute('data-rid'), r.rid);
        const name = text(await it.locator('.wt-resp__name').innerText());
        assert.equal(name.replace(/ You$/, ''), r.name || 'Anonymous reviewer');
        assert.equal(/ You$/.test(name), r.rid === me.rid, 'You badge for ' + r.rid);
        const badges = text(await it.locator('.wt-resp__badges').textContent());
        assert.ok(badges.startsWith(r.vote === 'include' ? 'Include' : r.vote === 'exclude' ? 'Exclude' : 'No vote'), 'vote badge');
        // An Exclude vote's priority is shown as "if included" (and isn't counted).
        assert.ok(badges.endsWith(!r.priority ? 'No priority' : LABEL[r.priority] + ' priority' + (r.vote === 'exclude' ? ' if included' : '')), 'priority badge: ' + badges);
        if (r.vote === 'exclude' && r.priority) assert.equal(await visibleText(it.locator('.wt-badge--if')), LABEL[r.priority] + ' if included');
        if (r.reason) assert.equal(await it.locator('.wt-resp__part--reason .wt-resp__text').innerText(), r.reason);
        else assert.equal(await it.locator('.wt-resp__part--reason').count(), 0);
        if (r.comment) assert.equal(await it.locator('.wt-resp__part--comment .wt-resp__text').innerText(), r.comment);
        else assert.equal(await it.locator('.wt-resp__part--comment').count(), 0);
        assert.equal(await it.locator('time').getAttribute('datetime'), r.updatedAt);
        assert.match(text(await it.locator('.wt-resp__time').innerText()), /(ago|just now|yesterday|\d{4}) · \d{1,2} \w{3} \d{4}, \d\d:\d\d$/);
      }
      // User text is never HTML.
      assert.equal(await page.locator('.wt-resp img').count(), 0, 'no injected image');
      assert.ok((await page.locator('.wt-resp__text', { hasText: '<img src=x onerror=alert(1)>' }).count()) >= 1, 'HTML shown as text');
      assertNoErrors(P.errors, assert, P.external);
    } finally {
      await P.close();
    }
  });

  /* ------------------------------------------------------------------ */
  await step('screenshots that fail to load show a neutral placeholder', async () => {
    const P = await openPage(ctx);
    try {
      await P.page.route('**/assets/shots/**', (route) => route.fulfill({ status: 404, body: '' }));
      const f = features[2];
      await openResults(P, '#/results/' + f.id);
      const box = P.page.locator('.wt-detail__shot .wt-shot-box');
      await until(async () => (await box.getAttribute('class')).includes('is-missing'), 5000, 'large placeholder');
      assert.equal(await box.locator('img').count(), 0, 'broken image removed');
      const ph = box.locator('.wt-shot-box__ph');
      assert.ok(await ph.isVisible());
      assert.equal(await ph.getAttribute('role'), 'img');
      assert.equal(await ph.getAttribute('aria-label'), f.title + ' in the YES statement (screenshot not available yet)');
      assert.equal(text(await ph.innerText()), 'Screenshot not available yet');
      await openResults(P, '#/results/features');
      const thumb = P.page.locator('.wt-rank__item').first().locator('.wt-shot-box');
      await until(async () => (await thumb.getAttribute('class')).includes('is-missing'), 5000, 'thumbnail placeholder');
      assert.ok(await thumb.locator('.wt-shot-box__ph').isVisible());
      assert.equal(await thumb.locator('.wt-shot-box__ph').getAttribute('aria-hidden'), 'true', 'decorative thumbnail placeholder');
      // 404s are expected here (the console noise is filtered by the helpers).
      assertNoErrors(P.errors, assert, P.external);
    } finally {
      await P.close();
    }
  });

  /* ------------------------------------------------------------------ */
  await step('people: reviewers × features matrix with sticky headers, text alternatives and a legend', async () => {
    const P = await openPage(ctx);
    try {
      await openResults(P, '#/results/people');
      const { page } = P;
      assert.equal(text(await page.locator('#view-results h1').innerText()), 'Everyone’s answers');
      const table = page.locator('table.wt-mx-table');
      assert.equal(await table.locator('thead th[scope="col"]').count(), N + 2);
      const rowsEl = table.locator('tbody tr');
      assert.equal(await rowsEl.count(), res.people.length);
      const byRid = {};
      for (const f of features) for (const r of res.features[f.id].responses) (byRid[r.rid] = byRid[r.rid] || {})[f.id] = r;
      for (const [i, p] of res.people.entries()) {
        const tr = rowsEl.nth(i);
        assert.equal(await tr.getAttribute('data-rid'), p.rid);
        assert.equal(text(await tr.locator('.wt-mx__name').innerText()), p.name || 'Anonymous reviewer');
        const cells = await tr.locator('td.wt-mx').evaluateAll((tds) => tds.map((td) => [td.querySelector('.wt-mx__chip').textContent, td.querySelector('.wt-sr-only').textContent]));
        assert.equal(cells.length, N);
        features.forEach((f, k) => {
          const a = byRid[p.rid] && byRid[p.rid][f.id];
          if (!a) {
            assert.deepEqual(cells[k], ['–', f.title + ': not answered']);
            return;
          }
          const sym = a.vote === 'include' ? '✓' : a.vote === 'exclude' ? '✗' : '–';
          const cond = a.vote === 'exclude' && a.priority;
          const letter = a.priority ? a.priority[0].toUpperCase() : '';
          assert.equal(cells[k][0], sym + (cond ? '(' + letter + ')' : letter), `cell ${p.rid} ${f.id}`);
          const said = (a.vote ? (a.vote === 'include' ? 'Include' : 'Exclude') : 'No vote') + (a.priority ? `, ${LABEL[a.priority]} priority` + (cond ? ' if included' : '') : ', no priority');
          assert.ok(cells[k][1].startsWith(f.title + ': ' + said), `sr ${cells[k][1]}`);
        });
        assert.equal(text(await tr.locator('td.wt-mx__total').innerText()), `${p.answered} / ${N}`);
      }
      // Legend, sticky header and first column, horizontal scroll inside its own container.
      const legend = text(await page.locator('.wt-mx-legend').innerText());
      for (const w of ['Include', 'Exclude', 'No vote', 'High, Medium or Low priority', 'Exclude, with the priority if it were included (not counted)']) assert.ok(legend.includes(w), 'legend ' + w);
      const sticky = await page.evaluate(() => {
        const th = document.querySelector('.wt-mx-table thead th');
        const rh = document.querySelector('.wt-mx-table tbody th');
        const wrap = document.querySelector('.wt-mx-wrap');
        return {
          head: getComputedStyle(th).position,
          col: getComputedStyle(rh).position,
          overflow: getComputedStyle(wrap).overflowX,
          scrolls: wrap.scrollWidth > wrap.clientWidth,
          page: document.scrollingElement.scrollWidth <= document.documentElement.clientWidth,
          region: wrap.getAttribute('role') + '|' + wrap.getAttribute('tabindex') + '|' + wrap.getAttribute('aria-label')
        };
      });
      assert.deepEqual(sticky, { head: 'sticky', col: 'sticky', overflow: 'auto', scrolls: true, page: true, region: 'region|0|Reviewers by feature' });
      assertNoErrors(P.errors, assert, P.external);
    } finally {
      await P.close();
    }
  });

  /* ------------------------------------------------------------------ */
  await step('exports: CSV and JSON links download every answer', async () => {
    const P = await openPage(ctx);
    try {
      await openResults(P);
      const { page } = P;
      const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('a[data-export="csv"]').click()]);
      assert.match(dl.suggestedFilename(), /^yes-statement-review-\d{4}-\d{2}-\d{2}\.csv$/);
      const csv = await api('/api/export.csv');
      assert.equal(csv.status, 200);
      assert.match(csv.headers.get('content-type'), /^text\/csv/);
      assert.equal(csv.text.replace(/^\uFEFF/, '').split('\r\n')[0], 'reviewer,feature_id,feature_title,vote,priority,reason,comment,updated_at');
      const [dl2] = await Promise.all([page.waitForEvent('download'), page.locator('a[data-export="json"]').click()]);
      assert.match(dl2.suggestedFilename(), /^yes-statement-review-\d{4}-\d{2}-\d{2}\.json$/);
      const json = await api('/api/export.json');
      assert.equal(json.json.rows.length, res.answers, 'one row per answer');
      assertNoErrors(P.errors, assert, P.external);
    } finally {
      await P.close();
    }
  });

  /* ------------------------------------------------------------------ */
  await step('auto-refresh: a new answer appears within 30 s and is announced once', async () => {
    const P = await openPage(ctx);
    try {
      await P.context.clock.install();
      await openResults(P);
      const { page } = P;
      assert.equal(await page.evaluate(() => window.WT.results.refreshMs), 30000);
      const before = Number(await page.locator('[data-count="reviewers"] strong').innerText());
      // Nothing changes: a refresh updates the time but says nothing.
      await page.evaluate(() => {
        window.__live = [];
        new MutationObserver(() => window.__live.push(document.getElementById('wt-live').textContent)).observe(document.getElementById('wt-live'), { childList: true, characterData: true, subtree: true });
      });
      const t0 = await page.locator('.wt-rs__time').getAttribute('datetime');
      await page.clock.fastForward(31000);
      await until(async () => (await page.locator('.wt-rs__time').getAttribute('datetime')) !== t0, 6000, 'quiet refresh');
      assert.deepEqual((await page.evaluate(() => window.__live)).filter(Boolean), [], 'no announcement without changes');
      // A new reviewer answers.
      await seedReviewer(api, { name: 'Late Reviewer', answers: { [features[0].id]: { vote: 'include', priority: 'high', comment: 'Just in time.' } } });
      await page.clock.fastForward(31000);
      await until(async () => Number(await page.locator('[data-count="reviewers"] strong').innerText()) === before + 1, 6000, 'reviewer count');
      const now = await results();
      assert.equal(Number(await page.locator('[data-count="answers"] strong').innerText()), now.answers);
      await until(async () => (await page.locator('#wt-live').textContent()).startsWith('Results updated:'), 3000, 'announcement');
      assert.equal(await page.locator('#wt-live').textContent(), `Results updated: ${plural(now.reviewers, 'reviewer')}, ${plural(now.answers, 'answer')} and ${plural(now.comments, 'comment')}.`);
      // Hidden tab: no polling; visible again: refresh straight away.
      const reqs = [];
      page.on('request', (r) => r.url().includes('/api/results') && reqs.push(r.url()));
      await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await page.clock.fastForward(65000);
      await sleep(300);
      assert.equal(reqs.length, 0, 'no polling while hidden');
      await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await until(async () => reqs.length >= 1, 4000, 'refresh on return');
      res = await results();
      assertNoErrors(P.errors, assert, P.external);
    } finally {
      await P.close();
    }
  });

  /* ------------------------------------------------------------------ */
  await step('after a save: an answer saved while the results are open shows up straight away', async () => {
    const P = await openPage(ctx);
    try {
      await openResults(P);
      const { page } = P;
      const f = features[2];
      const before = Number(await page.locator('[data-count="reviewers"] strong').innerText());
      const t0 = Date.now();
      // The last answer of the walkthrough, saved from this tab: an Exclude with a priority.
      await page.evaluate((id) => {
        window.WT.answers.set(id, { vote: 'exclude', priority: 'high' });
        return window.WT.answers.flush();
      }, f.id);
      await until(async () => Number(await page.locator('[data-count="reviewers"] strong').innerText()) === before + 1, 6000, 'own answer counted without waiting for the 30 s poll');
      assert.ok(Date.now() - t0 < 6000, 'refreshed after the save');
      // Its priority is shown as "if included" and isn't counted.
      const api0 = (await results()).features[f.id];
      await openResults(P, '#/results/' + f.id);
      const mine = page.locator('.wt-resp').filter({ has: page.locator('.wt-badge--if') }).first();
      assert.equal(await visibleText(mine.locator('.wt-badge--if')), 'High if included');
      assert.equal(text(await mine.locator('.wt-badge--if').textContent()), 'High priority if included');
      const counted = api0.responses.filter((r) => r.vote !== 'exclude' && r.priority).length;
      assert.equal(await page.evaluate((id) => { const p = window.WT.results.model().find((r) => r.id === id).priority; return p.high + p.medium + p.low; }, f.id), counted, 'priorities from Exclude votes are not counted');
      // Clean up: later steps expect the seeded reviewers only.
      await page.evaluate(() => window.WT.api.deleteMe());
      res = await results();
      assertNoErrors(P.errors, assert, P.external);
    } finally {
      await P.close();
    }
  });

  /* ------------------------------------------------------------------ */
  await step('forced colours: High, Medium and Low look different, and segment labels name the priority', async () => {
    const P = await openPage(ctx);
    try {
      await P.page.emulateMedia({ forcedColors: 'active' });
      await openResults(P);
      const { page } = P;
      const looks = await page.evaluate(() =>
        ['high', 'medium', 'low'].map((k) => [document.querySelector('#fig-mix .wt-mark--' + k), document.querySelector('#fig-mix .wt-key--' + k)].map((m) => {
          const cs = getComputedStyle(m);
          return [cs.backgroundColor, cs.backgroundImage === 'none' ? 'solid' : 'pattern', cs.outlineStyle === 'none' ? 'no outline' : 'outline ' + cs.outlineWidth].join(' / ');
        }))
      );
      assert.equal(new Set(looks.map((l) => l[0])).size, 3, 'segments: ' + looks.map((l) => l[0]).join(' | '));
      assert.equal(new Set(looks.map((l) => l[1])).size, 3, 'legend keys: ' + looks.map((l) => l[1]).join(' | '));
      const labs = await page.locator('#fig-mix .wt-mark .wt-seg__lab').allTextContents();
      assert.ok(labs.length && labs.every((t) => /^[HML] \d+%$/.test(t)), 'labels: ' + labs.slice(0, 5).join(', '));
      // Only the current sub-view is underlined.
      const lines = await page.locator('.wt-subnav__link').evaluateAll((as) => as.map((a) => [a.getAttribute('aria-current') === 'page', getComputedStyle(a).borderBottomColor]));
      const cur = lines.filter((l) => l[0]).map((l) => l[1]);
      assert.ok(lines.filter((l) => !l[0]).every((l) => !cur.includes(l[1])), 'sub-nav underline marks only the current view: ' + JSON.stringify(lines));
      await page.locator('#fig-mix').scrollIntoViewIfNeeded();
      await shot(page, 'results-forced-colors-mix');
      assertNoErrors(P.errors, assert, P.external);
    } finally {
      await P.close();
    }
  });

  /* ------------------------------------------------------------------ */
  await step('colour contrast: chart marks >= 3:1 and chart text >= 4.5:1, brand colours only, both themes', async () => {
    for (const scheme of ['light', 'dark']) {
      const P = await openPage(ctx, { colorScheme: scheme });
      try {
        await openResults(P);
        const { page } = P;
        assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), scheme);
        if (scheme === 'dark') {
          // The brand keeps Lime to one or two highlights per view: on the
          // results it is only the focus ring. Eyebrows are Green on Slate 1;
          // links and accents on Slate 2 cards are Acorn.
          const ink = await page.evaluate(() => {
            if (document.activeElement) document.activeElement.blur();
            const lime = [];
            for (const el of document.querySelectorAll('#view-results *')) {
              const cs = getComputedStyle(el);
              for (const p of ['color', 'backgroundColor', 'borderTopColor', 'borderBottomColor', 'borderLeftColor', 'fill', 'stroke']) {
                if (p.startsWith('border') && parseFloat(cs[p.replace('Color', 'Width')]) === 0) continue;
                if (cs[p] === 'rgb(219, 230, 76)') lime.push(p + ' ' + (el.className.baseVal ?? el.className));
              }
            }
            return {
              lime,
              eyebrow: getComputedStyle(document.querySelector('#view-results .wt-eyebrow')).color,
              cardLink: getComputedStyle(document.querySelector('#view-results .wt-sum a')).color
            };
          });
          assert.deepEqual(ink.lime, [], 'no Lime on the results overview');
          assert.equal(ink.eyebrow, 'rgb(78, 175, 96)', 'eyebrow is Green on Slate 1');
          assert.equal(ink.cardLink, 'rgb(128, 209, 0)', 'links on cards are Acorn');
        }
        const sample = await page.evaluate(() => {
          const bgOf = (el) => {
            for (let e = el; e; e = e.parentElement) {
              const c = getComputedStyle(e).backgroundColor;
              if (c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c)) return c;
            }
            return getComputedStyle(document.body).backgroundColor;
          };
          const marks = Array.from(document.querySelectorAll('#view-results .wt-fig .wt-mark, #view-results .wt-key')).map((m) => ({
            kind: (m.className.match(/wt-(?:mark|key)--(\w+)/) || [])[1],
            fill: getComputedStyle(m).backgroundColor,
            bg: bgOf(m.parentElement)
          }));
          const texts = [];
          document.querySelectorAll('#view-results .wt-fig .wt-fig__chart *, #view-results .wt-fig figcaption *, #view-results .wt-kpi *, #view-results .wt-sum *').forEach((el) => {
            const own = Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim());
            if (!own || el.closest('[aria-hidden="true"] .wt-icon')) return;
            const cs = getComputedStyle(el);
            if (cs.visibility === 'hidden' || cs.display === 'none' || el.closest('.wt-sr-only')) return;
            texts.push({ t: el.textContent.trim().slice(0, 30), color: cs.color, bg: bgOf(el) });
          });
          return { marks, texts };
        });
        assert.ok(sample.marks.length > 40, 'marks sampled: ' + sample.marks.length);
        const seen = {};
        for (const m of sample.marks) {
          const fill = parseRgb(m.fill);
          const bg = parseRgb(m.bg);
          assert.ok(BRAND.includes(hex(fill)), `${scheme} ${m.kind} ${hex(fill)} is a brand colour`);
          const r = ratio(fill, bg);
          assert.ok(r >= 3, `${scheme} ${m.kind} mark ${hex(fill)} on ${hex(bg)} is ${r.toFixed(2)}:1`);
          seen[m.kind] = `${hex(fill)} on ${hex(bg)} ${r.toFixed(2)}:1`;
        }
        for (const k of ['include', 'exclude', 'high', 'medium', 'low', 'score']) assert.ok(seen[k], `${scheme}: ${k} sampled`);
        log(scheme, JSON.stringify(seen));
        assert.ok(sample.texts.length > 50, 'texts sampled');
        for (const t of sample.texts) {
          const r = ratio(parseRgb(t.color), parseRgb(t.bg));
          assert.ok(r >= 4.5, `${scheme} text "${t.t}" ${hex(parseRgb(t.color))} on ${hex(parseRgb(t.bg))} is ${r.toFixed(2)}:1`);
        }
        // Include and exclude stay distinct from each other, too.
        const inc = await page.locator('#fig-support .wt-mark--include').first().evaluate((e) => getComputedStyle(e).backgroundColor);
        const exc = await page.locator('#fig-support .wt-mark--exclude').first().evaluate((e) => getComputedStyle(e).backgroundColor);
        assert.notEqual(inc, exc);
        // Matrix chips: text on fill >= 4.5:1.
        await page.locator('nav[aria-label="Results sections"] a', { hasText: 'People' }).click();
        await waitForView(page, 'results', 'people');
        const chips = await page.evaluate(() =>
          Array.from(document.querySelectorAll('.wt-mx--include .wt-mx__chip, .wt-mx--exclude .wt-mx__chip')).slice(0, 40).map((c) => [getComputedStyle(c).color, getComputedStyle(c).backgroundColor])
        );
        assert.ok(chips.length > 5);
        for (const [c, b] of chips) assert.ok(ratio(parseRgb(c), parseRgb(b)) >= 4.5, `${scheme} chip ${c} on ${b}`);
        assertNoErrors(P.errors, assert, P.external);
      } finally {
        await P.close();
      }
    }
  });

  /* ------------------------------------------------------------------ */
  await step('accessibility: axe finds no violations on overview, by feature, detail and people (both themes)', async () => {
    for (const scheme of ['light', 'dark']) {
      const P = await openPage(ctx, { colorScheme: scheme });
      try {
        for (const hash of ['#/results', '#/results/features', '#/results/' + features[1].id, '#/results/people']) {
          await openResults(P, hash);
          const v = await axe(P.page, { include: '#view-results' });
          assert.deepEqual(v, [], `${scheme} ${hash}:\n    ${formatViolations(v)}`);
        }
        assertNoErrors(P.errors, assert, P.external);
      } finally {
        await P.close();
      }
    }
  });

  /* ------------------------------------------------------------------ */
  await step('responsive: 320px wide pages have no sideways scroll, and charts stack', async () => {
    const P = await openPage(ctx, { viewport: 'narrow' });
    try {
      for (const hash of ['#/results', '#/results/features', '#/results/' + features[0].id, '#/results/people']) {
        await openResults(P, hash);
        const over = await P.page.evaluate(() => document.scrollingElement.scrollWidth - document.documentElement.clientWidth);
        assert.ok(over <= 0, `${hash} scrolls sideways by ${over}px`);
      }
      await openResults(P, '#/results');
      const stacked = await P.page.locator('#fig-support .wt-sup__row').first().evaluate((r) => {
        const a = r.querySelector('.wt-chart__label').getBoundingClientRect();
        const b = r.querySelector('.wt-chart__plot').getBoundingClientRect();
        return b.top >= a.bottom - 1;
      });
      assert.ok(stacked, 'label above the bar at 320px');
      assertNoErrors(P.errors, assert, P.external);
    } finally {
      await P.close();
    }
  });

  /* ------------------------------------------------------------------ */
  await step('screenshots: 1280 and 390, light and dark', async () => {
    for (const scheme of ['light', 'dark']) {
      for (const vp of ['desktop', 'phone']) {
        const P = await openPage(ctx, { viewport: vp, colorScheme: scheme, reducedMotion: 'reduce' });
        try {
          const tag = `${vp === 'desktop' ? 1280 : 390}-${scheme}`;
          await openResults(P, '#/results');
          await shot(P.page, `results-overview-${tag}`, { fullPage: true });
          await openResults(P, '#/results/features');
          await shot(P.page, `results-features-${tag}`, { fullPage: true });
          await openResults(P, '#/results/' + features[1].id);
          await shot(P.page, `results-detail-${tag}`, { fullPage: true });
          await openResults(P, '#/results/people');
          await shot(P.page, `results-people-${tag}`);
          assertNoErrors(P.errors, assert, P.external);
        } finally {
          await P.close();
        }
      }
    }
  });

  /* ------------------------------------------------------------------ */
  await step('error state: a failed load shows an error with a working retry', async () => {
    const P = await openPage(ctx);
    try {
      let fail = true;
      await P.page.route('**/api/results*', (route) =>
        fail ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'server_error', message: 'Something went wrong on our side. Please try again.' } }) }) : route.continue()
      );
      await gotoApp(P.page, base, '#/results');
      const notice = P.page.locator('#view-results .wt-notice--error');
      await notice.waitFor();
      assert.equal(await notice.getAttribute('role'), 'alert');
      assert.match(text(await notice.innerText()), /We couldn’t load the results\./);
      // The server already asks to try again, so the page doesn't say it twice.
      assert.equal((text(await notice.innerText()).match(/try again/gi) || []).length, 1, 'one "try again": ' + text(await notice.innerText()));
      assert.deepEqual(
        await P.page.evaluate(() => ['Something went wrong on our side. Please try again.', 'Too many wrong admin codes. Try again in 5 minutes.', 'The server answered 502', ''].map((m) => window.WT.results.tryAgain(m))),
        ['Something went wrong on our side. Please try again.', 'Too many wrong admin codes. Try again in 5 minutes.', 'The server answered 502. Please try again.', 'Something went wrong. Please try again.']
      );
      fail = false;
      await P.page.locator('[data-action="retry"]').click();
      await P.page.locator('#fig-support').waitFor();
      assert.equal(await notice.count(), 0);
      // A failed refresh keeps the last results on screen.
      fail = true;
      await P.page.locator('[data-action="refresh"]').click();
      await P.page.locator('.wt-rs__err').waitFor();
      assert.ok(await P.page.locator('#fig-support').isVisible(), 'still shows the last results');
      fail = false;
      // The 500s are expected here.
      assertNoErrors(P.errors.filter((e) => !/500/.test(e)), assert, P.external);
    } finally {
      await P.close();
    }
  });

  /* ------------------------------------------------------------------ */
  await step('admin: a wrong code is refused with an error; nothing is stored', async () => {
    const P = await openPage(ctx);
    try {
      await gotoApp(P.page, base, '#/admin');
      await waitForView(P.page, 'admin');
      const { page } = P;
      assert.equal(text(await page.locator('#view-admin h1').innerText()), 'Admin');
      assert.match(text(await page.locator('#view-admin').innerText()), /Netlify environment variable ADMIN_CODE/);
      await page.fill('#admin-code', 'definitely-wrong');
      await page.locator('#admin-form button[type="submit"]').click();
      await page.locator('#admin-code-error').waitFor();
      assert.equal(text(await page.locator('#admin-code-error').innerText()), 'That admin code is not correct.');
      assert.equal(await page.locator('#admin-code').getAttribute('aria-invalid'), 'true');
      assert.ok(await page.locator('#admin-code').evaluate((i) => document.activeElement === i), 'focus back on the field');
      assert.equal(await page.evaluate(() => sessionStorage.getItem('infoslips.wt.admin')), null);
      await openResults(P, '#/results');
      assert.equal(await page.locator('.wt-adminbar, [data-mod]').count(), 0, 'no moderation controls');
      assertNoErrors(P.errors.filter((e) => !/401/.test(e)), assert, P.external);
    } finally {
      await P.close();
    }
  });

  /* ------------------------------------------------------------------ */
  await step('admin: right code, hide a comment, delete a reviewer, reset all with type-to-confirm, sign out', async () => {
    const P = await openPage(ctx);
    const viewer = await openPage(ctx);
    try {
      const { page } = P;
      await gotoApp(page, base, '#/admin');
      await waitForView(page, 'admin');
      await page.fill('#admin-code', adminCode);
      await page.locator('#admin-form button[type="submit"]').click();
      await page.locator('#admin-state-h').waitFor();
      assert.equal(await page.evaluate(() => sessionStorage.getItem('infoslips.wt.admin')), adminCode);
      assert.ok(await page.locator('[data-admin="signout"]').isVisible());

      // Hide a comment on the second feature.
      const f = features[1];
      let now = await results();
      const target = now.features[f.id].responses.find((r) => r.comment);
      assert.ok(target, 'a response with a comment');
      await openResults(P, '#/results/' + f.id);
      assert.ok(await page.locator('.wt-adminbar').isVisible(), 'admin bar');
      const item = page.locator(`.wt-resp[data-rid="${target.rid}"]`);
      const hideBtn = item.locator('[data-mod="hide"][data-field="comment"]');
      assert.equal(text(await hideBtn.innerText()), 'Hide comment');
      await hideBtn.click();
      await until(async () => (await results()).features[f.id].responses.find((r) => r.rid === target.rid).hiddenComment === true, 5000, 'hidden on the server');
      now = await results();
      const pub = now.features[f.id].responses.find((r) => r.rid === target.rid);
      assert.equal(pub.comment, null, 'hidden from the public results');
      await until(async () => (await item.locator('[data-mod="hide"][data-field="comment"]').innerText()).includes('Unhide comment'), 5000, 'unhide button');
      assert.equal(await item.locator('.wt-resp__part--comment .wt-resp__text').innerText(), target.comment, 'admins still see the text');
      assert.match(text(await item.locator('.wt-resp__part--comment').innerText()), /Hidden from everyone else/);
      // A visitor sees "Hidden by admin" and not the text.
      await openResults(viewer, '#/results/' + f.id);
      const vItem = viewer.page.locator(`.wt-resp[data-rid="${target.rid}"]`);
      assert.match(text(await vItem.locator('.wt-resp__part--comment').innerText()), /Hidden by admin/);
      assert.equal(await viewer.page.locator('[data-mod]').count(), 0, 'no controls for visitors');
      assert.ok(!(await vItem.innerText()).includes(target.comment.split('\n')[0]), 'comment text is not shown');
      assert.equal(await vItem.locator('[data-mod]').count(), 0);
      // Unhide again.
      await item.locator('[data-mod="hide"][data-field="comment"]').click();
      await until(async () => (await results()).features[f.id].responses.find((r) => r.rid === target.rid).hiddenComment === false, 5000, 'unhidden');

      // Delete a reviewer from the people matrix (with confirmation).
      now = await results();
      const victim = now.people.find((p) => p.name === 'Aisha Patel');
      await openResults(P, '#/results/people');
      const del = page.locator(`tr[data-rid="${victim.rid}"] [data-mod="delete"]`);
      await del.click();
      const confirm = page.locator('#wt-confirm');
      await confirm.waitFor({ state: 'visible' });
      assert.match(text(await confirm.innerText()), /Aisha Patel/);
      // Cancel first: nothing happens.
      await confirm.locator('[data-wt-close="cancel"].wt-btn--secondary').click();
      await confirm.waitFor({ state: 'hidden' });
      assert.equal((await results()).reviewers, now.reviewers);
      // The row below (or above, for the last row) takes focus once the reload has removed this one.
      const rowsBefore = await page.locator('.wt-mx-table tbody tr[data-rid]').evaluateAll((trs) => trs.map((t) => t.getAttribute('data-rid')));
      const at = rowsBefore.indexOf(victim.rid);
      const heir = rowsBefore[at + 1] || rowsBefore[at - 1];
      await page.evaluate(() => {
        window.__live = [];
        new MutationObserver(() => window.__live.push(document.getElementById('wt-live').textContent)).observe(document.getElementById('wt-live'), { childList: true, characterData: true, subtree: true });
      });
      await del.click();
      await confirm.waitFor({ state: 'visible' });
      await confirm.locator('[data-wt-confirm]').click();
      await until(async () => (await results()).reviewers === now.reviewers - 1, 5000, 'reviewer deleted');
      await until(async () => (await page.locator(`tr[data-rid="${victim.rid}"]`).count()) === 0, 5000, 'row removed');
      assert.equal(Number(await page.locator('[data-count="reviewers"] strong').innerText()), now.reviewers - 1);
      await until(async () => (await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-fk'))) === 'mxdel-' + heir, 5000, 'focus on the next row’s Delete');
      assert.ok(await page.evaluate(() => document.activeElement !== document.body), 'focus is not lost to the page');
      await until(async () => (await page.evaluate(() => window.__live.join(' | '))).includes('Answers deleted for Aisha Patel.'), 4000, 'announced');

      // Reset all: the confirm button stays disabled until RESET is typed.
      await page.locator('.wt-adminbar [data-mod="reset"]').click();
      await confirm.waitFor({ state: 'visible' });
      const ok = confirm.locator('[data-wt-confirm]');
      assert.ok(await ok.isDisabled(), 'disabled before typing');
      assert.ok(await page.locator('#wt-confirm-type').evaluate((i) => document.activeElement === i), 'focus in the type-to-confirm field');
      await page.fill('#wt-confirm-type', 'reset');
      assert.ok(await ok.isDisabled(), 'lower case is not enough');
      await page.fill('#wt-confirm-type', 'RESET');
      assert.ok(!(await ok.isDisabled()));
      await ok.click();
      await until(async () => (await results()).reviewers === 0, 5000, 'everything deleted');
      await page.locator('.wt-results__empty').waitFor();

      // Sign out: controls disappear and the stored code is gone.
      await page.locator('.wt-adminbar [data-mod="signout"]').click();
      await until(async () => (await page.locator('.wt-adminbar').count()) === 0, 3000, 'admin bar gone');
      assert.equal(await page.evaluate(() => sessionStorage.getItem('infoslips.wt.admin')), null);
      assertNoErrors(P.errors, assert, P.external);
      assertNoErrors(viewer.errors, assert, viewer.external);
    } finally {
      await P.close();
      await viewer.close();
    }
  });

  /* ------------------------------------------------------------------ */
  await step('empty state: no answers yet, with a link to start the walkthrough', async () => {
    await reset();
    const P = await openPage(ctx);
    try {
      await openResults(P);
      const empty = P.page.locator('.wt-results__empty');
      assert.equal(text(await empty.locator('h2').innerText()), 'No answers yet — be the first: start the walkthrough');
      assert.equal(await empty.locator('a').getAttribute('href'), '#/tour');
      for (const k of ['reviewers', 'answers', 'comments']) assert.equal(text(await P.page.locator(`[data-count="${k}"]`).innerText()), '0 ' + k);
      for (const hash of ['#/results/features', '#/results/people']) {
        await openResults(P, hash);
        assert.equal(await P.page.locator('.wt-results__empty').count(), 1, hash);
      }
      await openResults(P, '#/results/' + features[0].id);
      assert.match(text(await P.page.locator('.wt-detail__responses').innerText()), /No answers for this feature yet — be the first/);
      await openResults(P, '#/results/no-such-feature');
      assert.equal(text(await P.page.locator('#view-results h1').innerText()), 'Feature not found');
      assertNoErrors(P.errors, assert, P.external);
    } finally {
      await P.close();
    }
  });
}
