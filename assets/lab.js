/* The lab: measure the proctor instead of trusting it.

   Two ways to find out whether the detector works, neither of which needs a
   live tournament:

     1. A self test on synthetic frames. It proves the state machine fires in
        the right order and names the right card. It proves nothing about real
        TFT — no synthetic frame looks like a real one — but it catches the
        class of bug where the logic was simply wrong.

     2. A replay of an actual recording. Same detector, fed by seeking through a
        video file a fixed step at a time, which makes the run deterministic and
        repeatable: change a threshold, run the same file again, compare like
        with like. Add what really happened and it scores itself.

   Nothing here talks to the server, and the video is never uploaded. */
(function () {
  const D = window.TFTDetect;
  const $ = (id) => document.getElementById(id);
  const toast = (msg) => window.TFTUI.toast(msg);

  const ANALYSIS_W = 320;

  const state = {
    file: null,
    running: false,
    events: [],
    truth: [],
    region: Object.assign({}, D.DEFAULTS.region),
    duration: 0,
  };

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const clock = (s) => String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(Math.floor(s % 60)).padStart(2, '0');

  const video = $('lab');
  const overlay = $('labOverlay');
  const work = document.createElement('canvas');
  const wctx = work.getContext('2d', { willReadFrequently: true });

  function frameAt() {
    const w = video.videoWidth || 16;
    const h = Math.round(ANALYSIS_W * ((video.videoHeight || 9) / w));
    work.width = ANALYSIS_W;
    work.height = h;
    wctx.drawImage(video, 0, 0, ANALYSIS_W, h);
    return wctx.getImageData(0, 0, ANALYSIS_W, h);
  }

  /* ---------- self test ----------
     Frames are built rather than filmed, so every expectation below is exact.
     The sequence is: play, go still, play again, open an overlay, animate the
     middle card, close it. */

  function synthetic() {
    const c = document.createElement('canvas');
    c.width = 320;
    c.height = 180;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    const r = D.DEFAULTS.region;
    const bx = r.x * 320;
    const by = r.y * 180;
    const bw = r.w * 320;
    const bh = r.h * 180;

    return function draw(kind, tick) {
      ctx.fillStyle = '#101820';
      ctx.fillRect(0, 0, 320, 180);

      if (kind === 'play') {
        // Busy board: enough change frame to frame to read as activity.
        ctx.fillStyle = tick % 2 ? '#3d5a80' : '#98c1d9';
        ctx.fillRect(20 + (tick * 7) % 200, 120, 60, 40);
      }

      if (kind === 'still') {
        ctx.fillStyle = '#3d5a80';
        ctx.fillRect(40, 120, 60, 40);
      }

      if (kind === 'overlay' || kind === 'pick') {
        const cardW = bw / 3.4;
        [0, 1, 2].forEach((i) => {
          const x = bx + i * (bw / 3) + (bw / 3 - cardW) / 2;
          // The picked card pulses; the other two sit still.
          /* A modest brightening, the way a hover or a selection actually
             reads. Flashing it hard would make the test easier than reality. */
          const lit = kind === 'pick' && i === 1 && tick % 2;
          ctx.fillStyle = lit ? '#6e6e6e' : '#2d2d2d';
          ctx.fillRect(x, by + 10, cardW, bh - 20);
        });
      }

      return ctx.getImageData(0, 0, 320, 180);
    };
  }

  $('selfTest').addEventListener('click', () => {
    const draw = synthetic();
    const det = D.createDetector({});
    const seen = [];
    let t = 0;
    const step = 0.5;

    const script = [
      ['play', 10],      // 10s of ordinary play
      ['still', 30],     // 30s frozen — should trip at 20
      ['play', 5],       // moving again — the spell closes
      ['overlay', 1],    // the overlay appears
      ['pick', 6],       // the middle card animates
      ['play', 6],       // it closes back to the board
    ];

    script.forEach(([kind, seconds]) => {
      const frames = Math.round(seconds / step);
      for (let i = 0; i < frames; i++) {
        det.push(draw(kind, i), t).forEach((e) => seen.push(e));
        t += step;
      }
    });

    const find = (k) => seen.find((e) => e.kind === k);
    const take = find('augment-take');
    const stillStart = find('still-start');
    const stillEnd = find('still-end');

    const checks = [
      ['A still spell is noticed', Boolean(stillStart), stillStart ? `at ${clock(stillStart.at)}` : 'never fired'],
      ['It trips at the threshold, not before', stillStart ? Math.abs(stillStart.seconds - 20) <= 1 : false, stillStart ? `${stillStart.seconds}s` : '—'],
      ['The spell is closed off when play resumes', Boolean(stillEnd), stillEnd ? `${stillEnd.seconds}s total` : 'never fired'],
      ['The overlay opening is seen', Boolean(find('augment-open')), find('augment-open') ? `at ${clock(find('augment-open').at)}` : 'never fired'],
      ['The overlay closing is seen', Boolean(take), take ? `at ${clock(take.at)}` : 'never fired'],
      ['It names the card that animated', take ? take.third === 'middle' : false, take ? `said ${take.third || 'could not tell'}` : '—'],
      ['Nothing fires during ordinary play', seen.filter((e) => e.kind === 'augment-open').length === 1, `${seen.filter((e) => e.kind === 'augment-open').length} overlay(s)`],
    ];

    const passed = checks.filter((c) => c[1]).length;
    $('selfResults').innerHTML = `
      <div class="admin__lobby"><span class="admin__name">${passed}/${checks.length} passed</span>
        <span class="admin__nums">synthetic frames · no footage involved</span></div>
      ${checks.map(([label, ok, note]) => `
        <div class="admin__lobby">
          <span class="tag ${ok ? 'tag--live' : 'tag--closed'}">${ok ? 'pass' : 'fail'}</span>
          <span class="admin__name" style="font-size:0.95rem">${esc(label)}</span>
          <span class="admin__nums">${esc(note)}</span>
        </div>`).join('')}`;
    toast(`${passed}/${checks.length} passed`);
  });

  /* ---------- replay ---------- */

  $('videoFile').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    state.file = file;
    video.src = URL.createObjectURL(file);
    video.addEventListener('loadedmetadata', () => {
      state.duration = video.duration;
      $('replayStatus').textContent = `${file.name} · ${clock(video.duration)}`;
      $('runReplay').disabled = false;
      video.currentTime = Math.min(1, video.duration / 2);
      setTimeout(drawOverlay, 300);
    }, { once: true });
  });

  /* The band is draggable here because a recording is not always a full-screen
     game: a stream layout can put the game in one corner with overlays around
     it, and the preset assumes the game fills the frame. */
  let drag = null;
  overlay.addEventListener('pointerdown', (e) => {
    const r = overlay.getBoundingClientRect();
    drag = { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  });

  overlay.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const r = overlay.getBoundingClientRect();
    const now = { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
    state.region = {
      x: Math.max(0, Math.min(drag.x, now.x)),
      y: Math.max(0, Math.min(drag.y, now.y)),
      w: Math.min(1, Math.abs(drag.x - now.x)),
      h: Math.min(1, Math.abs(drag.y - now.y)),
    };
    drawOverlay();
  });

  overlay.addEventListener('pointerup', () => {
    drag = null;
    if (state.region.w < 0.05 || state.region.h < 0.03) {
      state.region = Object.assign({}, D.DEFAULTS.region);
      drawOverlay();
      toast('Too small — back to the default band');
    }
  });

  function drawOverlay() {
    const ctx = overlay.getContext('2d');
    overlay.width = overlay.clientWidth;
    overlay.height = overlay.clientHeight;
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    const r = state.region;
    const gold = getComputedStyle(document.documentElement).getPropertyValue('--gold').trim() || '#F0C078';
    ctx.strokeStyle = gold;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(r.x * overlay.width, r.y * overlay.height, r.w * overlay.width, r.h * overlay.height);
    // The thirds, so it is obvious whether each card lands in its own.
    ctx.setLineDash([2, 4]);
    ctx.lineWidth = 1;
    [1, 2].forEach((i) => {
      const x = (r.x + (r.w / 3) * i) * overlay.width;
      ctx.beginPath();
      ctx.moveTo(x, r.y * overlay.height);
      ctx.lineTo(x, (r.y + r.h) * overlay.height);
      ctx.stroke();
    });
  }

  const seek = (t) => new Promise((resolve) => {
    video.addEventListener('seeked', resolve, { once: true });
    video.currentTime = t;
  });

  $('runReplay').addEventListener('click', async () => {
    if (state.running || !state.file) return;
    state.running = true;
    state.events = [];
    $('stopReplay').hidden = false;
    $('runReplay').disabled = true;

    const step = Math.max(0.1, Number($('stepInput').value) || 0.5);
    const det = D.createDetector({
      region: state.region,
      motionThreshold: Number($('thMotion').value) || D.DEFAULTS.motionThreshold,
      stillSeconds: Number($('thStill').value) || D.DEFAULTS.stillSeconds,
      augmentSpike: Number($('thSpike').value) || D.DEFAULTS.augmentSpike,
    });

    for (let t = 0; t < state.duration && state.running; t += step) {
      await seek(t);
      const frame = frameAt();
      det.push(frame, t).forEach((e) => state.events.push(e));
      if (Math.round(t / step) % 8 === 0) {
        const pct = (t / state.duration) * 100;
        $('replayFill').style.width = Math.max(2, pct) + '%';
        $('replayNote').textContent = `${clock(t)} of ${clock(state.duration)} · ${state.events.length} events`;
        renderEvents();
        await new Promise((r) => setTimeout(r, 0)); // let the page breathe
      }
    }

    state.running = false;
    $('stopReplay').hidden = true;
    $('runReplay').disabled = false;
    $('replayFill').style.width = '100%';
    $('replayNote').textContent = `Done · ${state.events.length} events`;
    renderEvents();
    renderScore();
    toast('Replay finished');
  });

  $('stopReplay').addEventListener('click', () => { state.running = false; });

  /* ---------- ground truth ---------- */

  function parseClock(text) {
    const m = String(text).trim().match(/^(\d+):([0-5]?\d)$/);
    if (m) return Number(m[1]) * 60 + Number(m[2]);
    const n = Number(text);
    return Number.isFinite(n) ? n : null;
  }

  $('truthForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const at = parseClock($('truthAt').value);
    if (at === null) {
      window.TFTUI.fieldError($('truthAt'), 'Use mm:ss, like 03:12.');
      return;
    }
    state.truth.push({ at, third: $('truthThird').value });
    state.truth.sort((a, b) => a.at - b.at);
    $('truthAt').value = '';
    renderTruth();
    renderScore();
  });

  function renderTruth() {
    $('truthList').innerHTML = state.truth.length
      ? state.truth.map((t, i) => `
        <div class="penalty">
          <span>${clock(t.at)} — took ${esc(t.third)}</span>
          <button class="slot__reroll" type="button" data-truth="${i}">Remove</button>
        </div>`).join('')
      : '<div class="log__empty">Nothing marked yet.</div>';
  }

  $('truthList').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-truth]');
    if (!btn) return;
    state.truth.splice(Number(btn.dataset.truth), 1);
    renderTruth();
    renderScore();
  });

  /* ---------- output ---------- */

  function renderEvents() {
    $('eventCount').textContent = `(${state.events.length})`;
    const rows = state.events.slice(-200);
    $('eventList').innerHTML = rows.length ? rows.map((e) => `
      <div class="admin__lobby">
        <span class="tag ${e.kind.startsWith('augment') ? 'tag--live' : 'tag--closed'}">${esc(e.kind)}</span>
        <span class="admin__name" style="font-size:0.95rem">${clock(e.at)}</span>
        <span class="admin__nums">${esc(
          e.kind === 'augment-take'
            ? `${e.third || 'could not tell'} · share ${(e.share * 100).toFixed(0)}% · open ${e.openFor}s`
            : e.seconds !== undefined ? `${e.seconds}s` : ''
        )}</span>
      </div>`).join('')
      : '<div class="log__empty">No events yet.</div>';
  }

  function renderScore() {
    if (!state.events.length || !state.truth.length) {
      $('scoreTiles').innerHTML = '';
      $('scoreNote').textContent = 'Run a replay and add what really happened to get a score.';
      return;
    }
    const s = D.score(state.events, state.truth, 3);
    $('scoreTiles').innerHTML = [
      ['Augments marked', s.truthCount],
      ['Found', s.truthCount - s.missed],
      ['Named right', s.correct],
      ['Named wrong', s.wrongThird],
      ['Said unsure', s.unsure],
      ['False alarms', s.spurious],
    ].map(([label, value]) => `<div class="stat-tile">
        <span class="stat-tile__value">${esc(value)}</span>
        <span class="stat-tile__label">${esc(label)}</span>
      </div>`).join('');

    /* "Named wrong" is the number that decides whether this can be trusted near
       a prize: a confident wrong answer is worse than no answer at all. */
    $('scoreNote').textContent = s.wrongThird > 0
      ? `${s.wrongThird} confidently wrong. Until that is zero across several games, treat the card it names as a hint and check the screenshot.`
      : s.missed > 0
        ? `Nothing named wrong, but ${s.missed} augment screen${s.missed === 1 ? '' : 's'} went unnoticed. Lower the augment spike and run the same file again.`
        : 'Nothing wrong and nothing missed on this recording. One recording is not proof — run a few more before relying on it.';
  }

  $('exportRun').addEventListener('click', () => {
    const payload = {
      file: state.file ? state.file.name : null,
      duration: state.duration,
      region: state.region,
      thresholds: {
        motion: Number($('thMotion').value),
        still: Number($('thStill').value),
        spike: Number($('thSpike').value),
        step: Number($('stepInput').value),
      },
      truth: state.truth,
      events: state.events,
      score: state.truth.length ? D.score(state.events, state.truth, 3) : null,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'proctor-run.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('Run exported');
  });

  renderTruth();
  renderEvents();
})();
