/* What the shop model is checked against.

   Two halves, tested differently.

   The cost classifier is checked against readings measured off real footage and
   labelled by eye from the same frames — Yorick and Veigar at 1, Alistar and
   Teemo at 2, Master Yi at 3, Brambleback at 4, Elder Dragon at 5. Those numbers
   are the evidence, so they live here rather than in a comment.

   The change detector is checked against constructed rows, because what it has
   to get right is a rule about which slots moved together, and a drawn row
   exercises that exactly. The one case that was only ever synthetic — a slot
   surviving a reroll, which is the lock rule itself — has since been confirmed
   on real footage: at 13:04 of the second game the row went from
   [empty, Veigar, Cinderling, Yorick, Ornn] to [Mama Beak, Kayle, Karma,
   Veigar, Ornn], and it reported slot 5 held. Ornn, in both. A purchase is one slot emptying with the rest
   untouched; a reroll is most of the row changing at once; a locked slot is
   whatever came through a reroll unchanged. The cases that matter most are the
   ones where it must stay silent: a shop mid-fade, and the sell bar.

   node lib/shop.test.js, or the Self test button on the lab page. */

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TFTShopTest = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  const S = (typeof window !== 'undefined' && window.TFTShop)
    || (typeof require === 'function' ? require('./shop.js') : null);

  /* Measured on the reference stream, labelled from the same frames. */
  const READINGS = [
    { at: '15:00', want: [null, 3, 1, 2], hue: [172, 210, 194, 149], sat: [0.65, 0.58, 0.43, 0.55], lum: [8, 51, 44, 51] },
    { at: '19:40', want: [2, 3, 1, 1, 2], hue: [158, 216, 185, 203, 126], sat: [0.57, 0.54, 0.39, 0.39, 0.59], lum: [50, 55, 46, 43, 60] },
    { at: '60:00', want: [1, 5, 3, 3, 4], hue: [176, 40, 210, 207, 272], sat: [0.35, 0.67, 0.54, 0.57, 0.66], lum: [48, 99, 58, 51, 61] },
    /* The sell bar that replaces the shop while a unit is being dragged. Without
       a luminance floor this reads as a row of 1-costs. */
    { at: 'sell bar', want: [null, null, null, null], hue: [188, 189, 189, 189], sat: [0.30, 0.30, 0.30, 0.31], lum: [20, 20, 20, 20] },

    /* The same measurements off a clean 1080p capture, labelled from the card
       names. These matter more than the 360p ones: they are what the tournament
       will actually look like, and they are what moved the 1-versus-3 line. At
       this resolution a 1-cost tops out at 0.47 and a 3-cost starts at 0.56,
       where the first threshold sat at 0.48 — inside a hundredth of a real card. */
    { at: '10:00 Ornn/LeBlanc/Varus/RekSai/Xayah', want: [1, 2, 1, 1, 1], hue: [211, 153, 209, 212, 209], sat: [0.35, 0.62, 0.47, 0.34, 0.46], lum: [64, 63, 47, 67, 54] },
    { at: '09:01 Veigar/Murkwolf/Murkwolf/Fiddlesticks', want: [1, 2, 2, 3, null], hue: [210, 148, 149, 213, 180], sat: [0.46, 0.62, 0.61, 0.57, 0.69], lum: [55, 60, 60, 52, 9] },
    { at: '15:17 Gromp/-/Xayah/Gromp/Akali', want: [2, null, 1, 2, 1], hue: [150, 178, 210, 150, 209], sat: [0.63, 0.68, 0.35, 0.64, 0.45], lum: [58, 9, 62, 58, 55] },
    { at: '17:38 Cassiopeia/Rammus/Scuttlecrab/Fiddlesticks/Hecarim', want: [3, 3, 2, 3, 3], hue: [212, 213, 149, 212, 214], sat: [0.58, 0.59, 0.61, 0.57, 0.56], lum: [52, 52, 60, 52, 51] },
  ];

  /* A row built by hand. `spec` is one entry per slot: a number is a card of
     that cost, null is an empty slot, and `art` distinguishes two cards of the
     same cost so a reroll that keeps the cost but changes the champion still
     counts as a change. */
  function row(spec) {
    return {
      slots: spec.map(function (s, i) {
        const empty = s === null || s === undefined;
        const art = empty ? 0 : (typeof s === 'object' ? s.art : s * 7 + i);
        const cost = empty ? null : (typeof s === 'object' ? s.cost : s);
        const sig = new Float32Array(8 * 6);
        /* A deterministic pattern per art value, normalised the way a real
           signature is, so `same` behaves as it would on real frames. */
        let mean = 0;
        for (let k = 0; k < sig.length; k++) { sig[k] = Math.sin((k + 1) * (art + 1)); mean += sig[k]; }
        mean /= sig.length;
        let norm = 0;
        for (let k = 0; k < sig.length; k++) { sig[k] -= mean; norm += sig[k] * sig[k]; }
        norm = Math.sqrt(norm) || 1;
        for (let k = 0; k < sig.length; k++) sig[k] /= norm;
        return { slot: i + 1, cost: cost, empty: empty, occluded: false, why: '', sig: sig };
      }),
    };
  }

  /* Feed rows through a tracker, repeating each so it settles, and collect what
     comes out. */
  function play(rows) {
    const tr = S.tracker();
    const seen = [];
    let t = 0;
    rows.forEach(function (r) {
      for (let i = 0; i < 2; i++) {
        tr.push(r, t).forEach(function (e) { seen.push(e); });
        t += 0.5;
      }
    });
    return seen;
  }

  function run(log) {
    const say = log || function (s) { console.log(s); };
    let pass = 0;
    let fail = 0;

    function is(name, got, want) {
      const ok = got === want;
      if (ok) pass++; else fail++;
      say((ok ? '  ok   ' : '  FAIL ') + name + (ok ? '' : '  (got ' + got + ', wanted ' + want + ')'));
    }

    say('cost from the colour of the name bar');
    READINGS.forEach(function (r) {
      r.want.forEach(function (want, i) {
        const got = S.classify({ hue: r.hue[i], sat: r.sat[i], lum: r.lum[i] });
        is(r.at + ' slot ' + (i + 1) + ' reads ' + (want === null ? 'as no card' : want),
          got.empty ? null : got.cost, want);
      });
    });

    say('what changed between two readings');
    is('a card leaving one slot is a buy',
      (play([row([1, 2, 3, 4, 5]), row([null, 2, 3, 4, 5])])[0] || {}).kind, 'buy');
    is('and it knows what it cost',
      (play([row([1, 2, 3, 4, 5]), row([1, 2, null, 4, 5])])[0] || {}).cost, 3);
    is('the whole row changing is a reroll',
      (play([row([1, 2, 3, 4, 5]), row([2, 3, 4, 5, 1])])[0] || {}).kind, 'reroll');
    is('a slot that survives a reroll is the locked one',
      (play([row([1, 2, 3, 4, 5]), row([2, 2, 4, 5, 1])])[0] || {}).kept.join(','), '2');
    is('a reroll that holds nothing says so',
      (play([row([1, 2, 3, 4, 5]), row([2, 3, 4, 5, 1])])[0] || {}).kept.length, 0);
    is('a card replaced by another of the same cost still counts as changed',
      (play([row([1, 2, 3, 4, 5]), row([{ cost: 1, art: 99 }, { cost: 2, art: 98 }, { cost: 3, art: 97 }, 4, 5])])[0] || {}).kind, 'reroll');

    say('when it must stay silent');
    is('an unchanged shop reports nothing',
      play([row([1, 2, 3, 4, 5]), row([1, 2, 3, 4, 5])]).length, 0);
    is('the sell bar reports nothing',
      play([row([1, 2, 3, 4, 5]), row([null, null, null, null, null])]).length, 0);
    is('a shop with nothing readable in it reports nothing',
      play([row([1, 2, 3, 4, 5]), { slots: row([1, 2, 3, 4, 5]).slots.map(function (s) {
        return Object.assign({}, s, { cost: null, empty: false });
      }) }]).length, 0);

    /* A transition is frames that disagree with each other. Nothing should ever
       commit off one, which is what stopped sixteen invented rerolls. */
    const flicker = [];
    for (let i = 0; i < 8; i++) flicker.push(row(i % 2 ? [1, 2, 3, 4, 5] : [5, 4, 3, 2, 1]));
    const tr = S.tracker();
    let fromFlicker = 0;
    flicker.forEach(function (r, i) { fromFlicker += tr.push(r, i).length; });
    is('a row that never holds still reports nothing', fromFlicker, 0);

    say(pass + ' passed, ' + fail + ' failed');
    return { pass: pass, fail: fail };
  }

  return { run: run, row: row, play: play, READINGS: READINGS };
});

if (typeof module === 'object' && module.exports && typeof require === 'function' && require.main === module) {
  const r = module.exports.run();
  process.exit(r.fail ? 1 : 0);
}
