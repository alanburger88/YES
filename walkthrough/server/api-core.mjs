/*
 * InfoSlips × YES statement review — API core (SPEC section 9).
 *
 *   createApi({ store, env, features }) → async (Request) => Response
 *
 * Pure Web platform code (Fetch API Request/Response + Web Crypto), so the same
 * handler runs in Netlify Functions v2 (netlify/functions/api.mjs) and in the
 * local server (server/dev.mjs). `store` is any store from server/stores.mjs.
 * `env.ADMIN_CODE` is read on every request.
 *
 * Every response is JSON (except the CSV export) with Cache-Control: no-store
 * and the API_HEADERS below (noindex, same-origin referrer, nosniff), errors and
 * exports included. Errors are { error: { code, message } }. Secrets are never
 * echoed or logged.
 *
 * Per-instance state (createApiState()) holds a short memo of the public
 * results/exports and the admin-code throttle. Netlify keeps one state per
 * function instance (netlify/functions/api.mjs); the dev server keeps one per
 * process. Both are best-effort: another instance never sees this one's state.
 */

export const MAX_BODY = 64 * 1024;
export const LIMITS = Object.freeze({ name: 60, reason: 500, comment: 2000 });
export const VOTES = Object.freeze(['include', 'exclude']);
export const PRIORITIES = Object.freeze(['high', 'medium', 'low']);
export const PREFIX = 'r/';
export const ANONYMOUS = 'Anonymous reviewer';
/** An ADMIN_CODE shorter than this is treated as not configured (503). */
export const ADMIN_MIN_LENGTH = 16;
/** Headers on every API response (JSON, CSV/JSON exports, 204s and errors). */
export const API_HEADERS = Object.freeze({
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'same-origin',
  'x-robots-tag': 'noindex, nofollow'
});
/** Public results and exports are memoised this long per instance (any write in the instance clears it). */
export const MEMO_MS = 3000;
/** Wrong admin codes allowed per client IP within windowMs before a lockMs lock-out (429). */
export const ADMIN_THROTTLE = Object.freeze({ max: 10, windowMs: 10 * 60 * 1000, lockMs: 10 * 60 * 1000 });
/** Concurrent store reads/deletes when loading or resetting every record. */
const READ_CONCURRENCY = 32;

const SECRET_RE = /^[0-9a-f]{64}$/i;
const RID_RE = /^[0-9a-f]{24}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})$/;
// C0/C1 controls except \n, plus bidi overrides/isolates and the BOM. Tabs are
// turned into spaces before this runs (see cleanText).
const CONTROL_RE = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069\uFEFF]/g;
// Characters that render as nothing. Text made only of these (and whitespace)
// counts as empty; inside other text they are kept (U+200D joins emoji).
const INVISIBLE_RE = /[\u00AD\u034F\u115F\u1160\u180E\u200B-\u200F\u2060-\u2064\u3164\uFEFF\uFFA0]/g;
const FIELD_LABEL = { name: 'Your name', reason: 'The reason', comment: 'The comment' };
const CSV_COLUMNS = ['reviewer', 'feature_id', 'feature_title', 'vote', 'priority', 'reason', 'comment', 'updated_at'];

export class HttpError extends Error {
  constructor(status, code, message, headers) {
    super(message);
    this.status = status;
    this.code = code;
    this.headers = headers || null;
  }
}

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

const enc = new TextEncoder();

async function sha256(text) {
  return new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', enc.encode(text)));
}
const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/** rid = sha256hex(secret).slice(0, 24) */
export async function ridFor(secret) {
  return hex(await sha256(String(secret).toLowerCase())).slice(0, 24);
}

/** Constant-time comparison: both sides are hashed first, so lengths never leak. */
async function safeEqual(a, b) {
  const [x, y] = await Promise.all([sha256(String(a)), sha256(String(b))]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

function baseHeaders(extra) {
  return {
    'content-type': 'application/json; charset=utf-8',
    ...API_HEADERS,
    ...(extra || {})
  };
}

/** Puts API_HEADERS on any response (exports, 204s, errors) as the last step. */
function withApiHeaders(res) {
  for (const [k, v] of Object.entries(API_HEADERS)) res.headers.set(k, v);
  return res;
}

function json(status, data, extra) {
  return new Response(status === 204 ? null : JSON.stringify(data), { status, headers: baseHeaders(extra) });
}

function errorResponse(err) {
  return json(err.status, { error: { code: err.code, message: err.message } }, err.headers);
}

/** Runs fn over items with at most `limit` in flight. */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

/** Reads the request body as JSON, refusing anything over MAX_BODY without buffering it all. */
async function readJson(request) {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BODY) throw tooLarge();
  let text = '';
  if (request.body) {
    const reader = request.body.getReader();
    const decoder = new TextDecoder();
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY) {
        try {
          await reader.cancel();
        } catch {
          /* ignore */
        }
        throw tooLarge();
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  }
  if (!text.trim()) throw new HttpError(400, 'bad_json', 'Send a JSON object in the request body.');
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new HttpError(400, 'bad_json', 'The request body is not valid JSON.');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new HttpError(400, 'bad_json', 'The request body must be a JSON object.');
  }
  return data;
}

