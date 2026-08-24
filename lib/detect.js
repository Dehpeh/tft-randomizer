/* The detector, extracted so it could be measured — and then measured, twice,
   because the first version was wrong.

   TESTED AGAINST 4h21m OF REAL FOOTAGE, one player's stream across seven games.

   AUGMENT SCREENS — works.
     First attempt looked for a large sudden change in the middle of the screen.
     That found 65 "augment screens" in fifteen minutes where there were two:
     combat, spectating another board, a camera move and a team-planner overlay
     all look the same to it. The signal was wrong, not mistuned.

     What actually marks the screen is that it says "Choose One", in the same
     place, in the same font, every time. Matching that text scores 0.95-1.00 on
     real augment screens and never above 0.36 on anything else. Across four
     games it found every augment decision — three per game, at 2-1, 3-2 and
     4-2 — with nothing false in between. A player rerolling a card re-renders
     the screen and shows up as two detections seconds apart; that is one
     decision, not two.

   WHICH CARD WAS TAKEN — does not work, and is not attempted.
     Motion across the three cards at the moment of choosing measured 33/33/33
     on every real augment: there is nothing in the pixels to read. So the
     detector says when, never which, and a screenshot goes to a human.

   STILLNESS — off, because it measures the wrong thing.
     Zero false positives in fifteen minutes of play, which reads well until you
     see why: median frame-to-frame motion while playing was 8.6 against a
     threshold of 2.4, and that motion is the game animating, not the player
     acting. TFT never holds still, so a player doing nothing still produces a
     moving screen. Catching AFK needs the parts that only move on input — the
     shop row, the gold counter, the bench — and that is not built.

   Everything here is measurable at /lab, which replays a recording through this
   exact file. Nothing below should be believed because it sounds reasonable. */

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TFTDetect = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  /* What to look for lives in matchers.js; how to watch for it lives here. */
  const M = (typeof window !== 'undefined' && window.TFTMatchers)
    || (typeof require === 'function' ? require('./matchers.js') : null);
  const SHOP = (typeof window !== 'undefined' && window.TFTShop)
    || (typeof require === 'function' ? require('./shop.js') : null);
  const FEAT = (typeof window !== 'undefined' && window.TFTFeatures)
    || (typeof require === 'function' ? require('./features.js') : null);

  /* Defaults, all overridable so the replay page can sweep them and find where
     they should actually sit for real footage. */
  const DEFAULTS = {
    motionThreshold: 2.4,   // mean channel difference that counts as "something moved"
    stillSeconds: 20,       // how long nothing may change before it is worth a note
    augmentSpike: 14,       // a modal opening dwarfs ordinary play
    augmentMinOpen: 3,      // an overlay is up at least this long before it can close
    dominantShare: 0.45,    // one third must own this much of the motion to be named
    closeFraction: 0.5,     // the overlay is gone once the band has moved this much of the opening jump
    augmentMaxOpen: 75,     // no augment screen outlives this; never stay stuck open
    region: { x: 0.08, y: 0.05, w: 0.84, h: 0.60 },

    /* Off until they are rebuilt on content rather than motion. The lab turns
       them on explicitly; the live page does not. */
    detectStill: false,      // still measures the screen, not the player — see the header
    detectAugments: true,    // every calibrated matcher in lib/matchers.js
    augmentMatch: 0.6,       // real screens scored 0.95-1.00, everything else under 0.36
    augmentHold: 2,          // samples above the line before a sighting counts

    /* Closing is not the mirror of opening, and treating it as one put ten
       augment notes on one screen in a live lobby.

       On the footage this was built from, a real augment screen scores 0.93-0.99
       solidly and closing after two samples is fine. In the lobby, players whose
       capture differs — a whole screen rather than the game window, a different
       aspect, a different scale — score near the line instead of far above it,
       and a score that hovers around 0.6 crosses it constantly. At two samples
       and 500ms each, one second under the line ends the screen, and the next
       sample starts a new one: open, take after 1s, open, take after 4s.

       So closing takes eight samples, four seconds, because an augment screen
       does not blink out for four seconds. And once one has been taken, the next
       sixty seconds cannot contain another — real augments are stages apart, so
       anything sooner is the same screen still being looked at. Both are about
       what the game does, not about what any particular capture looks like,
       which is why they hold for players whose score never gets near 0.9. */
    augmentCloseHold: 8,     // samples below the line before the screen is over
    augmentCooldown: 60,     // seconds after a take before another can be reported

    /* The shop is not a matcher — it is five things changing over time, and what
       matters is which of them changed together. Six restrictions read off it.
       Off by default like everything unscored. */
    watchShop: false,
    watchTraits: false,      // how many trait hexagons are lit, for the ban rule
    traitRegion: { x: 0.030, y: 0.20, w: 0.028, h: 0.45 },
  };

  /* Mean absolute difference over a coarse sample. Coarse on purpose: the
     question is "did anything happen here", and every fourth pixel answers it
     for a quarter of the work. */
  function diff(a, b, region) {
    const w = b.width;
    const h = b.height;
    const x0 = region ? Math.max(0, Math.floor(region.x * w)) : 0;
    const y0 = region ? Math.max(0, Math.floor(region.y * h)) : 0;
    const x1 = region ? Math.min(w, Math.ceil((region.x + region.w) * w)) : w;
    const y1 = region ? Math.min(h, Math.ceil((region.y + region.h) * h)) : h;

    let total = 0;
    let count = 0;
    for (let y = y0; y < y1; y += 2) {
      for (let x = x0; x < x1; x += 2) {
        const i = (y * w + x) * 4;
        total += Math.abs(a.data[i] - b.data[i])
          + Math.abs(a.data[i + 1] - b.data[i + 1])
          + Math.abs(a.data[i + 2] - b.data[i + 2]);
        count += 3;
      }
    }
    return count ? total / count : 0;
  }


  /* ---------- the augment screen, by what is on it ----------
     Motion could not do this: 65 false positives in fifteen minutes, because a
     big change in the middle of the screen describes combat, a camera move, a
     team planner and a stream overlay just as well as an augment.

     What actually distinguishes the augment screen is that it says "Choose
     One", in the same place, in the same font, every single time. This is that
     text as a normalised template, averaged over five real occurrences so it is
     not one compression artefact, and matched by normalised cross-correlation.
     On four hours of real footage that scored 0.95-1.00 on augment screens and
     never above 0.36 on anything else — a gap wide enough that the threshold
     hardly matters.

     Storing a picture in source is unusual, so: it is 64x14 grey levels, mean
     removed and scaled to signed bytes, which is 900 bytes of base64. Cheap
     enough to keep beside the code that uses it, and replaceable from your own
     footage in the lab if a patch ever restyles the text. */
  const TEXT_BOX = { x: 0.40, y: 0.16, w: 0.20, h: 0.08 };
  const TEXT_W = 64;
  const TEXT_H = 14;
  const TEXT_B64 = '6+3s6uvq6urp6urq6erq6uvq6enp7PPo6vXx9vf17vTy7vbx8fbw8//6+ejo6Ofm5uXl5ebm5uXl5ebm5+jo6PPz9PPz8vLx8fDv7+/v7u7u7u7u7Ozr6+rr7Ovs7e3u7u/v7+/u7+/8+/Xu7u7u7u7u7u3s7O3t7e3u7u/w7+/19PT19fX19fX19PT08/P08/Pz8/Py8vLy8vPz9PX19fX19fX09PPy8fHx8fHx8fLx8fHx8PDw8PDw8PHx8PDw9fX19vb29vf29/f29PT09vj4+Pj3+Pj5+fv8/v4AAgD//wD//vz8+vj39vb29vb19PTz8/Pz8vLx8PDw8fDw8Pf39/n7/wEDAgMDBQUFBQUFBQQGBQgKCgoMDg4ODg4MDQ4PDw4NDAkFBAQFBAMEBAQDBAMDAQEAAP78+fXz8vL5+Pj5+fr6+/v6+vr6+RlZYyFTDvj9////AAEEBQoNDg8PCwYDAQpQZT35+vj6+vv7+ff39/f39/b19PX29fX0+fn5+vr6+vn5+fn4+Qh5BQIQbSQc8/snE/f9KRn/GzcSEjED+vlnIftkMgMXKfv3IxDz9fX19fb19fT19fb29fr6+fr6+vr5+fn5+fgxWvT29Ww/eAtgLnAeYCxuIHEtFmotWfX+f/P2KlxNWF4rRDppAPX09fX19fX19fb39vb7+/v6+fj49/f3+Pj5K2r39fpuB2MXevU6Onj2Ozo6cyF8NS31+34F9jVFQCo3MWVFOwL29vX29/b29vb39/j3+/n5+Pf29vb09PT19PloXVQqchJqHl1LbQtbTGoQSV0lbEku9/c7cUZo+0ooOTYyZj4C9/j39/f39/b3+fn5+Pj29vb19fX08vHx8fHx8RAL9woBCgL+Ev3x9A/48QkM7/cQ9vj4+AoU9fb78vTy7Qj87/Hx8vPz9PP09vj5+fj19fX19PTz8vHw8PDw7+70+/39/f7++efk5+rr7O7u7Orr8fn6+vn6+fjv5+fl5fPk4+Xq7e7t7Ovo6vP39/j58vPy8fDw7+/u7u7u7u3s7fr9/v7//vTl6Ovv8PDv7Ovs8/f5+vv7+/r16efm5fHx4OXn6+/v7Onn6PD09ff39/Dw7+7t7ezq6+vr7O3r6er5/f7///7v8/b4+/fy8Orq7/T3+vv8/Pv37ejl5O347u308/n48u7p6PDy8/Xy8fE=';

  /* Decoded once, lazily: a browser gets it from atob, node from Buffer. */
  let TEXT_TEMPLATE = null;
  function template() {
    if (TEXT_TEMPLATE) return TEXT_TEMPLATE;
    let bytes;
    if (typeof atob === 'function') {
      const raw = atob(TEXT_B64);
      bytes = new Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    } else {
      bytes = Array.from(Buffer.from(TEXT_B64, 'base64'));
    }
    const signed = bytes.map((b) => (b > 127 ? b - 256 : b));
    const norm = Math.sqrt(signed.reduce((a, b) => a + b * b, 0)) || 1;
    TEXT_TEMPLATE = signed.map((b) => b / norm);
    return TEXT_TEMPLATE;
  }

  /* How much this frame looks like an augment screen: -1 to 1. Kept as its own
     name because the self test and the lab both ask for it directly. */
  function augmentScore(frame) {
    if (M) return M.score(frame, M.byId('augment'));
    return augmentScoreLegacy(frame);
  }

  function augmentScoreLegacy(frame) {
    const W = frame.width;
    const H = frame.height;
    const x0 = Math.round(TEXT_BOX.x * W);
    const y0 = Math.round(TEXT_BOX.y * H);
    const bw = Math.round(TEXT_BOX.w * W);
    const bh = Math.round(TEXT_BOX.h * H);
    if (bw < 8 || bh < 4) return 0;

    /* The crop is resampled to the template's size, so the same template works
       at 720p, 1080p or a 640-wide stream copy. */
    const grey = new Array(TEXT_W * TEXT_H);
    for (let ty = 0; ty < TEXT_H; ty++) {
      const sy = Math.min(H - 1, y0 + Math.floor((ty * bh) / TEXT_H));
      for (let tx = 0; tx < TEXT_W; tx++) {
        const sx = Math.min(W - 1, x0 + Math.floor((tx * bw) / TEXT_W));
        const i = (sy * W + sx) * 4;
        grey[ty * TEXT_W + tx] = 0.299 * frame.data[i] + 0.587 * frame.data[i + 1] + 0.114 * frame.data[i + 2];
      }
    }
    let mean = 0;
    for (let i = 0; i < grey.length; i++) mean += grey[i];
    mean /= grey.length;
    let norm = 0;
    for (let i = 0; i < grey.length; i++) { grey[i] -= mean; norm += grey[i] * grey[i]; }
    norm = Math.sqrt(norm) || 1;

    const tpl = template();
    let dot = 0;
    for (let i = 0; i < grey.length; i++) dot += (grey[i] / norm) * tpl[i];
    return dot;
  }

  const THIRDS = ['left', 'middle', 'right'];

  function thirdsOf(a, b, region) {
    const w = region.w / 3;
    return [0, 1, 2].map((i) => diff(a, b, { x: region.x + i * w, y: region.y, w: w, h: region.h }));
  }

  /**
   * A detector instance. Feed it frames in time order; it hands back events.
   *
   *   push(imageData, seconds) -> [{ kind, at, ... }]
   *
   * kinds:
   *   'still-start'  a spell of no change has passed stillSeconds
   *   'still-end'    that spell ended; carries its final length
   *   'augment-open' the overlay appeared
   *   'augment-take' it closed; carries which third moved most, and how clearly
   */
  function createDetector(options) {
    const cfg = Object.assign({}, DEFAULTS, options || {});
    let prev = null;
    let stillSince = null;
    let stillReported = false;
    let inAugment = false;
    let augmentSince = 0;
    let thirds = [0, 0, 0];
    let thirdsBefore = [0, 0, 0];
    /* One little state machine per calibrated matcher, keyed by its id, so
       adding a fifth thing to watch for is a template rather than a branch. */
    const watch = {};
    let lastScore = 0;

    /* The shop keeps its own history, because its events are about change over
       time rather than about this frame, and the trait count needs a previous
       count to notice it went up. */
    const shopTrack = SHOP && cfg.watchShop ? SHOP.tracker() : null;
    let litBefore = null;
    let litRun = 0;
    let litSettled = null;

    function slot(id) {
      if (!watch[id]) watch[id] = { on: false, above: 0, below: 0, since: 0, score: 0, done: 0, doneSince: 0, silent: false, lastHit: 0 };
      return watch[id];
    }

    function reset() {
      prev = null;
      stillSince = null;
      stillReported = false;
      inAugment = false;
      thirds = [0, 0, 0];
      thirdsBefore = [0, 0, 0];
      Object.keys(watch).forEach((k) => delete watch[k]);
      lastScore = 0;
    }

    function push(frame, at) {
      const events = [];
      if (!prev) { prev = frame; return events; }

      const whole = diff(prev, frame, null);
      const band = diff(prev, frame, cfg.region);

      /* Per-third motion accumulates across the whole overlay. The running
         total from BEFORE this frame is kept too, because the frame that closes
         the overlay repaints the entire band and has to be excluded. */
      if (inAugment) {
        const t = thirdsOf(prev, frame, cfg.region);
        thirdsBefore = thirds.slice();
        thirds = [thirds[0] + t[0], thirds[1] + t[1], thirds[2] + t[2]];
      }
      prev = frame;

      /* --- stillness ---
         The one measurement that needs no knowledge of TFT whatsoever: either
         the picture changed or it did not. */
      if (cfg.detectStill && whole < cfg.motionThreshold) {
        if (stillSince === null) { stillSince = at; stillReported = false; }
        const held = at - stillSince;
        if (held >= cfg.stillSeconds && !stillReported) {
          stillReported = true;
          events.push({ kind: 'still-start', at: at, seconds: Math.round(held) });
        }
      } else if (cfg.detectStill) {
        if (stillSince !== null && stillReported) {
          events.push({ kind: 'still-end', at: at, seconds: Math.round(at - stillSince), startedAt: Math.round(stillSince) });
        }
        stillSince = null;
      }

      /* --- everything the matchers look for ---
         Each calibrated matcher is scored on this frame and gets two samples of
         hysteresis in each direction, so one mangled frame cannot invent or end
         a sighting. An uncalibrated matcher has no template and is skipped
         entirely, which is why the proctor watches one thing today and will
         watch more the moment someone captures the rest. */
      if (cfg.detectAugments && M) {
        M.enabled().forEach((m) => {
          const st = slot(m.id);
          const s = M.score(frame, m);
          st.score = s;
          if (m.id === 'augment') lastScore = s;
          const hit = m.absent ? s < (m.threshold || cfg.augmentMatch) : s >= (m.threshold || cfg.augmentMatch);

          if (hit) st.lastHit = at;

          if (!st.on) {
            st.above = hit ? st.above + 1 : 0;
            /* Still inside the cooldown from the last one: this is the same
               screen flickering, not a new decision. Keep it quiet, and keep the
               clock running so a genuinely long screen is not cut in two. */
            if (st.above >= cfg.augmentHold && st.done && (at - st.done) < cfg.augmentCooldown) {
              st.above = 0;
              st.on = true;
              st.since = st.doneSince || at;
              st.silent = true;
            } else if (st.above >= cfg.augmentHold) {
              st.on = true;
              st.since = at;
              st.above = 0;
              st.below = 0;
              events.push({
                kind: m.id === 'augment' ? 'augment-open' : 'match-open',
                matcher: m.id, label: m.label, at: at, score: +s.toFixed(2),
              });
            }
          } else {
            st.below = hit ? 0 : st.below + 1;
            if (st.below >= (cfg.augmentCloseHold || cfg.augmentHold)) {
              st.on = false;
              st.below = 0;
              st.done = at;
              st.doneSince = st.since;
              if (st.silent) { st.silent = false; return; }
              events.push({
                kind: m.id === 'augment' ? 'augment-take' : 'match-close',
                matcher: m.id, label: m.label, at: at,
                /* The screen was over when it was last seen, not four
                   seconds later when the detector accepted that it was gone.
                   Reporting the wait as part of the decision would put four
                   seconds of thinking time on every augment that never
                   happened. */
                openFor: Math.max(0, Math.round((st.lastHit || at) - st.since)),
                /* Never guessed for augments: motion across the three cards at
                   the moment of choosing measured 33/33/33 on real footage. */
                third: null, share: 0,
              });
            }
          }
        });
      }

      /* --- the shop row ---
         Six restrictions live down here, and not one of them is a picture. A
         reroll replaces every unlocked card at once; a purchase empties exactly
         one slot and leaves the rest alone; the locked slot is whatever survives
         a reroll. The tracker is the part that refuses to answer while the shop
         is mid-transition, dimmed through combat, or replaced by the sell bar
         that appears while a unit is being dragged — which, left unguarded,
         invented sixteen rerolls in two minutes of the reference footage. */
      if (shopTrack && SHOP) {
        shopTrack.push(SHOP.read(frame, cfg.shopLayout), at).forEach((e) => {
          if (e.kind === 'buy') {
            events.push({ kind: 'shop-buy', at: at, slot: e.slot, cost: e.cost });
          } else {
            events.push({
              kind: 'shop-reroll', at: at,
              kept: e.kept, offered: e.offered, wasOffered: e.wasOffered,
            });
          }
        });
      }

      /* --- how many traits are lit ---
         This was built for the banned-trait rule, on the idea that noticing the
         count go up is enough and the screenshot says which trait it was. It
         produced 143 activations in one game.

         Most of that was the colour rule, which is fixed. What is not fixed is
         that the count over-runs the bottom of the panel, so it still drifts by
         a trait or two between frames, and a rule that fires on any increase
         fires on drift. An increase is only evidence if the count is exact.

         So it stays off, and the banned-trait restriction is a human's job: the
         panel names the trait in plain text, and the clip button captures it.
         See DECISIONS.md. */
      if (cfg.watchTraits && FEAT) {
        const lit = FEAT.litTraits(frame, cfg.traitRegion).count;

        /* The count has to have settled before a rise off it means anything.
           When the panel first fades in it climbs 0, 1, 2 over consecutive
           frames, and reporting that as two activations is the panel appearing,
           not the player doing something. Two samples at the same count is
           enough to tell the two apart. */
        if (lit === litBefore) {
          litRun++;
          if (litRun === 2) litSettled = lit;
        } else {
          if (litSettled !== null && lit > litSettled && litRun >= 2) {
            events.push({ kind: 'traits-up', at: at, count: lit, was: litSettled });
            litSettled = null;
          }
          litRun = 0;
        }
        litBefore = lit;
      }

      return events;
    }

    return { push: push, reset: reset, config: cfg, motionAt: () => prev, score: () => lastScore };
  }

  /* ---------- scoring ----------
     Given what a detector produced and what a human says actually happened,
     the numbers that matter. Deliberately strict: a detection only counts if it
     lands within the tolerance AND names the right card. */
  function score(detected, truth, toleranceSeconds) {
    const tol = toleranceSeconds || 3;
    const takes = detected.filter((e) => e.kind === 'augment-take');
    const used = new Set();

    let correct = 0;
    let wrongThird = 0;
    let unsure = 0;

    truth.forEach((t) => {
      const hit = takes.find((d, i) => !used.has(i) && Math.abs(d.at - t.at) <= tol);
      if (!hit) return;
      used.add(takes.indexOf(hit));
      if (hit.third === null) unsure += 1;
      else if (hit.third === t.third) correct += 1;
      else wrongThird += 1;
    });

    const matched = correct + wrongThird + unsure;
    return {
      truthCount: truth.length,
      detectedCount: takes.length,
      missed: truth.length - matched,          // an augment screen it never noticed
      spurious: takes.length - matched,        // a detection with no augment behind it
      correct: correct,
      wrongThird: wrongThird,                  // the dangerous one: confidently wrong
      unsure: unsure,                          // honest about not knowing
      recall: truth.length ? matched / truth.length : null,
      accuracy: matched ? correct / matched : null,
    };
  }

  return {
    DEFAULTS: DEFAULTS,
    THIRDS: THIRDS,
    diff: diff,
    thirdsOf: thirdsOf,
    createDetector: createDetector,
    augmentScore: augmentScore,
    score: score,
  };
});
