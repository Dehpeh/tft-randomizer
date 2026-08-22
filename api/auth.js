/* Accounts: register, sign in, sign out, and "who am I".

   GET  /api/auth            -> { account } or { account: null }
   POST /api/auth {op:"register", name, passcode, rank}
   POST /api/auth {op:"login",    name, passcode}
   POST /api/auth {op:"logout"}
   POST /api/auth {op:"setRank",  rank}      // your own peak rank

   One account per name, first come first served. Names are matched
   case-insensitively but keep the form you typed for display. */

const lib = require('./_lib.js');
const { auth, store } = lib;

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    const id = auth.whoami(req);
    const account = id ? await store.get(lib.uKey(id)) : null;
    return lib.send(res, 200, { account: account ? lib.publicAccount(account) : null });
  }

  if (!lib.guard(req, res, 'POST')) return;

  const input = await lib.body(req);
  const op = String(input.op || '');

  if (op === 'logout') {
    auth.clearLoginCookie(req, res);
    return lib.send(res, 200, { ok: true });
  }

  if (op === 'setRank') {
    const account = await lib.requireAccount(req, res);
    if (!account) return;
    if (!lib.validRank(input.rank)) return lib.fail(res, 400, 'Unknown rank.');
    const next = await store.update(lib.uKey(account.id), (a) => {
      if (!a) return null;
      a.rank = input.rank;
      return a;
    });
    return lib.send(res, 200, { account: lib.publicAccount(next || account) });
  }

  const display = String(input.name || '').trim();
  const passcode = String(input.passcode || '');

  if (!auth.validName(display)) return lib.fail(res, 400, 'Name must be 2-32 characters.');
  if (!auth.validPasscode(passcode)) return lib.fail(res, 400, 'Passcode must be exactly 6 digits.');

  const id = auth.normalizeName(display);

  if (op === 'register') {
    if (!lib.validRank(input.rank)) return lib.fail(res, 400, 'Pick your peak rank.');
    const account = lib.newAccount(id, display, input.rank, passcode);
    const claimed = await store.setIfAbsent(lib.uKey(id), account);
    if (!claimed) return lib.fail(res, 409, 'That name is already registered. Sign in instead, or ask the gamemaster if someone took it.');
    auth.setLoginCookie(req, res, id);
    return lib.send(res, 200, { account: lib.publicAccount(account), registered: true });
  }

  if (op === 'login') {
    if (await auth.tooManyAttempts(id)) {
      return lib.fail(res, 429, 'Too many wrong passcodes. Wait 15 minutes.');
    }
    const account = await store.get(lib.uKey(id));
    if (!account || !auth.checkPasscode(passcode, account.salt, account.hash)) {
      // Same message either way: no telling a stranger which names exist.
      const n = await auth.noteFailure(id);
      const left = Math.max(0, auth.MAX_ATTEMPTS - n);
      return lib.fail(res, 401, left
        ? `Wrong name or passcode. ${left} attempt${left === 1 ? '' : 's'} left.`
        : 'Too many wrong passcodes. Locked for 15 minutes.');
    }
    await auth.clearFailures(id);
    auth.setLoginCookie(req, res, id);
    return lib.send(res, 200, { account: lib.publicAccount(account), registered: false });
  }

  return lib.fail(res, 400, 'Unknown operation.');
};
