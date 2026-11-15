#!/usr/bin/env node
/**
 * Local dev server for the DrumDash website, on ONE origin.
 *
 * Why this exists
 * ---------------
 * The convert form needs two things running: the Jekyll site and the API. The
 * obvious arrangement — Jekyll on :4000 and the Worker on :8787 — cannot work
 * from a browser, for two independent reasons:
 *
 *   1. The Worker's session cookie is `SameSite=Strict`. A request from
 *      http://<lan-ip>:4000 to http://<lan-ip>:8787 is a cross-ORIGIN request
 *      (different port), so the browser will not attach the cookie. Every
 *      authenticated call then fails with `no_valid_session`, no matter how the
 *      CORS headers are set.
 *   2. Cross-origin also means CORS and preflight, and the failure mode is
 *      opaque: the page reports "Failed to fetch" rather than anything useful.
 *
 * Serving the site and the API from the SAME origin removes both problems
 * entirely. Nothing needs `?api=...` any more, and what you test locally is
 * what production does (drumdash.com serves both from one origin).
 *
 *   browser -> :4000  /            -> static file from _site
 *                     /api/*       -> reverse-proxied to the Worker on :8787
 *
 * The Worker still runs separately (it holds UPSTREAM_API_KEY); this process
 * never touches the key.
 *
 * Usage
 * -----
 *   # 1. build the site (Jekyll, in Docker — there is no local jekyll binary)
 *   docker run --rm -v "$PWD":/srv/jekyll -w /srv/jekyll \
 *     jekyll/jekyll:4 jekyll build --destination /srv/jekyll/_site
 *
 *   # 2. the Worker (holds the upstream key, loopback is enough now)
 *   cd ../northshorepress-server/northshorepress-server/cf-worker
 *   UPSTREAM_API_KEY=... SESSION_SECRET=... node local-dev.mjs
 *
 *   # 3. this server
 *   node dev-site.mjs
 *
 * Then open http://<lan-ip>:4000/transcription.html from any device.
 */

import { createServer, request as httpRequest } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '_site');
const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 4000);
const API_HOST = process.env.API_HOST || '127.0.0.1';
const API_PORT = Number(process.env.API_PORT || 8787);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.unityweb': 'application/octet-stream',
  '.data': 'application/octet-stream',
};

/** Reverse-proxy /api/* to the Worker, preserving method, headers and body. */
function proxyApi(req, res) {
  const headers = { ...req.headers, host: `${API_HOST}:${API_PORT}` };

  const upstream = httpRequest(
    { host: API_HOST, port: API_PORT, path: req.url, method: req.method, headers },
    (up) => {
      // Pass through as-is. Because this is a same-origin setup, the browser
      // cares about Set-Cookie (same host) and ignores CORS entirely.
      res.writeHead(up.statusCode || 502, up.headers);
      up.pipe(res);
    }
  );

  upstream.on('error', (err) => {
    res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        error: 'api_unreachable',
        detail: `Could not reach the Worker on ${API_HOST}:${API_PORT}: ${err.message}`,
      })
    );
  });

  req.pipe(upstream);
}

async function serveStatic(req, res) {
  // Strip the query, decode, and block traversal outside ROOT.
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch {
    res.writeHead(400).end('bad request');
    return;
  }

  let filePath = normalize(join(ROOT, pathname));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403).end('forbidden');
    return;
  }

  try {
    let info = await stat(filePath);
    if (info.isDirectory()) {
      filePath = join(filePath, 'index.html');
      info = await stat(filePath);
    }

    const body = await readFile(filePath);
    res.writeHead(200, {
      'content-type': MIME[extname(filePath).toLowerCase()] || 'application/octet-stream',
      'content-length': body.length,
      // Never cache during development: a stale page is the classic
      // "I changed it and nothing happened" dead end.
      'cache-control': 'no-store',
    });
    res.end(body);
  } catch {
    // Jekyll's 404 is a real page; fall back to a plain one if it is missing.
    try {
      const body = await readFile(join(ROOT, '404.html'));
      res.writeHead(404, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      });
      res.end(body);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
    }
  }
}

const server = createServer((req, res) => {
  if (req.url.startsWith('/api/')) return proxyApi(req, res);
  return serveStatic(req, res);
});

server.listen(PORT, HOST, async () => {
  console.log(`\nDrumDash dev site listening on http://${HOST}:${PORT}`);
  console.log(`  static : ${ROOT}`);
  console.log(`  api    : /api/*  ->  http://${API_HOST}:${API_PORT}/api/*`);
  console.log(`  open   : http://<lan-ip>:${PORT}/transcription.html\n`);

  try {
    await stat(ROOT);
  } catch {
    console.warn(
      `⚠️  ${ROOT} does not exist — build the site first:\n` +
        '    docker run --rm -v "$PWD":/srv/jekyll -w /srv/jekyll \\\n' +
        '      jekyll/jekyll:4 jekyll build --destination /srv/jekyll/_site\n'
    );
  }
});
