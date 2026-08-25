/* What the feature detectors are actually checked against.

   These draw the shapes rather than photograph them: a zero rasterised from a
   5x7 font, a trait panel with n hexagons lit, three pips in a row. That tests
   the geometry — one glyph, closed hole, ring balanced above and below; a
   hexagon brighter than the gap beneath it; three level blobs evenly spaced —
   and it tests nothing
   at all about TFT's font, its antialiasing, or its compression. Passing here
   means the algorithm does what it claims. Whether the thing on screen is the
   shape it expects is a question only footage answers, in /lab.

   node lib/features.test.js, or the Self test button on the lab page. */

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TFTFeaturesTest = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  const F = (typeof window !== 'undefined' && window.TFTFeatures)
    || (typeof require === 'function' ? require('./features.js') : null);

  /* Enough of a font to have real topology: closed counters in 0/4/6/8/9, open
     shapes in 1/2/3/5/7. The 4 is the awkward one and is in here on purpose. */
  const FONT = {
    0: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
    1: ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
    2: ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
    3: ['11111', '00010', '00100', '00010', '00001', '10001', '01110'],
    4: ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
    5: ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
    6: ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
    7: ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
    8: ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
    9: ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  };

  /* One capture of the gold plate: dark background, gold text, scaled up the way
     a real screenshot would be. The region under test is the whole thing. */
  function plate(text, scale, pad) {
    scale = scale || 3;
    pad = pad === undefined ? 4 : pad;
    const gw = 5 * scale;
    const gh = 7 * scale;
    const gap = scale;
    const W = pad * 2 + text.length * gw + (text.length - 1) * gap;
    const H = pad * 2 + gh;
    const data = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < W * H; i++) {
      data[i * 4] = 30; data[i * 4 + 1] = 28; data[i * 4 + 2] = 26; data[i * 4 + 3] = 255;
    }
    text.split('').forEach((ch, n) => {
      const rows = FONT[ch];
      const ox = pad + n * (gw + gap);
      for (let y = 0; y < 7; y++) {
        for (let x = 0; x < 5; x++) {
          if (rows[y][x] !== '1') continue;
          for (let dy = 0; dy < scale; dy++) {
            for (let dx = 0; dx < scale; dx++) {
              const i = ((pad + y * scale + dy) * W + (ox + x * scale + dx)) * 4;
              data[i] = 240; data[i + 1] = 225; data[i + 2] = 150;
            }
          }
        }
      }
    });
    return { width: W, height: H, data };
  }

  /* A trait panel drawn at the real geometry. `n` lit hexagons at the top, the
     rest grey, over a background of `bg`.

     The background matters more than anything else here. The panel is
     translucent, and the previous rule — comparing a hexagon against the gap
     under it — passed every test drawn over a mid-tone board and then read nine
     active traits as zero over a bright sky. So the same panel is tested over
     dark, mid and bright ground, and over a strongly coloured one. */
  function panel(n, bg, bgSat) {
    const W = 1920;
    const H = 1080;
    const T = F.TRAITS;
    const base = bg === undefined ? 60 : bg;
    const data = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < W * H; i++) {
      /* A coloured background, when asked for, so the test can show the answer
         does not come from the board behind the panel. */
      data[i * 4] = base;
      data[i * 4 + 1] = bgSat ? Math.round(base * 0.45) : base;
      data[i * 4 + 2] = bgSat ? Math.round(base * 0.3) : base;
      data[i * 4 + 3] = 255;
    }

    const x0 = Math.round(T.x0 * W) - 2;
    const x1 = Math.round(T.x1 * W) + 2;
    for (let row = 0; row < T.rows; row++) {
      const cy = T.y0 + row * T.pitch + T.pitch * 0.4;
      const top = Math.round((cy - T.pitch * 0.34) * H);
      const bot = Math.round((cy + T.pitch * 0.34) * H);
      const lit = row < n;
      for (let y = top; y < bot; y++) {
        for (let x = x0; x < x1; x++) {
          const k = (y * W + x) * 4;
          if (lit) { data[k] = 205; data[k + 1] = 140; data[k + 2] = 55; }   // bronze
          else { data[k] = 74; data[k + 1] = 74; data[k + 2] = 78; }         // grey
        }
      }
    }
    return { width: W, height: H, data };
  }

  /* A board with `pips` gold dots in a row, optionally knocking the middle one
     out of line. */
  function board(pips, gap, jitterY) {
    gap = gap || 6;
    jitterY = jitterY || 0;
    const W = 200;
    const H = 120;
    const data = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < W * H; i++) {
      data[i * 4] = 40; data[i * 4 + 1] = 55; data[i * 4 + 2] = 70; data[i * 4 + 3] = 255;
    }
    for (let n = 0; n < pips; n++) {
      const cx = 80 + n * gap;
      const cy = 40 + (n === 1 ? jitterY : 0);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const i = ((cy + dy) * W + cx + dx) * 4;
          data[i] = 255; data[i + 1] = 205; data[i + 2] = 60;
        }
      }
    }
    return { width: W, height: H, data };
  }

  const WHOLE = { x: 0, y: 0, w: 1, h: 1 };

  function run(log) {
    const say = log || function (s) { console.log(s); };
    let pass = 0;
    let fail = 0;

    function is(name, got, want) {
      const ok = got === want;
      if (ok) pass++; else fail++;
      say((ok ? '  ok   ' : '  FAIL ') + name + (ok ? '' : '  (got ' + got + ', wanted ' + want + ')'));
    }

    say('gold at zero');
    ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'].forEach((d) => {
      is('"' + d + '"' + (d === '0' ? ' is' : ' is not') + ' a lone zero',
        F.goldIsZero(plate(d), WHOLE).ok, d === '0');
    });
    ['10', '20', '48', '60', '80'].forEach((d) => {
      is('"' + d + '" is not a lone zero', F.goldIsZero(plate(d), WHOLE).ok, false);
    });
    const flat = { width: 40, height: 30, data: new Uint8ClampedArray(40 * 30 * 4).fill(20) };
    is('an empty plate reads as nothing', F.goldIsZero(flat, WHOLE).ok, false);

    /* The shapes that fooled it on real footage, drawn here so they stay fooled.
       A four encloses a small triangle high in the glyph and a six encloses one
       low down; only a zero's ring runs the height of it, centred. Balance alone
       let a four through and real gold of 44 read as a round number. */
    is('a hole high in the glyph is not a zero', F.goldIsZero(plate('4'), WHOLE).ok, false);
    is('a hole low in the glyph is not a zero', F.goldIsZero(plate('6'), WHOLE).ok, false);
    is('"44" is not two digits ending in a zero', F.goldAtThreshold(plate('44'), WHOLE).ok, false);
    is('"46" is not either', F.goldAtThreshold(plate('46'), WHOLE).ok, false);
    is('"10" is', F.goldAtThreshold(plate('10'), WHOLE).ok, true);
    is('"20" is', F.goldAtThreshold(plate('20'), WHOLE).ok, true);
    is('"25" is not', F.goldAtThreshold(plate('25'), WHOLE).ok, false);
    is('"100" is three digits, so not a named threshold', F.goldAtThreshold(plate('100'), WHOLE).ok, false);

    /* Capture size is whatever the player's monitor and the browser's scaling
       happen to produce, so the same answer has to come out at every size. */
    [2, 3, 5, 8, 12].forEach((s) => is('zero at scale ' + s, F.goldIsZero(plate('0', s), WHOLE).ok, true));
    [2, 3, 5, 8, 12].forEach((s) => is('eight at scale ' + s, F.goldIsZero(plate('8', s), WHOLE).ok, false));

    say('the trait panel');
    is('a panel with nothing lit is nothing active', F.traitsActive(panel(0)).active, false);
    is('one lit hexagon is active', F.traitsActive(panel(1)).active, true);
    [1, 3, 5, 7, 9].forEach((n) => is(n + ' lit counts ' + n, F.litTraits(panel(n)).count, n));

    /* The board behind the panel is anything from a dark cave to a bright sky,
       and a real frame over bright sky is what broke the previous rule. */
    [25, 60, 120, 200, 240].forEach((bg) => {
      is('4 lit still counts 4 over a background of ' + bg, F.litTraits(panel(4, bg)).count, 4);
      is('nothing lit stays nothing over a background of ' + bg, F.traitsActive(panel(0, bg)).active, false);
    });

    /* A strongly coloured board behind a grey hexagon must not make it active. */
    is('a coloured board does not light a grey panel', F.traitsActive(panel(0, 150, true)).active, false);
    is('and does not inflate a real count', F.litTraits(panel(3, 150, true)).count, 3);

    say('three-star pips');
    is('three level pips are found', F.threeStar(board(3), WHOLE).ok, true);
    is('two pips are not', F.threeStar(board(2), WHOLE).ok, false);
    is('one pip is not', F.threeStar(board(1), WHOLE).ok, false);
    is('a bare board is not', F.threeStar(board(0), WHOLE).ok, false);
    is('three pips out of line are not', F.threeStar(board(3, 6, 9), WHOLE).ok, false);
    is('four pips still contain a row', F.threeStar(board(4), WHOLE).ok, true);

    say(pass + ' passed, ' + fail + ' failed');
    return { pass: pass, fail: fail };
  }

  return { run: run, plate: plate, panel: panel, board: board };
});

if (typeof module === 'object' && module.exports && typeof require === 'function' && require.main === module) {
  const r = module.exports.run();
  process.exit(r.fail ? 1 : 0);
}
