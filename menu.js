/* menu.js — Dashboard v3.13.1
   - KPIs + gráficos + filtros (Turbina + Usuario)
   - Tabla con paginación (10 filas)
   - Exportación EXCEL (.xlsx) con SheetJS
   - Overlay de carga
   - Sidebar fijo (activa .fixed-sidebar en <body>)
*/
(() => {
  const $  = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const normU = t => (t||'').toString().normalize('NFD').replace(/\p{Diacritic}/gu,'').toUpperCase().trim();

  // Activa el layout de sidebar fijo para este dashboard
  document.body.classList.add('fixed-sidebar');

  // ---------- Toast ----------
  const toastHost = document.querySelector('.toast-host') || (() => {
    const n = document.createElement('div');
    n.className = 'toast-host';
    n.setAttribute('aria-live','polite');
    n.setAttribute('aria-atomic','true');
    document.body.appendChild(n);
    return n;
  })();
  function toast({ title='Info', msg='', type='ok', ms=3200 } = {}) {
    const t = document.createElement('div');
    t.className = `toast toast--${type}`;
    t.innerHTML = `
      <div>
        <div class="toast__title">${title}</div>
        <div class="toast__msg">${msg}</div>
      </div>
      <button type="button" class="toast__close" aria-label="Cerrar">✕</button>`;
    toastHost.appendChild(t);
    const close = () => { t.classList.add('out'); setTimeout(()=>t.remove(), 280); };
    t.querySelector('.toast__close')?.addEventListener('click', close);
    const id = setTimeout(close, ms);
    t.addEventListener('pointerenter', ()=>clearTimeout(id), { once:true });
  }

  // ---------- Overlay ----------
  function setProgress(f){
    const el = $('#overlay-progress');
    if (el) el.style.width = `${Math.max(0, Math.min(100, Math.round((f||0)*100)))}%`;
  }
  function showOverlay(msg='Cargando…', sub=''){
    $('#overlay-msg') && ($('#overlay-msg').textContent = msg);
    $('#overlay-sub') && ($('#overlay-sub').textContent = sub || '');
    setProgress(0);
    $('#overlay')?.setAttribute('aria-hidden','false');
  }
  function hideOverlay(){ $('#overlay')?.setAttribute('aria-hidden','true'); }

  // ---------- Chart colors ----------
  const css = getComputedStyle(document.documentElement);
  const CH_GRID  = (css.getPropertyValue('--chart-grid')  || '#e5e7eb').trim();
  const CH_LABEL = (css.getPropertyValue('--chart-label') || '#111111').trim();
  const CSS_COLS = Array.from({length: 8}, (_,i) => (css.getPropertyValue(`--chart-${i+1}`) || '').trim() || '#d62828');
  const getColors = n => Array.from({length:n}, (_,i)=> CSS_COLS[i % CSS_COLS.length]);

  // ---------- Firebase ----------
  const cfg = (typeof window !== 'undefined' && window.firebaseConfig)
           || (typeof firebaseConfig !== 'undefined' ? firebaseConfig : null);

  if (!window.firebase) {
    toast({ title:'Error', msg:'No se cargó Firebase (scripts).', type:'err', ms:5200 });
  }
  if (!cfg) {
    toast({ title:'Error', msg:'No se encontró firebase-config.js.', type:'err', ms:5200 });
  }
  if (window.firebase && cfg && !firebase.apps.length) {
    try { firebase.initializeApp(cfg); } catch (e) { console.error('[Firebase init]', e); }
  }

  const auth = window.firebase?.auth?.() || null;
  const db   = window.firebase?.firestore?.() || null;

  // ---------- UI básica ----------
  $('#y') && ($('#y').textContent = new Date().getFullYear());
  // El botón hamburger ya no colapsa el sidebar
  $('#btnHamb')?.addEventListener('click', (e)=>{ e.preventDefault(); e.stopPropagation(); });

  $('#btnLogout')?.addEventListener('click', async () => {
    if (!auth) return toast({ title:'Error', msg:'Auth no disponible.', type:'err' });
    try {
      await auth.signOut();
      toast({ title:'Sesión cerrada', msg:'Hasta pronto 👋', type:'ok', ms:1600 });
      setTimeout(()=>location.replace('index.html'), 700);
    } catch {
      toast({ title:'Error', msg:'No se pudo cerrar sesión.', type:'err' });
    }
  });

  // ---------- Modal crear ----------
  const openCreate  = () => $('#createModal')?.classList.add('active');
  const closeCreate = () => $('#createModal')?.classList.remove('active');
  $('#nav-create')?.addEventListener('click', openCreate);
  $('#top-create')?.addEventListener('click', openCreate);
  $$('#createModal [data-close]').forEach(b => b.addEventListener('click', closeCreate));

  // ---------- Visor formularios ----------
  const embed = $('#embed');
  const frame = $('#embedFrame');
  function embedOpen(title, url){
    if (!embed || !frame) return;
    $('#embedTitle').textContent = title;
    frame.src = url;
    embed.classList.add('active');
  }
  function embedClose(){
    if (!embed || !frame) return;
    embed.classList.remove('active');
    frame.src = 'about:blank';
  }
  $('#embedBack')?.addEventListener('click', embedClose);
  $('#embedOpenNew')?.addEventListener('click', ()=>{ if (frame?.src && frame.src!=='about:blank') window.open(frame.src, '_blank'); });
  $('#pickOficinas')?.addEventListener('click', () => { closeCreate(); embedOpen('Formulario — Oficinas',  'formularioof.html'); });
  $('#pickCajeros') ?.addEventListener('click', () => { closeCreate(); embedOpen('Formulario — Cajeros', 'formulariocaj.html'); });

  // ---------- Mes/Año ----------
  const selMes  = $('#mes');
  const selAnio = $('#anio');
  const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  function fillMonthYear(){
    if (!selMes || !selAnio) return;
    selMes.innerHTML  = MESES.map((m,i)=>`<option value="${i}">${m}</option>`).join('');
    const Y = new Date().getFullYear();
    selAnio.innerHTML = [Y-1,Y,Y+1].map(y=>`<option value="${y}">${y}</option>`).join('');
    selMes.value = String(new Date().getMonth());
    selAnio.value = String(Y);
  }
  fillMonthYear();

  // ---------- Predictivo LOCAL ----------
  const localInput  = $('#local');
  const predictList = $('#predictList');
  let ALL_IDS = [];
  async function loadPredictiveIDs(){
    if (!db) return;
    try {
      const [caj, ofi] = await Promise.all([
        db.collection('CAJEROS').get(),
        db.collection('OFICINAS').get()
      ]);
      ALL_IDS = [
        ...caj.docs.map(d => d.id),
        ...ofi.docs.map(d => d.id)
      ].sort((a,b)=>a.localeCompare(b,'es',{sensitivity:'base'}));
    } catch (e) { console.warn('[Predictivo]', e); }
  }
  function renderPredict(items){
    if (!predictList) return;
    if (!items.length){ predictList.classList.remove('show'); predictList.innerHTML=''; return; }
    predictList.innerHTML = items.slice(0,60).map(id=>`<button type="button" data-id="${id}">${id}</button>`).join('');
    predictList.classList.add('show');
  }
  localInput?.addEventListener('input', ()=>{
    const q = normU(localInput.value||'');
    if (!q) return renderPredict([]);
    const out = ALL_IDS.filter(id => normU(id).includes(q));
    renderPredict(out);
  });
  document.addEventListener('click', e => {
    if (predictList && !predictList.contains(e.target) && e.target !== localInput) predictList.classList.remove('show');
  });
  predictList?.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    localInput.value = b.dataset.id;
    predictList.classList.remove('show');
  });
  localInput?.addEventListener('keydown', e => { if (e.key === 'Enter') $('#btnBuscar')?.click(); });

  // ---------- Usuario (nuevo filtro) ----------
  const userInput = $('#f-usuario');
  const userDatalist = $('#dlUsuarios');
  userInput?.addEventListener('keydown', e => { if (e.key === 'Enter') $('#btnBuscar')?.click(); });

  // ---------- Charts ----------
  try {
    if (window.Chart && Chart.defaults) {
      Chart.defaults.maintainAspectRatio = false;
      Chart.defaults.responsive = true;
      Chart.defaults.resizeDelay = 180;
      Chart.defaults.color = CH_LABEL;
      Chart.defaults.borderColor = CH_GRID;
      Chart.defaults.font.family = getComputedStyle(document.body).fontFamily || 'ui-sans-serif, system-ui';
    }
    if (window.Chart && window.ChartDataLabels && Chart.register) {
      Chart.register(window.ChartDataLabels);
    }
  } catch (e) { console.warn('Chart setup', e); }

  let barChart, donutChart;
  function initCharts(){
    const barCtx   = $('#barChart')?.getContext?.('2d');
    const donutCtx = $('#donutChart')?.getContext?.('2d');
    if (!window.Chart || !barCtx || !donutCtx) return;

    barChart = new Chart(barCtx, {
      type:'bar',
      data:{ labels:[], datasets:[{ label:'Visitas', data:[], borderRadius:6 }]},
      options:{
        responsive:true, maintainAspectRatio:false,
        scales:{ y:{ beginAtZero:true, grid:{ color:CH_GRID }}, x:{ grid:{ display:false }}},
        plugins:{
          legend:{ labels:{ color:CH_LABEL } },
          tooltip:{ callbacks:{ label:(ctx)=>{
            const v = ctx.parsed.y ?? ctx.raw ?? 0;
            const sum = ctx.dataset.data.reduce((a,b)=>a+(+b||0),0)||1;
            const p = Math.round(v*100/sum);
            return `${v} (${p}%)`;
          }}},
          datalabels:{
            color:CH_LABEL, anchor:'end', align:'top', font:{weight:'bold'},
            formatter:(v,ctx)=>{
              const sum = ctx.dataset.data.reduce((a,b)=>a+(+b||0),0)||1;
              const p = Math.round(v*100/sum); return `${v} (${p}%)`;
            }
          }
        }
      }
    });

    donutChart = new Chart(donutCtx, {
      type:'doughnut',
      data:{ labels:[], datasets:[{ data:[], borderWidth:1 }]},
      options:{
        responsive:true, maintainAspectRatio:false,
        cutout:'58%',
        plugins:{
          legend:{ position:'bottom', labels:{ color:CH_LABEL } },
          tooltip:{ callbacks:{ label:(ctx)=>{
            const v = ctx.parsed ?? ctx.raw ?? 0;
            const sum = ctx.dataset.data.reduce((a,b)=>a+(+b||0),0)||1;
            const p = Math.round(v*100/sum); return `${ctx.label}: ${v} (${p}%)`;
          }}},
          datalabels:{
            color:'#111', backgroundColor:'#fff', borderColor:'#eee', borderWidth:1,
            borderRadius:6, padding:6,
            formatter:(v,ctx)=>{
              const sum = ctx.chart.data.datasets[0].data.reduce((a,b)=>a+(+b||0),0)||1;
              const p = Math.round(v*100/sum); return `${v} • ${p}%`;
            }
          }
        }
      }
    });
  }
  initCharts();

  // ---------- Datos (helpers) ----------
  const FALLBACK_MS = new Date('2025-09-30T23:59:59-05:00').getTime();
  const toMs = v => (v && typeof v.toMillis==='function') ? v.toMillis()
                  : (v && typeof v.seconds==='number') ? v.seconds*1000
                  : FALLBACK_MS;

  const getId = r => r?.oficina?.id || r?.cajero?.id || r?.id || '—';
  const getTurbina = r =>
    (r?.oficina?.turbina || r?.cajero?.turbina || r?.turbina || r?.oficina?.TURBINA || r?.cajero?.TURBINA || '').toString();
  const getConsola = r =>
    (r?.oficina?.consola || r?.cajero?.consola || r?.consola || r?.oficina?.CONSOLA || r?.cajero?.CONSOLA || '').toString();
  const getSiteOrTerm = r => r?.oficina?.site ?? r?.cajero?.term_id ?? '';
  const countBy = arr => arr.reduce((m,k)=>(m[k]=(m[k]||0)+1,m),{});

  // ---------- Tabla + Paginación ----------
  const PAGE_SIZE = 10;
  const gridTable = $('#grid');
  const tbody = gridTable?.querySelector('tbody');
  const gridCount = $('#gridCount');
  const pgInfo = $('#pgInfo');
  const btnFirst = $('#pgFirst');
  const btnPrev  = $('#pgPrev');
  const btnNext  = $('#pgNext');
  const btnLast  = $('#pgLast');

  let TABLE_MAPPED = [];
  let CURRENT_PAGE = 1;

  function esc(s){ return (s==null?'':String(s)).replace(/[&<>"]/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[m])); }
  const totalPages = () => Math.max(1, Math.ceil(TABLE_MAPPED.length / PAGE_SIZE));

  function mapRowForTable(r, fuente){
    const ms = toMs(r.createdAt);
    const fecha = isFinite(ms) ? new Date(ms).toLocaleString('es-PE', { dateStyle:'short', timeStyle:'short' }) : '';
    const clas = r?.clasificacion || {};
    return {
      fecha,
      tipo: fuente==='reportes_oficinas' ? 'OFICINA' : 'CAJERO',
      id: getId(r),
      consola: getConsola(r),
      turbina: getTurbina(r),
      site_term: getSiteOrTerm(r),
      distrito: r?.oficina?.distrito ?? r?.cajero?.distrito ?? '',
      direccion: r?.oficina?.direccion ?? r?.cajero?.direccion ?? '',
      turno: r?.oficina?.turno ?? r?.cajero?.turno ?? r?.turno ?? '',
      categoria: clas.categoria || clas.categoriaId || '',
      motivo:    clas.motivo    || clas.motivoId    || '',
      novedad:   clas.novedad   || clas.novedadId   || '',
      detalle:   clas.detalle   || clas.detalleId   || '',
      comentario: r?.comentario || '',
      usuario: r?.user?.email || ''
    };
  }

  function drawPage(){
    const total = TABLE_MAPPED.length;
    const pages = totalPages();
    CURRENT_PAGE = Math.min(Math.max(1, CURRENT_PAGE), pages);

    const startIdx = (CURRENT_PAGE - 1) * PAGE_SIZE;
    const endIdx   = Math.min(total, startIdx + PAGE_SIZE);
    const slice = TABLE_MAPPED.slice(startIdx, endIdx);

    if (tbody) {
      tbody.innerHTML = slice.length ? slice.map(o=>`
        <tr>
          <td>${esc(o.fecha)}</td>
          <td>${esc(o.tipo)}</td>
          <td>${esc(o.id)}</td>
          <td>${esc(o.consola)}</td>
          <td>${esc(o.turbina)}</td>
          <td>${esc(o.site_term)}</td>
          <td>${esc(o.distrito)}</td>
          <td>${esc(o.direccion)}</td>
          <td>${esc(o.turno)}</td>
          <td>${esc(o.categoria)}</td>
          <td>${esc(o.motivo)}</td>
          <td>${esc(o.novedad)}</td>
          <td>${esc(o.detalle)}</td>
          <td>${esc(o.comentario)}</td>
          <td>${esc(o.usuario)}</td>
        </tr>`).join('')
        : `<tr><td colspan="15" class="muted">Sin resultados para los filtros seleccionados.</td></tr>`;
    }

    gridCount && (gridCount.textContent = `${total} resultado${total===1?'':'s'}`);
    const from = total ? startIdx + 1 : 0;
    const to   = total ? endIdx : 0;
    pgInfo && (pgInfo.textContent = `${from}–${to} de ${total}`);

    const atFirst = CURRENT_PAGE === 1;
    const atLast  = CURRENT_PAGE === pages;
    [btnFirst, btnPrev].forEach(b => b && (b.disabled = atFirst));
    [btnNext, btnLast].forEach(b => b && (b.disabled = atLast));
  }

  function updateTable(rows, fuente){
    TABLE_MAPPED = rows.map(r => mapRowForTable(r, fuente));
    CURRENT_PAGE = 1;
    drawPage();
  }

  // Paginación
  btnFirst?.addEventListener('click', ()=>{ CURRENT_PAGE = 1; drawPage(); });
  btnPrev ?.addEventListener('click', ()=>{ CURRENT_PAGE = Math.max(1, CURRENT_PAGE-1); drawPage(); });
  btnNext ?.addEventListener('click', ()=>{ CURRENT_PAGE = Math.min(totalPages(), CURRENT_PAGE+1); drawPage(); });
  btnLast ?.addEventListener('click', ()=>{ CURRENT_PAGE = totalPages(); drawPage(); });

  // Exportar EXCEL
  function exportToExcel(){
    if (!TABLE_MAPPED.length){
      toast({ title:'Exportar', msg:'No hay datos para exportar.', type:'warn' });
      return;
    }
    if (typeof XLSX === 'undefined' || !XLSX?.utils){
      toast({ title:'Exportar', msg:'Biblioteca XLSX no cargó. Revisa el <script> de SheetJS.', type:'err' });
      return;
    }
    const headers = ['Fecha','Tipo','Local (id)','Consola','Turbina','SITE/TERM','Distrito','Dirección','Turno','Categoría','Motivo','Novedad','Detalle','Comentario','Usuario'];
    const keys    = ['fecha','tipo','id','consola','turbina','site_term','distrito','direccion','turno','categoria','motivo','novedad','detalle','comentario','usuario'];

    const aoa = [headers];
    TABLE_MAPPED.forEach(r => aoa.push(keys.map(k => r[k] ?? '')));

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    XLSX.utils.book_append_sheet(wb, ws, 'Datos');

    const m = +($('#mes')?.value ?? new Date().getMonth());
    const y = +($('#anio')?.value ?? new Date().getFullYear());
    const fuente = $('#fuente')?.value || 'reportes';

    const wbout = XLSX.write(wb, { bookType:'xlsx', type:'array' });
    const blob = new Blob([wbout], { type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${fuente}_${y}-${String(m+1).padStart(2,'0')}.xlsx`;
    document.body.appendChild(a);
    a.click();
    setTimeout(()=>{ URL.revokeObjectURL(url); a.remove(); }, 0);
  }
  $('#btnExport')?.addEventListener('click', exportToExcel);

  // ---------- Consulta + render ----------
  async function queryData(){
    if (!db){ toast({ title:'Aviso', msg:'Firestore no disponible.', type:'warn' }); return; }

    const fuente = $('#fuente')?.value || 'reportes_cajeros';
    const m = +($('#mes')?.value ?? new Date().getMonth());
    const y = +($('#anio')?.value ?? new Date().getFullYear());
    const idFilter   = (localInput?.value || '').trim();
    const turFilter  = ($('#f-turbina')?.value || '').trim();
    const userFilter = (userInput?.value || '').trim();

    showOverlay('Cargando datos…', `Fuente: ${fuente}`); setProgress(0.1);

    const start = new Date(y, m,   1, 0,0,0,0).getTime();
    const end   = new Date(y, m+1, 1, 0,0,0,0).getTime();

    let snap;
    try { snap = await db.collection(fuente).get(); }
    catch (e) { console.error(e); hideOverlay(); toast({ title:'Error', msg:'No se pudo leer Firestore.', type:'err' }); return; }

    setProgress(0.35);

    let rows = snap.docs.map(d => ({ id:d.id, ...d.data() }));
    const existNoDate = rows.some(r => !r.createdAt);

    rows = rows.map(r => ({ ...r, _ms: toMs(r.createdAt) }))
               .filter(r => r._ms >= start && r._ms < end);

    setProgress(0.55);

    if (idFilter) {
      const q = normU(idFilter);
      rows = rows.filter(r => normU(getId(r)).includes(q));
    }

    if (turFilter) {
      const isConsTorre = normU(turFilter) === 'CONSOLA TORRE';
      rows = rows.filter(r => {
        const t  = normU(getTurbina(r));
        const cs = normU(getConsola(r));
        return isConsTorre ? (cs === 'CONSOLA TORRE') : (t === normU(turFilter));
      });
    }

    if (userFilter) {
      const qU = normU(userFilter);
      rows = rows.filter(r => normU(r?.user?.email || '').includes(qU));
    }

    // Sugerencias de usuario (opciones del datalist)
    if (userDatalist) {
      const emails = [...new Set(rows.map(r => (r?.user?.email || '').trim()).filter(Boolean))]
        .sort((a,b)=>a.localeCompare(b));
      userDatalist.innerHTML = emails.map(e => `<option value="${e}"></option>`).join('');
    }

    setProgress(0.7);

    // KPIs
    const localeSet = new Set(rows.map(getId));
    const mm = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

    $('#kpiLocales')    && ($('#kpiLocales').textContent    = localeSet.size);
    $('#kpiLocalesSub') && ($('#kpiLocalesSub').textContent = `${mm[m]} ${y} · ${fuente}`);
    $('#kpiVisitas')    && ($('#kpiVisitas').textContent    = rows.length);
    $('#kpiVisitasSub') && ($('#kpiVisitasSub').textContent = 'registros del mes');

    const turLabel = r => {
      const cs = normU(getConsola(r));
      if (cs === 'CONSOLA TORRE') return 'CONSOLA TORRE';
      return getTurbina(r) || '—';
    };
    const byTur = Object.entries(countBy(rows.map(turLabel))).sort((a,b)=>b[1]-a[1]);

    $('#kpiTurbinas')    && ($('#kpiTurbinas').textContent    = byTur.filter(([k])=>k!=='—').length);
    $('#kpiTurbinasSub') && ($('#kpiTurbinasSub').textContent = 'turbinas con visitas');
    $('#kpiTopTurbina')  && ($('#kpiTopTurbina').textContent  = byTur[0]?.[1] || 0);
    $('#kpiTopTurbinaSub') && ($('#kpiTopTurbinaSub').textContent = byTur[0] ? `Top: ${byTur[0][0]}` : 'sin datos');

    if (barChart){
      barChart.data.labels = byTur.map(x=>x[0]);
      barChart.data.datasets[0].data = byTur.map(x=>x[1]);
      barChart.data.datasets[0].backgroundColor = getColors(barChart.data.labels.length);
      barChart.update();
    }

    const byId = Object.entries(countBy(rows.map(getId))).sort((a,b)=>b[1]-a[1]).slice(0,8);
    if (donutChart){
      donutChart.data.labels = byId.map(x=>x[0]);
      donutChart.data.datasets[0].data = byId.map(x=>x[1]);
      donutChart.data.datasets[0].backgroundColor = getColors(donutChart.data.labels.length);
      donutChart.update();
    }

    if (existNoDate && m === 8 && y === 2025) {
      toast({ title:'Incluyendo sin fecha', msg:'Se considerarán como 30/09/2025 (solo Sep-2025).', type:'ok', ms:4200 });
    }

    // Tabla
    updateTable(rows, fuente);

    setProgress(1); hideOverlay();
  }

  // ---------- Eventos ----------
  $('#btnBuscar')?.addEventListener('click', queryData);
  $('#btnLimpiar')?.addEventListener('click', ()=>{
    $('#fuente').value = 'reportes_cajeros';
    fillMonthYear();
    $('#local').value = '';
    $('#f-turbina') && ($('#f-turbina').value = '');
    $('#f-usuario') && ($('#f-usuario').value = '');
    if (userDatalist) userDatalist.innerHTML = '';
    CURRENT_PAGE = 1;
    queryData();
  });
  $('#fuente')?.addEventListener('change', ()=>{ CURRENT_PAGE = 1; queryData(); });
  $('#f-turbina')?.addEventListener('change', ()=>{ CURRENT_PAGE = 1; queryData(); });
  $('#f-usuario')?.addEventListener('change', ()=>{ CURRENT_PAGE = 1; queryData(); });

  // ---------- Arranque ----------
  if (auth) {
    auth.onAuthStateChanged(u => {
      if (!u) { location.replace('index.html'); return; }
      loadPredictiveIDs();
      queryData();
    });
  } else {
    loadPredictiveIDs();
    queryData();
  }
})();
