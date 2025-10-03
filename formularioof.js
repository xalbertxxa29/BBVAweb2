// formularioof.js — sin mapas, con búsqueda de OFICINAS + cola offline (v3)
/* global firebase, firebaseConfig */

(() => {
  // ========== Helpers DOM ==========
  const $ = (s, r = document) => r.querySelector(s);
  const norm = (t) =>
    (t || "").toString().normalize("NFD").replace(/\p{Diacritic}/gu, "").toUpperCase();

  // ========== Overlay (compatible con forms.css) ==========
  const setProgress = (f = 0) => {
    const el = $("#overlay-progress");
    if (el) el.style.width = `${Math.max(0, Math.min(100, Math.round(f * 100)))}%`;
  };
  function showOverlay(msg='Cargando…', sub=''){
      const m = document.querySelector('#overlay-msg');
      const s = document.querySelector('#overlay-sub');
      if (m) m.textContent = msg;
      if (s) s.textContent = sub || '';
      const ov = document.querySelector('#overlay');
      if (ov){ ov.classList.add('active'); ov.setAttribute('aria-hidden','false'); }
      setProgress(0);
    }

    function hideOverlay(){
      const ov = document.querySelector('#overlay');
      if (ov){ ov.classList.remove('active'); ov.setAttribute('aria-hidden','true'); }
    }

  // ========== Firebase init (soporta const window.firebaseConfig) ==========
  function ensureFirebase() {
    const cfg =
      (typeof window !== "undefined" && window.firebaseConfig) ||
      (typeof firebaseConfig !== "undefined" ? firebaseConfig : null);

    if (!cfg) throw new Error("firebaseConfig no encontrado");

    if (!firebase.apps || !firebase.apps.length) {
      firebase.initializeApp(cfg);
    }
    // Singletons
    const auth = firebase.auth();
    const db = firebase.firestore();
    const storage = firebase.storage?.();

    // Persistencia offline (best effort)
    try {
      db.enablePersistence?.({ synchronizeTabs: true }).catch(() => {});
      // Compat 8 style:
      firebase.firestore && firebase.firestore().enablePersistence?.({ synchronizeTabs: true }).catch(() => {});
    } catch {}
    return { auth, db, storage };
  }

  let a, d, fbStorage;
  try {
    ({ auth: a, db: d, storage: fbStorage } = ensureFirebase());
  } catch (e) {
    console.error("[Firebase]", e);
    alert("No se pudo iniciar Firebase. Revisa firebase-config.js");
    return;
  }

  // ========== Estado ==========
  let OFFICES = []; // {id, data}

  // ========== Fotos (solo locales hasta enviar) ==========
  let PHOTOS = [];
  function addPhotoBlob(blob) {
    const preview = URL.createObjectURL(blob);
    PHOTOS.push({ blob, preview });
    renderPreviews();
  }
  function clearPhotos() {
    try {
      PHOTOS.forEach((p) => p.preview && URL.revokeObjectURL(p.preview));
    } catch {}
    PHOTOS = [];
    renderPreviews();
  }
  function renderPreviews() {
    const wrap = $("#foto-preview");
    if (!wrap) return;
    wrap.innerHTML = "";
    PHOTOS.forEach((p, idx) => {
      const box = document.createElement("div");
      box.className = "thumb";
      box.innerHTML = `<button class="del" title="Eliminar">&times;</button>`;
      const img = new Image();
      img.src = p.preview;
      box.appendChild(img);
      box.querySelector(".del").addEventListener("click", () => {
        try {
          URL.revokeObjectURL(PHOTOS[idx].preview);
        } catch {}
        PHOTOS.splice(idx, 1);
        renderPreviews();
      });
      wrap.appendChild(box);
    });
  }

  // ========== Cámara: capa mínima (sin mapas) ==========
  let camStream = null;
  let camFacing = "environment";
  const cam = {};
  function cacheCamEls() {
    cam.wrap = $("#cam-overlay");
    cam.video = $("#cam-video");
    cam.hint = $("#cam-hint");
    cam.close = $("#cam-close");
    cam.flip = $("#cam-flip");
    cam.shoot = $("#cam-shoot");
    cam.fallback = $("#cam-fallback");
    cam.fileBtn = $("#cam-file-btn");
    cam.filePick = $("#cam-file");
  }
  async function camStart() {
    if (camStream) camStream.getTracks().forEach((t) => t.stop());
    try {
      camStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: camFacing } },
        audio: false,
      });
      cam.video.srcObject = camStream;
      await cam.video.play();
      cam.video.style.transform = camFacing === "user" ? "scaleX(-1)" : "none";
      cam.fallback.hidden = true;
    } catch (err) {
      console.warn("getUserMedia falló -> fallback", err);
      cam.fallback.hidden = false;
      cam.hint.textContent = "Si tu WebView bloquea la cámara, usa “Cámara nativa”.";
    }
  }
  function camOpen() {
    cam.wrap?.classList.add("active");
    cam.wrap?.setAttribute("aria-hidden", "false");
    camStart();
  }
  function camClose() {
    if (camStream) camStream.getTracks().forEach((t) => t.stop());
    cam.wrap?.classList.remove("active");
    cam.wrap?.setAttribute("aria-hidden", "true");
  }
  function captureBlob() {
    const canvas = document.createElement("canvas");
    canvas.width = cam.video.videoWidth || 1280;
    canvas.height = cam.video.videoHeight || 720;
    const ctx = canvas.getContext("2d");
    if (camFacing === "user") {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(cam.video, 0, 0, canvas.width, canvas.height);
    return new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.9));
  }
  async function camFromCamera() {
    try {
      const b = await captureBlob();
      addPhotoBlob(b);
      camClose();
    } catch (e) {
      alert("No se pudo capturar la foto.");
      console.error(e);
    }
  }
  function camFromFiles(files) {
    const arr = Array.from(files || []);
    if (!arr.length) return;
    arr.forEach((f) => addPhotoBlob(f));
    camClose();
  }
  function wireCamera() {
    $("#btn-foto")?.addEventListener("click", camOpen);
    cam.close?.addEventListener("click", camClose);
    cam.shoot?.addEventListener("click", camFromCamera);
    cam.flip?.addEventListener("click", async () => {
      camFacing = camFacing === "environment" ? "user" : "environment";
      await camStart();
    });
    cam.fileBtn?.addEventListener("click", () => cam.filePick.click());
    cam.filePick?.addEventListener("change", () => camFromFiles(cam.filePick.files));
  }

  // ========== IndexedDB (cola offline) ==========
  const IDB_NAME = "of-reports-db";
  const IDB_STORE = "queue";
  function openIDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE, { keyPath: "id" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function idbPut(item) {
    const db = await openIDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.objectStore(IDB_STORE).put(item);
    });
  }
  async function idbGetAll() {
    const db = await openIDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readonly");
      const store = tx.objectStore(IDB_STORE);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }
  async function idbDel(key) {
    const db = await openIDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.objectStore(IDB_STORE).delete(key);
    });
  }

  async function blobToStorable(b) {
    const buf = await b.arrayBuffer();
    return { type: b.type || "image/jpeg", data: buf };
  }
  function storableToBlob(o) {
    return new Blob([o.data], { type: o.type || "image/jpeg" });
  }

  window.addEventListener("online", () => {
    processQueue().catch(console.error);
  });
  async function processQueue() {
    const items = await idbGetAll();
    if (!items.length) return;
    const user =
      a.currentUser ||
      (await new Promise((res) => {
        const u = a.onAuthStateChanged((x) => {
          u();
          res(x);
        });
      }));
    if (!user) return;

    showOverlay("Reintentando envíos pendientes…", `Pendientes: ${items.length}`);
    let done = 0;
    for (const it of items) {
      try {
        const urls = [];
        for (let i = 0; i < it.photos.length; i++) {
          const b = storableToBlob(it.photos[i]);
          const ref = fbStorage.ref(`capturas/${user.uid}/${it.id}-${i}.jpg`);
          await ref.put(b, { contentType: b.type });
          urls.push(await ref.getDownloadURL());
        }
        const payload = { ...it.payload, fotos: urls, user: { uid: user.uid, email: user.email || null } };
        await d.collection("reportes_oficinas").add(payload);
        await idbDel(it.id);
        done++;
        setProgress(done / items.length);
        const sub = $("#overlay-sub");
        if (sub) sub.textContent = `Enviados: ${done}/${items.length}`;
      } catch (e) {
        console.warn("Reintento falló:", e);
      }
    }
    hideOverlay();
  }

  // ========== Búsqueda y autocompletado de OFICINAS ==========
  async function loadOffices() {
    try {
      const snap = await d.collection("OFICINAS").get();
      OFFICES = snap.docs.map((doc) => ({ id: doc.id, data: doc.data() || {} }));
    } catch (e) {
      console.error("OFICINAS:", e);
      alert("No se pudieron cargar las OFICINAS.");
    }
  }

  function applyOffice(ofi) {
    const dd = ofi.data || {};
    $("#of-search").value = ofi.id || "";

    $("#of-name").value = ofi.id || "";
    $("#of-codigo").value = dd.CODIGO || "";
    $("#of-direccion").value = dd.DIRECCION || "";
    $("#of-distrito").value = dd.DISTRITO || "";
    $("#of-site").value = dd.SITE || "";
    $("#of-consola").value = dd.CONSOLA || "";
    $("#of-moto-save").value = dd["MOTO SAVE"] || "";
    $("#of-motorizado").value = dd["MOTORIZADO"] || "";
    $("#of-turbina").value = dd["TURBINA"] || "";
    $("#of-status").value = dd["STATUS DE FUNCIONAMIENTO"] || "";
  }

  function wireSearch() {
    const input = $("#of-search");
    const sug = $("#of-suggest");
    const render = (items) => {
      if (!items.length) {
        sug.classList.remove("show");
        sug.innerHTML = "";
        return;
      }
      sug.innerHTML = items
        .slice(0, 12)
        .map((it) => {
          const dd = it.data || {};
          const sub = [dd.DIRECCION, dd.DISTRITO].filter(Boolean).join(" · ");
          return `<div class="suggest-item" role="option" data-id="${it.id}">
              <div class="suggest-title">${it.id}</div>
              <div class="suggest-sub">${sub || "&nbsp;"}</div>
            </div>`;
        })
        .join("");
      sug.classList.add("show");
    };

    input.addEventListener("input", () => {
      const q = norm(input.value);
      if (!q) return render([]);
      render(
        OFFICES.filter((o) => {
          const dd = o.data || {};
          return (
            norm(o.id).includes(q) ||
            norm(dd.DIRECCION).includes(q) ||
            norm(dd.DISTRITO).includes(q)
          );
        })
      );
    });
    input.addEventListener("focus", () => {
      if (input.value.trim()) input.dispatchEvent(new Event("input"));
    });
    document.addEventListener("click", (e) => {
      if (!sug.contains(e.target) && e.target !== input) sug.classList.remove("show");
    });
    sug.addEventListener("click", (e) => {
      const it = e.target.closest(".suggest-item");
      if (!it) return;
      const f = OFFICES.find((x) => x.id === it.dataset.id);
      if (f) applyOffice(f);
      sug.classList.remove("show");
    });
  }

  // ========== NOMENCLATURA (cascada) ==========
  function setSel(el, opts, placeholder) {
    el.innerHTML = `<option value="">${placeholder}</option>` + (opts || []).join("");
    el.disabled = !opts || !opts.length;
  }
  const opt = (id, nombre) => {
    const t = nombre || id;
    return `<option value="${id}" data-nombre="${t}">${t}</option>`;
  };

  async function loadCategorias() {
    const sel = $("#sel-cat");
    setSel(sel, [], "Cargando…");
    try {
      const snap = await d.collection("NOMENCLATURA").orderBy("nombre").get();
      const rows = snap.docs
        .filter((doc) => !doc.id.startsWith("__"))
        .map((doc) => opt(doc.id, (doc.data() || {}).nombre || doc.id));
      setSel(sel, rows, "Seleccione Categoría");
    } catch (e) {
      console.error("NOMENCLATURA:", e);
      setSel(sel, [], "Error");
    }
  }
  async function onCategoriaChange() {
    const catId = $("#sel-cat").value;
    const selMotivo = $("#sel-motivo"),
      selNovedad = $("#sel-nov"),
      selDetalle = $("#sel-detalle");
    setSel(selMotivo, [], "Seleccionar…");
    setSel(selNovedad, [], "Seleccionar…");
    setSel(selDetalle, [], "Seleccionar…");
    if (!catId) return;

    showOverlay("Cargando motivos…", catId);
    try {
      const qs = await d
        .collection("NOMENCLATURA")
        .doc(catId)
        .collection("MOTIVOS")
        .orderBy("nombre")
        .get();
      const rows = qs.docs.map((doc) => opt(doc.id, (doc.data() || {}).nombre || doc.id));
      setSel(selMotivo, rows, "Seleccione Motivo");
    } catch (e) {
      console.error(e);
      setSel(selMotivo, [], "Error");
    }
    hideOverlay();
  }
  async function onMotivoChange() {
    const catId = $("#sel-cat").value;
    const motId = $("#sel-motivo").value;
    const selNovedad = $("#sel-nov"),
      selDetalle = $("#sel-detalle");
    setSel(selNovedad, [], "Seleccionar…");
    setSel(selDetalle, [], "Seleccionar…");
    if (!catId || !motId) return;

    showOverlay(
      "Cargando novedades…",
      $("#sel-motivo").selectedOptions[0]?.dataset.nombre || motId
    );
    try {
      const qs = await d
        .collection("NOMENCLATURA")
        .doc(catId)
        .collection("MOTIVOS")
        .doc(motId)
        .collection("NOVEDADES")
        .orderBy("nombre")
        .get();
      const rows = qs.docs.map((doc) => opt(doc.id, (doc.data() || {}).nombre || doc.id));
      setSel(selNovedad, rows, "Seleccione Novedad");
    } catch (e) {
      console.error(e);
      setSel(selNovedad, [], "Error");
    }
    hideOverlay();
  }
  async function onNovedadChange() {
    const catId = $("#sel-cat").value;
    const motId = $("#sel-motivo").value;
    const novId = $("#sel-nov").value;
    const selDetalle = $("#sel-detalle");
    setSel(selDetalle, [], "Seleccionar…");
    if (!catId || !motId || !novId) return;

    showOverlay(
      "Cargando detalle…",
      $("#sel-nov").selectedOptions[0]?.dataset.nombre || novId
    );
    try {
      const qs = await d
        .collection("NOMENCLATURA")
        .doc(catId)
        .collection("MOTIVOS")
        .doc(motId)
        .collection("NOVEDADES")
        .doc(novId)
        .collection("DETALLES")
        .orderBy("nombre")
        .get();
      const rows = qs.docs.map((doc) => opt(doc.id, (doc.data() || {}).nombre || doc.id));
      setSel(selDetalle, rows, "Detalle de Novedad");
    } catch (e) {
      console.error(e);
      setSel(selDetalle, [], "Error");
    }
    hideOverlay();
  }

  // ========== Envío ==========
  async function uploadAllPhotosOnline(uid, photos, prefix) {
    const urls = [];
    for (let i = 0; i < photos.length; i++) {
      const p = photos[i];
      const ref = fbStorage.ref(`capturas/${uid}/${prefix || Date.now()}-${i}.jpg`);
      await ref.put(p, { contentType: p.type || "image/jpeg" });
      urls.push(await ref.getDownloadURL());
      setProgress((i + 1) / photos.length);
      const sub = $("#overlay-sub");
      if (sub) sub.textContent = `Foto ${i + 1} de ${photos.length}`;
    }
    return urls;
  }

  async function sendForm() {
    const user = a.currentUser;
    const ofName = $("#of-name").value.trim();
    const turno = $("#of-turno").value;
    const cat = $("#sel-cat").value;
    const mot = $("#sel-motivo").value;
    const nov = $("#sel-nov").value;
    const det = $("#sel-detalle").value;
    const comment = $("#comentario").value.trim();

    if (!ofName) return alert("Selecciona una oficina.");
    if (!turno) return alert("Selecciona el turno.");
    if (!cat || !mot || !nov)
      return alert("Completa la clasificación (Categoría, Motivo y Novedad).");

    const photoBlobs = (PHOTOS || []).map((p) => p.blob).filter(Boolean);

    const payloadBase = {
      tipo: "OFICINA",
      oficina: {
        id: ofName,
        codigo: $("#of-codigo").value,
        direccion: $("#of-direccion").value,
        distrito: $("#of-distrito").value,
        site: $("#of-site").value,
        consola: $("#of-consola").value,
        moto_save: $("#of-moto-save").value,
        motorizado: $("#of-motorizado").value,
        turbina: $("#of-turbina").value,
        status_funcionamiento: $("#of-status").value,
        turno,
      },
      clasificacion: {
        categoriaId: cat,
        categoria: $("#sel-cat").selectedOptions[0]?.dataset.nombre || "",
        motivoId: mot,
        motivo: $("#sel-motivo").selectedOptions[0]?.dataset.nombre || "",
        novedadId: nov,
        novedad: $("#sel-nov").selectedOptions[0]?.dataset.nombre || "",
        detalleId: det,
        detalle: $("#sel-detalle").selectedOptions[0]?.dataset.nombre || "",
      },
      comentario: comment,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    };

    // Sin red o sin sesión → guardar en cola
    if (!navigator.onLine || !user) {
      try {
        showOverlay("Guardando sin conexión…", "Se enviará al reconectar");
        const photosStored = [];
        for (const b of photoBlobs) photosStored.push(await blobToStorable(b));
        const item = {
          id: `q_${Date.now()}_${Math.random().toString(36).slice(2)}`,
          createdAt: Date.now(),
          payload: payloadBase,
          photos: photosStored,
        };
        await idbPut(item);
        hideOverlay();
        clearPhotos();
        alert("Guardado sin conexión. Se enviará automáticamente al reconectar.");
        window.location.href = "menu.html";
        return;
      } catch (e) {
        hideOverlay();
        console.error("Error guardando en cola offline:", e);
        alert("No se pudo guardar en la cola offline.");
        return;
      }
    }

    // Online
    try {
      showOverlay("Subiendo fotos…", "Preparando");
      const urls = await uploadAllPhotosOnline(user.uid, photoBlobs);
      const payload = { ...payloadBase, fotos: urls, user: { uid: user.uid, email: user.email || null } };
      showOverlay("Enviando reporte…", "Guardando en Firestore");
      setProgress(1);
      await d.collection("reportes_oficinas").add(payload);
      hideOverlay();
      alert("Reporte enviado correctamente.");
      clearPhotos();
      window.location.href = "menu.html";
    } catch (e) {
      hideOverlay();
      console.warn("Fallo envío online, moviendo a cola:", e);
      try {
        showOverlay("Guardando en cola…", "Reintentaremos al reconectar");
        const photosStored = [];
        for (const b of photoBlobs) photosStored.push(await blobToStorable(b));
        const item = {
          id: `q_${Date.now()}_${Math.random().toString(36).slice(2)}`,
          createdAt: Date.now(),
          payload: payloadBase,
          photos: photosStored,
        };
        await idbPut(item);
        hideOverlay();
        clearPhotos();
        alert("No hay conexión estable. Guardado en cola para reintento.");
        window.location.href = "menu.html";
      } catch (e2) {
        hideOverlay();
        console.error("No se pudo guardar en cola:", e2);
        alert("No se pudo enviar ni guardar en cola. Intenta nuevamente.");
      }
    }
  }

  function wireActions() {
    $("#btn-cancelar")?.addEventListener("click", () => {
      try {
        $("#of-search").value = "";
        [
          "of-name",
          "of-codigo",
          "of-direccion",
          "of-distrito",
          "of-site",
          "of-consola",
          "of-moto-save",
          "of-motorizado",
          "of-turbina",
          "of-status",
        ].forEach((id) => {
          const el = $("#" + id);
          if (el) el.value = "";
        });
        ["sel-cat", "sel-motivo", "sel-nov", "sel-detalle", "of-turno"].forEach((id) => {
          const el = $("#" + id);
          if (el) el.value = "";
        });
        $("#comentario").value = "";
        clearPhotos();
      } finally {
        window.location.href = "menu.html";
      }
    });

    $("#btn-enviar")?.addEventListener("click", sendForm);
  }

  // ========== Arranque ==========
  document.addEventListener("DOMContentLoaded", async () => {
    $("#fecha") && ($("#fecha").textContent = new Date().toLocaleDateString());

    // Respeta sesión en curso; si no hay, redirige
    await new Promise((res) =>
      a.onAuthStateChanged((u) => {
        if (!u) location.href = "index.html";
        else res();
      })
    );

    showOverlay("Cargando oficinas…", "Leyendo colección OFICINAS");
    await loadOffices();
    hideOverlay();

    cacheCamEls();
    wireSearch();
    wireCamera();
    wireActions();

    showOverlay("Cargando categorías…", "Leyendo colección NOMENCLATURA");
    await loadCategorias();
    hideOverlay();

    if (navigator.onLine) processQueue().catch(console.error);

    // Listeners de selects
    $("#sel-cat")?.addEventListener("change", onCategoriaChange);
    $("#sel-motivo")?.addEventListener("change", onMotivoChange);
    $("#sel-nov")?.addEventListener("change", onNovedadChange);
  });
})();
