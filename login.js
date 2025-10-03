/* login.js — Auth con Firebase + Transiciones + Toasts (v3)
   - Acepta window.firebaseConfig o const firebaseConfig
   - Toasters accesibles, transición “wipe”, botón con estado de carga
   - Validación en vivo, aviso de CapsLock, recordar correo
   - Reset de contraseña con <dialog>
   - Redirección opcional con ?next=/ruta.html (por defecto: menu.html)
*/
(() => {
  const $ = (s, r = document) => r.querySelector(s);

  // ---------------- Toasts ----------------
  const toastHost =
    document.querySelector('.toast-host') ||
    (() => {
      const h = document.createElement('div');
      h.className = 'toast-host';
      h.setAttribute('aria-live', 'polite');
      h.setAttribute('aria-atomic', 'true');
      document.body.appendChild(h);
      return h;
    })();

  function toast({ title = 'Información', msg = '', type = 'ok', ms = 3200 } = {}) {
    const t = document.createElement('div');
    t.className = `toast toast--${type}`;
    t.innerHTML = `
      <div>
        <div class="toast__title">${title}</div>
        <div class="toast__msg">${msg}</div>
      </div>
      <button class="toast__close" aria-label="Cerrar">✕</button>
    `;
    toastHost.appendChild(t);
    const close = () => { t.classList.add('out'); setTimeout(() => t.remove(), 320); };
    t.querySelector('.toast__close').addEventListener('click', close);
    const id = setTimeout(close, ms);
    t.addEventListener('pointerenter', () => clearTimeout(id), { once: true });
  }

  // Año en el pie (por si no lo pones inline)
  const y = $('#y'); if (y) y.textContent = new Date().getFullYear();

  // Transición “wipe” (overlay opcional)
  const fx = $('#pageFx');
  const runTransition = () => {
    if (!fx) return;
    fx.classList.remove('active'); // reset
    void fx.offsetWidth;           // reflow
    fx.classList.add('active');
  };

  // Utilidades
  const qs = new URLSearchParams(location.search);
  const NEXT_URL = qs.get('next') || 'menu.html';
  const emailKey = 'lc:lastEmail';

  // Estado de conexión → pequeños avisos
  window.addEventListener('offline', () =>
    toast({ title: 'Sin conexión', msg: 'Estás desconectado. Revisa tu red.', type: 'err' })
  );
  window.addEventListener('online', () =>
    toast({ title: 'Conectado', msg: 'La conexión se ha restablecido.', type: 'ok', ms: 1800 })
  );

  // ---------------- Carga ----------------
  window.addEventListener('load', () => {
    // Acepta window.firebaseConfig o const firebaseConfig
    const cfg =
      (typeof window !== 'undefined' && window.firebaseConfig) ||
      (typeof firebaseConfig !== 'undefined' ? firebaseConfig : null);

    if (!window.firebase) {
      toast({ title: 'Error', msg: 'No se cargó Firebase (scripts).', type: 'err', ms: 4800 });
      return;
    }
    if (!cfg) {
      toast({ title: 'Error', msg: 'No se encontró firebase-config.js o la variable firebaseConfig.', type: 'err', ms: 5200 });
      return;
    }

    try { if (!firebase.apps.length) firebase.initializeApp(cfg); }
    catch (e) { console.error('[Firebase init]', e); }

    const auth = firebase.auth();

    // Redirigir si ya está autenticado
    auth.onAuthStateChanged(u => { if (u) goNext(true); });

    // ------------- Referencias UI -------------
    const form       = $('#loginForm');
    const email      = $('#email');
    const pass       = $('#password');
    const emailMsg   = $('#emailMsg');
    const passMsg    = $('#passMsg');
    const remember   = $('#remember');
    const btn        = $('#submitBtn');
    const forgotBtn  = $('#forgotBtn');
    const togglePass = $('#togglePass');

    // Pre-cargar último correo
    try { const last = localStorage.getItem(emailKey); if (last && !email.value) email.value = last; } catch {}

    const isEmail = v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v || '');
    const setLoading = v => {
      btn.disabled = v;
      btn.setAttribute('aria-busy', String(v));
      btn.classList.toggle('loading', v);
      if (v) btn.dataset.text = btn.textContent, (btn.textContent = 'Ingresando…');
      else if (btn.dataset.text) btn.textContent = btn.dataset.text;
    };

    // Validación en vivo
    email?.addEventListener('input', () => {
      emailMsg.textContent = isEmail(email.value) ? '' : 'Ingresa un correo válido.';
    });

    pass?.addEventListener('input', () => {
      passMsg.textContent = (pass.value || '').length >= 6 ? '' : 'Mínimo 6 caracteres.';
    });

    // Aviso CapsLock
    const capsHint = () => {
      const on = window.event?.getModifierState && window.event.getModifierState('CapsLock');
      passMsg.textContent = on ? 'Bloq Mayús activado.' : '';
      if (on) passMsg.classList.add('err'); else passMsg.classList.remove('err');
    };
    pass?.addEventListener('keyup', capsHint);
    pass?.addEventListener('keydown', capsHint);

    // Mostrar/ocultar contraseña
    togglePass?.addEventListener('click', () => {
      pass.type = pass.type === 'password' ? 'text' : 'password';
      pass.focus();
    });

    // Submit
    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!isEmail(email.value)) { email.focus(); emailMsg.textContent = 'Ingresa un correo válido.'; return; }
      if ((pass.value || '').length < 6) { pass.focus(); passMsg.textContent = 'Mínimo 6 caracteres.'; return; }

      try {
        setLoading(true);
        await auth.setPersistence(
          remember.checked
            ? firebase.auth.Auth.Persistence.LOCAL
            : firebase.auth.Auth.Persistence.SESSION
        );
        await auth.signInWithEmailAndPassword(email.value.trim(), pass.value);
        try { localStorage.setItem(emailKey, email.value.trim()); } catch {}
        toast({ title: '¡Bienvenido!', msg: 'Autenticación correcta. Entrando…', type: 'ok', ms: 1600 });
        goNext(false);
      } catch (err) {
        const msg = mapAuthError(err);
        toast({ title: 'No pudimos iniciar sesión', msg, type: 'err', ms: 4800 });
        console.error('[Auth] signIn error:', err);
      } finally {
        setLoading(false);
      }
    });

    // ------------- Reset password (dialog) -------------
    const dlg        = $('#resetDlg');
    const resetEmail = $('#resetEmail');
    const resetMsg   = $('#resetMsg');
    const resetError = $('#resetError');
    const resetOk    = $('#resetOk');
    const resetSend  = $('#resetSend');

    forgotBtn?.addEventListener('click', () => {
      if (!dlg) return;
      resetError.textContent = '';
      resetOk.textContent = '';
      resetMsg.textContent = '';
      resetEmail.value = email.value || '';
      dlg.showModal();
      setTimeout(() => resetEmail.focus(), 40);
    });

    resetEmail?.addEventListener('input', () => {
      resetMsg.textContent = isEmail(resetEmail.value) ? '' : 'Correo no válido';
    });

    resetSend?.addEventListener('click', async (ev) => {
      ev.preventDefault();
      if (!isEmail(resetEmail.value)) { resetMsg.textContent = 'Correo no válido'; return; }
      try {
        await auth.sendPasswordResetEmail(resetEmail.value.trim());
        resetOk.textContent = 'Enlace enviado. Revisa tu correo.';
        toast({ title: 'Correo enviado', msg: 'Revisa tu bandeja de entrada para restablecer la contraseña.', type: 'ok' });
        setTimeout(() => dlg.close('ok'), 1500);
      } catch (err) {
        const m = mapAuthError(err);
        resetError.textContent = m;
        toast({ title: 'No se pudo enviar', msg: m, type: 'err' });
      }
    });

    // ------------- Helpers -------------
    function goNext(fromAuthObserver) {
      runTransition(); // efecto wipe
      setTimeout(() => window.location.assign('./' + NEXT_URL.replace(/^\//,'')), fromAuthObserver ? 300 : 450);
    }

    function mapAuthError(err) {
      const code = (err && err.code) || '';
      switch (code) {
        case 'auth/invalid-email':                return 'El correo no es válido.';
        case 'auth/user-disabled':                return 'Usuario deshabilitado. Contacta a soporte.';
        case 'auth/user-not-found':               return 'No existe una cuenta con este correo.';
        case 'auth/wrong-password':               return 'Contraseña incorrecta.';
        case 'auth/too-many-requests':            return 'Demasiados intentos. Intenta más tarde.';
        case 'auth/network-request-failed':       return 'Sin conexión o red inestable.';
        // Variantes que a veces llegan en ciertos SDKs/tenants
        case 'auth/invalid-credential':
        case 'auth/invalid-login-credentials':    return 'Credenciales inválidas. Verifica correo y contraseña.';
        default:                                   return 'Hubo un problema. Intenta nuevamente.';
      }
    }
  });
})();
