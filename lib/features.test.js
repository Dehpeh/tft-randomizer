/* What the feature detectors are actually checked against.

   These draw the shapes rather than photograph them: a zero rasterised from a
   5x7 font, a trait strip with n hexagons lit, three pips in a row. That tests
   the geometry — one glyph, closed hole, ring balanced above and below; warm and
   saturated versus grey; three level blobs evenly spaced — and it tests nothing
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

  /* The trait strip with the first `lit` hexagons activated (bronze) and the
     rest grey. */
  function strip(lit) {
    const W = 20;
    const H = 96;
    const data = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < W * H; i++) {
      const row = Math.floor(i / W);
      const inHex = (row % 16) < 12;
      const active = lit > 0 && inHex && Math.floor(row / 16) < lit;
      data[i * 4] = active ? 205 : 70;
      data[i * 4 + 1] = active ? 150 : 70;
      data[i * 4 + 2] = active ? 45 : 74;
      data[i * 4 + 3] = 255;
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

    /* Capture size is whatever the player's monitor and the browser's scaling
       happen to produce, so the same answer has to come out at every size. */
    [2, 3, 5, 8, 12].forEach((s) => is('zero at scale ' + s, F.goldIsZero(plate('0', s), WHOLE).ok, true));
    [2, 3, 5, 8, 12].forEach((s) => is('eight at scale ' + s, F.goldIsZero(plate('8', s), WHOLE).ok, false));

    say('no active traits');
    is('all grey reads as nothing active', F.traitsActive(strip(0), WHOLE).active, false);
    is('one lit hex reads as active', F.traitsActive(strip(1), WHOLE).active, true);
    is('three lit reads as active', F.traitsActive(strip(3), WHOLE).active, true);
    say('         grey strip ' + (F.traitsActive(strip(0), WHOLE).share * 100).toFixed(1)
      + '% coloured, one lit ' + (F.traitsActive(strip(1), WHOLE).share * 100).toFixed(1) + '%');

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

  return { run: run, plate: plate, strip: strip, board: board };
});

if (typeof module === 'object' && module.exports && typeof require === 'function' && require.main === module) {
  const r = module.exports.run();
  process.exit(r.fail ? 1 : 0);
}
