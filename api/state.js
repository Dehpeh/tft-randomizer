/* GET /api/state?code=XXXXXX — everything the dashboard draws.

   Signed out, it answers with just enough to render the login card (the lobby
   name and how many players are in it) so you can tell you followed the right
   link before you type a passcode. Restrictions, ranks and the roster need a
   seat in the lobby. */

const lib = require('./_lib.js');
const { auth, store } = lib;

module.exports = async function handler(req, res) {
  if (!lib.guard(req, res, 'GET')) return;

  const url = new URL(req.url, 'http://x');
  const code = lib.cleanCode(url.searchParams.get('code'));
  if (!code) return lib.fail(res, 400, 'That session code is not valid.');

  const session = await store.get(lib.key(code));
  if (!session) return lib.fail(res, 404, 'No session with that code.');

  const playerId = auth.whoami(req, code);
  if (!playerId || !session.players[playerId]) {
    return lib.send(res, 200, {
      needsAuth: true,
      preview: {
        code: session.code,
        name: session.name,
        open: session.open,
        players: Object.keys(session.players).length,
        gm: (Object.values(session.players).find((p) => p.isGm) || {}).display || null,
      },
    });
  }

  return lib.send(res, 200, { session: lib.publicSession(session, playerId) });
};
