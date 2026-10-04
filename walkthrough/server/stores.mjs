/*
 * Stores for the review API (SPEC section 9).
 *
 * Every store has the same interface, so server/api-core.mjs never knows
 * which one it is talking to:
 *
 *   kind                  'memory' | 'file' | 'blobs'
 *   get(key)            → object | null
 *   set(key, obj)       → void
 *   delete(key)         → void
 *   list(prefix)        → [key] (sorted)
 *   update(key, fn)     → the value written (or the current value when fn
 *                         returns undefined). fn(current | null) must be pure:
 *                         the Blobs store may call it again after a conflict.
 *
 * memoryStore()       – tests and `node server/dev.mjs --store memory`
 * fileStore(dir)      – local development that survives restarts
 * blobsStore(store)   – wraps a Netlify Blobs store from getStore(); used by
 *                       netlify/functions/api.mjs. Takes the store object, so
 *                       this file does not import @netlify/blobs itself.
 */
import { promises as fsp } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

const clone = (v) => (v === undefined || v === null ? null : JSON.parse(JSON.stringify(v)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Serialises async work per key inside one process. */
function keyedLock() {
  const tails = new Map();
  return function withLock(key, fn) {
    const prev = tails.get(key) || Promise.resolve();
    const run = prev.then(fn, fn);
    const tail = run.then(
      () => {},
      () => {}
    );
    tails.set(key, tail);
    tail.then(() => {
      if (tails.get(key) === tail) tails.delete(key);
    });
    return run;
  };
}

/** Adds a lock-based update() to a store whose get/set are atomic per call. */
function withLockedUpdate(store) {
  const lock = keyedLock();
  store.update = (key, fn) =>
    lock(key, async () => {
      const current = await store.get(key);
      const next = await fn(current);
      if (next === undefined) return current;
      await store.set(key, next);
      return clone(next);
    });
  return store;
}

/** In-memory store. Values are deep-copied in and out, like a real database. */
export function memoryStore() {
  const map = new Map();
  return withLockedUpdate({
    kind: 'memory',
    async get(key) {
      return map.has(key) ? clone(map.get(key)) : null;
    },
    async set(key, obj) {
      map.set(key, clone(obj));
    },
    async delete(key) {
      map.delete(key);
    },
    async list(prefix = '') {
      return [...map.keys()].filter((k) => k.startsWith(prefix)).sort();
    }
  });
}

/**
 * One JSON file per key in `dir` (created on first write). Keys are
 * URI-encoded into file names; writes go to a temp file and are renamed into
 * place, so a crash never leaves half a record.
 */
export function fileStore(dir) {
  const root = resolve(dir);
  const fileFor = (key) => join(root, encodeURIComponent(key) + '.json');
  let ready = null;
  const ensureDir = () => (ready = ready || fsp.mkdir(root, { recursive: true }));
  return withLockedUpdate({
    kind: 'file',
    dir: root,
    async get(key) {
      try {
        return JSON.parse(await fsp.readFile(fileFor(key), 'utf8'));
      } catch (e) {
        if (e.code === 'ENOENT') return null;
        throw e;
      }
    },
    async set(key, obj) {
      await ensureDir();
      const tmp = join(root, '.tmp-' + randomBytes(6).toString('hex'));
      await fsp.writeFile(tmp, JSON.stringify(obj));
      await fsp.rename(tmp, fileFor(key));
    },
    async delete(key) {
      try {
        await fsp.unlink(fileFor(key));
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
      }
    },
    async list(prefix = '') {
      let names;
      try {
        names = await fsp.readdir(root);
      } catch (e) {
        if (e.code === 'ENOENT') return [];
        throw e;
      }
      return names
        .filter((n) => n.endsWith('.json') && !n.startsWith('.tmp-'))
        .map((n) => {
          try {
            return decodeURIComponent(n.slice(0, -5));
          } catch {
            return null;
          }
        })
        .filter((k) => k !== null && k.startsWith(prefix))
        .sort();
    }
  });
}

/**
 * Netlify Blobs adapter. `blob` is the object returned by
 * getStore({ name: 'reviews', consistency: 'strong' }).
 *
 * update() uses the Blobs conditional writes (onlyIfMatch / onlyIfNew), so two
 * function instances saving the same reviewer at once never lose an answer:
 * the loser re-reads and re-applies its change.
 */
export function blobsStore(blob, { attempts = 6 } = {}) {
  return {
    kind: 'blobs',
    async get(key) {
      const v = await blob.get(key, { type: 'json' });
      return v === undefined ? null : v;
    },
    async set(key, obj) {
      await blob.setJSON(key, obj);
    },
    async delete(key) {
      await blob.delete(key);
    },
    async list(prefix = '') {
      const keys = [];
      for await (const page of blob.list({ prefix, paginate: true })) {
        for (const b of page.blobs || []) keys.push(b.key);
      }
      return keys.sort();
    },
    async update(key, fn) {
      for (let attempt = 0; attempt < attempts; attempt++) {
        const entry = await blob.getWithMetadata(key, { type: 'json' });
        const current = entry ? entry.data : null;
        const next = await fn(clone(current));
        if (next === undefined) return current;
        // A backend that returns no ETag (e.g. the local BlobsServer) cannot do
        // a conditional update of an existing entry: write it unconditionally.
        const conditions = entry ? (entry.etag ? { onlyIfMatch: entry.etag } : null) : { onlyIfNew: true };
        const res = conditions ? await blob.setJSON(key, next, conditions) : await blob.setJSON(key, next);
        if (!res || res.modified !== false) return clone(next);
        // Someone else wrote first: back off a little and try again.
        await sleep(15 * 2 ** attempt + Math.floor(Math.random() * 15));
      }
      const err = new Error('The record kept changing while we saved it.');
      err.status = 409;
      err.code = 'conflict';
      throw err;
    }
  };
}
