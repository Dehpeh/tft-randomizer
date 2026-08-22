/* Storage for sessions.

   Production is Upstash Redis over its REST API — no TCP pooling problems in a
   serverless function, and the free tier is orders of magnitude more than a
   tournament needs. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN in
   the Vercel project (the Upstash integration sets both for you).

   With those unset, everything falls back to a JSON file next to the repo, so
   `node server.mjs` runs the whole thing locally with no cloud account at all.
   That fallback is single-process and is for development and for running the
   tournament off one machine — not for a deployed site.

   Writes go through update(): read, mutate, compare-and-set on a version
   counter, retry. A gamemaster rolling for eight players while a ninth is
   joining is exactly the race that would otherwise drop the join. */

const fs = require('fs');
const path = require('path');
const os = require('os');

/* Connecting Upstash through Vercel hands you one of two names for the same
   pair, depending on which button you came in through. Accept both rather than
   making the deployment depend on which screen was used. */
const URL_ = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || process.env.REDIS_REST_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || process.env.REDIS_REST_TOKEN;
const remote = Boolean(URL_ && TOKEN);

const TTL_SECONDS = 60 * 60 * 24 * 45; // sessions expire 45 days after the last write

/* ---------- Upstash REST ---------- */

async function command(args) {
  const res = await fetch(URL_, {
    method: 'POST',
    headers: { authorization: 'Bearer ' + TOKEN, 'content-type': 'application/json' },
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error('store: upstash ' + res.status + ' ' + (await res.text()).slice(0, 200));
  const body = await res.json();
  if (body.error) throw new Error('store: ' + body.error);
  return body.result;
}

/* Compare-and-set in one round trip. Redis is single-threaded, so the read and
   the write inside the script cannot interleave with another writer. The
   comparison is against the exact bytes we read, not a re-serialisation of the
   parsed document, so key ordering can never make a clean write look dirty.
   ARGV: 1 = next value, 2 = the raw value we read ('' for absent), 3 = ttl. */
const CAS = `
local cur = redis.call('GET', KEYS[1])
if cur == false then
  if ARGV[2] ~= '' then return 0 end
elseif cur ~= ARGV[2] then
  return 0
end
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[3])
return 1
`;

/* ---------- local file fallback ---------- */

const FILE = process.env.TFT_STORE_FILE || path.join(os.homedir(), '.tft-randomizer-store.json');
let cache = null;

/* Serverless instances do not share a filesystem, so the fallback on a
   deployment would look like sessions randomly vanishing. Fail loudly instead. */
function assertUsable() {
  if (!remote && process.env.VERCEL) {
    throw new Error('No Redis configured. Connect Upstash for Redis in Vercel → Storage, or set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.');
  }
}

function readFile() {
  assertUsable();
  if (cache) return cache;
  try { cache = JSON.parse(fs.readFileSync(FILE, 'utf8')); }
  catch (e) { cache = {}; }
  return cache;
}

function writeFile(data) {
  cache = data;
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}

/* ---------- public API ---------- */

async function getRaw(key) {
  if (remote) {
    const raw = await command(['GET', key]);
    return raw === null || raw === undefined ? null : String(raw);
  }
  const row = readFile()[key];
  return row === undefined ? null : JSON.stringify(row);
}

async function get(key) {
  const raw = await getRaw(key);
  return raw === null ? null : JSON.parse(raw);
}

async function setIfAbsent(key, value) {
  const body = JSON.stringify(value);
  if (remote) {
    const res = await command(['SET', key, body, 'NX', 'EX', String(TTL_SECONDS)]);
    return res !== null;
  }
  const data = readFile();
  if (data[key] !== undefined) return false;
  data[key] = JSON.parse(body);
  writeFile(data);
  return true;
}

async function del(key) {
  if (remote) { await command(['DEL', key]); return; }
  const data = readFile();
  delete data[key];
  writeFile(data);
}

/**
 * Read, mutate, write, retrying if someone else wrote first.
 * The mutator gets the current value (null if absent) and returns the next one,
 * or null to leave it alone. Throws whatever the mutator throws.
 */
async function update(key, mutator, tries = 6) {
  for (let attempt = 0; attempt < tries; attempt++) {
    const raw = await getRaw(key);
    const current = raw === null ? null : JSON.parse(raw);
    const next = await mutator(current);
    if (next === null || next === undefined) return current;

    next.v = (current && current.v ? current.v : 0) + 1;
    const body = JSON.stringify(next);

    if (remote) {
      const ok = await command(['EVAL', CAS, '1', key, body, raw === null ? '' : raw, String(TTL_SECONDS)]);
      if (ok === 1) return next;
    } else {
      const live = await getRaw(key);
      if (live === raw) {
        const data = readFile();
        data[key] = JSON.parse(body);
        writeFile(data);
        return next;
      }
    }
  }
  throw new Error('store: too many concurrent writes, try again');
}

/* Small counters used for login throttling. TTL keeps them self-cleaning. */
async function bump(key, ttlSeconds) {
  if (remote) {
    const n = await command(['INCR', key]);
    if (n === 1) await command(['EXPIRE', key, String(ttlSeconds)]);
    return n;
  }
  const data = readFile();
  const row = data[key] && data[key].until > Date.now() ? data[key] : { n: 0, until: Date.now() + ttlSeconds * 1000 };
  row.n += 1;
  data[key] = row;
  writeFile(data);
  return row.n;
}

async function bumpReset(key) {
  await del(key);
}

module.exports = { get, setIfAbsent, del, update, bump, bumpReset, isRemote: () => remote };
