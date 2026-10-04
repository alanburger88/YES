/*
 * Netlify Functions v2 entry for the review API (SPEC section 9).
 *
 * Wraps server/api-core.mjs with the Netlify Blobs store
 * getStore({ name: 'reviews', consistency: 'strong' }). The store is opened per
 * request, inside the invocation, where the Blobs context is available.
 * ADMIN_CODE is read from the function environment (Netlify.env or process.env);
 * it must be at least 16 characters, or admin answers 503.
 *
 * `state` lives at module level, so it is shared by every request this
 * function instance serves: the ~3 s memo of the public results and exports
 * (cleared by any write in this instance) and the wrong-admin-code throttle.
 * Other instances keep their own; both are best-effort by design.
 */
import { getStore } from '@netlify/blobs';
import { createApi, createApiState } from '../../server/api-core.mjs';
import { blobsStore } from '../../server/stores.mjs';
import features from '../../shared/features.json' with { type: 'json' };

function readEnv(name) {
  try {
    const v = globalThis.Netlify && globalThis.Netlify.env && globalThis.Netlify.env.get(name);
    if (typeof v === 'string' && v) return v;
  } catch {
    /* fall through to process.env */
  }
  return (typeof process !== 'undefined' && process.env && process.env[name]) || '';
}

const state = createApiState();

export default async function handler(request, context) {
  const store = blobsStore(getStore({ name: 'reviews', consistency: 'strong' }));
  const api = createApi({
    store,
    env: (name) => readEnv(name),
    features,
    state,
    // Netlify gives the client address on the context; the headers are the fallback.
    clientIp: () => (context && typeof context.ip === 'string' ? context.ip : '')
  });
  return api(request);
}

export const config = {
  path: '/api/*'
};
