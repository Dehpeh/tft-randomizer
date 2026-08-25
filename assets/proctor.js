/* The proctor: the player's own browser watching their own game window.

   Design constraints that decided everything below:

     - It must not touch the game. This reads frames from getDisplayMedia, the
       same API a video call uses. No memory, no input, no overlay, no file
       anywhere near the client. If OBS is safe, so is this.
     - The video must not leave the machine. Frames go to a canvas, get measured,
       and are discarded. The video stream is never uploaded. What is sent is a
       short note and one still of the flagged moment.
     - Findings are not the player's to hold. They go as they are made, with no
       send step and nothing to delete, because a finding somebody can decide
       whether to forward is a submission rather than evidence, and the one it
       would occur to them to keep back is the one worth having. The control
       that stays with the player is whether the proctor is running at all —
       and the disclosure sits on the start screen, before the share, which is
       the last point where the answer is genuinely theirs.
     - It flags, it does not judge, and this is the important one. Every detector
       here reports that something HAPPENED, not that a rule was broken. It sees
       an augment screen open and close; it does not know whether the augment
       taken was the one that was rolled. It sees a card leave the shop; it does
       not know what stage it was. The two exceptions are structural rather than
       clever: a locked slot either survived the reroll or it did not, and a
       1-cost either was still sitting there when the shop changed or it was
       not. Everything else is "look at 04:12", and the judgement is a
       gamemaster's.

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

  /* Anything this player calibrated in the lab applies here too. */
  if (window.TFTMatchers) window.TFTMatchers.loadLocal();

  /* Augment-screen detection is measured and reliable (see lib/detect.js);
     stillness is not, and stays off. */
  const SENDING_ENABLED = true;

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
    clipper: null,
    clipStream: null,      // rolling recorder, so findings carry seconds not frames
    region: null,        // normalised {x,y,w,h} for the augment band
    calibrating: false,
    rolledAugment: null,
    rolledByStage: {},
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
      /* Keyed by the stage it applies to, because a game deals three augment
         screens and a restriction usually governs one. "No augment freedom"
         names all three stages and so fills all three slots. */
      state.rolledAugment = null;
      state.rolledByStage = {};

      /* One reading of the roll, shared with the lab so a replay applies the
         same restrictions to the same footage. */
      state.rules = window.TFTNotes.rulesFrom(roll.picks, T.detailsOf);
      state.rolledByStage = state.rules.byStage;
      notebook = null;

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
      /* 4fps was enough when a finding was one still. A clip is watched, so the
         capture has to carry enough frames to be worth watching; the detector
         still samples it twice a second whatever arrives. */
      state.stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 15, max: 30 } },
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
    Object.keys(matchSeen).forEach((k) => delete matchSeen[k]);
    Object.keys(shopSeen).forEach((k) => delete shopSeen[k]);
    /* A rolling recorder, so every finding can carry the seconds around it
       rather than one frame of it. Started here and never stopped until the
       share ends, because the lead-up to a finding has already happened by the
       time anything is detected.

       It records a CLONE of the video track, capped at 960 wide, and the
       detector keeps the original at full size. That split is not tidiness: the
       gold counter is about fifty pixels across at 1080p and reads perfectly,
       and at 1440p-downscaled-to-1440 it already starts coming back unreadable.
       Measured — gold read 8 of 8 at full width and left 3 of 8 unread once the
       frame was scaled down. So the thing that reads numbers gets every pixel,
       and the thing a person watches gets a small one. */
    state.clipStream = null;
    try {
      const track = state.stream.getVideoTracks()[0];
      const small = track.clone();
      if (small.applyConstraints) {
        await small.applyConstraints({ width: { max: 960 }, frameRate: { max: 15 } });
      }
      state.clipStream = new MediaStream([small]);
    } catch (e) {
      /* No clone: record the original and let the bitrate hold the size down. */
      state.clipStream = state.stream;
    }

    state.clipper = window.TFTClipper ? window.TFTClipper.createClipper(state.clipStream, {
      before: 5, after: 3, bps: 600000,
    }) : null;
    if (state.clipper && !state.clipper.start()) state.clipper = null;

    /* The shop watcher is off unless this browser has turned it on in the lab,
       which is the same rule the shape matchers follow. */
    const shopOn = Boolean(window.TFTShop && window.TFTShop.on());
    const r = state.rules || {};

    /* Only what this player's own restrictions need. A watcher nobody has a
       rule for can only cost frames and produce notes for a gamemaster to
       ignore, and the bench and board checks are the expensive ones. */
    state.detector = D.createDetector({
      region: state.region || DEFAULT_REGION,
      watchShop: shopOn,
      watchTraits: Boolean(r.traitBan || r.builtDifferent),
      watchActivity: Boolean(r.afkRound || r.afkStage),
      watchBench: Boolean(r.pet),
    });

    $('live').hidden = false;
    $('findings').hidden = false;
    $('startBtn').hidden = true;
    $('stopBtn').hidden = false;
    $('clipBtn').hidden = false;
    setTimeout(drawOverlay, 200);

    addFlag('started', 'Proctor started', 0);
    startClock();
    toast('Watching your game window');
  });

  /* Manual clip: same evidence pipe as an automatic one, so it arrives in the
     gamemaster's panel the same way and does not need its own anything. */
  function clipNow(reason) {
    if (!state.stream) { toast('Not watching yet'); return; }
    shoot();
    addFlag('note', reason || 'Clipped by hand', elapsed());
    toast('Clipped — send it when you are ready');
  }

  $('clipBtn').addEventListener('click', () => clipNow('Clipped by hand'));

  /* A keyboard shortcut matters here: nobody alt-tabs out of a carousel to
     press a button, but they might hit one key. */
  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
    if (e.key.toLowerCase() === 'c' && state.stream) { e.preventDefault(); clipNow('Clipped by hand'); }
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
    $('clipBtn').hidden = true;
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

    /* The round indicator, read off the source rather than off this shrunken
       frame — see readFromVideo. Fifty pixels, twice a second. */
    let read = {};
    if (window.TFTDigits && state.detector) {
      const st = window.TFTDigits.stageFromVideo(video);
      read = { stage: st.stage, round: st.round };
    }

    const at = elapsed();
    const prevFrame = state.detector.motionAt();
    state.lastMotion = prevFrame ? D.diff(prevFrame, frame, null) : 0;

    state.detector.push(frame, at, read).forEach(handle);

    paintMeter(state.lastMotion);
    $('liveClock').textContent = clock(at);
    paintTiles();
  }

  /* Left to itself a matcher reports every edge, and some of these things happen
     over and over in a normal game — gold touches zero most rounds. A note for
     each would bury the one that matters and burn the twelve screenshots a game
     is allowed. So each matcher declares which edge is worth a note, how long to
     wait before repeating itself, and how many it gets in total. */
  const matchSeen = {};

  function noteMatch(e, edge, fallback) {
    const m = (window.TFTMatchers && window.TFTMatchers.byId(e.matcher)) || {};
    if ((m.flagOn || 'both') !== 'both' && m.flagOn !== edge) return;

    const seen = matchSeen[e.matcher] || (matchSeen[e.matcher] = { n: 0, last: -1e9 });
    if (m.max && seen.n >= m.max) return;
    if (m.minGap && e.at - seen.last < m.minGap) return;
    seen.n++;
    seen.last = e.at;

    const said = (m.says || {})[edge] || fallback;
    const because = window.TFTMatchers && window.TFTMatchers.why(e.matcher);
    shoot();
    addFlag('note', because ? said + ' — ' + because : said, e.at);
  }

  /* Notes are written by lib/notes.js, which the lab replays over a recording
     to print the feed a gamemaster would have received. Keeping it out here was
     how ten augment notes for one screen reached a real lobby with every one of
     them labelled 4-2: the detector was testable and the writing on top of it
     was not. */
  let notebook = null;

  function handle(e) {
    if (!notebook) {
      notebook = window.TFTNotes.createNotebook({
        rules: state.rules || window.TFTNotes.rulesFrom([]),
        matchers: window.TFTMatchers,
      });
    }
    notebook.push(e).forEach((n) => {
      shoot();
      addFlag(n.kind, n.note, n.at, n.seconds);
    });
    if (e.kind === 'still-end') updateLastFlag('Still for ' + e.seconds + 's', e.seconds);
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
    const flag = { kind, note, at: Math.round(at || 0), seconds: seconds || 0, shot: state.pendingShot || null, sent: false, tries: 0, clip: null, clipSent: false, clipTries: 0 };
    state.pendingShot = null;
    state.flags.push(flag);
    if (state.flags.length > MAX_SHOTS) {
      const dropped = state.flags.shift();
      if (dropped) dropped.shot = null;
    }
    renderFlags();

    /* And the clip: the buffer already holds the lead-up, so this only waits
       for the seconds after. It resolves later than the note, which is on
       purpose — the note and its still go immediately, and the clip catches up
       when it is ready. */
    if (state.clipper) {
      state.clipper.clip().then((blob) => {
        if (!blob) return;
        const reader = new FileReader();
        reader.onload = () => { flag.clip = reader.result; flush(); };
        reader.readAsDataURL(blob);
      }).catch(() => { /* recorder gone; the still still went */ });
    }

    /* Straight out, without being asked.

       A finding the player decides whether to forward is not evidence, it is a
       submission — and the one it would occur to somebody to hold back is
       exactly the one worth having. There is a cash prize on this, so the
       moment a screenshot is taken it belongs to the gamemaster.

       What the player still controls is the only thing that should be theirs:
       whether the proctor is watching at all. Stop the share and nothing more
       is captured. Everything captured before that has already gone. */
    flush();
  }

  /* One sender at a time, with the queue retried until it drains, so a dropped
     connection delays a finding rather than losing it. */
  let sending = false;

  async function flush() {
    if (sending || !state.code) return;
    const queue = state.flags.filter((f) => (!f.sent && f.tries < 6) || (f.clip && !f.clipSent && f.clipTries < 4));
    if (!queue.length) return;
    sending = true;
    let sent = 0;

    try {
      for (const f of queue) {
        /* The clip goes as its own piece of evidence against the same note, so
           a clip that is too big or arrives late never costs the note. */
        if (f.clip && !f.clipSent && f.clipTries < 4) {
          f.clipTries += 1;
          try {
            const res = await fetch('/api/evidence', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ code: state.code, game: state.game, kind: f.kind,
                note: f.note + ' · clip', at: f.at, clip: f.clip }),
            });
            if (res.ok) { f.clipSent = true; f.clip = null; }
            else if (res.status === 413 || res.status === 429) { f.clipSent = true; f.clip = null; }
          } catch (e) { /* retried by the timer */ }
        }

        if (f.sent || f.tries >= 6) continue;
        f.tries += 1;
        try {
          if (f.shot) {
            const res = await fetch('/api/evidence', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ code: state.code, game: state.game, kind: f.kind, note: f.note, at: f.at, image: f.shot }),
            });
            if (res.ok) { f.sent = true; sent += 1; continue; }
            /* Out of room for pictures, or one too big: the words still go. */
            f.shot = null;
          }
          const res = await fetch('/api/flag', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              code: state.code,
              game: state.game,
              flags: [{ kind: f.kind, note: f.note, at: f.at, seconds: f.seconds }],
            }),
          });
          if (res.ok) { f.sent = true; sent += 1; }
        } catch (e) { /* offline; the retry timer comes back to it */ }
      }
    } finally {
      sending = false;
      state.sent += sent;
      renderFlags();
    }
  }

  /* Anything that failed gets picked up again, including after the game ends. */
  setInterval(flush, 15000);

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
    const list = state.flags.filter((f) => f.kind !== 'started' && f.kind !== 'stopped');
    $('findingCount').textContent = `(${list.length})`;
    $('findingList').innerHTML = list.length ? list.slice().reverse().map((f) => `
      <article class="finding">
        ${f.shot ? `<img class="finding__shot" src="${f.shot}" alt="Screen at ${clock(f.at)}">` : '<span class="finding__shot finding__shot--none"></span>'}
        <div>
          <div class="finding__head">
            <span class="tag ${f.kind === 'augment' ? 'tag--live' : 'tag--closed'}">${f.kind === 'augment' ? 'augment' : 'inactive'}</span>
            <span class="finding__at">${clock(f.at)}</span>
            <span class="finding__sent">${f.sent ? 'sent' : f.tries >= 6 ? 'could not send' : 'sending…'}</span>
          </div>
          <div class="finding__note">${esc(f.note)}</div>
        </div>
      </article>`).join('')
      : '<div class="log__empty">Nothing worth a look yet.</div>';
  }

  /* There is no send button and no clear button. Findings go as they are
     made — see addFlag — and what has gone is not the player's to withdraw.
     The only control that stays is stopping the share, which stops new
     findings and nothing else. */

  window.addEventListener('beforeunload', () => {
    clearInterval(state.watchTimer);
    stopClock();
    if (state.clipper) state.clipper.stop();
    if (state.clipStream && state.clipStream !== state.stream) state.clipStream.getTracks().forEach((t) => t.stop());
    if (state.stream) state.stream.getTracks().forEach((t) => t.stop());
  });
})();
