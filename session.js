/* The session page: create/join a lobby, then the live dashboard.

   State lives on the server. This file fetches it, draws it, and posts actions
   back; it never decides anyone's restrictions. Updates arrive by polling every
   few seconds — with a lobby of eight and a roll every twenty minutes, a socket
   would be more machinery than the problem deserves. Polling pauses when the
   tab is hidden and catches up the moment it comes back. */
(function () {
  const T = window.TFT;
  const $ = (id) => document.getElementById(id);

  const POLL_MS = 4000;
  const THEMES = ['light', 'night-owl', 'amber', 'paper'];

  const view = {
    code: null,
    session: null,
    game: 1,
    followGame: true,
    poolOpen: false,
    lastSeed: null,   // your own roll, to know when to animate
    timer: null,
  };

  /* ---------- helpers ---------- */

  function codeFromUrl() {
    const path = location.pathname.match(/^\/s\/([^/?#]+)/);
    const raw = path ? path[1] : new URLSearchParams(location.search).get('code');
    const code = String(raw || '').trim().toUpperCase();
    return /^[23456789CDFGHJKLMNPQRSTVWXZ]{6}$/.test(code) ? code : null;
  }

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const reduced = () => document.documentElement.classList.contains('motion-reduced');
  const rankName = (id) => (T.rankById(id) || { name: id || 'Unranked' }).name;

  let toastTimer;
  function toast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.add('is-up');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('is-up'), 2400);
  }

  async function api(path, body) {
    const res = await fetch('/api/' + path, body
      ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
      : { method: 'GET', headers: { accept: 'application/json' } });
    let data = {};
    try { data = await res.json(); } catch (e) { /* non-JSON error page */ }
    if (!res.ok) throw new Error(data.error || ('Request failed (' + res.status + ')'));
    return data;
  }

  function showOnly(id) {
    ['gate', 'gateForms', 'login', 'board'].forEach((s) => { $(s).hidden = s !== id; });
    if (id === 'gate') { $('gate').hidden = false; $('gateForms').hidden = false; }
  }

  function fillRanks(select, selected) {
    select.innerHTML = T.RANKS.map((r) => `<option value="${r.id}"${r.id === selected ? ' selected' : ''}>${r.name} — ${dist(r)}</option>`).join('');
  }

  function dist(r) {
    const parts = [];
    if (r.major) parts.push(r.major + ' major');
    if (r.minor) parts.push(r.minor + ' minor');
    return parts.join(' + ');
  }

  /* ---------- boot ---------- */

  fillRanks($('cRank'), 'diamond');
  fillRanks($('lRank'), 'diamond');
  $('themeBtn').addEventListener('click', cycleTheme);

  view.code = codeFromUrl();
  if (!view.code) {
    showOnly('gate');
  } else {
    refresh(true).catch((err) => {
      showOnly('gate');
      toast(err.message);
    });
  }

  /* ---------- create / join ---------- */

  $('createForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('createError');
    err.hidden = true;
    try {
      const out = await api('create', {
        sessionName: $('cSession').value,
        name: $('cName').value,
        rank: $('cRank').value,
        passcode: $('cPass').value,
      });
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
    const code = $('jCode').value.trim().toUpperCase();
    if (!/^[23456789CDFGHJKLMNPQRSTVWXZ]{6}$/.test(code)) {
      const err = $('joinError');
      err.textContent = 'Session codes are 6 characters, no vowels.';
      err.hidden = false;
      return;
    }
    location.href = '/s/' + code;
  });

  $('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('loginError');
    err.hidden = true;
    try {
      await api('join', {
        code: view.code,
        name: $('lName').value,
        passcode: $('lPass').value,
        rank: $('lRank').value,
      });
      await refresh(true);
    } catch (e2) {
      err.textContent = e2.message;
      err.hidden = false;
    }
  });

  /* ---------- polling ---------- */

  async function refresh(force) {
    const data = await api('state?code=' + view.code);

    if (data.needsAuth) {
      stopPolling();
      showLogin(data.preview);
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
      refresh(false).catch(() => { /* offline for a beat; next tick retries */ });
    }, POLL_MS);
  }

  function stopPolling() {
    clearInterval(view.timer);
    view.timer = null;
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && view.session) refresh(false).catch(() => {});
  });

  function showLogin(preview) {
    showOnly('login');
    $('lobbyName').textContent = preview.name;
    $('lobbyMeta').textContent = `${preview.code} · ${preview.players} player${preview.players === 1 ? '' : 's'}`
      + (preview.gm ? ` · gamemaster ${preview.gm}` : '')
      + (preview.open ? '' : ' · closed to new players');
    $('lName').focus();
  }

  /* ---------- dashboard ---------- */

  function render() {
    const s = view.session;
    showOnly('board');
    document.title = s.name + ' — TFT Session';

    $('boardName').textContent = s.name;
    $('boardCode').textContent = s.code;
    $('gmPanel').hidden = !s.isGm;
    $('rosterCount').textContent = `(${s.players.length})`;
    $('boardStatus').textContent = s.open ? 'LIVE · LOBBY OPEN' : 'LIVE · LOBBY CLOSED';

    renderGames();
    renderMine();
    renderRoster();
    if (s.isGm) renderGmPanel();
  }

  function renderGames() {
    const s = view.session;
    const games = new Set([1, 2, 3, s.game, view.game]);
    Object.keys(s.rolls).forEach((g) => games.add(Number(g)));
    const list = [...games].filter((n) => n >= 1 && n <= 9).sort((a, b) => a - b);

    $('gameTabs').innerHTML = list.map((n) => {
      const rolled = Object.keys(s.rolls[n] || {}).length;
      return `<button type="button" class="gametab" data-game="${n}" aria-pressed="${n === view.game}">
        Game ${n}<span class="gametab__n">${rolled}/${s.players.length}</span>
      </button>`;
    }).join('') + (s.isGm && list.length < 9
      ? `<button type="button" class="gametab gametab--add" data-game="${Math.max(...list) + 1}">+ Game ${Math.max(...list) + 1}</button>`
      : '');
  }

  $('gameTabs').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-game]');
    if (!btn) return;
    const game = Number(btn.dataset.game);
    view.game = game;
    view.followGame = false;
    render();
    // The gamemaster switching game moves the whole lobby with them.
    if (view.session.isGm) {
      try { await act('gm', { op: 'setGame', game }); view.followGame = true; } catch (err) { toast(err.message); }
    }
  });

  function myRoll(game) {
    const s = view.session;
    return ((s.rolls[game] || {})[s.you]) || null;
  }

  function renderMine() {
    const s = view.session;
    const me = s.players.find((p) => p.id === s.you);
    const roll = myRoll(view.game);
    const fresh = roll && roll.seed !== view.lastSeed;

    $('mine').innerHTML = `
      <div class="section-label">/ YOUR RESTRICTIONS — GAME ${view.game}</div>
      <div class="plate">
        <div class="plate__bar">
          <span class="plate__who">${esc(me ? me.display : 'You')}</span>
          <span>${esc(rankName(me && me.rank))}${me && me.isGm ? ' · GAMEMASTER' : ''}</span>
          <span class="plate__seed">${roll ? 'SEED <b>' + esc(roll.seed) + '</b>' : ''}</span>
        </div>
        <div class="plate__body">
          ${roll
            ? roll.picks.map((p, i) => slotMarkup(p, i)).join('')
            : '<div class="plate__empty"><span>Waiting for the gamemaster to roll</span></div>'}
        </div>
      </div>`;

    if (roll && fresh) {
      view.lastSeed = roll.seed;
      spin($('mine').querySelectorAll('.slot'), roll.picks);
    } else if (roll) {
      $('mine').querySelectorAll('.slot').forEach((slot, i) => land(slot, roll.picks[i]));
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
    slot.querySelector('.slot__text').textContent = pick.text;
    slot.querySelector('.slot__meta').textContent = pick.rerolls
      ? `family: ${pick.family} · ${pick.rerolls} auto-reroll${pick.rerolls > 1 ? 's' : ''} for a clash`
      : `family: ${pick.family}`;
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

  function renderRoster() {
    const s = view.session;
    const rolls = s.rolls[view.game] || {};

    $('rosterGrid').innerHTML = s.players.map((p) => {
      const roll = rolls[p.id];
      const mine = p.id === s.you;
      return `<article class="pcard${mine ? ' pcard--me' : ''}">
        <header class="pcard__head">
          <span class="pcard__name">${esc(p.display)}</span>
          <span class="pcard__tags">
            ${p.isGm ? '<span class="tag tag--gm">GM</span>' : ''}
            <span class="tag">${esc(rankName(p.rank))}</span>
          </span>
        </header>
        ${roll ? `<ul class="pcard__list">${roll.picks.map((pick, i) => `
          <li class="pcard__pick pcard__pick--${pick.tier}">
            <b>${pick.tier}</b>
            <span>${esc(pick.text)}</span>
            ${s.isGm ? `<button class="slot__reroll" type="button" data-op="rerollSlot" data-player="${esc(p.id)}" data-index="${i}">Reroll</button>` : ''}
          </li>`).join('')}</ul>
          <div class="pcard__seed">SEED ${esc(roll.seed)}</div>`
        : '<div class="pcard__waiting">No restrictions yet</div>'}
        ${s.isGm ? gmRow(p) : ''}
      </article>`;
    }).join('');
  }

  function gmRow(p) {
    return `<div class="pcard__gm">
      <select class="pcard__rank" data-op="setRank" data-player="${esc(p.id)}">
        ${T.RANKS.map((r) => `<option value="${r.id}"${r.id === p.rank ? ' selected' : ''}>${r.name}</option>`).join('')}
      </select>
      <button class="slot__reroll" type="button" data-op="roll-one" data-player="${esc(p.id)}">Roll</button>
      ${p.hasPasscode ? `<button class="slot__reroll" type="button" data-op="resetPasscode" data-player="${esc(p.id)}">Reset code</button>` : '<span class="hint">passcode cleared</span>'}
      ${p.isGm ? '' : `<button class="slot__reroll" type="button" data-op="transferGm" data-player="${esc(p.id)}">Make GM</button>
      <button class="slot__reroll" type="button" data-op="removePlayer" data-player="${esc(p.id)}">Remove</button>`}
    </div>`;
  }

  /* ---------- gamemaster actions ---------- */

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
        if (!confirm(`Remove ${who} from the lobby? Their rolls go with them.`)) return;
        await act('gm', { op, playerId });
        toast(who + ' removed');
      } else if (op === 'resetPasscode') {
        if (!confirm(`Clear ${who}'s passcode? They pick a new one next time they sign in.`)) return;
        await act('gm', { op, playerId });
        toast('Passcode cleared');
      } else if (op === 'transferGm') {
        if (!confirm(`Hand the lobby to ${who}? You stop being gamemaster.`)) return;
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
    try {
      await act('roll', { game: view.game, target: 'missing' });
      toast('Rolled game ' + view.game);
    } catch (err) { toast(err.message); }
  });

  $('rollAll').addEventListener('click', async () => {
    if (!confirm(`Re-roll every player for game ${view.game}? Existing restrictions are replaced.`)) return;
    try {
      await act('roll', { game: view.game, target: 'all' });
      toast('Whole lobby rerolled');
    } catch (err) { toast(err.message); }
  });

  $('clearGame').addEventListener('click', async () => {
    if (!confirm(`Clear every roll for game ${view.game}?`)) return;
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

  $('togglePool').addEventListener('click', () => {
    view.poolOpen = !view.poolOpen;
    $('poolPanel').hidden = !view.poolOpen;
  });

  function renderGmPanel() {
    const s = view.session;
    const off = new Set(s.pool.off || []);
    const rolled = Object.keys(s.rolls[view.game] || {}).length;

    $('toggleOpen').textContent = s.open ? 'Close the lobby' : 'Reopen the lobby';
    $('gmHint').textContent = `Game ${view.game}: ${rolled} of ${s.players.length} rolled · `
      + `${T.ALL.length - off.size} of ${T.ALL.length} restrictions in the draw · `
      + `invite link ${location.origin}/s/${s.code}`;

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
  }

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
    try {
      await act('gm', { op: 'setPool', off: [...off] });
    } catch (err) { toast(err.message); }
  });

  /* ---------- lobby chrome ---------- */

  $('copyLink').addEventListener('click', () => {
    copyText(`${location.origin}/s/${view.code}`, 'Invite link copied');
  });

  $('copyBoard').addEventListener('click', () => {
    const s = view.session;
    const rolls = s.rolls[view.game] || {};
    const lines = [`${s.name} — Game ${view.game}`, ''];
    s.players.forEach((p) => {
      const roll = rolls[p.id];
      lines.push(`${p.display} (${rankName(p.rank)})`);
      if (!roll) lines.push('  — not rolled yet');
      else {
        roll.picks.forEach((pick) => lines.push(`  [${pick.tier.toUpperCase()}] ${pick.text}`));
        lines.push(`  seed ${roll.seed}`);
      }
      lines.push('');
    });
    copyText(lines.join('\n').trim(), 'Lobby copied');
  });

  $('signOut').addEventListener('click', async () => {
    try {
      await api('logout', { code: view.code });
      stopPolling();
      view.session = null;
      location.reload();
    } catch (err) { toast(err.message); }
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

  function cycleTheme() {
    const now = document.documentElement.getAttribute('data-theme') || 'light';
    const next = THEMES[(THEMES.indexOf(now) + 1) % THEMES.length];
    document.documentElement.classList.add('theming');
    if (next === 'light') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('tft.theme', next); } catch (e) { /* private mode */ }
    setTimeout(() => document.documentElement.classList.remove('theming'), 400);
  }
})();
