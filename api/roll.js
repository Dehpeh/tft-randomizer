/* POST /api/roll — the gamemaster rolls restrictions for the lobby.

   The roll happens here, on the server, from the rank stored in the session and
   the pool the gamemaster set. A player's browser never decides its own
   restrictions and cannot ask for a different rank than the one on record.

   target: "missing" rolls only players who have nothing yet for this game (the
   safe default, so a late joiner can be caught up without disturbing anyone),
   "all" re-rolls the whole lobby, or a player id rolls that one player. */

const lib = require('./_lib.js');
const { rules, store } = lib;

module.exports = async function handler(req, res) {
  if (!lib.guard(req, res, 'POST')) return;

  const input = await lib.body(req);
  const code = lib.cleanCode(input.code);
  if (!code) return lib.fail(res, 400, 'That session code is not valid.');

  const found = await lib.requireGm(req, res, code);
  if (!found) return;

  const game = Number(input.game || found.session.game || 1);
  if (!Number.isInteger(game) || game < 1 || game > 9) return lib.fail(res, 400, 'Game must be 1-9.');

  const target = String(input.target || 'missing');
  let error = null;

  const session = await store.update(lib.sKey(code), (s) => {
    if (!s) { error = 'No session with that code.'; return null; }

    const enabled = rules.enabledSet(s.pool.off);
    const rolls = s.rolls[game] || (s.rolls[game] = {});

    let ids = Object.keys(s.players);
    if (target === 'missing') ids = ids.filter((id) => !rolls[id]);
    else if (target !== 'all') {
      if (!s.players[target]) { error = 'No such player in this lobby.'; return null; }
      ids = [target];
    }

    if (!ids.length) { error = 'Everyone in this lobby already has restrictions for game ' + game + '.'; return null; }

    for (const id of ids) {
      const player = s.players[id];
      const seed = rules.newSeed();
      const result = rules.rollPlayer({ rankId: player.rank, seed, enabled });
      if (!result.ok) { error = result.error; return null; }
      rolls[id] = {
        seed,
        rank: player.rank,
        picks: result.picks,
        at: Date.now(),
        by: found.playerId,
      };
    }

    s.game = game;
    return s;
  });

  if (error) return lib.fail(res, 400, error);
  return lib.send(res, 200, { session: lib.publicSession(session, found.playerId) });
};
