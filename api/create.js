/* POST /api/create — a gamemaster opens a lobby.

   The creator becomes the gamemaster and is seated straight away, so the flow
   is: name the lobby, get a link, paste it in Discord. */

const lib = require('./_lib.js');
const { store, rules } = lib;

module.exports = async function handler(req, res) {
  if (!lib.guard(req, res, 'POST')) return;

  const account = await lib.requireAccount(req, res);
  if (!account) return;

  const input = await lib.body(req);
  const sessionName = String(input.sessionName || '').trim() || 'TFT lobby';

  // Codes are short enough to read out loud, so a collision is possible even if
  // unlikely. Claim the key with SET NX and try again rather than trusting luck.
  let code = null;
  for (let attempt = 0; attempt < 8 && !code; attempt++) {
    const candidate = rules.newCode();
    const session = lib.newSession(candidate, sessionName);
    session.players[account.id] = lib.newSeat(account, true);
    if (await store.setIfAbsent(lib.sKey(candidate), session)) code = candidate;
  }
  if (!code) return lib.fail(res, 503, 'Could not allocate a lobby code. Try again.');

  await lib.rememberSession(account.id, code);
  return lib.send(res, 200, { code });
};
