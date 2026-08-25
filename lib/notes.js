/* Turning what the detector saw into what the gamemaster reads.

   This used to live inside the proctor page, which meant the only way to find
   out what a game would actually produce was to play one and look at the
   dashboard afterwards. That is how ten augment notes for one screen reached a
   real lobby, and how every one of them came out labelled 4-2.

   The detector was only half of that. It reported an augment screen opening and
   closing, which is a fact about the picture; the rest — which stage it was,
   whether anybody's restriction cares, whether this is the third note about the
   same thing — is decided here, and none of it was testable without a live
   game. So it moved out. The proctor calls it, and `/lab` calls it over a
   recording to print the feed a gamemaster would have received.

   Two rules it follows throughout:

     - It reports what happened, not what it means. "Augment taken after 14s,
       your roll said left" and never "took the wrong augment". The two
       exceptions are the ones where the rule IS the observable event: a locked
       slot either survived the reroll or it did not, and a 1-cost either was
       still in the shop when it changed or it was not.
     - Nothing says the same thing twice. Every kind of note has a gap and a
       cap, because a game has twelve screenshots to spend and one chatty
       detector should not spend them all. */

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TFTNotes = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  /* Augments come at 2-1, 3-2 and 4-2, and the round indicator says which one
     you are looking at. This used to be a counter — the nth augment screen is
     the nth entry in this list — which works right up until the detector
     reports one screen twice, and then every note after it is wrong. A live
     lobby labelled ten notes 4-2 that way.

     The list is still here as a fallback for a capture too small to read the
     indicator, and the note says which of the two it used. */
  const STAGES = ['2-1', '3-2', '4-2'];

  /* Carousels are the stage-4 round. Nothing needs to recognise the scene:
     when the round indicator turns over to x-4, that is the carousel. */
  const CAROUSEL_ROUND = 4;

  /** Read the shop-relevant rules off a rolled set of restrictions. */
  function rulesFrom(picks, detailsOf) {
    const out = {
      lockSlot: null,
      bannedCosts: [],
      mustBuy: [],
      traitBan: false,
      builtDifferent: false,
      carousel: false,
      carouselStages: [],
      byStage: {},
    };
    (picks || []).forEach((p) => {
      const d = (detailsOf ? detailsOf(p) : p.details) || [];
      const slotOf = (label) => {
        const found = d.find((x) => x.label === label);
        const n = found && String(found.value).match(/(\d)/);
        return n ? Number(n[1]) : null;
      };
      if (p.id === 'mn-shoplock' || p.id === 'mj-shoplock') out.lockSlot = slotOf('Shop slot');
      if (p.id === 'mn-costban') out.bannedCosts = [5];
      if (p.id === 'mj-costban') out.bannedCosts = [4, 5];
      if (p.id === 'mn-forcebuy') out.mustBuy = [1];
      if (p.id === 'mj-forcebuy') out.mustBuy = [1, 2];
      if (p.id === 'mj-traitban') out.traitBan = true;
      if (p.id === 'mj-bd') out.builtDifferent = true;

      /* "Carousel pick banned for 2 stages" names which two; the major bans it
         outright. Both come down to a set of stages to watch. */
      if (p.id === 'mj-carousel') { out.carousel = true; out.carouselStages = 'all'; }
      if (p.id === 'mn-carousel') {
        out.carousel = true;
        const pair = d.find((x) => x.label === 'Stages');
        const nums = pair ? String(pair.value).match(/\d/g) : null;
        out.carouselStages = nums ? nums.map(Number) : [];
      }

      /* Which augment was rolled, keyed by the stage it governs. A game deals
         three screens and a restriction usually governs one; quoting the roll
         against all three invites an argument about the two it has nothing to
         do with. */
      const at = d.find((x) => x.label === 'At');
      const take = d.find((x) => x.label === 'Take');
      if (at && take) out.byStage[at.value] = take.value;
      d.forEach((x) => {
        if (/^(2-1|3-2|4-2)$/.test(String(x.label)) && /^(left|middle|right)$/.test(String(x.value))) {
          out.byStage[x.label] = x.value;
        }
      });
    });
    return out;
  }

  /** A notebook for one game. Feed it detector events, get notes back. */
  function createNotebook(options) {
    const opts = options || {};
    const rules = opts.rules || rulesFrom([]);
    const matchers = opts.matchers || null;
    let augmentSeen = 0;
    const seen = {};

    /* A gap and a cap per kind of note. */
    /* True to write the note, and the string 'last' for the one that trips the
       cap, so the cap can announce itself.

       A run of notes that simply stops reads as nothing further having
       happened, which is the one thing it must not mean when the truth is that
       counting stopped. Replaying a real game put exactly eight of two
       different notes on the feed — both had quietly hit their limit. */
    function allow(key, at, gap, max) {
      const s = seen[key] || (seen[key] = { n: 0, last: -1e9 });
      if (s.n > max) return false;
      if (at - s.last < gap) return false;
      s.n += 1;
      s.last = at;
      return s.n > max ? 'last' : true;
    }

    const capped = (gate) => (gate === 'last' ? ' — and that is the last of these this game' : '');

    /* Read if it can be read, counted if it cannot, and honest about which. */
    function stageNote(e) {
      const read = e && e.stage ? e.stage + '-' + e.round : null;
      const stage = read || STAGES[Math.min(STAGES.length - 1, augmentSeen)];
      const said = rules.byStage[stage];
      const where = read ? ' · ' + stage : ' · ' + stage + ' (counted, the round indicator was not readable)';
      if (!said) return where + ' · nothing rolled for this one';
      return where + ' · your roll said ' + said;
    }

    function push(e) {
      const out = [];
      const note = (kind, text) => out.push({ kind: kind, note: text, at: Math.round(e.at || 0), seconds: e.seconds || 0 });

      if (e.kind === 'still-start') note('inactive', 'Still for ' + e.seconds + 's');

      if (e.kind === 'augment-open') note('augment', 'Augment screen' + stageNote(e));

      if (e.kind === 'augment-take') {
        note('augment', 'Augment taken after ' + e.openFor + 's' + stageNote(e));
        augmentSeen += 1;
      }

      /* --- the carousel ---
         Two restrictions ban taking from it, and neither needs the scene to be
         recognised: the carousel is the stage-4 round, so the indicator turning
         over to x-4 is the cue. What happens next is a person's call, which is
         what the clip is for. */
      if (e.kind === 'stage' && e.round === CAROUSEL_ROUND && rules.carousel
        && allow('carousel', e.at, 30, 8)) {
        const banned = rules.carouselStages === 'all'
          || (rules.carouselStages || []).indexOf(e.stage) !== -1;
        if (banned) {
          note('note', 'Carousel at ' + e.stage + '-' + e.round + ', and it is one of the banned ones — the clip shows what was taken');
        }
      }

      /* A matcher that is not the augment one carries its own opinion about
         which edge is worth a note and how often. */
      if (e.kind === 'match-open' || e.kind === 'match-close') {
        const edge = e.kind === 'match-open' ? 'open' : 'close';
        const m = (matchers && matchers.byId(e.matcher)) || {};
        const wants = m.flagOn || 'both';
        if ((wants === 'both' || wants === edge)
          && allow('m:' + e.matcher + ':' + edge, e.at, m.minGap || 30, m.max || 8)) {
          const said = (m.says || {})[edge]
            || (edge === 'open' ? e.label + ' seen' : e.label + ' ended after ' + e.openFor + 's');
          const because = matchers && matchers.why ? matchers.why(e.matcher) : '';
          note('note', because ? said + ' — ' + because : said);
        }
      }

      /* --- the shop ---
         The detector says what the shop did. Whether anybody cares is decided
         by what they rolled: nobody needs telling they bought a 5-cost when
         5-costs are allowed. */
      if (e.kind === 'shop-reroll') {
        /* A locked slot is the one that survives a reroll, so this is the rule
           itself rather than a hint at it. */
        const lockGate = rules.lockSlot && (e.kept || []).indexOf(rules.lockSlot) === -1
          && allow('lock', e.at, 20, 8);
        if (lockGate) {
          note('note', 'Shop rerolled and slot ' + rules.lockSlot + ' did not hold'
            + (e.kept && e.kept.length ? ' (held: ' + e.kept.join(', ') + ')' : ' (nothing held)')
            + capped(lockGate));
        }

        /* And the shop changing is the moment a must-buy was passed up. */
        if (rules.mustBuy.length) {
          const passed = (e.wasOffered || []).filter((c) => c !== null && rules.mustBuy.indexOf(c) !== -1);
          const buyGate = passed.length && allow('forcebuy', e.at, 20, 8);
          if (buyGate) {
            /* Joining them naively produced "a 1 and a 1 and a 1 and a 1-cost"
               on real footage. Count them instead. */
            const counts = {};
            passed.forEach((c) => { counts[c] = (counts[c] || 0) + 1; });
            const said = Object.keys(counts).sort().map((c) => (counts[c] === 1
              ? 'a ' + c + '-cost'
              : counts[c] + ' ' + c + '-costs')).join(' and ');
            note('note', 'Shop changed with ' + said + ' still in it' + capped(buyGate));
          }
        }
      }

      if (e.kind === 'shop-buy') {
        /* The ban lifts at stage 5, and the round indicator says whether it
           has. Before this the note had to end "check the stage" and leave the
           actual question to whoever read it. */
        const lifted = e.stage !== undefined && e.stage !== null && e.stage >= 5;
        const banGate = e.cost !== null && rules.bannedCosts.indexOf(e.cost) !== -1
          && !lifted && allow('costban', e.at, 20, 8);
        if (banGate) {
          const where = e.stage ? ' at ' + e.stage + '-' + e.round : ' (stage unreadable)';
          note('note', 'Bought a ' + e.cost + '-cost from slot ' + e.slot + where
            + ', and the ban runs until stage 5' + capped(banGate));
        }
      }

      const traitGate = e.kind === 'traits-up' && (rules.traitBan || rules.builtDifferent)
        && allow('traits', e.at, 20, 8);
      if (traitGate) {
        note('note', 'Traits went from ' + e.was + ' to ' + e.count
          + ' active — the shot says which' + capped(traitGate));
      }

      return out;
    }

    return {
      push: push,
      rules: rules,
      stages: () => augmentSeen,
    };
  }

  return { STAGES: STAGES, rulesFrom: rulesFrom, createNotebook: createNotebook };
});
