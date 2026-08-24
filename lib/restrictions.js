/* Restriction pool and roll engine for the TFT tournament randomizer.

   No DOM and no server APIs in this file: it loads as a plain <script> in the
   browser (window.TFT) and as a CommonJS module in the Vercel functions, so the
   rules exist exactly once. The server is the one that actually rolls a
   session; the browser copy drives the offline single-player page and the spin
   animation.

   Every restriction carries a `family`. Two restrictions in the same family
   overlap in what they take away from a player (both silence the shop, both
   cost you a hand, both make you drink), and the tournament rule is:

     "IF A PLAYER GETS TWO SIMILAR RESTRICTIONS REROLL THE LOWER ONE."

   Majors are drawn first and minors are drawn against them, so the one that
   gets rerolled is always the lower of the pair. Edit a family string here to
   change what counts as "similar" — that is the only knob the rule needs. */

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TFT = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  /* The doc specifies Challenger down to Platinum. Everything below it plays
     clean: the ladder is already tapering (3 minor at Diamond, 2 at Emerald, 1
     at Platinum) and the next step down from one is none. Give a rank a count
     here and it starts rolling — that is the whole change. */
  const RANKS = [
    { id: 'challenger',  name: 'Challenger',  major: 2, minor: 1 },
    { id: 'grandmaster', name: 'Grandmaster', major: 1, minor: 2 },
    { id: 'master',      name: 'Master',      major: 1, minor: 1 },
    { id: 'diamond',     name: 'Diamond',     major: 0, minor: 3 },
    { id: 'emerald',     name: 'Emerald',     major: 0, minor: 2 },
    { id: 'platinum',    name: 'Platinum',    major: 0, minor: 1 },
    { id: 'gold',        name: 'Gold',        major: 0, minor: 0 },
    { id: 'silver',      name: 'Silver',      major: 0, minor: 0 },
    { id: 'bronze',      name: 'Bronze',      major: 0, minor: 0 },
    { id: 'iron',        name: 'Iron',        major: 0, minor: 0 },
    { id: 'unranked',    name: 'Unranked',    major: 0, minor: 0 },
  ];

  const MINOR = [
    { id: 'mn-afk',       family: 'afk',      text: 'AFK 1 round every stage', details: [{ label: 'Round', options: ['1st round', '2nd round', '3rd round', '4th round'] }] },
    { id: 'mn-shoplock',  family: 'shop',     text: 'Lock 1 shop space, 1 round every stage', details: [{ label: 'Shop slot', options: ['1st slot', '2nd slot', '3rd slot', '4th slot', '5th slot'] }] },
    { id: 'mn-augment',   family: 'augment',  text: '1 augment is chosen randomly', details: [
      { label: 'At', options: ['2-1', '3-2', '4-2'] },
      { label: 'Take', options: ['left', 'middle', 'right'] },
    ] },
    { id: 'mn-costban',   family: 'costban',  text: '5 costs banned until stage 5' },
    { id: 'mn-carousel',  family: 'carousel', text: 'Carousel pick banned for 2 stages', details: [{ label: 'Stages', options: ['2 and 3', '3 and 4', '4 and 5', '5 and 6'] }] },
    { id: 'mn-econ',      family: 'econ',     text: 'Every time you would end a round on an econ threshold, you must roll once' },
    { id: 'mn-pet',       family: 'pet',      text: 'Keep the unit from 1-1 on your bench as a 1-star pet the entire game' },
    { id: 'mn-hand',      family: 'hands',    text: 'Remove 1 hand (your choice, left or right) for stage 4-2' },
    { id: 'mn-drink',     family: 'drink',    text: 'Add a layer of clothing or drink a shot every 3 player combats' },
    { id: 'mn-forcebuy',  family: 'forcebuy', text: 'Every time you see a 1-cost in shop you must buy it, even if you have to sell units' },
    { id: 'mn-side',      family: 'position', text: 'Declare "left" or "right" at the start and only position on that side' },
  ];

  const MAJOR = [
    /* Every augment is dealt to them, so all three positions are rolled up
       front: an umpire can check the pick against this without asking anyone
       what they meant to take. */
    { id: 'mj-augment',   family: 'augment',  text: 'No augment freedom: take the augment rolled for you at each stage', details: [
      { label: '2-1', options: ['left', 'middle', 'right'] },
      { label: '3-2', options: ['left', 'middle', 'right'] },
      { label: '4-2', options: ['left', 'middle', 'right'] },
    ] },
    { id: 'mj-shoplock',  family: 'shop',     text: 'Lock 1 shop space', details: [{ label: 'Shop slot', options: ['1st slot', '2nd slot', '3rd slot', '4th slot', '5th slot'] }] },
    { id: 'mj-afk',       family: 'afk',      text: 'AFK for a whole stage', details: [{ label: 'Stage', options: ['stage 2', 'stage 3', 'stage 4', 'stage 5', 'stage 6'] }] },
    { id: 'mj-costban',   family: 'costban',  text: '5 and 4 costs banned until stage 5' },
    { id: 'mj-carousel',  family: 'carousel', text: 'Carousel pick banned permanently' },
    { id: 'mj-wisp',      family: 'wisp',     text: 'Can only take "Risky" wisps' },
    { id: 'mj-zero',      family: 'econ',     text: 'On 4-2 you MUST level/roll to 0 gold' },
    { id: 'mj-threestar', family: '3star',    text: 'No 3-star unit allowed' },
    { id: 'mj-hands',     family: 'hands',    text: 'No hands allowed for stage 4-2' },
    { id: 'mj-drink',     family: 'drink',    text: 'Add a layer of clothing OR drink every time you roll your shop 3 times' },
    { id: 'mj-guide',     family: 'guide',    text: 'Cannot play a line found in a guide of choice (Mobalytics, Tactics.tools, U.GG, etc.)' },
    { id: 'mj-traitban',  family: 'traits',   text: 'Choose a trait and ban it: activating it for a combat is an automatic forfeit' },
    { id: 'mj-forcebuy',  family: 'forcebuy', text: 'Every time you see a 1 or 2-cost, you must buy it' },
    { id: 'mj-bd',        family: 'traits',   text: 'Your game is Built Different (no active traits)' },
  ];

  const POOL = { major: MAJOR, minor: MINOR };
  const ALL = MAJOR.concat(MINOR);
  const byId = (id) => ALL.find((r) => r.id === id) || null;
  const rankById = (id) => RANKS.find((r) => r.id === id) || null;

  /* One phrasing of a rank's allowance, used by every page, so a rank that
     rolls nothing says so instead of rendering a blank. */
  function distText(rank) {
    const r = typeof rank === 'string' ? rankById(rank) : rank;
    if (!r) return '';
    const parts = [];
    if (r.major) parts.push(r.major + ' major');
    if (r.minor) parts.push(r.minor + ' minor');
    return parts.length ? parts.join(' + ') : 'no restrictions';
  }

  /* ---------- seeded randomness ----------
     Rolls are seeded so any result can be reproduced later from the seed
     printed next to it: paste the seed back in and the same restrictions come
     out. That is the whole answer to "the randomizer cheated me". */

  function hashSeed(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }

  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function rngFromSeed(seed) {
    return mulberry32(hashSeed(String(seed)));
  }

  /* A short, unambiguous seed token. No vowels and no look-alike glyphs,
     because these get read out loud in Discord and typed back in by hand. */
  const ALPHABET = '23456789CDFGHJKLMNPQRSTVWXZ';

  function token(len, groupAt) {
    const c = (typeof globalThis !== 'undefined' && globalThis.crypto) || null;
    const bytes = new Uint32Array(len);
    if (c && c.getRandomValues) c.getRandomValues(bytes);
    else for (let i = 0; i < len; i++) bytes[i] = Math.floor(Math.random() * 0xffffffff);
    let out = '';
    for (let i = 0; i < len; i++) {
      if (groupAt && i > 0 && i % groupAt === 0) out += '-';
      out += ALPHABET[bytes[i] % ALPHABET.length];
    }
    return out;
  }

  const newSeed = () => token(8, 4);
  const newCode = () => token(6);

  /* ---------- the roll ----------
     Draws are uniform over the enabled pool and rerolled on a clash rather
     than drawn from a pre-filtered list. Same distribution either way, but
     this way the reroll count is real and can be shown: it is the tournament
     rule happening, not a footnote. */

  const MAX_DRAWS = 400;

  function drawOne(tier, enabled, taken, rng) {
    const options = POOL[tier].filter((r) => enabled.has(r.id));
    if (!options.length) return { error: 'No ' + tier + ' restrictions are enabled.' };

    const open = options.filter((r) => !taken.families.has(r.family));
    if (!open.length) {
      return { error: 'Not enough ' + tier + ' restrictions enabled: everything left clashes with a restriction already rolled.' };
    }

    let rerolls = 0;
    for (let i = 0; i < MAX_DRAWS; i++) {
      const pick = options[Math.floor(rng() * options.length)];
      if (taken.families.has(pick.family)) { rerolls++; continue; }
      return { pick: pick, rerolls: rerolls };
    }
    // Fallback, only reachable if the enabled pool is pathologically small.
    return { pick: open[Math.floor(rng() * open.length)], rerolls: rerolls };
  }

  /* Some restrictions leave a blank the player would otherwise fill in
     themselves — which shop slot is locked, which stage you sit out. Left to a
     player that is a choice, and a choice is an advantage, so the randomizer
     fills it from the same seeded stream that picked the restriction. */
  function toPick(entry, tier, rerolls, rng) {
    const pick = { id: entry.id, family: entry.family, text: entry.text, tier: tier, rerolls: rerolls };
    const specs = entry.details || (entry.detail ? [entry.detail] : null);
    if (specs) {
      pick.details = specs.map((d) => ({
        label: d.label,
        value: d.options[Math.floor(rng() * d.options.length)],
      }));
    }
    return pick;
  }

  /* Rolls made before restrictions could need more than one detail stored a
     single `detail`. Read both shapes so old results still render. */
  function detailsOf(pick) {
    if (!pick) return [];
    if (pick.details) return pick.details;
    return pick.detail ? [pick.detail] : [];
  }

  /* The full sentence: the restriction plus whatever was rolled inside it. */
  function pickText(pick) {
    if (!pick) return '';
    const parts = detailsOf(pick);
    if (!parts.length) return pick.text;
    return pick.text + ' — ' + parts.map((d) => d.label + ' ' + d.value).join(', ');
  }

  function enabledSet(offIds) {
    const off = new Set(offIds || []);
    return new Set(ALL.filter((r) => !off.has(r.id)).map((r) => r.id));
  }

  /**
   * Roll one player's restrictions.
   * @param {object} opts
   * @param {string} opts.rankId   one of RANKS[].id
   * @param {string} opts.seed     seed string; same seed + same pool = same roll
   * @param {Set<string>} [opts.enabled]  ids allowed in the draw (default: all)
   */
  function rollPlayer(opts) {
    const rank = rankById(opts.rankId) || RANKS[0];
    const on = opts.enabled || enabledSet([]);
    const rng = rngFromSeed(opts.seed);
    const taken = { families: new Set(), ids: new Set() };
    const picks = [];

    // Majors first, so a minor is always the one rerolled out of a clash.
    const plan = [];
    for (let i = 0; i < rank.major; i++) plan.push('major');
    for (let i = 0; i < rank.minor; i++) plan.push('minor');

    for (const tier of plan) {
      const res = drawOne(tier, on, taken, rng);
      if (res.error) return { ok: false, error: res.error, rank: rank, seed: opts.seed, picks: picks };
      taken.families.add(res.pick.family);
      taken.ids.add(res.pick.id);
      picks.push(toPick(res.pick, tier, res.rerolls, rng));
    }

    return { ok: true, rank: rank, seed: opts.seed, picks: picks };
  }

  /**
   * Reroll a single slot in place, keeping every other pick. Used when a
   * restriction turns out to be impossible in that lobby.
   */
  function rerollSlot(picks, index, enabled, seed) {
    const on = enabled || enabledSet([]);
    const rng = rngFromSeed(seed);
    const tier = picks[index].tier;
    const taken = { families: new Set(), ids: new Set() };
    picks.forEach((p, i) => { if (i !== index) { taken.families.add(p.family); taken.ids.add(p.id); } });

    const res = drawOne(tier, on, taken, rng);
    if (res.error) return { ok: false, error: res.error };

    const next = picks.slice();
    next[index] = toPick(res.pick, tier, res.rerolls, rng);
    return { ok: true, picks: next };
  }

  return {
    RANKS: RANKS, MINOR: MINOR, MAJOR: MAJOR, POOL: POOL, ALL: ALL,
    byId: byId, rankById: rankById, distText: distText, pickText: pickText, detailsOf: detailsOf,
    newSeed: newSeed, newCode: newCode, rngFromSeed: rngFromSeed,
    enabledSet: enabledSet, rollPlayer: rollPlayer, rerollSlot: rerollSlot,
  };
});
