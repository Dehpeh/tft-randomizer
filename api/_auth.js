/* Accounts: a name plus a 6-digit passcode.

   Be clear-eyed about what that is. Six digits is a million combinations, which
   is fine for keeping a friend out of your match history and useless against
   anyone determined. So it is treated as what it is — a party lock, not a
   password — and propped up accordingly:

     - passcodes are scrypt-hashed with a per-account salt, never stored raw
     - failed attempts are counted per name and lock out for 15 minutes
     - the login cookie is HMAC-signed, HttpOnly and SameSite=Lax
     - nothing here is worth stealing: restriction lists, ranks and placements

   Do not reuse this pattern for anything that matters. */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const store = require('./_store.js');

const COOKIE = 'tft_id';
const MAX_AGE = 60 * 60 * 24 * 60; // two months, so nobody re-logs in mid-tournament
const MAX_ATTEMPTS = 8;
const LOCKOUT_SECONDS = 15 * 60;

/* ---------- names ---------- */

// Names are case-insensitive for identity but keep their typed form for
// display. Whatever someone types is what they are: a Riot ID with a #TAG, a
// Discord handle, or just a first name.
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
  if (!salt || !hash) return false;
  const got = Buffer.from(crypto.scryptSync(String(passcode), salt, 32).toString('hex'));
  const want = Buffer.from(String(hash));
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

/* ---------- throttling ---------- */

const attemptKey = (id) => 'tft:fail:' + id;

async function tooManyAttempts(id) {
  const row = await store.get(attemptKey(id));
  if (!row) return false;
  const n = typeof row === 'number' ? row : row.n;
  return n >= MAX_ATTEMPTS;
}

const noteFailure = (id) => store.bump(attemptKey(id), LOCKOUT_SECONDS);
const clearFailures = (id) => store.bumpReset(attemptKey(id));

/* ---------- signed cookie ----------
   Same shape as the one on dehpeh.dev: a value the server can verify but a
   browser cannot forge. Login + expiry + an HMAC over both. */

function secret() {
  const s = process.env.SESSION_SECRET;
  if (s && s.length >= 24) return s;
  if (process.env.VERCEL) {
    throw new Error('SESSION_SECRET is missing or too short (needs 24+ characters)');
  }
  /* Local only — never reached on a deployment, where the check above throws.
     Kept in a file next to the store rather than in memory: restarting the dev
     server should not sign out a lobby mid-tournament. */
  if (!global.__tftDevSecret) {
    const file = path.join(os.homedir(), '.tft-randomizer-devsecret');
    try {
      global.__tftDevSecret = fs.readFileSync(file, 'utf8').trim();
    } catch (e) { /* first run */ }
    if (!global.__tftDevSecret || global.__tftDevSecret.length < 24) {
      global.__tftDevSecret = crypto.randomBytes(32).toString('hex');
      try { fs.writeFileSync(file, global.__tftDevSecret); } catch (e) { /* read-only home */ }
    }
  }
  return global.__tftDevSecret;
}

const sign = (value) => crypto.createHmac('sha256', secret()).update(value).digest('base64url');

function makeToken(accountId) {
  const body = `${accountId}.${Math.floor(Date.now() / 1000) + MAX_AGE}`;
  return `${body}.${sign(body)}`;
}

function readToken(token) {
  if (!token) return null;
  const parts = String(token).split('.');
  if (parts.length !== 3) return null;
  const body = parts[0] + '.' + parts[1];
  const a = Buffer.from(parts[2]);
  const b = Buffer.from(sign(body));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  if (Number(parts[1]) < Math.floor(Date.now() / 1000)) return null;
  return parts[0];
}

function readCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

const isSecure = (req) => (req.headers['x-forwarded-proto'] || '').split(',')[0] === 'https';

function setLoginCookie(req, res, accountId) {
  const bits = [`${COOKIE}=${makeToken(accountId)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${MAX_AGE}`];
  if (isSecure(req)) bits.push('Secure');
  res.setHeader('Set-Cookie', bits.join('; '));
}

function clearLoginCookie(req, res) {
  const bits = [`${COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (isSecure(req)) bits.push('Secure');
  res.setHeader('Set-Cookie', bits.join('; '));
}

/** Which account is calling? Null if signed out. */
const whoami = (req) => readToken(readCookie(req, COOKIE));

module.exports = {
  normalizeName, validName, validPasscode,
  hashPasscode, checkPasscode,
  tooManyAttempts, noteFailure, clearFailures,
  setLoginCookie, clearLoginCookie, whoami,
  MAX_ATTEMPTS, LOCKOUT_SECONDS,
};
