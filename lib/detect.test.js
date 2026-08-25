/* What the detector's state machine is checked against.

   This one exists because of a live lobby. The augment matcher had been scored
   on hours of footage and got three screens out of three every time — sampled
   once a second. The proctor samples twice a second, and for players whose
   capture put the match score near the threshold rather than far above it, one
   second under the line ended the screen and the next sample started a new one.
   One augment decision arrived as ten notes: open, taken after 1s, open, taken
   after 4s, open, taken after 8s.

   Nothing about that is visible in a frame. It is the timing rule, and the way
   to test a timing rule is to feed it a sequence and count what comes out — so
   the matcher's score is replaced here with a scripted one, and the frames are
   irrelevant. The sequences below are written in seconds at the rate the live
   page actually samples, because sampling at a different rate from production
   is what hid this in the first place.

   node lib/detect.test.js */

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TFTDetectTest = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  /* Looked up when the test runs rather than when this file loads. The lab page
     loads detect.js after the test files, so grabbing the reference at load time
     captures nothing and the whole suite dies on a null. */
  const dep = (name, path) => (typeof window !== 'undefined' && window[name])
    || (typeof require === 'function' ? require(path) : null);

  const STEP = 0.5;   // what the proctor actually uses
  const FRAME = { width: 16, height: 16, data: new Uint8ClampedArray(16 * 16 * 4) };

  /* Replay a list of [seconds, score] stretches through the detector and
     collect the augment events. */
  function play(script) {
    const D = dep('TFTDetect', './detect.js');
    const M = dep('TFTMatchers', './matchers.js');
    const real = M.score;
    let now = 0;
    M.score = function (frame, matcher) {
      if (matcher.id !== 'augment') return 0;
      let t = 0;
      for (let i = 0; i < script.length; i++) {
        t += script[i][0];
        if (now < t) return script[i][1];
      }
      return 0;
    };

    try {
      const det = D.createDetector({ detectStill: false, detectAugments: true });
      const out = [];
      let total = 0;
      script.forEach((s) => { total += s[0]; });
      for (now = 0; now < total; now += STEP) {
        det.push(FRAME, now).forEach((e) => {
          if (e.kind === 'augment-open' || e.kind === 'augment-take') {
            out.push({ kind: e.kind, at: now, openFor: e.openFor });
          }
        });
      }
      return out;
    } finally {
      M.score = real;
    }
  }

  const opens = (evts) => evts.filter((e) => e.kind === 'augment-open').length;
  const takes = (evts) => evts.filter((e) => e.kind === 'augment-take').length;

  function run(log) {
    const say = log || function (s) { console.log(s); };
    let pass = 0;
    let fail = 0;
    function is(name, got, want) {
      const ok = got === want;
      if (ok) pass++; else fail++;
      say((ok ? '  ok   ' : '  FAIL ') + name + (ok ? '' : '  (got ' + got + ', wanted ' + want + ')'));
    }

    say('one augment screen, seen clearly');
    const clean = play([[30, 0.05], [20, 0.96], [60, 0.05]]);
    is('opens once', opens(clean), 1);
    is('closes once', takes(clean), 1);
    is('and reports about how long it was up', Math.abs((clean[1] || {}).openFor - 20) <= 2, true);

    /* The live failure. A score sitting near the line, dipping under for a
       second at a time, is one screen — not five. */
    say('one screen, with a score hovering on the threshold');
    const flapScript = [[30, 0.05]];
    for (let i = 0; i < 6; i++) { flapScript.push([3, 0.75]); flapScript.push([1, 0.4]); }
    flapScript.push([60, 0.05]);
    const flap = play(flapScript);
    is('still opens once', opens(flap), 1);
    is('still closes once', takes(flap), 1);

    say('a dip long enough to be real is still one screen');
    const dip = play([[30, 0.05], [10, 0.9], [1.5, 0.3], [10, 0.9], [60, 0.05]]);
    is('opens once', opens(dip), 1);
    is('closes once', takes(dip), 1);

    say('three screens, stages apart');
    const three = play([
      [30, 0.05], [20, 0.95], [200, 0.05],
      [20, 0.95], [200, 0.05],
      [20, 0.95], [60, 0.05],
    ]);
    is('opens three times', opens(three), 3);
    is('closes three times', takes(three), 3);

    /* The cooldown must not swallow a genuine second screen. */
    say('two screens separated by more than the cooldown');
    const two = play([[30, 0.05], [15, 0.95], [90, 0.05], [15, 0.95], [60, 0.05]]);
    is('opens twice', opens(two), 2);
    is('closes twice', takes(two), 2);

    say('nothing at all');
    const none = play([[120, 0.05]]);
    is('reports nothing', none.length, 0);

    say('a score that never reaches the line');
    const low = play([[30, 0.05], [40, 0.5], [30, 0.05]]);
    is('reports nothing', low.length, 0);

    /* The econ rule asks what gold was when a round ENDED. Reading gold and
       then snapshotting it in the same tick captured the new round's income
       instead — a round that ended on 30 was reported as 35. */
    say('what gold a round ended on');
    const D2 = dep('TFTDetect', './detect.js');
    const FRAME2 = { width: 16, height: 16, data: new Uint8ClampedArray(16 * 16 * 4) };
    function rounds(script) {
      const det = D2.createDetector({ detectStill: false, detectAugments: false, watchStage: true });
      const seen = [];
      let t = 0;
      script.forEach((x) => {
        det.push(FRAME2, t, { stage: x.s, round: x.r, gold: x.g }).forEach((e) => {
          if (e.kind === 'stage') seen.push(e);
        });
        t += 0.5;
      });
      return seen;
    }
    const turns = rounds([
      { s: 3, r: 2, g: 53 }, { s: 3, r: 2, g: 50 }, { s: 3, r: 2, g: 46 },
      { s: 3, r: 2, g: 39 }, { s: 3, r: 2, g: 30 },
      { s: 3, r: 3, g: 35 }, { s: 3, r: 3, g: 35 }, { s: 3, r: 3, g: 35 },
      { s: 3, r: 4, g: 12 }, { s: 3, r: 4, g: 12 }, { s: 3, r: 4, g: 12 },
    ]);
    is('the first round seen has nothing before it', turns[0] && turns[0].endedWith, null);
    is('a round that ended on 30 reports 30, not the income that followed',
      turns[1] && turns[1].endedWith, 30);
    is('and the next one reports its own last value', turns[2] && turns[2].endedWith, 35);


    /* The cooldown that keeps one flickering augment screen from arriving as
       five is sixty seconds, and it used to apply to every matcher. That is an
       augment fact — real augments are stages apart — and it is wrong for a
       matcher whose thing genuinely recurs.

       Gold reaching 0 is one of those. A player told to roll to 0 at 4-2 who
       also rolled down in 4-1 put gold-zero inside its own cooldown, so the 0
       they reached in 4-2 never raised an event; the 4-2 rule is answered with
       those events, so it reported them for not doing what they had just done.
       Rounds are about thirty-five seconds, so the compliant case is the one
       that lands inside the minute — this fired on obedience more often than on
       a breach. */
    say('a zero in one round does not hide the zero in the next');
    const M3 = dep('TFTMatchers', './matchers.js');
    function zeros(windows, seconds) {
      const det = D2.createDetector({ detectStill: false, detectAugments: true });
      const real3 = M3.score;
      const seen = [];
      let t = 0;
      M3.score = function (frame, m) {
        return m.id === 'gold-zero'
          && windows.some((w) => t >= w[0] && t < w[1]) ? 1 : 0;
      };
      try {
        for (t = 0; t < seconds; t += STEP) {
          /* gold-zero reads a native crop, not the analysis frame. */
          det.push(FRAME2, t, { crop: () => FRAME2 }).forEach((e) => {
            if (e.kind === 'match-open' && e.matcher === 'gold-zero') seen.push(e.at);
          });
        }
      } finally {
        M3.score = real3;
      }
      return seen;
    }
    /* 4-1 ends around 35s, so these two zeros are 25s apart — well inside the
       sixty that used to swallow the second one. */
    is('both zeros are seen, not just the first', zeros([[20, 26], [45, 51]], 105).length, 2);
    is('one long zero is still one zero', zeros([[20, 40]], 105).length, 1);
    is('no zero is no zero', zeros([], 105).length, 0);

    /* And the augment keeps the cooldown it was written for: a second screen
       half a minute after the first is the same one still being looked at. */
    say('the augment cooldown still holds');
    const near = play([[30, 0.05], [15, 0.95], [30, 0.05], [15, 0.95], [60, 0.05]]);
    is('two sightings inside the cooldown are one screen', opens(near), 1);

    say(pass + ' passed, ' + fail + ' failed');
    return { pass: pass, fail: fail };
  }

  return { run: run, play: play };
});

if (typeof module === 'object' && module.exports && typeof require === 'function' && require.main === module) {
  const r = module.exports.run();
  process.exit(r.fail ? 1 : 0);
}
