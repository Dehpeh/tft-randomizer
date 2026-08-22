/* Page wiring for the randomizer. The rules live in restrictions.js; this file
   only turns them into something you can click during a tournament night. */
(function () {
  const T = window.TFT;
  const $ = (id) => document.getElementById(id);

  const KEY = { off: 'tft.pool.off', log: 'tft.log', rank: 'tft.rank' };

  const state = {
    rankId: load(KEY.rank, 'challenger'),
    game: 1,
    off: new Set(load(KEY.off, [])),
    log: load(KEY.log, []),
    result: null,
    saved: false,
    spinning: false,
    attempt: 0,
  };

  function load(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (e) { return fallback; }
  }

  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* private mode */ }
  }

  const enabled = () => new Set(T.ALL.filter((r) => !state.off.has(r.id)).map((r) => r.id));
  const rank = () => T.RANKS.find((r) => r.id === state.rankId) || T.RANKS[0];
  const reduced = () => document.documentElement.classList.contains('motion-reduced');

  /* ---------- toast ---------- */
  let toastTimer;
  function toast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.add('is-up');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('is-up'), 1800);
  }

  /* ---------- controls ---------- */
  function buildControls() {
    const sel = $('rankSelect');
    sel.innerHTML = T.RANKS.map((r) => `<option value="${r.id}">${r.name}</option>`).join('');
    sel.value = state.rankId;
    sel.addEventListener('change', () => setRank(sel.value));

    const seg = $('gameSeg');
    seg.innerHTML = [1, 2, 3].map((n) => `<button type="button" data-game="${n}" aria-pressed="${n === state.game}">Game ${n}</button>`).join('');
    seg.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-game]');
      if (!btn) return;
      state.game = Number(btn.dataset.game);
      seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.game) === state.game)));
    });

    $('ranksGrid').innerHTML = T.RANKS.map((r) => `
      <button class="rank-card" type="button" data-rank="${r.id}" aria-pressed="${r.id === state.rankId}">
        <span class="rank-card__name">${r.name}</span>
        <span class="rank-card__dist">${dist(r)}</span>
      </button>`).join('');

    $('ranksGrid').addEventListener('click', (e) => {
      const card = e.target.closest('button[data-rank]');
      if (!card) return;
      setRank(card.dataset.rank);
      $('roll').scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth' });
    });

    paintDist();
  }

  function dist(r) {
    const parts = [];
    if (r.major) parts.push(`${r.major} major`);
    if (r.minor) parts.push(`${r.minor} minor`);
    return parts.join(' + ');
  }

  function setRank(id) {
    state.rankId = id;
    save(KEY.rank, id);
    $('rankSelect').value = id;
    document.querySelectorAll('.rank-card').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.rank === id)));
    paintDist();
  }

  function paintDist() {
    const r = rank();
    const pool = enabled();
    const nMajor = T.MAJOR.filter((x) => pool.has(x.id)).length;
    const nMinor = T.MINOR.filter((x) => pool.has(x.id)).length;
    $('distBox').innerHTML =
      `<strong>${r.name}</strong> rolls <strong>${dist(r)}</strong><br>` +
      `drawing from ${nMajor} major / ${nMinor} minor`;
  }

  /* ---------- the pool editor ---------- */
  function box(on) {
    return on
      ? '<svg class="pool__box" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><rect x="0.5" y="0.5" width="11" height="11" fill="none" stroke="currentColor"/><path d="M3 6.2 5.2 8.5 9 3.8" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>'
      : '<svg class="pool__box" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><rect x="0.5" y="0.5" width="11" height="11" fill="none" stroke="currentColor"/></svg>';
  }

  function buildPool() {
    const render = (list, mount) => {
      $(mount).innerHTML = list.map((r) => {
        const on = !state.off.has(r.id);
        return `<button class="pool__item ${on ? 'is-on' : 'is-off'}" type="button" data-id="${r.id}" aria-pressed="${on}">
          ${box(on)}
          <span class="pool__label">${r.text}<span class="pool__fam">${r.family}</span></span>
        </button>`;
      }).join('');
    };
    render(T.MAJOR, 'majorList');
    render(T.MINOR, 'minorList');

    const on = enabled();
    $('poolCount').textContent = `(${on.size}/${T.ALL.length})`;
    $('majorCount').textContent = `(${T.MAJOR.filter((r) => on.has(r.id)).length}/${T.MAJOR.length})`;
    $('minorCount').textContent = `(${T.MINOR.filter((r) => on.has(r.id)).length}/${T.MINOR.length})`;
    paintDist();
  }

  function togglePool(e) {
    const btn = e.target.closest('button[data-id]');
    if (!btn) return;
    const id = btn.dataset.id;
    if (state.off.has(id)) state.off.delete(id); else state.off.add(id);
    save(KEY.off, [...state.off]);
    buildPool();
  }

  /* ---------- rolling ---------- */
  function slotMarkup(pick, i) {
    return `<div class="slot slot--${pick.tier}" data-slot="${i}">
      <span class="slot__tier">${pick.tier}</span>
      <span class="slot__text"></span>
      <button class="slot__reroll" type="button" data-reroll="${i}">Reroll</button>
      <span class="slot__meta"></span>
    </div>`;
  }

  function doRoll() {
    if (state.spinning) return;
    const seedField = $('seedInput').value.trim();
    const seed = seedField || T.newSeed();
    const result = T.rollPlayer({ rankId: state.rankId, seed, enabled: enabled() });

    if (!result.ok) {
      $('plateBody').innerHTML = `<div class="notice">${result.error}</div>`;
      setActions(false);
      return;
    }

    result.player = $('playerName').value.trim();
    result.game = state.game;
    state.result = result;
    state.saved = false;
    state.attempt = 0;

    $('plateWho').textContent = (result.player || 'UNNAMED PLAYER').toUpperCase();
    $('plateRank').textContent = `${result.rank.name.toUpperCase()} · GAME ${result.game}`;
    $('plateSeed').textContent = seed;

    $('plateBody').innerHTML = result.picks.map(slotMarkup).join('');
    spin(result.picks);
  }

  /* Each slot flickers through its own tier before it lands. Landing is
     staggered so the majors read first, which is also the order they matter
     in. With reduced motion on, everything lands at once. */
  function spin(picks) {
    const slots = [...document.querySelectorAll('.slot')];
    setActions(false);

    if (reduced()) {
      picks.forEach((p, i) => land(slots[i], p));
      state.spinning = false;
      setActions(true);
      return;
    }

    state.spinning = true;
    const pool = enabled();
    const timers = [];

    slots.forEach((slot, i) => {
      const tier = picks[i].tier;
      const options = T.POOL[tier].filter((r) => pool.has(r.id));
      const text = slot.querySelector('.slot__text');
      slot.classList.add('is-spinning');
      timers.push(setInterval(() => {
        text.textContent = options[Math.floor(Math.random() * options.length)].text;
      }, 55));
    });

    picks.forEach((p, i) => {
      setTimeout(() => {
        clearInterval(timers[i]);
        land(slots[i], p);
        if (i === picks.length - 1) {
          state.spinning = false;
          setActions(true);
        }
      }, 520 + i * 340);
    });
  }

  function land(slot, pick) {
    slot.classList.remove('is-spinning');
    slot.classList.add('is-locked');
    slot.querySelector('.slot__text').textContent = pick.text;
    const meta = slot.querySelector('.slot__meta');
    meta.textContent = pick.rerolls
      ? `family: ${pick.family} · ${pick.rerolls} auto-reroll${pick.rerolls > 1 ? 's' : ''} for a clash`
      : `family: ${pick.family}`;
  }

  function rerollOne(index) {
    if (state.spinning || !state.result) return;
    state.attempt++;
    const seed = `${state.result.seed}#${index}.${state.attempt}`;
    const res = T.rerollSlot(state.result.picks, index, enabled(), seed);
    if (!res.ok) { toast(res.error); return; }

    state.result.picks = res.picks;
    state.saved = false;
    const slot = document.querySelector(`.slot[data-slot="${index}"]`);
    const pick = res.picks[index];

    if (reduced()) { land(slot, pick); setActions(true); return; }

    const options = T.POOL[pick.tier].filter((r) => enabled().has(r.id));
    const text = slot.querySelector('.slot__text');
    slot.classList.add('is-spinning');
    state.spinning = true;
    const timer = setInterval(() => {
      text.textContent = options[Math.floor(Math.random() * options.length)].text;
    }, 55);
    setTimeout(() => {
      clearInterval(timer);
      slot.classList.remove('is-locked');
      void slot.offsetWidth;
      land(slot, pick);
      state.spinning = false;
      setActions(true);
    }, 500);
  }

  function setActions(on) {
    ['copyBtn', 'saveBtn'].forEach((id) => { $(id).disabled = !on; });
    $('againBtn').disabled = false;
    $('saveBtn').textContent = state.saved ? 'Saved' : 'Save to log';
    if (state.saved) $('saveBtn').disabled = true;
  }

  /* ---------- output ---------- */
  function resultText(r) {
    const head = `${r.player || 'Unnamed player'} — ${r.rank.name} · Game ${r.game}`;
    const lines = r.picks.map((p) => `[${p.tier.toUpperCase()}] ${p.text}`);
    return [head, ...lines, `seed ${r.seed}`].join('\n');
  }

  function copyText(text, msg) {
    const done = () => toast(msg);
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
    } else {
      fallbackCopy(text, done);
    }
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

  /* ---------- log ---------- */
  function saveResult() {
    if (!state.result || state.saved) return;
    const r = state.result;
    state.log.unshift({
      at: new Date().toISOString(),
      player: r.player,
      rank: r.rank.name,
      game: r.game,
      seed: r.seed,
      picks: r.picks.map((p) => ({ tier: p.tier, text: p.text })),
    });
    save(KEY.log, state.log);
    state.saved = true;
    setActions(true);
    buildLog();
    toast('Saved to log');
  }

  function timeLabel(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return iso;
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  function buildLog() {
    $('logCount').textContent = `(${state.log.length})`;
    const mount = $('logRows');
    if (!state.log.length) {
      mount.innerHTML = '<div class="log__empty">Nothing logged yet.</div>';
      return;
    }
    mount.innerHTML = state.log.map((row) => `
      <div class="log__row">
        <span class="log__dim">${esc(timeLabel(row.at))}</span>
        <span>${esc(row.player || 'Unnamed')}<br><span class="log__dim">${esc(row.rank)} · G${row.game}</span></span>
        <span class="log__list">${row.picks.map((p) => `<span class="log__pick log__pick--${esc(p.tier)}"><b>${esc(p.tier)}</b>${esc(p.text)}</span>`).join('')}</span>
        <span class="log__dim">${esc(row.seed)}</span>
      </div>`).join('');
  }

  function logAsText() {
    return state.log.map((row) => {
      const head = `${row.player || 'Unnamed'} — ${row.rank} · Game ${row.game} · ${timeLabel(row.at)}`;
      return [head, ...row.picks.map((p) => `[${p.tier.toUpperCase()}] ${p.text}`), `seed ${row.seed}`].join('\n');
    }).join('\n\n');
  }

  function logAsCsv() {
    const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
    const rows = [['time', 'player', 'rank', 'game', 'tier', 'restriction', 'seed']];
    state.log.forEach((row) => {
      row.picks.forEach((p) => rows.push([row.at, row.player || '', row.rank, row.game, p.tier, p.text, row.seed]));
    });
    return rows.map((r) => r.map(q).join(',')).join('\r\n');
  }

  function download(name, text, type) {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /* ---------- reveal on scroll ---------- */
  function reveal() {
    const items = [...document.querySelectorAll('[data-reveal]')];
    if (!('IntersectionObserver' in window)) { items.forEach((el) => el.classList.add('is-in')); return; }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-in');
        io.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -8% 0px' });
    items.forEach((el) => io.observe(el));
  }

  /* ---------- wiring ---------- */
  buildControls();
  buildPool();
  buildLog();
  reveal();

  $('rollBtn').addEventListener('click', doRoll);
  $('againBtn').addEventListener('click', doRoll);
  $('copyBtn').addEventListener('click', () => state.result && copyText(resultText(state.result), 'Copied'));
  $('saveBtn').addEventListener('click', saveResult);

  $('majorList').addEventListener('click', togglePool);
  $('minorList').addEventListener('click', togglePool);
  $('poolAll').addEventListener('click', () => { state.off = new Set(); save(KEY.off, []); buildPool(); toast('All restrictions on'); });
  $('poolReset').addEventListener('click', () => { state.off = new Set(); save(KEY.off, []); buildPool(); toast('Pool reset'); });

  $('plateBody').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-reroll]');
    if (btn) rerollOne(Number(btn.dataset.reroll));
  });

  $('logCopy').addEventListener('click', () => {
    if (!state.log.length) { toast('Log is empty'); return; }
    copyText(logAsText(), 'Log copied');
  });

  $('logCsv').addEventListener('click', () => {
    if (!state.log.length) { toast('Log is empty'); return; }
    download('tft-restrictions.csv', logAsCsv(), 'text/csv');
  });

  $('logClear').addEventListener('click', () => {
    if (!state.log.length) return;
    if (!confirm(`Clear all ${state.log.length} logged rolls? This cannot be undone.`)) return;
    state.log = [];
    save(KEY.log, []);
    buildLog();
    toast('Log cleared');
  });

  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
    const key = e.key.toLowerCase();
    if (key === 'r') { e.preventDefault(); doRoll(); }
    else if (key === 'c' && state.result) { copyText(resultText(state.result), 'Copied'); }
    else if (key === 's') { saveResult(); }
    else {
      const link = document.querySelector(`.topbar__nav a[data-key="${key}"]`);
      if (link) { e.preventDefault(); document.querySelector(link.getAttribute('href')).scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth' }); }
    }
  });
})();
