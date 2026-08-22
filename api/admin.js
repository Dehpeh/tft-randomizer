/* POST /api/admin — the two things nobody else can do.

   Accounts have no email, so a forgotten passcode has no self-service path, and
   a tournament wants a clean slate before it starts. Both need someone above the
   gamemasters, which is what ADMIN_KEY is: set it in the Vercel environment to a
   long random string, and keep it off Discord.

   Disabled entirely when ADMIN_KEY is unset, so a deployment that never sets it
   has no admin surface at all.

     { key, op: "resetPasscode", name, passcode }  give an account a new passcode
     { key, op: "deleteAccount", name }            remove an account
     { key, op: "wipe", confirm: "WIPE" }          delete every account and lobby

   wipe is the pre-tournament reset. It cannot be undone and it is meant to be
   run once, from a terminal:

     curl -X POST https://your-domain/api/admin \
       -H 'content-type: application/json' \
       -d '{"key":"...","op":"wipe","confirm":"WIPE"}'
*/

const crypto = require('crypto');
const lib = require('./_lib.js');
const { auth, store } = lib;

function keyMatches(given) {
  const want = process.env.ADMIN_KEY || '';
  if (!want) return false;
  const a = Buffer.from(String(given || ''));
  const b = Buffer.from(want);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return lib.fail(res, 405, 'Use POST.');

  const input = await lib.body(req);

  if (!process.env.ADMIN_KEY) return lib.fail(res, 404, 'Admin endpoint is disabled: no ADMIN_KEY set.');
  if (!keyMatches(input.key)) return lib.fail(res, 403, 'Bad admin key.');

  const op = String(input.op || '');

  if (op === 'resetPasscode') {
    const id = auth.normalizeName(input.name);
    if (!auth.validPasscode(input.passcode)) return lib.fail(res, 400, 'Passcode must be exactly 6 digits.');
    let missing = false;
    await store.update(lib.uKey(id), (a) => {
      if (!a) { missing = true; return null; }
      const { salt, hash } = auth.hashPasscode(String(input.passcode));
      a.salt = salt;
      a.hash = hash;
      return a;
    });
    if (missing) return lib.fail(res, 404, 'No account with that name.');
    await auth.clearFailures(id);
    return lib.send(res, 200, { ok: true, account: id });
  }

  if (op === 'deleteAccount') {
    const id = auth.normalizeName(input.name);
    const account = await store.get(lib.uKey(id));
    if (!account) return lib.fail(res, 404, 'No account with that name.');
    await store.del(lib.uKey(id));
    await auth.clearFailures(id);
    return lib.send(res, 200, { ok: true, deleted: id, note: 'Their seats in existing lobbies are untouched; a gamemaster can remove those.' });
  }

  if (op === 'wipe') {
    if (input.confirm !== 'WIPE') return lib.fail(res, 400, 'Send {"confirm":"WIPE"} to confirm. This deletes every account and lobby.');
    const deleted = await store.wipe('tft:');
    return lib.send(res, 200, { ok: true, deleted });
  }

  return lib.fail(res, 400, 'Unknown operation.');
};
