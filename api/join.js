/* POST /api/join — take a seat in a lobby, or join it without one.

   `as: "referee"` puts somebody in the lobby who is not playing: no roll, no
   placement, and no claim on one of the eight seats, so a full table can still
   fill up around them.

   No passcode here any more: you are already signed in to an account, and
   joining is just claiming a seat with the name and peak rank that account
   carries. Re-joining a lobby you are already in is a no-op, so the invite link
   is safe to click twice. */

const lib = require('./_lib.js');
const { store } = lib;

module.exports = async function handler(req, res) {
  if (!lib.guard(req, res, 'POST')) return;

  const account = await lib.requireAccount(req, res);
  if (!account) return;

  const input = await lib.body(req);
  const code = lib.cleanCode(input.code);
  if (!code) return lib.fail(res, 400, 'That lobby code is not valid.');

  const asReferee = String(input.as || '') === 'referee';

  let error = null;
  const session = await store.update(lib.sKey(code), (s) => {
    if (!s) { error = 'No lobby with that code.'; return null; }
    if (s.players[account.id]) return null; // already in
    if (!s.open) { error = 'This lobby is closed to new players. Ask the gamemaster to reopen it.'; return null; }
    /* Only players use up a seat. Eight is the table, and it is the same eight
       that placements run 1-8 over. */
    if (!asReferee && lib.playingIds(s).length >= lib.MAX_SEATS) {
      error = 'All ' + lib.MAX_SEATS + ' seats are taken. You can still join as a referee.';
      return null;
    }
    if (Object.keys(s.players).length >= 64) { error = 'This lobby is full.'; return null; }
    s.players[account.id] = lib.newSeat(account, false, asReferee ? 'referee' : 'player');
    return s;
  });

  if (error) return lib.fail(res, 409, error);

  await lib.rememberSession(account.id, code);
  return lib.send(res, 200, { session: lib.publicSession(session, account.id) });
};
