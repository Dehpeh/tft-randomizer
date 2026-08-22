/* POST /api/join — take a seat in a lobby.

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

  let error = null;
  const session = await store.update(lib.sKey(code), (s) => {
    if (!s) { error = 'No lobby with that code.'; return null; }
    if (s.players[account.id]) return null; // already seated
    if (!s.open) { error = 'This lobby is closed to new players. Ask the gamemaster to reopen it.'; return null; }
    if (Object.keys(s.players).length >= 64) { error = 'This lobby is full.'; return null; }
    s.players[account.id] = lib.newSeat(account, false);
    return s;
  });

  if (error) return lib.fail(res, 409, error);

  await lib.rememberSession(account.id, code);
  return lib.send(res, 200, { session: lib.publicSession(session, account.id) });
};
