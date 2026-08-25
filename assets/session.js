/* The lobby page: sign in, take a seat, then the live dashboard.

   State lives on the server. This file fetches it, draws it, and posts actions
   back; it never decides anyone's restrictions or placements. Updates arrive by
   polling every few seconds — with a lobby of eight and a roll every twenty
   minutes, a socket would be more machinery than the problem deserves. Polling
   pauses when the tab is hidden and catches up the moment it comes back. */
(function () {
  const T = window.TFT;
  const $ = (id) => document.getElementById(id);

  const POLL_MS = 4000;
  const CODE_RE = /^[23456789CDFGHJKLMNPQRSTVWXZ]{6}$/;
  const PLACES = 8;

  const view = {
    code: null,
    account: null,
    session: null,
    game: 1,
    followGame: true,
    poolOpen: false,
    standingsOpen: false,
    authMode: 'login',
    lastSeed: null,   // your own roll, so a new one animates
    dirtyPlacements: null,
    timer: null,
  };

  /* ---------- helpers ---------- */

  function codeFromUrl() {
    const path = location.pathname.match(/^\/s\/([^/?#]+)/);
    const raw = path ? path[1] : new URLSearchParams(location.search).get('code');
    const code = String(raw || '').trim().toUpperCase();
    return CODE_RE.test(code) ? code : null;
  }

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const reduced = () => document.documentElement.classList.contains('motion-reduced');
  const rankName = (id) => (T.rankById(id) || { name: id || 'Unranked' }).name;
  function ordinal(n) {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  const toast = (msg) => window.TFTUI.toast(msg);
  const ask = (opts) => window.TFTUI.confirm(opts);
  const valid = (form) => window.TFTUI.validate(form);

  async function api(path, body) {
    const res = await fetch('/api/' + path, body
      ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
      : { method: 'GET', headers: { accept: 'application/json' } });
    let data = {};
    try { data = await res.json(); } catch (e) { /* non-JSON error page */ }
    if (!res.ok) throw new Error(data.error || ('Request failed (' + res.status + ')'));
    return data;
  }

  function showOnly(name) {
    const screens = {
      auth: ['auth'],
      lobbies: ['gateHero', 'gateForms', 'myLobbies'],
      join: ['joinGate'],
      board: ['board'],
    };
    Object.values(screens).flat().forEach((id) => { $(id).hidden = true; });
    (screens[name] || []).forEach((id) => { $(id).hidden = false; });
  }

  function fillRanks(select, selected) {
    select.innerHTML = T.RANKS.map((r) =>
      `<option value="${r.id}"${r.id === selected ? ' selected' : ''}>${r.name} — ${T.distText(r)}</option>`).join('');
  }

  /* ---------- boot ---------- */

  fillRanks($('aRank'), 'diamond');
  view.code = codeFromUrl();
  start();

  async function start() {
    try {
      const who = await api('auth');
      view.account = who.account;
    } catch (e) { view.account = null; }

    if (!view.account) { showAuth(); return; }
    if (!view.code) { showLobbies(); return; }
    refresh(true).catch((err) => { toast(err.message); showLobbies(); });
  }

  /* ---------- auth ---------- */

  function showAuth() {
    stopPolling();
    showOnly('auth');
    setAuthMode(view.authMode);
    $('aName').focus();
  }

  function setAuthMode(mode) {
    view.authMode = mode;
    $('authTabs').querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
    $('aRankField').hidden = mode !== 'register';
    $('authSubmit').textContent = mode === 'register' ? 'Create my account' : 'Sign in';
    $('authTitle').textContent = mode === 'register' ? 'Claim your name' : 'Your name and passcode';
    $('authHint').textContent = mode === 'register'
      ? 'Your name is yours for the tournament. Pick a passcode you will remember: there is no email on file, so only an admin can reset it.'
      : 'Same name and passcode you registered with.';
    $('authError').hidden = true;
  }

  $('authTabs').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-mode]');
    if (btn) setAuthMode(btn.dataset.mode);
  });

  $('authForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('authError');
    err.hidden = true;
    if (!valid(e.target)) return;
    const payload = { op: view.authMode, name: $('aName').value, passcode: $('aPass').value };
    if (view.authMode === 'register') payload.rank = $('aRank').value;
    try {
      const out = await api('auth', payload);
      view.account = out.account;
      $('aPass').value = '';
      if (view.code) await refresh(true); else showLobbies();
    } catch (e2) {
      err.textContent = e2.message;
      err.hidden = false;
    }
  });

  /* ---------- lobby list ---------- */

  async function showLobbies() {
    stopPolling();
    showOnly('lobbies');
    try {
      const mine = await api('me');
      const list = mine.lobbies || [];
      $('myLobbies').hidden = !list.length;
      $('lobbyList').innerHTML = list.map((l) => `
        <a class="lobbyrow${l.open ? '' : ' lobbyrow--closed'}" href="/s/${esc(l.code)}">
          <span class="lobbyrow__name">${esc(l.name)} <span class="tag ${l.open ? 'tag--live' : 'tag--closed'}">${l.open ? 'open' : 'closed'}</span></span>
          <span class="lobbyrow__meta">${esc(l.code)} · ${l.players} player${l.players === 1 ? '' : 's'}${l.isGm ? ' · you run it' : ''}</span>
          <span class="lobbyrow__go">&rarr;</span>
        </a>`).join('');
    } catch (e) { $('myLobbies').hidden = true; }
  }

  $('createForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('createError');
    err.hidden = true;
    if (!valid(e.target)) return;
    try {
      const out = await api('create', { sessionName: $('cSession').value });
      history.replaceState(null, '', '/s/' + out.code);
      view.code = out.code;
      await refresh(true);
      toast('Lobby ' + out.code + ' is open');
    } catch (e2) {
      err.textContent = e2.message;
      err.hidden = false;
    }
  });

  $('joinForm').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!valid(e.target)) return;
    const code = $('jCode').value.trim().toUpperCase();
    if (!CODE_RE.test(code)) {
      window.TFTUI.fieldError($('jCode'), 'Six characters, no vowels. Check the code your gamemaster sent.');
      return;
    }
    location.href = '/s/' + code;
  });

  $('joinNow').addEventListener('click', async () => {
    const err = $('joinGateError');
    err.hidden = true;
    try {
      await api('join', { code: view.code });
      await refresh(true);
      toast('Seated');
    } catch (e) {
      err.textContent = e.message;
      err.hidden = false;
    }
  });

  /* ---------- polling ---------- */

  async function refresh(force) {
    const data = await api('state?code=' + view.code);
    if (data.account) view.account = data.account;

    if (data.needsLogin) { showAuth(); return; }

    if (data.needsJoin) {
      stopPolling();
      showOnly('join');
      $('joinName').textContent = data.preview.name;
      $('joinMeta').textContent = `${data.preview.code} · ${data.preview.players} player${data.preview.players === 1 ? '' : 's'}`
        + (data.preview.gm ? ` · gamemaster ${data.preview.gm}` : '')
        + (data.preview.open ? '' : ' · closed to new players');
      $('joinAs').textContent = `${view.account.display} (${rankName(view.account.rank)})`;
      $('joinNow').disabled = !data.preview.open;
      return;
    }

    const next = data.session;
    const changed = !view.session || view.session.v !== next.v;
    view.session = next;
    if (view.followGame) view.game = next.game;
    if (changed || force) render();
    startPolling();
  }

  function startPolling() {
    if (view.timer) return;
    view.timer = setInterval(() => {
      if (document.hidden) return;
      refresh(false).catch((err) => console.warn('poll failed:', err));
    }, POLL_MS);
  }

  function stopPolling() {
    clearInterval(view.timer);
    view.timer = null;
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && view.session) refresh(false).catch((err) => console.warn('refresh failed:', err));
  });

  /* ---------- dashboard ---------- */

  function render() {
    const s = view.session;
    showOnly('board');
    document.title = s.name + ' — TFT Lobby';

    $('boardName').textContent = s.name;
    $('boardCode').textContent = s.code;
    $('gmPanel').hidden = !s.isGm;

    /* A player is here to read two things: what they are carrying and what
       everyone else is. The lobby's plumbing — the invite link, the seeds, the
       whole roster grid — is gamemaster furniture, so they get a list instead of
       a card wall and the standings fold away. */
    $('copyLink').hidden = !s.isGm;
    $('proctorLink').href = `/proctor?code=${s.code}&game=${view.game}`;
    $('rosterGrid').hidden = !s.isGm;
    $('rosterList').hidden = s.isGm;
    $('rosterTitle').innerHTML = s.isGm
      ? `Lobby <span class="count" id="rosterCount">(${s.players.length})</span>`
      : 'Everyone else';
    $('standingsTable').hidden = !s.isGm && !view.standingsOpen;
    $('standingsToggle').classList.toggle('title--toggle', !s.isGm);
    const rosterCount = $('rosterCount');
    if (rosterCount) rosterCount.textContent = `(${s.players.length})`;
    $('boardStatus').textContent = s.open ? 'LOBBY OPEN' : 'LOBBY CLOSED';

    /* A closed lobby is a record, not a live board: it dims, says so at the top,
       and every control that would change it is refused by the server anyway. */
    $('board').classList.toggle('board--closed', !s.open);
    $('closedBanner').hidden = s.open;
    if (!s.open) {
      $('closedNote').textContent = s.isGm
        ? 'No more rolls, placements or players. Reopen it to make changes, or delete it for good.'
        : 'No more rolls or placements. What is below is final.';
      $('closedActions').innerHTML = s.isGm
        ? '<button class="btn" type="button" data-closed="reopen">Reopen</button>'
          + '<button class="btn btn--danger" type="button" data-closed="delete">Delete</button>'
        : '';
    }
    document.querySelectorAll('.gmpanel__row .btn, #resultsPanel button, #penaltyPanel button')
      .forEach((b) => { if (b.id !== 'toggleOpen' && b.id !== 'deleteLobby') b.disabled = !s.open; });

    renderGames();
    renderMine();
    renderRoster();
    renderStandings();
    if (s.isGm) renderGmPanel();
  }

  const placementsFor = (game) => ((view.session.results || {})[game] || {}).placements || {};

  function renderGames() {
    const s = view.session;
    const games = new Set([1, 2, 3, s.game, view.game]);
    Object.keys(s.rolls).forEach((g) => games.add(Number(g)));
    Object.keys(s.results || {}).forEach((g) => games.add(Number(g)));
    const list = [...games].filter((n) => n >= 1 && n <= 9).sort((a, b) => a - b);

    $('gameTabs').innerHTML = list.map((n) => {
      const rolled = Object.keys(s.rolls[n] || {}).length;
      const done = Object.keys(placementsFor(n)).length;
      return `<button type="button" class="gametab" data-game="${n}" aria-pressed="${n === view.game}">
        Game ${n}<span class="gametab__n">${done ? done + ' placed' : rolled + '/' + s.players.length}</span>
      </button>`;
    }).join('') + (s.isGm && list.length < 9
      ? `<button type="button" class="gametab gametab--add" data-game="${Math.max(...list) + 1}">+ Game ${Math.max(...list) + 1}</button>`
      : '');
  }

  /* Folded away by default for a player: it matters between games, never during
     one. Their own position stays on the label so folding costs them nothing. */
  $('standingsToggle').addEventListener('click', () => {
    if (view.session && view.session.isGm) return;
    view.standingsOpen = !view.standingsOpen;
    $('standingsTable').hidden = !view.standingsOpen;
    renderStandings();
  });

  $('closedBanner').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-closed]');
    if (!btn) return;
    if (btn.dataset.closed === 'reopen') {
      try { await act('gm', { op: 'setOpen', open: true }); toast('Lobby reopened'); }
      catch (err) { toast(err.message); }
    } else {
      deleteLobby();
    }
  });

  $('gameTabs').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-game]');
    if (!btn) return;
    view.game = Number(btn.dataset.game);
    view.followGame = false;
    view.dirtyPlacements = null;
    render();
    if (view.session.isGm) {
      try { await act('gm', { op: 'setGame', game: view.game }); view.followGame = true; } catch (err) { toast(err.message); }
    }
  });

  function renderMine() {
    const s = view.session;
    const me = s.players.find((p) => p.id === s.you);
    const roll = (s.rolls[view.game] || {})[s.you] || null;
    const place = placementsFor(view.game)[s.you] || null;
    const fresh = roll && roll.seed !== view.lastSeed;

    $('mine').innerHTML = `
      <div class="section-label">/ YOUR RESTRICTIONS — GAME ${view.game}</div>
      <div class="plate">
        <div class="plate__bar">
          <span class="plate__who">${esc(me ? me.display : 'You')}</span>
          <span>${esc(rankName(me && me.rank))}${me && me.isGm ? ' · GAMEMASTER' : ''}</span>
          ${place ? `<span class="place place--${place <= 4 ? 'top' : 'bot'}">${ordinal(place)}</span>` : ''}
          <span class="plate__seed">${roll ? 'SEED <b>' + esc(roll.seed) + '</b>' : ''}</span>
        </div>
        <div class="plate__body">
          ${roll && roll.picks.length ? roll.picks.map((p, i) => slotMarkup(p, i)).join('')
            : roll ? '<div class="plate__empty plate__empty--clean"><span>No restrictions this game — play clean</span></div>'
            : '<div class="plate__empty"><span>Waiting for the gamemaster to roll</span></div>'}
        </div>
      </div>`;

    const slots = $('mine').querySelectorAll('.slot');
    if (roll && fresh) {
      view.lastSeed = roll.seed;
      spin(slots, roll.picks);
    } else if (roll) {
      slots.forEach((slot, i) => land(slot, roll.picks[i]));
    }
  }

  function slotMarkup(pick, i) {
    return `<div class="slot slot--${pick.tier}" data-slot="${i}">
      <span class="slot__tier">${pick.tier}</span>
      <span class="slot__text"></span>
      <span class="slot__meta"></span>
    </div>`;
  }

  function land(slot, pick) {
    slot.classList.remove('is-spinning');
    slot.querySelector('.slot__text').innerHTML = esc(pick.text) + detailChip(pick);
    slot.querySelector('.slot__meta').textContent = pick.rerolls
      ? `${pick.rerolls} auto-reroll${pick.rerolls > 1 ? 's' : ''} for a clash`
      : '';
  }

  /* Some restrictions leave a blank the player would otherwise fill in for
     themselves — which shop slot, which stage. The randomizer fills it, so it
     is shown as something that was rolled rather than folded into the text. */
  function detailChip(pick) {
    return T.detailsOf(pick).map((d) =>
      `<span class="detail" title="Rolled by the randomizer, not chosen">${esc(d.label)}: <b>${esc(d.value)}</b></span>`).join('');
  }

  /* Your own roll flickers in when it is new to you, so a restriction landing
     on your screen feels like a roll rather than a page refresh. */
  function spin(slots, picks) {
    if (reduced()) { slots.forEach((slot, i) => land(slot, picks[i])); return; }
    const timers = [];
    slots.forEach((slot, i) => {
      const options = T.POOL[picks[i].tier];
      const text = slot.querySelector('.slot__text');
      slot.classList.add('is-spinning');
      slot.querySelector('.slot__meta').textContent = '';
      text.textContent = '';
      timers.push(setInterval(() => {
        text.textContent = options[Math.floor(Math.random() * options.length)].text;
      }, 55));
    });
    picks.forEach((p, i) => {
      setTimeout(() => {
        clearInterval(timers[i]);
        slots[i].classList.add('is-locked');
        land(slots[i], p);
      }, 520 + i * 340);
    });
  }

  /* One line per player: name, then everything they are carrying, rolled
     details included. Same information as the cards, a third of the height. */
  function renderRosterList() {
    const s = view.session;
    const rolls = s.rolls[view.game] || {};
    const places = placementsFor(view.game);

    const others = s.players.filter((p) => p.id !== s.you);
    if (!others.length) {
      $('rosterList').innerHTML = '<div class="log__empty">Nobody else has taken a seat yet.</div>';
      return;
    }

    $('rosterList').innerHTML = others.map((p) => {
      const roll = rolls[p.id];
      const place = places[p.id];
      const picks = roll && roll.picks.length
        ? roll.picks.map((k) => `<span class="rosterlist__pick">
            <b class="rosterlist__tier rosterlist__tier--${k.tier}">${k.tier === 'major' ? 'maj' : 'min'}</b>${esc(k.text)}${detailChip(k)}</span>`).join('')
        : roll
          ? '<span class="rosterlist__clean">plays clean</span>'
          : '<span class="rosterlist__waiting">not rolled yet</span>';

      return `<div class="rosterlist__row">
        <span class="rosterlist__name">${esc(p.display)}${p.isGm ? ' <span class="tag tag--gm">GM</span>' : ''}
          ${place ? `<span class="place place--${place <= 4 ? 'top' : 'bot'}">${ordinal(place)}</span>` : ''}</span>
        <span class="rosterlist__picks">${picks}</span>
      </div>`;
    }).join('');
  }

  function renderRoster() {
    const s = view.session;
    if (!s.isGm) { renderRosterList(); return; }
    const rolls = s.rolls[view.game] || {};
    const places = placementsFor(view.game);

    $('rosterGrid').innerHTML = s.players.map((p) => {
      const roll = rolls[p.id];
      const place = places[p.id];
      return `<article class="pcard${p.id === s.you ? ' pcard--me' : ''}">
        <header class="pcard__head">
          <span class="pcard__name">${esc(p.display)}</span>
          <span class="pcard__tags">
            ${place ? `<span class="place place--${place <= 4 ? 'top' : 'bot'}">${ordinal(place)}</span>` : ''}
            ${p.isGm ? '<span class="tag tag--gm">GM</span>' : ''}
            <span class="tag">${esc(rankName(p.rank))}</span>
          </span>
        </header>
        ${roll && roll.picks.length ? `<ul class="pcard__list">${roll.picks.map((pick, i) => `
          <li class="pcard__pick pcard__pick--${pick.tier}">
            <b>${pick.tier}</b>
            <span>${esc(pick.text)}${detailChip(pick)}</span>
            ${s.isGm ? `<button class="slot__reroll" type="button" data-op="rerollSlot" data-player="${esc(p.id)}" data-index="${i}">Reroll</button>` : ''}
          </li>`).join('')}</ul>
          <div class="pcard__seed">SEED ${esc(roll.seed)}</div>`
        : roll ? '<div class="pcard__waiting pcard__waiting--clean">Plays clean — no restrictions</div>'
        : '<div class="pcard__waiting">No restrictions yet</div>'}
        ${penaltiesFor(p.id)}
        ${s.isGm ? gmRow(p) : ''}
      </article>`;
    }).join('');
  }

  /* Everyone can see what has been called against everyone else: an umpire
     decision that only the person penalised knows about is a rumour. */
  function penaltiesFor(playerId) {
    const list = (view.session.penalties || []).filter((p) => p.playerId === playerId);
    if (!list.length) return '';
    return `<div class="penalty__list">${list.map((p) => `
      <div class="penalty"><span>G${p.game} — ${esc(p.reason)}</span></div>`).join('')}</div>`;
  }

  function gmRow(p) {
    return `<div class="pcard__gm">
      <select class="pcard__rank" data-op="setRank" data-player="${esc(p.id)}">
        ${T.RANKS.map((r) => `<option value="${r.id}"${r.id === p.rank ? ' selected' : ''}>${r.name}</option>`).join('')}
      </select>
      <button class="slot__reroll" type="button" data-op="roll-one" data-player="${esc(p.id)}">Roll</button>
      ${p.isGm ? '' : `<button class="slot__reroll" type="button" data-op="transferGm" data-player="${esc(p.id)}">Make GM</button>
      <button class="slot__reroll" type="button" data-op="removePlayer" data-player="${esc(p.id)}">Remove</button>`}
    </div>`;
  }

  /* ---------- standings ----------
     Points are the usual TFT ladder: 1st is worth 8, 8th is worth 1. One line
     to change if the tournament settles on something else. */
  const pointsFor = (place) => (PLACES + 1) - place;

  function renderStandings() {
    const s = view.session;
    const results = s.results || {};
    const games = Object.keys(results).map(Number).sort((a, b) => a - b);

    if (!games.length) {
      $('standingsTable').innerHTML = '<div class="log__empty">No placements submitted yet.</div>';
      $('standingsNote').textContent = '1st = 8 points · 8th = 1 point';
      return;
    }

    const rows = s.players.map((p) => {
      const played = [];
      games.forEach((g) => {
        const place = (results[g].placements || {})[p.id];
        if (place) played.push({ game: g, place });
      });
      const points = played.reduce((sum, r) => sum + pointsFor(r.place), 0);
      const avg = played.length ? played.reduce((sum, r) => sum + r.place, 0) / played.length : null;
      return { p, played, points, avg };
    }).sort((a, b) => b.points - a.points || (a.avg || 9) - (b.avg || 9));

    const you = rows.find((r) => r.p.id === s.you);
    $('standingsNote').textContent = s.isGm || !you || !you.played.length
      ? '1st = 8 points · 8th = 1 point'
      : `You are ${ordinal(rows.indexOf(you) + 1)} · ${you.points} pts`;

    $('standingsTable').innerHTML = `
      <div class="standings__head">
        <span>/ #</span><span>/ PLAYER</span>${games.map((g) => `<span>/ G${g}</span>`).join('')}<span>/ AVG</span><span>/ PTS</span>
      </div>
      ${rows.map((row, i) => `
        <div class="standings__row${row.p.id === s.you ? ' is-me' : ''}">
          <span class="standings__rank">${i + 1}</span>
          <span>${esc(row.p.display)}</span>
          ${games.map((g) => {
            const hit = row.played.find((r) => r.game === g);
            return `<span class="standings__cell">${hit ? ordinal(hit.place) : '—'}</span>`;
          }).join('')}
          <span class="standings__cell">${row.avg ? row.avg.toFixed(2) : '—'}</span>
          <span class="standings__pts">${row.points}</span>
        </div>`).join('')}`;
    $('standingsTable').style.setProperty('--games', games.length);
  }

  /* ---------- gamemaster ---------- */

  async function act(route, payload) {
    const data = await api(route, Object.assign({ code: view.code }, payload));
    if (data.session) {
      view.session = data.session;
      if (view.followGame) view.game = data.session.game;
      render();
    }
    return data;
  }

  $('rosterGrid').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-op]');
    if (!btn) return;
    const op = btn.dataset.op;
    const playerId = btn.dataset.player;
    const who = (view.session.players.find((p) => p.id === playerId) || {}).display || playerId;

    try {
      if (op === 'roll-one') {
        await act('roll', { game: view.game, target: playerId });
        toast('Rolled for ' + who);
      } else if (op === 'rerollSlot') {
        await act('gm', { op, playerId, game: view.game, index: Number(btn.dataset.index) });
        toast('Slot rerolled');
      } else if (op === 'removePlayer') {
        if (!await ask({ title: `Remove ${who}?`, body: 'Their rolls, placements and penalties in this lobby go with them. Their account is untouched.', confirmText: 'Remove', danger: true })) return;
        await act('gm', { op, playerId });
        toast(who + ' removed');
      } else if (op === 'transferGm') {
        if (!await ask({ title: `Hand the lobby to ${who}?`, body: 'They get the gamemaster controls and you lose them.', confirmText: 'Hand it over' })) return;
        await act('gm', { op, playerId });
        toast(who + ' is the gamemaster');
      }
    } catch (err) { toast(err.message); }
  });

  $('rosterGrid').addEventListener('change', async (e) => {
    const sel = e.target.closest('select[data-op="setRank"]');
    if (!sel) return;
    try {
      await act('gm', { op: 'setRank', playerId: sel.dataset.player, rank: sel.value });
      toast('Rank updated');
    } catch (err) { toast(err.message); }
  });

  $('rollMissing').addEventListener('click', async () => {
    try { await act('roll', { game: view.game, target: 'missing' }); toast('Rolled game ' + view.game); }
    catch (err) { toast(err.message); }
  });

  $('rollAll').addEventListener('click', async () => {
    if (!await ask({ title: 'Re-roll the whole lobby?', body: `Everyone in game ${view.game} gets a new set of restrictions. What they are carrying now is replaced.`, confirmText: 'Re-roll everyone' })) return;
    try { await act('roll', { game: view.game, target: 'all' }); toast('Whole lobby rerolled'); }
    catch (err) { toast(err.message); }
  });

  $('clearGame').addEventListener('click', async () => {
    if (!await ask({ title: `Clear game ${view.game}?`, body: 'Every roll and placement for this game is removed. The other games are untouched.', confirmText: 'Clear the game', danger: true })) return;
    try {
      await act('gm', { op: 'clearGame', game: view.game });
      view.lastSeed = null;
      toast('Game ' + view.game + ' cleared');
    } catch (err) { toast(err.message); }
  });

  $('toggleOpen').addEventListener('click', async () => {
    try {
      await act('gm', { op: 'setOpen', open: !view.session.open });
      toast(view.session.open ? 'Lobby open' : 'Lobby closed');
    } catch (err) { toast(err.message); }
  });

  async function deleteLobby() {
    const s = view.session;
    const ok = await ask({
      title: 'Delete this lobby?',
      body: `${s.name} (${s.code}) and everything in it — rolls, placements and penalties for ${s.players.length} player${s.players.length === 1 ? '' : 's'} — is gone for good. Player accounts and their other lobbies are untouched.`,
      confirmText: 'Delete for good',
      danger: true,
    });
    if (!ok) return;
    try {
      await api('gm', { code: view.code, op: 'deleteLobby' });
      toast('Lobby deleted');
      location.href = '/session';
    } catch (err) { toast(err.message); }
  }

  $('deleteLobby').addEventListener('click', deleteLobby);

  $('togglePool').addEventListener('click', () => {
    view.poolOpen = !view.poolOpen;
    $('poolPanel').hidden = !view.poolOpen;
  });

  /* ---------- placements ---------- */

  function renderGmPanel() {
    const s = view.session;
    const off = new Set(s.pool.off || []);
    const rolled = Object.keys(s.rolls[view.game] || {}).length;
    const places = view.dirtyPlacements || placementsFor(view.game);

    $('toggleOpen').textContent = s.open ? 'Close the lobby' : 'Reopen the lobby';
    $('gmHint').textContent = `Game ${view.game}: ${rolled} of ${s.players.length} rolled · `
      + `${T.ALL.length - off.size} of ${T.ALL.length} restrictions in the draw · `
      + `invite link ${location.origin}/s/${s.code}`;

    $('resultsGame').textContent = view.game;
    $('resultsGrid').innerHTML = s.players.map((p) => `
      <label class="results__row">
        <span class="results__name">${esc(p.display)}</span>
        <select class="results__pick" data-player="${esc(p.id)}">
          <option value="">—</option>
          ${Array.from({ length: PLACES }, (_, i) => i + 1).map((n) => `<option value="${n}"${places[p.id] === n ? ' selected' : ''}>${ordinal(n)}</option>`).join('')}
        </select>
      </label>`).join('');

    const render = (list, mount) => {
      $(mount).innerHTML = list.map((r) => {
        const on = !off.has(r.id);
        return `<button class="pool__item ${on ? 'is-on' : 'is-off'}" type="button" data-id="${r.id}" aria-pressed="${on}">
          ${boxSvg(on)}
          <span class="pool__label">${esc(r.text)}<span class="pool__fam">${esc(r.family)}</span></span>
        </button>`;
      }).join('');
    };
    render(T.MAJOR, 'majorList');
    render(T.MINOR, 'minorList');
    $('majorCount').textContent = `(${T.MAJOR.filter((r) => !off.has(r.id)).length}/${T.MAJOR.length})`;
    $('minorCount').textContent = `(${T.MINOR.filter((r) => !off.has(r.id)).length}/${T.MINOR.length})`;
    $('poolPanel').hidden = !view.poolOpen;
    renderPenalties();
    renderFlags();
  }

  /* Machine notes, kept visually apart from penalties: one is an observation,
     the other is a decision, and confusing them would be unfair to players. */
  function renderFlags() {
    const s = view.session;
    const list = (s.flags || []).filter((f) => f.game === view.game);
    $('flagList').innerHTML = list.length
      ? list.slice().reverse().map((f) => {
        const who = (s.players.find((x) => x.id === f.playerId) || {}).display || f.playerId;
        const src = `/api/evidence?code=${esc(s.code)}&id=${esc(f.ev)}`;

        /* Clips are the ones worth opening — a still says a screen was open, a
           clip says what the cursor did. Neither is fetched until a note
           actually has one, so a lobby with fifty notes draws a list rather
           than downloading fifty files, and the clip only loads its first frame
           until somebody presses play. */
        const thumb = !f.ev
          ? '<span class="flagrow__shot flagrow__shot--none"></span>'
          : f.clip
            ? `<video class="flagrow__shot flagrow__shot--clip" src="${src}" preload="metadata" controls muted playsinline></video>`
            : `<a class="flagrow__shot" href="${src}" target="_blank" rel="noopener">
                <img src="${src}" alt="Screen at ${clockText(f.at)}" loading="lazy">
              </a>`;

        return `<div class="flagrow${f.clip ? ' flagrow--clip' : ''}">
          ${thumb}
          <span class="flagrow__text">${esc(who)} · ${clockText(f.at)} — ${esc(f.note)}</span>
        </div>`;
      }).join('')
      : '<div class="log__empty">No proctor notes for this game.</div>';
  }

  const clockText = (s) => String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(Math.floor(s % 60)).padStart(2, '0');

  function renderPenalties() {
    const s = view.session;
    const sel = $('penaltyPlayer');
    const keep = sel.value;
    sel.innerHTML = s.players.map((p) => `<option value="${esc(p.id)}">${esc(p.display)}</option>`).join('');
    if (keep) sel.value = keep;

    const list = s.penalties || [];
    $('penaltyList').innerHTML = list.length
      ? list.map((p) => {
        const who = (s.players.find((x) => x.id === p.playerId) || {}).display || p.playerId;
        return `<div class="penalty">
          <span>G${p.game} · ${esc(who)} — ${esc(p.reason)}</span>
          <button class="slot__reroll" type="button" data-penalty="${esc(p.id)}">Remove</button>
        </div>`;
      }).join('')
      : '<div class="log__empty">Nothing recorded.</div>';
  }

  $('penaltyForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!valid(e.target)) return;
    try {
      await act('gm', {
        op: 'addPenalty',
        playerId: $('penaltyPlayer').value,
        game: view.game,
        reason: $('penaltyReason').value,
      });
      $('penaltyReason').value = '';
      toast('Penalty recorded');
    } catch (err) { toast(err.message); }
  });

  $('penaltyList').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-penalty]');
    if (!btn) return;
    try { await act('gm', { op: 'removePenalty', penaltyId: btn.dataset.penalty }); toast('Penalty removed'); }
    catch (err) { toast(err.message); }
  });

  /* Held locally until submitted, so a poll landing mid-entry cannot wipe a
     half-filled scoreboard. */
  $('resultsGrid').addEventListener('change', () => {
    const draft = {};
    $('resultsGrid').querySelectorAll('select[data-player]').forEach((sel) => {
      if (sel.value) draft[sel.dataset.player] = Number(sel.value);
    });
    view.dirtyPlacements = draft;
  });

  $('savePlacements').addEventListener('click', async () => {
    const err = $('resultsError');
    err.hidden = true;
    const draft = view.dirtyPlacements || placementsFor(view.game);
    const used = new Set();
    for (const [, place] of Object.entries(draft)) {
      if (used.has(place)) {
        err.textContent = `Two players are both ${ordinal(place)}. Fix that first.`;
        err.hidden = false;
        return;
      }
      used.add(place);
    }
    try {
      await act('gm', { op: 'setPlacements', game: view.game, placements: draft });
      view.dirtyPlacements = null;
      toast('Placements saved');
    } catch (e) {
      err.textContent = e.message;
      err.hidden = false;
    }
  });

  $('clearPlacements').addEventListener('click', async () => {
    if (!await ask({ title: `Clear the placements for game ${view.game}?`, body: 'The rolls stay; only the finishing order is removed.', confirmText: 'Clear placements', danger: true })) return;
    try {
      view.dirtyPlacements = null;
      await act('gm', { op: 'clearPlacements', game: view.game });
      toast('Placements cleared');
    } catch (err) { toast(err.message); }
  });

  /* A starting point for typing, not a result: the roster order with 1st at the
     top, so the gamemaster edits eight fields instead of filling eight. */
  $('autoFill').addEventListener('click', () => {
    const draft = {};
    view.session.players.forEach((p, i) => { if (i < PLACES) draft[p.id] = i + 1; });
    view.dirtyPlacements = draft;
    renderGmPanel();
    toast('Filled from lobby order — check it before submitting');
  });

  function boxSvg(on) {
    return on
      ? '<svg class="pool__box" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><rect x="0.5" y="0.5" width="11" height="11" fill="none" stroke="currentColor"/><path d="M3 6.2 5.2 8.5 9 3.8" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>'
      : '<svg class="pool__box" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><rect x="0.5" y="0.5" width="11" height="11" fill="none" stroke="currentColor"/></svg>';
  }

  $('poolPanel').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-id]');
    if (!btn) return;
    const off = new Set(view.session.pool.off || []);
    if (off.has(btn.dataset.id)) off.delete(btn.dataset.id); else off.add(btn.dataset.id);
    try { await act('gm', { op: 'setPool', off: [...off] }); }
    catch (err) { toast(err.message); }
  });

  /* ---------- chrome ---------- */

  $('copyLink').addEventListener('click', () => {
    copyText(`${location.origin}/s/${view.code}`, 'Invite link copied');
  });

  $('copyBoard').addEventListener('click', () => {
    const s = view.session;
    const rolls = s.rolls[view.game] || {};
    const places = placementsFor(view.game);
    const lines = [`${s.name} — Game ${view.game}`, ''];
    s.players.forEach((p) => {
      const roll = rolls[p.id];
      const place = places[p.id];
      lines.push(`${p.display} (${rankName(p.rank)})${place ? ' — ' + ordinal(place) : ''}`);
      if (!roll) lines.push('  — not rolled yet');
      else if (!roll.picks.length) lines.push('  — no restrictions');
      else {
        roll.picks.forEach((pick) => lines.push(`  [${pick.tier.toUpperCase()}] ${T.pickText(pick)}`));
        lines.push(`  seed ${roll.seed}`);
      }
      lines.push('');
    });
    copyText(lines.join('\n').trim(), 'Lobby copied');
  });

  function copyText(text, msg) {
    const done = () => toast(msg);
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
    } else fallbackCopy(text, done);
  }

  function fallbackCopy(text, done) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); } catch (e) { toast('Copy failed'); }
    document.body.removeChild(ta);
  }
})();
