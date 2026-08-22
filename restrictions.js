/* Restriction pool and roll engine for the TFT tournament randomizer.
   No DOM in this file: app.js owns the page, this owns the rules.

   Every restriction carries a `family`. Two restrictions in the same family
   overlap in what they take away from a player (both silence the shop, both
   cost you a hand, both make you drink), and the tournament rule is:

     "IF A PLAYER GETS TWO SIMILAR RESTRICTIONS REROLL THE LOWER ONE."

   Majors are drawn first and minors are drawn against them, so the one that
   gets rerolled is always the lower of the pair. Edit a family string here to
   change what counts as "similar" — that is the only knob the rule needs. */

const RANKS = [
  { id: 'challenger',  name: 'Challenger',  major: 2, minor: 1 },
  { id: 'grandmaster', name: 'Grandmaster', major: 1, minor: 2 },
  { id: 'master',      name: 'Master',      major: 1, minor: 1 },
  { id: 'diamond',     name: 'Diamond',     major: 0, minor: 3 },
  { id: 'emerald',     name: 'Emerald',     major: 0, minor: 2 },
  { id: 'platinum',    name: 'Platinum',    major: 0, minor: 1 },
];

const MINOR = [
  { id: 'mn-afk',       family: 'afk',      text: 'AFK 1 round every stage' },
  { id: 'mn-shoplock',  family: 'shop',     text: 'Lock 1 shop space, 1 round every stage' },
  { id: 'mn-augment',   family: 'augment',  text: '1 augment is chosen randomly' },
  { id: 'mn-costban',   family: 'costban',  text: '5 costs banned until stage 5' },
  { id: 'mn-carousel',  family: 'carousel', text: 'Carousel pick banned for 2 stages' },
  { id: 'mn-econ',      family: 'econ',     text: 'Every time you would end a round on an econ threshold, you must roll once' },
  { id: 'mn-pet',       family: 'pet',      text: 'Keep the unit from 1-1 on your bench as a 1-star pet the entire game' },
  { id: 'mn-hand',      family: 'hands',    text: 'Remove 1 hand (your choice, left or right) for stage 4-2' },
  { id: 'mn-drink',     family: 'drink',    text: 'Add a layer of clothing or drink a shot every 3 player combats' },
  { id: 'mn-forcebuy',  family: 'forcebuy', text: 'Every time you see a 1-cost in shop you must buy it, even if you have to sell units' },
  { id: 'mn-side',      family: 'position', text: 'Declare "left" or "right" at the start and only position on that side' },
];

const MAJOR = [
  { id: 'mj-augment',   family: 'augment',  text: 'No augment freedom' },
  { id: 'mj-shoplock',  family: 'shop',     text: 'Lock 1 shop space' },
  { id: 'mj-afk',       family: 'afk',      text: 'AFK for a whole stage' },
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
const ALL = [...MAJOR, ...MINOR];
const byId = (id) => ALL.find((r) => r.id === id) || null;

/* ---------- seeded randomness ----------
   Rolls are seeded so any result can be reproduced later from the seed printed
   next to it: paste the seed back in and the same restrictions come out. That
   is the whole answer to "the randomizer cheated me". */

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

/* A short, unambiguous seed token. No vowels and no look-alike glyphs, because
   these get read out loud in Discord and typed back in by hand. */
function newSeed() {
  const alphabet = '23456789CDFGHJKLMNPQRSTVWXZ';
  const bytes = new Uint32Array(8);
  (self.crypto || window.crypto).getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < 8; i++) {
    if (i === 4) out += '-';
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

/* ---------- the roll ----------
   Draws are uniform over the enabled pool and rerolled on a clash rather than
   drawn from a pre-filtered list. Same distribution either way, but this way
   the reroll count is real and can be shown: it is the tournament rule
   happening, not a footnote. */

const MAX_DRAWS = 400;

function drawOne(tier, enabled, taken, rng) {
  const options = POOL[tier].filter((r) => enabled.has(r.id));
  if (!options.length) return { error: `No ${tier} restrictions are enabled.` };

  const open = options.filter((r) => !taken.families.has(r.family));
  if (!open.length) {
    return { error: `Not enough ${tier} restrictions enabled: everything left clashes with a restriction already rolled.` };
  }

  let rerolls = 0;
  for (let i = 0; i < MAX_DRAWS; i++) {
    const pick = options[Math.floor(rng() * options.length)];
    if (taken.families.has(pick.family)) { rerolls++; continue; }
    return { pick, rerolls };
  }
  // Fallback, only reachable if the enabled pool is pathologically small.
  return { pick: open[Math.floor(rng() * open.length)], rerolls };
}

/**
 * Roll one player's restrictions.
 * @param {object} opts
 * @param {string} opts.rankId   one of RANKS[].id
 * @param {string} opts.seed     seed string; same seed + same pool = same roll
 * @param {Set<string>} [opts.enabled]  ids allowed in the draw (default: all)
 * @returns {{ ok: boolean, error?: string, rank: object, seed: string, picks: array }}
 */
function rollPlayer({ rankId, seed, enabled }) {
  const rank = RANKS.find((r) => r.id === rankId) || RANKS[0];
  const on = enabled || new Set(ALL.map((r) => r.id));
  const rng = rngFromSeed(seed);
  const taken = { families: new Set(), ids: new Set() };
  const picks = [];

  // Majors first, so a minor is always the one rerolled out of a clash.
  const plan = [...Array(rank.major).fill('major'), ...Array(rank.minor).fill('minor')];

  for (const tier of plan) {
    const res = drawOne(tier, on, taken, rng);
    if (res.error) return { ok: false, error: res.error, rank, seed, picks };
    taken.families.add(res.pick.family);
    taken.ids.add(res.pick.id);
    picks.push({ ...res.pick, tier, rerolls: res.rerolls });
  }

  return { ok: true, rank, seed, picks };
}

/**
 * Reroll a single slot in place, keeping every other pick. Used by the per-slot
 * reroll button when a restriction turns out to be impossible in that lobby.
 */
function rerollSlot(result, index, enabled, seed) {
  const on = enabled || new Set(ALL.map((r) => r.id));
  const rng = rngFromSeed(seed);
  const tier = result.picks[index].tier;
  const taken = { families: new Set(), ids: new Set() };
  result.picks.forEach((p, i) => { if (i !== index) { taken.families.add(p.family); taken.ids.add(p.id); } });

  const res = drawOne(tier, on, taken, rng);
  if (res.error) return { ok: false, error: res.error };

  const picks = result.picks.slice();
  picks[index] = { ...res.pick, tier, rerolls: res.rerolls };
  return { ok: true, picks };
}

window.TFT = { RANKS, MINOR, MAJOR, POOL, ALL, byId, newSeed, rngFromSeed, rollPlayer, rerollSlot };
