/* Shared plumbing for the API: request/response helpers, and the shape of the
   two documents this app stores — an account and a session. */

const rules = require('../lib/restrictions.js');
const auth = require('./_auth.js');
const store = require('./_store.js');

const sKey = (code) => 'tft:s:' + code;   // session (a lobby)
const uKey = (id) => 'tft:u:' + id;       // account (a player)

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

/* A POST from another origin should not be able to drive a lobby with someone's
   login cookie. SameSite=Lax already blocks the common case; this closes the
   rest. */
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

/* ---------- accounts ---------- */

function newAccount(id, display, rankId, passcode) {
  const { salt, hash } = auth.hashPasscode(passcode);
  return { id, display, rank: rankId, salt, hash, sessions: [], createdAt: Date.now(), v: 0 };
}

/* What a browser is allowed to see of an account: never the passcode material. */
const publicAccount = (a) => ({
  id: a.id, display: a.display, rank: a.rank, createdAt: a.createdAt, sessions: a.sessions || [],
});

/** The signed-in account, or null after answering 401. */
async function requireAccount(req, res) {
  const id = auth.whoami(req);
  const account = id ? await store.get(uKey(id)) : null;
  if (!account) { fail(res, 401, 'Sign in first.'); return null; }
  return account;
}

/* ---------- sessions ---------- */

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
    players: {},         // id -> seat
    rolls: {},           // game -> { playerId -> roll }
    results: {},         // game -> { placements: { playerId -> 1..8 }, at, by }
    penalties: [],       // { id, playerId, game, reason, at, by }  — human decisions
    flags: [],           // { playerId, game, kind, note, at }      — machine observations
    summaries: {},       // game -> playerId -> { rows, at }         — counted states, replaced not appended
    v: 0,
  };
}

/* A seat is the account's standing in one lobby. Rank is copied in rather than
   read live, so a gamemaster correcting someone's rank for this tournament does
   not rewrite their account, and a player editing their account later cannot
   change what they were rolled against. */
const newSeat = (account, isGm) => ({
  id: account.id,
  display: account.display,
  rank: account.rank,
  isGm: Boolean(isGm),
  joinedAt: Date.now(),
});

/* Proctor output belongs to the gamemaster. A player gets their own rows back —
   they are the only thing here that is about them — and nobody else's.

   The flag list does not do this yet: it is sent to every client and merely
   hidden in the UI, so a player who opens the network tab can read the whole
   lobby's notes. Worth tightening the same way; not changed here because it
   would be a silent change to something already live. */
function scopedSummaries(session, viewerId) {
  const all = session.summaries || {};
  const isGm = Boolean(viewerId && session.players[viewerId] && session.players[viewerId].isGm);
  if (isGm) return all;
  if (!viewerId) return {};
  const mine = {};
  Object.keys(all).forEach((game) => {
    if (all[game] && all[game][viewerId]) mine[game] = { [viewerId]: all[game][viewerId] };
  });
  return mine;
}

function publicSession(session, viewerId) {
  const players = Object.values(session.players)
    .sort((a, b) => (b.isGm ? 1 : 0) - (a.isGm ? 1 : 0) || a.joinedAt - b.joinedAt)
    .map((p) => ({ id: p.id, display: p.display, rank: p.rank, isGm: p.isGm, joinedAt: p.joinedAt }));

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
    results: session.results || {},
    penalties: session.penalties || [],
    flags: session.flags || [],
    summaries: scopedSummaries(session, viewerId),
    you: viewerId || null,
    isGm: Boolean(viewerId && session.players[viewerId] && session.players[viewerId].isGm),
  };
}

/** Signed in AND holding a seat in this lobby. */
async function requireMember(req, res, code) {
  const account = await requireAccount(req, res);
  if (!account) return null;
  const session = await store.get(sKey(code));
  if (!session) { fail(res, 404, 'No lobby with that code.'); return null; }
  if (!session.players[account.id]) { fail(res, 403, 'You have not joined this lobby.'); return null; }
  return { session, account, playerId: account.id };
}

/** ...and the gamemaster of it. */
async function requireGm(req, res, code) {
  const found = await requireMember(req, res, code);
  if (!found) return null;
  if (!found.session.players[found.playerId].isGm) { fail(res, 403, 'Gamemaster only.'); return null; }
  return found;
}

/* Closing a lobby is not the same as pausing signups: it ends the thing. Rolls,
   placements and penalties are all refused until it is reopened, so a closed
   lobby is a record rather than a live document. The ops that manage the lobby
   itself — reopening it, deleting it, handing it over — stay allowed. */
const ALWAYS_ALLOWED = new Set(['setOpen', 'deleteLobby', 'transferGm']);

function requireLive(res, session, op) {
  if (session.open || ALWAYS_ALLOWED.has(op)) return true;
  fail(res, 409, 'This lobby is closed. Reopen it first if you need to change something.');
  return false;
}

/* Remember which lobbies an account has played, so the profile page can find
   them without scanning every key in the database. */
async function rememberSession(accountId, code) {
  await store.update(uKey(accountId), (a) => {
    if (!a) return null;
    const list = a.sessions || [];
    if (list.includes(code)) return null;
    a.sessions = [code].concat(list).slice(0, 100);
    return a;
  });
}

const validRank = (id) => Boolean(rules.rankById(id));

module.exports = {
  sKey, uKey, send, fail, body, guard, cleanCode,
  newAccount, publicAccount, requireAccount,
  newSession, newSeat, publicSession, requireMember, requireGm, requireLive, rememberSession,
  validRank, rules, store, auth,
};
