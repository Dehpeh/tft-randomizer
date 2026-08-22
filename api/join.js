/* POST /api/join — sign in to a session, registering on the first visit.

   First time a name is seen in a lobby it claims that name with the passcode it
   arrives with, and declares its peak rank. Every visit after that, the same
   name has to produce the same passcode. Wrong passcodes are counted and locked
   out, because six digits is not much of a wall on its own. */

const lib = require('./_lib.js');
const { auth, store } = lib;

module.exports = async function handler(req, res) {
  if (!lib.guard(req, res, 'POST')) return;

  const input = await lib.body(req);
  const code = lib.cleanCode(input.code);
  const display = String(input.name || '').trim();
  const passcode = String(input.passcode || '');
  const rank = String(input.rank || '');

  if (!code) return lib.fail(res, 400, 'That session code is not valid.');
  if (!auth.validName(display)) return lib.fail(res, 400, 'Name must be 2-32 characters.');
  if (!auth.validPasscode(passcode)) return lib.fail(res, 400, 'Passcode must be exactly 6 digits.');

  const id = auth.normalizeName(display);

  if (await auth.tooManyAttempts(code, id)) {
    return lib.fail(res, 429, 'Too many wrong passcodes. Wait 15 minutes, or ask the gamemaster to reset it.');
  }

  const existing = await store.get(lib.key(code));
  if (!existing) return lib.fail(res, 404, 'No session with that code.');

  const known = existing.players[id];

  if (known && known.hash) {
    if (!auth.checkPasscode(passcode, known.salt, known.hash)) {
      const n = await auth.noteFailure(code, id);
      const left = Math.max(0, auth.MAX_ATTEMPTS - n);
      return lib.fail(res, 401, left ? `Wrong passcode. ${left} attempt${left === 1 ? '' : 's'} left.` : 'Too many wrong passcodes. Locked for 15 minutes.');
    }
    await auth.clearFailures(code, id);
    // Let a returning player correct their rank only while nothing is rolled.
    if (rank && lib.validRank(rank) && rank !== known.rank && !hasAnyRoll(existing, id)) {
      await store.update(lib.key(code), (s) => {
        if (!s || !s.players[id]) return null;
        s.players[id].rank = rank;
        return s;
      });
    }
    auth.setSessionCookie(req, res, code, id);
    return lib.send(res, 200, { code, playerId: id, registered: false });
  }

  // New player, or a player the gamemaster reset. Both need a rank.
  if (!lib.validRank(rank)) return lib.fail(res, 400, 'Pick your peak rank to join.');

  let error = null;
  await store.update(lib.key(code), (s) => {
    if (!s) { error = 'No session with that code.'; return null; }
    const seat = s.players[id];
    if (seat && seat.hash) { error = 'Someone claimed that name while you were typing. Try again.'; return null; }
    if (!seat && !s.open) { error = 'This lobby is closed to new players. Ask the gamemaster to reopen it.'; return null; }
    if (!seat && Object.keys(s.players).length >= 64) { error = 'This lobby is full.'; return null; }

    const fresh = lib.newPlayer(id, display, rank, passcode, seat ? seat.isGm : false);
    if (seat) { fresh.joinedAt = seat.joinedAt; fresh.rank = rank; }
    s.players[id] = fresh;
    return s;
  });

  if (error) return lib.fail(res, 409, error);

  await auth.clearFailures(code, id);
  auth.setSessionCookie(req, res, code, id);
  return lib.send(res, 200, { code, playerId: id, registered: true });
};

function hasAnyRoll(session, playerId) {
  return Object.values(session.rolls || {}).some((game) => game && game[playerId]);
}
