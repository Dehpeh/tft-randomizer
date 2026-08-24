/* Evidence: the picture behind a proctor note.

   POST /api/evidence   { code, game, kind, note, at, image }  store one still
   GET  /api/evidence?code=XXXXXX&id=...                       fetch it back

   Notes were text-only to begin with, which made them close to useless: "augment
   screen at 04:12" tells a gamemaster where to look but not what they would
   have seen, and by then the game is over. The picture is the whole point, so it
   travels with the note.

   Stills, not video. A clip of any useful length is megabytes, has to be encoded
   on a machine that is currently running a game, and would have to be streamed
   somewhere; a 480px JPEG is about 50KB and answers the same question. Three of
   them per augment — as it opens, and as it closes — is the moment covered.

   Images live under their own keys, never inside the session document. The
   dashboard re-reads that document every few seconds for every player in the
   lobby; putting base64 in it would turn a 4KB poll into a megabyte one. The
   session keeps an id, and only a gamemaster actually opening a note pays for
   the image. */

const lib = require('./_lib.js');
const { store } = lib;

const MAX_CHARS = 200000;      // ~150KB of JPEG; anything larger is a mistake
const MAX_PER_GAME = 12;       // per player: three augments, opening and closing, plus slack
const KINDS = new Set(['augment', 'inactive', 'note']);

const evKey = (code, id) => `tft:ev:${code}:${id}`;

module.exports = async function handler(req, res) {
  const url = new URL(req.url, 'http://x');

  /* ---------- reading ---------- */
  if (req.method === 'GET') {
    const code = lib.cleanCode(url.searchParams.get('code'));
    const id = String(url.searchParams.get('id') || '').replace(/[^a-z0-9]/gi, '');
    if (!code || !id) return lib.fail(res, 400, 'code and id are required.');

    // Anyone seated in the lobby may look: they can already see every roll in it.
    const found = await lib.requireMember(req, res, code);
    if (!found) return;

    const row = await store.get(evKey(code, id));
    if (!row) return lib.fail(res, 404, 'No such evidence.');

    const bytes = Buffer.from(String(row.data || ''), 'base64');
    res.statusCode = 200;
    res.setHeader('content-type', 'image/jpeg');
    res.setHeader('cache-control', 'private, max-age=3600');
    res.end(bytes);
    return;
  }

  /* ---------- writing ---------- */
  if (!lib.guard(req, res, 'POST')) return;

  const input = await lib.body(req);
  const code = lib.cleanCode(input.code);
  if (!code) return lib.fail(res, 400, 'That lobby code is not valid.');

  const found = await lib.requireMember(req, res, code);
  if (!found) return;

  const game = Number(input.game || found.session.game || 1);
  if (!Number.isInteger(game) || game < 1 || game > 9) return lib.fail(res, 400, 'Game must be 1-9.');

  const raw = String(input.image || '');
  const m = /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/=]+)$/.exec(raw);
  if (!m) return lib.fail(res, 400, 'Expected a JPEG or PNG data URL.');
  if (raw.length > MAX_CHARS) return lib.fail(res, 413, 'That image is too large — the proctor should be sending 480px stills.');

  const already = (found.session.flags || [])
    .filter((f) => f.playerId === found.playerId && f.game === game && f.ev).length;
  if (already >= MAX_PER_GAME) return lib.fail(res, 429, 'Enough evidence stored for this game already.');

  const id = Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  await store.setIfAbsent(evKey(code, id), { data: m[2], by: found.playerId, at: Date.now() });

  let error = null;
  const session = await store.update(lib.sKey(code), (s) => {
    if (!s) { error = 'No lobby with that code.'; return null; }
    if (!s.open) { error = 'That lobby is closed.'; return null; }
    s.flags = s.flags || [];
    s.flags.push({
      playerId: found.playerId,
      game,
      kind: KINDS.has(String(input.kind)) ? String(input.kind) : 'note',
      note: String(input.note || '').slice(0, 160),
      at: Math.max(0, Math.min(60 * 60 * 6, Math.round(Number(input.at) || 0))),
      ev: id,
      postedAt: Date.now(),
    });
    if (s.flags.length > 400) s.flags = s.flags.slice(-400);
    return s;
  });

  if (error) {
    await store.del(evKey(code, id));
    return lib.fail(res, 409, error);
  }
  return lib.send(res, 200, { ok: true, id, stored: (session.flags || []).length });
};
