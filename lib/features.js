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

  function goldIsZero(frame, region) {
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
    if (glyphs.length > 1) return { ok: false, why: glyphs.length + ' digits, so not a lone zero' };

    // Rows of the single glyph, to get a tight box.
    const [gx0, gx1] = glyphs[0];
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
    for (let y = gy0; y <= gy1; y++) {
      for (let x = gx0; x <= gx1; x++) {
        if (seen[y * s.w + x]) { if (y < holeTop) holeTop = y; if (y > holeBottom) holeBottom = y; break; }
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

    return {
      ok: true,
      why: 'one glyph, closed hole ' + Math.round(share * 100) + '% of it, balanced ' + balance.toFixed(2),
      confidence: Math.min(1, share * 4),
    };
  }

  /* ---------- no active traits ----------
     Active trait hexagons are bronze, silver, gold or prismatic — coloured and
     bright. Inactive ones are grey. "Built Different" is kept while nothing in
     that strip is coloured.

     The honest weakness: the strip is partly transparent, so the board behind it
     leaks in and a colourful board can read as an active trait. That is exactly
     what a score on real footage would show, and why this is off by default. */

  function traitsActive(frame, region) {
    const s = sample(frame, region);
    let lit = 0;
    for (let i = 0; i < s.lum.length; i++) {
      // Warm metals: bronze through gold. Not blue, which is mostly board.
      const warm = s.hue[i] < 60 || s.hue[i] > 330;
      if (warm && s.sat[i] > 0.45 && s.lum[i] > 90) lit++;
    }
    const share = lit / s.lum.length;
    return { share: share, active: share > 0.05 };
  }

  /* ---------- three-star ----------
     Three pips sit in a row above a unit, bright gold and evenly spaced. This
     looks for exactly that shape anywhere in the board area: a run of three
     small bright-gold blobs at the same height, similar size, evenly spaced.

     The weakest of the three by a distance. Pips are tiny, units overlap, and
     gold appears all over a TFT board. Written because the shape is at least
     well defined; believed only if a replay says so. */

  function threeStar(frame, region, opts) {
    const cfg = opts || {};
    const minBlob = cfg.minBlob || 2;
    const maxBlob = cfg.maxBlob || 60;
    const s = sample(frame, region);

    const gold = new Uint8Array(s.w * s.h);
    for (let i = 0; i < gold.length; i++) {
      gold[i] = (s.hue[i] > 35 && s.hue[i] < 65 && s.sat[i] > 0.45 && s.lum[i] > 120) ? 1 : 0;
    }

    // Connected blobs, four-way.
    const seen = new Uint8Array(gold.length);
    const blobs = [];
    for (let y = 0; y < s.h; y++) {
      for (let x = 0; x < s.w; x++) {
        const k = y * s.w + x;
        if (!gold[k] || seen[k]) continue;
        const stack = [[x, y]];
        let n = 0;
        let sx = 0;
        let sy = 0;
        let minY = y;
        let maxY = y;
        while (stack.length) {
          const [px, py] = stack.pop();
          if (px < 0 || py < 0 || px >= s.w || py >= s.h) continue;
          const kk = py * s.w + px;
          if (seen[kk] || !gold[kk]) continue;
          seen[kk] = 1;
          n++;
          sx += px;
          sy += py;
          if (py < minY) minY = py;
          if (py > maxY) maxY = py;
          stack.push([px + 1, py], [px - 1, py], [px, py + 1], [px, py - 1]);
        }
        if (n >= minBlob && n <= maxBlob) blobs.push({ x: sx / n, y: sy / n, n: n, h: maxY - minY + 1 });
      }
    }

    /* Three of them, level with each other, evenly spaced, about the same size. */
    blobs.sort((a, b) => a.x - b.x);
    for (let i = 0; i + 2 < blobs.length; i++) {
      const [a, b, c] = [blobs[i], blobs[i + 1], blobs[i + 2]];
      const level = Math.abs(a.y - b.y) < 3 && Math.abs(b.y - c.y) < 3;
      const gap1 = b.x - a.x;
      const gap2 = c.x - b.x;
      const even = gap1 > 1 && gap2 > 1 && Math.abs(gap1 - gap2) < Math.max(2, gap1 * 0.4);
      const sized = Math.max(a.n, b.n, c.n) < Math.min(a.n, b.n, c.n) * 3;
      if (level && even && sized) {
        return { ok: true, at: { x: b.x / s.w, y: b.y / s.h }, blobs: 3, why: 'three level pips, evenly spaced' };
      }
    }
    return { ok: false, blobs: blobs.length, why: blobs.length + ' gold blobs, no row of three' };
  }

  return {
    sample: sample,
    goldIsZero: goldIsZero,
    traitsActive: traitsActive,
    threeStar: threeStar,
  };
});
