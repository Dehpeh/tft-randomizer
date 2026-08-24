/* What the proctor knows how to look for.

   Everything here is the same idea, which is the only idea in this project that
   survived contact with real footage: **a restriction is checkable when the game
   puts something distinctive in a fixed place on screen.** Find that thing, crop
   it, compare it to a stored picture of it. No motion, no heuristics, no model.

   Each entry below is one thing to look for. A `template` is a picture of it,
   stored as base64; a matcher without one is declared but not calibrated, and
   the detector skips it. Calibrating is capturing that picture from footage —
   thirty seconds in /lab — not writing code.

   WHY SOME ARE CALIBRATED AND SOME ARE NOT

   The augment matcher was built and scored against 4h21m of a real stream: it
   found every augment screen across four games with nothing false in between.
   The others are declared with the regions they live in but no template, for a
   measured reason. In that recording — a 640x360 YouTube copy — the features
   are far smaller than the one that worked:

     augment text     128 x 29 px    calibrated, works
     gold digit         8 x 11 px    needs native-resolution footage
     trait hexagon     14 x 13 px    needs native-resolution footage
     star pip           5 x  4 px    needs native-resolution footage

   At the 1080p a player actually captures those become 23x32, 42x38 and 15x13 —
   workable. Calibrating them against the small compressed copy would produce
   numbers that look fine and do not transfer, which is the exact mistake the
   first motion-based detector made. So they wait for footage at the resolution
   they will really run at, and until then the proctor is honest about watching
   one thing rather than four.

   TO CALIBRATE ONE: open /lab, load a recording, scrub to the moment, pick the
   matcher, drag its box, and press capture. It scores against the same replay
   and hands back a base64 string to paste in here. */

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TFTMatchers = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  /* The one that is calibrated. "Choose One", 64x14, averaged over five real
     occurrences so it is not one compression artefact. Scores 0.95-1.00 on real
     augment screens, never above 0.36 on anything else. */
  const AUGMENT_TEMPLATE = '6+3s6uvq6urp6urq6erq6uvq6enp7PPo6vXx9vf17vTy7vbx8fbw8//6+ejo6Ofm5uXl5ebm5uXl5ebm5+jo6PPz9PPz8vLx8fDv7+/v7u7u7u7u7Ozr6+rr7Ovs7e3u7u/v7+/u7+/8+/Xu7u7u7u7u7u3s7O3t7e3u7u/w7+/19PT19fX19fX19PT08/P08/Pz8/Py8vLy8vPz9PX19fX19fX09PPy8fHx8fHx8fLx8fHx8PDw8PDw8PHx8PDw9fX19vb29vf29/f29PT09vj4+Pj3+Pj5+fv8/v4AAgD//wD//vz8+vj39vb29vb19PTz8/Pz8vLx8PDw8fDw8Pf39/n7/wEDAgMDBQUFBQUFBQQGBQgKCgoMDg4ODg4MDQ4PDw4NDAkFBAQFBAMEBAQDBAMDAQEAAP78+fXz8vL5+Pj5+fr6+/v6+vr6+RlZYyFTDvj9////AAEEBQoNDg8PCwYDAQpQZT35+vj6+vv7+ff39/f39/b19PX29fX0+fn5+vr6+vn5+fn4+Qh5BQIQbSQc8/snE/f9KRn/GzcSEjED+vlnIftkMgMXKfv3IxDz9fX19fb19fT19fb29fr6+fr6+vr5+fn5+fgxWvT29Ww/eAtgLnAeYCxuIHEtFmotWfX+f/P2KlxNWF4rRDppAPX09fX19fX19fb39vb7+/v6+fj49/f3+Pj5K2r39fpuB2MXevU6Onj2Ozo6cyF8NS31+34F9jVFQCo3MWVFOwL29vX29/b29vb39/j3+/n5+Pf29vb09PT19PloXVQqchJqHl1LbQtbTGoQSV0lbEku9/c7cUZo+0ooOTYyZj4C9/j39/f39/b3+fn5+Pj29vb19fX08vHx8fHx8RAL9woBCgL+Ev3x9A/48QkM7/cQ9vj4+AoU9fb78vTy7Qj87/Hx8vPz9PP09vj5+fj19fX19PTz8vHw8PDw7+70+/39/f7++efk5+rr7O7u7Orr8fn6+vn6+fjv5+fl5fPk4+Xq7e7t7Ovo6vP39/j58vPy8fDw7+/u7u7u7u3s7fr9/v7//vTl6Ovv8PDv7Ovs8/f5+vv7+/r16efm5fHx4OXn6+/v7Onn6PD09ff39/Dw7+7t7ezq6+vr7O3r6er5/f7///7v8/b4+/fy8Orq7/T3+vv8/Pv37ejl5O347u308/n48u7p6PDy8/Xy8fE=';

  /* region is normalised to the frame; w/h are the template's own pixel size,
     which the crop is resampled to, so one template works at any resolution.
     `absent` inverts the question: the restriction is kept while the thing is
     NOT there. */
  const MATCHERS = [
    {
      id: 'augment',
      label: 'Augment screen',
      watches: 'The augment restrictions: which card you were told to take',
      region: { x: 0.40, y: 0.16, w: 0.20, h: 0.08 },
      w: 64,
      h: 14,
      threshold: 0.6,
      template: AUGMENT_TEMPLATE,
      evidence: 'Scored on 4h21m of real footage: every augment screen across four games, nothing false.',
    },
    {
      id: 'carousel',
      label: 'Carousel',
      watches: 'Carousel pick banned for 2 stages · Carousel pick banned permanently',
      /* The carousel takes the whole board area rather than putting text in one
         spot, so the template wants the middle of the ring where the champions
         circle — distinctive, and in the same place every carousel. */
      region: { x: 0.30, y: 0.20, w: 0.40, h: 0.35 },
      w: 64,
      h: 28,
      threshold: 0.6,
      template: null,
      evidence: 'Not calibrated. Capture it at a carousel round.',
    },
    {
      id: 'gold-zero',
      label: 'Gold at zero',
      watches: 'On 4-2 you MUST level/roll to 0 gold',
      /* No template: a zero is recognisable by shape. One glyph, one closed
         hole, centred — see goldIsZero in features.js. */
      kind: 'gold-zero',
      /* Measured off the reference footage rather than guessed: the digits sit
         just right of the coin, and the earlier box was twice as tall as it
         needed to be, taking in the panel edge above them. */
      /* Gold passes through zero repeatedly in an ordinary game, so this is
         capped hard: the note is evidence that it happened, not an alarm, and
         six of them is more than enough to check a 4-2 against. */
      flagOn: 'open',
      says: { open: 'Gold reached 0' },
      minGap: 45,
      max: 6,
      region: { x: 0.528, y: 0.823, w: 0.030, h: 0.022 },
      template: 'built-in',
      evidence: 'Box measured on real footage. The reading itself is unproven: at 640x360 the digits are five pixels tall and segmentation is a coin flip, so this needs a clean capture before it means anything.',
      untested: true,
    },
    {
      id: 'traits-none',
      label: 'No active traits',
      watches: 'Your game is Built Different (no active traits)',
      /* No template: active hexagons are warm and saturated, inactive ones are
         grey. Fires while the strip stays grey. */
      kind: 'traits-none',
      /* The breach is the moment a trait lights up, not the long stretch where
         none is. So this one flags on the closing edge. */
      flagOn: 'close',
      says: { close: 'A trait activated' },
      minGap: 30,
      max: 8,
      region: { x: 0.030, y: 0.20, w: 0.028, h: 0.45 },
      template: 'built-in',
      evidence: 'Colour test, no calibration needed. The strip is semi-transparent so a colourful board may fool it — score it in the lab first.',
      untested: true,
    },
    {
      id: 'gold-threshold',
      label: 'Gold on an econ threshold',
      watches: 'Every time you would end a round on an econ threshold, you must roll once',
      /* 10, 20, 30, 40 and 50 are all two digits ending in a zero, which the same
         shape test answers without ever identifying the leading digit. 100 is
         three digits and is excluded, which is correct — it is not one of the
         thresholds the rule names. */
      kind: 'gold-threshold',
      flagOn: 'open',
      says: { open: 'Gold is sitting on a round number' },
      minGap: 20,
      max: 10,
      region: { x: 0.528, y: 0.823, w: 0.030, h: 0.022 },
      template: 'built-in',
      evidence: 'Same digit machinery as the zero test and the same caveat: unproven below about 720p. It read 50 correctly and 30 wrongly on the 360p reference.',
      untested: true,
    },
    {
      id: 'pet',
      label: 'The 1-1 pet',
      watches: 'Keep the unit from 1-1 on your bench as a 1-star pet the entire game',
      /* This one is a picture, but a picture the player takes themselves, once,
         at the start of their own game — which is the only kind of calibration
         that can possibly know which champion the pet is. After that the question
         is whether it is still standing there, and the interesting edge is the
         one where it stops. */
      flagOn: 'close',
      says: { close: 'The pet is no longer on its square' },
      minGap: 60,
      max: 6,
      region: { x: 0.1925, y: 0.674, w: 0.055, h: 0.090 },
      w: 22,
      h: 26,
      threshold: 0.75,
      template: null,
      evidence: 'Bench geometry measured on real footage. Needs one capture per game: put the pet on the leftmost bench square at 1-1 and capture it.',
    },
    {
      id: 'wisp',
      label: 'Wisp choice',
      watches: 'Can only take "Risky" wisps',
      /* A distinct screen, like the augment screen, and solvable the same way the
         augment screen was solved — by one picture of the text that only appears
         there. Nobody has taken it yet. */
      region: { x: 0.35, y: 0.14, w: 0.30, h: 0.10 },
      w: 64,
      h: 14,
      threshold: 0.6,
      template: null,
      evidence: 'Not calibrated. Capture it at a wisp screen — the same approach that made the augment detector work.',
    },
    {
      id: 'three-star',
      label: 'Three-star unit',
      watches: 'No 3-star unit allowed',
      /* No template: three small bright-gold blobs, level and evenly spaced. */
      kind: 'three-star',
      /* A 3-star stays on the board once it exists, so the arrival is the event
         and everything after it is the same fact repeated. */
      flagOn: 'open',
      says: { open: 'Something on the board looks like a 3-star' },
      minGap: 60,
      max: 6,
      region: { x: 0.20, y: 0.25, w: 0.60, h: 0.45 },
      template: 'built-in',
      evidence: 'Shape test, no calibration needed, and the weakest of the set: pips are tiny and TFT boards are full of gold. Score it in the lab first.',
      untested: true,
    },
  ];

  const byId = (id) => MATCHERS.find((m) => m.id === id) || null;
  /* A feature matcher counts as ready without a capture; a template matcher does
     not. What the detector actually runs — untested ones stay out
     until someone turns them on in the lab. */
  const calibrated = () => MATCHERS.filter((m) => m.template);
  const enabled = () => MATCHERS.filter((m) => m.template && (!m.untested || m.on));

  /* ---------- templates ---------- */

  function decode(b64) {
    let bytes;
    if (typeof atob === 'function') {
      const raw = atob(b64);
      bytes = new Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    } else {
      bytes = Array.from(Buffer.from(b64, 'base64'));
    }
    const signed = bytes.map((b) => (b > 127 ? b - 256 : b));
    const norm = Math.sqrt(signed.reduce((a, b) => a + b * b, 0)) || 1;
    return signed.map((b) => b / norm);
  }

  const cache = {};
  function vector(matcher) {
    if (!matcher.template) return null;
    if (!cache[matcher.id] || cache[matcher.id].src !== matcher.template) {
      cache[matcher.id] = { src: matcher.template, data: decode(matcher.template) };
    }
    return cache[matcher.id].data;
  }

  /* Grey, mean-removed, unit-length: the comparison ignores brightness and
     contrast, so a dimmer capture or a different gamma still matches. */
  function crop(frame, region, w, h) {
    const W = frame.width;
    const H = frame.height;
    const x0 = Math.round(region.x * W);
    const y0 = Math.round(region.y * H);
    const bw = Math.max(1, Math.round(region.w * W));
    const bh = Math.max(1, Math.round(region.h * H));

    const out = new Array(w * h);
    for (let ty = 0; ty < h; ty++) {
      const sy = Math.min(H - 1, y0 + Math.floor((ty * bh) / h));
      for (let tx = 0; tx < w; tx++) {
        const sx = Math.min(W - 1, x0 + Math.floor((tx * bw) / w));
        const i = (sy * W + sx) * 4;
        out[ty * w + tx] = 0.299 * frame.data[i] + 0.587 * frame.data[i + 1] + 0.114 * frame.data[i + 2];
      }
    }
    let mean = 0;
    for (let i = 0; i < out.length; i++) mean += out[i];
    mean /= out.length;
    let norm = 0;
    for (let i = 0; i < out.length; i++) { out[i] -= mean; norm += out[i] * out[i]; }
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < out.length; i++) out[i] /= norm;
    return out;
  }

  /* Feature matchers answer with a reason as well as a number, so a lab run can
     say why something did or did not fire rather than only that it did not. */
  const F = (typeof window !== 'undefined' && window.TFTFeatures)
    || (typeof require === 'function' ? require('./features.js') : null);

  let lastWhy = {};
  const why = (id) => lastWhy[id] || '';

  /** -1 to 1: how much this frame looks like what the matcher is looking for. */
  function score(frame, matcher) {
    if (matcher.kind && F) {
      if (matcher.kind === 'gold-zero') {
        const r = F.goldIsZero(frame, matcher.region);
        lastWhy[matcher.id] = r.why;
        return r.ok ? (r.confidence || 1) : 0;
      }
      if (matcher.kind === 'gold-threshold') {
        const r = F.goldAtThreshold(frame, matcher.region);
        lastWhy[matcher.id] = r.why;
        return r.ok ? 1 : 0;
      }
      if (matcher.kind === 'traits-none') {
        const r = F.traitsActive(frame, matcher.region);
        lastWhy[matcher.id] = `${(r.share * 100).toFixed(1)}% of the strip is coloured`;
        return r.active ? 0 : 1;   // fires while nothing is active
      }
      if (matcher.kind === 'three-star') {
        const r = F.threeStar(frame, matcher.region);
        lastWhy[matcher.id] = r.why;
        return r.ok ? 1 : 0;
      }
    }

    const tpl = vector(matcher);
    if (!tpl) return 0;
    const got = crop(frame, matcher.region, matcher.w, matcher.h);
    let dot = 0;
    for (let i = 0; i < got.length; i++) dot += got[i] * tpl[i];
    return dot;
  }

  /** Make a template from a frame — this is what calibration produces. */
  function capture(frame, region, w, h) {
    const v = crop(frame, region, w, h);
    const peak = Math.max.apply(null, v.map(Math.abs)) || 1;
    const bytes = v.map((p) => Math.max(-127, Math.min(127, Math.round((p / peak) * 127))));
    const chars = bytes.map((b) => String.fromCharCode(b < 0 ? b + 256 : b)).join('');
    return typeof btoa === 'function' ? btoa(chars) : Buffer.from(chars, 'binary').toString('base64');
  }

  /* Calibration done in a browser is kept there, so a player can calibrate their
     own resolution without anyone editing source. */
  const STORE_KEY = 'tft.matchers';

  function loadLocal() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
      Object.keys(saved).forEach((id) => {
        const m = byId(id);
        if (m && m.kind) return;   // feature matchers need no capture
        if (m && saved[id] && saved[id].template) {
          m.template = saved[id].template;
          m.region = saved[id].region || m.region;
          m.evidence = 'Calibrated on this device.';
        }
      });
      return Object.keys(saved).length;
    } catch (e) { return 0; }
  }

  function saveLocal(id, template, region) {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
      saved[id] = { template, region };
      localStorage.setItem(STORE_KEY, JSON.stringify(saved));
    } catch (e) { /* private mode */ }
    const m = byId(id);
    if (m) { m.template = template; if (region) m.region = region; m.evidence = 'Calibrated on this device.'; }
  }

  function clearLocal(id) {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
      delete saved[id];
      localStorage.setItem(STORE_KEY, JSON.stringify(saved));
    } catch (e) { /* private mode */ }
  }

  return {
    MATCHERS: MATCHERS,
    byId: byId,
    calibrated: calibrated,
    enabled: enabled,
    why: why,
    score: score,
    capture: capture,
    crop: crop,
    loadLocal: loadLocal,
    saveLocal: saveLocal,
    clearLocal: clearLocal,
  };
});
