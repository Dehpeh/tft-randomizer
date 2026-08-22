/* GET /api/me — your account, your matches, your numbers.

   A match is one game in one lobby where you were rolled restrictions. It
   counts as played once the gamemaster submits placements for it; before that
   it shows as pending, because a restriction with no result is not a result.

   The aggregation happens here rather than in the browser so the numbers cannot
   be argued with client-side, and it reads only the lobbies your account has
   actually been in (they are listed on the account) rather than scanning the
   database. */

const lib = require('./_lib.js');
const { store, rules } = lib;

const MAX_LOBBIES = 40;

module.exports = async function handler(req, res) {
  if (!lib.guard(req, res, 'GET')) return;

  const account = await lib.requireAccount(req, res);
  if (!account) return;

  const codes = (account.sessions || []).slice(0, MAX_LOBBIES);
  const sessions = await Promise.all(codes.map((code) => store.get(lib.sKey(code))));

  const lobbies = [];
  const matches = [];

  sessions.forEach((s) => {
    if (!s || !s.players || !s.players[account.id]) return;
    const seat = s.players[account.id];
    lobbies.push({
      code: s.code,
      name: s.name,
      isGm: Boolean(seat.isGm),
      rank: seat.rank,
      players: Object.keys(s.players).length,
      createdAt: s.createdAt,
    });

    Object.keys(s.rolls || {}).forEach((game) => {
      const roll = s.rolls[game][account.id];
      if (!roll) return;
      const result = (s.results || {})[game] || {};
      const placements = result.placements || {};
      const place = placements[account.id] || null;

      matches.push({
        code: s.code,
        lobby: s.name,
        game: Number(game),
        rank: roll.rank || seat.rank,
        seed: roll.seed,
        picks: roll.picks,
        placement: place,
        // Where the field finished, so a 4th out of 5 reads differently from a
        // 4th out of 8.
        field: Object.keys(placements).length || null,
        at: roll.at || s.createdAt,
      });
    });
  });

  matches.sort((a, b) => b.at - a.at);

  return lib.send(res, 200, {
    account: lib.publicAccount(account),
    lobbies,
    matches,
    stats: summarise(matches),
  });
};

function summarise(matches) {
  const played = matches.filter((m) => m.placement);
  const total = played.reduce((sum, m) => sum + m.placement, 0);

  // How a restriction actually treats you: average placement in the games you
  // carried it. Small samples, so the count travels with the number.
  const byRestriction = {};
  played.forEach((m) => {
    m.picks.forEach((pick) => {
      const row = byRestriction[pick.id] || (byRestriction[pick.id] = {
        id: pick.id, text: pick.text, tier: pick.tier, games: 0, total: 0,
      });
      row.games += 1;
      row.total += m.placement;
    });
  });

  const restrictions = Object.values(byRestriction)
    .map((r) => ({ id: r.id, text: r.text, tier: r.tier, games: r.games, avg: r.total / r.games }))
    .sort((a, b) => a.avg - b.avg || b.games - a.games);

  const byTier = { major: { games: 0, total: 0 }, minor: { games: 0, total: 0 } };
  played.forEach((m) => m.picks.forEach((p) => {
    byTier[p.tier].games += 1;
    byTier[p.tier].total += m.placement;
  }));

  return {
    games: played.length,
    pending: matches.length - played.length,
    avgPlacement: played.length ? total / played.length : null,
    firsts: played.filter((m) => m.placement === 1).length,
    top4: played.filter((m) => m.placement <= 4).length,
    bottom4: played.filter((m) => m.placement > 4).length,
    best: played.length ? Math.min(...played.map((m) => m.placement)) : null,
    worst: played.length ? Math.max(...played.map((m) => m.placement)) : null,
    restrictions,
    tiers: {
      major: byTier.major.games ? byTier.major.total / byTier.major.games : null,
      minor: byTier.minor.games ? byTier.minor.total / byTier.minor.games : null,
    },
    poolSize: rules.ALL.length,
  };
}
