/* What the gamemaster actually reads, checked without playing a game.

   The detector half was always testable and the writing half was not, which is
   how a live lobby got ten augment notes for one screen with every one labelled
   4-2. Notes are decided here — which stage it was, whether anybody's
   restriction cares, whether this is the third time of saying the same thing —
   so this feeds events in and reads notes out.

   node lib/notes.test.js */

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TFTNotesTest = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  const dep = (name, path) => (typeof window !== 'undefined' && window[name])
    || (typeof require === 'function' ? require(path) : null);

  function play(picks, events) {
    const N = dep('TFTNotes', './notes.js');
    const rules = N.rulesFrom(picks, (p) => p.details || []);
    const book = N.createNotebook({ rules: rules });
    const out = [];
    events.forEach((e) => book.push(e).forEach((n) => out.push(n)));
    return out;
  }

  const lock = (slot) => ({ id: 'mn-shoplock', details: [{ label: 'Shop slot', value: slot + 'th slot' }] });
  const costban = { id: 'mn-costban', details: [] };
  const forcebuy = { id: 'mn-forcebuy', details: [] };
  const carousel = (stages) => ({ id: 'mn-carousel', details: [{ label: 'Stages', value: stages }] });
  const augment = (at, take) => ({ id: 'mn-augment', details: [{ label: 'At', value: at }, { label: 'Take', value: take }] });

  const text = (notes) => notes.map((n) => n.note).join(' | ');

  function run(log) {
    const say = log || function (s) { console.log(s); };
    let pass = 0;
    let fail = 0;
    function is(name, got, want) {
      const ok = got === want;
      if (ok) pass++; else fail++;
      say((ok ? '  ok   ' : '  FAIL ') + name + (ok ? '' : '\n         got:    ' + got + '\n         wanted: ' + want));
    }
    function has(name, notes, needle) {
      const ok = text(notes).indexOf(needle) > -1;
      if (ok) pass++; else fail++;
      say((ok ? '  ok   ' : '  FAIL ') + name + (ok ? '' : '\n         in: ' + (text(notes) || '(nothing)')));
    }
    function hasnt(name, notes, needle) {
      const ok = text(notes).indexOf(needle) === -1;
      if (ok) pass++; else fail++;
      say((ok ? '  ok   ' : '  FAIL ') + name + (ok ? '' : '\n         in: ' + text(notes)));
    }

    say('nobody is told about a rule they do not have');
    is('a shop reroll is silent without a shop restriction',
      play([], [{ kind: 'shop-reroll', at: 10, kept: [], offered: [1, 1, 1, 1, 1], wasOffered: [1, 1, 1, 1, 1] }]).length, 0);
    is('a 5-cost purchase is silent when 5-costs are allowed',
      play([], [{ kind: 'shop-buy', at: 10, slot: 1, cost: 5, stage: 3, round: 2 }]).length, 0);
    is('a carousel is silent when carousels are allowed',
      play([], [{ kind: 'stage', at: 10, stage: 3, round: 4 }]).length, 0);

    say('the stage is read, not counted');
    has('an augment note names the round it read',
      play([augment('2-1', 'left')], [{ kind: 'augment-open', at: 10, stage: 2, round: 1 }]), '2-1 · your roll said left');
    has('and quotes nothing when the roll was for another stage',
      play([augment('2-1', 'left')], [{ kind: 'augment-open', at: 10, stage: 4, round: 2 }]), '4-2 · nothing rolled');
    has('a capture too small to read says so rather than guessing',
      play([augment('2-1', 'left')], [{ kind: 'augment-open', at: 10 }]), 'counted, the round indicator was not readable');

    /* The live failure this whole layer exists for: a detector reporting one
       screen twice used to walk the counter past three. Reading the indicator
       means a repeat lands on the same stage instead. */
    const twice = play([augment('2-1', 'left')], [
      { kind: 'augment-open', at: 10, stage: 2, round: 1 },
      { kind: 'augment-take', at: 30, openFor: 20, stage: 2, round: 1 },
      { kind: 'augment-open', at: 40, stage: 2, round: 1 },
    ]);
    is('a repeated screen stays on the stage it is actually on',
      twice.filter((n) => n.note.indexOf('2-1') > -1).length, 3);

    say('the cost ban knows when it lifts');
    has('a 5-cost before stage 5 is flagged, with the round',
      play([costban], [{ kind: 'shop-buy', at: 10, slot: 2, cost: 5, stage: 3, round: 6 }]), 'at 3-6');
    is('a 5-cost at stage 5 is not flagged at all',
      play([costban], [{ kind: 'shop-buy', at: 10, slot: 2, cost: 5, stage: 5, round: 2 }]).length, 0);
    is('nor at stage 6',
      play([costban], [{ kind: 'shop-buy', at: 10, slot: 2, cost: 5, stage: 6, round: 1 }]).length, 0);
    has('an unreadable stage says so instead of assuming',
      play([costban], [{ kind: 'shop-buy', at: 10, slot: 2, cost: 5 }]), 'stage unreadable');

    say('the carousel is the stage-4 round');
    has('a banned carousel stage is flagged',
      play([carousel('3 and 4')], [{ kind: 'stage', at: 10, stage: 3, round: 4 }]), 'Carousel at 3-4');
    is('a carousel outside the banned pair is not',
      play([carousel('3 and 4')], [{ kind: 'stage', at: 10, stage: 5, round: 4 }]).length, 0);
    is('and an ordinary round is not a carousel',
      play([carousel('3 and 4')], [{ kind: 'stage', at: 10, stage: 3, round: 2 }]).length, 0);
    has('the major bans every carousel',
      play([{ id: 'mj-carousel', details: [] }], [{ kind: 'stage', at: 10, stage: 6, round: 4 }]), 'Carousel at 6-4');

    say('the shop rules');
    has('a slot that did not survive a reroll is the lock rule itself',
      play([lock(3)], [{ kind: 'shop-reroll', at: 10, kept: [1], offered: [1, 1, 1, 1, 1], wasOffered: [1, 1, 1, 1, 1] }]),
      'slot 3 did not hold');
    is('and a reroll that held it is silent',
      play([lock(3)], [{ kind: 'shop-reroll', at: 10, kept: [3], offered: [1, 1, 1, 1, 1], wasOffered: [1, 1, 1, 1, 1] }]).length, 0);
    has('passing up 1-costs counts them rather than listing them',
      play([forcebuy], [{ kind: 'shop-reroll', at: 10, kept: [], offered: [2, 2, 2, 2, 2], wasOffered: [1, 1, 1, 1, 2] }]),
      '4 1-costs still in it');
    has('and says "a" for one of them',
      play([forcebuy], [{ kind: 'shop-reroll', at: 10, kept: [], offered: [2, 2, 2, 2, 2], wasOffered: [1, 2, 2, 2, 2] }]),
      'a 1-cost still in it');

    say('nothing says the same thing twice, and a cap says it is a cap');
    const many = [];
    for (let i = 0; i < 12; i++) many.push({ kind: 'shop-buy', at: i * 40, slot: 1, cost: 5, stage: 3, round: 2 });
    const capped = play([costban], many);
    is('a busy game does not bury the feed', capped.length <= 9, true);
    has('and the last one says so', capped, 'the last of these this game');

    const rapid = [];
    for (let i = 0; i < 6; i++) rapid.push({ kind: 'shop-buy', at: i * 2, slot: 1, cost: 5, stage: 3, round: 2 });
    is('six purchases in twelve seconds make one note', play([costban], rapid).length, 1);

    say(pass + ' passed, ' + fail + ' failed');
    return { pass: pass, fail: fail };
  }

  return { run: run, play: play };
});

if (typeof module === 'object' && module.exports && typeof require === 'function' && require.main === module) {
  const r = module.exports.run();
  process.exit(r.fail ? 1 : 0);
}
