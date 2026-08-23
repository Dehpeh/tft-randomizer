/* The proctor: the player's own browser watching their own game window.

   Design constraints that decided everything below:

     - It must not touch the game. This reads frames from getDisplayMedia, the
       same API a video call uses. No memory, no input, no overlay, no file
       anywhere near the client. If OBS is safe, so is this.
     - The video must not leave the machine. Frames go to a canvas, get measured,
       and are discarded. Screenshots live in this tab and die with it. Only
       short text notes are ever sent, and only when the player sends them.
     - It flags, it does not judge. Everything here produces "look at 04:12",
       never "guilty". A penalty stays a human decision made by a gamemaster.

   What it can actually tell you, honestly:

     - Stillness. Frame differencing is exact: if nothing on screen changed for
       forty seconds, they were not playing. That covers the AFK restrictions
       and needs no calibration at all.
     - Augment screens. The overlay is a big, sudden, sustained change in the
       middle of the screen, and it always lands in the same place, so the band
       is a preset rather than something a player is asked to describe. Splitting
       it into thirds locates the click: when a card is taken it animates and the
       other two do not. That is an inference, so it is reported as "most
       movement on the left" beside what the roll said, with a screenshot — a
       two-second check for a human, not a verdict.

   Gold, shop slots and star levels are the next ones worth doing. They all need
   digit and sprite templates calibrated against real footage at several UI
   scales, which is the actual work in this project, not the plumbing here. */
