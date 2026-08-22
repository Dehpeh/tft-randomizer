/* The bits every page shares: the theme switch and the account chip.

   Loaded on all four pages, so who you are is visible from anywhere and the
   theme survives navigation. It asks the server who you are rather than
   trusting anything in localStorage — the cookie is the only thing that counts.
   The chip is rendered from that answer, and window.TFT_ACCOUNT is left behind
   for pages that want to skip their own round trip. */
(function () {
  const THEMES = ['light', 'night-owl', 'amber', 'paper'];
  const $ = (id) => document.getElementById(id);

  function cycleTheme() {
    const now = document.documentElement.getAttribute('data-theme') || 'light';
    const next = THEMES[(THEMES.indexOf(now) + 1) % THEMES.length];
    document.documentElement.classList.add('theming');
    if (next === 'light') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('tft.theme', next); } catch (e) { /* private mode */ }
    setTimeout(() => document.documentElement.classList.remove('theming'), 400);
  }

  const themeBtn = $('themeBtn');
  if (themeBtn) themeBtn.addEventListener('click', cycleTheme);

  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
    if (e.key.toLowerCase() === 't') cycleTheme();
  });

  const mount = $('navAccount');
  if (!mount) return;

  fetch('/api/auth', { headers: { accept: 'application/json' } })
    .then((r) => r.json())
    .then((data) => {
      window.TFT_ACCOUNT = data.account || null;
      document.dispatchEvent(new CustomEvent('tft:account', { detail: data.account || null }));
      mount.innerHTML = data.account
        ? `<a class="topbar__acct" href="/me" title="Your matches and stats">${escape(data.account.display)}</a>`
        : '<a class="topbar__acct topbar__acct--out" href="/me">SIGN IN</a>';
    })
    .catch(() => { mount.innerHTML = ''; });

  function escape(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }
})();
