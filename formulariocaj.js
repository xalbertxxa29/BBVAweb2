/* formulariocaj.js — Adjuntar fotos + subida diferida + cola offline (CAJEROS) */
(() => {
  // ===== Firebase singletons =====
  const a = window.auth || (window.firebase?.auth ? firebase.auth() : null);
  const d = window.db   || (window.firebase?.firestore ? firebase.firestore() : null);
  const fbStorage = window.storage || (window.firebase?.storage ? firebase.storage() : null);

  // Cache local Firestore (opcional)
  try {
    if (window.firebase?.firestore) {
      firebase.firestore().enablePersistence({ synchronizeTabs: true }).catch(()=>{});
    }
  } catch {}

  // ===== Utils DOM / UI =====
  const $ = s => document.querySelector(s);
  const normU = t => (t||'').toString().normalize('NFD').replace(/\p{Diacritic}/gu,'').toUpperCase();

  // Toast mini (centrado)
  function toast(msg, ms=2200){
    let shell = document.getElementById('app-toast');
    if (!shell){
      shell = document.createElement('div');
      shell.id = 'app-toast';
      shell.style.cssText = 'position:fixed;inset:0;display:none;align-items:center;justify-content:center;z-index:99999;';
      const card = document.createElement('div');
      card.id = 'app-toast-card';
      card.style.cssText = 'max-width:90%;background:#111c;color:#fff;padding:14px 16px;border-radius:12px;backdrop-filter:blur(3px);font-weight:600;text-align:center';
      shell.appendChild(card);
      document.body.appendChild(shell);
    }
    const card = document.getElementById('app-toast-card');
    card.textContent = msg;
    shell.style.display = 'flex';
    clearTimeout(shell._t);
    shell._t = setTimeout(()=>{ shell.style.display='none'; }, ms);
  }

  // Overlay de carga (usa forms.css)
  function showOverlay(msg='Cargando…', sub=''){
    const m = $('#overlay-msg'), s = $('#overlay-sub');
    if (m) m.textContent = msg;
    if (s) s.textContent = sub || '';
    setProgress(0);
    const o = $('#overlay'); if (o) o.setAttribute('aria-hidden', 'false');
  }
  function hideOverlay(){ const o = $('#overlay'); if (o) o.setAttribute('aria-hidden','true'); }
  function setProgress(f){ const el = $('#overlay-progress'); if (el) el.style.width = `${Math.max(0, Math.min(100, Math.round((f||0)*100)))}%`; }

  // ===== Estado general =====
  let CAJEROS = [];
  let lastUserPos = null;

  // ===== FOTOS (local hasta Enviar) =====
  let PHOTOS = [];
  function addPhotoFile(file){
    if (!file) return;
    const preview = URL.createObjectURL(file);
    PHOTOS.push({ file, preview });
    renderPreviews();
  }
  function clearPhotos(){
    try{ PHOTOS.forEach(p => p.preview && URL.revokeObjectURL(p.preview)); }catch{}
    PHOTOS = [];
    renderPreviews();
    const picker = $('#file-pick'); if (picker) picker.value = '';
  }
  function renderPreviews(){
    const wrap = $('#foto-preview'); if (!wrap) return;
    wrap.innerHTML = '';
    PHOTOS.forEach((p, idx)=>{
      const box = document.createElement('div');
      box.className = 'thumb';
      box.innerHTML = `<button class="del" title="Eliminar">&times;</button>`;
      const img = new Image(); img.src = p.preview; box.appendChild(img);
      box.querySelector('.del').addEventListener('click', ()=>{
        try{ URL.revokeObjectURL(PHOTOS[idx].preview); }catch{}
        PHOTOS.splice(idx,1); renderPreviews();
      });
      wrap.appendChild(box);
    });
  }

  // ========== IndexedDB (cola offline) ==========
  const IDB_NAME = 'cj-reports-db';
  const IDB_STORE = 'queue';
  function openIDB(){
    return new Promise((resolve, reject)=>{
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)){
          db.createObjectStore(IDB_STORE, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function idbPut(item){
    const db = await openIDB();
    return new Promise((resolve, reject)=>{
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.objectStore(IDB_STORE).put(item);
    });
  }
  async function idbGetAll(){
    const db = await openIDB();
    return new Promise((resolve, reject)=>{
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }
  async function idbDel(key){
    const db = await openIDB();
    return new Promise((resolve, reject)=>{
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.objectStore(IDB_STORE).delete(key);
    });
  }

  // Blobs serializables
  async function fileToStorable(f){
    const buf = await f.arrayBuffer();
    return { type: f.type || 'image/jpeg', data: buf, name: f.name || 'foto.jpg' };
  }
  function storableToBlob(o){
    return new Blob([o.data], { type: o.type || 'image/jpeg' });
  }

  // Reintento al reconectar
  window.addEventListener('online', ()=> { processQueue().catch(console.error); });
  async function processQueue(){
    if (!a || !d || !fbStorage) return;
    const items = await idbGetAll();
    if (!items.length) return;
    const user = a.currentUser || await new Promise(res => { const unsub = a.onAuthStateChanged(u=>{ unsub(); res(u); }); });
    if (!user) return;

    showOverlay('Reintentando envíos pendientes…', `Pendientes: ${items.length}`);
    let done = 0;
    for (const it of items){
      try {
        // Subir fotos del item
        const urls = [];
        for (let i=0;i<it.photos.length;i++){
          const b = storableToBlob(it.photos[i]);
          const ref = fbStorage.ref(`capturas/${user.uid}/${it.id}-${i}.jpg`);
          await ref.put(b, { contentType: b.type });
          urls.push(await ref.getDownloadURL());
        }
        // Guardar doc
        const payload = { ...it.payload, fotos: urls, user: { uid: user.uid, email: user.email || null } };
        await d.collection('reportes_cajeros').add(payload);
        await idbDel(it.id);
        done++;
        setProgress(done/items.length);
        const sub = $('#overlay-sub'); if (sub) sub.textContent = `Enviados: ${done}/${items.length}`;
      } catch (e) {
        console.warn('Reintento falló:', e);
      }
    }
    hideOverlay();
  }

  // ===== Inicio =====
  document.addEventListener('DOMContentLoaded', async () => {
    const fechaEl = document.getElementById('fecha');
    if (fechaEl) fechaEl.textContent = new Date().toLocaleDateString();

    if (!a || !d) { toast('Firebase no está disponible.'); return; }

    // Exige sesión
    await new Promise(res => a.onAuthStateChanged(u => { if(!u) location.href='index.html'; else res(); }));

    showOverlay('Cargando cajeros…','Leyendo colección CAJEROS');
    await loadCajeros(); hideOverlay();

    wireSearch(); wireFiles(); wireActions();

    showOverlay('Cargando categorías…','Leyendo colección NOMENCLATURA');
    await loadCategorias(); hideOverlay();

    // Posición (simple) para adjuntarla al reporte
    getCurrentPositionWithFallback().then(p => { lastUserPos = { lat:p.lat, lng:p.lng }; }).catch(()=>{});

    if (navigator.onLine) { processQueue().catch(console.error); }
  });

  // =================== CAJEROS ===================
  async function loadCajeros(){
    try{
      const snap = await d.collection('CAJEROS').get();
      CAJEROS = snap.docs.map(doc => ({ id: doc.id, data: doc.data() }));
    }catch(e){ console.error('CAJEROS:', e); toast('No se pudieron cargar los cajeros.'); }
  }

  function wireSearch(){
    const input = $('#cj-search');
    const sug   = $('#cj-suggest') || (()=> {
      const div = document.createElement('div'); div.id = 'cj-suggest'; div.className='suggest'; (input?.parentNode||document.body).appendChild(div); return div;
    })();

    const render = items => {
      if (!items.length){ sug.classList.remove('show'); sug.innerHTML=''; return; }
      sug.innerHTML = items.slice(0,50).map(it=>{
        const dd = it.data||{}; const sub = [dd['DIRECCION'], dd['DISTRITO']].filter(Boolean).join(' · ');
        return `<div class="suggest-item" role="option" data-id="${it.id}">
          <div class="suggest-title">${it.id}</div><div class="suggest-sub">${sub||'&nbsp;'}</div></div>`;
      }).join('');
      sug.classList.add('show');
    };

    input?.addEventListener('input', ()=>{
      const q = normU(input.value);
      if (!q){ render([]); return; }
      render(CAJEROS.filter(o=>{
        const dd = o.data||{};
        return normU(o.id).includes(q) || normU(dd['DIRECCION']).includes(q) || normU(dd['DISTRITO']).includes(q);
      }));
    });

    input?.addEventListener('focus', ()=>{ if (input.value.trim()) input.dispatchEvent(new Event('input')); });

    document.addEventListener('click', e=>{ if (!sug.contains(e.target) && e.target!==input) { sug.classList.remove('show'); } });

    sug.addEventListener('click', e=>{
      const it = e.target.closest('.suggest-item'); if(!it) return;
      const f = CAJEROS.find(x=>x.id===it.dataset.id); if (f) applyCajero(f);
      // cerrar inmediatamente
      sug.classList.remove('show');
      sug.innerHTML = '';
      input?.blur();
    });
  }

  function applyCajero(item){
    const dta = item.data||{};
    const get = k => dta[k] ?? dta[k?.toUpperCase?.()] ?? dta[k?.toLowerCase?.()];

    $('#cj-search')     && ($('#cj-search').value = item.id);
    $('#cj-name')       && ($('#cj-name').value = item.id || '');
    $('#cj-termid')     && ($('#cj-termid').value = get('TERM ID') || get('TERMID') || get('TERM_ID') || '');
    $('#cj-direccion')  && ($('#cj-direccion').value = get('DIRECCION') || '');
    $('#cj-distrito')   && ($('#cj-distrito').value = get('DISTRITO') || '');
    $('#cj-consola')    && ($('#cj-consola').value = get('CONSOLA') || '');
    $('#cj-estado')     && ($('#cj-estado').value = get('ESTADO') || '');
    $('#cj-turbina')    && ($('#cj-turbina').value = get('TURBINA') || '');
  }

  // =================== NOMENCLATURA (cascada) ===================
  function setSel(el, opts, placeholder){
    if (!el) return;
    el.innerHTML = `<option value="">${placeholder}</option>` + (opts||[]).join('');
    el.disabled = !opts || opts.length === 0;
  }
  function opt(id, nombre){
    const t = nombre || id;
    return `<option value="${id}" data-nombre="${t}">${t}</option>`;
  }

  async function loadCategorias(){
    const sel = $('#sel-cat');
    if (!sel) return;
    setSel(sel, [], 'Cargando…');
    try{
      const snap = await d.collection('NOMENCLATURA').orderBy('nombre').get();
      const rows = snap.docs
        .filter(doc => !doc.id.startsWith('__'))
        .map(doc => opt(doc.id, (doc.data()||{}).nombre || doc.id));
      setSel(sel, rows, 'Seleccione Categoría');
    }catch(e){
      console.error('NOMENCLATURA:', e);
      setSel(sel, [], 'Error');
    }
  }
  async function onCategoriaChange(){
    const catId = $('#sel-cat')?.value || '';
    const selMotivo = $('#sel-motivo'), selNovedad = $('#sel-nov'), selDetalle = $('#sel-detalle');
    setSel(selMotivo, [], 'Seleccionar…');
    setSel(selNovedad, [], 'Seleccionar…');
    setSel(selDetalle, [], 'Seleccionar…');
    if (!catId) return;

    showOverlay('Cargando motivos…', catId);
    try{
      const qs = await d.collection('NOMENCLATURA').doc(catId).collection('MOTIVOS').orderBy('nombre').get();
      const rows = qs.docs.map(doc => opt(doc.id, (doc.data()||{}).nombre || doc.id));
      setSel(selMotivo, rows, 'Seleccione Motivo');
    }catch(e){
      console.error(e);
      setSel(selMotivo, [], 'Error');
    }
    hideOverlay();
  }
  async function onMotivoChange(){
    const catId = $('#sel-cat')?.value || '';
    const motId = $('#sel-motivo')?.value || '';
    const selNovedad = $('#sel-nov'), selDetalle = $('#sel-detalle');
    setSel(selNovedad, [], 'Seleccionar…');
    setSel(selDetalle, [], 'Seleccionar…');
    if (!catId || !motId) return;

    showOverlay('Cargando novedades…', $('#sel-motivo')?.selectedOptions[0]?.dataset.nombre || motId);
    try{
      const qs = await d.collection('NOMENCLATURA').doc(catId)
        .collection('MOTIVOS').doc(motId)
        .collection('NOVEDADES').orderBy('nombre').get();
      const rows = qs.docs.map(doc => opt(doc.id, (doc.data()||{}).nombre || doc.id));
      setSel(selNovedad, rows, 'Seleccione Novedad');
    }catch(e){
      console.error(e);
      setSel(selNovedad, [], 'Error');
    }
    hideOverlay();
  }
  async function onNovedadChange(){
    const catId = $('#sel-cat')?.value || '';
    const motId = $('#sel-motivo')?.value || '';
    const novId = $('#sel-nov')?.value || '';
    const selDetalle = $('#sel-detalle');
    setSel(selDetalle, [], 'Seleccionar…');
    if (!catId || !motId || !novId) return;

    showOverlay('Cargando detalle…', $('#sel-nov')?.selectedOptions[0]?.dataset.nombre || novId);
    try{
      const qs = await d.collection('NOMENCLATURA').doc(catId)
        .collection('MOTIVOS').doc(motId)
        .collection('NOVEDADES').doc(novId)
        .collection('DETALLES').orderBy('nombre').get();
      const rows = qs.docs.map(doc => opt(doc.id, (doc.data()||{}).nombre || doc.id));
      setSel(selDetalle, rows, 'Detalle de Novedad');
    }catch(e){
      console.error(e);
      setSel(selDetalle, [], 'Error');
    }
    hideOverlay();
  }

  // =================== Archivos (adjuntar) ===================
  function wireFiles(){
    // Botón abre el input file
    $('#btn-foto')?.addEventListener('click', ()=> $('#file-pick')?.click());
    // Cambios en el input: agregar a previews
    $('#file-pick')?.addEventListener('change', (ev)=>{
      const files = Array.from(ev.target.files || []);
      if (!files.length) return;
      files.forEach(f => addPhotoFile(f));
    });
  }

  // ===== Cancelar / Enviar =====
  function wireActions(){
    $('#btn-cancelar')?.addEventListener('click', async ()=>{
      try{
        ['cj-search','cj-name','cj-termid','cj-direccion','cj-distrito','cj-consola','cj-estado','cj-turbina'].forEach(id=>{
          const el=document.getElementById(id); if(el) el.value='';
        });
        ['sel-cat','sel-motivo','sel-nov','sel-detalle','cj-turno'].forEach(id=>{
          const el=document.getElementById(id); if(el) el.value='';
        });
        const com = document.getElementById('comentario'); if (com) com.value='';
        clearPhotos();
      } finally {
        window.location.href = 'menu.html';
      }
    });
    $('#btn-enviar')?.addEventListener('click', sendForm);
  }

  // ===== Posición (sin mapa) =====
  const GPS_FALLBACK = { lat: -12.177583726464341, lng: -77.0161780746462 };
  async function getCurrentPositionWithFallback(){
    if (!navigator.geolocation) return { ...GPS_FALLBACK, source: 'fallback' };
    try {
      const pos = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 8000, maximumAge: 10000 });
      });
      return { lat: pos.coords.latitude, lng: pos.coords.longitude, source: 'device' };
    } catch {
      return { ...GPS_FALLBACK, source: 'fallback' };
    }
  }

  // ===== Subida de fotos (online) =====
  async function uploadAllPhotosOnline(uid, photos, prefix){
    if (!fbStorage) return [];
    const urls = [];
    for (let i=0;i<photos.length;i++){
      const p = photos[i];
      const ref = fbStorage.ref(`capturas/${uid}/${prefix || ('CJ-' + Date.now())}-${i}.jpg`);
      await ref.put(p, { contentType: p.type || 'image/jpeg' });
      urls.push(await ref.getDownloadURL());
      setProgress((i+1)/photos.length);
      const sub = $('#overlay-sub'); if (sub) sub.textContent = `Foto ${i+1} de ${photos.length}`;
    }
    return urls;
  }

  // ===== Enviar (online u offline) =====
  async function sendForm(){
    if (!a || !d) return toast('Firebase no disponible.');

    const user = a.currentUser;
    const cjName = ($('#cj-name')?.value || '').trim();
    const turno  = ($('#cj-turno')?.value || '').trim();
    const cat    = $('#sel-cat')?.value || '';
    const mot    = $('#sel-motivo')?.value || '';
    const nov    = $('#sel-nov')?.value || '';
    const det    = $('#sel-detalle')?.value || '';
    const comment= ($('#comentario')?.value || '').trim();

    if (!cjName){ toast('Selecciona un cajero.'); return; }
    if (!turno){ toast('Selecciona el turno.'); return; }
    if (!cat || !mot || !nov){ toast('Completa la clasificación (Categoría, Motivo y Novedad).'); return; }

    const pos = await getCurrentPositionWithFallback();
    lastUserPos = { lat: pos.lat, lng: pos.lng };

    const photoFiles = (PHOTOS||[]).map(p => p.file).filter(Boolean);

    const payloadBase = {
      tipo: 'CAJERO',
      cajero: {
        id: cjName,
        consola:   $('#cj-consola')?.value || '',
        direccion: $('#cj-direccion')?.value || '',
        distrito:  $('#cj-distrito')?.value || '',
        estado:    $('#cj-estado')?.value || '',
        term_id:   $('#cj-termid')?.value || '',
        turbina:   $('#cj-turbina')?.value || '',
        turno
      },
      clasificacion: {
        categoriaId:cat, categoria:($('#sel-cat')?.selectedOptions[0]?.dataset.nombre||''),
        motivoId:mot,   motivo:   ($('#sel-motivo')?.selectedOptions[0]?.dataset.nombre||''),
        novedadId:nov,  novedad:  ($('#sel-nov')?.selectedOptions[0]?.dataset.nombre||''),
        detalleId:det,  detalle:  ($('#sel-detalle')?.selectedOptions[0]?.dataset.nombre||'')
      },
      comentario: comment,
      geo: { usuario: lastUserPos || null, source: pos.source || 'unknown' },
      createdAt: window.firebase?.firestore ? firebase.firestore.FieldValue.serverTimestamp() : null
    };

    // Offline o sin sesión → a la cola
    if (!navigator.onLine || !user){
      try{
        showOverlay('Guardando sin conexión…', 'Se enviará al reconectar');
        const photosStored = [];
        for (const f of photoFiles) photosStored.push(await fileToStorable(f));
        const item = { id: `q_${Date.now()}_${Math.random().toString(36).slice(2)}`, createdAt: Date.now(), payload: payloadBase, photos: photosStored };
        await idbPut(item);
        hideOverlay(); clearPhotos();
        toast('Guardado sin conexión. Se enviará automáticamente al reconectar.');
        window.location.href = 'menu.html';
        return;
      }catch(e){
        hideOverlay(); console.error('Error guardando en cola offline:', e);
        toast('No se pudo guardar en la cola offline.'); return;
      }
    }

    // Online
    try{
      showOverlay('Subiendo fotos…', 'Preparando');
      const urls = await uploadAllPhotosOnline(user.uid, photoFiles);
      const payload = { ...payloadBase, fotos: urls, user: { uid: user.uid, email: user.email || null } };
      showOverlay('Enviando reporte…','Guardando en Firestore'); setProgress(1);
      await d.collection('reportes_cajeros').add(payload);
      hideOverlay(); toast('Reporte enviado correctamente.');
      clearPhotos(); window.location.href = 'menu.html';
    }catch(e){
      hideOverlay();
      console.warn('Fallo envío online, moviendo a cola:', e);
      try{
        showOverlay('Guardando en cola…','Reintentaremos al reconectar');
        const photosStored = [];
        for (const f of photoFiles) photosStored.push(await fileToStorable(f));
        const item = { id: `q_${Date.now()}_${Math.random().toString(36).slice(2)}`, createdAt: Date.now(), payload: payloadBase, photos: photosStored };
        await idbPut(item);
        hideOverlay(); clearPhotos();
        toast('No hay conexión estable. Guardado en cola para reintento.');
        window.location.href = 'menu.html';
      }catch(e2){
        hideOverlay(); console.error('No se pudo guardar en cola:', e2);
        toast('No se pudo enviar ni guardar en cola. Intenta nuevamente.');
      }
    }
  }

  // Eventos de selects
  document.getElementById('sel-cat')?.addEventListener('change', onCategoriaChange);
  document.getElementById('sel-motivo')?.addEventListener('change', onMotivoChange);
  document.getElementById('sel-nov')?.addEventListener('change', onNovedadChange);
})();
