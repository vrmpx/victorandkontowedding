(() => {
  /* ===== ✎ Configure here ===== */
  const CFG = {
    // Leave the placeholder in place to use demo mode (fake data, no backend) while styling locally.
    endpoint: 'https://script.google.com/macros/s/AKfycbyfA1On_SuA4_jmtK4zmfJsHs2ndMwHI--AixHWoSskIEz5v9yquyO-6pMriqPrDKqUJg/exec',
    mode: 'custom',            // 'custom' | 'fallback'  ← flip to 'fallback' to force the Google Form
    fallbackUrl: 'https://docs.google.com/forms/d/e/1FAIpQLScv4RTyJfWKPHZWegGGM_-L-Q5FJ5gT6PP_Od_iRszirX3iew/viewform?embedded=true',
    deadline: '2026-12-15T23:59:59-06:00', // keep in sync with Code.gs
    deadlineLabel: { en: 'December 15, 2026', es: '15 de diciembre de 2026' },
    timeoutMs: 15000,
    failuresBeforeFallback: 2, // consecutive network/server errors before switching to the form
  };
  const DEMO = CFG.endpoint.includes('PASTE_DEPLOYMENT_ID');

  const STR = {
    en: {
      eyebrow: "We can't wait to celebrate with you",
      title: 'Will you join us?',
      lede: "Let us know you're coming. It takes a minute, and it means everything.",
      deadlineNote: 'Please RSVP by {deadline}',
      codeLabel: 'Invitation code',
      codeHint: "You'll find it on your invitation.",
      find: 'Find',
      looking: 'Looking…',
      notFound: "We couldn't find that code. Please check it and try again.",
      prevNote: 'We already have your reply; you can update it here.',
      plusOne: 'Plus-one',
      plusOneName: "Plus-one's name",
      attending: 'Will attend',
      notAttending: "Can't make it",
      dietary: 'Dietary restrictions (vegetarian, allergies…)',
      email: 'Email (optional, for a confirmation)',
      message: 'A note for us (optional)',
      back: 'Change code',
      submit: 'Send RSVP',
      sending: 'Sending…',
      answerAll: 'Please answer for each guest.',
      nameNeeded: "Please enter your plus-one's name.",
      doneYes: 'Thank you! See you on March 20.',
      doneNo: "Thanks for letting us know. We'll miss you.",
      seeDetails: 'The details',
      edit: 'Edit reply',
      closed: 'The RSVP deadline has passed. Please message us directly if something changed.',
      retry: 'Something went wrong. Please try again.',
      fallbackNote: "Our form isn't available right now. Please RSVP here instead:",
      fallbackOpen: 'Open the form in a new tab',
      demo: 'Demo mode: no backend connected, any code works and nothing is saved.',
    },
    es: {
      eyebrow: 'No podemos esperar a celebrar contigo',
      title: '¿Nos acompañas?',
      lede: 'Avísanos si vienes. Toma un minuto y significa muchísimo.',
      deadlineNote: 'Por favor confirma antes del {deadline}',
      codeLabel: 'Código de invitación',
      codeHint: 'Lo encuentras en tu invitación.',
      find: 'Buscar',
      looking: 'Buscando…',
      notFound: 'No encontramos ese código. Revísalo e intenta de nuevo.',
      prevNote: 'Ya recibimos tu respuesta; puedes actualizarla aquí.',
      plusOne: 'Acompañante',
      plusOneName: 'Nombre del acompañante',
      attending: 'Asistiré',
      notAttending: 'No podré asistir',
      dietary: 'Restricciones alimentarias (vegetariano, alergias…)',
      email: 'Correo (opcional, para enviarte una confirmación)',
      message: 'Un mensaje para nosotros (opcional)',
      back: 'Cambiar código',
      submit: 'Enviar',
      sending: 'Enviando…',
      answerAll: 'Indica si asistirá cada invitado.',
      nameNeeded: 'Escribe el nombre de tu acompañante.',
      doneYes: '¡Gracias! Nos vemos el 20 de marzo.',
      doneNo: 'Gracias por avisarnos. Te vamos a extrañar.',
      seeDetails: 'Los detalles',
      edit: 'Editar respuesta',
      closed: 'El plazo para confirmar ya cerró. Escríbenos directamente si necesitas hacer un cambio.',
      retry: 'Algo salió mal. Intenta de nuevo.',
      fallbackNote: 'Nuestro formulario no está disponible en este momento. Por favor confirma aquí:',
      fallbackOpen: 'Abrir el formulario en una pestaña nueva',
      demo: 'Modo demo: sin backend, cualquier código funciona y no se guarda nada.',
    },
  };

  /* ===== Internals ===== */
  const $ = id => document.getElementById(id);
  const root = $('rsvp');
  if (!root) return;

  let lang = detectLang();
  let step = 'lookup';
  let doneKey = 'doneYes';
  let failures = 0;
  let state = { code: null, party: '', guests: [], previous: null };

  function detectLang() {
    return (document.documentElement.lang || 'en').toLowerCase().startsWith('es') ? 'es' : 'en';
  }
  function t(key) {
    return (STR[lang][key] ?? STR.en[key] ?? '').replace('{deadline}', CFG.deadlineLabel[lang]);
  }
  function el(tag, attrs = {}, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    n.append(...kids);
    return n;
  }
  function status(msg = '', isError = false) {
    const s = $('rsvp-status');
    s.textContent = msg;
    s.classList.toggle('is-error', isError);
  }
  function show(name) {
    root.querySelectorAll('.rsvp-step').forEach(n => { n.hidden = n.id !== `rsvp-${name}`; });
    step = name;
    status();
  }
  function busy(form, on) {
    form.setAttribute('aria-busy', on);
    form.querySelectorAll('button').forEach(b => { b.disabled = on; });
  }

  function applyText() {
    root.querySelectorAll('[data-i18n]').forEach(n => { n.textContent = t(n.dataset.i18n); });
    if (step === 'form') renderGuests(collect()); // keep what they've typed
    if (step === 'done') $('rsvp-done-msg').textContent = t(doneKey);
  }

  async function api(action, payload) {
    if (DEMO) return demoApi(action, payload);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), CFG.timeoutMs);
    try {
      // No Content-Type header → sent as text/plain, which avoids a CORS preflight Apps Script can't answer.
      const res = await fetch(CFG.endpoint, {
        method: 'POST',
        body: JSON.stringify({ action, ...payload }),
        signal: ctl.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  // Fake backend for local styling. Code "NOPE" → not found, "FAIL" → server error.
  async function demoApi(action, payload) {
    await new Promise(r => setTimeout(r, 500));
    const code = String(payload.code || '').toUpperCase();
    if (code === 'NOPE') return { ok: false, error: 'not_found' };
    if (code === 'FAIL') return { ok: false, error: 'server' };
    if (action === 'lookup') {
      return {
        ok: true, code, party: 'The Demo Family', closed: false, previous: null,
        guests: [
          { slot: 0, name: 'Ana Demo', open: false },
          { slot: 1, name: 'Luis Demo', open: false },
          { slot: 2, name: '', open: true },
        ],
      };
    }
    return { ok: true, updated: false, attending: payload.guests.filter(g => g.attending).length };
  }

  // Network/server trouble: retry message first, then switch to the Google Form.
  function failed() {
    failures += 1;
    if (failures >= CFG.failuresBeforeFallback) fallback();
    else status(t('retry'), true);
  }

  function fallback() {
    const iframe = $('rsvp-iframe');
    if (!iframe.src) iframe.src = CFG.fallbackUrl;
    $('rsvp-fallback-link').href = CFG.fallbackUrl.replace(/([?&])embedded=true&?/, '$1').replace(/[?&]$/, '');
    show('fallback');
  }

  function prefillValues(prev) {
    return state.guests.map((g, i) => {
      const p = prev && prev.guests.find(x => x.slot === i);
      return p ? { name: p.name, attending: p.attending, dietary: p.dietary } : {};
    });
  }

  function renderGuests(values) {
    const box = $('rsvp-guests');
    box.replaceChildren();
    state.guests.forEach((g, i) => {
      const v = values[i] || {};
      const fs = el('fieldset', { class: g.open ? 'rsvp-guest is-open' : 'rsvp-guest' },
        el('legend', {}, g.open ? t('plusOne') : g.name));

      if (g.open) {
        const nameInput = el('input', { id: `rsvp-name-${i}`, name: `name-${i}`, autocomplete: 'off', maxlength: '100' });
        nameInput.value = v.name || '';
        fs.append(el('label', { for: `rsvp-name-${i}`, class: 'rsvp-sub' }, t('plusOneName')), nameInput);
      }

      const choice = el('div', { class: 'rsvp-choice', role: 'radiogroup' });
      [['yes', 'attending'], ['no', 'notAttending']].forEach(([val, key]) => {
        const radio = el('input', { type: 'radio', name: `att-${i}`, value: val });
        radio.checked = v.attending === (val === 'yes');
        choice.append(el('label', {}, radio, el('span', {}, t(key))));
      });

      const dietInput = el('input', { id: `rsvp-diet-${i}`, name: `diet-${i}`, maxlength: '300' });
      dietInput.value = v.dietary || '';
      const diet = el('div', { class: 'rsvp-diet' },
        el('label', { for: `rsvp-diet-${i}`, class: 'rsvp-sub' }, t('dietary')), dietInput);
      diet.hidden = v.attending !== true;

      choice.addEventListener('change', () => {
        diet.hidden = !choice.querySelector('input[value="yes"]').checked;
      });

      fs.append(choice, diet);
      box.append(fs);
    });
  }

  function collect() {
    const f = $('rsvp-form');
    return state.guests.map((g, i) => {
      const att = f.querySelector(`input[name="att-${i}"]:checked`);
      return {
        slot: i,
        name: g.open ? (f.querySelector(`[name="name-${i}"]`)?.value.trim() || '') : g.name,
        attending: att ? att.value === 'yes' : null,
        dietary: f.querySelector(`[name="diet-${i}"]`)?.value.trim() || '',
      };
    });
  }

  /* ===== Step 1: lookup ===== */
  $('rsvp-lookup').addEventListener('submit', async e => {
    e.preventDefault();
    const form = e.currentTarget;
    const code = $('rsvp-code').value.trim();
    if (!code) { $('rsvp-code').focus(); return; }
    busy(form, true);
    status(t('looking'));
    try {
      const r = await api('lookup', { code });
      if (r.ok || r.error === 'not_found') failures = 0;
      if (r.ok && r.closed) return show('closed');
      if (r.ok) {
        state = r;
        $('rsvp-party').textContent = r.party;
        $('rsvp-prev').hidden = !r.previous;
        $('rsvp-email').value = r.previous?.email || '';
        $('rsvp-message').value = r.previous?.message || '';
        renderGuests(prefillValues(r.previous));
        show('form');
      } else if (r.error === 'not_found') {
        status(t('notFound'), true);
      } else {
        failed();
      }
    } catch {
      failed();
    } finally {
      busy(form, false);
    }
  });

  /* ===== Step 2: submit ===== */
  $('rsvp-form').addEventListener('submit', async e => {
    e.preventDefault();
    const form = e.currentTarget;
    const answers = collect();
    if (answers.some(a => a.attending === null)) return status(t('answerAll'), true);
    if (answers.some((a, i) => state.guests[i].open && a.attending && !a.name)) return status(t('nameNeeded'), true);

    busy(form, true);
    status(t('sending'));
    try {
      const r = await api('submit', {
        code: state.code,
        guests: answers,
        email: $('rsvp-email').value.trim(),
        message: $('rsvp-message').value.trim(),
        website: $('rsvp-website').value,
        lang,
      });
      if (r.ok) {
        failures = 0;
        doneKey = r.attending > 0 ? 'doneYes' : 'doneNo';
        show('done');
        $('rsvp-done-msg').textContent = t(doneKey);
      } else if (r.error === 'closed') {
        show('closed');
      } else if (r.error === 'not_found') {
        show('lookup');
        status(t('notFound'), true);
      } else {
        failed();
      }
    } catch {
      failed(); // safe to resend: the backend replaces earlier answers for the same code
    } finally {
      busy(form, false);
    }
  });

  $('rsvp-back').addEventListener('click', () => { show('lookup'); $('rsvp-code').focus(); });
  $('rsvp-edit').addEventListener('click', () => show('form'));

  /* ===== Init ===== */
  applyText();

  // If you add a language toggle later: change <html lang> or call RSVP.setLang('es'|'en').
  new MutationObserver(() => {
    const l = detectLang();
    if (l !== lang) { lang = l; applyText(); }
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
  window.RSVP = { setLang(l) { lang = l === 'es' ? 'es' : 'en'; applyText(); }, fallback };

  if (CFG.mode === 'fallback') {
    fallback();
  } else if (new Date() > new Date(CFG.deadline)) {
    show('closed');
  } else {
    if (DEMO) status(t('demo'));
    // Personal links: https://yourdomain/rsvp/?code=ABC123
    const preset = new URLSearchParams(location.search).get('code');
    if (preset) {
      $('rsvp-code').value = preset;
      $('rsvp-lookup').requestSubmit();
    }
  }
})();