function tooLarge() {
  return new HttpError(413, 'too_large', 'The request is larger than 64 KB. Save fewer answers at once.');
}

/**
 * Trims, normalises line breaks, turns tabs into spaces and strips control
 * characters (keeping \n when multiline). Text made only of invisible
 * characters (zero-width spaces and joiners, U+2060, the BOM …) is empty.
 * Over-long text is refused with 422.
 */
export function cleanText(value, field, max, multiline) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new HttpError(422, 'invalid', `${FIELD_LABEL[field] || field} must be text.`);
  let s = value.replace(/\r\n?/g, '\n').replace(/\t/g, ' ').replace(CONTROL_RE, '');
  if (!multiline) s = s.replace(/\s*\n\s*/g, ' ').replace(/ {2,}/g, ' ');
  s = s.trim();
  if (!s.replace(INVISIBLE_RE, '').trim()) s = '';
  if (s.length > max) {
    throw new HttpError(422, 'too_long', `${FIELD_LABEL[field] || field} is ${s.length} characters long. The maximum is ${max.toLocaleString('en-GB')}.`);
  }
  return s;
}

const isEmptyAnswer = (a) => !a || (a.vote === null && a.priority === null && !a.reason && !a.comment);

/**
 * Per-instance state shared by every createApi() call that is given it:
 * { gen, memo, attempts }. gen counts writes (the memo is only valid for the
 * gen it was read in), memo holds the public records read, attempts holds the
 * wrong admin codes per client IP.
 */
export function createApiState() {
  return { gen: 0, memo: null, attempts: new Map() };
}

function clientIpFrom(request) {
  const nf = request.headers.get('x-nf-client-connection-ip');
  if (nf && nf.trim()) return nf.trim();
  const xff = request.headers.get('x-forwarded-for');
  const first = xff ? xff.split(',')[0].trim() : '';
  return first || 'unknown';
}

/* ------------------------------------------------------------------ */
/* The API                                                             */
/* ------------------------------------------------------------------ */

/**
 * createApi({ store, env, features, now?, logger?, state?, memoMs?, throttle?, clientIp? })
 *   state     createApiState(): pass the same object on every request to share
 *             the results memo and the admin throttle (the Netlify function does).
 *   memoMs    how long public results/exports are memoised (MEMO_MS; 0 = never).
 *   throttle  { max, windowMs, lockMs } for wrong admin codes (ADMIN_THROTTLE).
 *   clientIp  (request) => string; defaults to x-nf-client-connection-ip, then
 *             the first x-forwarded-for entry, then 'unknown'.
 */
