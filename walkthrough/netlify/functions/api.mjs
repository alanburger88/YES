/*
 * Netlify Functions v2 entry for the review API (SPEC section 9).
 *
 * Wraps server/api-core.mjs with the Netlify Blobs store
 * getStore({ name: 'reviews', consistency: 'strong' }). The store is opened per
 * request, inside the invocation, where the Blobs context is available.
 * ADMIN_CODE is read from the function environment (Netlify.env or process.env).
 */
import { getStore } from '@netlify/blobs';
import { createApi } from '../../server/api-core.mjs';
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

export default async function handler(request) {
  const store = blobsStore(getStore({ name: 'reviews', consistency: 'strong' }));
  const api = createApi({ store, env: (name) => readEnv(name), features });
  return api(request);
}

export const config = {
  path: '/api/*'
};
