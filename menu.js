/* menu.js — Dashboard v3.31.0 (UI mejorada + mobile + colores fijos en barras)
   - Barras con colores potentes (gradiente + sombra) y PALETA FIJA
   - “Top locales” en PIE con 3D sutil y menos ruido visual
   - Líneas con paleta definida para mejor lectura
   - Radar por Consola con efecto “3D” (glow + relleno suave)
   - Arreglado mapa de calor (GPS) -> usa #heatMap
   - Ajustes responsive (fuentes/etiquetas) para móviles
*/
(() => {
  const $  = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const norm  = t => (t??'').toString().trim();
  const normU = t => norm(t).normalize('NFD').replace(/\p{Diacritic}/gu,'').toUpperCase();

  document.body.classList.add('fixed-sidebar');

  // ===== Estilos globales (tamaños de fuente mayores + responsive) =====
  (function injectUXStyles(){
    const css = `
      :root{
        --ui-font-size: 17px;
        --ui-font-size-lg: 18px;
        --ui-kpi-value: 44px;
        --ui-kpi-sub: 13px;
      }
      body{ font-size: var(--ui-font-size); }
      .filters .field label{ font-size: 14px; }
      .filters input,.filters select,.filters .btn{ font-size: var(--ui-font-size-lg); line-height:1.15; }
      .kpi .kpi__value{ font-size: var(--ui-kpi-value); }
      .kpi .kpi__sub{ font-size: var(--ui-kpi-sub); }
      .topbar__title{ font-size: 26px; }
      .menu__item span{ font-size: 15px; }

      /* Mobile */
      @media (max-width: 820px){
        .kpi .kpi__value{ font-size: 36px; }
        .topbar__title{ font-size: 22px; }
      }
    `;
    const tag = document.createElement('style');
    tag.id = 'ux-upgrades';
    tag.textContent = css;
    document.head.appendChild(tag);
  })();

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
  function hideOverlay(){
    $('#overlay')?.setAttribute('aria-hidden','true');
    setTimeout(()=>{ if (map) map.invalidateSize(); }, 250);
  }

  // ---------- Paletas ----------
  const cssVars  = getComputedStyle(document.documentElement);
  const CH_GRID  = (cssVars.getPropertyValue('--chart-grid')  || '#e5e7eb').trim();
  const CH_LABEL = (cssVars.getPropertyValue('--chart-label') || '#111111').trim();
  const CSS_COLS = Array.from({length: 8}, (_,i) =>
    (cssVars.getPropertyValue(`--chart-${i+1}`) || '').trim()
      || ['#e11d48','#f59e0b','#2563eb','#10b981','#7c3aed','#0ea5e9','#f97316','#14b8a6'][i]
  );
  const getColors = n => Array.from({length:n}, (_,i)=> CSS_COLS[i % CSS_COLS.length]);
  const fmtInt = v => (v==null ? '' : String(Math.round(+v||0)));

  // PALETA FIJA para BARRAS (pedido del usuario)
  const FIX = {
    BAR_MAIN:   '#d62828', // rojo marca
    BAR_CMP:    '#6b7280', // gris para “Comparado”
    BAR_ALT:    '#2563eb', // azul secundario
    BAR_OK:     '#10b981', // verde (coberturas, etc.)
    BAR_WARM:   '#f59e0b'  // ámbar
  };

  // ---------- Firebase ----------
  const cfg = (typeof window !== 'undefined' && window.firebaseConfig)
           || (typeof firebaseConfig !== 'undefined' ? firebaseConfig : null);
  if (!window.firebase) toast({ title:'Error', msg:'No se cargó Firebase (scripts).', type:'err', ms:5200 });
  if (!cfg)            toast({ title:'Error', msg:'No se encontró firebase-config.js.', type:'err', ms:5200 });
  if (window.firebase && cfg && !firebase.apps.length) {
    try { firebase.initializeApp(cfg); } catch (e) { console.error('[Firebase init]', e); }
  }
  const auth = window.firebase?.auth?.() || null;
  const db   = window.firebase?.firestore?.() || null;

  // ---------- UI ----------
  $('#y') && ($('#y').textContent = new Date().getFullYear());
  $('#btnHamb')?.addEventListener('click', (e)=>{ e.preventDefault(); e.stopPropagation(); });
  $('#btnLogout')?.addEventListener('click', async () => {
    if (!auth) return toast({ title:'Error', msg:'Auth no disponible.', type:'err' });
    try { await auth.signOut(); toast({ title:'Sesión cerrada', msg:'Hasta pronto 👋', type:'ok', ms:1600 }); setTimeout(()=>location.replace('index.html'), 700); }
    catch { toast({ title:'Error', msg:'No se pudo cerrar sesión.', type:'err' }); }
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
    setTimeout(()=>{ if (map) map.invalidateSize(); }, 150);
  }
  function embedClose(){ if (!embed || !frame) return; embed.classList.remove('active'); frame.src = 'about:blank'; setTimeout(()=>{ if (map) map.invalidateSize(); }, 150); }
  $('#embedBack')?.addEventListener('click', embedClose);
  $('#embedOpenNew')?.addEventListener('click', ()=>{ if (frame?.src && frame.src!=='about:blank') window.open(frame.src, '_blank'); });
  $('#pickOficinas')?.addEventListener('click', () => { closeCreate(); embedOpen('Formulario — Oficinas',  'formularioof.html'); });
  $('#pickCajeros') ?.addEventListener('click', () => { closeCreate(); embedOpen('Formulario — Cajeros', 'formulariocaj.html'); });

  // ---------- Mes/Año + Comparador ----------
  const selMes  = $('#mes'); const selAnio = $('#anio');
  const selCmpM = $('#cmpMes'); const selCmpY = $('#cmpAnio'); const cmpEnabled = $('#cmpEnabled');
  const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  function fillMonthYear(){
    if (selMes && selAnio){
      selMes.innerHTML  = MESES.map((m,i)=>`<option value="${i}">${m}</option>`).join('');
      const Y = new Date().getFullYear();
      selAnio.innerHTML = [Y-1,Y,Y+1].map(y=>`<option value="${y}">${y}</option>`).join('');
      selMes.value = String(new Date().getMonth()); selAnio.value = String(Y);
    }
    if (selCmpM && selCmpY){
      selCmpM.innerHTML  = MESES.map((m,i)=>`<option value="${i}">${m}</option>`).join('');
      const Y = new Date().getFullYear();
      selCmpY.innerHTML = [Y-1,Y,Y+1].map(y=>`<option value="${y}">${y}</option>`).join('');
      selCmpM.value = String(Math.max(0, new Date().getMonth()-1)); selCmpY.value = String(new Date().getFullYear());
    }
  }
  fillMonthYear();

  // ---------- Predictivo LOCAL ----------
  const localInput  = $('#local');
  const predictList = $('#predictList');
  let ALL_IDS = [];
  async function loadPredictiveIDs(){
    if (!db) return;
    try {
      const [caj, ofi] = await Promise.all([ db.collection('CAJEROS').get(), db.collection('OFICINAS').get() ]);
      ALL_IDS = [...caj.docs.map(d => d.id), ...ofi.docs.map(d => d.id)]
        .sort((a,b)=>a.localeCompare(b,'es',{sensitivity:'base'}));
    } catch (e) { console.warn('[Predictivo]', e); }
  }
  function renderPredict(items){
    if (!predictList) return;
    if (!items.length){ predictList.classList.remove('show'); predictList.innerHTML=''; return; }
    predictList.innerHTML = items.slice(0,60).map(id=>`<button type="button" data-id="${id}">${id}</button>`).join('');
    predictList.classList.add('show');
  }
  localInput?.addEventListener('input', ()=>{
    const q = normU(localInput.value||''); if (!q) return renderPredict([]);
    renderPredict(ALL_IDS.filter(id => normU(id).includes(q)));
  });
  document.addEventListener('click', e => {
    if (predictList && !predictList.contains(e.target) && e.target !== localInput) predictList.classList.remove('show');
  });
  predictList?.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; localInput.value = b.dataset.id; predictList.classList.remove('show'); });
  localInput?.addEventListener('keydown', e => { if (e.key === 'Enter') $('#btnBuscar')?.click(); });

  // ---------- Usuario múltiple ----------
  const userInput = $('#f-usuario');
  const userDatalist = $('#dlUsuarios');
  userInput?.addEventListener('keydown', e => { if (e.key === 'Enter') $('#btnBuscar')?.click(); });

  // ---------- Chart.js defaults + plugins ----------
  let ChartOK = false;
  try {
    if (window.Chart && Chart.defaults) {
      Chart.defaults.maintainAspectRatio = false;
      Chart.defaults.responsive = true;
      Chart.defaults.resizeDelay = 160;
      Chart.defaults.color = CH_LABEL;
      Chart.defaults.borderColor = CH_GRID;
      Chart.defaults.font.family = getComputedStyle(document.body).fontFamily || 'ui-sans-serif, system-ui';
      Chart.defaults.font.size = 16; // más grande
      Chart.defaults.plugins.legend.labels.font = { size: 15 };
      Chart.defaults.plugins.tooltip.titleFont = { size: 16 };
      Chart.defaults.plugins.tooltip.bodyFont  = { size: 15 };
      ChartOK = true;
    }
    if (window.Chart && window.ChartDataLabels && Chart.register) {
      Chart.register(window.ChartDataLabels);
    }
  } catch (e) { console.warn('Chart setup', e); }

  // Responsive tweak para fuentes
  const chartsAll = [];
  function pushChart(c){ if (c) chartsAll.push(c); }
  function applyResponsiveChartFonts(){
    const w = window.innerWidth || 1200;
    const base = w < 740 ? 12 : (w < 980 ? 14 : 16);
    const leg  = base;
    Chart.defaults.font.size = base;
    Chart.defaults.plugins.legend.labels.font.size = leg;
    chartsAll.forEach(c=>{
      if (c.options?.plugins?.legend?.labels?.font) c.options.plugins.legend.labels.font.size = leg;
      if (c.options?.plugins?.tooltip){ c.options.plugins.tooltip.titleFont.size = base+1; c.options.plugins.tooltip.bodyFont.size = base; }
      c.update('none');
    });
  }
  window.addEventListener('resize', () => { applyResponsiveChartFonts(); });

  // Sombra suave para barras
  const BarGlow = {
    id: 'barGlow',
    beforeDatasetDraw(chart, args, opts){
      if (chart.config.type !== 'bar') return;
      const ctx = chart.ctx; ctx.save();
      ctx.shadowColor = opts?.color || 'rgba(0,0,0,.18)';
      ctx.shadowBlur  = opts?.blur  || 14;
      ctx.shadowOffsetY = opts?.offsetY ?? 6;
    },
    afterDatasetDraw(chart){ chart.ctx.restore(); }
  };

  // Donut 3D (doughnut)
  const Donut3D = {
    id: 'donut3d',
    afterDatasetDraw(chart, args){
      if (chart.config.type !== 'doughnut') return;
      const meta = chart.getDatasetMeta(args.index); if (!meta) return;
      const { ctx } = chart; ctx.save();
      meta.data.forEach((arc) => {
        const {x, y, outerRadius, innerRadius, startAngle, endAngle} =
          arc.getProps(['x','y','outerRadius','innerRadius','startAngle','endAngle'], true);
        const g1 = ctx.createRadialGradient(x, y+outerRadius*0.25, innerRadius*0.9, x, y+outerRadius*0.25, outerRadius*1.02);
        g1.addColorStop(0, 'rgba(0,0,0,0)'); g1.addColorStop(1, 'rgba(0,0,0,0.18)');
        ctx.beginPath(); ctx.arc(x,y,outerRadius,startAngle,endAngle); ctx.arc(x,y,innerRadius,endAngle,startAngle,true); ctx.closePath();
        ctx.fillStyle = g1; ctx.fill();
        const g2 = ctx.createRadialGradient(x, y-outerRadius*0.45, innerRadius*0.7, x, y-outerRadius*0.45, outerRadius*1.05);
        g2.addColorStop(0, 'rgba(255,255,255,0.22)'); g2.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g2; ctx.fill();
      });
      ctx.restore();
    }
  };

  // PIE 3D sutil (Top locales)
  const Pie3D = {
    id: 'pie3d',
    afterDatasetDraw(chart, args){
      if (chart.config.type !== 'pie') return;
      const meta = chart.getDatasetMeta(args.index); if (!meta) return;
      const { ctx } = chart; ctx.save();
      const depth = 14;
      meta.data.forEach((arc) => {
        const {x, y, startAngle, endAngle, outerRadius} = arc.getProps(['x','y','startAngle','endAngle','outerRadius'], true);
        ctx.beginPath(); ctx.moveTo(x, y + depth);
        ctx.arc(x, y + depth, outerRadius, startAngle, endAngle);
        ctx.arc(x, y,        outerRadius, endAngle, startAngle, true);
        ctx.closePath(); ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fill();
        const g = ctx.createRadialGradient(x, y - outerRadius*0.45, 0, x, y - outerRadius*0.45, outerRadius*1.02);
        g.addColorStop(0, 'rgba(255,255,255,0.22)'); g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, outerRadius, startAngle, endAngle); ctx.closePath(); ctx.fill();
      });
      ctx.restore();
    }
  };

  // Radar “3D-ish”: sombra + relleno translúcido
  const RadarGlow = {
    id: 'radarGlow',
    beforeDatasetDraw(chart, args){
      if (chart.config.type !== 'radar') return;
      const ctx = chart.ctx; ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,.22)';
      ctx.shadowBlur  = 10;
      ctx.shadowOffsetY = 3;
    },
    afterDatasetDraw(chart){ if (chart.config.type==='radar') chart.ctx.restore(); }
  };

  if (ChartOK && Chart.register){ Chart.register(BarGlow, Donut3D, Pie3D, RadarGlow); }

  // Helpers datalabels (tamaños mayores)
  const DL_TOP    = { color:CH_LABEL, anchor:'end', align:'top', font:{weight:'bold', size: 15}, formatter:(v)=>fmtInt(v) };
  const DL_INSIDE = { color:'#111', backgroundColor:'#fff', borderColor:'#eee', borderWidth:1, borderRadius:6, padding:6, font:{ size: 14, weight:'bold' }, formatter:(v)=>fmtInt(v) };

  let barChart, donutChart, motoDailyChart, motorizadoChart, motorizadoDailyChart, weeklyRankingChart, coverageChart,
      coverageGlobalChart, heatmapChart, districtStackedChart, trendChart, paretoMotivoChart, treemapCatMotivo,
      hourHistogramChart, radarConsolaChart, topUsersChart;

  // Leaflet map / heat
  let map, heatLayer;
  async function ensureLeafletHeat(){
    if (!window.L) return false;
    if (L.heatLayer) return true;
    try {
      await new Promise(res=>{
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/leaflet.heat@0.2.0/dist/leaflet-heat.min.js';
        s.onload = res; s.onerror = res; document.head.appendChild(s);
      });
    } catch {}
    return !!L.heatLayer;
  }

  function initCharts(){
    const barCtx   = $('#barChart')?.getContext?.('2d');
    const donutCtx = $('#donutChart')?.getContext?.('2d');
    const motoCtx  = $('#motoSaveDailyChart')?.getContext?.('2d');
    const motzCtx  = $('#motorizadoChart')?.getContext?.('2d');
    const motzDay  = $('#motorizadoDailyChart')?.getContext?.('2d');
    const rankCtx  = $('#weeklyRankingChart')?.getContext?.('2d');
    const covCtx   = $('#coverageChart')?.getContext?.('2d');
    const covGCtx  = $('#coverageGlobalChart')?.getContext?.('2d');
    const hmapCtx  = $('#heatmapChart')?.getContext?.('2d');
    const distCtx  = $('#districtStackedChart')?.getContext?.('2d');
    const trndCtx  = $('#trendChart')?.getContext?.('2d');
    const parCtx   = $('#paretoMotivoChart')?.getContext?.('2d');
    const treeCtx  = $('#treemapCatMotivo')?.getContext?.('2d');
    const hourCtx  = $('#hourHistogramChart')?.getContext?.('2d');
    const radarCtx = $('#radarConsolaChart')?.getContext?.('2d');
    const userCtx  = $('#topUsersChart')?.getContext?.('2d');

    // gradiente vertical para barras
    const mkGrad = (ctx, col) => {
      const color = col || '#d62828';
      const g = ctx.createLinearGradient(0, 0, 0, ctx.canvas.height || 260);
      g.addColorStop(0, color);
      g.addColorStop(1, 'rgba(0,0,0,0.06)');
      return g;
    };

    // ===== Barras: Visitas por turbina (PALETA FIJA)
    if (barCtx) {
      barChart = new Chart(barCtx, {
        type:'bar',
        data:{ labels:[], datasets:[
          { label:'Visitas',   data:[], borderRadius:12, borderSkipped:false },
          { label:'Comparado', data:[], borderRadius:12, borderSkipped:false }
        ]},
        options:{
          responsive:true, maintainAspectRatio:false,
          interaction:{ mode:'nearest', intersect:true },
          scales:{ y:{ beginAtZero:true, grid:{ color:CH_GRID }, ticks:{ font:{ size:13 } } },
                  x:{ grid:{ display:false }, ticks:{ font:{ size:13 } } } },
          plugins:{ legend:{ labels:{ color:CH_LABEL, font:{ size:14 } } },
                    tooltip:{ bodyFont:{ size:14 }, titleFont:{ size:15 } },
                    datalabels: DL_TOP, barGlow:{} },
          onClick: (_, els) => { const e = els?.[0]; if (!e) return; const label = barChart.data.labels[e.index]; setTurbinaFilter([label]); queryData(); }
        },
        plugins:[{
          id:'barGradDataset',
          beforeDatasetsDraw(c){
            const ctx = c.ctx;
            if (c.data?.datasets?.[0]) {
              c.data.datasets[0].backgroundColor = mkGrad(ctx, FIX.BAR_MAIN);
              c.data.datasets[0].borderColor = FIX.BAR_MAIN;
            }
            if (c.data?.datasets?.[1]) {
              c.data.datasets[1].backgroundColor = mkGrad(ctx, FIX.BAR_CMP);
              c.data.datasets[1].borderColor = FIX.BAR_CMP;
            }
          }
        }]
      });
      pushChart(barChart);
    }

    // ===== Top locales: PIE con 3D sutil
    if (donutCtx) {
      donutChart = new Chart(donutCtx, {
        type:'pie',
        data:{ labels:[], datasets:[ { label:'Locales', data:[], borderWidth:1, backgroundColor:[] } ]},
        options:{
          responsive:true, maintainAspectRatio:false,
          plugins:{
            legend:{ position:'bottom', labels:{ color:CH_LABEL, font:{ size:15 } } },
            tooltip:{ bodyFont:{ size:15 }, titleFont:{ size:16 } },
            datalabels:{
              color:CH_LABEL, anchor:'end', align:'end', offset:8,
              backgroundColor:'#fff', borderColor:'#e5e7eb', borderWidth:1, borderRadius:8, padding:6,
              font:{ size:15, weight:'bold' },
              formatter:(v,ctx)=>{
                const ds = ctx.chart.data.datasets[0]?.data||[];
                const total = ds.reduce((a,b)=>a+(+b||0),0) || 1;
                const pct = Math.round((v*100)/total);
                if (pct < 4) return '';
                return `${ctx.chart.data.labels[ctx.dataIndex]}: ${fmtInt(v)} • ${pct}%`;
              }
            },
            pie3d:{}
          },
          onClick: (_, els) => { const e = els?.[0]; if (!e) return; const id = donutChart.data.labels[e.index]; $('#local').value = id; queryData(); }
        }
      });
      pushChart(donutChart);
    }

    // ===== Moto Save (líneas)
    if (motoCtx) {
      const cols = getColors(2);
      motoDailyChart = new Chart(motoCtx, {
        type:'line',
        data:{ labels:[], datasets:[
          { label:'Alto_Riesgo', data:[], tension:.3, pointRadius:3, borderWidth:2, fill:false,
            borderColor: cols[0], pointBackgroundColor: cols[0] },
          { label:'Sin Alto Riesgo', data:[], tension:.3, pointRadius:3, borderWidth:2, fill:false,
            borderColor: cols[1], pointBackgroundColor: cols[1] }
        ]},
        options:{ responsive:true, maintainAspectRatio:false,
          scales:{ y:{ beginAtZero:true, ticks:{ font:{ size:14 } } }, x:{ grid:{ display:false }, ticks:{ font:{ size:14 } } } },
          plugins:{ legend:{ labels:{ color:CH_LABEL, font:{ size:15 } } }, datalabels: DL_TOP } }
      });
      pushChart(motoDailyChart);
    }

    // ===== Motorizado (barras) — PALETA FIJA
    if (motzCtx) {
      motorizadoChart = new Chart(motzCtx, {
        type:'bar',
        data:{ labels:['MOTO SAVE','Sin Alto Riesgo'], datasets:[{ label:'Registros', data:[0,0], borderRadius:12, borderSkipped:false,
          backgroundColor: [], borderColor:[] }]},
        options:{ responsive:true, maintainAspectRatio:false,
          scales:{ y:{ beginAtZero:true, ticks:{ font:{ size:14 } } }, x:{ grid:{ display:false }, ticks:{ font:{ size:14 } } } },
          plugins:{ legend:{ labels:{ color:CH_LABEL, font:{ size:15 } } }, datalabels: DL_TOP, barGlow:{} }
        },
        plugins:[{
          id:'motorizadoBarColors',
          beforeDatasetsDraw(c){
            const ctx = c.ctx;
            const ds = c.data?.datasets?.[0];
            if (!ds) return;
            ds.backgroundColor = [ mkGrad(ctx, FIX.BAR_MAIN), mkGrad(ctx, FIX.BAR_ALT) ];
            ds.borderColor     = [ FIX.BAR_MAIN, FIX.BAR_ALT ];
          }
        }]
      });
      pushChart(motorizadoChart);
    }

    // ===== Motorizado por día (líneas)
    if (motzDay) {
      const cols = getColors(2);
      motorizadoDailyChart = new Chart(motzDay, {
        type:'line',
        data:{ labels:[], datasets:[
          { label:'MOTO SAVE', data:[], tension:.3, pointRadius:3, borderWidth:2, fill:false,
            borderColor: cols[0], pointBackgroundColor: cols[0] },
          { label:'Sin Alto Riesgo', data:[], tension:.3, pointRadius:3, borderWidth:2, fill:false,
            borderColor: cols[1], pointBackgroundColor: cols[1] }
        ]},
        options:{ responsive:true, maintainAspectRatio:false,
          scales:{ y:{ beginAtZero:true, ticks:{ font:{ size:14 } } }, x:{ grid:{ display:false }, ticks:{ font:{ size:14 } } } },
          plugins:{ legend:{ labels:{ color:CH_LABEL, font:{ size:15 } } }, datalabels: DL_TOP } }
      });
      pushChart(motorizadoDailyChart);
    }

    // ===== Ranking semanal (líneas de color)
    if (rankCtx) {
      weeklyRankingChart = new Chart(rankCtx, {
        type:'line',
        data:{ labels:['Sem 1','Sem 2','Sem 3','Sem 4','Sem 5'], datasets:[] },
        options:{ responsive:true, maintainAspectRatio:false,
          scales:{ y:{ beginAtZero:true, ticks:{ font:{ size:14 } } }, x:{ grid:{ display:false }, ticks:{ font:{ size:14 } } } },
          plugins:{ legend:{ position:'bottom', labels:{ color:CH_LABEL, font:{ size:15 } } }, datalabels: DL_TOP } }
      });
      pushChart(weeklyRankingChart);
    }

    // ===== Cobertura por turbina — colores fijos
    if (covCtx) {
      coverageChart = new Chart(covCtx, {
        type:'bar',
        data:{ labels:[], datasets:[
          { label:'Base',            data:[], borderRadius:12, borderSkipped:false, backgroundColor:FIX.BAR_ALT,  borderColor:FIX.BAR_ALT },
          { label:'Registros únicos',data:[], borderRadius:12, borderSkipped:false, backgroundColor:FIX.BAR_OK,   borderColor:FIX.BAR_OK },
          { label:'Restantes',       data:[], borderRadius:12, borderSkipped:false, backgroundColor:FIX.BAR_WARM, borderColor:FIX.BAR_WARM }
        ]},
        options:{ responsive:true, maintainAspectRatio:false,
          scales:{ y:{ beginAtZero:true, ticks:{ font:{ size:14 } } }, x:{ grid:{ display:false }, ticks:{ font:{ size:14 } } } },
          plugins:{ legend:{ position:'bottom', labels:{ color:CH_LABEL, font:{ size:15 } } },
            datalabels:{ ...DL_TOP, formatter:(v,ctx)=>{
              if (ctx.dataset.label!=='Registros únicos') return fmtInt(v);
              const base = ctx.chart.data.datasets[0].data[ctx.dataIndex]||0;
              const pct  = base?Math.round((v*100)/base):0;
              return `${fmtInt(v)} • ${pct}%`;
            } },
            barGlow:{} },
          onClick: (_, els) => { const e = els?.[0]; if (!e) return; const label = coverageChart.data.labels[e.index]; setTurbinaFilter([label]); queryData(); }
        }
      });
      pushChart(coverageChart);
    }

    // ===== Cobertura global (donut)
    if (covGCtx) {
      coverageGlobalChart = new Chart(covGCtx, {
        type:'doughnut',
        data:{ labels:['Visitados','Sin visitas'], datasets:[{ data:[0,0], borderWidth:1, spacing:4, hoverOffset:6,
          backgroundColor:getColors(2) }]},
        options:{ responsive:true, maintainAspectRatio:false, cutout:'64%',
          plugins:{ legend:{ position:'bottom', labels:{ color:CH_LABEL, font:{ size:15 } } }, datalabels: DL_INSIDE, donut3d:{} } }
      });
      pushChart(coverageGlobalChart);
    }

    // ===== Heatmap Día x Hora (matrix)
    if (hmapCtx && window.Chart) {
      heatmapChart = new Chart(hmapCtx, {
        type: 'matrix',
        data: { datasets: [{
          label:'Frecuencia', data:[],
          backgroundColor:(ctx)=>{ const v = ctx.raw?.v||0; const a = Math.min(1, 0.15 + v/Math.max(5, heatmapChart?._maxV||10)); return `rgba(26,115,232,${a})`; },
          width:(ctx)=> (ctx.chart.chartArea?.width||480)/24 - 2,
          height:(ctx)=> (ctx.chart.chartArea?.height||240)/7 - 2
        }]},
        options:{ scales:{ x:{ type:'linear', min:-0.5, max:23.5, ticks:{ stepSize:1, font:{ size:13 } }, grid:{ display:false } },
                           y:{ type:'category', labels:['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'], ticks:{ font:{ size:13 } }, grid:{ display:false } } },
          plugins:{ legend:{ display:false }, datalabels: { display:false },
            tooltip:{ callbacks:{ title:(it)=>`Hora ${it[0]?.raw?.x??''}`, label:(it)=> `Día: ${['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'][it.raw?.y]} · ${fmtInt(it.raw?.v)} regs` } } }
        }
      });
      pushChart(heatmapChart);
    }

    // ===== Barras apiladas por distrito — colores fijos
    if (distCtx) {
      districtStackedChart = new Chart(distCtx, {
        type:'bar',
        data:{ labels:[], datasets:[
          { label:'Alto_Riesgo', data:[], stack:'moto', borderRadius:12, borderSkipped:false, backgroundColor:FIX.BAR_MAIN, borderColor:FIX.BAR_MAIN },
          { label:'Sin Alto Riesgo', data:[], stack:'moto', borderRadius:12, borderSkipped:false, backgroundColor:FIX.BAR_ALT,  borderColor:FIX.BAR_ALT }
        ]},
        options:{ responsive:true, maintainAspectRatio:false, scales:{ x:{ stacked:true, ticks:{ font:{ size:13 } } }, y:{ stacked:true, beginAtZero:true, ticks:{ font:{ size:13 } } } },
          plugins:{ legend:{ position:'bottom', labels:{ font:{ size:14 } } }, datalabels: DL_TOP, barGlow:{} } }
      });
      pushChart(districtStackedChart);
    }

    // ===== Tendencia 6 meses
    if (trndCtx) {
      trendChart = new Chart(trndCtx, {
        type:'line',
        data:{ labels:[], datasets:[{ label:'Tendencia', data:[], tension:.3, pointRadius:3, borderWidth:2, fill:false, borderColor: getColors(1)[0] }]},
        options:{ responsive:true, maintainAspectRatio:false,
          scales:{ y:{ beginAtZero:true, ticks:{ font:{ size:14 } } }, x:{ grid:{ display:false }, ticks:{ font:{ size:14 } } } },
          plugins:{ legend:{ labels:{ color:CH_LABEL, font:{ size:15 } } }, datalabels: DL_TOP } }
      });
      pushChart(trendChart);
    }

    // ===== Pareto de motivos (mantiene paleta temática)
    if (parCtx) {
      paretoMotivoChart = new Chart(parCtx, {
        type:'bar',
        data:{ labels:[], datasets:[
          { label:'Conteo', data:[], yAxisID:'y', borderRadius:12, borderSkipped:false, backgroundColor:getColors(1)[0] },
          { label:'Acumulado %', type:'line', data:[], yAxisID:'y1', tension:.2, pointRadius:2, borderColor:getColors(2)[1] }
        ]},
        options:{ responsive:true, maintainAspectRatio:false,
          scales:{ y:{ beginAtZero:true, ticks:{ font:{ size:13 } } }, y1:{ beginAtZero:true, min:0, max:100, position:'right', grid:{ drawOnChartArea:false }, ticks:{ font:{ size:13 } } },
                  x:{ grid:{ display:false }, ticks:{ font:{ size:13 } } } },
          plugins:{ legend:{ position:'bottom', labels:{ font:{ size:14 } } }, datalabels: DL_TOP, barGlow:{} } }
      });
      pushChart(paretoMotivoChart);
    }

    // ===== Treemap (categoría → motivo)
    if (treeCtx) {
      treemapCatMotivo = new Chart(treeCtx, {
        type:'treemap',
        data:{ datasets:[{ key:'value', groups: ['categoria'], tree:[],
          labels:{ display:true, formatter:(c)=>`${c.raw._data.categoria}\n${c.raw._data.motivo}\n${fmtInt(c.raw.v)}`, color: CH_LABEL, font:{ size:12, weight:'bold' } } }]},
        options:{ plugins:{ legend:{ display:false }, datalabels:{ display:false },
          tooltip:{ callbacks:{ label:(ctx)=> { const d = ctx.raw?._data||{}; return `${d.categoria} → ${d.motivo}: ${fmtInt(ctx.raw.v)}`; } } } } }
      });
      pushChart(treemapCatMotivo);
    }

    // ===== Histograma por hora — rojo fijo
    if (hourCtx) {
      hourHistogramChart = new Chart(hourCtx, {
        type:'bar',
        data:{ labels:Array.from({length:24},(_,h)=>String(h)), datasets:[{ label:'Registros', data:[], borderRadius:12, borderSkipped:false, backgroundColor:FIX.BAR_MAIN, borderColor:FIX.BAR_MAIN }]},
        options:{ responsive:true, maintainAspectRatio:false,
          scales:{ y:{ beginAtZero:true, ticks:{ font:{ size:13 } } }, x:{ grid:{ display:false }, ticks:{ font:{ size:13 } } } },
          plugins:{ legend:{ display:false }, datalabels: DL_TOP, barGlow:{} } }
      });
      pushChart(hourHistogramChart);
    }

    // ===== Radar por Consola (con glow + relleno)
    if (radarCtx) {
      radarConsolaChart = new Chart(radarCtx, {
        type:'radar',
        data:{ labels:['Visitas','Únicos','% Alto_Riesgo','Turbinas distintas'], datasets:[] },
        options:{ responsive:true, maintainAspectRatio:false,
          plugins:{ legend:{ position:'bottom', labels:{ font:{ size:14 } } },
            datalabels: { color:CH_LABEL, formatter:(v)=>fmtInt(v), font:{ size:13 } } },
          scales:{ r:{ beginAtZero:true, suggestedMax:100, pointLabels:{ font:{ size:13 } },
            ticks:{ showLabelBackdrop:false, font:{ size:12 } } } }
        }
      });
      pushChart(radarConsolaChart);
    }

    // ===== Top usuarios — rojo fijo
    if (userCtx) {
      topUsersChart = new Chart(userCtx, {
        type:'bar',
        data:{ labels:[], datasets:[{ label:'Registros', data:[], borderRadius:12, borderSkipped:false, backgroundColor:FIX.BAR_MAIN, borderColor:FIX.BAR_MAIN }]},
        options:{ indexAxis:'y', responsive:true, maintainAspectRatio:false,
          scales:{ x:{ beginAtZero:true, ticks:{ font:{ size:13 } } }, y:{ grid:{ display:false }, ticks:{ font:{ size:13 } } } },
          plugins:{ legend:{ display:false }, datalabels: { ...DL_TOP, align:'right', anchor:'end' }, barGlow:{} } }
      });
      pushChart(topUsersChart);
    }

    // Leaflet (GPS HEATMAP) — usa el id correcto: heatMap
    const mapDiv = $('#heatMap');
    if (mapDiv && window.L) {
      map = L.map('heatMap', { center: [-12.06,-77.04], zoom: 12, zoomControl:true });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(map);
      setTimeout(()=>map.invalidateSize(), 300);
      window.addEventListener('resize', ()=> map.invalidateSize());
    }

    // aplicar ajuste responsive inicial
    applyResponsiveChartFonts();
  }
  initCharts();

  // ---------- Sidebar móvil (off-canvas) ----------
  (function sidebarMobile(){
    const scrim = document.createElement('div');
    scrim.className = 'side-scrim';
    document.body.appendChild(scrim);

    const toggle = () => {
      document.body.classList.toggle('sidebar-open');
      setTimeout(()=>{ if (window.map?.invalidateSize) map.invalidateSize(); }, 220);
    };

    document.getElementById('btnHamb')?.addEventListener('click', (e)=>{
      e.preventDefault();
      toggle();
    });
    scrim.addEventListener('click', ()=>{
      document.body.classList.remove('sidebar-open');
      setTimeout(()=>{ if (window.map?.invalidateSize) map.invalidateSize(); }, 220);
    });
  })();

  // ---------- Datos (helpers) ----------
  const FALLBACK_MS = new Date('2025-09-30T23:59:59-05:00').getTime();
  const toMs = v => (v && typeof v.toMillis==='function') ? v.toMillis()
                  : (v && typeof v.seconds==='number') ? v.seconds*1000
                  : (v instanceof Date) ? v.getTime()
                  : FALLBACK_MS;

  const getId = r => r?.oficina?.id || r?.cajero?.id || r?.id || '—';
  const getTurbinaRaw = r => (r?.oficina?.turbina || r?.cajero?.turbina || r?.turbina || r?.oficina?.TURBINA || r?.cajero?.TURBINA || '').toString();
  const getConsola = r => (r?.oficina?.consola || r?.cajero?.consola || r?.consola || r?.oficina?.CONSOLA || r?.cajero?.CONSOLA || '').toString();
  const getTurbinaForKPIs = r => (normU(getConsola(r))==='CONSOLA TORRE' ? 'CONSOLA TORRE' : (getTurbinaRaw(r) || '—'));
  const getSiteOrTerm = r => r?.oficina?.site ?? r?.cajero?.term_id ?? '';

  const getMotoSave    = r => (r?.oficina?.moto_save ?? r?.moto_save ?? '').toString();
  const getMotorizado  = r => (r?.oficina?.motorizado ?? r?.motorizado ?? '').toString();

  const catMoto = (v) => { const s = normU(v);
    if (/SIN\s+ALTO\s+RIESGO/.test(s)) return 'Sin Alto Riesgo';
    if (/ALTO[_\s]?RIESGO/.test(s))   return 'Alto_Riesgo';
    if (/MOTO/.test(s))               return 'MOTO SAVE';
    return 'Otros';
  };
  const countBy = arr => arr.reduce((m,k)=>(m[k]=(m[k]||0)+1,m),{});
  const getWeekOfMonth = (ms) => Math.floor((new Date(ms).getDate()-1)/7); // 0..4
  const hourOf = (ms) => new Date(ms).getHours();
  const dowOf  = (ms) => new Date(ms).getDay(); // 0..6

  // Modo de conteo
  const countModeSel = $('#countMode');
  function applyCountMode(rows, groupKeyFn){
    const mode = countModeSel?.value || 'raw';
    if (mode === 'raw'){ return countBy(rows.map(groupKeyFn)); }
    if (mode === 'unique_id'){
      const map = new Map();
      rows.forEach(r => { const g = groupKeyFn(r), id = getId(r); if (!g || !id) return; if (!map.has(g)) map.set(g, new Set()); map.get(g).add(id); });
      const out = {}; map.forEach((set, k)=> out[k] = set.size); return out;
    }
    if (mode === 'unique_day_id'){
      const map = new Map();
      rows.forEach(r => { const g = groupKeyFn(r), id = getId(r); const d  = new Date(r._ms).toISOString().slice(0,10); if (!g || !id) return;
        const key = `${d}::${id}`; if (!map.has(g)) map.set(g, new Set()); map.get(g).add(key); });
      const out = {}; map.forEach((set, k)=> out[k] = set.size); return out;
    }
    return {};
  }

  // Multiselección
  function getTurbinasSelected(){ const sel = $('#f-turbina'); if (!sel) return []; return Array.from(sel.selectedOptions || []).map(o => normU(o.value)).filter(Boolean); }
  function setTurbinaFilter(vals){ const sel = $('#f-turbina'); if (!sel) return; const set = new Set(vals.map(normU)); Array.from(sel.options).forEach(o => { o.selected = set.has(normU(o.value)); }); }
  function getUserFilters(){ const raw = userInput?.value || ''; return raw.split(/[,;]+/).map(s=>normU(s)).map(s=>s.trim()).filter(Boolean); }

  // Tabla + Paginación
  const PAGE_SIZE = 10;
  const gridTable = $('#grid'); const tbody = gridTable?.querySelector('tbody');
  const gridCount = $('#gridCount'); const pgInfo = $('#pgInfo');
  const btnFirst = $('#pgFirst'); const btnPrev  = $('#pgPrev'); const btnNext  = $('#pgNext'); const btnLast  = $('#pgLast');

  let TABLE_MAPPED = []; let CURRENT_PAGE = 1;

  function esc(s){ return (s==null?'':String(s)).replace(/[&<>"]/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[m])); }
  const totalPages = () => Math.max(1, Math.ceil(TABLE_MAPPED.length / PAGE_SIZE));

  function mapRowForTable(r, fuente){
    const ms = toMs(r.createdAt);
    const fecha = isFinite(ms) ? new Date(ms).toLocaleString('es-PE', { dateStyle:'short', timeStyle:'short' }) : '';
    const clas = r?.clasificacion || {};
    return {
      fecha,  tipo: fuente==='reportes_oficinas' ? 'OFICINA' : 'CAJERO',  id: getId(r),
      consola: getConsola(r),  turbina: getTurbinaRaw(r),  site_term: getSiteOrTerm(r),
      distrito: r?.oficina?.distrito ?? r?.cajero?.distrito ?? '',  direccion: r?.oficina?.direccion ?? r?.cajero?.direccion ?? '',
      turno: r?.oficina?.turno ?? r?.cajero?.turno ?? r?.turno ?? '',  categoria: clas.categoria || clas.categoriaId || '',
      motivo: clas.motivo || clas.motivoId || '', novedad: clas.novedad || clas.novedadId || '', detalle: clas.detalle || clas.detalleId || '',
      comentario: r?.comentario || '', usuario: r?.user?.email || ''
    };
  }
  function drawPage(){
    const total = TABLE_MAPPED.length; const pages = totalPages();
    CURRENT_PAGE = Math.min(Math.max(1, CURRENT_PAGE), pages);
    const startIdx = (CURRENT_PAGE - 1) * PAGE_SIZE; const endIdx   = Math.min(total, startIdx + PAGE_SIZE);
    const slice = TABLE_MAPPED.slice(startIdx, endIdx);
    if (tbody) {
      tbody.innerHTML = slice.length ? slice.map(o=>`
        <tr>
          <td>${esc(o.fecha)}</td><td>${esc(o.tipo)}</td><td>${esc(o.id)}</td><td>${esc(o.consola)}</td>
          <td>${esc(o.turbina)}</td><td>${esc(o.site_term)}</td><td>${esc(o.distrito)}</td><td>${esc(o.direccion)}</td>
          <td>${esc(o.turno)}</td><td>${esc(o.categoria)}</td><td>${esc(o.motivo)}</td><td>${esc(o.novedad)}</td>
          <td>${esc(o.detalle)}</td><td>${esc(o.comentario)}</td><td>${esc(o.usuario)}</td>
        </tr>`).join('') : `<tr><td colspan="15" class="muted">Sin resultados para los filtros seleccionados.</td></tr>`;
    }
    gridCount && (gridCount.textContent = `${total} resultado${total===1?'':'s'}`);
    const from = total ? startIdx + 1 : 0; const to   = total ? endIdx : 0; pgInfo && (pgInfo.textContent = `${from}–${to} de ${total}`);
    const atFirst = CURRENT_PAGE === 1; const atLast  = CURRENT_PAGE === pages;
    [btnFirst, btnPrev].forEach(b => b && (b.disabled = atFirst)); [btnNext, btnLast].forEach(b => b && (b.disabled = atLast));
  }
  function updateTable(rows, fuente){ TABLE_MAPPED = rows.map(r => mapRowForTable(r, fuente)); CURRENT_PAGE = 1; drawPage(); }
  btnFirst?.addEventListener('click', ()=>{ CURRENT_PAGE = 1; drawPage(); });
  btnPrev ?.addEventListener('click', ()=>{ CURRENT_PAGE = Math.max(1, CURRENT_PAGE-1); drawPage(); });
  btnNext ?.addEventListener('click', ()=>{ CURRENT_PAGE = Math.min(totalPages(), CURRENT_PAGE+1); drawPage(); });
  btnLast ?.addEventListener('click', ()=>{ CURRENT_PAGE = totalPages(); drawPage(); });

  // Exportar EXCEL
  function exportToExcel(){
    if (!TABLE_MAPPED.length){ toast({ title:'Exportar', msg:'No hay datos para exportar.', type:'warn' }); return; }
    if (typeof XLSX === 'undefined' || !XLSX?.utils){ toast({ title:'Exportar', msg:'Biblioteca XLSX no cargó. Revisa el <script> de SheetJS.', type:'err' }); return; }
    const headers = ['Fecha','Tipo','Local (id)','Consola','Turbina','SITE/TERM','Distrito','Dirección','Turno','Categoría','Motivo','Novedad','Detalle','Comentario','Usuario'];
    const keys    = ['fecha','tipo','id','consola','turbina','site_term','distrito','direccion','turno','categoria','motivo','novedad','detalle','comentario','usuario'];
    const aoa = [headers]; TABLE_MAPPED.forEach(r => aoa.push(keys.map(k => r[k] ?? '')));
    const m = +($('#mes')?.value ?? new Date().getMonth()); const y = +($('#anio')?.value ?? new Date().getFullYear()); const fuente = $('#fuente')?.value || 'reportes';
    const wb = XLSX.utils.book_new(); const ws = XLSX.utils.aoa_to_sheet(aoa); XLSX.utils.book_append_sheet(wb, ws, 'Datos');
    const wbout = XLSX.write(wb, { bookType:'xlsx', type:'array' }); const blob = new Blob([wbout], { type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `${fuente}_${y}-${String(m+1).padStart(2,'0')}.xlsx`; document.body.appendChild(a); a.click();
    setTimeout(()=>{ URL.revokeObjectURL(url); a.remove(); }, 0);
  }
  $('#btnExport')?.addEventListener('click', exportToExcel);

  // Limpieza cuadros solo-oficinas
  function clearMotoCharts(msg){
    if (typeof msg === 'string' && msg) toast({ title:'Solo Oficinas', msg, type:'warn' });
    if (motoDailyChart){ motoDailyChart.data.labels = []; motoDailyChart.data.datasets[0].data = []; motoDailyChart.data.datasets[1].data = []; motoDailyChart.update(); }
    if (motorizadoChart){ motorizadoChart.data.labels = ['MOTO SAVE','Sin Alto Riesgo']; motorizadoChart.data.datasets[0].data = [0,0]; motorizadoChart.update(); }
    if (motorizadoDailyChart){ motorizadoDailyChart.data.labels = []; motorizadoDailyChart.data.datasets[0].data = []; motorizadoDailyChart.data.datasets[1].data = []; motorizadoDailyChart.update(); }
  }

  // ---------- Firestore Queries ----------
  async function getRowsByRange(coll, startMs, endMs){
    const startDate = new Date(startMs); const endDate   = new Date(endMs);
    try {
      const q = await db.collection(coll).where('createdAt','>=', startDate).where('createdAt','<',  endDate).get();
      return q.docs.map(d => ({ id:d.id, ...d.data() }));
    } catch (e) {
      console.warn('[RangeQuery fallback]', e.message);
      const q = await db.collection(coll).get();
      return q.docs.map(d => ({ id:d.id, ...d.data() }))
        .map(r => ({ ...r, _ms: toMs(r.createdAt) })).filter(r => r._ms >= startMs && r._ms < endMs);
    }
  }
  async function getBaseDocs(coll){ try { const snap = await db.collection(coll).get(); return snap.docs.map(d=>({ id:d.id, ...d.data() })); } catch(e){ console.warn('[BaseDocs]', e); return []; } }

  // ---------- Consulta + render ----------
  let WEEKLY_RANK_ALL = []; const rankTopNSelect = $('#rankTopN'); let RANK_TOP_N = 5;
  rankTopNSelect?.addEventListener('change', (e)=>{ const n = parseInt(e.target.value, 10); RANK_TOP_N = (Number.isFinite(n) && (n===5 || n===10)) ? n : 5; updateWeeklyRankingChart(); });
  function updateWeeklyRankingChart(){
    if (!weeklyRankingChart) return;
    const top = WEEKLY_RANK_ALL.slice(0, RANK_TOP_N);
    const colors = getColors(top.length || 1);
    weeklyRankingChart.data.labels = ['Sem 1','Sem 2','Sem 3','Sem 4','Sem 5'];
    weeklyRankingChart.data.datasets = top.map(([id, arr], i) => ({ label: id, data: arr, tension:.3, pointRadius:3, borderWidth:2, fill:false,
      borderColor: colors[i], pointBackgroundColor: colors[i] }));
    weeklyRankingChart.update();
  }

  async function queryData(){
    if (!db){ toast({ title:'Aviso', msg:'Firestore no disponible.', type:'warn' }); return; }

    const fuente = $('#fuente')?.value || 'reportes_cajeros';
    const m  = +($('#mes')?.value ?? new Date().getMonth());
    const y  = +($('#anio')?.value ?? new Date().getFullYear());
    const idFilter   = (localInput?.value || '').trim();
    const turFilters = getTurbinasSelected();
    const userFilters= getUserFilters();
    const countMode  = $('#countMode')?.value || 'raw';

    showOverlay('Cargando datos…', `Fuente: ${fuente}`); setProgress(0.1);

    const start = new Date(y, m,   1, 0,0,0,0).getTime();
    const end   = new Date(y, m+1, 1, 0,0,0,0).getTime();

    let rows = (await getRowsByRange(fuente, start, end)).map(r => ({ ...r, _ms: toMs(r.createdAt) })); setProgress(0.25);

    let cmpRows = [];
    if (cmpEnabled?.checked){
      const cm = +($('#cmpMes')?.value ?? m); const cy = +($('#cmpAnio')?.value ?? y);
      const cstart = new Date(cy, cm,   1, 0,0,0,0).getTime(); const cend   = new Date(cy, cm+1, 1, 0,0,0,0).getTime();
      cmpRows = (await getRowsByRange(fuente, cstart, cend)).map(r => ({ ...r, _ms: toMs(r.createdAt) }));
    }
    setProgress(0.35);

    function passFilters(r){
      if (idFilter) { const q = normU(idFilter); if (!normU(getId(r)).includes(q)) return false; }
      if (turFilters.length){
        const t  = normU(getTurbinaRaw(r)); const cs = normU(getConsola(r));
        const v  = cs==='CONSOLA TORRE' ? 'CONSOLA TORRE' : t; if (!turFilters.includes(v)) return false;
      }
      if (userFilters.length){
        const ue = normU(r?.user?.email||''); const ok = userFilters.some(u => ue.includes(u)); if (!ok) return false;
      }
      return true;
    }
    rows = rows.filter(passFilters); cmpRows = cmpRows.filter(passFilters); setProgress(0.45);

    // Sugerencias usuario
    if (userDatalist) {
      const emails = [...new Set(rows.map(r => (r?.user?.email || '').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
      userDatalist.innerHTML = emails.map(e => `<option value="${e}"></option>`).join('');
    }

    // ===== KPIs
    const localeSet = new Set(rows.map(getId));
    const mm = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
    $('#kpiLocales')    && ($('#kpiLocales').textContent    = localeSet.size);
    $('#kpiLocalesSub') && ($('#kpiLocalesSub').textContent = `${mm[m]} ${y} · ${fuente}`);
    $('#kpiVisitas')    && ($('#kpiVisitas').textContent    = rows.length);
    $('#kpiVisitasSub') && ($('#kpiVisitasSub').textContent = (countMode==='raw'?'registros del mes': (countMode==='unique_id'?'únicos por local':'únicos por día')));

    // ===== Visitas por turbina (comparador)
    const byTur = Object.entries(applyCountMode(rows, getTurbinaForKPIs)).sort((a,b)=>b[1]-a[1]);
    $('#kpiTurbinas')    && ($('#kpiTurbinas').textContent    = byTur.filter(([k])=>k!=='—').length);
    $('#kpiTurbinasSub') && ($('#kpiTurbinasSub').textContent = 'turbinas con visitas');
    $('#kpiTopTurbina')  && ($('#kpiTopTurbina').textContent  = byTur[0]?.[1] || 0);
    $('#kpiTopTurbinaSub') && ($('#kpiTopTurbinaSub').textContent = byTur[0] ? `Top: ${byTur[0][0]}` : 'sin datos');

    if (barChart){
      const labels = byTur.map(x=>x[0]); const data = byTur.map(x=>x[1]);
      let cmpData = []; if (cmpRows.length){ const mapCmp = applyCountMode(cmpRows, getTurbinaForKPIs); cmpData = labels.map(l=> mapCmp[l]||0); }
      barChart.data.labels = labels;
      barChart.data.datasets[0].data = data;
      barChart.data.datasets[1].data = cmpData;
      barChart.update();
    }

    // ===== Top locales (torta → pie)
    const byIdAll = Object.entries(applyCountMode(rows, getId)).sort((a,b)=>b[1]-a[1]).slice(0,10);
    if (donutChart){
      const labels = byIdAll.map(x=>x[0]); const data = byIdAll.map(x=>x[1]); const cols = getColors(labels.length);
      donutChart.data.labels = labels;
      donutChart.data.datasets[0].data = data;  donutChart.data.datasets[0].backgroundColor = cols;
      donutChart.update();
    }

    // ===== Solo Oficinas: Moto/Motorizado
    const daysInMonth = new Date(y, m+1, 0).getDate();
    const labelsDays  = Array.from({length:daysInMonth}, (_,i)=> String(i+1));
    if (fuente === 'reportes_oficinas') {
      const dailyAlto = Array.from({length:daysInMonth}, ()=>0);
      const dailySin  = Array.from({length:daysInMonth}, ()=>0);
      rows.forEach(r => { const idx = Math.max(0, Math.min(daysInMonth-1, new Date(r._ms).getDate()-1));
        const cat = catMoto(getMotoSave(r)); if (cat === 'Alto_Riesgo') dailyAlto[idx] += 1; else if (cat === 'Sin Alto Riesgo') dailySin[idx]  += 1; });
      if (motoDailyChart){ motoDailyChart.data.labels = labelsDays; motoDailyChart.data.datasets[0].data = dailyAlto; motoDailyChart.data.datasets[1].data = dailySin; motoDailyChart.update(); }

      let countMotoSave = 0, countSinAlto = 0;
      rows.forEach(r => { const cat = catMoto(getMotorizado(r)); if (cat === 'MOTO SAVE') countMotoSave += 1; else if (cat === 'Sin Alto Riesgo') countSinAlto  += 1; });
      if (motorizadoChart){ motorizadoChart.data.labels = ['MOTO SAVE','Sin Alto Riesgo']; motorizadoChart.data.datasets[0].data = [countMotoSave, countSinAlto]; motorizadoChart.update(); }

      const dailyMotSave = Array.from({length:daysInMonth}, ()=>0);
      const dailyMotSin  = Array.from({length:daysInMonth}, ()=>0);
      rows.forEach(r => { const idx = Math.max(0, Math.min(daysInMonth-1, new Date(r._ms).getDate()-1));
        const cat = catMoto(getMotorizado(r)); if (cat === 'MOTO SAVE') dailyMotSave[idx] += 1; else if (cat === 'Sin Alto Riesgo') dailyMotSin[idx]  += 1; });
      if (motorizadoDailyChart){ motorizadoDailyChart.data.labels = labelsDays; motorizadoDailyChart.data.datasets[0].data = dailyMotSave; motorizadoDailyChart.data.datasets[1].data = dailyMotSin; motorizadoDailyChart.update(); }
    } else { clearMotoCharts('Cuadros de Moto/Motorizado aplican solo a reportes_oficinas.'); }

    // ===== Ranking semanal de locales
    const byIdWeek = new Map(); rows.forEach(r => { const wk = getWeekOfMonth(r._ms); const id = getId(r); if (!id) return; if (!byIdWeek.has(id)) byIdWeek.set(id, [0,0,0,0,0]); byIdWeek.get(id)[wk] += 1; });
    WEEKLY_RANK_ALL = [...byIdWeek.entries()].map(([id, arr]) => [id, arr, arr.reduce((a,b)=>a+b,0)]).sort((a,b)=>b[2]-a[2]);
    updateWeeklyRankingChart();

    // ===== Coberturas
    await computeCoverageByTurbina(fuente, rows);

    // ===== Cobertura Global
    const baseColl = (fuente === 'reportes_oficinas') ? 'OFICINAS' : 'CAJEROS';
    const baseDocs = await getBaseDocs(baseColl);
    const totalBase = baseDocs.length;
    const visitados = (new Set(rows.map(getId))).size;
    if (coverageGlobalChart){ coverageGlobalChart.data.labels = ['Visitados','Sin visitas']; coverageGlobalChart.data.datasets[0].data = [visitados, Math.max(0, totalBase - visitados)]; coverageGlobalChart.update(); }

    // ===== Heatmap Día x Hora
    if (heatmapChart){
      const mapH = {}; let maxV = 0;
      rows.forEach(r=>{ const y = dowOf(r._ms); const x = hourOf(r._ms); const key = `${y}|${x}`; mapH[key] = (mapH[key]||0)+1; if (mapH[key]>maxV) maxV=mapH[key]; });
      heatmapChart._maxV = maxV;
      heatmapChart.data.datasets[0].data = Object.entries(mapH).map(([k,v])=>{ const [y,x] = k.split('|').map(n=>+n); return {x,y,v}; });
      heatmapChart.update();
    }

    // ===== Barras apiladas por distrito
    if (districtStackedChart){
      const dist = {};
      rows.forEach(r=>{ const d = r?.oficina?.distrito ?? r?.cajero?.distrito ?? '—'; const cat = (fuente==='reportes_oficinas') ? catMoto(getMotoSave(r)) : 'Otros';
        if (!dist[d]) dist[d] = { 'Alto_Riesgo':0, 'Sin Alto Riesgo':0 }; if (cat==='Alto_Riesgo') dist[d]['Alto_Riesgo']++; else if (cat==='Sin Alto Riesgo') dist[d]['Sin Alto Riesgo']++; });
      const entries = Object.entries(dist).sort((a,b)=> (b[1]['Alto_Riesgo']+b[1]['Sin Alto Riesgo']) - (a[1]['Alto_Riesgo']+a[1]['Sin Alto Riesgo'])).slice(0,12);
      districtStackedChart.data.labels = entries.map(e=>e[0]);
      districtStackedChart.data.datasets[0].data = entries.map(e=>e[1]['Alto_Riesgo']);
      districtStackedChart.data.datasets[1].data = entries.map(e=>e[1]['Sin Alto Riesgo']);
      districtStackedChart.update();
    }

    // ===== Tendencia 6 meses
    await renderTrend6Months();

    // ===== Pareto de motivos
    if (paretoMotivoChart){
      const counts = countBy(rows.map(r => (r?.clasificacion?.motivo || r?.clasificacion?.motivoId || '—')));
      const arr = Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,20);
      const labels = arr.map(x=>x[0]); const data   = arr.map(x=>x[1]);
      const total  = data.reduce((a,b)=>a+b,0)||1; let acc = 0;
      const cumul = data.map(v => { acc += v; return Math.round(acc*100/total); });
      paretoMotivoChart.data.labels = labels; paretoMotivoChart.data.datasets[0].data = data; paretoMotivoChart.data.datasets[1].data = cumul;
      paretoMotivoChart.update();
    }

    // ===== Treemap Cat→Motivo
    if (treemapCatMotivo){
      const mapT = {}; rows.forEach(r=>{ const cat = r?.clasificacion?.categoria || r?.clasificacion?.categoriaId || '—';
        const mot = r?.clasificacion?.motivo || r?.clasificacion?.motivoId || '—'; const key = `${cat}||${mot}`; mapT[key] = (mapT[key]||0)+1; });
      const tree = Object.entries(mapT).map(([k,v])=>{ const [categoria,motivo] = k.split('||'); return { categoria, motivo, value:v }; });
      treemapCatMotivo.data.datasets[0].tree = tree.map(n=>({ _data:n, value:n.value })); treemapCatMotivo.update();
    }

    // ===== Histograma por hora
    if (hourHistogramChart){
      const hrs = Array.from({length:24},()=>0); rows.forEach(r => hrs[hourOf(r._ms)]++);
      hourHistogramChart.data.labels = hrs.map((_,i)=>String(i));
      hourHistogramChart.data.datasets[0].data = hrs;
      hourHistogramChart.update();
    }

    // ===== Radar por consola (relleno y colores)
    if (radarConsolaChart){
      const byCons = {};
      rows.forEach(r=>{ const c = getConsola(r) || '—';
        if (!byCons[c]) byCons[c] = { rows:[], ids:new Set(), altos:0, tur:new Set() };
        byCons[c].rows.push(r); byCons[c].ids.add(getId(r)); byCons[c].tur.add(getTurbinaForKPIs(r));
        if (catMoto(getMotoSave(r))==='Alto_Riesgo') byCons[c].altos++;
      });
      const arr = Object.entries(byCons).sort((a,b)=>b[1].rows.length - a[1].rows.length).slice(0,4);
      const labels = ['Visitas','Únicos','% Alto_Riesgo','Turbinas distintas']; const colors = getColors(arr.length||1);
      radarConsolaChart.data.labels = labels;
      radarConsolaChart.data.datasets = arr.map(([c, o], i)=>{ const visitas = o.rows.length; const unicos  = o.ids.size;
        const altoPct = visitas? Math.round(o.altos*100/visitas) : 0; const turd = o.tur.size;
        return { label:c, data:[visitas, unicos, altoPct, turd], borderColor:colors[i], backgroundColor:colors[i]+'33', fill:true, pointBackgroundColor:colors[i] };
      });
      radarConsolaChart.update();
    }

    // ===== Top usuarios
    if (topUsersChart){
      const counts = countBy(rows.map(r => r?.user?.email || '—'));
      const arr = Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,10);
      topUsersChart.data.labels = arr.map(a=>a[0]);
      topUsersChart.data.datasets[0].data = arr.map(a=>a[1]);
      topUsersChart.update();
    }

    // ===== Tabla
    updateTable(rows, fuente);

    // ===== Mapa (heatmap con geo del USUARIO)
    await renderMapHeat(rows);

    setProgress(1); hideOverlay();
  }

  // Tendencia 6 meses
  async function renderTrend6Months(){
    if (!trendChart) return;
    const months = []; for (let i=5;i>=0;i--){ const d = new Date(); d.setMonth(d.getMonth()-i); months.push([d.getFullYear(), d.getMonth()]); }
    const metric = $('#trendMetric')?.value || 'raw'; const fuenteSel = $('#fuente')?.value || 'reportes_cajeros';
    const data = [];
    for (const [yy,mm] of months){
      const s = new Date(yy,mm,1,0,0,0,0).getTime(); const e = new Date(yy,mm+1,1,0,0,0,0).getTime();
      const rows = (await getRowsByRange(fuenteSel, s, e)).map(r=>({ ...r, _ms:toMs(r.createdAt) }));
      data.push(metric==='raw' ? rows.length : (new Set(rows.map(getId))).size);
    }
    trendChart.data.labels = months.map(([yy,mm])=> `${['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'][mm]} ${String(yy).slice(-2)}`);
    trendChart.data.datasets[0].data = data; trendChart.update();
  }

  // Cobertura por Turbina
  async function computeCoverageByTurbina(fuente, rows){
    if (!db || !coverageChart) return;
    const masterColl = (fuente === 'reportes_oficinas') ? 'OFICINAS' : 'CAJEROS';

    let baseByT = {};
    try {
      const snap = await db.collection(masterColl).get();
      snap.docs.forEach(d => {
        const data = d.data() || {};
        const t = (data.TURBINA || data.turbina || '').toString();
        if (!t) return;
        baseByT[t] = (baseByT[t] || 0) + 1;
      });
    } catch (e) { console.warn('[Base TURBINA]', e); }

    const uniqSets = new Map();
    rows.forEach(r => { const t = getTurbinaRaw(r); const id = getId(r);
      if (!t || !id) return; if (!uniqSets.has(t)) uniqSets.set(t, new Set()); uniqSets.get(t).add(id); });

    const labels = Array.from(new Set([...Object.keys(baseByT), ...Array.from(uniqSets.keys())])).sort();
    const baseArr = labels.map(t => baseByT[t] || 0);
    const uniqArr = labels.map(t => (uniqSets.get(t)?.size || 0));
    const restArr = labels.map((_,i) => Math.max(0, baseArr[i] - uniqArr[i]));

    coverageChart.data.labels = labels;
    coverageChart.data.datasets[0].data = baseArr;
    coverageChart.data.datasets[1].data = uniqArr;
    coverageChart.data.datasets[2].data = restArr;
    coverageChart.update();
  }

  // --------- GEO helpers (preferir geo.usuario.lat/lng) ---------
  function pickLatLngSimple(obj){
    if (!obj) return null;
    const tryPairs = [[obj.lat, obj.lng],[obj.latitude, obj.longitude],[obj.Latitude, obj.Longitude]];
    for (const [a,b] of tryPairs){ const la = Number(a), lo = Number(b); if (Number.isFinite(la) && Number.isFinite(lo)) return [la, lo]; }
    return null;
  }
  function pickLatLngFromRow(r){
    const u = pickLatLngSimple(r?.geo?.usuario || r?.geo?.user); if (u) return u;
    const o = pickLatLngSimple(r?.geo?.cajero || r?.geo?.oficina || r?.geo?.local); if (o) return o;
    const flat = pickLatLngSimple({ lat: r?.lat, lng: r?.lng }); if (flat) return flat;
    return null;
  }

  // Mapa Heat (GPS)
  async function renderMapHeat(rows){
    if (!map) return;
    const ok = await ensureLeafletHeat();
    if (heatLayer && map.hasLayer(heatLayer)) { heatLayer.remove(); heatLayer = null; }
    const points = []; rows.forEach(r => { const ll = pickLatLngFromRow(r); if (!ll) return; points.push([ll[0], ll[1], 1]); });
    if (!points.length){ map.setView([-12.06,-77.04], 11); return; }
    if (ok && L.heatLayer){ heatLayer = L.heatLayer(points, { radius: 25, blur: 18, maxZoom: 17, minOpacity: 0.2 }).addTo(map); }
    else { points.forEach(([la,lo])=> L.circleMarker([la,lo], { radius:6, opacity:0, fillOpacity:0.35, fillColor:'#d61' }).addTo(map)); }
    const bounds = L.latLngBounds(points.map(p=>[p[0],p[1]])); map.fitBounds(bounds, { padding:[24,24] }); setTimeout(()=>map.invalidateSize(), 200);
  }

  // ---------- Eventos ----------
  $('#btnBuscar')?.addEventListener('click', queryData);
  $('#btnLimpiar')?.addEventListener('click', ()=>{
    $('#fuente').value = 'reportes_cajeros'; fillMonthYear(); $('#local').value = '';
    Array.from($('#f-turbina')?.options || []).forEach(o=>o.selected=false);
    $('#f-usuario') && ($('#f-usuario').value = ''); if (userDatalist) userDatalist.innerHTML = '';
    WEEKLY_RANK_ALL = []; queryData();
  });
  $('#fuente')?.addEventListener('change', ()=>{ queryData(); });
  $('#f-turbina')?.addEventListener('change', ()=>{ queryData(); });
  $('#f-usuario')?.addEventListener('change', ()=>{ queryData(); });
  $('#countMode')?.addEventListener('change', ()=>{ queryData(); });
  $('#trendMetric')?.addEventListener('change', ()=>{ renderTrend6Months(); });

  // ---------- Arranque ----------
  if (auth) {
    auth.onAuthStateChanged(u => { if (!u) { location.replace('index.html'); return; } loadPredictiveIDs(); queryData(); });
  } else { loadPredictiveIDs(); queryData(); }
})();
