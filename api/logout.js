/* POST /api/logout — drop the cookie for one session on this device.
   Leaving the lobby is a gamemaster action; this only signs you out. */

const lib = require('./_lib.js');

module.exports = async function handler(req, res) {
  if (!lib.guard(req, res, 'POST')) return;

  const input = await lib.body(req);
  const code = lib.cleanCode(input.code);
  if (!code) return lib.fail(res, 400, 'That session code is not valid.');

  lib.auth.clearSessionCookie(req, res, code);
  return lib.send(res, 200, { ok: true });
};
