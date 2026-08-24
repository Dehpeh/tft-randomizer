/* The shop row, which is where six of the restrictions actually live.

   Lock a shop space, 5-costs banned, must buy every 1-cost — all three are
   questions about five cards at the bottom of the screen, and none of them needs
   a template, because the shop announces itself in two ways that survive any
   resolution:

     what a card costs   the colour of its name bar: grey, green, blue, purple, gold
     what just happened   which slots changed between one frame and the next

   The second is the stronger of the two and does the heavy lifting. A reroll
   replaces every unlocked card at once; a purchase empties exactly one slot and
   leaves the rest alone; a locked slot is the one that survives a reroll. None of
   that depends on reading anything — it is which parts of a picture changed —
   so it works at 360p or 4K, in any language, through any skin.

   The colour part is the weak half and is kept as data below so it can be
   re-fitted rather than rewritten. The numbers there were measured off the
   reference stream at 640x360, which is the worst case: heavy compression
   smears the low-saturation 1-cost bar toward blue until its hue overlaps a
   3-cost outright (185-203 against 207-216). Hue alone cannot separate those
   two. Saturation can — 0.35-0.44 against 0.54-0.61 — and that is the whole
   reason the classifier looks at both.

   Nothing here reads memory, touches the client, or sends an input. It is the
   same screen share the augment detector already watches. */

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TFTShop = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  /* Measured off the reference footage: five cards, evenly pitched, with the
     name bar as the bottom sliver of each. Fractions of the frame, so this is
     resolution-independent — but it does assume 16:9 with the game filling the
     capture. A different aspect, or a capture that includes a desktop around the
     game, needs these moved, which is what the lab is for. */
  const DEFAULT = {
    x: 0.2885,      // left edge of the first card
    pitch: 0.1046,  // centre-to-centre
    w: 0.099,       // card width
    barY: 0.956,    // the name bar: where the cost colour lives
    barH: 0.033,
    artY: 0.862,    // the portrait: where change detection looks
    artH: 0.086,
  };

  /* Fitted on 640x360 stream footage, which is the worst case rather than the
     representative one. Re-check against a clean capture before trusting a
     borderline call: the lab prints what it thinks each slot is. */
  const PALETTE = [
    { cost: 5, hue: [25, 65], minSat: 0.50, name: 'gold' },
    { cost: 2, hue: [100, 170], minSat: 0.45, name: 'green' },
    { cost: 4, hue: [255, 330], minSat: 0.50, name: 'purple' },
    /* 1 and 3 share a hue band and are told apart by saturation alone. */
    { cost: 3, hue: [165, 245], minSat: 0.48, name: 'blue' },
    { cost: 1, hue: [160, 250], minSat: 0.33, name: 'grey' },
  ];

  /* Measured, not guessed. An empty slot reads 7-8; a real name bar reads 42-99;
     and the "Sell for 1g" bar that replaces the whole shop while a unit is being
     dragged reads 20 at saturation 0.30 — close enough to a dim 1-cost bar that
     without a floor it turns the sell bar into a row of four 1-costs, which is
     exactly what it did. The gap between 18 and 30 is where the answer is that
     there is nothing readable here. */
  const EMPTY_LUM = 18;    // below this the slot is a hole
  const CARD_MIN_LUM = 30; // above this it is a lit name bar; between, say nothing
  const FADED_SAT = 0.33;  // the shop dims through combat and transitions

  function slotBox(i, cfg, part) {
    const c = cfg || DEFAULT;
    return part === 'art'
      ? { x: c.x + i * c.pitch, y: c.artY, w: c.w, h: c.artH }
      : { x: c.x + i * c.pitch, y: c.barY, w: c.w, h: c.barH };
  }

  /* Mean hue over the coloured pixels only. Averaging in the dead pixels of the
     text and the coin icon drags every bar toward grey and costs the 1-vs-3
     separation the classifier depends on. */
  function stats(frame, r) {
    const x0 = Math.max(0, Math.round(r.x * frame.width));
    const y0 = Math.max(0, Math.round(r.y * frame.height));
    const w = Math.max(1, Math.min(frame.width - x0, Math.round(r.w * frame.width)));
    const h = Math.max(1, Math.min(frame.height - y0, Math.round(r.h * frame.height)));

    let hueX = 0;
    let hueY = 0;
    let coloured = 0;
    let sat = 0;
    let lum = 0;
    let n = 0;

    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        const i = (y * frame.width + x) * 4;
        const R = frame.data[i];
        const G = frame.data[i + 1];
        const B = frame.data[i + 2];
        const mx = Math.max(R, G, B);
        const mn = Math.min(R, G, B);
        const d = mx - mn;
        const s = mx ? d / mx : 0;
        let hh = 0;
        if (d) {
          if (mx === R) hh = (G - B) / d + (G < B ? 6 : 0);
          else if (mx === G) hh = (B - R) / d + 2;
          else hh = (R - G) / d + 4;
          hh *= 60;
        }
        /* Hue is circular, so it is averaged as a direction rather than as a
           number — otherwise reds either side of 0 average to cyan. */
        if (s > 0.25) {
          const rad = hh * Math.PI / 180;
          hueX += Math.cos(rad);
          hueY += Math.sin(rad);
          coloured++;
        }
        sat += s;
        lum += 0.299 * R + 0.587 * G + 0.114 * B;
        n++;
      }
    }

    let hue = null;
    if (coloured) {
      hue = Math.atan2(hueY / coloured, hueX / coloured) * 180 / Math.PI;
      if (hue < 0) hue += 360;
    }
    return { hue: hue, sat: sat / n, lum: lum / n, colouredShare: coloured / n };
  }

  /* A real name bar is one flat colour all the way across. Anything that is not
     — a webcam in the corner, an overlay, a tooltip — shows up as quarters of the
     bar disagreeing with each other, and the honest answer there is that the slot
     cannot be seen rather than whatever the average happens to land on.

     This is not hypothetical. In the reference stream the fifth slot sits a
     quarter underneath the streamer's webcam, and averaging across it turns an
     empty slot into a confident 2-cost. Taking the median of the quarters throws
     the bright corner away; comparing their hues catches the half-covered case
     that the median cannot. */
  function quarters(frame, r) {
    const out = [];
    for (let q = 0; q < 4; q++) {
      out.push(stats(frame, { x: r.x + (q * r.w) / 4, y: r.y, w: r.w / 4, h: r.h }));
    }
    return out;
  }

  function median(xs) {
    const a = xs.slice().sort((p, q) => p - q);
    return (a[1] + a[2]) / 2;
  }

  function hueGap(a, b) {
    const d = Math.abs(a - b) % 360;
    return d > 180 ? 360 - d : d;
  }

  function classify(st, qs) {
    if (qs) {
      const lums = qs.map((q) => q.lum);
      if (median(lums) < EMPTY_LUM) return { cost: null, empty: true, why: 'empty slot' };

      const lit = qs.filter((q) => q.lum >= EMPTY_LUM && q.hue !== null && q.sat > 0.25);
      for (let i = 0; i < lit.length; i++) {
        for (let j = i + 1; j < lit.length; j++) {
          if (hueGap(lit[i].hue, lit[j].hue) > 45) {
            return { cost: null, empty: false, occluded: true, why: 'the bar is two different colours across its width — something is covering this slot' };
          }
        }
      }
    }

    if (st.lum < EMPTY_LUM) return { cost: null, empty: true, why: 'empty slot' };
    if (st.lum < CARD_MIN_LUM) {
      return { cost: null, empty: false, why: 'too dim to be a name bar — the shop is hidden or mid-transition' };
    }
    if (st.sat < FADED_SAT || st.hue === null) {
      return { cost: null, empty: false, why: 'washed out — shop is probably mid-transition' };
    }
    for (let i = 0; i < PALETTE.length; i++) {
      const p = PALETTE[i];
      if (st.hue >= p.hue[0] && st.hue <= p.hue[1] && st.sat >= p.minSat) {
        return { cost: p.cost, empty: false, why: p.name + ' bar, hue ' + Math.round(st.hue) + ' sat ' + st.sat.toFixed(2) };
      }
    }
    return { cost: null, empty: false, why: 'hue ' + Math.round(st.hue) + ' sat ' + st.sat.toFixed(2) + ' matches no cost' };
  }

  /* A coarse fingerprint of the portrait, used only to answer "is this the same
     card as a moment ago". Deliberately small and mean-removed: it should shrug
     off the idle animation on a card and the shop dimming, and change hard when
     the card is replaced. */
  const SIG_W = 8;
  const SIG_H = 6;

  function signature(frame, i, cfg) {
    const r = slotBox(i, cfg, 'art');
    const x0 = Math.round(r.x * frame.width);
    const y0 = Math.round(r.y * frame.height);
    const w = Math.max(1, Math.round(r.w * frame.width));
    const h = Math.max(1, Math.round(r.h * frame.height));
    const out = new Float32Array(SIG_W * SIG_H);

    for (let sy = 0; sy < SIG_H; sy++) {
      for (let sx = 0; sx < SIG_W; sx++) {
        let sum = 0;
        let n = 0;
        const px0 = x0 + Math.floor((sx * w) / SIG_W);
        const px1 = x0 + Math.floor(((sx + 1) * w) / SIG_W);
        const py0 = y0 + Math.floor((sy * h) / SIG_H);
        const py1 = y0 + Math.floor(((sy + 1) * h) / SIG_H);
        for (let y = py0; y < py1; y++) {
          for (let x = px0; x < px1; x++) {
            if (x < 0 || y < 0 || x >= frame.width || y >= frame.height) continue;
            const i2 = (y * frame.width + x) * 4;
            sum += 0.299 * frame.data[i2] + 0.587 * frame.data[i2 + 1] + 0.114 * frame.data[i2 + 2];
            n++;
          }
        }
        out[sy * SIG_W + sx] = n ? sum / n : 0;
      }
    }

    let mean = 0;
    for (let k = 0; k < out.length; k++) mean += out[k];
    mean /= out.length;
    let norm = 0;
    for (let k = 0; k < out.length; k++) { out[k] -= mean; norm += out[k] * out[k]; }
    norm = Math.sqrt(norm) || 1;
    for (let k = 0; k < out.length; k++) out[k] /= norm;
    return out;
  }

  function same(a, b) {
    if (!a || !b) return false;
    let dot = 0;
    for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
    return dot > 0.90;
  }

  /** The whole row as it stands in this frame. */
  function read(frame, cfg) {
    const slots = [];
    for (let i = 0; i < 5; i++) {
      const box = slotBox(i, cfg, 'bar');
      const st = stats(frame, box);
      const cl = classify(st, quarters(frame, box));
      slots.push({
        slot: i + 1,
        cost: cl.cost,
        empty: cl.empty,
        occluded: Boolean(cl.occluded),
        why: cl.why,
        hue: st.hue === null ? null : Math.round(st.hue),
        sat: +st.sat.toFixed(2),
        lum: Math.round(st.lum),
        sig: signature(frame, i, cfg),
      });
    }
    return { slots: slots };
  }

  /* What happened between two readings.

     A reroll replaces every unlocked card at once, so three or more changing
     together is a reroll and anything that did NOT change through it was held —
     which is the lock, observed rather than read off an icon.

     A purchase takes exactly one card and leaves the others untouched, so one
     slot going from a card to a hole with nothing else moving is a buy. The cost
     of what was bought comes from the previous reading, because by now it is
     gone. */
  function diff(prev, next) {
    if (!prev || !next) return null;
    const changed = [];
    const emptied = [];
    for (let i = 0; i < 5; i++) {
      const a = prev.slots[i];
      const b = next.slots[i];
      const moved = a.empty !== b.empty || !same(a.sig, b.sig);
      if (moved) changed.push(i);
      if (!a.empty && b.empty) emptied.push(i);
    }

    if (changed.length >= 3) {
      const kept = [];
      for (let i = 0; i < 5; i++) if (changed.indexOf(i) === -1 && !next.slots[i].empty) kept.push(i + 1);
      return {
        kind: 'reroll',
        kept: kept,
        offered: next.slots.map((s) => s.cost),
        wasOffered: prev.slots.map((s) => s.cost),
      };
    }

    if (emptied.length === 1 && changed.length === 1) {
      return { kind: 'buy', slot: emptied[0] + 1, cost: prev.slots[emptied[0]].cost };
    }

    return null;
  }

  /* The shop is not on screen the whole time. It dims through combat, slides
     away at a carousel, and fades on the way back, and every one of those
     transitions is a frame where the five boxes hold something that is not five
     cards. Read naively, a single game produces dozens of "rerolls" that are
     really just the shop coming back into view.

     So a reading has to hold still before it counts. Two consecutive samples
     have to agree with each other before the row is committed, and it is the
     committed rows that get compared — which means a transition, whose frames
     never agree with each other, produces nothing at all. The same two-sample
     idea as the augment matcher, for the same reason. */
  /* A shop that can be reasoned about has most of its slots legible and at least
     one actual card in it. Requiring a card is what keeps the sell bar out: it
     reads as five dark boxes, which without that clause is indistinguishable
     from a shop somebody has bought out. */
  function visible(row) {
    const legible = row.slots.filter((s) => s.empty || s.cost !== null).length;
    const cards = row.slots.filter((s) => s.cost !== null).length;
    return legible >= 3 && cards >= 1;
  }

  function agree(a, b) {
    if (!a || !b) return false;
    for (let i = 0; i < 5; i++) {
      if (a.slots[i].empty !== b.slots[i].empty) return false;
      if (!a.slots[i].empty && !same(a.slots[i].sig, b.slots[i].sig)) return false;
    }
    return true;
  }

  function tracker() {
    let committed = null;
    let last = null;

    return {
      committed: () => committed,
      push: function (row, at) {
        if (!visible(row)) { last = null; return []; }

        const steady = agree(last, row);
        last = row;
        if (!steady) return [];
        if (!committed) { committed = row; return []; }
        if (agree(committed, row)) return [];

        const d = diff(committed, row);
        committed = row;
        return d ? [Object.assign({ at: at }, d)] : [];
      },
    };
  }

  /* Whether the live page watches the shop at all. Off until somebody has run a
     replay and seen it get the rerolls and the buys right on their own footage —
     the same bar every other detector here has to clear. Stored per browser
     because that is where the evidence was seen. */
  const KEY = 'tft.watch.shop';

  function on() {
    try { return localStorage.getItem(KEY) === '1'; } catch (e) { return false; }
  }

  function setOn(v) {
    try { localStorage.setItem(KEY, v ? '1' : '0'); } catch (e) { /* private mode */ }
    return v;
  }

  return {
    DEFAULT: DEFAULT,
    on: on,
    setOn: setOn,
    visible: visible,
    tracker: tracker,
    PALETTE: PALETTE,
    slotBox: slotBox,
    stats: stats,
    classify: classify,
    quarters: quarters,
    signature: signature,
    same: same,
    read: read,
    diff: diff,
  };
});
