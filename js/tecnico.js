/* ============================================================
   REPO PRINT · App del técnico (PWA, cola offline)
   Login PIN → árbol → cámara en vivo + máscara + ráfaga →
   revisión → subida en lote (nomenclatura) → confirmación
   ============================================================ */
(function () {
  'use strict';

  const cfg = window.REPO_PRINT_CONFIG;
  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

  const $ = (s, r = document) => r.querySelector(s);
  const el = (t, a = {}, h) => {
    const n = document.createElement(t);
    for (const k in a) {
      if (k === 'class') n.className = a[k];
      else if (k.startsWith('on') && typeof a[k] === 'function') n.addEventListener(k.slice(2), a[k]);
      else if (a[k] != null) n.setAttribute(k, a[k]);
    }
    if (h != null) n.innerHTML = h;
    return n;
  };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function toast(msg, type = 'info') { const t = el('div', { class: 'toast ' + type }, esc(msg)); $('#toast').appendChild(t); setTimeout(() => t.remove(), 3000); }
  const initials = (n) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
  const slugUp = (s) => s.toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z0-9]/g, '').slice(0, 22);

  const state = { tecnico: null, accent: '#006eb1', stack: [], nodos: [], currentNodo: null, pin: '', attempts: 0, captured: [], stream: null, tab: 'arbol', subFilter: 'all', subQuery: '' };

  // ============================================================
  // INDEXEDDB · cola de subidas
  // ============================================================
  let _db = null;
  function idb() {
    if (_db) return Promise.resolve(_db);
    return new Promise((res, rej) => {
      const r = indexedDB.open('repoprint', 1);
      r.onupgradeneeded = () => { const db = r.result; if (!db.objectStoreNames.contains('cola')) { const s = db.createObjectStore('cola', { keyPath: 'id', autoIncrement: true }); s.createIndex('nodo', 'nodo_id'); } };
      r.onsuccess = () => { _db = r.result; res(_db); }; r.onerror = () => rej(r.error);
    });
  }
  const idbOp = (mode, fn) => idb().then((db) => new Promise((res, rej) => { const tx = db.transaction('cola', mode); const st = tx.objectStore('cola'); const rq = fn(st); rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error); }));
  const idbAdd = (rec) => idbOp('readwrite', (st) => st.add(rec));
  const idbAll = () => idbOp('readonly', (st) => st.getAll()).then((r) => r || []);
  const idbPut = (rec) => idbOp('readwrite', (st) => st.put(rec));
  const idbDel = (id) => idbOp('readwrite', (st) => st.delete(id));

  // ============================================================
  // LOGIN POR PIN (con contador de intentos)
  // ============================================================
  async function initLogin() {
    const { data, error } = await sb.rpc('tecnicos_activos');
    const sel = $('#tec-select');
    if (error) { sel.innerHTML = '<option>Sin conexión — revisa tu señal</option>'; return; }
    sel.innerHTML = '<option value="">Selecciona tu nombre…</option>' + (data || []).map((t) => `<option value="${t.id}">${esc(t.nombre)}</option>`).join('');
    const last = localStorage.getItem('repo_last_tec'); if (last) sel.value = last;
  }
  function renderPin() { $('#pin-display').querySelectorAll('.pin-dot').forEach((d, i) => d.classList.toggle('filled', i < state.pin.length)); }
  $('#keypad').addEventListener('click', async (e) => {
    const b = e.target.closest('.key'); if (!b) return; const k = b.dataset.k; $('#pin-error').textContent = '';
    if (k === 'del') { state.pin = state.pin.slice(0, -1); return renderPin(); }
    if (k === 'ok') return doLogin();
    if (state.pin.length < 4) { state.pin += k; renderPin(); }
    if (state.pin.length === 4) setTimeout(doLogin, 150);
  });
  async function doLogin() {
    const tecId = $('#tec-select').value;
    if (!tecId) { $('#pin-error').textContent = 'Selecciona tu nombre primero'; return; }
    if (state.pin.length !== 4) { $('#pin-error').textContent = 'Ingresa tu PIN de 4 dígitos'; return; }
    const { data, error } = await sb.rpc('tecnico_login', { p_tecnico_id: tecId, p_pin: state.pin });
    if (error || !data || data.length === 0) {
      state.attempts++; const rest = Math.max(0, 3 - state.attempts);
      $('#pin-error').textContent = error ? 'Sin conexión' : `PIN incorrecto. Te quedan ${rest} intento(s).`;
      state.pin = ''; renderPin(); navigator.vibrate && navigator.vibrate(200); return;
    }
    state.tecnico = data[0]; state.attempts = 0;
    sessionStorage.setItem('repo_tec', JSON.stringify(data[0])); localStorage.setItem('repo_last_tec', tecId);
    enterApp();
  }
  async function enterApp() {
    $('#login').classList.add('hidden'); $('#tbar').classList.remove('hidden'); $('#screen').classList.remove('hidden');
    $('#btn-logout').textContent = initials(state.tecnico.nombre);
    try {
      const { data: c } = await sb.from('configuracion').select('accent_color').eq('id', 1).maybeSingle();
      if (c && c.accent_color) { state.accent = c.accent_color; document.documentElement.style.setProperty('--accent', c.accent_color); }
    } catch (_) { /* sin conexión u otro: se mantiene el accent por defecto */ }
    try { await loadNodos(); } catch (_) { /* usa caché local si existe */ }
    state.stack = []; renderTree(); flushQueue(); updateBadge();
  }
  $('#btn-logout').addEventListener('click', async () => {
    const pend = (await idbAll()).filter((r) => r.status !== 'done').length;
    if (!confirm(pend ? `Tienes ${pend} foto(s) sin subir. ¿Cerrar sesión igual?` : '¿Cerrar sesión?')) return;
    stopCamera(); sessionStorage.removeItem('repo_tec'); location.reload();
  });

  // ============================================================
  // ÁRBOL
  // ============================================================
  async function loadNodos() {
    const { data } = await sb.from('nodos').select('id,parent_id,nombre,tipo,con_mascara,drive_url,orden,region,provincia,distrito,direccion').order('orden', { ascending: true });
    if (data) { state.nodos = data; localStorage.setItem('repo_nodos', JSON.stringify(data)); }
    else { const c = localStorage.getItem('repo_nodos'); if (c) state.nodos = JSON.parse(c); }
  }
  const childrenOf = (pid) => state.nodos.filter((n) => n.parent_id === pid).sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre));
  const rutaActual = () => state.stack.map((n) => n.nombre).join(' › ');
  const colegioActual = () => state.stack[1] || state.stack[0] || null;
  // Ubicación leída desde la BD (nodo del colegio). null si aún no está cargada.
  function locActual() {
    const c = colegioActual();
    return c && c.direccion ? { direccion: c.direccion, distrito: c.distrito, provincia: c.provincia, region: c.region } : null;
  }

  function setBar(title, sub, back) { $('#tbar-title').textContent = title; $('#tbar-sub').textContent = sub || ''; $('#btn-back').classList.toggle('hidden', !back); }

  // El "punto de decisión": un nodo cuyos hijos son exactamente
  // «1. REGISTRO FOTOGRÁFICO» (con máscara, por grupos) + «2. SUBIDA DOCUMENTOS» (libre).
  function decisionPoint(items) {
    if (items.length !== 2) return null;
    const reg = items.find((n) => n.tipo === 'contenedor' && /REGISTRO/i.test(n.nombre));
    const doc = items.find((n) => n.tipo === 'subida' && /(DOCUMENTOS|SUBIDA)/i.test(n.nombre));
    return reg && doc ? { reg, doc } : null;
  }
  function breadcrumb() {
    const cb = el('div', { class: 'crumb-bar' });
    cb.innerHTML = '📍 ' + state.stack.map((n) => esc(n.nombre)).join(' <span style="color:#c4c9cf">›</span> ');
    return cb;
  }

  // ---- Resolución de rutas (para la pantalla global de Subidas) ----
  const nodoById = (id) => state.nodos.find((n) => String(n.id) === String(id));
  function pathOf(nodoId) {
    const parts = []; let n = nodoById(nodoId), guard = 0;
    while (n && guard++ < 20) { parts.unshift(n.nombre); n = n.parent_id ? nodoById(n.parent_id) : null; }
    return parts;
  }

  // ---- Navegación inferior (Carpetas / Subidas) ----
  function setNav(visible, tab) {
    const nv = $('#navbar'); if (!nv) return;
    nv.classList.toggle('hidden', !visible);
    if (tab) { state.tab = tab; nv.querySelectorAll('.navb').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab)); }
  }
  $('#navbar').addEventListener('click', (e) => {
    const b = e.target.closest('.navb'); if (!b) return;
    const tab = b.dataset.tab;
    if (state.captured.length && !confirm('Tienes fotos sin subir en esta tanda. ¿Salir?')) return;
    state.captured = []; stopCamera();
    if (tab === 'subidas') renderSubidas();
    else { state.currentNodo = null; renderTree(); }
  });

  function renderTree() {
    state.currentNodo = null; stopCamera(); setNav(true, 'arbol');
    const parent = state.stack.length ? state.stack[state.stack.length - 1] : null;
    const items = childrenOf(parent ? parent.id : null);
    // ¿Llegamos a un colegio/taller? → pantalla «¿Qué registrarás?»
    const dec = parent && decisionPoint(items);
    if (dec) return renderChoice(parent, dec.reg, dec.doc);
    setBar(parent ? parent.nombre : 'Proyectos', parent ? rutaActual() : `Hola, ${state.tecnico.nombre}`, state.stack.length > 0);
    const screen = $('#screen'); screen.innerHTML = '';
    if (parent) screen.appendChild(breadcrumb());
    if (items.length === 0) { screen.appendChild(el('div', { class: 'empty' }, '<div class="ic">📭</div><p>No hay carpetas aquí.</p>')); return; }
    // ¿Estamos dentro de «1. REGISTRO FOTOGRÁFICO»? Entonces los hijos son grupos (1.1, 1.2…).
    const esGrupos = parent && /REGISTRO/i.test(parent.nombre);
    if (esGrupos) screen.appendChild(el('div', { class: 'group-hint' }, 'Toca un grupo para tomar o ver sus fotos.'));
    const list = el('div', { class: 'list' });
    items.forEach((n) => {
      const isSub = n.tipo === 'subida';
      const card = el('div', { class: 'node-card' + (isSub ? ' group' : '') });
      if (isSub) {
        card.dataset.nid = n.id;
        card.innerHTML = `<div class="nic sub">📷</div>
          <div class="nbody"><div class="nname">${esc(n.nombre)}</div>
          <div class="nmeta" data-meta>${n.con_mascara ? 'Cargando…' : '📄 Subida libre'}</div></div>
          <div class="gstat" data-gstat></div>`;
      } else {
        card.innerHTML = `<div class="nic cont">📁</div><div class="nbody"><div class="nname">${esc(n.nombre)}</div><div class="nmeta">${childrenOf(n.id).length} carpeta(s)</div></div><div class="chev">›</div>`;
      }
      card.addEventListener('click', () => { if (isSub) openFolder(n); else { state.stack.push(n); renderTree(); } });
      list.appendChild(card);
    });
    screen.appendChild(list);
    decorateGroups();
  }

  // Pantalla «¿Qué registrarás?» — registro fotográfico (con máscara) vs documentos (libre)
  function renderChoice(parent, reg, doc) {
    state.currentNodo = null; stopCamera();
    setBar(parent.nombre, rutaActual(), true);
    const screen = $('#screen'); screen.innerHTML = '';
    screen.appendChild(breadcrumb());
    screen.appendChild(el('div', { class: 'choice-head' }, '<div class="ch-q">¿Qué registrarás?</div><div class="ch-sub">Elige el tipo de registro para esta ubicación</div>'));
    const wrap = el('div', { class: 'choice' });
    const cReg = el('button', { class: 'choice-card reg' });
    cReg.innerHTML = `<div class="cc-ic reg">📷</div>
      <div class="cc-body"><div class="cc-t">Registro fotográfico</div>
      <div class="cc-d">Fotos con máscara, organizadas por grupos</div>
      <div class="cc-tags"><span class="cc-tag">📍 Con ubicación</span><span class="cc-tag">🗂 ${childrenOf(reg.id).length} grupos</span></div></div>
      <div class="cc-go">→</div>`;
    cReg.addEventListener('click', () => { state.stack.push(reg); renderTree(); });
    const cDoc = el('button', { class: 'choice-card doc' });
    cDoc.innerHTML = `<div class="cc-ic doc">📄</div>
      <div class="cc-body"><div class="cc-t">Documentos</div>
      <div class="cc-d">Cámara limpia, sin máscara</div>
      <div class="cc-tags"><span class="cc-tag">📎 Subida libre</span></div></div>
      <div class="cc-go">→</div>`;
    cDoc.addEventListener('click', () => openFolder(doc));
    wrap.appendChild(cReg); wrap.appendChild(cDoc);
    screen.appendChild(wrap);
    decorateChoice(reg, doc);
  }

  // Rellena los contadores de fotos de cada grupo (lista) leyendo la cola local.
  async function decorateGroups() {
    const cards = $('#screen').querySelectorAll('.node-card[data-nid]');
    if (!cards.length) return;
    const all = await idbAll();
    cards.forEach((card) => {
      const id = card.dataset.nid;
      const meta = card.querySelector('[data-meta]'); const gs = card.querySelector('[data-gstat]');
      if (!meta) return;
      const recs = all.filter((r) => String(r.nodo_id) === String(id));
      if (!recs.length) { meta.textContent = 'Sin fotos aún'; meta.className = 'nmeta soft'; gs.className = 'gstat'; gs.textContent = ''; return; }
      const c = { done: 0, uploading: 0, pending: 0, error: 0 }; recs.forEach((r) => c[r.status]++);
      const enCola = c.pending + c.uploading;
      if (c.error) { meta.innerHTML = `<span class="gm err">! ${c.error} con error</span>` + (c.done ? ` · ${c.done} subidas` : ''); gs.className = 'gstat error'; gs.textContent = '!'; }
      else if (enCola) { meta.innerHTML = (c.done ? `${c.done} subidas · ` : '') + `<span class="gm pend">☁ ${enCola} en cola${navigator.onLine ? '' : ' · sin conexión'}</span>`; gs.className = 'gstat pending'; gs.textContent = '☁'; }
      else { meta.innerHTML = `<span class="gm ok">✓ ${c.done} foto(s) subida(s)</span>`; gs.className = 'gstat done'; gs.textContent = '✓'; }
      meta.classList.add('nmeta');
    });
  }
  // Contadores en las dos tarjetas de la pantalla de elección.
  async function decorateChoice(reg, doc) {
    const all = await idbAll();
    const ids = new Set(childrenOf(reg.id).map((n) => String(n.id)));
    const nReg = all.filter((r) => ids.has(String(r.nodo_id))).length;
    const nDoc = all.filter((r) => String(r.nodo_id) === String(doc.id)).length;
    const tag = (card, n) => { const t = $('#screen').querySelector(card + ' .cc-count'); if (t) return; const body = $('#screen').querySelector(card + ' .cc-tags'); if (body && n) body.insertAdjacentHTML('beforeend', `<span class="cc-tag cc-count ok">✓ ${n} en cola/subidas</span>`); };
    tag('.choice-card.reg', nReg); tag('.choice-card.doc', nDoc);
  }

  // ============================================================
  // PANTALLA GLOBAL · SUBIDAS / COLA (búsqueda + filtros)
  // ============================================================
  function renderSubidas() {
    state.currentNodo = null; stopCamera(); setNav(true, 'subidas');
    setBar('Subidas', `Técnico · ${state.tecnico.nombre}`, false);
    const screen = $('#screen'); screen.innerHTML = '';
    const search = el('div', { class: 'sub-search' });
    search.innerHTML = `<span class="ss-ic">🔎</span><input id="sub-q" type="search" placeholder="Buscar colegio, grupo o archivo…" value="${esc(state.subQuery)}">`;
    screen.appendChild(search);
    const pills = el('div', { class: 'sub-pills' });
    const defs = [['all', 'Todas'], ['done', '✓ Subidas'], ['queue', '☁ En cola'], ['error', '! Error']];
    pills.innerHTML = defs.map(([k, l]) => `<button class="spill ${state.subFilter === k ? 'active' : ''}" data-f="${k}">${l}</button>`).join('');
    screen.appendChild(pills);
    screen.appendChild(el('div', { class: 'sub-list', id: 'sub-list' }));
    pills.addEventListener('click', (e) => { const b = e.target.closest('.spill'); if (!b) return; state.subFilter = b.dataset.f; pills.querySelectorAll('.spill').forEach((x) => x.classList.toggle('active', x.dataset.f === state.subFilter)); paintSubList(); });
    const inp = $('#sub-q'); inp.addEventListener('input', () => { state.subQuery = inp.value; paintSubList(); });
    paintSubList();
  }
  async function paintSubList() {
    const cont = $('#sub-list'); if (!cont) return;
    const all = (await idbAll()).sort((a, b) => b.id - a.id);
    const tot = { done: 0, queue: 0, error: 0 };
    all.forEach((s) => { if (s.status === 'done') tot.done++; else if (s.status === 'error') tot.error++; else tot.queue++; });
    const q = state.subQuery.trim().toLowerCase();
    const passF = (s) => state.subFilter === 'all' || (state.subFilter === 'done' && s.status === 'done') || (state.subFilter === 'error' && s.status === 'error') || (state.subFilter === 'queue' && (s.status === 'pending' || s.status === 'uploading'));
    const rows = all.map((s) => ({ s, path: pathOf(s.nodo_id) })).filter(({ s, path }) => passF(s) && (!q || (s.filename + ' ' + path.join(' ')).toLowerCase().includes(q)));
    cont.innerHTML = '';
    cont.appendChild(el('div', { class: 'sub-summary' },
      `<span class="chip ok">✓ ${tot.done} subidas</span>` +
      `<span class="chip pend">☁ ${tot.queue} en cola</span>` +
      (tot.error ? `<span class="chip err">! ${tot.error} error</span>` : '')));
    if (rows.length === 0) {
      cont.appendChild(el('div', { class: 'empty', style: 'padding:48px 24px' }, `<div class="ic">${all.length ? '🔍' : '☁️'}</div><p>${all.length ? 'Nada coincide con tu búsqueda.' : 'Aún no has tomado fotos.<br>Ve a Carpetas para empezar.'}</p>`));
      return;
    }
    const lbl = { pending: 'En cola', uploading: 'Subiendo…', done: 'Subida', error: 'Error — toca para reintentar' };
    let curGroup = null;
    rows.forEach(({ s, path }) => {
      const gk = (path[0] || '') + (path[1] ? ' › ' + path[1] : '');
      if (gk !== curGroup) { curGroup = gk; cont.appendChild(el('div', { class: 'sub-group-h' }, '🏫 ' + esc(gk || 'Sin ubicación'))); }
      const hora = new Date(s.fecha).toLocaleString('es-PE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
      const cola = path.slice(2).join(' › ') || path[path.length - 1] || '';
      const row = el('div', { class: 'frow' });
      row.innerHTML = `<img class="fthumb" src="${s.thumb}">
        <div class="fbody">
          <div class="fname">${esc(s.filename)}</div>
          <div class="sub-path">${esc(cola)}</div>
          <div class="fmeta st-${s.status}">${s.status === 'uploading' ? '<div class="fbar"><i></i></div>' : `${lbl[s.status]} · ${hora}`}</div>
        </div>
        <div class="fstat ${s.status}">${s.status === 'done' ? '✓' : s.status === 'error' ? '!' : s.status === 'uploading' ? '↻' : '☁'}</div>`;
      if (s.status === 'error') { row.style.cursor = 'pointer'; row.addEventListener('click', () => { toast('Reintentando subida…'); flushQueue(); }); }
      cont.appendChild(row);
    });
  }
  $('#btn-back').addEventListener('click', () => {
    if (state.captured.length) { if (!confirm('Tienes fotos sin subir en esta tanda. ¿Descartarlas?')) return; state.captured = []; }
    stopCamera();
    if (state.currentNodo) { state.currentNodo = null; renderTree(); return; }
    if (state.stack.length) { state.stack.pop(); renderTree(); }
  });

  // ============================================================
  // CARPETA DE SUBIDA (vista grupo: chips + lista + Tomar fotos)
  // ============================================================
  async function openFolder(nodo) {
    state.currentNodo = nodo; stopCamera(); setNav(false);
    setBar(nodo.nombre, rutaActual(), true);
    const screen = $('#screen'); screen.innerHTML = '';
    screen.appendChild(el('div', { class: 'crumb-bar' }, '📍 ' + esc(rutaActual())));
    const chips = el('div', { class: 'chips-row', id: 'chips' }); screen.appendChild(chips);
    screen.appendChild(el('div', { class: 'filelist', id: 'filelist' }));
    const bar = el('div', { class: 'capture-bar' });
    const driveBtn = el('button', { class: 'btn btn-secondary', title: 'Abrir en Drive' }, '🔗');
    driveBtn.addEventListener('click', () => nodo.drive_url ? window.open(nodo.drive_url, '_blank') : toast('Carpeta de Drive aún no creada', 'err'));
    const camBtn = el('button', { class: 'btn btn-primary' }, '📸 Tomar fotos');
    camBtn.addEventListener('click', () => openCamera(nodo));
    bar.appendChild(driveBtn); bar.appendChild(camBtn); screen.appendChild(bar);
    await renderFolder();
  }
  async function renderFolder() {
    const all = (await idbAll()).filter((s) => s.nodo_id === state.currentNodo.id).sort((a, b) => b.id - a.id);
    const cnt = { done: 0, uploading: 0, pending: 0, error: 0 }; all.forEach((s) => cnt[s.status]++);
    const chips = $('#chips'); if (chips) chips.innerHTML =
      `<span class="chip ok">✓ ${cnt.done} subidas</span>` +
      (cnt.uploading ? `<span class="chip up">↻ ${cnt.uploading} subiendo</span>` : '') +
      (cnt.pending ? `<span class="chip pend">☁ ${cnt.pending} en cola</span>` : '') +
      (cnt.error ? `<span class="chip err">! ${cnt.error} error</span>` : '');
    const fl = $('#filelist'); if (!fl) return; fl.innerHTML = '';
    if (all.length === 0) { fl.appendChild(el('div', { class: 'empty', style: 'padding:40px 20px' }, '<div class="ic">📸</div><p>Aún no hay fotos.<br>Toca “Tomar fotos” para empezar.</p>')); return; }
    const lbl = { pending: 'En cola', uploading: 'Subiendo…', done: 'Subida', error: 'Error de subida' };
    all.forEach((s) => {
      const row = el('div', { class: 'frow' });
      const hora = new Date(s.fecha).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });
      row.innerHTML = `<img class="fthumb" src="${s.thumb}">
        <div class="fbody"><div class="fname">${esc(s.filename)}</div>
        <div class="fmeta st-${s.status}">${s.status === 'uploading' ? `<div class="fbar"><i></i></div>` : `${lbl[s.status]} · ${hora}`}</div></div>
        <div class="fstat ${s.status}">${s.status === 'done' ? '✓' : s.status === 'error' ? '!' : s.status === 'uploading' ? '↻' : '☁'}</div>`;
      if (s.status === 'error') { row.style.cursor = 'pointer'; row.addEventListener('click', () => flushQueue()); }
      fl.appendChild(row);
    });
  }

  // ============================================================
  // CÁMARA EN VIVO + MÁSCARA EN TIEMPO REAL + RÁFAGA
  // ============================================================
  async function openCamera(nodo) {
    state.captured = []; setNav(false);
    setBar(nodo.nombre, 'Cámara', true);
    const screen = $('#screen'); screen.innerHTML = '';
    const cam = el('div', { class: 'cam' });
    cam.innerHTML = `
      <video id="cam-video" autoplay playsinline muted></video>
      ${nodo.con_mascara ? `<div class="cam-mask" id="cam-mask">
        <div class="cm-logo"><img src="assets/logo.svg" alt="INROPRIN"></div>
        <div class="cm-line" id="cm-fecha"></div>
        <div class="cm-line" id="cm-loc"></div>
        <div class="cm-node">${esc(nodo.nombre)}</div></div>` : '<div class="cam-doc">Modo documento · sin máscara</div>'}
      <div class="cam-bar">
        <button class="cam-thumbs" id="cam-thumbs"></button>
        <button class="shutter" id="shutter"></button>
        <button class="btn-review" id="btn-review" disabled>Revisar</button>
      </div>`;
    screen.appendChild(cam);
    // máscara en vivo
    if (nodo.con_mascara) {
      const loc = locActual();
      $('#cm-fecha').textContent = '🕓 ' + new Date().toLocaleString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
      $('#cm-loc').textContent = loc ? `📍 ${loc.direccion} · ${loc.distrito} · ${loc.provincia}` : `📍 ${(colegioActual() || {}).nombre || ''}`;
    }
    $('#shutter').addEventListener('click', takeShot);
    $('#btn-review').addEventListener('click', openReview);
    try {
      state.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      $('#cam-video').srcObject = state.stream;
    } catch (e) { toast('No se pudo abrir la cámara. Revisa permisos.', 'err'); }
  }
  function stopCamera() { if (state.stream) { state.stream.getTracks().forEach((t) => t.stop()); state.stream = null; } }

  function takeShot() {
    const v = $('#cam-video'); if (!v || !v.videoWidth) return;
    const max = 1600, scale = Math.min(1, max / Math.max(v.videoWidth, v.videoHeight));
    const w = Math.round(v.videoWidth * scale), h = Math.round(v.videoHeight * scale);
    const c = $('#canvas'); c.width = w; c.height = h; const ctx = c.getContext('2d');
    ctx.drawImage(v, 0, 0, w, h);
    if (state.currentNodo.con_mascara) burnMask(ctx, w, h);
    const full = c.toDataURL('image/jpeg', 0.85);
    state.captured.push(full);
    navigator.vibrate && navigator.vibrate(40);
    const tb = $('#cam-thumbs'); tb.style.backgroundImage = `url(${full})`; tb.innerHTML = `<span>${state.captured.length}</span>`;
    const rv = $('#btn-review'); rv.disabled = false; rv.textContent = `Revisar (${state.captured.length})`;
  }

  // Pre-load INROPRIN logo so burnMask can draw it synchronously
  const _maskLogo = new Image(); _maskLogo.src = 'assets/logo.svg';

  function burnMask(ctx, w, h) {
    const pad = Math.round(w * .032);

    // === TOP strip: INROPRIN logo ===
    const topH = Math.round(h * 0.09);
    const topG = ctx.createLinearGradient(0, 0, 0, topH);
    topG.addColorStop(0, 'rgba(0,0,0,.72)'); topG.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = topG; ctx.fillRect(0, 0, w, topH);
    if (_maskLogo.complete && _maskLogo.naturalWidth) {
      const lh = Math.round(topH * .66);
      ctx.drawImage(_maskLogo, pad, Math.round((topH - lh) / 2), lh, lh);
    }

    // === BOTTOM bar: timestamp · location · node name (3 separate lines) ===
    const barH = Math.round(h * 0.21);
    const bg = ctx.createLinearGradient(0, h - barH, 0, h);
    bg.addColorStop(0, 'rgba(0,0,0,0)'); bg.addColorStop(.28, 'rgba(0,0,0,.50)'); bg.addColorStop(1, 'rgba(0,0,0,.82)');
    ctx.fillStyle = bg; ctx.fillRect(0, h - barH, w, barH);

    const fs = Math.max(11, Math.round(w * .023));
    const lnH = Math.round(fs * 1.72);

    // Node name — right, top line, light blue tint
    ctx.textAlign = 'right';
    ctx.font = `700 ${Math.max(10, Math.round(fs * .88))}px Manrope, sans-serif`;
    ctx.fillStyle = 'rgba(191,224,245,.95)';
    ctx.fillText(state.currentNodo.nombre.slice(0, 45), w - pad, h - pad - lnH * 2);

    // Timestamp — left, middle line
    ctx.textAlign = 'left'; ctx.fillStyle = '#fff';
    ctx.font = `600 ${fs}px Manrope, sans-serif`;
    ctx.fillText('🕓 ' + new Date().toLocaleString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }), pad, h - pad - lnH);

    // Location — left, bottom line
    const loc = locActual();
    const locText = loc ? `📍 ${loc.direccion}, ${loc.distrito}, ${loc.provincia}` : `📍 ${(colegioActual() || {}).nombre || ''}`;
    // Truncate if too long to avoid overflow
    ctx.fillText(locText.slice(0, 70), pad, h - pad);

    // Accent left stripe
    ctx.fillStyle = state.accent;
    ctx.fillRect(0, h - barH, Math.round(w * .012), barH);
  }

  // ============================================================
  // REVISIÓN (descartar antes de subir)
  // ============================================================
  function openReview() {
    stopCamera(); setNav(false);
    setBar(`Revisar ${state.captured.length} fotos`, state.currentNodo.nombre, true);
    const screen = $('#screen'); screen.innerHTML = '';
    screen.appendChild(el('div', { class: 'review-hint' }, 'Toca ✕ para descartar una foto antes de subir.'));
    const grid = el('div', { class: 'review-grid', id: 'rev-grid' }); screen.appendChild(grid);
    const renderGrid = () => {
      grid.innerHTML = '';
      state.captured.forEach((src, i) => {
        const cell = el('div', { class: 'rev-cell' });
        cell.innerHTML = `<img src="${src}"><button class="rev-x">✕</button>`;
        cell.querySelector('.rev-x').addEventListener('click', () => { state.captured.splice(i, 1); if (!state.captured.length) return openCamera(state.currentNodo); renderGrid(); });
        grid.appendChild(cell);
      });
      const more = el('div', { class: 'rev-cell more', onclick: () => openCamera(state.currentNodo) }, '<div>+<br><small>Tomar más</small></div>');
      grid.appendChild(more);
    };
    renderGrid();
    const bar = el('div', { class: 'capture-bar' });
    const discard = el('button', { class: 'btn btn-secondary', style: 'flex:0 0 auto;color:#c20512' }, 'Descartar todo');
    discard.addEventListener('click', () => { if (confirm('¿Descartar todas las fotos de esta tanda?')) { state.captured = []; openCamera(state.currentNodo); } });
    const up = el('button', { class: 'btn btn-primary' }, `⬆ Subir ${state.captured.length} foto(s)`);
    up.addEventListener('click', subirLote);
    bar.appendChild(discard); bar.appendChild(up); screen.appendChild(bar);
  }

  // ============================================================
  // SUBIDA EN LOTE + NOMENCLATURA + CONFIRMACIÓN
  // ============================================================
  function nomenclatura(seq) {
    const segs = state.stack.filter((n) => !/^\s*1\.\s*REGISTRO|^\s*2\.\s*SUBIDA/i.test(n.nombre)).map((n) => slugUp(n.nombre));
    segs.push(slugUp(state.currentNodo.nombre));
    const d = new Date();
    const p = (x) => String(x).padStart(2, '0');
    const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
    return `${segs.join('_')}_${stamp}_${p(seq)}.jpg`;
  }
  async function downscale(dataUrl, max = 240, q = 0.7) {
    return new Promise((res) => { const i = new Image(); i.onload = () => { const sc = Math.min(1, max / Math.max(i.width, i.height)); const c = $('#canvas'); c.width = Math.round(i.width * sc); c.height = Math.round(i.height * sc); c.getContext('2d').drawImage(i, 0, 0, c.width, c.height); res(c.toDataURL('image/jpeg', q)); }; i.src = dataUrl; });
  }
  async function subirLote() {
    const fotos = state.captured.slice(); state.captured = [];
    const base = (await idbAll()).filter((s) => s.nodo_id === state.currentNodo.id).length;
    const nombres = [];
    for (let i = 0; i < fotos.length; i++) {
      const filename = nomenclatura(base + i + 1); nombres.push(filename);
      const loc = locActual();
      const thumb = await downscale(fotos[i]);
      await idbAdd({
        tecnico_id: state.tecnico.id, nodo_id: state.currentNodo.id, filename,
        base64: fotos[i].split(',')[1], thumb, mime: 'image/jpeg',
        direccion: loc ? `${loc.direccion}, ${loc.distrito}, ${loc.provincia}` : ((colegioActual() || {}).nombre || null),
        fecha: new Date().toISOString(), status: 'pending',
      });
    }
    updateBadge(); flushQueue();
    openConfirm(fotos.length, nombres);
  }
  function openConfirm(n, nombres) {
    setNav(false);
    setBar('¡Listo!', state.currentNodo.nombre, true);
    const screen = $('#screen'); screen.innerHTML = '';
    const c = el('div', { class: 'confirm' });
    c.innerHTML = `<div class="confirm-ic">✓</div>
      <div class="confirm-t">¡Listo!</div>
      <div class="confirm-s">${n} foto(s) en cola para<br>${esc(state.currentNodo.nombre)}</div>
      <div class="nomen"><div class="nomen-l">NOMENCLATURA GENERADA</div><div class="nomen-v">${esc(nombres[0] || '')}</div></div>`;
    screen.appendChild(c);
    const bar = el('div', { class: 'capture-bar' });
    const volver = el('button', { class: 'btn btn-secondary', onclick: () => openFolder(state.currentNodo) }, 'Ver carpeta');
    const mas = el('button', { class: 'btn btn-primary', onclick: () => openCamera(state.currentNodo) }, '📸 Tomar más');
    bar.appendChild(volver); bar.appendChild(mas); screen.appendChild(bar);
  }

  // ============================================================
  // COLA OFFLINE · sincronización
  // ============================================================
  let _flushing = false;
  async function flushQueue() {
    if (_flushing || !navigator.onLine) return; _flushing = true;
    try {
      const pend = (await idbAll()).filter((r) => r.status === 'pending' || r.status === 'error');
      for (const rec of pend) {
        rec.status = 'uploading'; await idbPut(rec); refresh();
        const { data, error } = await sb.functions.invoke('drive-upload', {
          body: { tecnico_id: rec.tecnico_id, nodo_id: rec.nodo_id, filename: rec.filename, image_base64: rec.base64, mime: rec.mime, direccion: rec.direccion, fecha_captura: rec.fecha },
        });
        if (error || (data && data.error)) { rec.status = 'error'; await idbPut(rec); if (!navigator.onLine) break; }
        else { rec.status = 'done'; rec.drive_url = data.drive_url; rec.base64 = null; await idbPut(rec); }
        refresh();
      }
    } finally { _flushing = false; }
  }
  function refresh() {
    updateBadge();
    if (state.tab === 'subidas' && $('#sub-list')) paintSubList();
    else if (state.currentNodo && $('#filelist')) renderFolder();
    else decorateGroups();
  }
  async function updateBadge() {
    const pend = (await idbAll()).filter((r) => r.status !== 'done').length;
    let b = $('#pend-badge');
    if (!b) { b = el('div', { id: 'pend-badge', class: 'pend-badge', onclick: () => renderSubidas() }); $('#tbar').insertBefore(b, $('#btn-logout')); }
    if (pend > 0) { b.classList.remove('hidden'); b.innerHTML = `<span class="${navigator.onLine ? 'dot-on' : 'dot-off'}"></span>${pend}`; } else b.classList.add('hidden');
    const nb = $('#nav-badge');
    if (nb) { if (pend > 0) { nb.classList.remove('hidden'); nb.textContent = pend; } else nb.classList.add('hidden'); }
  }
  window.addEventListener('online', () => { toast('Conexión restablecida — subiendo…'); flushQueue(); });
  window.addEventListener('offline', () => { toast('Sin conexión — se guardará en cola', 'info'); refresh(); });
  setInterval(() => { if (state.tecnico && navigator.onLine) flushQueue(); }, 30000);

  // ============================================================
  // Boot + Service Worker
  // ============================================================
  if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  (async () => {
    await initLogin();
    const saved = sessionStorage.getItem('repo_tec');
    if (saved) { try { state.tecnico = JSON.parse(saved); enterApp(); } catch (_) { sessionStorage.removeItem('repo_tec'); } }
  })();
})();
