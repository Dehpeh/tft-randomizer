/* Identity for a session: a League name plus a 6-digit passcode.

   Be clear-eyed about what that is. Six digits is a million combinations, which
   is fine for keeping a friend from opening your restrictions and useless
   against anyone determined. So it is treated as what it is — a party lock, not
   a password — and propped up accordingly:

     - passcodes are scrypt-hashed with a per-player salt, never stored raw
     - failed attempts are counted per session+name and lock out for 15 minutes
     - the session code itself is unguessable, so you need it before you can
       even start guessing a passcode
     - nothing here is worth stealing: a restriction list and a rank

   Do not reuse this pattern for anything that matters. */

const crypto = require('crypto');
const store = require('./_store.js');

const COOKIE_PREFIX = 'tft_';
const MAX_AGE = 60 * 60 * 24 * 30; // a month, so nobody re-logs in mid-tournament
const MAX_ATTEMPTS = 8;
const LOCKOUT_SECONDS = 15 * 60;

/* ---------- names ---------- */

// League names are case-insensitive for identity but keep their typed form for
// display. Riot IDs (Name#TAG) are allowed through as-is.
function normalizeName(name) {
  return String(name || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function validName(name) {
  const n = String(name || '').trim();
  return n.length >= 2 && n.length <= 32 && !/[<>"'\\/]/.test(n);
}

const validPasscode = (code) => /^\d{6}$/.test(String(code || ''));

/* ---------- passcodes ---------- */

function hashPasscode(passcode, salt) {
  const s = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(passcode), s, 32).toString('hex');
  return { salt: s, hash };
}

function checkPasscode(passcode, salt, hash) {
  const got = Buffer.from(crypto.scryptSync(String(passcode), salt, 32).toString('hex'));
  const want = Buffer.from(String(hash));
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

/* ---------- throttling ---------- */

const attemptKey = (code, playerId) => `tft:fail:${code}:${playerId}`;

async function tooManyAttempts(code, playerId) {
  const row = await store.get(attemptKey(code, playerId));
  if (!row) return false;
  const n = typeof row === 'number' ? row : row.n;
  return n >= MAX_ATTEMPTS;
}

async function noteFailure(code, playerId) {
  return store.bump(attemptKey(code, playerId), LOCKOUT_SECONDS);
}

async function clearFailures(code, playerId) {
  return store.bumpReset(attemptKey(code, playerId));
}

/* ---------- signed cookie ----------
   Same shape as the one on dehpeh.dev: a value the server can verify but a
   browser cannot forge. One cookie per session code, so a gamemaster can hold
   a tab open on two lobbies without knocking themselves out of either. */

function secret() {
  const s = process.env.SESSION_SECRET;
  if (s && s.length >= 24) return s;
  if (process.env.VERCEL) {
    throw new Error('SESSION_SECRET is missing or too short (needs 24+ characters)');
  }
  // Local development: a stable per-machine secret so restarts do not log you
  // out. Never reached on a deployment, where the check above throws instead.
  if (!global.__tftDevSecret) global.__tftDevSecret = crypto.randomBytes(32).toString('hex');
  return global.__tftDevSecret;
}

const sign = (value) => crypto.createHmac('sha256', secret()).update(value).digest('base64url');

function makeToken(code, playerId) {
  const body = `${code}.${playerId}.${Math.floor(Date.now() / 1000) + MAX_AGE}`;
  return `${body}.${sign(body)}`;
}

function readToken(token) {
  if (!token) return null;
  const parts = String(token).split('.');
  if (parts.length !== 4) return null;
  const body = parts.slice(0, 3).join('.');
  const expected = sign(body);
  const a = Buffer.from(parts[3]);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  if (Number(parts[2]) < Math.floor(Date.now() / 1000)) return null;
  return { code: parts[0], playerId: parts[1] };
}

function cookieName(code) { return COOKIE_PREFIX + code; }

function readCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

function isSecure(req) {
  return (req.headers['x-forwarded-proto'] || '').split(',')[0] === 'https';
}

function setSessionCookie(req, res, code, playerId) {
  const bits = [
    `${cookieName(code)}=${makeToken(code, playerId)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${MAX_AGE}`,
  ];
  if (isSecure(req)) bits.push('Secure');
  appendCookie(res, bits.join('; '));
}

function clearSessionCookie(req, res, code) {
  const bits = [`${cookieName(code)}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (isSecure(req)) bits.push('Secure');
  appendCookie(res, bits.join('; '));
}

function appendCookie(res, value) {
  const prev = res.getHeader('Set-Cookie');
  if (!prev) res.setHeader('Set-Cookie', value);
  else res.setHeader('Set-Cookie', Array.isArray(prev) ? prev.concat(value) : [prev, value]);
}

/** Who is calling, for this session code? Null if not signed in. */
function whoami(req, code) {
  const parsed = readToken(readCookie(req, cookieName(code)));
  if (!parsed || parsed.code !== code) return null;
  return parsed.playerId;
}

module.exports = {
  normalizeName, validName, validPasscode,
  hashPasscode, checkPasscode,
  tooManyAttempts, noteFailure, clearFailures,
  setSessionCookie, clearSessionCookie, whoami,
  MAX_ATTEMPTS, LOCKOUT_SECONDS,
};