(function () {
  const T = window.TFT;
  const $ = (id) => document.getElementById(id);
  const toast = (msg) => window.TFTUI.toast(msg);

  const D = window.TFTDetect;

  /* Sampling twice a second is plenty: the events being watched for last
     seconds, not frames, and this has to share a machine with the game. */
  const SAMPLE_MS = 500;
  const ANALYSIS_W = 320;          // frames are measured small; nobody needs pixels
  const MAX_SHOTS = 40;

  /* The augment overlay lands in the same place every time: three cards across
     the middle of the screen, roughly the middle 84% wide and the top two
     thirds tall. Measured off a 16:9 capture, and it is proportional, so it
     holds at any resolution. Nobody should have to be asked where their augment
     screen is — this is the default, and the calibration box is there only for
     an unusual aspect ratio or a UI scale that moves it. */
  const DEFAULT_REGION = { x: 0.08, y: 0.05, w: 0.84, h: 0.60 };

  const state = {
    account: null,
    lobbies: [],
    code: null,
    game: 1,
    stream: null,
    timer: null,
    startedAt: 0,
    prev: null,
    lastMotion: 0,
    stillSince: null,
    stillReported: false,
    detector: null,
    region: null,        // normalised {x,y,w,h} for the augment band
    calibrating: false,
    rolledAugment: null,
    worker: null,
    gameLocked: false,   // true once the player picks a game themselves
    watchTimer: null,
    flags: [],
    sent: 0,
  };

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const clock = (s) => String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(Math.floor(s % 60)).padStart(2, '0');
  const elapsed = () => (Date.now() - state.startedAt) / 1000;

  const video = $('preview');
  const overlay = $('overlay');
  const work = document.createElement('canvas');
  const wctx = work.getContext('2d', { willReadFrequently: true });

  /* ---------- boot ---------- */

  start();

  async function start() {
    try {
      const who = await fetch('/api/auth', { headers: { accept: 'application/json' } }).then((r) => r.json());
      state.account = who.account;
    } catch (e) { state.account = null; }

    if (!state.account) {
      fail('Sign in first — the proctor reports to the lobby you are seated in.');
      $('startBtn').disabled = true;
      return;
    }

    try {
      const mine = await fetch('/api/me', { headers: { accept: 'application/json' } }).then((r) => r.json());
      state.lobbies = (mine.lobbies || []).filter((l) => l.open);
    } catch (e) { state.lobbies = []; }

    if (!state.lobbies.length) {
      fail('You are not in an open lobby. Take a seat in one first.');
      $('startBtn').disabled = true;
      return;
    }

    $('lobbySelect').innerHTML = state.lobbies.map((l) =>
      `<option value="${esc(l.code)}">${esc(l.name)} · ${esc(l.code)}</option>`).join('');
    $('gameSelect').innerHTML = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<option value="${n}">Game ${n}</option>`).join('');

    /* Arriving from the lobby's Proctor button, both are already decided —
       there is no reason to make someone pick their own lobby out of a list
       they were just looking at. */
    const params = new URLSearchParams(location.search);
    const wanted = String(params.get('code') || '').toUpperCase();
    state.code = state.lobbies.some((l) => l.code === wanted) ? wanted : state.lobbies[0].code;
    $('lobbySelect').value = state.code;

    const wantedGame = Number(params.get('game'));
    if (Number.isInteger(wantedGame) && wantedGame >= 1 && wantedGame <= 9) {
      state.game = wantedGame;
      state.gameLocked = true;
      $('gameSelect').value = String(wantedGame);
    }

    $('lobbySelect').addEventListener('change', () => { state.code = $('lobbySelect').value; loadRules(); });
    $('gameSelect').addEventListener('change', () => {
      state.game = Number($('gameSelect').value);
      state.gameLocked = true;
      loadRules();
    });

    loadCalibration();
    loadRules();

    /* The gamemaster rolls when they roll — often after everyone already has
       this page open. Without this the panel would sit on "nothing rolled yet"
       until someone thought to refresh. */
    state.watchTimer = setInterval(() => { if (!document.hidden) loadRules(); }, 5000);
  }

  function fail(message) {
    $('setupError').textContent = message;
    $('setupError').hidden = false;
  }

  /* What the player is carrying, shown beside the picture so the thing they are
     being checked against is on the same screen as the check. */
  async function loadRules() {
    try {
      const data = await fetch('/api/state?code=' + state.code, { headers: { accept: 'application/json' } }).then((r) => r.json());
      const s = data.session;
      if (!s) return;

      /* Follow whichever game the lobby is on, until the player says otherwise.
         Getting this wrong would file their evidence against the wrong game. */
      if (!state.gameLocked && s.game !== state.game) {
        state.game = s.game;
        $('gameSelect').value = String(s.game);
      }

      const roll = (s.rolls[state.game] || {})[s.you];
      if (!roll) {
        $('myRules').innerHTML = `<p class="hint">Nothing rolled for game ${state.game} yet — this fills in by itself when your gamemaster rolls.</p>`;
        return;
      }
      /* Only the augment restrictions name a card, and only those make the
         flag worth reading. */
      state.rolledAugment = null;
      roll.picks.forEach((p) => {
        T.detailsOf(p).forEach((d) => {
          if (/^(left|middle|right)$/.test(String(d.value))) {
            state.rolledAugment = d.label === 'Take' ? d.value : `${d.label} ${d.value}`;
          }
        });
      });

      $('myRules').innerHTML = roll.picks.map((p) => `
        <div class="pcard__pick pcard__pick--${p.tier}" style="margin-bottom:0.5rem">
          <b>${esc(p.tier)}</b>
          <span>${esc(p.text)}${T.detailsOf(p).map((d) => `<span class="detail">${esc(d.label)}: <b>${esc(d.value)}</b></span>`).join('')}</span>
        </div>`).join('');
    } catch (e) {
      $('myRules').innerHTML = '<p class="hint">Could not load your restrictions.</p>';
    }
  }

  /* ---------- calibration ----------
     One region, drawn once, kept per device. The augment band is the only thing
     the detector needs told; stillness is measured over the whole frame. */

  function loadCalibration() {
    try {
      const raw = localStorage.getItem('tft.proctor.region');
      state.region = raw ? JSON.parse(raw) : DEFAULT_REGION;
    } catch (e) { state.region = DEFAULT_REGION; }
  }

  $('calibBtn').addEventListener('click', () => {
    state.calibrating = true;
    $('calibHint').textContent = 'Drag a box over the middle of the screen where the three augment cards appear.';
    overlay.classList.add('is-arming');
  });

  $('calibClear').addEventListener('click', () => {
    state.region = DEFAULT_REGION;
    try { localStorage.removeItem('tft.proctor.region'); } catch (e) { /* private mode */ }
    drawOverlay();
    toast('Back to the default augment area');
  });

  let dragStart = null;
  overlay.addEventListener('pointerdown', (e) => {
    if (!state.calibrating) return;
    const r = overlay.getBoundingClientRect();
    dragStart = { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  });

  overlay.addEventListener('pointermove', (e) => {
    if (!dragStart) return;
    const r = overlay.getBoundingClientRect();
    state.region = box(dragStart, { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height });
    drawOverlay();
  });

  overlay.addEventListener('pointerup', () => {
    if (!dragStart) return;
    dragStart = null;
    state.calibrating = false;
    overlay.classList.remove('is-arming');
    if (state.region && state.region.w > 0.05 && state.region.h > 0.03) {
      try { localStorage.setItem('tft.proctor.region', JSON.stringify(state.region)); } catch (e) { /* private mode */ }
      $('calibHint').textContent = 'Augment area saved on this device. Clear it if your resolution changes.';
      toast('Augment area saved');
    } else {
      state.region = null;
      $('calibHint').textContent = 'That box was too small — try again across the middle of the screen.';
    }
    drawOverlay();
  });

  const box = (a, b) => ({
    x: Math.max(0, Math.min(a.x, b.x)),
    y: Math.max(0, Math.min(a.y, b.y)),
    w: Math.min(1, Math.abs(a.x - b.x)),
    h: Math.min(1, Math.abs(a.y - b.y)),
  });

  function drawOverlay() {
    const ctx = overlay.getContext('2d');
    overlay.width = overlay.clientWidth;
    overlay.height = overlay.clientHeight;
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    if (!state.region) return;
    const r = state.region;
    ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--gold').trim() || '#F0C078';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(r.x * overlay.width, r.y * overlay.height, r.w * overlay.width, r.h * overlay.height);
  }

  /* ---------- capture ---------- */

  $('startBtn').addEventListener('click', async () => {
    $('setupError').hidden = true;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      fail('This browser cannot share a screen. Chrome, Edge or Firefox on a desktop can.');
      return;
    }
    try {
      state.stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 4 },
        audio: false,
      });
    } catch (e) {
      fail(e && e.name === 'NotAllowedError' ? 'Screen sharing was declined, so there is nothing to watch.' : 'Could not start screen sharing.');
      return;
    }

    state.code = $('lobbySelect').value;
    state.game = Number($('gameSelect').value);
    await loadRules();

    video.srcObject = state.stream;
    await video.play().catch(() => {});
    state.stream.getVideoTracks()[0].addEventListener('ended', stop);

    state.startedAt = Date.now();
    state.detector = D.createDetector({ region: state.region || DEFAULT_REGION });

    $('live').hidden = false;
    $('findings').hidden = false;
    $('startBtn').hidden = true;
    $('stopBtn').hidden = false;
    setTimeout(drawOverlay, 200);

    addFlag('started', 'Proctor started', 0);
    startClock();
    toast('Watching your game window');
  });

  $('stopBtn').addEventListener('click', stop);

  /* The whole point is to watch while they play, which means this tab is in the
     background the entire time — and a background tab's setInterval gets
     throttled to about once a minute, which would quietly turn a proctor into
     nothing. Worker timers are not throttled that way, so the clock lives in a
     worker and the main thread only does the drawing. setInterval stays as the
     fallback for anything that cannot spawn one. */
  function startClock() {
    const source = 'let t=null;onmessage=e=>{if(e.data.stop){clearInterval(t);return}'
      + 't=setInterval(()=>postMessage(1),e.data.ms)}';
    try {
      const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
      state.worker = new Worker(url);
      URL.revokeObjectURL(url);
      state.worker.onmessage = tick;
      state.worker.postMessage({ ms: SAMPLE_MS });
    } catch (e) {
      state.timer = setInterval(tick, SAMPLE_MS);
    }
  }

  function stopClock() {
    if (state.worker) {
      state.worker.postMessage({ stop: true });
      state.worker.terminate();
      state.worker = null;
    }
    clearInterval(state.timer);
    state.timer = null;
  }

  function stop() {
    stopClock();
    if (state.stream) state.stream.getTracks().forEach((t) => t.stop());
    state.stream = null;
    $('startBtn').hidden = false;
    $('stopBtn').hidden = true;
    addFlag('stopped', 'Proctor stopped', 0);
    toast('Stopped watching');
  }

  /* ---------- the loop ---------- */

  function tick() {
    if (!video.videoWidth || !state.detector) return;
    const h = Math.round(ANALYSIS_W * (video.videoHeight / video.videoWidth));
    work.width = ANALYSIS_W;
    work.height = h;
    wctx.drawImage(video, 0, 0, ANALYSIS_W, h);
    const frame = wctx.getImageData(0, 0, ANALYSIS_W, h);

    const at = elapsed();
    const prevFrame = state.detector.motionAt();
    state.lastMotion = prevFrame ? D.diff(prevFrame, frame, null) : 0;

    state.detector.push(frame, at).forEach(handle);

    paintMeter(state.lastMotion);
    $('liveClock').textContent = clock(at);
    paintTiles();
  }

  /* Screenshots are taken here rather than in the detector: evidence is this
     page's job, judgement is that file's. */
  function handle(e) {
    if (e.kind === 'still-start') {
      shoot();
      addFlag('inactive', `Still for ${e.seconds}s`, e.at, e.seconds);
    }
    if (e.kind === 'still-end') {
      updateLastFlag(`Still for ${e.seconds}s`, e.seconds);
    }
    if (e.kind === 'augment-open') {
      shoot();
      addFlag('augment', 'Augment screen opened' + rolledPick(), e.at);
    }
    if (e.kind === 'augment-take') {
      shoot();
      addFlag('augment', e.third
        ? `Taken — most movement on the ${e.third}${rolledPick()}`
        : `Taken — could not tell which${rolledPick()}`, e.at);
    }
  }

  /* What the randomizer told them to take, quoted on the flag so the check is
     one glance rather than two screens. */
  function rolledPick() {
    const said = state.rolledAugment;
    return said ? ` · your roll said ${said}` : '';
  }

  /* ---------- output ---------- */

  function paintMeter(motion) {
    const pct = Math.max(2, Math.min(100, (motion / 30) * 100));
    $('motionFill').style.width = pct + '%';
    $('motionNote').textContent = motion < D.DEFAULTS.motionThreshold ? 'Still' : 'Playing';
  }

  function paintTiles() {
    const inactive = state.flags.filter((f) => f.kind === 'inactive').length;
    const augments = state.flags.filter((f) => f.kind === 'augment').length;
    $('liveTiles').innerHTML = [
      ['Watching', clock(elapsed())],
      ['Still spells', inactive],
      ['Augment screens', augments],
    ].map(([label, value]) => `<div class="stat-tile">
        <span class="stat-tile__value">${esc(value)}</span>
        <span class="stat-tile__label">${esc(label)}</span>
      </div>`).join('');
  }

  /* Screenshots stay here. They are the reason a flag is worth anything, and
     also the reason none of them are uploaded. */
  function shoot() {
    if (!video.videoWidth) return null;
    const c = document.createElement('canvas');
    c.width = 480;
    c.height = Math.round(480 * (video.videoHeight / video.videoWidth));
    c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
    const url = c.toDataURL('image/jpeg', 0.6);
    state.pendingShot = url;
    return url;
  }

  function addFlag(kind, note, at, seconds) {
    const flag = { kind, note, at: Math.round(at || 0), seconds: seconds || 0, shot: state.pendingShot || null, sent: false };
    state.pendingShot = null;
    state.flags.push(flag);
    if (state.flags.length > MAX_SHOTS) {
      const dropped = state.flags.shift();
      if (dropped) dropped.shot = null;
    }
    renderFlags();
  }

  function updateLastFlag(note, seconds) {
    for (let i = state.flags.length - 1; i >= 0; i--) {
      if (state.flags[i].kind === 'inactive') {
        state.flags[i].note = note;
        state.flags[i].seconds = seconds;
        break;
      }
    }
    renderFlags();
  }

  function renderFlags() {
    const list = state.flags.filter((f) => f.kind === 'inactive' || f.kind === 'augment');
    $('findingCount').textContent = `(${list.length})`;
    $('findingList').innerHTML = list.length ? list.slice().reverse().map((f) => `
      <article class="finding">
        ${f.shot ? `<img class="finding__shot" src="${f.shot}" alt="Screen at ${clock(f.at)}">` : '<span class="finding__shot finding__shot--none"></span>'}
        <div>
          <div class="finding__head">
            <span class="tag ${f.kind === 'augment' ? 'tag--live' : 'tag--closed'}">${f.kind === 'augment' ? 'augment' : 'inactive'}</span>
            <span class="finding__at">${clock(f.at)}</span>
            ${f.sent ? '<span class="finding__sent">sent</span>' : ''}
          </div>
          <div class="finding__note">${esc(f.note)}</div>
        </div>
      </article>`).join('')
      : '<div class="log__empty">Nothing worth a look yet.</div>';
  }

  $('sendFlags').addEventListener('click', async () => {
    const unsent = state.flags.filter((f) => !f.sent && (f.kind === 'inactive' || f.kind === 'augment'));
    if (!unsent.length) { toast('Nothing new to send'); return; }
    const ok = await window.TFTUI.confirm({
      title: `Send ${unsent.length} note${unsent.length === 1 ? '' : 's'}?`,
      body: 'Your gamemaster sees the times and the one-line notes. The screenshots stay on this machine.',
      confirmText: 'Send the notes',
    });
    if (!ok) return;
    try {
      const res = await fetch('/api/flag', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          code: state.code,
          game: state.game,
          flags: unsent.map((f) => ({ kind: f.kind, note: f.note, at: f.at, seconds: f.seconds })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not send.');
      unsent.forEach((f) => { f.sent = true; });
      state.sent += unsent.length;
      renderFlags();
      toast('Sent to your gamemaster');
    } catch (e) { toast(e.message); }
  });

  $('clearFlags').addEventListener('click', async () => {
    if (!state.flags.length) return;
    const ok = await window.TFTUI.confirm({
      title: 'Clear the findings?',
      body: 'Notes and screenshots on this machine go. Anything already sent stays with your gamemaster.',
      confirmText: 'Clear',
      danger: true,
    });
    if (!ok) return;
    state.flags = [];
    renderFlags();
  });

  window.addEventListener('beforeunload', () => {
    clearInterval(state.watchTimer);
    stopClock();
    if (state.stream) state.stream.getTracks().forEach((t) => t.stop());
  });
})();
