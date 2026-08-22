/* The organiser dashboard: every player, every lobby, everything they have been
   dealt, and the controls that no gamemaster gets.

   Authentication here is the organiser key, sent with each request rather than
   traded for a session cookie. That keeps it out of the browser's cookie jar and
   makes "close the tab" a real logout — the key lives in sessionStorage and
   nowhere else. It is not an account, so nothing on this page is attributable to
   a person; treat the key as the shared credential it is. */
(function () {
  const T = window.TFT;
  const $ = (id) => document.getElementById(id);
  const KEY = 'tft.adminKey';

  const state = { key: null, data: null, filter: '' };

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const rankName = (id) => (T.rankById(id) || { name: id || 'Unranked' }).name;
  const toast = (msg) => window.TFTUI.toast(msg);

  function ordinal(n) {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  const when = (ms) => new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  async function admin(op, extra) {
    const res = await fetch('/api/admin', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(Object.assign({ key: state.key, op }, extra || {})),
    });
    let data = {};
    try { data = await res.json(); } catch (e) { /* non-JSON error page */ }
    if (!res.ok) throw new Error(data.error || ('Request failed (' + res.status + ')'));
    return data;
  }

  /* ---------- the key ---------- */

  try { state.key = sessionStorage.getItem(KEY); } catch (e) { state.key = null; }
  if (state.key) load().catch(() => showGate('That key is no longer accepted.'));
  else showGate();

  function showGate(message) {
    $('dash').hidden = true;
    $('keyGate').hidden = false;
    if (message) {
      $('keyError').textContent = message;
      $('keyError').hidden = false;
    }
    $('adminKey').focus();
  }

  $('keyForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('keyError').hidden = true;
    if (!window.TFTUI.validate(e.target)) return;
    state.key = $('adminKey').value.trim();
    try {
      await load();
      try { sessionStorage.setItem(KEY, state.key); } catch (e2) { /* private mode */ }
      $('adminKey').value = '';
    } catch (err) {
      state.key = null;
      $('keyError').textContent = err.message;
      $('keyError').hidden = false;
    }
  });

  $('lockDash').addEventListener('click', () => {
    try { sessionStorage.removeItem(KEY); } catch (e) { /* private mode */ }
    state.key = null;
    state.data = null;
    showGate('Locked.');
  });

  $('refresh').addEventListener('click', () => load().catch((e) => toast(e.message)));

  $('playerSearch').addEventListener('input', (e) => {
    state.filter = e.target.value.trim().toLowerCase();
    renderPlayers();
  });

  /* ---------- render ---------- */

  async function load() {
    const data = await admin('overview');
    state.data = data;
    $('keyGate').hidden = true;
    $('dash').hidden = false;

    const t = data.totals;
    $('totals').innerHTML = [
      tile('Signed up', t.accounts),
      tile('In a lobby', t.seated),
      tile('Lobbies', t.lobbies),
      tile('Penalties', t.penalties),
    ].join('');

    renderPlayers();
    renderLobbies();
  }

  const tile = (label, value) => `<div class="stat-tile">
      <span class="stat-tile__value">${esc(value)}</span>
      <span class="stat-tile__label">${esc(label)}</span>
    </div>`;

  function renderPlayers() {
    const rows = state.data.players.filter((p) => !state.filter || p.display.toLowerCase().includes(state.filter));
    $('playerCount').textContent = `(${rows.length})`;

    $('playerTable').innerHTML = rows.length ? rows.map((p) => `
      <details class="admin__row">
        <summary class="admin__summary">
          <span class="admin__name">${esc(p.display)}</span>
          <span class="tag">${esc(rankName(p.rank))}</span>
          <span class="admin__nums">
            ${p.stats.games} game${p.stats.games === 1 ? '' : 's'}
            ${p.stats.games ? ' · avg ' + p.stats.avgPlacement.toFixed(2) : ''}
            ${p.stats.firsts ? ' · ' + p.stats.firsts + ' win' + (p.stats.firsts === 1 ? '' : 's') : ''}
            ${p.penalties.length ? ' · ' + p.penalties.length + ' penalty' + (p.penalties.length === 1 ? '' : 's') : ''}
            ${p.lobbies.length ? '' : ' · not in a lobby'}
          </span>
        </summary>
        <div class="admin__detail">
          <div class="admin__meta">Registered ${esc(when(p.createdAt))} · ${p.lobbies.length ? p.lobbies.map((l) => esc(l.name) + (l.isGm ? ' (GM)' : '')).join(', ') : 'no lobbies'}</div>

          ${p.penalties.length ? `<div class="penalty__list">${p.penalties.map((x) => `
            <div class="penalty"><span>${esc(x.lobby)} · G${x.game} — ${esc(x.reason)}</span></div>`).join('')}</div>` : ''}

          ${p.games.length ? p.games.map((g) => `
            <article class="match">
              <header class="match__head">
                ${g.placement ? `<span class="place place--${g.placement <= 4 ? 'top' : 'bot'}">${ordinal(g.placement)}</span>`
                  : '<span class="place place--pending">—</span>'}
                <span class="match__lobby">${esc(g.lobby)} · Game ${g.game}</span>
                <span class="match__meta">${esc(rankName(g.rank))} · seed ${esc(g.seed)}</span>
              </header>
              ${g.picks.length ? `<ul class="pcard__list">${g.picks.map((k) => `
                <li class="pcard__pick pcard__pick--${k.tier}"><b>${esc(k.tier)}</b><span>${esc(k.text)}${k.detail
                  ? `<span class="detail">${esc(k.detail.label)}: <b>${esc(k.detail.value)}</b></span>` : ''}</span></li>`).join('')}</ul>`
                : '<div class="pcard__waiting pcard__waiting--clean">Played clean — no restrictions</div>'}
            </article>`).join('')
            : '<div class="log__empty">No games yet.</div>'}

          <div class="admin__actions">
            <button class="btn" type="button" data-op="resetPasscode" data-name="${esc(p.display)}">Reset passcode</button>
            <button class="btn btn--danger" type="button" data-op="deleteAccount" data-name="${esc(p.display)}">Delete account</button>
          </div>
        </div>
      </details>`).join('')
      : '<div class="log__empty">Nobody matches that.</div>';
  }

  function renderLobbies() {
    const rows = state.data.lobbies;
    $('lobbyCount').textContent = `(${rows.length})`;
    $('lobbyTable').innerHTML = rows.length ? rows.map((l) => `
      <div class="admin__lobby">
        <span class="admin__name"><a href="/s/${esc(l.code)}">${esc(l.name)}</a>
          <span class="tag ${l.open ? 'tag--live' : 'tag--closed'}">${l.open ? 'open' : 'closed'}</span></span>
        <span class="admin__nums">${esc(l.code)} · ${l.players} player${l.players === 1 ? '' : 's'} · gm ${esc(l.gm || '—')}
          · ${l.rolled} game${l.rolled === 1 ? '' : 's'} rolled · ${l.results} scored${l.penalties ? ' · ' + l.penalties + ' penalty' + (l.penalties === 1 ? '' : 's') : ''}</span>
        <button class="btn btn--danger" type="button" data-op="deleteLobby" data-code="${esc(l.code)}">Delete</button>
      </div>`).join('')
      : '<div class="log__empty">No lobbies yet.</div>';
  }

  /* ---------- destructive controls ----------
     Everything here removes something that cannot be got back, so each one
     spells out what goes and what survives before it happens. */

  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-op]');
    if (!btn || !state.key) return;
    const op = btn.dataset.op;

    try {
      if (op === 'deleteAccount') {
        const name = btn.dataset.name;
        const ok = await window.TFTUI.confirm({
          title: `Delete ${name}?`,
          body: 'Their account, their seats, their rolls and their placements all go. Any lobby they ran keeps running; the seats they held are removed from it.',
          confirmText: 'Delete the account',
          danger: true,
        });
        if (!ok) return;
        const out = await admin('deleteAccount', { name });
        toast(`${name} deleted (${out.lobbiesTouched} lobby${out.lobbiesTouched === 1 ? '' : 'ies'} updated)`);
        await load();
      }

      if (op === 'deleteLobby') {
        const code = btn.dataset.code;
        const ok = await window.TFTUI.confirm({
          title: `Delete lobby ${code}?`,
          body: 'Its rolls, placements and penalties go with it. Player accounts are untouched.',
          confirmText: 'Delete the lobby',
          danger: true,
        });
        if (!ok) return;
        await admin('deleteLobby', { code });
        toast('Lobby deleted');
        await load();
      }

      if (op === 'resetPasscode') {
        const name = btn.dataset.name;
        // Six random digits rather than a chosen one: it is going to be read out
        // in Discord and changed by them afterwards anyway.
        const passcode = String(Math.floor(100000 + Math.random() * 900000));
        const ok = await window.TFTUI.confirm({
          title: `Reset ${name}'s passcode?`,
          body: `Their new passcode will be ${passcode}. Send it to them and tell them to sign in with it.`,
          confirmText: 'Reset it',
        });
        if (!ok) return;
        await admin('resetPasscode', { name, passcode });
        await window.TFTUI.alert({ title: `New passcode: ${passcode}`, body: `${name} signs in with this from now on.` });
      }
    } catch (err) { toast(err.message); }
  });

  /* One row per player per game: the shape a spreadsheet wants for seeding the
     next round or settling an argument after the fact. */
  $('exportCsv').addEventListener('click', () => {
    if (!state.data) return;
    const q = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const rows = [['player', 'rank', 'lobby', 'code', 'game', 'placement', 'restrictions', 'penalties', 'seed']];

    state.data.players.forEach((p) => {
      if (!p.games.length) {
        rows.push([p.display, rankName(p.rank), '', '', '', '', '', p.penalties.length, '']);
        return;
      }
      p.games.forEach((g) => {
        const pens = p.penalties.filter((x) => x.code === g.code && x.game === g.game).map((x) => x.reason).join('; ');
        rows.push([
          p.display, rankName(g.rank), g.lobby, g.code, g.game, g.placement || '',
          g.picks.map((k) => `[${k.tier}] ${T.pickText(k)}`).join(' | '), pens, g.seed,
        ]);
      });
    });

    const blob = new Blob([rows.map((r) => r.map(q).join(',')).join('\r\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'tft-tournament.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('CSV downloaded');
  });
})();
