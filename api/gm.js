/* POST /api/gm — everything else the gamemaster can do to a lobby.

   One route with an `op`, rather than a route per verb, because they all do the
   same thing: check the caller is the gamemaster, mutate the session document,
   hand back the new state for every dashboard to re-render from.

   ops:
     setRank        { playerId, rank }   fix a rank someone got wrong
     removePlayer   { playerId }         drop a no-show (never the gamemaster)
     resetPasscode  { playerId }         forgotten passcode: they re-claim the name on next login
     rerollSlot     { playerId, game, index }  one restriction, kept in place
     clearGame      { game }             wipe a game's rolls and start over
     setGame        { game }             which game the dashboard is showing
     setOpen        { open }             open or close the lobby to new players
     setPool        { off: [ids] }       which restrictions are in the draw
     transferGm     { playerId }         hand the lobby to someone else
*/

const lib = require('./_lib.js');
const { rules, store, auth } = lib;

module.exports = async function handler(req, res) {
  if (!lib.guard(req, res, 'POST')) return;

  const input = await lib.body(req);
  const code = lib.cleanCode(input.code);
  if (!code) return lib.fail(res, 400, 'That session code is not valid.');

  const found = await lib.requireGm(req, res, code);
  if (!found) return;

  const me = found.playerId;
  const op = String(input.op || '');
  let error = null;

  const session = await store.update(lib.key(code), (s) => {
    if (!s) { error = 'No session with that code.'; return null; }
    const target = input.playerId ? s.players[String(input.playerId)] : null;

    switch (op) {
      case 'setRank': {
        if (!target) { error = 'No such player in this lobby.'; return null; }
        if (!lib.validRank(input.rank)) { error = 'Unknown rank.'; return null; }
        target.rank = input.rank;
        return s;
      }

      case 'removePlayer': {
        if (!target) { error = 'No such player in this lobby.'; return null; }
        if (target.id === me) { error = 'You cannot remove yourself. Hand the lobby over first.'; return null; }
        delete s.players[target.id];
        Object.values(s.rolls).forEach((game) => { delete game[target.id]; });
        return s;
      }

      case 'resetPasscode': {
        if (!target) { error = 'No such player in this lobby.'; return null; }
        target.hash = null;
        target.salt = null;
        return s;
      }

      case 'rerollSlot': {
        if (!target) { error = 'No such player in this lobby.'; return null; }
        const game = Number(input.game || s.game);
        const roll = (s.rolls[game] || {})[target.id];
        if (!roll) { error = 'That player has no roll for game ' + game + ' yet.'; return null; }
        const index = Number(input.index);
        if (!Number.isInteger(index) || index < 0 || index >= roll.picks.length) { error = 'No such slot.'; return null; }

        const seed = rules.newSeed();
        const out = rules.rerollSlot(roll.picks, index, rules.enabledSet(s.pool.off), seed);
        if (!out.ok) { error = out.error; return null; }
        roll.picks = out.picks;
        roll.rerolledAt = Date.now();
        roll.slotSeeds = Object.assign({}, roll.slotSeeds, { [index]: seed });
        return s;
      }

      case 'clearGame': {
        const game = Number(input.game || s.game);
        delete s.rolls[game];
        return s;
      }

      case 'setGame': {
        const game = Number(input.game);
        if (!Number.isInteger(game) || game < 1 || game > 9) { error = 'Game must be 1-9.'; return null; }
        s.game = game;
        return s;
      }

      case 'setOpen': {
        s.open = Boolean(input.open);
        return s;
      }

      case 'setPool': {
        const ids = Array.isArray(input.off) ? input.off.map(String) : [];
        const known = new Set(rules.ALL.map((r) => r.id));
        s.pool.off = ids.filter((id) => known.has(id));
        const left = rules.enabledSet(s.pool.off);
        const majors = rules.MAJOR.filter((r) => left.has(r.id)).length;
        const minors = rules.MINOR.filter((r) => left.has(r.id)).length;
        if (majors < 2 || minors < 3) {
          error = 'Leave at least 2 major and 3 minor restrictions enabled, or Challenger and Diamond cannot be rolled.';
          return null;
        }
        return s;
      }

      case 'transferGm': {
        if (!target) { error = 'No such player in this lobby.'; return null; }
        Object.values(s.players).forEach((p) => { p.isGm = p.id === target.id; });
        return s;
      }

      default:
        error = 'Unknown operation.';
        return null;
    }
  });

  if (error) return lib.fail(res, 400, error);
  if (op === 'resetPasscode' && input.playerId) await auth.clearFailures(code, String(input.playerId));

  return lib.send(res, 200, { session: lib.publicSession(session, me) });
};
