#!/usr/bin/env node
/*
 * Local server for the walkthrough app: static files from the build output
 * plus /api/* through server/api-core.mjs. It mirrors the production headers
 * in netlify.toml (SPEC section 9).
 *
 *   node server/dev.mjs [--root public] [--port 8888|0] [--host 127.0.0.1]
 *                       [--store memory|file] [--data .data] [--admin-code CODE]
 *
 * --port 0 picks a free port. ADMIN_CODE may also come from the environment.
 * On start it prints one line:  WT_LISTENING http://127.0.0.1:<port>
 *
 * Programmatic use: const { url, close } = await startServer({ root, port: 0 });
 */
import http from 'node:http';
import { promises as fsp, readFileSync } from 'node:fs';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ADMIN_MIN_LENGTH, API_HEADERS, createApi } from './api-core.mjs';
import { fileStore, memoryStore } from './stores.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, '..');

export const CSP =
  "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; font-src 'self'; connect-src 'self'; " +
  "frame-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'";

export const SECURITY_HEADERS = Object.freeze({
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'SAMEORIGIN',
  'X-Robots-Tag': 'noindex, nofollow'
});

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.vtt': 'text/vtt; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.pdf': 'application/pdf'
};

/** Headers for a static path, as netlify.toml sets them in production. */
export function staticHeaders(pathname) {
  const h = { ...SECURITY_HEADERS };
  if (pathname === '/' || pathname === '/index.html') {
    h['Content-Security-Policy'] = CSP;
    h['Cache-Control'] = 'no-cache';
  } else if (/^\/app\.[0-9a-f]{8,}\.(?:js|css)$/.test(pathname) || /^\/assets\/theme-boot\.[0-9a-f]{8,}\.js$/.test(pathname)) {
    h['Cache-Control'] = 'public, max-age=31536000, immutable';
  } else {
    h['Cache-Control'] = 'no-cache';
  }
  return h;
}

function readFeatures() {
  return JSON.parse(readFileSync(join(APP, 'shared/features.json'), 'utf8'));
}

async function sendStatic(root, req, res, pathname) {
  let rel;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    return plain(res, 400, 'Bad request');
  }
  if (rel.includes('\0')) return plain(res, 400, 'Bad request');
  let file = resolve(root, '.' + rel);
  if (file !== root && !file.startsWith(root + sep)) return plain(res, 404, 'Not found', pathname);
  let stat = await fsp.stat(file).catch(() => null);
  if (stat && stat.isDirectory()) {
    if (!pathname.endsWith('/')) {
      res.writeHead(301, { ...SECURITY_HEADERS, Location: pathname + '/' });
      return res.end();
    }
    file = join(file, 'index.html');
    stat = await fsp.stat(file).catch(() => null);
  }
  if (!stat || !stat.isFile()) return plain(res, 404, 'Not found', pathname);
  const headers = {
    ...staticHeaders(pathname),
    'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
    'Content-Length': stat.size
  };
  res.writeHead(200, headers);
  if (req.method === 'HEAD') return res.end();
  const data = await fsp.readFile(file);
  res.end(data);
}

function plain(res, status, text, pathname = '') {
  res.writeHead(status, { ...staticHeaders(pathname), 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}

async function sendApi(api, req, res) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 1024 * 1024) {
      // Answer now and close the connection: the rest of the body is never read.
      res.writeHead(413, { ...API_HEADERS, 'Content-Type': 'application/json; charset=utf-8', Connection: 'close' });
      return res.end(JSON.stringify({ error: { code: 'too_large', message: 'The request is larger than 64 KB.' } }));
    }
    chunks.push(c);
  }
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (Array.isArray(v)) v.forEach((x) => headers.append(k, x));
    else if (v !== undefined) headers.set(k, v);
  }
  // Like Netlify's edge: the client address for the admin-code throttle
  // (a header sent by the client wins here, so tests can act as other addresses).
  if (!headers.has('x-nf-client-connection-ip') && req.socket && req.socket.remoteAddress) {
    headers.set('x-nf-client-connection-ip', req.socket.remoteAddress);
  }
  const hasBody = !['GET', 'HEAD'].includes(req.method) && chunks.length;
  const request = new Request(`http://${req.headers.host || 'localhost'}${req.url}`, {
    method: req.method,
    headers,
    body: hasBody ? Buffer.concat(chunks) : undefined
  });
  const response = await api(request);
  const out = {};
  response.headers.forEach((v, k) => {
    out[k] = v;
  });
  const body = Buffer.from(await response.arrayBuffer());
  res.writeHead(response.status, out);
  res.end(req.method === 'HEAD' ? undefined : body);
}

export async function startServer({
  root = join(APP, 'public'),
  port = 8888,
  host = '127.0.0.1',
  store = 'memory',
  dataDir = join(APP, '.data'),
  adminCode = process.env.ADMIN_CODE || '',
  logger = console
} = {}) {
  const rootDir = resolve(root);
  const st = typeof store === 'object' ? store : store === 'file' ? fileStore(dataDir) : memoryStore();
  const env = { ADMIN_CODE: adminCode };
  const api = createApi({ store: st, env, features: readFeatures(), logger });

  const server = http.createServer(async (req, res) => {
    let isApi = false;
    try {
      const pathname = new URL(req.url, 'http://x').pathname;
      isApi = pathname === '/api' || pathname.startsWith('/api/');
      if (isApi) return await sendApi(api, req, res);
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { ...SECURITY_HEADERS, Allow: 'GET, HEAD' });
        return res.end();
      }
      return await sendStatic(rootDir, req, res, pathname);
    } catch (e) {
      logger.error('[dev] ' + (e && e.stack ? e.stack : e));
      if (isApi) {
        // Like every API response: JSON error with the API headers.
        if (!res.headersSent) res.writeHead(500, { ...SECURITY_HEADERS, ...API_HEADERS, 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ error: { code: 'server_error', message: 'Something went wrong on our side. Please try again.' } }));
      }
      if (!res.headersSent) res.writeHead(500, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Server error');
    }
  });

  await new Promise((ok, fail) => {
    server.once('error', fail);
    server.listen(port, host, ok);
  });
  const addr = server.address();
  const url = `http://${host.includes(':') ? `[${host}]` : host}:${addr.port}`;
  return {
    url,
    port: addr.port,
    store: st,
    env,
    server,
    close: () => new Promise((ok) => server.close(() => ok()))
  };
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const [k, inline] = a.slice(2).split('=');
    out[k] = inline !== undefined ? inline : argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  }
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = parseArgs(process.argv.slice(2));
  const store = args.store === 'file' ? 'file' : 'memory';
  const s = await startServer({
    root: args.root ? resolve(args.root) : join(APP, 'public'),
    port: args.port !== undefined ? Number(args.port) : 8888,
    host: typeof args.host === 'string' ? args.host : '127.0.0.1',
    store,
    dataDir: args.data ? resolve(args.data) : join(APP, '.data'),
    adminCode: typeof args['admin-code'] === 'string' ? args['admin-code'] : process.env.ADMIN_CODE || ''
  });
  console.log(`WT_LISTENING ${s.url}`);
  const code = String(s.env.ADMIN_CODE || '').trim();
  const admin = code.length >= ADMIN_MIN_LENGTH ? 'configured' : code ? `not configured (ADMIN_CODE must be at least ${ADMIN_MIN_LENGTH} characters)` : 'not configured';
  console.error(`[dev] serving ${args.root || 'public'} · store: ${store} · admin: ${admin}`);
  const stop = () => s.close().then(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
