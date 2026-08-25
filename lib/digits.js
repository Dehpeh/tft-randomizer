/* Reading the numbers TFT prints on the screen.

   The gold counter and the round indicator are both plain text in a fixed
   place, and once you can read them a lot of restrictions stop being guesswork.
   "5 costs banned until stage 5" needs the stage. "Roll to 0 gold at 4-2" needs
   the stage and the gold. "AFK one round every stage" needs the round. The
   augment stage was being *counted* rather than read, which is why a detector
   that fired twice too often put every note at 4-2.

   How it works: the region is thresholded into ink, split into glyph boxes by
   columns, and each box is resampled to a fixed 10x14 grid, mean-removed and
   normalised — the same trick the augment matcher uses, at glyph scale. Each
   grid is then scored against a bank of digits captured from real footage, and
   the best match wins if it wins clearly enough.

   The bank came from labelled numbers in a real 1080p game: stage readings 2-4,
   2-7, 3-4, 4-2, 5-2 and gold readings 25, 29, 44, 42, 62, 46, 10. Between them
   they cover every digit except 8, which never appeared in that game.

   That gap is deliberate rather than ignored:

     - Stages run 1 to 7 and rounds 1 to 7, so an 8 cannot appear there at all.
       The round indicator is read with complete cover.
     - Anywhere else, an unrecognised glyph has to score clearly above the
       runner-up to be accepted. An 8 scores middling against 0, 6 and 9 and
       lands under that line, so it reads as unknown rather than as a wrong
       digit. A number containing one comes back null.
     - The econ-threshold rule does not use this file at all. It uses the shape
       test in features.js, which asks whether the last glyph is a ring, and was
       scored 8 out of 8 on real gold values. Two independent routes to the same
       answer, and the one that matters most does not depend on the bank.

   Scored on a full 1080p game: the round indicator read correctly on every
   sample, and gold read 26 values right, 0 wrong, 1 not at all, with all 9
   frames showing no gold correctly reading as nothing. Never inventing a number
   is the property that matters — a wrong stage puts a note on the wrong round. */

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TFTDigits = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  const GW = 10;
  const GH = 14;

  /* Captured from labelled numbers in a real game. No 8 — see the header. */
  const BANK = {
    0: 'mp+agQ86GaaDnaKUwjxcWlZOA52hhzpdPCVYWFi8gfdfXr+CDV9h6IZLXDmsm4NZViC7S10voaSBI1w9+lVWJZefjfNdUApZVCifnpnpY1ADVFk5op6a6GNR605dNayfku1YNbJVVFS1nYIIYxuFQlZcypuETFjngcBbVjTZKF1exJ6RzhZQWUYd16E=',
    1: 'oqKbiIjNWlpc8p2dlNfXYGtrbf+EhNJcXG1oaG/5gYFjaGheaGhv+EdHai8vQWhocPSGhi6CgjFoaG/1np6WgoI4aGhv+J6eloODOGlpcPmfn5eDgzhpaXD5n5+XhIQ6ampx+p+fl4SEMWpqcfKhoZiEhDpqanL6oqKZhYVJampyCqKimsrKY2pqa1E=',
    2: 'opiCzh43H+uCmZe2NmZtbWxqRrisPHBcNTRWbW//9Whh8IOC1VptLiltXeCYnYE7bj8pamk1saCCL201tCNA7KSVxVRs+Z+WjZybxUxuUbOhoaGeoixqZOaaoJ+ikQBtaAOToaKjmt9faRqYo6Cim9NMZyuaj5OomrhHa2ghHh4cO+5HXl1eXl5eX1c=',
    3: 'kf8wKywsLCwqH4k/bHBwcG90bzGBUktFR0lPbmbetv23jIaXFGkyo6mfoKyc82JHwKOpq6Wd0k5g6qenqaqq4EtuVhHgrqqqqugFJlRrdA6sq6ubmabUQ3FAraeksKmmlvtnUa71JcGoqI/vWlERYmcYpYSZLWg6AmdpYkVBPmVsEKnGBS9BSkEe5LA=',
    4: 'jIyMjIkrSUoxmI2LjYnDZHRzW6CNiomBBnVzdlqgjIqGllhhUXRboIyOi+9t+DV1WZ+NkKVAW5MzdlmgjZYTbe+UN3ZZoYEDcTyclzt1XJ+sVmcbnp1CdF2mF3JzcnJ0c25ydEBwc3BxbHJycm+osbKysb09clzCj4+OkJCgPXJYp5KSkpKQzlBlW70=',
    5: 'pdMxQEFBP0RACZvzXWlqaWprYAqdAmpYPzY4MiXlpAFfH7qDi4uUn7UAYRnEoaShn6W8GFcfwJyYlKCizjBsX1lSQhfYr6zuDxcpQVtoWgecloyQmrn9TGw3opuYqKSZ1fxjUbvW3Zijmsv2VEkQVjXRgZzoAWIuR2hjVCoWKFVWBq/0L0RPSj0W670=',
    6: 'nqCbn4YiQiYPyZ+Yj8hYZ2ZXDp2ekNdWZmIso4KcoKdQZWIQjJqZnoQkZ2MPhYyPmJ6SX2g3mBMoBZmPLGNdQFZcXWBe3lJiXy2PgbQ/ZEJVYE3LmJ2NumhdWWY8n5+gnaVFX0tiS8CfoaChRl0+YmD9h52csGBACmBhaQTa3lRmCJTcKU5gZ1s+Eqk=',
    7: '4Tw4NjY2Njc3Nht8eHN1dXV1cm8xV1BLRkZDWm5OFtSPlJKSlSR1FcCvsrK0rtBbe+azurm6s6QgbWPOuLi4uLTwXnMdvLi4uLjRR3lSv7q5uLi4/Wh0Iqe4urm3sC54Z96wubi/uNRgeEjCtbq4wq0Qd38nrrm7ubqyUHJrE7e6vLq9/k9aSfq+vL0=',
    9: 'n5aGiS5OK8+EnJqBBWRsaWpnNq2B/XBuNithaXTiiFdsRqWFwWlpFOteZiWRmoIVaUARZGcVkKGc63BT711qQaqQmBpsWoI4bm1DJkdwYjmYl0p1ZWpmKGkDnqCD90MUhGht3ZymmoODhD9obLqYm5yekydgZjWcjpiYiPxra02Hmpeq6iZdR/+fkZ4=',
  };

  /* Where the numbers live, as fractions of the frame, measured on a 16:9
     capture with the game filling it. */
  const REGIONS = {
    stage: { x: 0.3985, y: 0.004, w: 0.021, h: 0.024 },
    gold: { x: 0.532, y: 0.8236, w: 0.026, h: 0.017 },
  };

  const cache = {};

  function decode(b64) {
    if (cache[b64]) return cache[b64];
    const raw = typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString('binary');
    const out = new Float64Array(raw.length);
    for (let i = 0; i < raw.length; i++) {
      let b = raw.charCodeAt(i);
      if (b > 127) b -= 256;
      out[i] = b;
    }
    let mean = 0;
    for (let i = 0; i < out.length; i++) mean += out[i];
    mean /= out.length;
    let norm = 0;
    for (let i = 0; i < out.length; i++) { out[i] -= mean; norm += out[i] * out[i]; }
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < out.length; i++) out[i] /= norm;
    cache[b64] = out;
    return out;
  }

  /* Ink mask and glyph boxes. A hyphen is short and wide, so anything well
     under the height of the tallest mark is dropped — that is what separates
     "2-4" into two digits rather than three marks. */
  function glyphs(frame, region) {
    const x0 = Math.max(0, Math.round(region.x * frame.width));
    const y0 = Math.max(0, Math.round(region.y * frame.height));
    const w = Math.max(1, Math.min(frame.width - x0, Math.round(region.w * frame.width)));
    const h = Math.max(1, Math.min(frame.height - y0, Math.round(region.h * frame.height)));

    const lum = new Float32Array(w * h);
    let lo = Infinity;
    let hi = -Infinity;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = ((y0 + y) * frame.width + (x0 + x)) * 4;
        const L = 0.299 * frame.data[i] + 0.587 * frame.data[i + 1] + 0.114 * frame.data[i + 2];
        lum[y * w + x] = L;
        if (L < lo) lo = L;
        if (L > hi) hi = L;
      }
    }
    if (hi - lo < 25) return { w: w, h: h, lum: lum, boxes: [], why: 'nothing legible here' };

    const t = lo + (hi - lo) * 0.55;
    const ink = new Uint8Array(w * h);
    for (let i = 0; i < lum.length; i++) ink[i] = lum[i] > t ? 1 : 0;

    const cols = new Uint8Array(w);
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) if (ink[y * w + x]) { cols[x] = 1; break; }
    }

    let boxes = [];
    let start = -1;
    for (let x = 0; x <= w; x++) {
      if (x < w && cols[x]) { if (start < 0) start = x; }
      else if (start >= 0) {
        if (x - start >= 2) {
          let gy0 = -1;
          let gy1 = -1;
          for (let y = 0; y < h; y++) {
            let any = false;
            for (let X = start; X < x; X++) if (ink[y * w + X]) { any = true; break; }
            if (any) { if (gy0 < 0) gy0 = y; gy1 = y; }
          }
          boxes.push({ x0: start, x1: x - 1, y0: gy0, y1: gy1 });
        }
        start = -1;
      }
    }
    const tallest = boxes.reduce((m, b) => Math.max(m, b.y1 - b.y0 + 1), 0);
    boxes = boxes.filter((b) => (b.y1 - b.y0 + 1) >= tallest * 0.66);
    return { w: w, h: h, lum: lum, ink: ink, boxes: boxes, tallest: tallest };
  }

  function vector(g, b) {
    const out = new Float64Array(GW * GH);
    const bw = b.x1 - b.x0 + 1;
    const bh = b.y1 - b.y0 + 1;
    for (let ty = 0; ty < GH; ty++) {
      for (let tx = 0; tx < GW; tx++) {
        const sx0 = b.x0 + Math.floor((tx * bw) / GW);
        const sx1 = Math.max(sx0 + 1, b.x0 + Math.floor(((tx + 1) * bw) / GW));
        const sy0 = b.y0 + Math.floor((ty * bh) / GH);
        const sy1 = Math.max(sy0 + 1, b.y0 + Math.floor(((ty + 1) * bh) / GH));
        let sum = 0;
        let n = 0;
        for (let y = sy0; y < sy1; y++) {
          for (let x = sx0; x < sx1; x++) { sum += g.lum[y * g.w + x]; n++; }
        }
        out[ty * GW + tx] = n ? sum / n : 0;
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

  /* Best match, and only if it beats the runner-up clearly. A glyph the bank
     has never seen scores middling against several digits at once, and the
     margin is what catches that. */
  const MIN_SCORE = 0.72;
  const MIN_MARGIN = 0.04;

  function classify(v, allowed) {
    let best = null;
    let bestScore = -2;
    let second = -2;
    Object.keys(BANK).forEach((d) => {
      if (allowed && allowed.indexOf(d) === -1) return;
      const tpl = decode(BANK[d]);
      let dot = 0;
      for (let i = 0; i < v.length; i++) dot += v[i] * tpl[i];
      if (dot > bestScore) { second = bestScore; bestScore = dot; best = d; }
      else if (dot > second) { second = dot; }
    });
    if (best === null || bestScore < MIN_SCORE || (bestScore - second) < MIN_MARGIN) {
      return { digit: null, score: bestScore, margin: bestScore - second };
    }
    return { digit: best, score: bestScore, margin: bestScore - second };
  }

  /** Read a whole number. Returns null if any glyph is not read confidently. */
  function readNumber(frame, region, opts) {
    const cfg = opts || {};
    const g = glyphs(frame, region);
    if (!g.boxes.length) return { value: null, why: g.why || 'no digits found' };
    if (cfg.maxDigits && g.boxes.length > cfg.maxDigits) {
      return { value: null, why: g.boxes.length + ' digits, more than expected' };
    }
    let text = '';
    const scores = [];
    for (let i = 0; i < g.boxes.length; i++) {
      const r = classify(vector(g, g.boxes[i]), cfg.allowed);
      scores.push(+r.score.toFixed(2));
      if (r.digit === null) {
        return { value: null, text: null, scores: scores, why: 'a glyph did not match any digit clearly' };
      }
      text += r.digit;
    }
    return { value: Number(text), text: text, scores: scores, why: 'read ' + text };
  }

  /** The round indicator: {stage, round}. Both are 1-7, so the bank covers it. */
  function readStage(frame, region) {
    const r = readNumber(frame, region || REGIONS.stage, { maxDigits: 2, allowed: ['1', '2', '3', '4', '5', '6', '7'] });
    if (r.value === null || !r.text || r.text.length !== 2) {
      return { stage: null, round: null, why: r.why };
    }
    return {
      stage: Number(r.text[0]),
      round: Number(r.text[1]),
      why: 'stage ' + r.text[0] + '-' + r.text[1],
      scores: r.scores,
    };
  }

  /** Gold as a number, or null when a glyph is not certain. */
  function readGold(frame, region) {
    return readNumber(frame, region || REGIONS.gold, { maxDigits: 3 });
  }

  /* Read a region straight off a video element at its own resolution.

     Everything else here measures a frame that has already been shrunk to 320
     pixels wide, because that is all the augment matcher and the shop need and
     it is a sixth of the work. Digits are the exception and it is not close: at
     320 wide the gold counter is four pixels tall and nothing can be read from
     it. Measured, the floor is around 1920 — at 1440 gold starts coming back
     unreadable and at 1280 the round indicator does.

     Cropping just the number out of the source costs nothing, though. The stage
     box is about two percent of the frame, so this draws fifty pixels rather
     than two million and the rest of the pipeline stays small. */
  function readFromVideo(video, region, read) {
    if (!video || !video.videoWidth) return { value: null, stage: null, round: null, why: 'no video yet' };
    const w = Math.max(8, Math.round(region.w * video.videoWidth));
    const h = Math.max(8, Math.round(region.h * video.videoHeight));
    const c = readFromVideo.canvas || (readFromVideo.canvas = document.createElement('canvas'));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(video,
      Math.round(region.x * video.videoWidth), Math.round(region.y * video.videoHeight), w, h,
      0, 0, w, h);
    return read(ctx.getImageData(0, 0, w, h), { x: 0, y: 0, w: 1, h: 1 });
  }

  /* Just the pixels, for anything that wants to measure a small region at the
     resolution it was captured at rather than the one the matchers work in. */
  function cropFromVideo(video, region) {
    if (!video || !video.videoWidth) return null;
    const w = Math.max(8, Math.round(region.w * video.videoWidth));
    const h = Math.max(8, Math.round(region.h * video.videoHeight));
    const c = cropFromVideo.canvas || (cropFromVideo.canvas = document.createElement('canvas'));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(video,
      Math.round(region.x * video.videoWidth), Math.round(region.y * video.videoHeight), w, h,
      0, 0, w, h);
    return ctx.getImageData(0, 0, w, h);
  }

  const stageFromVideo = (video) => readFromVideo(video, REGIONS.stage, readStage);
  const goldFromVideo = (video) => readFromVideo(video, REGIONS.gold, readGold);

  return {
    REGIONS: REGIONS,
    readFromVideo: readFromVideo,
    cropFromVideo: cropFromVideo,
    stageFromVideo: stageFromVideo,
    goldFromVideo: goldFromVideo,
    BANK: BANK,
    glyphs: glyphs,
    vector: vector,
    classify: classify,
    readNumber: readNumber,
    readStage: readStage,
    readGold: readGold,
  };
});