export function createApi({
  store,
  env = {},
  features,
  now = () => Date.now(),
  logger = console,
  state = createApiState(),
  memoMs = MEMO_MS,
  throttle = ADMIN_THROTTLE,
  clientIp = null
} = {}) {
  if (!store) throw new Error('createApi: store is required');
  if (!Array.isArray(features) || !features.length) throw new Error('createApi: features must be a non-empty array');
  const byId = new Map(features.map((f) => [f.id, f]));
  const order = features.map((f) => f.id);
  const readEnv = (name) => {
    const v = typeof env === 'function' ? env(name) : env && env[name];
    return typeof v === 'string' ? v.trim() : '';
  };
  const adminCode = () => {
    const code = readEnv('ADMIN_CODE');
    return code.length >= ADMIN_MIN_LENGTH ? code : '';
  };
  const ipOf = (request) => {
    let ip = '';
    try {
      ip = clientIp ? clientIp(request) : '';
    } catch {
      ip = '';
    }
    return typeof ip === 'string' && ip ? ip : clientIpFrom(request);
  };

  /* ---------- identity ---------- */

  async function reviewerFrom(request) {
    const secret = request.headers.get('x-reviewer-secret');
    if (!secret) throw new HttpError(401, 'no_secret', 'Missing the X-Reviewer-Secret header.');
    if (!SECRET_RE.test(secret)) throw new HttpError(400, 'bad_secret', 'X-Reviewer-Secret must be 64 hexadecimal characters.');
    return ridFor(secret);
  }

  /* ---------- admin code: configured, throttled, timing-safe ---------- */

  function lockedFor(ip, t) {
    const a = state.attempts.get(ip);
    if (!a) return 0;
    if (a.lockedUntil > t) return a.lockedUntil - t;
    if (a.lockedUntil) state.attempts.delete(ip); // the lock-out is over: start afresh
    return 0;
  }

  function recordFailure(ip, t) {
    const a = state.attempts.get(ip) || { fails: [], lockedUntil: 0 };
    a.fails = a.fails.filter((x) => t - x < throttle.windowMs);
    a.fails.push(t);
    if (a.fails.length >= throttle.max) a.lockedUntil = t + throttle.lockMs;
    state.attempts.delete(ip); // re-insert so the Map stays in least-recently-used order
    state.attempts.set(ip, a);
    if (state.attempts.size > 10000) {
      // Best effort: drop the stalest entries first.
      for (const [k, v] of state.attempts) {
        if (state.attempts.size <= 5000) break;
        if (!(v.lockedUntil > t)) state.attempts.delete(k);
      }
    }
  }

  async function requireAdmin(request) {
    const raw = readEnv('ADMIN_CODE');
    if (!raw) throw new HttpError(503, 'admin_not_configured', 'Admin is not configured. Set the ADMIN_CODE environment variable.');
    const code = adminCode();
    if (!code) throw new HttpError(503, 'admin_not_configured', `Admin is not configured: ADMIN_CODE must be at least ${ADMIN_MIN_LENGTH} characters`);
    const ip = ipOf(request);
    const t = now();
    const wait = lockedFor(ip, t);
    if (wait > 0) {
      const minutes = Math.max(1, Math.ceil(wait / 60000));
      throw new HttpError(429, 'too_many_attempts', `Too many wrong admin codes. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`, {
        'retry-after': String(Math.ceil(wait / 1000))
      });
    }
    const given = request.headers.get('x-admin-code') || '';
    if (!given) throw new HttpError(401, 'bad_admin_code', 'That admin code is not correct.');
    if (!(await safeEqual(given, code))) {
      recordFailure(ip, t);
      throw new HttpError(401, 'bad_admin_code', 'That admin code is not correct.');
    }
    state.attempts.delete(ip); // a right code clears this address's wrong attempts
  }

  /* ---------- writes and the public-results memo ---------- */

  /** Runs a write, invalidating the memo before and after it, so a read that overlaps it is never memoised. */
  async function writing(fn) {
    state.gen++;
    state.memo = null;
    try {
      return await fn();
    } finally {
      state.gen++;
      state.memo = null;
    }
  }

  /**
   * Every record for the public results and exports, memoised for memoMs in
   * this instance. Concurrent readers share one read. Admin views never use it.
   */
  function publicRecords() {
    const t = now();
    const m = state.memo;
    if (memoMs > 0 && m && m.gen === state.gen && t - m.at < memoMs) return m.promise;
    const entry = { gen: state.gen, at: t, promise: allRecords() };
    if (memoMs > 0) {
      state.memo = entry;
      entry.promise.catch(() => {
        if (state.memo === entry) state.memo = null;
      });
    }
    return entry.promise;
  }

  /* ---------- validation ---------- */

  function cleanAnswer(featureId, a, nowMs) {
    if (a === null) return null;
    if (typeof a !== 'object' || Array.isArray(a)) throw new HttpError(422, 'invalid', `The answer for "${featureId}" must be an object or null.`);
    const vote = a.vote === undefined ? null : a.vote;
    if (vote !== null && !VOTES.includes(vote)) throw new HttpError(422, 'invalid', 'vote must be "include", "exclude" or null.');
    const priority = a.priority === undefined ? null : a.priority;
    if (priority !== null && !PRIORITIES.includes(priority)) throw new HttpError(422, 'invalid', 'priority must be "high", "medium", "low" or null.');
    const reason = cleanText(a.reason, 'reason', LIMITS.reason, true);
    const comment = cleanText(a.comment, 'comment', LIMITS.comment, true);
    let at = nowMs;
    if (a.updatedAt !== undefined && a.updatedAt !== null) {
      const ms = typeof a.updatedAt === 'string' && ISO_RE.test(a.updatedAt) ? Date.parse(a.updatedAt) : NaN;
      if (!Number.isFinite(ms)) throw new HttpError(422, 'invalid', 'updatedAt must be an ISO 8601 date and time.');
      at = Math.min(ms, nowMs); // clamp to server time
    }
    return { vote, priority, reason, comment, updatedAt: new Date(at).toISOString() };
  }

  function cleanMeBody(body, nowMs) {
    const out = {};
    if ('name' in body) out.name = cleanText(body.name, 'name', LIMITS.name, false);
    if ('answers' in body && body.answers !== null && body.answers !== undefined) {
      if (typeof body.answers !== 'object' || Array.isArray(body.answers)) throw new HttpError(422, 'invalid', 'answers must be an object keyed by feature id.');
      out.answers = {};
      for (const [id, a] of Object.entries(body.answers)) {
        if (!byId.has(id)) throw new HttpError(422, 'unknown_feature', `There is no feature called "${String(id).slice(0, 40)}".`);
        out.answers[id] = cleanAnswer(id, a, nowMs);
      }
    }
    return out;
  }

  /* ---------- records ---------- */

  const emptyMe = (rid) => ({ rid, name: '', answers: {} });

  function publicRecord(rec) {
    return {
      rid: rec.rid,
      name: rec.name || '',
      createdAt: rec.createdAt,
      updatedAt: rec.updatedAt,
      answers: rec.answers || {},
      hidden: rec.hidden || {}
    };
  }

  /** Pure merge used inside store.update (may run more than once). */
  function mergeMe(current, rid, patch, nowIso) {
    // No record yet and no answer to store: create nothing. A name on its own
    // is never stored; the client sends it again with its first answer.
    const hasAnswers = Object.values(patch.answers || {}).some((a) => a && !isEmptyAnswer(a));
    if (!current && !hasAnswers) return undefined;
    const rec = current
      ? { ...current, answers: { ...(current.answers || {}) }, hidden: { ...(current.hidden || {}) } }
      : { rid, name: '', createdAt: nowIso, updatedAt: nowIso, answers: {}, hidden: {} };
    if ('name' in patch) rec.name = patch.name;
    for (const [id, a] of Object.entries(patch.answers || {})) {
      const prev = rec.answers[id];
      if (a === null) {
        delete rec.answers[id];
        continue;
      }
      if (prev && Date.parse(a.updatedAt) < Date.parse(prev.updatedAt)) continue; // stored one is newer
      if (isEmptyAnswer(a)) delete rec.answers[id];
      else rec.answers[id] = a;
    }
    rec.rid = rid;
    rec.updatedAt = nowIso;
    return rec;
  }

  async function allRecords() {
    const keys = await store.list(PREFIX);
    const recs = await mapLimit(keys, READ_CONCURRENCY, (k) => store.get(k));
    return recs.filter((r) => r && typeof r === 'object' && typeof r.rid === 'string');
  }

  function buildResults(records, { admin }) {
    const featuresOut = {};
    for (const id of order) {
      featuresOut[id] = {
        include: 0,
        exclude: 0,
        undecided: 0,
        priority: { high: 0, medium: 0, low: 0 },
        score: null,
        comments: 0,
        reasons: 0,
        responses: []
      };
    }
    const people = [];
    let answers = 0;
    let comments = 0;
    for (const rec of records) {
      let answered = 0;
      let latest = '';
      for (const id of order) {
        const a = rec.answers && rec.answers[id];
        if (!a || isEmptyAnswer(a)) continue;
        const f = featuresOut[id];
        answered++;
        if (a.vote === 'include') f.include++;
        else if (a.vote === 'exclude') f.exclude++;
        else f.undecided++;
        // Priority rule: features[id].priority (and so the score) counts only
        // responses that did NOT vote "exclude" (an include or no vote yet). A
        // priority given with an exclude is "priority if included", not support,
        // so it stays in that response's own `priority` in responses[] (the UI
        // shows it as "if included") but is left out of the counts.
        if (a.priority && a.vote !== 'exclude' && f.priority[a.priority] !== undefined) f.priority[a.priority]++;
        const hid = (rec.hidden && rec.hidden[id]) || {};
        const hiddenReason = !!hid.reason;
        const hiddenComment = !!hid.comment;
        if (a.comment && !hiddenComment) {
          f.comments++;
          comments++;
        }
        if (a.reason && !hiddenReason) f.reasons++;
        f.responses.push({
          rid: rec.rid,
          name: rec.name || '',
          vote: a.vote || null,
          priority: a.priority || null,
          reason: hiddenReason && !admin ? null : a.reason || '',
          comment: hiddenComment && !admin ? null : a.comment || '',
          updatedAt: a.updatedAt,
          hiddenReason,
          hiddenComment
        });
        if (a.updatedAt > latest) latest = a.updatedAt;
      }
      if (answered) {
        answers += answered;
        people.push({ rid: rec.rid, name: rec.name || '', answered, createdAt: rec.createdAt || latest, updatedAt: latest || rec.updatedAt });
      }
    }
    for (const id of order) {
      const f = featuresOut[id];
      const n = f.priority.high + f.priority.medium + f.priority.low;
      f.score = n ? Math.round(((f.priority.high * 3 + f.priority.medium * 2 + f.priority.low) / n) * 100) / 100 : null;
      f.responses.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
    }
    people.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
    return {
      generatedAt: new Date(now()).toISOString(),
      admin: !!admin,
      reviewers: people.length,
      answers,
      comments,
      features: featuresOut,
      people
    };
  }

  function exportRows(records) {
    const recs = records.slice().sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')) || a.rid.localeCompare(b.rid));
    const rows = [];
    for (const rec of recs) {
      const reviewer = rec.name || `${ANONYMOUS} (${rec.rid.slice(0, 6)})`;
      for (const id of order) {
        const a = rec.answers && rec.answers[id];
        if (!a || isEmptyAnswer(a)) continue;
        const hid = (rec.hidden && rec.hidden[id]) || {};
        rows.push({
          reviewer,
          feature_id: id,
          feature_title: byId.get(id).title,
          vote: a.vote || '',
          priority: a.priority || '',
          reason: hid.reason ? '' : a.reason || '',
          comment: hid.comment ? '' : a.comment || '',
          updated_at: a.updatedAt
        });
      }
    }
    return rows;
  }

  const stamp = () => new Date(now()).toISOString().slice(0, 10);

  /* ---------- handlers ---------- */

  const handlers = {
    health: {
      GET: async () => json(200, { ok: true, store: store.kind || 'memory', features: order.length, adminConfigured: !!adminCode() })
    },

    me: {
      GET: async (req) => {
        const rid = await reviewerFrom(req);
        const rec = await store.get(PREFIX + rid);
        return json(200, rec ? publicRecord(rec) : emptyMe(rid));
      },
      PUT: async (req) => {
        const rid = await reviewerFrom(req);
        const body = await readJson(req);
        const nowMs = now();
        const patch = cleanMeBody(body, nowMs);
        const nowIso = new Date(nowMs).toISOString();
        const rec = await writing(() => store.update(PREFIX + rid, (current) => mergeMe(current, rid, patch, nowIso)));
        if (rec) return json(200, publicRecord(rec));
        // Nothing stored (no record and no answers): the would-be record, without createdAt.
        return json(200, { ...emptyMe(rid), name: typeof patch.name === 'string' ? patch.name : '' });
      },
      DELETE: async (req) => {
        const rid = await reviewerFrom(req);
        const existed = await writing(async () => {
          const had = !!(await store.get(PREFIX + rid));
          if (had) await store.delete(PREFIX + rid);
          return had;
        });
        return json(200, { ok: true, deleted: existed, rid });
      }
    },

    results: {
      GET: async (req, url) => {
        if (url.searchParams.get('admin') === '1') {
          await requireAdmin(req);
          return json(200, buildResults(await allRecords(), { admin: true })); // admin views are never memoised
        }
        return json(200, buildResults(await publicRecords(), { admin: false }));
      }
    },

    'export.json': {
      GET: async () => {
        const rows = exportRows(await publicRecords());
        const body = { generatedAt: new Date(now()).toISOString(), columns: CSV_COLUMNS, rows };
        return new Response(JSON.stringify(body, null, 2), {
          status: 200,
          headers: baseHeaders({ 'content-disposition': `attachment; filename="yes-statement-review-${stamp()}.json"` })
        });
      }
    },

    'export.csv': {
      GET: async () => {
        const rows = exportRows(await publicRecords());
        const lines = [CSV_COLUMNS.join(',')].concat(rows.map((r) => CSV_COLUMNS.map((c) => csvCell(r[c])).join(',')));
        return new Response('\uFEFF' + lines.join('\r\n') + '\r\n', {
          status: 200,
          headers: {
            'content-type': 'text/csv; charset=utf-8',
            ...API_HEADERS,
            'content-disposition': `attachment; filename="yes-statement-review-${stamp()}.csv"`
          }
        });
      }
    },

    'admin/check': {
      GET: async (req) => {
        await requireAdmin(req);
        return new Response(null, { status: 204, headers: { ...API_HEADERS } });
      }
    },

    'admin/hide': {
      POST: async (req) => {
        await requireAdmin(req);
        const body = await readJson(req);
        const { rid, featureId, field, hidden } = body;
        if (typeof rid !== 'string' || !RID_RE.test(rid)) throw new HttpError(422, 'invalid', 'rid must be a 24-character reviewer id.');
        if (!byId.has(featureId)) throw new HttpError(422, 'unknown_feature', 'featureId must be a feature id.');
        if (field !== 'reason' && field !== 'comment') throw new HttpError(422, 'invalid', 'field must be "reason" or "comment".');
        if (typeof hidden !== 'boolean') throw new HttpError(422, 'invalid', 'hidden must be true or false.');
        let found = false;
        const rec = await writing(() =>
          store.update(PREFIX + rid, (current) => {
            found = !!current;
            if (!current) return undefined;
            const all = { ...(current.hidden || {}) };
            const one = { ...(all[featureId] || {}) };
            if (hidden) one[field] = true;
            else delete one[field];
            if (Object.keys(one).length) all[featureId] = one;
            else delete all[featureId];
            return { ...current, hidden: all };
          })
        );
        if (!found || !rec) throw new HttpError(404, 'not_found', 'There is no reviewer with that id.');
        const h = (rec.hidden && rec.hidden[featureId]) || {};
        return json(200, { ok: true, rid, featureId, hidden: { reason: !!h.reason, comment: !!h.comment } });
      }
    },

    'admin/delete': {
      POST: async (req) => {
        await requireAdmin(req);
        const { rid } = await readJson(req);
        if (typeof rid !== 'string' || !RID_RE.test(rid)) throw new HttpError(422, 'invalid', 'rid must be a 24-character reviewer id.');
        await writing(async () => {
          if (!(await store.get(PREFIX + rid))) throw new HttpError(404, 'not_found', 'There is no reviewer with that id.');
          await store.delete(PREFIX + rid);
        });
        return json(200, { ok: true, rid });
      }
    },

    'admin/reset': {
      POST: async (req) => {
        await requireAdmin(req);
        const { confirm } = await readJson(req);
        if (confirm !== 'RESET') throw new HttpError(422, 'confirm_required', 'Type RESET to confirm.');
        const deleted = await writing(async () => {
          // One bulk call when the store has it (Netlify Blobs deleteAll), else batched deletes.
          if (typeof store.deleteAll === 'function') return store.deleteAll(PREFIX);
          const keys = await store.list(PREFIX);
          await mapLimit(keys, READ_CONCURRENCY, (k) => store.delete(k));
          return keys.length;
        });
        return json(200, { ok: true, deleted });
      }
    }
  };

  return async function handle(request) {
    try {
      const url = new URL(request.url);
      const path = url.pathname.replace(/\/+$/, '');
      if (!path.startsWith('/api/')) throw new HttpError(404, 'not_found', 'Not found.');
      const route = handlers[path.slice(5)];
      if (!route) throw new HttpError(404, 'not_found', 'There is no API endpoint at this address.');
      const method = request.method === 'HEAD' ? 'GET' : request.method;
      const fn = route[method];
      if (!fn) {
        const allow = Object.keys(route).join(', ');
        throw new HttpError(405, 'method_not_allowed', `Use ${allow} for this endpoint.`, { allow });
      }
      const res = await fn(request, url);
      return withApiHeaders(request.method === 'HEAD' ? new Response(null, { status: res.status, headers: res.headers }) : res);
    } catch (err) {
      if (err instanceof HttpError) return withApiHeaders(errorResponse(err));
      if (err && err.status === 409) return withApiHeaders(errorResponse(new HttpError(409, 'conflict', 'Your answers changed in another tab while saving. Please try again.')));
      try {
        logger.error('[api] unexpected error:', err && err.stack ? err.stack : err);
      } catch {
        /* ignore */
      }
      return withApiHeaders(errorResponse(new HttpError(500, 'server_error', 'Something went wrong on our side. Please try again.')));
    }
  };
}

/** RFC 4180 cell, with spreadsheet formula injection neutralised. */
export function csvCell(value) {
  let s = value === undefined || value === null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  if (/[",\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}
