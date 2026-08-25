/* POST /api/gm — everything the gamemaster can do to a lobby.

   One route with an `op`, rather than a route per verb, because they all do the
   same thing: check the caller runs this lobby, mutate the session document,
   hand back the new state for every dashboard to re-render from.

   ops:
     setRank        { playerId, rank }        fix a rank someone got wrong
     removePlayer   { playerId }              drop a no-show (never the gamemaster)
     rerollSlot     { playerId, game, index } one restriction, kept in place
     setPlacements  { game, placements }      final standings: { playerId: 1..8 }
     clearPlacements{ game }                  wipe a game's placements
     clearGame      { game }                  wipe a game's rolls and placements
     setGame        { game }                  which game the lobby is on
     setOpen        { open }                  open or close the lobby to new players
     setPool        { off: [ids] }            which restrictions are in the draw
     transferGm     { playerId }              hand the lobby to someone else

   A seat's rank is a copy of the account's, so setRank here changes what this
   player is rolled for in this tournament without touching their account.
*/

const lib = require('./_lib.js');
const { rules, store } = lib;

const MAX_SEATS = 8; // a TFT lobby; placements are 1..8

module.exports = async function handler(req, res) {
  if (!lib.guard(req, res, 'POST')) return;

  const input = await lib.body(req);
  const code = lib.cleanCode(input.code);
  if (!code) return lib.fail(res, 400, 'That lobby code is not valid.');

  const found = await lib.requireGm(req, res, code);
  if (!found) return;

  const me = found.playerId;
  const op = String(input.op || '');
  if (!lib.requireLive(res, found.session, op)) return;

  /* Deleting is not a mutation of the document, it is the end of it, so it
     happens outside the update() below. */
  if (op === 'deleteLobby') {
    await store.del(lib.sKey(code));
    return lib.send(res, 200, { deleted: code });
  }

  let error = null;

  const session = await store.update(lib.sKey(code), (s) => {
    if (!s) { error = 'No lobby with that code.'; return null; }
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
        s.penalties = (s.penalties || []).filter((p) => p.playerId !== target.id);
        Object.values(s.results || {}).forEach((r) => { if (r && r.placements) delete r.placements[target.id]; });
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

      /* Placements are the result of the game, so they are checked like one:
         every entry has to name a player in this lobby, sit in 1..8, and be
         unique. A lobby where two people came fourth is a typo, not a result. */
      case 'setPlacements': {
        const game = Number(input.game || s.game);
        if (!Number.isInteger(game) || game < 1 || game > 9) { error = 'Game must be 1-9.'; return null; }
        const raw = input.placements && typeof input.placements === 'object' ? input.placements : {};
        const placements = {};
        const used = new Set();

        for (const [playerId, value] of Object.entries(raw)) {
          if (value === '' || value === null || value === undefined) continue; // not entered yet
          const place = Number(value);
          if (!s.players[playerId]) { error = 'Placement for someone who is not in this lobby.'; return null; }
          if (lib.isReferee(s.players[playerId])) { error = 'Referees are not placed — they hold no seat.'; return null; }
          if (!Number.isInteger(place) || place < 1 || place > MAX_SEATS) { error = 'Placements must be 1-' + MAX_SEATS + '.'; return null; }
          if (used.has(place)) { error = 'Two players cannot both be ' + place + '.'; return null; }
          used.add(place);
          placements[playerId] = place;
        }

        s.results = s.results || {};
        s.results[game] = { placements, at: Date.now(), by: me };
        return s;
      }

      /* A penalty is a note against a player for a game — a rule broken, a
         restriction ignored. It never changes their placement by itself: the
         gamemaster decides what it costs and enters the placement they judge
         fair. This is the record of why. */
      case 'addPenalty': {
        if (!target) { error = 'No such player in this lobby.'; return null; }
        const reason = String(input.reason || '').trim().slice(0, 200);
        if (!reason) { error = 'Say what the penalty is for.'; return null; }
        const game = Number(input.game || s.game);
        s.penalties = s.penalties || [];
        s.penalties.unshift({
          id: 'p' + Date.now().toString(36) + Math.floor(s.penalties.length).toString(36),
          playerId: target.id,
          game,
          reason,
          at: Date.now(),
          by: me,
        });
        s.penalties = s.penalties.slice(0, 200);
        return s;
      }

      case 'removePenalty': {
        const id = String(input.penaltyId || '');
        s.penalties = (s.penalties || []).filter((p) => p.id !== id);
        return s;
      }

      case 'clearPlacements': {
        const game = Number(input.game || s.game);
        if (s.results) delete s.results[game];
        return s;
      }

      case 'clearGame': {
        const game = Number(input.game || s.game);
        delete s.rolls[game];
        if (s.results) delete s.results[game];
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
  return lib.send(res, 200, { session: lib.publicSession(session, me) });
};
