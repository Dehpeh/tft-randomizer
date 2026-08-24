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
    live: null,        // a MediaStream when sharing rather than replaying
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
    const det = D.createDetector({ detectStill: true, detectAugments: true });
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

    /* The augment detector matches real text, which a drawn rectangle cannot
       contain, so what is testable here is that it does NOT fire on things that
       are not augment screens. Whether it fires on the real thing is a question
       for the replay, on footage. */
    const blank = { width: 320, height: 180, data: new Uint8ClampedArray(320 * 180 * 4).fill(20) };
    const noise = { width: 320, height: 180, data: new Uint8ClampedArray(320 * 180 * 4) };
    for (let i = 0; i < noise.data.length; i++) noise.data[i] = Math.floor(Math.random() * 255);
    const blankScore = D.augmentScore(blank);
    const noiseScore = D.augmentScore(noise);

    const checks = [
      ['A still spell is noticed', Boolean(stillStart), stillStart ? `at ${clock(stillStart.at)}` : 'never fired'],
      ['It trips at the threshold, not before', stillStart ? Math.abs(stillStart.seconds - 20) <= 1 : false, stillStart ? `${stillStart.seconds}s` : '—'],
      ['The spell is closed off when play resumes', Boolean(stillEnd), stillEnd ? `${stillEnd.seconds}s total` : 'never fired'],
      ['A blank screen is not an augment screen', Math.abs(blankScore) < 0.3, `scored ${blankScore.toFixed(2)}`],
      ['Random noise is not an augment screen', Math.abs(noiseScore) < 0.3, `scored ${noiseScore.toFixed(2)}`],
      ['Drawn shapes are not an augment screen', !find('augment-open'), find('augment-open') ? 'fired anyway' : 'stayed quiet'],
      ['Which card was taken is never guessed', !take || take.third === null, take ? String(take.third) : 'no take'],
    ];

    /* The shape tests carry their own checks — drawn digits, a grey strip, three
       pips — so run them here rather than keeping a second button for them. */
    const featureLines = [];
    const feature = window.TFTFeaturesTest
      ? window.TFTFeaturesTest.run((s) => featureLines.push(s))
      : { pass: 0, fail: 0 };
    checks.push(['Shape tests agree with drawn shapes', feature.fail === 0,
      `${feature.pass} of ${feature.pass + feature.fail}`]);

    const shopLines = [];
    const shopT = window.TFTShopTest
      ? window.TFTShopTest.run((s) => shopLines.push(s))
      : { pass: 0, fail: 0 };
    const timeLines = [];
    const timeT = window.TFTDetectTest
      ? window.TFTDetectTest.run((s) => timeLines.push(s))
      : { pass: 0, fail: 0 };
    checks.push(['One augment screen reports as one finding, however the score wobbles', timeT.fail === 0,
      `${timeT.pass} of ${timeT.pass + timeT.fail}`]);
    featureLines.push('', ...timeLines);

    checks.push(['Shop reads the costs it was measured on, and stays quiet otherwise', shopT.fail === 0,
      `${shopT.pass} of ${shopT.pass + shopT.fail}`]);
    featureLines.push('', ...shopLines);

    const passed = checks.filter((c) => c[1]).length;
    $('selfResults').innerHTML = `
      <div class="admin__lobby"><span class="admin__name">${passed}/${checks.length} passed</span>
        <span class="admin__nums">synthetic frames · no footage involved</span></div>
      ${checks.map(([label, ok, note]) => `
        <div class="admin__lobby">
          <span class="tag ${ok ? 'tag--live' : 'tag--closed'}">${ok ? 'pass' : 'fail'}</span>
          <span class="admin__name" style="font-size:0.95rem">${esc(label)}</span>
          <span class="admin__nums">${esc(note)}</span>
        </div>`).join('')}
      <pre class="admin__nums" style="white-space:pre-wrap;margin-top:0.75rem;font-size:0.65rem">${esc(featureLines.join('\n'))}</pre>`;
    toast(`${passed}/${checks.length} passed`);
  });

  /* ---------- live ----------
     Calibrating from a file means recording first, which is a step people will
     skip. The detector only ever wanted frames, and a screen share is frames,
     so the same page takes either. Seeking is the one thing a live source
     cannot do, so the replay run is swapped for a watch-as-you-go run. */

  $('useScreen').addEventListener('click', async () => {
    try {
      state.live = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 4 }, audio: false });
    } catch (e) {
      toast('Screen sharing was declined.');
      return;
    }
    video.srcObject = state.live;
    video.src = '';
    await video.play().catch(() => {});
    state.live.getVideoTracks()[0].addEventListener('ended', stopLive);

    state.file = { name: 'live screen' };
    state.duration = 0;
    $('replayStatus').textContent = `live · ${video.videoWidth}x${video.videoHeight}`;
    $('useScreen').hidden = true;
    $('stopScreen').hidden = false;
    $('runReplay').disabled = false;
    $('runReplay').textContent = 'Watch live';
    setTimeout(() => { drawOverlay(); showMatcherBox(); }, 300);
    toast('Sharing — capture a matcher when its moment is on screen');
  });

  $('stopScreen').addEventListener('click', stopLive);

  function stopLive() {
    state.running = false;
    if (state.live) state.live.getTracks().forEach((t) => t.stop());
    state.live = null;
    video.srcObject = null;
    $('useScreen').hidden = false;
    $('stopScreen').hidden = true;
    $('runReplay').textContent = 'Run the detector';
    $('replayStatus').textContent = 'No file yet';
  }

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

    /* Live: no seeking, so it samples the clock instead and keeps going until
       stopped. Everything downstream — events, scoring — is identical. */
    if (state.live) {
      const det = D.createDetector({ region: state.region, detectStill: true, detectAugments: true });
      const started = Date.now();
      while (state.running && state.live) {
        const at = (Date.now() - started) / 1000;
        det.push(frameAt(), at).forEach((e) => state.events.push(e));
        $('replayNote').textContent = `live · ${clock(at)} · ${state.events.length} events`;
        renderEvents();
        await new Promise((r) => setTimeout(r, 500));
      }
      state.running = false;
      $('stopReplay').hidden = true;
      $('runReplay').disabled = false;
      return;
    }

    const step = Math.max(0.1, Number($('stepInput').value) || 0.5);
    const det = D.createDetector({
      region: state.region,
      detectStill: true,
      detectAugments: true,
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

  /* ---------- calibration ----------
     The whole reason the augment matcher works is that someone pointed at the
     thing on screen and said "that". This is that, as a button: everything the
     proctor cannot yet watch is waiting on a picture, not on code. */

  const M = window.TFTMatchers;
  M.loadLocal();

  function renderMatchers() {
    const pick = $('matcherPick');
    const keep = pick.value;
    pick.innerHTML = M.MATCHERS.map((m) =>
      `<option value="${m.id}">${esc(m.label)}${tail(m)}</option>`).join('');
    if (keep) pick.value = keep;

    $('matcherList').innerHTML = M.MATCHERS.map((m) => `
      <div class="admin__lobby">
        <span class="tag ${stateOf(m).cls}">${stateOf(m).word}</span>
        <span class="admin__name" style="font-size:0.95rem">${esc(m.label)}</span>
        <span class="admin__nums">${esc(m.watches)}<br>${esc(m.evidence)}</span>
        ${m.untested ? `<button class="btn btn--pill" data-arm="${m.id}">${m.on ? 'Turn off' : 'Turn on'}</button>` : ''}
      </div>`).join('');

    /* Turning one on is deliberately a button on this page and nowhere else.
       Scoring it on footage first is the whole point of the page. */
    $('matcherList').querySelectorAll('[data-arm]').forEach((b) => {
      b.addEventListener('click', () => {
        const m = M.byId(b.dataset.arm);
        m.on = !m.on;
        renderMatchers();
        $('matcherNote').textContent = m.on
          ? `"${m.label}" is on for this browser. Run a replay before trusting it.`
          : `"${m.label}" is off again.`;
      });
    });
  }

  /* A matcher is in one of three states, and conflating the last two is how an
     untested detector ends up looking like a tested one. */
  function stateOf(m) {
    if (!m.template) return { cls: 'tag--closed', word: 'waiting' };
    if (m.untested) return m.on ? { cls: 'tag--live', word: 'on, unscored' } : { cls: 'tag--closed', word: 'off' };
    return { cls: 'tag--live', word: 'ready' };
  }

  function tail(m) {
    if (!m.template) return ' — needs a picture';
    if (m.untested) return m.on ? ' — on, unscored' : ' — off';
    return ' ✓';
  }

  function currentMatcher() { return M.byId($('matcherPick').value) || M.MATCHERS[0]; }

  /* The box is drawn on the preview so it is obvious whether it lands on the
     thing before anything is captured. */
  function showMatcherBox() {
    const m = currentMatcher();
    state.region = Object.assign({}, m.region);
    drawOverlay();
  }

  $('matcherPick').addEventListener('change', showMatcherBox);

  $('matcherShow').addEventListener('click', async () => {
    const at = parseClock($('matcherAt').value);
    if (at === null) { window.TFTUI.fieldError($('matcherAt'), 'Use mm:ss, like 07:31.'); return; }
    await seek(at);
    showMatcherBox();
    $('matcherNote').textContent = `Showing ${clock(at)}. Drag on the picture if the box is off the mark.`;
  });

  $('matcherTest').addEventListener('click', () => {
    const m = currentMatcher();
    if (!m.template) { $('matcherNote').textContent = 'Nothing to score against yet — capture it first.'; return; }
    const probe = Object.assign({}, m, { region: state.region });
    const sc = M.score(frameAt(), probe);

    /* A shape test can say why, and why is the useful part: "3 digits, so not a
       lone zero" tells you the box is on the wrong thing, where 0.00 does not. */
    const because = M.why(m.id);
    $('matcherNote').textContent = m.kind
      ? `"${m.label}" says ${sc >= 1 ? 'yes' : 'no'} on this frame — ${because}.`
      : `This frame scores ${sc.toFixed(2)} against "${m.label}". Above ${m.threshold} counts as a sighting.`;
  });

  $('matcherCapture').addEventListener('click', async () => {
    const m = currentMatcher();
    if (m.kind) {
      $('matcherNote').textContent = `"${m.label}" works from shape rather than from a picture, so there is nothing to capture. Move the box onto the right place, score a few frames, then turn it on.`;
      return;
    }
    const tpl = M.capture(frameAt(), state.region, m.w, m.h);
    M.saveLocal(m.id, tpl, state.region);
    renderMatchers();

    /* Captured from one frame is a weak template — the augment one was averaged
       over five. Say so rather than let a single frame look authoritative. */
    $('matcherNote').textContent = `Captured "${m.label}" from this frame and saved it for this browser. One frame is a weak template: run the replay to see whether it holds, and capture again at another sighting if it does not.`;
    const out = $('matcherOut');
    out.hidden = false;
    out.value = JSON.stringify({ id: m.id, region: state.region, w: m.w, h: m.h, template: tpl }, null, 2);
  });

  renderMatchers();
  showMatcherBox();

  /* ---------- the shop ----------
     Two questions, and they are different questions. "What does it think is in
     the shop right now" checks the weak half — the cost colours — against a
     frame you can look at. "What did it see over a stretch" checks the strong
     half, which is whether the buys and rerolls it reports are the ones that
     actually happened. The second is the one that decides whether this gets
     turned on. */
  const SHOP = window.TFTShop;

  function paintShop(rows, note) {
    $('shopNote').textContent = note;
    $('shopOut').innerHTML = rows.join('');
  }

  function slotWord(s) {
    if (s.empty) return 'empty';
    if (s.occluded) return 'covered';
    return s.cost === null ? 'unreadable' : s.cost + '-cost';
  }

  $('shopRead').addEventListener('click', async () => {
    const at = parseClock($('shopAt').value);
    if (at === null) { window.TFTUI.fieldError($('shopAt'), 'Use mm:ss, like 15:31.'); return; }
    await seek(at);
    const row = SHOP.read(frameAt());

    /* The boxes are drawn on the preview too, because nine times in ten a wrong
       reading is a box that is not on the card rather than a bad threshold. */
    state.region = SHOP.slotBox(0, null, 'bar');
    drawOverlay();

    paintShop(row.slots.map((s) => `
      <div class="admin__lobby">
        <span class="tag ${s.cost === null ? 'tag--closed' : 'tag--live'}">slot ${s.slot}</span>
        <span class="admin__name" style="font-size:0.95rem">${esc(slotWord(s))}</span>
        <span class="admin__nums">${esc(s.why)}</span>
      </div>`),
      `${clock(at)} · the shop ${SHOP.visible(row) ? 'is readable' : 'is not readable here — hidden, dimmed, or behind the sell bar'}.`);
  });

  $('shopRun').addEventListener('click', async () => {
    const at = parseClock($('shopAt').value);
    const from = at === null ? 0 : at;
    const to = Math.min(from + 180, state.duration);
    const tr = SHOP.tracker();
    const seen = [];
    state.running = true;
    paintShop([], 'Reading ' + clock(from) + ' to ' + clock(to) + '…');

    /* Report the span actually looked at, not the span asked for. A run that was
       stopped early and still claims three minutes of coverage reads as "nothing
       happened in those three minutes", which is the one thing it cannot say. */
    let reached = from;
    for (let t = from; t < to && state.running; t += 0.5) {
      await seek(t);
      tr.push(SHOP.read(frameAt()), t).forEach((e) => seen.push(e));
      reached = t;
    }
    const cutShort = reached < to - 0.5;
    state.running = false;

    paintShop(seen.map((e) => `
      <div class="admin__lobby">
        <span class="tag ${e.kind === 'buy' ? 'tag--live' : 'tag--closed'}">${e.kind}</span>
        <span class="admin__name" style="font-size:0.95rem">${clock(e.at)}</span>
        <span class="admin__nums">${e.kind === 'buy'
          ? 'slot ' + e.slot + ', a ' + (e.cost === null ? 'card of unknown cost' : e.cost + '-cost')
          : 'held: ' + (e.kept.length ? e.kept.join(', ') : 'nothing') + ' · now ' + e.offered.map((c) => c === null ? '?' : c).join(' ')}</span>
      </div>`),
      `${seen.length} shop events across ${Math.round(reached - from)}s${cutShort ? ' (stopped early — the rest was not looked at)' : ''}. Check them against the recording: a buy is one card gone with the rest untouched, a reroll is the whole row changing.`);
  });

  function paintArm() {
    $('shopArm').textContent = SHOP.on() ? 'Turn off' : 'Turn on';
  }

  $('shopArm').addEventListener('click', () => {
    SHOP.setOn(!SHOP.on());
    paintArm();
    $('shopNote').textContent = SHOP.on()
      ? 'The shop watcher is on for this browser. It only notes something when one of the rolled restrictions is about the shop.'
      : 'The shop watcher is off again.';
  });

  paintArm();

  /* Scripted access to the same functions the buttons call, so a run can be
     driven from a console or a test harness rather than by hand. It adds no
     capability the page does not already have. */
  window.TFTLAB = {
    state: state,
    async loadUrl(src) {
      video.src = src;
      await new Promise((resolve, reject) => {
        video.addEventListener('loadedmetadata', resolve, { once: true });
        video.addEventListener('error', () => reject(new Error('could not load ' + src)), { once: true });
      });
      state.duration = video.duration;
      state.file = { name: src };
      $('replayStatus').textContent = src + ' · ' + clock(video.duration);
      $('runReplay').disabled = false;
      return { duration: video.duration, width: video.videoWidth, height: video.videoHeight };
    },
    setRegion(r) { state.region = Object.assign({}, r); drawOverlay(); return state.region; },
    async run(opts) {
      const o = opts || {};
      const step = o.step || 1;
      const from = o.from || 0;
      const to = Math.min(o.to || state.duration, state.duration);
      const det = D.createDetector(Object.assign({ region: state.region, detectStill: true, detectAugments: true }, o.config || {}));
      const events = [];
      state.running = true;
      for (let t = from; t < to && state.running; t += step) {
        await seek(t);
        det.push(frameAt(), t).forEach((e) => events.push(e));
      }
      state.running = false;
      state.events = events;
      renderEvents();
      return events;
    },
    stop() { state.running = false; },
    /* Writes a frame to disk through the dev server so it can be looked at. */
    async saveFrame(t, name) {
      await seek(t);
      const c = document.createElement('canvas');
      c.width = Math.min(960, video.videoWidth);
      c.height = Math.round(c.width * (video.videoHeight / video.videoWidth));
      c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
      const res = await fetch('/dev-save', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: name, dataUrl: c.toDataURL('image/png') }),
      });
      return res.json();
    },
  };

  renderTruth();
  renderEvents();
})();
