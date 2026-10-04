/*
 * 00-api — the review API (SPEC section 9), the stores, the Netlify function and
 * the build. HTTP checks run against the dev server started by tests/run.mjs
 * (memory store, random ADMIN_CODE); a few run createApi in-process, e.g. with
 * no ADMIN_CODE at all. Owner: foundation.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { features as readFeatures, newSecret, ridFor, seedReviewer, sleep } from './helpers.mjs';

export const meta = { timeout: 240000 };

const iso = (ms) => new Date(ms).toISOString();

export default async function ({ base, api, assert, step, reset, adminCode, root, log }) {
  const features = readFeatures();
  const ids = features.map((f) => f.id);
  const [f1, f2, f3] = ids;
  const admin = adminCode;
  const core = await import(pathToFileURL(join(root, 'server', 'api-core.mjs')).href);
  const stores = await import(pathToFileURL(join(root, 'server', 'stores.mjs')).href);

  /* ------------------------------------------------------------------ */
  await step('health: ok, store kind, feature count, no-store JSON', async () => {
    const r = await api('/api/health');
    assert.equal(r.status, 200);
    assert.equal(r.json.ok, true);
    assert.equal(r.json.store, 'memory');
    assert.equal(r.json.features, features.length);
    assert.equal(r.json.adminConfigured, true);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.match(r.headers.get('content-type'), /^application\/json/);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  });

  await step('routing: 404 for unknown endpoints, 405 with Allow for wrong methods', async () => {
    const nf = await api('/api/nope');
    assert.equal(nf.status, 404);
    assert.equal(nf.json.error.code, 'not_found');
    assert.equal(nf.headers.get('cache-control'), 'no-store');
    const m = await api('/api/health', { method: 'POST', body: {} });
    assert.equal(m.status, 405);
    assert.equal(m.json.error.code, 'method_not_allowed');
    assert.match(m.headers.get('allow'), /GET/);
    const m2 = await api('/api/admin/reset', { method: 'GET', admin });
    assert.equal(m2.status, 405);
    assert.match(m2.headers.get('allow'), /POST/);
  });

  /* ------------------------------------------------------------------ */
  await step('identity: secret required (401), must be 64 hex (400), rid = sha256(secret)[0:24]', async () => {
    const none = await api('/api/me');
    assert.equal(none.status, 401);
    assert.equal(none.json.error.code, 'no_secret');
    for (const bad of ['abc', 'g'.repeat(64), 'a'.repeat(63), 'a'.repeat(65)]) {
      const r = await api('/api/me', { secret: bad });
      assert.equal(r.status, 400, `secret ${bad.slice(0, 8)}…`);
      assert.equal(r.json.error.code, 'bad_secret');
      assert.ok(!r.text.includes(bad), 'never echoes the secret');
    }
    const secret = newSecret();
    const r = await api('/api/me', { secret });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json, { rid: ridFor(secret), name: '', answers: {} });
    assert.ok(!r.text.includes(secret), 'never echoes the secret');
  });

  await step('PUT /api/me saves name and answers, GET returns them; unknown keys ignored', async () => {
    const secret = newSecret();
    const t = iso(Date.now() - 1000);
    const r = await api('/api/me', {
      method: 'PUT',
      secret,
      body: { name: '  Sam  Ortega ', extra: 1, answers: { [f1]: { vote: 'include', priority: 'high', reason: 'Clear', comment: 'Love it', updatedAt: t, junk: true } } }
    });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.rid, ridFor(secret));
    assert.equal(r.json.name, 'Sam Ortega');
    assert.deepEqual(r.json.answers[f1], { vote: 'include', priority: 'high', reason: 'Clear', comment: 'Love it', updatedAt: t });
    assert.ok(!('extra' in r.json));
    assert.ok(r.json.createdAt && r.json.updatedAt);
    const g = await api('/api/me', { secret });
    assert.deepEqual(g.json.answers, r.json.answers);
    assert.equal(g.json.name, 'Sam Ortega');
    // Name only, and an empty body that stores nothing.
    const s2 = newSecret();
    const e = await api('/api/me', { method: 'PUT', secret: s2, body: {} });
    assert.equal(e.status, 200);
    assert.deepEqual(e.json, { rid: ridFor(s2), name: '', answers: {} });
    const n = await api('/api/me', { method: 'PUT', secret: s2, body: { name: 'Lee' } });
    assert.equal(n.json.name, 'Lee');
    assert.deepEqual(n.json.answers, {});
  });

  await step('validation: feature ids, vote, priority, types, updatedAt, JSON body', async () => {
    const secret = newSecret();
    const put = (body) => api('/api/me', { method: 'PUT', secret, body });
    const cases = [
      [{ answers: { 'not-a-feature': { vote: 'include' } } }, 422, 'unknown_feature'],
      [{ answers: { [f1]: { vote: 'yes' } } }, 422, 'invalid'],
      [{ answers: { [f1]: { priority: 'urgent' } } }, 422, 'invalid'],
      [{ answers: { [f1]: { reason: 42 } } }, 422, 'invalid'],
      [{ answers: { [f1]: 'include' } }, 422, 'invalid'],
      [{ answers: [] }, 422, 'invalid'],
      [{ answers: { [f1]: { vote: 'include', updatedAt: 'yesterday' } } }, 422, 'invalid'],
      [{ answers: { [f1]: { vote: 'include', updatedAt: '2026-13-45T99:00:00Z' } } }, 422, 'invalid'],
      [{ name: 7 }, 422, 'invalid']
    ];
    for (const [body, status, code] of cases) {
      const r = await put(body);
      assert.equal(r.status, status, JSON.stringify(body) + ' → ' + r.text);
      assert.equal(r.json.error.code, code, JSON.stringify(body));
      assert.equal(typeof r.json.error.message, 'string');
    }
    const badJson = await api('/api/me', { method: 'PUT', secret, rawBody: '{not json', headers: { 'Content-Type': 'application/json' } });
    assert.equal(badJson.status, 400);
    assert.equal(badJson.json.error.code, 'bad_json');
    const arr = await api('/api/me', { method: 'PUT', secret, rawBody: '[1,2]', headers: { 'Content-Type': 'application/json' } });
    assert.equal(arr.status, 400);
    const empty = await api('/api/me', { method: 'PUT', secret, rawBody: '', headers: { 'Content-Type': 'application/json' } });
    assert.equal(empty.status, 400);
    // Nothing was stored by the failed requests.
    assert.deepEqual((await api('/api/me', { secret })).json.answers, {});
  });

  await step('validation: length limits (name 60, reason 500, comment 2,000) after trimming', async () => {
    const secret = newSecret();
    const put = (body) => api('/api/me', { method: 'PUT', secret, body });
    assert.equal((await put({ name: 'n'.repeat(60) })).status, 200);
    assert.equal((await put({ name: '   ' + 'n'.repeat(60) + '   ' })).status, 200, 'trimmed before measuring');
    const longName = await put({ name: 'n'.repeat(61) });
    assert.equal(longName.status, 422);
    assert.equal(longName.json.error.code, 'too_long');
    assert.match(longName.json.error.message, /60/);
    assert.equal((await put({ answers: { [f1]: { reason: 'r'.repeat(500) } } })).status, 200);
    const longReason = await put({ answers: { [f1]: { reason: 'r'.repeat(501) } } });
    assert.equal(longReason.status, 422);
    assert.match(longReason.json.error.message, /500/);
    assert.equal((await put({ answers: { [f1]: { comment: 'c'.repeat(2000) } } })).status, 200);
    const longComment = await put({ answers: { [f1]: { comment: 'c'.repeat(2001) } } });
    assert.equal(longComment.status, 422);
    assert.match(longComment.json.error.message, /2,000/);
  });

  await step('text cleaning: control and bidi characters stripped, \\n kept in text, collapsed in names', async () => {
    const secret = newSecret();
    const r = await api('/api/me', {
      method: 'PUT',
      secret,
      body: { name: 'Sam\u0000\u202E\nOrtega\t', answers: { [f1]: { vote: 'exclude', reason: ' a\u0007b\r\nc\u2066d\te ', comment: 'line 1\n\nline 2\u0085' } } }
    });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.name, 'Sam Ortega');
    assert.equal(r.json.answers[f1].reason, 'ab\ncde');
    assert.equal(r.json.answers[f1].comment, 'line 1\n\nline 2');
  });

  await step('body limit: over 64 KB → 413', async () => {
    const secret = newSecret();
    const big = JSON.stringify({ name: 'x', pad: 'p'.repeat(70 * 1024) });
    const r = await api('/api/me', { method: 'PUT', secret, rawBody: big, headers: { 'Content-Type': 'application/json' } });
    assert.equal(r.status, 413);
    assert.equal(r.json.error.code, 'too_large');
    // Just under the limit is fine (unknown keys are ignored).
    const ok = JSON.stringify({ name: 'x', pad: 'p'.repeat(60 * 1024) });
    assert.equal((await api('/api/me', { method: 'PUT', secret, rawBody: ok, headers: { 'Content-Type': 'application/json' } })).status, 200);
    // Admin endpoints share the limit.
    const r2 = await api('/api/admin/reset', { method: 'POST', admin, rawBody: JSON.stringify({ confirm: 'RESET', pad: 'p'.repeat(70 * 1024) }), headers: { 'Content-Type': 'application/json' } });
    assert.equal(r2.status, 413);
  });

  await step('merge per feature: newer or equal updatedAt wins, older is ignored, other features untouched', async () => {
    const secret = newSecret();
    const now = Date.now();
    const put = (answers) => api('/api/me', { method: 'PUT', secret, body: { answers } });
    await put({ [f1]: { vote: 'include', updatedAt: iso(now - 50000) }, [f2]: { vote: 'exclude', updatedAt: iso(now - 50000) } });
    let r = await put({ [f1]: { vote: 'exclude', comment: 'older', updatedAt: iso(now - 90000) } });
    assert.equal(r.json.answers[f1].vote, 'include', 'older update ignored');
    assert.equal(r.json.answers[f1].comment, '');
    r = await put({ [f1]: { vote: 'exclude', comment: 'same time', updatedAt: iso(now - 50000) } });
    assert.equal(r.json.answers[f1].vote, 'exclude', 'equal timestamp replaces');
    r = await put({ [f1]: { vote: 'include', priority: 'low', updatedAt: iso(now - 10000) } });
    assert.deepEqual(r.json.answers[f1], { vote: 'include', priority: 'low', reason: '', comment: '', updatedAt: iso(now - 10000) }, 'whole object replaced');
    assert.equal(r.json.answers[f2].vote, 'exclude', 'other feature untouched');
  });

  await step('merge: future updatedAt is clamped to server time; missing updatedAt uses server time', async () => {
    const secret = newSecret();
    const before = Date.now();
    const r = await api('/api/me', { method: 'PUT', secret, body: { answers: { [f1]: { vote: 'include', updatedAt: iso(Date.now() + 86400000 * 30) }, [f2]: { vote: 'exclude' } } } });
    const after = Date.now();
    for (const id of [f1, f2]) {
      const t = Date.parse(r.json.answers[id].updatedAt);
      assert.ok(t >= before - 1000 && t <= after + 1000, `${id} updatedAt ${r.json.answers[id].updatedAt} within request time`);
    }
  });

  await step('clearing: answers[f] = null removes it; an empty answer removes it too', async () => {
    const secret = newSecret();
    const now = Date.now();
    await api('/api/me', { method: 'PUT', secret, body: { answers: { [f1]: { vote: 'include' }, [f2]: { priority: 'high' }, [f3]: { comment: 'hi' } } } });
    let r = await api('/api/me', { method: 'PUT', secret, body: { answers: { [f1]: null } } });
    assert.ok(!(f1 in r.json.answers));
    assert.ok(f2 in r.json.answers);
    r = await api('/api/me', { method: 'PUT', secret, body: { answers: { [f2]: { vote: null, priority: null, reason: '', comment: '   ', updatedAt: iso(now + 5) } } } });
    assert.ok(!(f2 in r.json.answers), 'an all-empty answer clears the feature');
    assert.ok(f3 in r.json.answers);
  });

  await step('DELETE /api/me removes the record', async () => {
    const { secret } = await seedReviewer(api, { name: 'Gone', answers: { [f1]: { vote: 'include' } } });
    const d = await api('/api/me', { method: 'DELETE', secret });
    assert.equal(d.status, 200);
    assert.equal(d.json.deleted, true);
    const g = await api('/api/me', { secret });
    assert.deepEqual(g.json.answers, {});
    const again = await api('/api/me', { method: 'DELETE', secret });
    assert.equal(again.json.deleted, false);
  });

  /* ------------------------------------------------------------------ */
  let A;
  let B;
  await step('results: counts, priorities, score, comments, responses and people', async () => {
    await reset();
    const empty = await api('/api/results');
    assert.equal(empty.status, 200);
    assert.equal(empty.json.reviewers, 0);
    assert.equal(empty.json.answers, 0);
    assert.deepEqual(Object.keys(empty.json.features), ids, 'every feature, in order');
    assert.deepEqual(empty.json.features[f1], { include: 0, exclude: 0, undecided: 0, priority: { high: 0, medium: 0, low: 0 }, score: null, comments: 0, reasons: 0, responses: [] });

    const t = Date.now();
    A = await seedReviewer(api, {
      name: 'Alex',
      answers: {
        [f1]: { vote: 'include', priority: 'high', reason: 'Fewer calls', comment: 'Great', updatedAt: iso(t - 3000) },
        [f2]: { vote: 'exclude', priority: 'low', updatedAt: iso(t - 3000) }
      }
    });
    B = await seedReviewer(api, {
      answers: {
        [f1]: { vote: 'include', priority: 'medium', comment: 'Yes please', updatedAt: iso(t - 1000) },
        [f2]: { priority: 'medium', updatedAt: iso(t - 1000) }
      }
    });
    await seedReviewer(api, { name: 'Name only' }); // no answers: not a reviewer in results

    const r = await api('/api/results');
    const R = r.json;
    assert.equal(R.reviewers, 2);
    assert.equal(R.answers, 4);
    assert.equal(R.comments, 2);
    assert.ok(Date.parse(R.generatedAt));
    const a = R.features[f1];
    assert.equal(a.include, 2);
    assert.equal(a.exclude, 0);
    assert.deepEqual(a.priority, { high: 1, medium: 1, low: 0 });
    assert.equal(a.score, 2.5);
    assert.equal(a.comments, 2);
    assert.equal(a.reasons, 1);
    assert.equal(a.responses.length, 2);
    assert.equal(a.responses[0].rid, B.rid, 'newest first');
    assert.equal(a.responses[0].name, '');
    assert.deepEqual(Object.keys(a.responses[1]).sort(), ['comment', 'hiddenComment', 'hiddenReason', 'name', 'priority', 'reason', 'rid', 'updatedAt', 'vote']);
    assert.equal(a.responses[1].name, 'Alex');
    assert.equal(a.responses[1].reason, 'Fewer calls');
    const b = R.features[f2];
    assert.equal(b.exclude, 1);
    assert.equal(b.undecided, 1);
    assert.deepEqual(b.priority, { high: 0, medium: 1, low: 1 });
    assert.equal(b.score, 1.5);
    assert.equal(R.features[f3].score, null);
    assert.equal(R.people.length, 2);
    const alex = R.people.find((p) => p.rid === A.rid);
    assert.equal(alex.name, 'Alex');
    assert.equal(alex.answered, 2);
    assert.ok(alex.updatedAt);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.ok(!r.text.includes(A.secret) && !r.text.includes(B.secret), 'secrets never leave');
  });

  /* ------------------------------------------------------------------ */
  await step('admin auth: 401 without or with a wrong code, 204 with the right one', async () => {
    assert.equal((await api('/api/admin/check')).status, 401);
    const wrong = await api('/api/admin/check', { admin: 'nope' });
    assert.equal(wrong.status, 401);
    assert.equal(wrong.json.error.code, 'bad_admin_code');
    assert.ok(!wrong.text.includes(admin));
    const ok = await api('/api/admin/check', { admin });
    assert.equal(ok.status, 204);
    assert.equal(ok.headers.get('cache-control'), 'no-store');
    for (const [path, body] of [
      ['/api/admin/hide', { rid: A.rid, featureId: f1, field: 'comment', hidden: true }],
      ['/api/admin/delete', { rid: A.rid }],
      ['/api/admin/reset', { confirm: 'RESET' }]
    ]) {
      assert.equal((await api(path, { method: 'POST', body })).status, 401, path + ' without code');
      assert.equal((await api(path, { method: 'POST', body, admin: admin + 'x' })).status, 401, path + ' with wrong code');
    }
    assert.equal((await api('/api/results?admin=1', { admin: 'nope' })).status, 401);
    assert.equal((await api('/api/results')).json.reviewers, 2, 'nothing changed');
  });

  await step('admin auth: 503 "Admin is not configured" when ADMIN_CODE is unset', async () => {
    for (const env of [{}, { ADMIN_CODE: '   ' }]) {
      const handle = core.createApi({ store: stores.memoryStore(), env, features });
      const call = async (method, path, body, code) => {
        const res = await handle(
          new Request('http://local' + path, {
            method,
            headers: { 'content-type': 'application/json', ...(code ? { 'x-admin-code': code } : {}) },
            body: body ? JSON.stringify(body) : undefined
          })
        );
        return { status: res.status, json: res.status === 204 ? null : await res.json() };
      };
      const c = await call('GET', '/api/admin/check', null, 'anything');
      assert.equal(c.status, 503);
      assert.equal(c.json.error.code, 'admin_not_configured');
      assert.match(c.json.error.message, /Admin is not configured/);
      assert.equal((await call('POST', '/api/admin/reset', { confirm: 'RESET' }, 'x')).status, 503);
      assert.equal((await call('POST', '/api/admin/hide', { rid: 'a'.repeat(24), featureId: f1, field: 'reason', hidden: true }, 'x')).status, 503);
      assert.equal((await call('POST', '/api/admin/delete', { rid: 'a'.repeat(24) }, 'x')).status, 503);
      assert.equal((await call('GET', '/api/results?admin=1', null, 'x')).status, 503);
      assert.equal((await call('GET', '/api/health')).json.adminConfigured, false);
    }
  });

  await step('hidden text: null with its flag for everyone, text for admins, omitted from exports', async () => {
    const hide = (field, hidden) => api('/api/admin/hide', { method: 'POST', admin, body: { rid: A.rid, featureId: f1, field, hidden } });
    let h = await hide('comment', true);
    assert.equal(h.status, 200, h.text);
    assert.deepEqual(h.json.hidden, { reason: false, comment: true });
    h = await hide('reason', true);
    assert.deepEqual(h.json.hidden, { reason: true, comment: true });

    const pub = (await api('/api/results')).json;
    const rA = pub.features[f1].responses.find((x) => x.rid === A.rid);
    assert.equal(rA.comment, null);
    assert.equal(rA.reason, null);
    assert.equal(rA.hiddenComment, true);
    assert.equal(rA.hiddenReason, true);
    assert.equal(rA.vote, 'include', 'the vote stays visible');
    assert.equal(pub.features[f1].comments, 1, 'hidden comments are not counted');
    assert.equal(pub.comments, 1);
    assert.equal(pub.admin, false);
    assert.ok(!JSON.stringify(pub).includes('Fewer calls'));

    const adm = (await api('/api/results?admin=1', { admin })).json;
    const aA = adm.features[f1].responses.find((x) => x.rid === A.rid);
    assert.equal(adm.admin, true);
    assert.equal(aA.comment, 'Great');
    assert.equal(aA.reason, 'Fewer calls');
    assert.equal(aA.hiddenComment, true);

    const csv = await api('/api/export.csv');
    assert.ok(!csv.text.includes('Great') && !csv.text.includes('Fewer calls'), 'hidden text omitted from CSV');
    const json = await api('/api/export.json');
    assert.ok(!json.text.includes('Great') && !json.text.includes('Fewer calls'), 'hidden text omitted from JSON');

    // The owner still sees their own text.
    const me = await api('/api/me', { secret: A.secret });
    assert.equal(me.json.answers[f1].comment, 'Great');
    assert.deepEqual(me.json.hidden[f1], { comment: true, reason: true });

    // Unhide.
    h = await hide('comment', false);
    assert.deepEqual(h.json.hidden, { reason: true, comment: false });
    await hide('reason', false);
    const back = (await api('/api/results')).json.features[f1].responses.find((x) => x.rid === A.rid);
    assert.equal(back.comment, 'Great');
    assert.equal(back.hiddenComment, false);
    assert.equal(back.reason, 'Fewer calls');
  });

  await step('admin hide/delete validation: 422 for bad input, 404 for unknown reviewers', async () => {
    const post = (path, body) => api(path, { method: 'POST', admin, body });
    assert.equal((await post('/api/admin/hide', { rid: 'zz', featureId: f1, field: 'comment', hidden: true })).status, 422);
    assert.equal((await post('/api/admin/hide', { rid: A.rid, featureId: 'nope', field: 'comment', hidden: true })).status, 422);
    assert.equal((await post('/api/admin/hide', { rid: A.rid, featureId: f1, field: 'vote', hidden: true })).status, 422);
    assert.equal((await post('/api/admin/hide', { rid: A.rid, featureId: f1, field: 'comment', hidden: 'yes' })).status, 422);
    assert.equal((await post('/api/admin/hide', { rid: 'f'.repeat(24), featureId: f1, field: 'comment', hidden: true })).status, 404);
    assert.equal((await post('/api/admin/delete', { rid: 'not-a-rid' })).status, 422);
    assert.equal((await post('/api/admin/delete', { rid: 'f'.repeat(24) })).status, 404);
  });

  await step('admin delete removes one reviewer', async () => {
    const d = await api('/api/admin/delete', { method: 'POST', admin, body: { rid: B.rid } });
    assert.equal(d.status, 200, d.text);
    const R = (await api('/api/results')).json;
    assert.equal(R.reviewers, 1);
    assert.ok(!R.people.some((p) => p.rid === B.rid));
    assert.deepEqual((await api('/api/me', { secret: B.secret })).json.answers, {});
  });

  /* ------------------------------------------------------------------ */
  await step('CSV export: BOM, RFC 4180 quoting, CRLF, formula injection neutralised', async () => {
    await reset();
    const t = Date.now();
    await seedReviewer(api, {
      name: '=HYPERLINK("http://evil","x")',
      answers: {
        [f1]: { vote: 'include', priority: 'high', reason: '+1 for this, really', comment: 'Line one\nLine "two"', updatedAt: iso(t - 2000) },
        [f2]: { vote: 'exclude', reason: '-5 points', comment: '@admin look', updatedAt: iso(t - 1000) }
      }
    });
    const anon = await seedReviewer(api, { answers: { [f3]: { priority: 'low', updatedAt: iso(t - 500) } } });
    const r = await api('/api/export.csv');
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /^text\/csv; charset=utf-8/);
    assert.match(r.headers.get('content-disposition'), /^attachment; filename="yes-statement-review-\d{4}-\d{2}-\d{2}\.csv"$/);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.deepEqual([...r.bytes.slice(0, 3)], [0xef, 0xbb, 0xbf], 'UTF-8 BOM');
    assert.ok(r.text.startsWith('\uFEFF'));
    const body = r.text.slice(1);
    assert.ok(body.endsWith('\r\n'));
    const lines = body.split('\r\n');
    assert.equal(lines[0], 'reviewer,feature_id,feature_title,vote,priority,reason,comment,updated_at');
    assert.ok(body.includes(`"'=HYPERLINK(""http://evil"",""x"")"`), 'name neutralised and quoted');
    assert.ok(body.includes(`"'+1 for this, really"`), 'leading + neutralised, comma quoted');
    assert.ok(body.includes(`'-5 points`), 'leading - neutralised');
    assert.ok(body.includes(`'@admin look`), 'leading @ neutralised');
    assert.ok(body.includes('"Line one\nLine ""two"""'), 'newline and quotes kept inside a quoted cell');
    assert.ok(body.includes(`Anonymous reviewer (${anon.rid.slice(0, 6)})`), 'anonymous reviewers are told apart');
    const title1 = features[0].title;
    assert.ok(body.includes(title1.includes(',') ? `"${title1}"` : title1), 'feature title present');
    // 3 data rows + header + trailing empty string
    assert.equal(lines.length, 5);
    // The cell helper itself covers tab and CR, which the API strips from input.
    assert.equal(core.csvCell('\tcmd'), "'\tcmd");
    assert.equal(core.csvCell('\rcmd'), `"'\rcmd"`);
    assert.equal(core.csvCell('=1+1'), "'=1+1");
    assert.equal(core.csvCell('safe'), 'safe');
    assert.equal(core.csvCell(null), '');
  });

  await step('JSON export: one row per reviewer × answered feature', async () => {
    const r = await api('/api/export.json');
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-disposition'), /attachment; filename="yes-statement-review-.*\.json"/);
    assert.deepEqual(r.json.columns, ['reviewer', 'feature_id', 'feature_title', 'vote', 'priority', 'reason', 'comment', 'updated_at']);
    assert.equal(r.json.rows.length, 3);
    const row = r.json.rows.find((x) => x.feature_id === f1);
    assert.equal(row.feature_title, features[0].title);
    assert.equal(row.vote, 'include');
    assert.equal(row.priority, 'high');
    assert.equal(row.reason, '+1 for this, really', 'JSON keeps raw text (no CSV escaping)');
  });

  await step('reset: needs confirm "RESET", then deletes every reviewer', async () => {
    const no = await api('/api/admin/reset', { method: 'POST', admin, body: {} });
    assert.equal(no.status, 422);
    assert.equal(no.json.error.code, 'confirm_required');
    assert.equal((await api('/api/admin/reset', { method: 'POST', admin, body: { confirm: 'reset' } })).status, 422);
    assert.equal((await api('/api/results')).json.reviewers, 2, 'nothing deleted yet');
    const nameOnly = await seedReviewer(api, { name: 'Name only' });
    const r = await api('/api/admin/reset', { method: 'POST', admin, body: { confirm: 'RESET' } });
    assert.equal(r.status, 200);
    assert.equal(r.json.deleted, 3, 'includes the name-only record');
    assert.equal((await api('/api/me', { secret: nameOnly.secret })).json.name, '');
    const R = (await api('/api/results')).json;
    assert.equal(R.reviewers, 0);
    assert.equal(R.answers, 0);
  });

  /* ------------------------------------------------------------------ */
  await step('stores: memory and file stores share one contract (get/set/delete/list/update)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wt-filestore-'));
    try {
      for (const s of [stores.memoryStore(), stores.fileStore(dir)]) {
        assert.equal(await s.get('r/x'), null, s.kind);
        await s.set('r/b', { n: 1 });
        await s.set('r/a', { n: 2 });
        await s.set('other/c', { n: 3 });
        assert.deepEqual(await s.list('r/'), ['r/a', 'r/b'], s.kind);
        const got = await s.get('r/a');
        got.n = 99;
        assert.deepEqual(await s.get('r/a'), { n: 2 }, `${s.kind} returns copies`);
        // update() serialises concurrent writers to one key.
        await Promise.all(Array.from({ length: 20 }, () => s.update('r/count', (cur) => ({ n: ((cur && cur.n) || 0) + 1 }))));
        assert.deepEqual(await s.get('r/count'), { n: 20 }, `${s.kind} update is atomic`);
        assert.deepEqual(await s.update('r/a', () => undefined), { n: 2 }, 'undefined means no write');
        await s.delete('r/b');
        await s.delete('r/missing');
        assert.deepEqual(await s.list('r/'), ['r/a', 'r/count']);
      }
      // The file store survives a restart.
      const again = stores.fileStore(dir);
      assert.deepEqual(await again.get('r/a'), { n: 2 });
      assert.equal(again.kind, 'file');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  await step('Blobs adapter: paginated list and conditional updates that retry on conflict', async () => {
    // A fake Netlify Blobs store with ETags and 2-item pages.
    const data = new Map();
    let version = 0;
    let conflictsLeft = 2;
    const fake = {
      async get(key, opts) {
        assert.equal(opts.type, 'json');
        return data.has(key) ? JSON.parse(data.get(key).body) : null;
      },
      async getWithMetadata(key) {
        const e = data.get(key);
        return e ? { data: JSON.parse(e.body), etag: e.etag, metadata: {} } : null;
      },
      async setJSON(key, value, cond = {}) {
        const e = data.get(key);
        if (conflictsLeft > 0 && (cond.onlyIfMatch || cond.onlyIfNew)) {
          conflictsLeft--;
          data.set(key, { body: JSON.stringify({ ...(e ? JSON.parse(e.body) : {}), racer: true }), etag: `"${++version}"` });
          return { modified: false };
        }
        if (cond.onlyIfMatch && (!e || e.etag !== cond.onlyIfMatch)) return { modified: false };
        if (cond.onlyIfNew && e) return { modified: false };
        data.set(key, { body: JSON.stringify(value), etag: `"${++version}"` });
        return { modified: true, etag: `"${version}"` };
      },
      async delete(key) {
        data.delete(key);
      },
      list({ prefix, paginate }) {
        assert.equal(paginate, true, 'lists with pagination');
        const keys = [...data.keys()].filter((k) => k.startsWith(prefix)).sort();
        return (async function* () {
          for (let i = 0; i < keys.length; i += 2) yield { blobs: keys.slice(i, i + 2).map((k) => ({ key: k, etag: data.get(k).etag })), directories: [] };
        })();
      }
    };
    const s = stores.blobsStore(fake);
    assert.equal(s.kind, 'blobs');
    for (let i = 0; i < 5; i++) await s.set(`r/${i}`, { i });
    await s.set('x/1', {});
    assert.deepEqual(await s.list('r/'), ['r/0', 'r/1', 'r/2', 'r/3', 'r/4'], 'all pages collected');
    const out = await s.update('r/1', (cur) => ({ ...cur, merged: true }));
    assert.equal(out.merged, true);
    assert.equal(out.racer, true, 're-read after the conflict and kept the other writer’s change');
    assert.equal(conflictsLeft, 0);

    // Through the API with the Blobs adapter.
    const handle = core.createApi({ store: stores.blobsStore(fake), env: { ADMIN_CODE: 'z' }, features });
    const secret = newSecret();
    const res = await handle(new Request('http://x/api/me', { method: 'PUT', headers: { 'x-reviewer-secret': secret, 'content-type': 'application/json' }, body: JSON.stringify({ answers: { [f1]: { vote: 'include' } } }) }));
    assert.equal(res.status, 200);
    const health = await (await handle(new Request('http://x/api/health'))).json();
    assert.equal(health.store, 'blobs');
  });

  await step('Netlify function: config.path /api/* and an end-to-end run on a local Blobs server', async () => {
    const fnUrl = pathToFileURL(join(root, 'netlify', 'functions', 'api.mjs')).href;
    const blobsDir = mkdtempSync(join(tmpdir(), 'wt-blobs-'));
    let server = null;
    const prevAdmin = process.env.ADMIN_CODE;
    try {
      const { BlobsServer } = await import(pathToFileURL(join(root, 'node_modules', '@netlify', 'blobs', 'dist', 'server.js')).href);
      const { setEnvironmentContext } = await import(pathToFileURL(join(root, 'node_modules', '@netlify', 'blobs', 'dist', 'main.js')).href);
      const token = 'tok-' + newSecret().slice(0, 8);
      server = new BlobsServer({ directory: blobsDir, token, port: 0 });
      const { port } = await server.start();
      const url = `http://127.0.0.1:${port}`;
      setEnvironmentContext({ siteID: 'wt-test-site', token, edgeURL: url, uncachedEdgeURL: url, primaryRegion: 'us-east-1' });
      process.env.ADMIN_CODE = 'fn-admin';
      const fn = await import(fnUrl);
      assert.deepEqual(fn.config, { path: '/api/*' });
      const call = async (method, path, body, headers = {}) => {
        const res = await fn.default(new Request('https://wt.example' + path, { method, headers: { 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined }));
        return { status: res.status, json: res.status === 204 ? null : await res.json() };
      };
      assert.equal((await call('GET', '/api/health')).json.store, 'blobs');
      const secret = newSecret();
      const saved = await call('PUT', '/api/me', { name: 'Blob', answers: { [f1]: { vote: 'include', priority: 'high' } } }, { 'x-reviewer-secret': secret });
      assert.equal(saved.status, 200);
      const again = await call('PUT', '/api/me', { answers: { [f2]: { vote: 'exclude' } } }, { 'x-reviewer-secret': secret });
      assert.equal(again.status, 200);
      assert.deepEqual(Object.keys(again.json.answers).sort(), [f1, f2].sort());
      const R = await call('GET', '/api/results');
      assert.equal(R.json.reviewers, 1);
      assert.equal(R.json.features[f1].include, 1);
      assert.equal((await call('GET', '/api/admin/check', null, { 'x-admin-code': 'fn-admin' })).status, 204);
      assert.equal((await call('GET', '/api/admin/check', null, { 'x-admin-code': 'nope' })).status, 401);
      const rs = await call('POST', '/api/admin/reset', { confirm: 'RESET' }, { 'x-admin-code': 'fn-admin' });
      assert.equal(rs.json.deleted, 1);
      assert.equal((await call('GET', '/api/results')).json.reviewers, 0);
    } finally {
      if (prevAdmin === undefined) delete process.env.ADMIN_CODE;
      else process.env.ADMIN_CODE = prevAdmin;
      if (server) await server.stop();
      rmSync(blobsDir, { recursive: true, force: true });
    }
  });

  /* ------------------------------------------------------------------ */
  await step('netlify.toml mirrors the dev server headers', async () => {
    const toml = readFileSync(join(root, 'netlify.toml'), 'utf8');
    const dev = await import(pathToFileURL(join(root, 'server', 'dev.mjs')).href);
    assert.match(toml, /publish = "public"/);
    assert.match(toml, /functions = "netlify\/functions"/);
    for (const [k, v] of Object.entries(dev.SECURITY_HEADERS)) assert.ok(toml.includes(`${k} = "${v}"`), `${k} in netlify.toml`);
    const csp = toml.match(/Content-Security-Policy = "([^"]+)"/g) || [];
    assert.equal(csp.length, 2, 'CSP on / and /index.html');
    for (const line of csp) assert.equal(line, `Content-Security-Policy = "${dev.CSP}"`);
    assert.ok(!/for = "\/statement/.test(toml), 'no CSP block for /statement/*');
  });

  await step('build: deterministic output, byte-identical statement, hashed assets, robots', async () => {
    const { build } = await import(pathToFileURL(join(root, 'build.mjs')).href);
    const d1 = mkdtempSync(join(tmpdir(), 'wt-b1-'));
    const d2 = mkdtempSync(join(tmpdir(), 'wt-b2-'));
    try {
      const b1 = await build({ out: d1, quiet: true });
      await sleep(20);
      const b2 = await build({ out: d2, quiet: true });
      const hashTree = (dir) => {
        const out = {};
        const walk = (d) => {
          for (const n of readdirSync(d).sort()) {
            const p = join(d, n);
            if (statSync(p).isDirectory()) walk(p);
            else out[relative(dir, p)] = createHash('sha256').update(readFileSync(p)).digest('hex');
          }
        };
        walk(dir);
        return out;
      };
      const t1 = hashTree(d1);
      assert.deepEqual(hashTree(d2), t1, 'two builds are byte-identical');
      const statement = readFileSync(join(root, '..', 'dist', 'yes-statement.html'));
      assert.equal(t1['statement/index.html'], createHash('sha256').update(statement).digest('hex'), 'statement copied byte for byte');
      assert.equal(b1.statementSha256, t1['statement/index.html']);
      assert.match(b1.js, /^app\.[0-9a-f]{10}\.js$/);
      assert.match(b1.css, /^app\.[0-9a-f]{10}\.css$/);
      assert.match(b1.boot, /^assets\/theme-boot\.[0-9a-f]{10}\.js$/);
      assert.equal(b1.js, b2.js);
      const html = readFileSync(join(d1, 'index.html'), 'utf8');
      for (const ref of [b1.js, b1.css, b1.boot]) assert.ok(html.includes(`"${ref}"`), `index.html references ${ref}`);
      assert.ok(!/\{\{/.test(html), 'no placeholders left');
      assert.ok(!/<script>(?!\s*<\/script>)/.test(html) && !/<script(?![^>]*\bsrc=)[^>]*>/.test(html), 'no inline scripts (CSP)');
      assert.ok(!/\sstyle=/.test(html), 'no inline styles (CSP)');
      for (const v of ['start', 'tour', 'results', 'data', 'admin']) assert.ok(html.includes(`id="view-${v}"`));
      assert.equal(readFileSync(join(d1, 'robots.txt'), 'utf8'), 'User-agent: *\nDisallow: /\n');
      assert.deepEqual(JSON.parse(readFileSync(join(d1, 'features.json'), 'utf8')), features);
      for (const f of ['assets/fonts/inter-latin-wght-normal.woff2', 'assets/brand/infoslips-logo-on-light.png', 'assets/brand/infoslips-logo-white.png', 'assets/icons/favicon-32.png', 'assets/icons/apple-touch-icon.png', 'favicon.ico']) {
        assert.ok(existsSync(join(d1, f)), f);
      }
      const bundle = readFileSync(join(d1, b1.js), 'utf8');
      assert.ok(bundle.includes(JSON.stringify(features)), 'features inlined as WT.features');
      // Rebuilding into the same directory works; a foreign non-empty directory is refused.
      await build({ out: d1, quiet: true });
      const foreign = mkdtempSync(join(tmpdir(), 'wt-foreign-'));
      try {
        writeFileSync(join(foreign, 'precious.txt'), 'keep me');
        await assert.rejects(build({ out: foreign, quiet: true }), /Refusing/);
        assert.ok(existsSync(join(foreign, 'precious.txt')));
      } finally {
        rmSync(foreign, { recursive: true, force: true });
      }
    } finally {
      rmSync(d1, { recursive: true, force: true });
      rmSync(d2, { recursive: true, force: true });
    }
  });

  log(`${features.length} features checked against the API`);
}
