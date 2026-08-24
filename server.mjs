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
    // Anything the functions require, so editing a rule or a route takes effect
    // on the next request instead of needing a restart.
    for (const key of Object.keys(require.cache)) {
      if (key.startsWith(join(ROOT, 'api')) || key.startsWith(join(ROOT, 'lib'))) delete require.cache[key];
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

/* ---------- development-only helpers ----------
   Both are gated on environment variables that are unset by default, and this
   whole file is in .vercelignore, so none of it can reach a deployment. They
   exist so the proctor lab can be pointed at a real recording that lives
   outside the repo, and so frames it flags can be written out and looked at.

   TFT_VIDEO   absolute path of one video file to serve at /dev-video
   TFT_DEV_OUT directory that POST /dev-save may write PNGs into */
const DEV_VIDEO = process.env.TFT_VIDEO || '';
const DEV_OUT = process.env.TFT_DEV_OUT || '';

async function serveVideo(req, res) {
  const { statSync, createReadStream } = await import('node:fs');
  let size;
  try { size = statSync(DEV_VIDEO).size; } catch { res.writeHead(404).end('no video'); return; }

  // Seeking needs range support, and the lab seeks constantly.
  /* Every stream has to be torn down with the response it was serving.

     A browser seeking through a long video abandons requests constantly — it
     asks for a range, changes its mind, and moves on — and a piped ReadStream
     whose response died keeps its file handle. Scanning a 36-minute recording
     is a couple of thousand seeks, which is a couple of thousand handles, and
     the server falls over with EMFILE partway through the run it was serving.
     Which it did, taking a ten-minute measurement with it. */
  const pipe = (stream) => {
    const kill = () => stream.destroy();
    res.on('close', kill);
    res.on('finish', kill);
    stream.on('error', kill);
    stream.pipe(res);
  };

  const range = req.headers.range;
  if (!range) {
    res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': size, 'accept-ranges': 'bytes' });
    pipe(createReadStream(DEV_VIDEO));
    return;
  }
  const m = /bytes=(\d*)-(\d*)/.exec(range) || [];
  const start = m[1] ? Number(m[1]) : 0;
  const end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  res.writeHead(206, {
    'content-type': 'video/mp4',
    'content-range': `bytes ${start}-${end}/${size}`,
    'accept-ranges': 'bytes',
    'content-length': end - start + 1,
  });
  pipe(createReadStream(DEV_VIDEO, { start, end }));
}

async function saveFrame(req, res) {
  const { writeFileSync } = await import('node:fs');
  const chunks = [];
  for await (const c of req) chunks.push(c);
  let body = {};
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { /* bad json */ }
  const name = String(body.name || 'frame').replace(/[^a-z0-9._-]/gi, '');
  const data = String(body.dataUrl || '').split(',')[1] || '';
  if (!name || !data) { res.writeHead(400).end('{"error":"name and dataUrl required"}'); return; }
  writeFileSync(join(DEV_OUT, name), Buffer.from(data, 'base64'));
  res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ saved: name }));
}

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const pathname = decodeURIComponent(url.pathname);

  if (pathname === '/dev-video' && DEV_VIDEO) { await serveVideo(req, res); return; }
  if (pathname === '/dev-save' && DEV_OUT && req.method === 'POST') { await saveFrame(req, res); return; }

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
