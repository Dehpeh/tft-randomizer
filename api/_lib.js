/* Shared plumbing for the session routes: request/response helpers and the
   shape of a session document. */

const rules = require('../restrictions.js');
const auth = require('./_auth.js');
const store = require('./_store.js');

const key = (code) => 'tft:s:' + code;

/* ---------- http ---------- */

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}

const fail = (res, status, error) => send(res, status, { error });

/* Vercel parses JSON bodies for us; the local dev server does too. This is the
   belt-and-braces version for anything that arrives as a raw stream. */
async function body(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string' && req.body) {
    try { return JSON.parse(req.body); } catch (e) { return {}; }
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (e) { return {}; }
}

/* A POST from another origin should not be able to drive a session with a
   logged-in player's cookie. SameSite=Lax already blocks the common case; this
   closes the rest. */
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // curl, server-to-server, same-origin form posts
  try {
    return new URL(origin).host === (req.headers['x-forwarded-host'] || req.headers.host);
  } catch (e) { return false; }
}

function guard(req, res, method) {
  if (req.method !== method) { fail(res, 405, 'Use ' + method + '.'); return false; }
  if (method === 'POST' && !sameOrigin(req)) { fail(res, 403, 'Bad origin.'); return false; }
  return true;
}

/* ---------- session documents ---------- */

const CODE_RE = /^[23456789CDFGHJKLMNPQRSTVWXZ]{6}$/;

function cleanCode(raw) {
  const code = String(raw || '').trim().toUpperCase();
  return CODE_RE.test(code) ? code : null;
}

function newSession(code, name) {
  return {
    code,
    name: String(name || 'TFT lobby').slice(0, 60),
    createdAt: Date.now(),
    game: 1,
    open: true,          // accepting new players
    pool: { off: [] },   // restriction ids the gamemaster switched off
    players: {},         // id -> player
    rolls: {},           // game number -> { playerId -> roll }
    v: 0,
  };
}

function newPlayer(id, display, rankId, passcode, isGm) {
  const { salt, hash } = auth.hashPasscode(passcode);
  return { id, display, rank: rankId, salt, hash, isGm: Boolean(isGm), joinedAt: Date.now() };
}

/* What a browser is allowed to see: everything except the passcode material. */
function publicSession(session, viewerId) {
  const players = Object.values(session.players)
    .sort((a, b) => (b.isGm ? 1 : 0) - (a.isGm ? 1 : 0) || a.joinedAt - b.joinedAt)
    .map((p) => ({
      id: p.id,
      display: p.display,
      rank: p.rank,
      isGm: p.isGm,
      joinedAt: p.joinedAt,
      hasPasscode: Boolean(p.hash),
    }));

  return {
    code: session.code,
    name: session.name,
    game: session.game,
    open: session.open,
    pool: session.pool,
    createdAt: session.createdAt,
    v: session.v,
    players,
    rolls: session.rolls,
    you: viewerId || null,
    isGm: Boolean(viewerId && session.players[viewerId] && session.players[viewerId].isGm),
  };
}

/** Load a session and confirm the caller is a member of it. */
async function requireMember(req, res, code) {
  const session = await store.get(key(code));
  if (!session) { fail(res, 404, 'No session with that code.'); return null; }
  const playerId = auth.whoami(req, code);
  if (!playerId || !session.players[playerId]) { fail(res, 401, 'Sign in to this session first.'); return null; }
  return { session, playerId };
}

/** ...and that they are the gamemaster. */
async function requireGm(req, res, code) {
  const found = await requireMember(req, res, code);
  if (!found) return null;
  if (!found.session.players[found.playerId].isGm) { fail(res, 403, 'Gamemaster only.'); return null; }
  return found;
}

const validRank = (id) => Boolean(rules.rankById(id));

module.exports = {
  key, send, fail, body, guard, cleanCode,
  newSession, newPlayer, publicSession,
  requireMember, requireGm, validRank, rules, store, auth,
};
