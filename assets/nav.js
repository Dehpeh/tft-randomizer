/* The bits every page shares: the theme picker and the account chip.

   The theme is a choice, not a cycle — five of them is too many to click
   through — so it is a select that remembers what you picked. The account chip
   asks the server who you are rather than trusting anything in localStorage;
   the cookie is the only thing that counts. window.TFT_ACCOUNT is left behind
   for pages that want to skip their own round trip. */
(function () {
  const $ = (id) => document.getElementById(id);

  const THEMES = [
    { id: 'light',     name: 'Daylight' },
    { id: 'carbon',    name: 'Carbon' },
    { id: 'night-owl', name: 'Night Owl' },
    { id: 'amber',     name: 'Amber CRT' },
    { id: 'paper',     name: 'Paper' },
  ];

  const KEY = 'tft.theme';

  function current() {
    const set = document.documentElement.getAttribute('data-theme');
    return THEMES.some((t) => t.id === set) ? set : 'light';
  }

  function apply(id) {
    document.documentElement.classList.add('theming');
    if (id === 'light') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', id);
    try { localStorage.setItem(KEY, id); } catch (e) { /* private mode */ }
    setTimeout(() => document.documentElement.classList.remove('theming'), 400);
  }

  const picker = $('themePicker');
  if (picker) {
    picker.innerHTML = THEMES.map((t) => `<option value="${t.id}">${t.name}</option>`).join('');
    picker.value = current();
    picker.addEventListener('change', () => apply(picker.value));
  }

  // T still cycles for anyone who learned it, and keeps the select in step.
  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
    if (e.key.toLowerCase() !== 't') return;
    const next = THEMES[(THEMES.findIndex((t) => t.id === current()) + 1) % THEMES.length].id;
    apply(next);
    if (picker) picker.value = next;
  });

  const mount = $('navAccount');
  if (!mount) return;

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  fetch('/api/auth', { headers: { accept: 'application/json' } })
    .then((r) => r.json())
    .then((data) => {
      window.TFT_ACCOUNT = data.account || null;
      document.dispatchEvent(new CustomEvent('tft:account', { detail: data.account || null }));
      mount.innerHTML = data.account
        ? `<a class="topbar__acct" href="/me" title="Your matches and results">${esc(data.account.display)}</a>`
        : '<a class="topbar__acct topbar__acct--out" href="/me">SIGN IN</a>';
    })
    .catch(() => { mount.innerHTML = ''; });
})();
