/* POST /api/admin — the organiser's view and the things nobody else can do.

   Gamemasters run their own lobbies. The organiser runs the tournament: every
   account, every lobby, every penalty, and the power to remove any of it.
   Accounts have no email, so a forgotten passcode also has no self-service path
   and lands here.

   All of it is behind ADMIN_KEY, set in the deployment's environment. Unset, the
   whole endpoint is disabled — a deployment that never sets it has no admin
   surface at all. The key is sent per request rather than exchanged for a
   session, so nothing lingers in a cookie.

     { key, op: "overview" }                       every player and lobby, with stats
     { key, op: "lobby", code }                    one lobby in full
     { key, op: "resetPasscode", name, passcode }  give an account a new passcode
     { key, op: "deleteAccount", name }            remove an account
     { key, op: "deleteLobby", code }              remove a lobby
     { key, op: "wipe", confirm: "WIPE" }          delete everything

   wipe is the pre-tournament reset. It cannot be undone:

     curl -X POST https://your-domain/api/admin \
       -H 'content-type: application/json' \
       -d '{"key":"...","op":"wipe","confirm":"WIPE"}'
*/

const crypto = require('crypto');
const lib = require('./_lib.js');
const { auth, store, rules } = lib;

function keyMatches(given) {
  const want = process.env.ADMIN_KEY || '';
  if (!want) return false;
  const a = Buffer.from(String(given || ''));
  const b = Buffer.from(want);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return lib.fail(res, 405, 'Use POST.');

  const input = await lib.body(req);

  if (!process.env.ADMIN_KEY) {
    const near = Object.keys(process.env).filter((k) => /admin/i.test(k));
    return lib.send(res, 404, {
      error: 'Admin endpoint is disabled: no ADMIN_KEY set.',
      similarNamesInEnvironment: near,
      hint: near.length
        ? 'Those exist but ADMIN_KEY does not. Check the spelling.'
        : 'Add ADMIN_KEY for Production, then redeploy — environment variables only reach builds that start after they are saved.',
    });
  }
  if (!keyMatches(input.key)) return lib.fail(res, 403, 'Bad admin key.');

  const op = String(input.op || '');

  /* ---------- reading ---------- */

  if (op === 'overview') {
    const [accountKeys, lobbyKeys] = await Promise.all([store.keys('tft:u:'), store.keys('tft:s:')]);
    const [accounts, lobbies] = await Promise.all([
      Promise.all(accountKeys.map((k) => store.get(k))),
      Promise.all(lobbyKeys.map((k) => store.get(k))),
    ]);

    const live = lobbies.filter(Boolean);
    const byPlayer = {};

    // Walk every lobby once and hang the results off each player, so the
    // dashboard is one request rather than one per person.
    live.forEach((s) => {
      const penaltiesFor = {};
      (s.penalties || []).forEach((p) => {
        (penaltiesFor[p.playerId] = penaltiesFor[p.playerId] || []).push(p);
      });

      Object.values(s.players || {}).forEach((seat) => {
        const row = byPlayer[seat.id] || (byPlayer[seat.id] = {
          id: seat.id, games: [], penalties: [], lobbies: [],
        });
        row.lobbies.push({ code: s.code, name: s.name, isGm: Boolean(seat.isGm), rank: seat.rank, open: s.open !== false });
        (penaltiesFor[seat.id] || []).forEach((p) => row.penalties.push(Object.assign({ lobby: s.name, code: s.code }, p)));

        Object.keys(s.rolls || {}).forEach((game) => {
          const roll = (s.rolls[game] || {})[seat.id];
          if (!roll) return;
          const placement = (((s.results || {})[game] || {}).placements || {})[seat.id] || null;
          row.games.push({
            code: s.code, lobby: s.name, game: Number(game), rank: roll.rank || seat.rank,
            seed: roll.seed, picks: roll.picks, placement, at: roll.at || s.createdAt,
          });
        });
      });
    });

    const players = accounts.filter(Boolean).map((a) => {
      const row = byPlayer[a.id] || { games: [], penalties: [], lobbies: [] };
      const played = row.games.filter((g) => g.placement);
      return {
        id: a.id,
        display: a.display,
        rank: a.rank,
        createdAt: a.createdAt,
        lobbies: row.lobbies,
        games: row.games.sort((x, y) => y.at - x.at),
        penalties: row.penalties.sort((x, y) => y.at - x.at),
        stats: {
          games: played.length,
          pending: row.games.length - played.length,
          avgPlacement: played.length ? played.reduce((n, g) => n + g.placement, 0) / played.length : null,
          firsts: played.filter((g) => g.placement === 1).length,
          top4: played.filter((g) => g.placement <= 4).length,
        },
      };
    }).sort((a, b) => a.display.localeCompare(b.display));

    // Registered but never seated is worth seeing: those are the signups who
    // have not been put in a group yet.
    return lib.send(res, 200, {
      players,
      lobbies: live.map((s) => ({
        code: s.code,
        name: s.name,
        open: s.open !== false,
        game: s.game,
        createdAt: s.createdAt,
        players: Object.keys(s.players || {}).length,
        gm: (Object.values(s.players || {}).find((p) => p.isGm) || {}).display || null,
        rolled: Object.keys(s.rolls || {}).length,
        results: Object.keys(s.results || {}).length,
        penalties: (s.penalties || []).length,
      })).sort((a, b) => b.createdAt - a.createdAt),
      totals: {
        accounts: players.length,
        lobbies: live.length,
        seated: players.filter((p) => p.lobbies.length).length,
        penalties: live.reduce((n, s) => n + (s.penalties || []).length, 0),
        restrictions: rules.ALL.length,
      },
    });
  }

  if (op === 'lobby') {
    const code = lib.cleanCode(input.code);
    if (!code) return lib.fail(res, 400, 'That lobby code is not valid.');
    const session = await store.get(lib.sKey(code));
    if (!session) return lib.fail(res, 404, 'No lobby with that code.');
    return lib.send(res, 200, { session: lib.publicSession(session, null) });
  }

  /* ---------- writing ---------- */

  if (op === 'resetPasscode') {
    const id = auth.normalizeName(input.name);
    if (!auth.validPasscode(input.passcode)) return lib.fail(res, 400, 'Passcode must be exactly 6 digits.');
    let missing = false;
    await store.update(lib.uKey(id), (a) => {
      if (!a) { missing = true; return null; }
      const { salt, hash } = auth.hashPasscode(String(input.passcode));
      a.salt = salt;
      a.hash = hash;
      return a;
    });
    if (missing) return lib.fail(res, 404, 'No account with that name.');
    await auth.clearFailures(id);
    return lib.send(res, 200, { ok: true, account: id });
  }

  if (op === 'deleteAccount') {
    const id = auth.normalizeName(input.name);
    const account = await store.get(lib.uKey(id));
    if (!account) return lib.fail(res, 404, 'No account with that name.');

    // Take their seats with them, so a deleted player does not linger in a
    // roster that can no longer be signed into.
    const codes = account.sessions || [];
    for (const code of codes) {
      await store.update(lib.sKey(code), (s) => {
        if (!s || !s.players[id]) return null;
        delete s.players[id];
        Object.values(s.rolls || {}).forEach((game) => { delete game[id]; });
        Object.values(s.results || {}).forEach((r) => { if (r && r.placements) delete r.placements[id]; });
        s.penalties = (s.penalties || []).filter((p) => p.playerId !== id);
        return s;
      });
    }

    await store.del(lib.uKey(id));
    await auth.clearFailures(id);
    return lib.send(res, 200, { ok: true, deleted: id, lobbiesTouched: codes.length });
  }

  if (op === 'deleteLobby') {
    const code = lib.cleanCode(input.code);
    if (!code) return lib.fail(res, 400, 'That lobby code is not valid.');
    const session = await store.get(lib.sKey(code));
    if (!session) return lib.fail(res, 404, 'No lobby with that code.');
    await store.del(lib.sKey(code));
    return lib.send(res, 200, { ok: true, deleted: code });
  }

  if (op === 'wipe') {
    if (input.confirm !== 'WIPE') return lib.fail(res, 400, 'Send {"confirm":"WIPE"} to confirm. This deletes every account and lobby.');
    const deleted = await store.wipe('tft:');
    return lib.send(res, 200, { ok: true, deleted });
  }

  return lib.fail(res, 400, 'Unknown operation.');
};
