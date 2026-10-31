import { createServer } from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { matchUpstream } from './allowlist.js';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ROOT = normalize(join(HERE, '..'));
const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '127.0.0.1';
const UPSTREAM_TIMEOUT_MS = 12_000;
const UPSTREAM_MAX_BYTES = 3 * 1024 * 1024;
const MAX_REDIRECTS = 3;

const STATIC_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.ico', 'image/x-icon'],
  ['.webmanifest', 'application/manifest+json'],
  ['.txt', 'text/plain; charset=utf-8'],
]);

const ALLOWED_UPSTREAM_TYPE =
  /^(application\/(rss\+xml|atom\+xml|xml|json|geo\+json|xhtml\+xml)|text\/(xml|plain|html))\b/i;

function securityHeaders(extra = {}) {
  return {
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'x-frame-options': 'DENY',
    ...extra,
  };
}

/**
 * Fetch an allowlisted HTTPS upstream. Uses IPv4 preference so a broken IPv6
 * path on the host cannot take the earthquake feed down, follows only
 * allowlisted redirects, enforces one overall deadline and a byte ceiling.
 */
function fetchUpstream(candidate, { timeoutMs, maxBytes }) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      fn(value);
    };

    const deadline = setTimeout(() => {
      finish(reject, new Error('Upstream timed out.'));
    }, timeoutMs);

    const visit = (target, redirectsLeft) => {
      const match = matchUpstream(target.href);
      if (!match.allowed) {
        finish(reject, new Error(match.reason));
        return;
      }

      const request = https.request(
        {
          protocol: 'https:',
          hostname: target.hostname,
          port: 443,
          path: `${target.pathname}${target.search}`,
          method: 'GET',
          headers: {
            accept:
              'application/rss+xml, application/atom+xml, application/xml, text/xml, application/json, application/geo+json;q=0.9, */*;q=0.1',
            'accept-encoding': 'identity',
            'user-agent': 'Murmur/1.0 (local, non-commercial demo)',
          },
          servername: target.hostname,
          lookup(hostname, options, callback) {
            dns.lookup(hostname, { ...options, family: 4 }, callback);
          },
        },
        (response) => {
          const status = response.statusCode || 0;

          if (status >= 300 && status < 400 && response.headers.location) {
            response.resume();
            if (redirectsLeft <= 0) {
              finish(reject, new Error('Too many upstream redirects.'));
              return;
            }
            let next;
            try {
              next = new URL(response.headers.location, target);
            } catch {
              finish(reject, new Error('Upstream sent an invalid redirect.'));
              return;
            }
            if (!matchUpstream(next.href).allowed) {
              finish(reject, new Error('Upstream redirected off the allowlist.'));
              return;
            }
            visit(next, redirectsLeft - 1);
            return;
          }

          if (status !== 200) {
            response.resume();
            finish(reject, new Error(`Upstream returned HTTP ${status}.`));
            return;
          }

          const contentType = String(response.headers['content-type'] || '');
          if (contentType && !ALLOWED_UPSTREAM_TYPE.test(contentType)) {
            response.resume();
            finish(reject, new Error(`Upstream content type is not allowed (${contentType}).`));
            return;
          }

          const chunks = [];
          let total = 0;
          response.on('data', (chunk) => {
            total += chunk.length;
            if (total > maxBytes) {
              response.destroy(new Error('Upstream response was too large.'));
              return;
            }
            chunks.push(chunk);
          });
          response.on('error', (error) => finish(reject, error));
          response.on('end', () => {
            finish(resolve, {
              status,
              contentType: contentType || 'application/octet-stream',
              body: Buffer.concat(chunks),
            });
          });
        },
      );

      request.setTimeout(timeoutMs, () => {
        request.destroy(new Error('Upstream timed out.'));
      });
      request.on('error', (error) => finish(reject, error));
      request.end();
    };

    visit(new URL(candidate), MAX_REDIRECTS);
  });
}

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(
    status,
    securityHeaders({
      'content-type': 'application/json; charset=utf-8',
      'content-length': Buffer.byteLength(body),
      'cache-control': 'no-store',
    }),
  );
  response.end(body);
}

async function handleProxy(request, response) {
  const requestUrl = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  const target = requestUrl.searchParams.get('url');

  if (!target) {
    sendJson(response, 400, { error: 'Missing ?url= parameter.' });
    return;
  }
  if (target.length > 2048) {
    sendJson(response, 400, { error: 'Upstream URL is too long.' });
    return;
  }

  const match = matchUpstream(target);
  if (!match.allowed) {
    sendJson(response, 403, { error: match.reason });
    return;
  }

  try {
    const upstream = await fetchUpstream(target, {
      timeoutMs: UPSTREAM_TIMEOUT_MS,
      maxBytes: UPSTREAM_MAX_BYTES,
    });
    response.writeHead(
      200,
      securityHeaders({
        'content-type': upstream.contentType,
        'content-length': upstream.body.length,
        'cache-control': 'no-store',
        'x-murmur-upstream': match.rule.label,
      }),
    );
    response.end(upstream.body);
  } catch (error) {
    sendJson(response, 502, {
      error: `Upstream request failed: ${error.message}`,
      upstream: match.rule.label,
    });
  }
}

async function handleStatic(request, response) {
  const requestUrl = new URL(request.url, 'http://localhost');
  let pathname;
  try {
    pathname = decodeURIComponent(requestUrl.pathname);
  } catch {
    response.writeHead(400, securityHeaders({ 'content-type': 'text/plain; charset=utf-8' }));
    response.end('Bad request');
    return;
  }

  if (pathname === '/' || pathname === '') pathname = '/index.html';
  const filePath = normalize(join(ROOT, pathname));

  if (!filePath.startsWith(ROOT + sep)) {
    response.writeHead(403, securityHeaders({ 'content-type': 'text/plain; charset=utf-8' }));
    response.end('Forbidden');
    return;
  }

  try {
    const content = await readFile(filePath);
    const type = STATIC_TYPES.get(extname(filePath).toLowerCase()) || 'application/octet-stream';
    response.writeHead(
      200,
      securityHeaders({
        'content-type': type,
        'content-length': content.length,
        'cache-control': 'no-cache',
      }),
    );
    response.end(content);
  } catch {
    response.writeHead(404, securityHeaders({ 'content-type': 'text/plain; charset=utf-8' }));
    response.end('Not found');
  }
}

const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, securityHeaders({ allow: 'GET, HEAD' }));
    response.end();
    return;
  }

  if (pathname === '/healthz') {
    sendJson(response, 200, { ok: true, service: 'murmur', allowlisted: true });
    return;
  }

  if (pathname === '/api/proxy') {
    await handleProxy(request, response);
    return;
  }

  if (pathname.startsWith('/api/')) {
    sendJson(response, 404, { error: 'Unknown API route.' });
    return;
  }

  await handleStatic(request, response);
});

server.listen(PORT, HOST, async () => {
  const address = server.address();
  const url = `http://${HOST}:${address.port}`;
  console.log(`Murmur is running at ${url}`);
  try {
    await writeFile(join(ROOT, '.murmur-server.pid'), String(process.pid), 'utf8');
  } catch {
    /* pid file is a convenience for local previews */
  }
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    server.close();
    try {
      await unlink(join(ROOT, '.murmur-server.pid'));
    } catch {
      /* ignore */
    }
    process.exit(0);
  });
}
