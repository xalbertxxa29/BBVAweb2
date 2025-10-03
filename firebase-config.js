// firebase-config.js — inicializa Firebase y expone singletons (auth, db, storage)
// Funciona con SDK 8.x o 10.x compat (namespace "firebase").

// --- Configuración de tu proyecto ---
const firebaseConfig = {
  apiKey: "AIzaSyC6V--xlNwoe5iB9QD8Y2s2SQ4M0yR0MmQ",
  authDomain: "bbva-37617.firebaseapp.com",
  projectId: "bbva-37617",
  storageBucket: "bbva-37617.appspot.com",
  messagingSenderId: "923249356091",
  appId: "1:923249356091:web:e2e8a77bb33a55c37e9b1e"
};

// Inicializa de forma segura, evitando doble init.
(function () {
  const fb = window.firebase;
  const cfg = (typeof window.firebaseConfig !== "undefined" && window.firebaseConfig) || firebaseConfig;

  if (!fb) {
    console.error("[Firebase] SDK no cargado antes de firebase-config.js");
    return;
  }
  try {
    if (!fb.apps || !fb.apps.length) {
      fb.initializeApp(cfg);
    }
  } catch (e) {
    // Si ya estaba inicializado, ignoramos.
    if (!String(e).includes("already exists")) console.warn("[Firebase init]", e);
  }

  // Expone singletons para el resto del código
  try { if (fb.auth && !window.auth) window.auth = fb.auth(); } catch {}
  try { if (fb.firestore && !window.db) window.db = fb.firestore(); } catch {}
  try { if (fb.storage && !window.storage) window.storage = fb.storage(); } catch {}
})();
