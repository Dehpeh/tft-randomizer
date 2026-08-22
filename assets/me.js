/* Your account page: sign in when signed out, otherwise your record.

   Everything here is computed on the server (/api/me) so the numbers are the
   same ones a gamemaster would see, not something a browser talked itself into. */
(function () {
  const T = window.TFT;
  const $ = (id) => document.getElementById(id);

  const state = { account: null, authMode: 'login' };

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const rankName = (id) => (T.rankById(id) || { name: id || 'Unranked' }).name;

  function ordinal(n) {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

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

  function fillRanks(select, selected) {
    select.innerHTML = T.RANKS.map((r) => `<option value="${r.id}"${r.id === selected ? ' selected' : ''}>${r.name}</option>`).join('');
  }

  /* ---------- boot ---------- */

  fillRanks($('aRank'), 'diamond');
  start();

  async function start() {
    try {
      const who = await api('auth');
      state.account = who.account;
    } catch (e) { state.account = null; }
    if (state.account) load(); else showAuth();
  }

  /* ---------- auth ---------- */

  function showAuth() {
    $('profile').hidden = true;
    $('auth').hidden = false;
    setAuthMode(state.authMode);
    $('aName').focus();
  }

  function setAuthMode(mode) {
    state.authMode = mode;
    $('authTabs').querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
    $('aRankField').hidden = mode !== 'register';
    $('authSubmit').textContent = mode === 'register' ? 'Create my account' : 'Sign in';
    $('authTitle').textContent = mode === 'register' ? 'Claim your name' : 'Your League name and passcode';
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
    const payload = { op: state.authMode, name: $('aName').value, passcode: $('aPass').value };
    if (state.authMode === 'register') payload.rank = $('aRank').value;
    try {
      const out = await api('auth', payload);
      state.account = out.account;
      $('aPass').value = '';
      load();
    } catch (e2) {
      err.textContent = e2.message;
      err.hidden = false;
    }
  });

  $('signOut').addEventListener('click', async () => {
    try { await api('auth', { op: 'logout' }); } catch (e) { /* cookie is gone either way */ }
    location.reload();
  });

  $('meRank').addEventListener('change', async () => {
    try {
      await api('auth', { op: 'setRank', rank: $('meRank').value });
      toast('Peak rank updated — lobbies you are already seated in keep the rank they have');
    } catch (e) { toast(e.message); }
  });

  /* ---------- the record ---------- */

  async function load() {
    let data;
    try { data = await api('me'); }
    catch (e) { toast(e.message); showAuth(); return; }

    $('auth').hidden = true;
    $('profile').hidden = false;

    const a = data.account;
    const s = data.stats;
    state.account = a;

    $('meName').textContent = a.display;
    fillRanks($('meRank'), a.rank);
    $('meSub').textContent = `${rankName(a.rank)} · ${s.games} game${s.games === 1 ? '' : 's'} played`
      + (s.pending ? ` · ${s.pending} rolled but not finished` : '');

    $('statTiles').innerHTML = [
      tile('Games', s.games),
      tile('Avg placement', s.avgPlacement ? s.avgPlacement.toFixed(2) : '—'),
      tile('Firsts', s.firsts),
      tile('Top 4', s.games ? `${s.top4} · ${Math.round((s.top4 / s.games) * 100)}%` : '—'),
      tile('Best', s.best ? ordinal(s.best) : '—'),
      tile('Worst', s.worst ? ordinal(s.worst) : '—'),
    ].join('');

    $('statNote').textContent = s.games
      ? `Carrying majors you average ${s.tiers.major ? s.tiers.major.toFixed(2) : '—'}, minors ${s.tiers.minor ? s.tiers.minor.toFixed(2) : '—'}.`
      : 'Nothing to average yet. Numbers appear once a gamemaster submits placements for a game you were rolled for.';

    renderRestrictions(s.restrictions);
    renderMatches(data.matches);

    $('lobbyList').innerHTML = (data.lobbies || []).length
      ? data.lobbies.map((l) => `
        <a class="lobbyrow" href="/s/${esc(l.code)}">
          <span class="lobbyrow__name">${esc(l.name)}</span>
          <span class="lobbyrow__meta">${esc(l.code)} · ${l.players} player${l.players === 1 ? '' : 's'}${l.isGm ? ' · you run it' : ''}</span>
          <span class="lobbyrow__go">&rarr;</span>
        </a>`).join('')
      : '<div class="log__empty">No lobbies yet. Ask your gamemaster for a link.</div>';
  }

  const tile = (label, value) => `<div class="stat-tile">
      <span class="stat-tile__value">${esc(value)}</span>
      <span class="stat-tile__label">${esc(label)}</span>
    </div>`;

  function renderRestrictions(rows) {
    if (!rows || !rows.length) {
      $('restTable').innerHTML = '<div class="log__empty">Nothing to rank yet.</div>';
      return;
    }
    $('restTable').innerHTML = `
      <div class="rest__head"><span>/ AVG</span><span>/ RESTRICTION</span><span>/ GAMES</span></div>
      ${rows.map((r) => `
        <div class="rest__row">
          <span class="rest__avg">${r.avg.toFixed(2)}</span>
          <span class="rest__text"><b class="rest__tier rest__tier--${esc(r.tier)}">${esc(r.tier)}</b>${esc(r.text)}</span>
          <span class="rest__games">${r.games}</span>
        </div>`).join('')}`;
  }

  function renderMatches(matches) {
    $('matchCount').textContent = `(${matches.length})`;
    if (!matches.length) {
      $('matchList').innerHTML = '<div class="log__empty">No matches yet.</div>';
      return;
    }
    $('matchList').innerHTML = matches.map((m) => `
      <article class="match">
        <header class="match__head">
          ${m.placement
            ? `<span class="place place--${m.placement <= 4 ? 'top' : 'bot'}">${ordinal(m.placement)}</span>`
            : '<span class="place place--pending">—</span>'}
          <span class="match__lobby"><a href="/s/${esc(m.code)}">${esc(m.lobby)}</a> · Game ${m.game}</span>
          <span class="match__meta">${esc(rankName(m.rank))} · seed ${esc(m.seed)}</span>
        </header>
        <ul class="pcard__list">
          ${m.picks.map((p) => `<li class="pcard__pick pcard__pick--${p.tier}"><b>${esc(p.tier)}</b><span>${esc(p.text)}</span></li>`).join('')}
        </ul>
      </article>`).join('');
  }
})();
