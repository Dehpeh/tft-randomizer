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
     this took six attempts, five of which failed for a reason that turned out
     not to be the reason.

     The story is worth keeping because the lesson is not about traits. Attempt
     one asked for warm saturated pixels and missed silver. Attempt two compared
     each hexagon against the gap below it and inverted over a bright sky.
     Attempt three read saturation as a run down the column and got the top rows
     right and the bottom rows wrong. Attempt four judged each hexagon against
     the column's dimmest and answered three everywhere. Attempt five gave up on
     colour entirely and measured the width of the breakpoint line, and the
     background bled through the translucent panel and looked like text.

     Every one of those was blamed on something about colour: silver is
     desaturated, the panel is see-through, the board moves. The actual fault
     was that the row pitch was measured off a screenshot by eye as 0.0486 when
     it is 0.0503. Over nine rows that is half a row of drift, so the lower boxes
     were sampling the gaps BETWEEN hexagons. Five attempts were tuning a rule
     against pixels that were not the thing being judged, and each new failure
     produced a new theory about colour rather than a check of the geometry.

     With the pitch measured properly off the rendered panel, plain brightness
     and saturation separate with room to spare:

       game 1, seven active     71-120 lum, 0.27-0.82 sat
               two inactive     37 and 39 lum, 0.04 and 0.06 sat
       game 1, nine active over a bright sky
                                62-109 lum, 0.26-0.83 sat
       game 2, two active at silver tier
                                56 and 57 lum, 0.19 and 0.20 sat
               seven inactive   26-29 lum, 0.01-0.05 sat

     A hexagon is lit when it is both bright and coloured. Either alone is not
     enough: past the end of the list the board sometimes reads saturated but
     dark, and a bright background sometimes reads bright but grey.

     TFT sorts active traits above inactive ones, so the answer is the length of
     the leading run rather than a count of everything lit — which is what stops
     the board below the panel from being counted. */
  const TRAITS = {
    x0: 0.036,       // the hexagon column
    x1: 0.051,
    y0: 0.2641,      // centre of the first hexagon
    pitch: 0.0503,   // centre to centre, measured off the rendered panel
    half: 0.007,     // half the sampled height of one hexagon
    minLum: 47,      // active 56 and up, inactive 39 and down
    minSat: 0.12,    // active 0.19 and up, inactive 0.06 and down
    rows: 11,
  };

  function traitCell(frame, cy, c) {
    const X0 = Math.max(0, Math.round(c.x0 * frame.width));
    const X1 = Math.min(frame.width, Math.round(c.x1 * frame.width));
    const Y0 = Math.max(0, Math.round((cy - c.half) * frame.height));
    const Y1 = Math.min(frame.height, Math.round((cy + c.half) * frame.height));
    let lum = 0;
    let sat = 0;
    let n = 0;
    for (let y = Y0; y < Y1; y++) {
      for (let x = X0; x < X1; x++) {
        const k = (y * frame.width + x) * 4;
        const R = frame.data[k];
        const G = frame.data[k + 1];
        const B = frame.data[k + 2];
        const mx = Math.max(R, G, B);
        const mn = Math.min(R, G, B);
        lum += 0.299 * R + 0.587 * G + 0.114 * B;
        sat += mx ? (mx - mn) / mx : 0;
        n++;
      }
    }
    return n ? { lum: lum / n, sat: sat / n } : { lum: 0, sat: 0 };
  }

  /** How many traits are lit, counted as the leading run. */
  function litTraits(frame, cfg) {
    const c = Object.assign({}, TRAITS, cfg || {});
    const cells = [];
    for (let i = 0; i < c.rows; i++) cells.push(traitCell(frame, c.y0 + i * c.pitch, c));

    const lit = cells.map((v) => v.lum > c.minLum && v.sat > c.minSat);
    let count = 0;
    while (count < lit.length && lit[count]) count++;

    return {
      count: count,
      cells: cells.map((v) => Math.round(v.lum) + '/' + v.sat.toFixed(2)),
      why: count + ' trait' + (count === 1 ? '' : 's') + ' lit',
    };
  }

  /* Built Different is kept while nothing in that column is lit. */
  function traitsActive(frame, cfg) {
    const r = litTraits(frame, cfg);
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
