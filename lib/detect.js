/* The detector, extracted so it can be measured.

   This file is the whole of what the proctor "knows". It takes frames and
   returns events; it has no idea whether those frames came from a live screen
   share or an mp4 being replayed at eight times speed. That is the point: the
   thing under test on the replay page is byte-for-byte the thing that runs
   during a tournament, so a score measured there means something.

   It is deliberately dumb. No machine learning, no template library, no model
   to drift. Two measurements — how much changed, and where — fed to two small
   state machines. Dumb is what makes it auditable: every decision below can be
   read off in a paragraph and argued with. */

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TFTDetect = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  /* Defaults, all overridable so the replay page can sweep them and find where
     they should actually sit for real footage. */
  const DEFAULTS = {
    motionThreshold: 2.4,   // mean channel difference that counts as "something moved"
    stillSeconds: 20,       // how long nothing may change before it is worth a note
    augmentSpike: 14,       // a modal opening dwarfs ordinary play
    augmentMinOpen: 3,      // an overlay is up at least this long before it can close
    dominantShare: 0.45,    // one third must own this much of the motion to be named
    closeRatio: 0.8,        // the band is 'back to the board' at this much of its distance from the overlay
    region: { x: 0.08, y: 0.05, w: 0.84, h: 0.60 },
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
    let baseFrame = null;   // the board before the overlay
    let refFrame = null;    // the overlay itself, once settled
    let closingFor = 0;

    function reset() {
      prev = null;
      stillSince = null;
      stillReported = false;
      inAugment = false;
      thirds = [0, 0, 0];
      thirdsBefore = [0, 0, 0];
      baseFrame = null;
      refFrame = null;
      closingFor = 0;
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
      const before = prev;
      prev = frame;

      /* --- stillness ---
         The one measurement that needs no knowledge of TFT whatsoever: either
         the picture changed or it did not. */
      if (whole < cfg.motionThreshold) {
        if (stillSince === null) { stillSince = at; stillReported = false; }
        const held = at - stillSince;
        if (held >= cfg.stillSeconds && !stillReported) {
          stillReported = true;
          events.push({ kind: 'still-start', at: at, seconds: Math.round(held) });
        }
      } else {
        if (stillSince !== null && stillReported) {
          events.push({ kind: 'still-end', at: at, seconds: Math.round(at - stillSince), startedAt: Math.round(stillSince) });
        }
        stillSince = null;
      }

      /* --- the augment overlay ---
         Opening is a large sudden change in the band. Closing is NOT just
         "another large change": a card animating under the cursor is also a
         large change, and telling those apart by size alone fails — the first
         version of this fired three times per augment and could never name a
         card, which is exactly what the self test caught.

         So closing is decided by resemblance instead. Two reference frames are
         kept: the board as it looked before the overlay, and the overlay itself
         just after it appeared. Every frame after that is compared to both, and
         the overlay is over when the picture looks more like the board again.
         A card lighting up barely moves that comparison; the overlay vanishing
         moves it completely. */
      if (!inAugment && band > cfg.augmentSpike) {
        inAugment = true;
        augmentSince = at;
        thirds = [0, 0, 0];
        thirdsBefore = [0, 0, 0];
        baseFrame = before;   // the board, before the overlay covered it
        refFrame = null;      // filled on the next frame, once the overlay has settled
        closingFor = 0;
        events.push({ kind: 'augment-open', at: at, band: band });
      } else if (inAugment) {
        if (!refFrame) refFrame = frame;

        const toRef = diff(frame, refFrame, cfg.region);
        const toBase = diff(frame, baseFrame, cfg.region);
        const backToBoard = toBase < toRef * cfg.closeRatio;

        closingFor = backToBoard ? closingFor + 1 : 0;

        if (closingFor >= 2 && at - augmentSince > cfg.augmentMinOpen) {
          inAugment = false;
          /* Score the sums from before this frame: the closing transition
             repaints the whole band and would drown the one card that moved. */
          const sums = thirdsBefore;
          const total = sums.reduce((a, b) => a + b, 0);
          const top = sums.indexOf(Math.max.apply(null, sums));
          const share = total ? sums[top] / total : 0;
          events.push({
            kind: 'augment-take',
            at: at,
            third: share >= cfg.dominantShare ? THIRDS[top] : null,
            share: share,
            openFor: Math.round(at - augmentSince),
          });
        }
      }

      return events;
    }

    return { push: push, reset: reset, config: cfg, motionAt: () => prev };
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
    score: score,
  };
});
