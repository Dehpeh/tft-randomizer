/* The bits of browser chrome this site replaces with its own.

   Native confirm() and the "Please fill out this field" bubble are fine
   functionally and completely wrong visually: system fonts, system colours, and
   a shape that belongs to the browser rather than the page. Every form here is
   marked novalidate and validated through this instead, so a missing lobby name
   looks like the rest of the site.

   window.TFTUI:
     confirm({ title, body, confirmText, cancelText, danger }) -> Promise<bool>
     alert({ title, body })                                    -> Promise<void>
     validate(form)   -> true, or false having marked the first bad field
     fieldError(input, message)
     clearErrors(form)
     toast(message)
*/
(function () {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* ---------- modal ---------- */

  let open = null;

  function buildModal({ title, body, confirmText, cancelText, danger }) {
    const wrap = document.createElement('div');
    wrap.className = 'modal';
    wrap.innerHTML = `
      <div class="modal__scrim"></div>
      <div class="modal__card" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
        <div class="section-label">/ ${esc(title ? 'CONFIRM' : 'NOTICE')}</div>
        <h2 class="modal__title" id="modalTitle">${esc(title || '')}</h2>
        ${body ? `<p class="modal__body">${esc(body)}</p>` : ''}
        <div class="modal__actions">
          ${cancelText ? `<button type="button" class="btn" data-modal="cancel">${esc(cancelText)}</button>` : ''}
          <button type="button" class="btn ${danger ? 'btn--danger' : 'btn--accent'}" data-modal="ok">${esc(confirmText || 'OK')}</button>
        </div>
      </div>`;
    return wrap;
  }

  function show(opts) {
    return new Promise((resolve) => {
      if (open) { open.remove(); open = null; }
      const wrap = buildModal(opts);
      open = wrap;
      document.body.appendChild(wrap);

      const finish = (value) => {
        document.removeEventListener('keydown', onKey);
        wrap.classList.remove('is-up');
        setTimeout(() => { wrap.remove(); if (open === wrap) open = null; }, 160);
        resolve(value);
      };

      function onKey(e) {
        if (e.key === 'Escape') finish(false);
        if (e.key === 'Enter' && document.activeElement && document.activeElement.dataset.modal !== 'cancel') finish(true);
      }

      wrap.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-modal]');
        if (btn) finish(btn.dataset.modal === 'ok');
        else if (e.target.classList.contains('modal__scrim')) finish(false);
      });

      document.addEventListener('keydown', onKey);
      requestAnimationFrame(() => {
        wrap.classList.add('is-up');
        const ok = wrap.querySelector('[data-modal="ok"]');
        if (ok) ok.focus();
      });
    });
  }

  const confirmDialog = (opts) => show(Object.assign({ confirmText: 'Confirm', cancelText: 'Cancel' }, opts));
  const alertDialog = (opts) => show(Object.assign({ confirmText: 'OK', cancelText: null }, opts)).then(() => undefined);

  /* ---------- form validation ---------- */

  function fieldError(input, message) {
    if (!input) return;
    const field = input.closest('.field') || input.parentElement;
    field.classList.add('field--bad');
    let note = field.querySelector('.field__error');
    if (!note) {
      note = document.createElement('span');
      note.className = 'field__error';
      field.appendChild(note);
    }
    note.textContent = message;
    input.setAttribute('aria-invalid', 'true');
  }

  function clearErrors(form) {
    form.querySelectorAll('.field--bad').forEach((f) => f.classList.remove('field--bad'));
    form.querySelectorAll('.field__error').forEach((n) => n.remove());
    form.querySelectorAll('[aria-invalid]').forEach((i) => i.removeAttribute('aria-invalid'));
  }

  /* Messages are written for the person filling the form, not for a spec: what
     to type, not which constraint failed. */
  function messageFor(input) {
    const label = (input.dataset.label || (input.closest('.field') ? (input.closest('.field').querySelector('label') || {}).textContent : '') || 'this')
      .replace(/^\/\s*/, '').trim().toLowerCase();
    if (input.validity.valueMissing) return `Add ${label} to continue.`;
    if (input.validity.patternMismatch || input.validity.tooShort) {
      if (input.inputMode === 'numeric') return 'Six digits, numbers only.';
      return `That does not look like a valid ${label}.`;
    }
    if (input.validity.tooLong) return `${label} is too long.`;
    return `Check ${label} and try again.`;
  }

  function validate(form) {
    clearErrors(form);
    const fields = [...form.querySelectorAll('input, select, textarea')];
    for (const input of fields) {
      if (input.disabled || input.closest('[hidden]')) continue;
      if (!input.checkValidity()) {
        fieldError(input, messageFor(input));
        input.focus();
        return false;
      }
    }
    return true;
  }

  /* Typing is the fix, so the complaint clears as soon as they start. */
  document.addEventListener('input', (e) => {
    const field = e.target.closest && e.target.closest('.field--bad');
    if (!field) return;
    field.classList.remove('field--bad');
    const note = field.querySelector('.field__error');
    if (note) note.remove();
    e.target.removeAttribute('aria-invalid');
  });

  /* ---------- toast ---------- */

  let toastTimer;
  function toast(message) {
    let el = document.getElementById('toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast';
      el.className = 'toast';
      el.setAttribute('role', 'status');
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.classList.add('is-up');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('is-up'), 2600);
  }

  window.TFTUI = { confirm: confirmDialog, alert: alertDialog, validate, fieldError, clearErrors, toast };
})();
