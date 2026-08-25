/* POST /api/flag — a player's own proctor reporting what it saw.

   Flags are machine output, not decisions: "nothing on screen changed for 40
   seconds", "the augment screen opened at 3-2". They exist so a gamemaster has
   somewhere to look instead of watching eight streams at once. A flag never
   costs anyone anything on its own — a penalty is a separate, deliberate act by
   a human, and it stays that way.

   Only the player's own device posts their own flags, and only text: timings,
   what kind of thing happened, a one-line note. Screenshots never leave the
   browser that took them. */

const lib = require('./_lib.js');
const { store } = lib;

const KINDS = new Set(['inactive', 'augment', 'note', 'started', 'stopped']);
const MAX_PER_REQUEST = 40;
const MAX_STORED = 400;

/* A summary row is not an event. It is where a counted state stands right now —
   "slot 3 held on 2 of 47 rerolls" — and the next one supersedes it rather than
   joining it. So summaries REPLACE per player per game instead of appending,
   which is also the only reason a proctor can send them every time it posts
   without burying the flag list. */
const MAX_SUMMARY_ROWS = 12;

module.exports = async function handler(req, res) {
  if (!lib.guard(req, res, 'POST')) return;

  const input = await lib.body(req);
  const code = lib.cleanCode(input.code);
  if (!code) return lib.fail(res, 400, 'That lobby code is not valid.');

  const found = await lib.requireMember(req, res, code);
  if (!found) return;

  const game = Number(input.game || found.session.game || 1);
  if (!Number.isInteger(game) || game < 1 || game > 9) return lib.fail(res, 400, 'Game must be 1-9.');

  const incoming = Array.isArray(input.flags) ? input.flags.slice(0, MAX_PER_REQUEST) : [];
  const rawRows = Array.isArray(input.summary) ? input.summary.slice(0, MAX_SUMMARY_ROWS) : null;
  if (!incoming.length && !rawRows) return lib.fail(res, 400, 'Nothing to report.');

  /* Counts are numbers and stay numbers: a row that arrives with text where a
     total should be is dropped rather than rendered as "of undefined". */
  const rows = rawRows && rawRows.map((r) => ({
    key: String(r.key || '').slice(0, 32),
    text: String(r.text || '').slice(0, 140),
    breach: Boolean(r.breach),
    count: Math.max(0, Math.min(9999, Math.round(Number(r.count) || 0))),
    of: Math.max(0, Math.min(9999, Math.round(Number(r.of) || 0))),
  })).filter((r) => r.key && r.text);

  const clean = incoming.map((f) => ({
    kind: KINDS.has(String(f.kind)) ? String(f.kind) : 'note',
    note: String(f.note || '').slice(0, 160),
    // Seconds since this player started proctoring, not a wall clock: it is the
    // number that lines up with their own recording.
    at: Math.max(0, Math.min(60 * 60 * 6, Math.round(Number(f.at) || 0))),
    seconds: Math.max(0, Math.min(60 * 60, Math.round(Number(f.seconds) || 0))),
  }));

  const session = await store.update(lib.sKey(code), (s) => {
    if (!s) return null;
    if (!s.open) return null; // a closed lobby takes no new evidence either
    s.flags = s.flags || [];
    clean.forEach((f) => s.flags.push(Object.assign({ playerId: found.playerId, game, postedAt: Date.now() }, f)));
    if (s.flags.length > MAX_STORED) s.flags = s.flags.slice(-MAX_STORED);

    if (rows) {
      s.summaries = s.summaries || {};
      s.summaries[game] = s.summaries[game] || {};
      s.summaries[game][found.playerId] = { rows: rows, at: Date.now() };
    }
    return s;
  });

  if (!session) return lib.fail(res, 409, 'That lobby is closed or gone.');
  return lib.send(res, 200, { ok: true, stored: clean.length, summarised: rows ? rows.length : 0 });
};
