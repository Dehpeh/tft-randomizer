// Local stand-in for Vercel: serves the static files and runs the functions in
// api/ on the same origin, so the whole session flow works with `node
// server.mjs` and no cloud account. Handlers are re-required per request, so
// editing one takes effect without a restart.
//
// Without UPSTASH_REDIS_REST_URL / _TOKEN in the environment, api/_store.js
// keeps sessions in a JSON file (see its header). That is fine for development
// and for running a tournament off one machine; a deployment wants Upstash.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.env.PORT) || 4700;
const require = createRequire(import.meta.url);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

// Vercel's Node functions take (req, res) straight off http, so the dev server
// hands them the real objects rather than faking a runtime.
async function runFunction(name, req, res) {
  const file = join(ROOT, 'api', name + '.js');
  if (!existsSync(file) || name.startsWith('_')) {
    res.writeHead(404, { 'content-type': 'application/json' }).end('{"error":"No such endpoint."}');
    return;
  }
  try {
    for (const key of Object.keys(require.cache)) {
      if (key.startsWith(join(ROOT, 'api')) || key === join(ROOT, 'restrictions.js')) delete require.cache[key];
    }
    const handler = require(file);
    await handler(req, res);
  } catch (err) {
    console.error(name, err);
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: err.message || 'Server error' }));
  }
}

function resolveStatic(pathname) {
  if (pathname === '/') return join(ROOT, 'index.html');
  if (/^\/s\/[^/]+$/.test(pathname)) return join(ROOT, 'session.html'); // matches the vercel.json rewrite
  const rel = normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  const direct = join(ROOT, rel);
  if (!extname(direct) && existsSync(direct + '.html')) return direct + '.html'; // cleanUrls
  return direct;
}

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const pathname = decodeURIComponent(url.pathname);

  if (pathname.startsWith('/api/')) {
    await runFunction(pathname.slice(5).replace(/\/+$/, ''), req, res);
    return;
  }

  const file = resolveStatic(pathname);
  if (!file.startsWith(ROOT) || dirname(file).includes(join(ROOT, 'api'))) {
    res.writeHead(403).end('forbidden');
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': TYPES[extname(file)] || 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
  }
}).listen(PORT, () => {
  console.log(`tft-randomizer → http://localhost:${PORT}`);
  console.log(process.env.UPSTASH_REDIS_REST_URL ? 'store: upstash' : 'store: local file (development)');
});
