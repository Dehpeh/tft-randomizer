/* GET /api/state?code=XXXXXX — everything the dashboard draws.

   Three answers, so the page always knows which card to show:
     - signed out          -> { needsLogin: true, preview }
     - signed in, no seat  -> { needsJoin: true, preview }
     - seated              -> { session }

   The preview is deliberately thin: the lobby name, who runs it and how many
   are in it, enough to tell you that you followed the right link. Restrictions,
   ranks and placements need a seat. */

const lib = require('./_lib.js');
const { auth, store } = lib;

module.exports = async function handler(req, res) {
  if (!lib.guard(req, res, 'GET')) return;

  const url = new URL(req.url, 'http://x');
  const code = lib.cleanCode(url.searchParams.get('code'));
  if (!code) return lib.fail(res, 400, 'That lobby code is not valid.');

  const session = await store.get(lib.sKey(code));
  if (!session) return lib.fail(res, 404, 'No lobby with that code.');

  const preview = {
    code: session.code,
    name: session.name,
    open: session.open,
    players: Object.keys(session.players).length,
    gm: (Object.values(session.players).find((p) => p.isGm) || {}).display || null,
  };

  const id = auth.whoami(req);
  const account = id ? await store.get(lib.uKey(id)) : null;
  if (!account) return lib.send(res, 200, { needsLogin: true, preview });
  if (!session.players[account.id]) {
    return lib.send(res, 200, { needsJoin: true, preview, account: lib.publicAccount(account) });
  }

  return lib.send(res, 200, { session: lib.publicSession(session, account.id), account: lib.publicAccount(account) });
};
