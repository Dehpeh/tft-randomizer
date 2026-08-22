/* POST /api/create — a gamemaster opens a lobby.

   The creator becomes the gamemaster and is signed in straight away, so the
   flow is: fill in three fields, get a URL, paste it in Discord. */

const lib = require('./_lib.js');
const { auth, store, rules } = lib;

module.exports = async function handler(req, res) {
  if (!lib.guard(req, res, 'POST')) return;

  const input = await lib.body(req);
  const display = String(input.name || '').trim();
  const sessionName = String(input.sessionName || '').trim() || 'TFT lobby';
  const passcode = String(input.passcode || '');
  const rank = String(input.rank || '');

  if (!auth.validName(display)) return lib.fail(res, 400, 'Name must be 2-32 characters.');
  if (!auth.validPasscode(passcode)) return lib.fail(res, 400, 'Passcode must be exactly 6 digits.');
  if (!lib.validRank(rank)) return lib.fail(res, 400, 'Pick a peak rank.');

  const id = auth.normalizeName(display);

  // Codes are short enough to read out loud, so a collision is possible even if
  // unlikely. Claim the key with SET NX and try again rather than trusting luck.
  let code = null;
  for (let attempt = 0; attempt < 8 && !code; attempt++) {
    const candidate = rules.newCode();
    const session = lib.newSession(candidate, sessionName);
    session.players[id] = lib.newPlayer(id, display, rank, passcode, true);
    if (await store.setIfAbsent(lib.key(candidate), session)) code = candidate;
  }
  if (!code) return lib.fail(res, 503, 'Could not allocate a session code. Try again.');

  auth.setSessionCookie(req, res, code, id);
  return lib.send(res, 200, { code, playerId: id });
};
