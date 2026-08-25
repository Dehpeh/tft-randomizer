/* Detectors that need no picture of the thing.

   Template matching is the strongest tool here — it is what made the augment
   screen work — but it has one cost: somebody has to capture the template on the
   hardware it will run on. That is a person, a game, and a moment lining up.

   Some of these restrictions do not need it. "Is the gold counter a single zero"
   is a question about shape: one glyph, with a hole in the middle. "Is any trait
   active" is a question about colour: active hexagons are saturated, inactive
   ones are grey. Those can be computed from first principles on any resolution
   with no calibration at all.

   Which is not the same as saying they work. They are written from the geometry
   of what is on screen, tested against shapes drawn on a canvas, and completely
   untested against real TFT — the same position the motion detector was in right
   before real footage destroyed it. So they ship off, and /lab scores them on a
   recording before anyone believes them. The difference from last time is that
   testing one is now a click rather than a build. */

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TFTFeatures = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  /* ---------- shared plumbing ---------- */

  /** Pull a region out as {w, h, lum[], sat[], val[]}. */
  function sample(frame, region) {
    const W = frame.width;
    const H = frame.height;
    const x0 = Math.max(0, Math.round(region.x * W));
    const y0 = Math.max(0, Math.round(region.y * H));
    const w = Math.max(1, Math.min(W - x0, Math.round(region.w * W)));
    const h = Math.max(1, Math.min(H - y0, Math.round(region.h * H)));

    const lum = new Float32Array(w * h);
    const sat = new Float32Array(w * h);
    const hue = new Float32Array(w * h);

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = ((y0 + y) * W + (x0 + x)) * 4;
        const r = frame.data[i];
        const g = frame.data[i + 1];
        const b = frame.data[i + 2];
        const mx = Math.max(r, g, b);
        const mn = Math.min(r, g, b);
        const k = y * w + x;
        lum[k] = 0.299 * r + 0.587 * g + 0.114 * b;
        sat[k] = mx ? (mx - mn) / mx : 0;

        let hh = 0;
        if (mx !== mn) {
          const d = mx - mn;
          if (mx === r) hh = ((g - b) / d + (g < b ? 6 : 0));
          else if (mx === g) hh = (b - r) / d + 2;
          else hh = (r - g) / d + 4;
          hh *= 60;
        }
        hue[k] = hh;
      }
    }
    return { w: w, h: h, lum: lum, sat: sat, hue: hue };
  }

  /* Otsu-ish split: the digits are light on a dark plate, so one threshold
     between the two clusters separates ink from background without knowing
     anything about the capture's brightness. */
  function inkThreshold(lum) {
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < lum.length; i++) { if (lum[i] < lo) lo = lum[i]; if (lum[i] > hi) hi = lum[i]; }
    if (hi - lo < 25) return null; // nothing but flat colour: no text here
    return lo + (hi - lo) * 0.6;
  }

  /* ---------- gold at zero ----------
     "On 4-2 you MUST level/roll to 0 gold" only ever asks one question, and it
     is much easier than reading a number: is the counter showing a lone zero.

     A zero is the only single digit that is one closed ring — 6, 8 and 9 have
     holes too but carry a stroke above or below it, and 4's hole sits off to one
     side. So: exactly one glyph, one enclosed hole, and that hole centred in it. */

  function goldIsZero(frame, region, opts) {
    /* Two callers, one piece of machinery. A lone zero is "one glyph, and it is a
       zero"; an econ threshold is "two glyphs, and the second is a zero". Only
       the counting differs. */
    const cfg = opts || {};
    const want = cfg.want || 1;
    const which = cfg.testGlyph === undefined ? 0 : cfg.testGlyph;
    const s = sample(frame, region);
    const t = inkThreshold(s.lum);
    if (t === null) return { ok: false, why: 'nothing legible in the gold box' };

    const ink = new Uint8Array(s.w * s.h);
    for (let i = 0; i < ink.length; i++) ink[i] = s.lum[i] > t ? 1 : 0;

    // Columns that contain ink, grouped into glyphs.
    const cols = new Uint8Array(s.w);
    for (let x = 0; x < s.w; x++) {
      for (let y = 0; y < s.h; y++) if (ink[y * s.w + x]) { cols[x] = 1; break; }
    }
    const glyphs = [];
    let start = -1;
    for (let x = 0; x <= s.w; x++) {
      if (x < s.w && cols[x]) { if (start < 0) start = x; }
      else if (start >= 0) { if (x - start >= 2) glyphs.push([start, x - 1]); start = -1; }
    }

    if (glyphs.length === 0) return { ok: false, why: 'no digits found' };
    if (glyphs.length !== want) {
      return { ok: false, why: glyphs.length + ' digit' + (glyphs.length === 1 ? '' : 's') + ', wanted ' + want };
    }

    // Rows of the glyph under test, to get a tight box.
    const [gx0, gx1] = glyphs[which];
    let gy0 = -1;
    let gy1 = -1;
    for (let y = 0; y < s.h; y++) {
      let any = false;
      for (let x = gx0; x <= gx1; x++) if (ink[y * s.w + x]) { any = true; break; }
      if (any) { if (gy0 < 0) gy0 = y; gy1 = y; }
    }
    const gw = gx1 - gx0 + 1;
    const gh = gy1 - gy0 + 1;
    if (gw < 3 || gh < 5) return { ok: false, why: 'glyph too small to read' };

    /* Flood from the middle: a zero's centre is background enclosed by ink, so
       the fill cannot reach the glyph's edge. */
    const cx = Math.round((gx0 + gx1) / 2);
    const cy = Math.round((gy0 + gy1) / 2);
    if (ink[cy * s.w + cx]) return { ok: false, why: 'solid through the middle, so not a zero' };

    const seen = new Uint8Array(s.w * s.h);
    const stack = [[cx, cy]];
    let filled = 0;
    let escaped = false;
    while (stack.length) {
      const [x, y] = stack.pop();
      if (x < gx0 || x > gx1 || y < gy0 || y > gy1) { escaped = true; continue; }
      const k = y * s.w + x;
      if (seen[k] || ink[k]) continue;
      seen[k] = 1;
      filled++;
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }

    if (escaped) return { ok: false, why: 'the middle is open, so not a closed ring' };
    const share = filled / (gw * gh);
    if (share < 0.06) return { ok: false, why: 'hole too small to be a zero' };

    /* A closed 4 also has an enclosed hole, and its hole sits near the middle of
       the glyph box, so neither of the tests so far separates them. What does is
       what surrounds the hole: a zero is a ring, so the ink above it and the ink
       below it are the same stroke twice, while a 4 hangs a long stem below a
       small triangle. Comparing those two amounts costs one pass and settles it. */
    let holeTop = gy1;
    let holeBottom = gy0;
    let holeLeft = gx1;
    let holeRight = gx0;
    for (let y = gy0; y <= gy1; y++) {
      for (let x = gx0; x <= gx1; x++) {
        if (seen[y * s.w + x]) {
          if (y < holeTop) holeTop = y;
          if (y > holeBottom) holeBottom = y;
          if (x < holeLeft) holeLeft = x;
          if (x > holeRight) holeRight = x;
        }
      }
    }
    let above = 0;
    let below = 0;
    for (let y = gy0; y <= gy1; y++) {
      for (let x = gx0; x <= gx1; x++) {
        if (!ink[y * s.w + x]) continue;
        if (y < holeTop) above++;
        else if (y > holeBottom) below++;
      }
    }
    const balance = Math.max(above, below) ? Math.min(above, below) / Math.max(above, below) : 0;
    if (balance < 0.5) return { ok: false, why: 'lopsided around the hole, so more like a 4 than a 0' };

    /* Where the hole sits, and how much of the glyph it takes up.

       Looking at the actual digits at full resolution settles this better than
       any amount of reasoning about topology did. In TFT's font a zero is a
       broad ring whose counter runs almost the whole height of the glyph and
       sits dead centre. A four encloses a small triangle up in the top half. A
       six encloses one down in the bottom half. Balance alone let a four
       through — real gold of 44 read as "two digits ending in a zero" — because
       the crossbar and stem happened to weigh about the same as the cap.

       Height and position separate them with room to spare, so both are
       checked. */
    const ringH = holeBottom - holeTop + 1;
    const ringOffY = ((holeTop + holeBottom) / 2 - (gy0 + gy1) / 2) / gh;

    if (ringH / gh < 0.45) {
      return { ok: false, why: 'the hole is too short for a zero (' + Math.round((ringH / gh) * 100) + '% of the glyph)' };
    }
    if (Math.abs(ringOffY) > 0.12) {
      return { ok: false, why: 'the hole sits ' + (ringOffY < 0 ? 'high' : 'low') + ' in the glyph, so more like a '
        + (ringOffY < 0 ? '4 or a 9' : '6') + ' than a 0' };
    }

    /* Reported so a lab run can see why a glyph passed, not just that it did. */
    const holeW = holeRight - holeLeft + 1;
    const holeH = holeBottom - holeTop + 1;
    const metrics = {
      share: +share.toFixed(3),
      balance: +balance.toFixed(2),
      holeW: +(holeW / gw).toFixed(2),
      holeH: +(holeH / gh).toFixed(2),
      offX: +(((holeLeft + holeRight) / 2 - (gx0 + gx1) / 2) / gw).toFixed(2),
      offY: +(((holeTop + holeBottom) / 2 - (gy0 + gy1) / 2) / gh).toFixed(2),
    };

    return {
      metrics: metrics,
      ok: true,
      why: 'one glyph, closed hole ' + Math.round(share * 100) + '% of it, balanced ' + balance.toFixed(2),
      confidence: Math.min(1, share * 4),
    };
  }

  /* ---------- the trait panel ----------
     Both trait restrictions read the same column of hexagons down the left, and
     this is the third attempt at it. The first two are worth recording because
     each was wrong in a way that looked right.

     Attempt one asked for warm, saturated pixels: bronze and gold are warm,
     grey is not. Bronze is warm. Silver, chromatic and prismatic are not —
     measured on a real panel, an active Elderwood at silver sits at saturation
     0.32 where the rule wanted 0.45 and a warm hue. Every high tier was
     invisible to it. Out of one game it produced 21 false Built Different
     windows and 143 false activations.

     Attempt two compared each hexagon against the gap directly beneath it, on
     the theory that local contrast beats absolute brightness. It does, over a
     mid-tone board. The panel is translucent, and over a bright sky the gaps are
     brighter than the hexagons and every comparison goes negative: a frame with
     nine active traits read as zero.

     What actually holds is saturation, because it answers the question the
     restriction asks. An active hexagon is coloured — bronze, silver, gold,
     prismatic, it does not matter which. An inactive one is grey. Sky, grass,
     lava and water are all things the panel sits over, and none of them makes a
     grey hexagon coloured.

     The second half is that the rows are not counted individually at all. Row
     pitch is about 0.0486 of frame height, small errors in it compound down a
     column of ten, and pinning it by eye was worth two wrong answers already.
     Instead the column is read as one profile from the top down: TFT sorts
     active traits above inactive ones, so the answer is how far the colour runs
     before it stops. Smoothing that profile over one pitch is what stops the
     gaps between hexagons from ending the run early.

     AND IT IS STILL NOT RIGHT, which is why Built Different is switched off.
     Scored across two full games: game one reads zero active on 10 of 210
     samples with only one of those after the fifth minute, which is fine. Game
     two reads zero on 27 of 183, and looking at three of them settled what is
     wrong:

       5:48   correct. Elderwood 2/3, Brawler 1/2, Defender 1/2 — every trait a
              fraction, none at its breakpoint. Zero active is the right answer.
       22:36  correct. The panel is not drawn at all, just board.
       32:36  WRONG. Elderwood at 5 and Rapidfire at 3, both plainly active,
              and it read zero.

     The two it missed are at silver tier, and silver is desaturated — which is
     the same blind spot that killed the first attempt. Fixing the hue
     assumption did not fix the tier assumption underneath it, and a rule built
     on colour will keep failing on the tiers that have least of it.

     What would probably work is comparing each hexagon against the dimmest one
     in its own column rather than against an absolute: a panel almost always
     carries inactive traits at the bottom, so the column supplies its own
     reference and the background stops mattering. That is a fourth attempt, and
     it is not going in without being scored on both games first.

     Scored against frames labelled off the picture: seven active reads 7, and a
     screen with the panel not drawn reads 0.

     What it does NOT do is count reliably at the bottom. The run stops when the
     colour stops, and below the last trait there is no panel — there is board,
     which is also coloured, so a nine-trait panel over open ground can run on to
     twelve. Bounding that needs the panel's lower edge, which is not something
     measured yet.

     This matters less than it sounds, because of which end the run starts at.
     Built Different asks whether ANY trait is active, and that is the first
     hexagon: an all-grey panel stops the run at zero no matter what is
     underneath it. So `traitsActive` is the answer this file stands behind, and
     `count` is an estimate that is good at the top and soft at the bottom.
     Nothing is wired to the exact number. */
  const TRAITS = {
    x0: 0.036,     // the hexagon column, left edge
    x1: 0.049,     // right edge
    y0: 0.245,     // just above the first hexagon
    step: 0.005,   // profile resolution
    pitch: 0.0486, // centre to centre, measured
    win: 9,        // smoothing window, one pitch wide
    sat: 0.25,     // coloured enough to be an active trait
    rows: 10,      // the run is bounded here; see the note about the bottom
  };

  /** How many traits are lit, read as the length of the coloured run. */
  function litTraits(frame, cfg) {
    const c = Object.assign({}, TRAITS, cfg || {});
    const x0 = Math.max(0, Math.round(c.x0 * frame.width));
    const x1 = Math.min(frame.width, Math.round(c.x1 * frame.width));

    const prof = [];
    const samples = Math.ceil((c.rows * c.pitch) / c.step);
    for (let k = 0; k < samples; k++) {
      const y = Math.round((c.y0 + k * c.step) * frame.height);
      if (y < 0 || y >= frame.height) { prof.push(0); continue; }
      let sum = 0;
      let n = 0;
      for (let x = x0; x < x1; x++) {
        const i = (y * frame.width + x) * 4;
        const mx = Math.max(frame.data[i], frame.data[i + 1], frame.data[i + 2]);
        const mn = Math.min(frame.data[i], frame.data[i + 1], frame.data[i + 2]);
        sum += mx ? (mx - mn) / mx : 0;
        n++;
      }
      prof.push(n ? sum / n : 0);
    }

    /* Smoothed forward over one pitch: a hexagon and the gap under it average to
       the hexagon's colour, so the run does not end at every gap. */
    let run = 0;
    while (run < prof.length) {
      let sum = 0;
      let n = 0;
      for (let k = run; k < Math.min(prof.length, run + c.win); k++) { sum += prof[k]; n++; }
      if (!n || sum / n < c.sat) break;
      run++;
    }

    const count = Math.round((run * c.step) / c.pitch);
    return {
      count: count,
      run: run,
      profile: prof.map((v) => Math.round(v * 100)),
      why: count + ' trait' + (count === 1 ? '' : 's') + ' lit (colour runs '
        + (run * c.step).toFixed(3) + ' of the column)',
    };
  }

  /* Built Different is kept while nothing in that column is coloured. */
  function traitsActive(frame, cfg) {
    const r = litTraits(frame, cfg && cfg.pitch ? cfg : null);
    return { active: r.count > 0, count: r.count, why: r.why };
  }

  /* ---------- gold on an econ threshold ----------
     "Every time you would end a round on an econ threshold, you must roll once"
     needs to know whether gold is 10, 20, 30, 40 or 50 — and every one of those
     is two digits whose second is a zero, which is a question the zero test can
     already answer. Nothing here has to identify the leading digit, which is the
     part that would need a font.

     100 gold is three digits and so is excluded, correctly: it is not one of the
     thresholds the rule names. */
  function goldAtThreshold(frame, region) {
    const all = goldIsZero(frame, region, { want: 2, testGlyph: 1 });
    if (!all.ok) return { ok: false, why: all.why, metrics: all.metrics };
    return { ok: true, why: 'two digits ending in a zero — a round number', confidence: all.confidence, metrics: all.metrics };
  }

  /* ---------- is there a unit standing here ----------
     "Keep the unit from 1-1 on your bench as a 1-star pet the entire game" is a
     question about one bench square: is it still occupied. An empty bench square
     is flat pale stone — uniform and almost colourless. A unit standing on it is
     neither. So the test is variance and colour rather than any particular unit,
     which means it never needs to know which champion it is looking at. */
  const BENCH = { x: 0.1925, pitch: 0.0594, w: 0.055, y: 0.674, h: 0.090 };

  function benchBox(i, cfg) {
    const c = cfg || BENCH;
    return { x: c.x + i * c.pitch, y: c.y, w: c.w, h: c.h };
  }

  function occupied(frame, region) {
    const s = sample(frame, region);
    let sat = 0;
    let mean = 0;
    for (let i = 0; i < s.lum.length; i++) { sat += s.sat[i]; mean += s.lum[i]; }
    sat /= s.sat.length;
    mean /= s.lum.length;

    let variance = 0;
    for (let i = 0; i < s.lum.length; i++) variance += (s.lum[i] - mean) * (s.lum[i] - mean);
    variance = Math.sqrt(variance / s.lum.length);

    /* Empty stone measured flat and washed out; a champion brings both colour and
       contrast, and either one alone is enough to call it. */
    const busy = sat > 0.30 || variance > 26;
    return {
      occupied: busy,
      sat: +sat.toFixed(2),
      spread: Math.round(variance),
      why: busy
        ? 'colour ' + sat.toFixed(2) + ', contrast ' + Math.round(variance) + ' — something is standing here'
        : 'flat and colourless — an empty square',
    };
  }

  return {
    sample: sample,
    TRAITS: TRAITS,
    BENCH: BENCH,
    benchBox: benchBox,
    occupied: occupied,
    litTraits: litTraits,
    goldIsZero: goldIsZero,
    goldAtThreshold: goldAtThreshold,
    traitsActive: traitsActive,
  };
});
