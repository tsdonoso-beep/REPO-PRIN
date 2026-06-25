/* ============================================================
   REPO PRINT · App del técnico (móvil, PWA con cola offline)
   Login por PIN → árbol → captura con máscara → cola IndexedDB → Drive
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
  function toast(msg, type = 'info') {
    const t = el('div', { class: 'toast ' + type }, esc(msg));
    $('#toast').appendChild(t); setTimeout(() => t.remove(), 3000);
  }
  const initials = (n) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');

  const state = { tecnico: null, accent: '#006eb1', stack: [], nodos: [], lastPos: null, currentNodo: null, pin: '' };

  // ============================================================
  // INDEXEDDB · cola de subidas (persistente offline)
  // ============================================================
  let _db = null;
  function idb() {
    if (_db) return Promise.resolve(_db);
    return new Promise((res, rej) => {
      const r = indexedDB.open('repoprint', 1);
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains('cola')) {
          const s = db.createObjectStore('cola', { keyPath: 'id', autoIncrement: true });
          s.createIndex('nodo', 'nodo_id'); s.createIndex('status', 'status');
        }
      };
      r.onsuccess = () => { _db = r.result; res(_db); };
      r.onerror = () => rej(r.error);
    });
  }
  async function idbAdd(rec) {
    const db = await idb();
    return new Promise((res, rej) => {
      const tx = db.transaction('cola', 'readwrite');
      const req = tx.objectStore('cola').add(rec);
      req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error);
    });
  }
  async function idbAll() {
    const db = await idb();
    return new Promise((res, rej) => {
      const req = db.transaction('cola', 'readonly').objectStore('cola').getAll();
      req.onsuccess = () => res(req.result || []); req.onerror = () => rej(req.error);
    });
  }
  async function idbPut(rec) {
    const db = await idb();
    return new Promise((res, rej) => {
      const req = db.transaction('cola', 'readwrite').objectStore('cola').put(rec);
      req.onsuccess = () => res(); req.onerror = () => rej(req.error);
    });
  }
  async function idbDel(id) {
    const db = await idb();
    return new Promise((res, rej) => {
      const req = db.transaction('cola', 'readwrite').objectStore('cola').delete(id);
      req.onsuccess = () => res(); req.onerror = () => rej(req.error);
    });
  }

  // ============================================================
  // LOGIN POR PIN
  // ============================================================
  async function initLogin() {
    const { data, error } = await sb.rpc('tecnicos_activos');
    const sel = $('#tec-select');
    if (error) { sel.innerHTML = '<option>Sin conexión — revisa tu señal</option>'; return; }
    sel.innerHTML = '<option value="">Selecciona tu nombre…</option>' +
      (data || []).map((t) => `<option value="${t.id}">${esc(t.nombre)}</option>`).join('');
    const lastTec = localStorage.getItem('repo_last_tec');
    if (lastTec) sel.value = lastTec;
  }
  function renderPin() {
    $('#pin-display').querySelectorAll('.pin-dot').forEach((d, i) => d.classList.toggle('filled', i < state.pin.length));
  }
  $('#keypad').addEventListener('click', async (e) => {
    const btn = e.target.closest('.key'); if (!btn) return;
    const k = btn.dataset.k; $('#pin-error').textContent = '';
    if (k === 'del') { state.pin = state.pin.slice(0, -1); renderPin(); return; }
    if (k === 'ok') { await doLogin(); return; }
    if (state.pin.length < 4) { state.pin += k; renderPin(); }
    if (state.pin.length === 4) setTimeout(doLogin, 150);
  });
  async function doLogin() {
    const tecId = $('#tec-select').value;
    if (!tecId) { $('#pin-error').textContent = 'Selecciona tu nombre primero'; return; }
    if (state.pin.length !== 4) { $('#pin-error').textContent = 'Ingresa tu PIN de 4 dígitos'; return; }
    const { data, error } = await sb.rpc('tecnico_login', { p_tecnico_id: tecId, p_pin: state.pin });
    if (error || !data || data.length === 0) {
      $('#pin-error').textContent = error ? 'Sin conexión' : 'PIN incorrecto';
      state.pin = ''; renderPin(); navigator.vibrate && navigator.vibrate(200); return;
    }
    state.tecnico = data[0];
    sessionStorage.setItem('repo_tec', JSON.stringify(data[0]));
    localStorage.setItem('repo_last_tec', tecId);
    enterApp();
  }
  async function enterApp() {
    $('#login').classList.add('hidden');
    $('#tbar').classList.remove('hidden');
    $('#screen').classList.remove('hidden');
    $('#btn-logout').textContent = initials(state.tecnico.nombre);
    const { data: c } = await sb.from('configuracion').select('accent_color').eq('id', 1).single().catch(() => ({ data: null }));
    if (c && c.accent_color) { state.accent = c.accent_color; document.documentElement.style.setProperty('--accent', c.accent_color); }
    requestGPS();
    await loadNodos();
    state.stack = [];
    renderTree();
    flushQueue();
    updatePendingBadge();
  }
  $('#btn-logout').addEventListener('click', async () => {
    const pend = (await idbAll()).filter((r) => r.status !== 'done').length;
    const msg = pend ? `Tienes ${pend} foto(s) sin subir en la cola. ¿Cerrar sesión igual?` : '¿Cerrar sesión?';
    if (!confirm(msg)) return;
    sessionStorage.removeItem('repo_tec'); location.reload();
  });

  // ============================================================
  // GPS
  // ============================================================
  function requestGPS() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => { state.lastPos = { lat: pos.coords.latitude, lng: pos.coords.longitude }; const c = $('#gps-chip'); if (c) { c.className = 'gps-chip on'; c.textContent = '📍 Ubicación lista'; } },
      () => { state.lastPos = null; },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
    );
  }

  // ============================================================
  // ÁRBOL (drill-down)
  // ============================================================
  async function loadNodos() {
    const { data } = await sb.from('nodos').select('id,parent_id,nombre,tipo,con_mascara,drive_url,orden').order('orden', { ascending: true });
    if (data) { state.nodos = data; localStorage.setItem('repo_nodos', JSON.stringify(data)); }
    else { const cached = localStorage.getItem('repo_nodos'); if (cached) state.nodos = JSON.parse(cached); }
  }
  const childrenOf = (pid) => state.nodos.filter((n) => n.parent_id === pid).sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre));
  const rutaActual = () => state.stack.map((n) => n.nombre).join(' › ');

  function renderTree() {
    state.currentNodo = null;
    const parent = state.stack.length ? state.stack[state.stack.length - 1] : null;
    const items = childrenOf(parent ? parent.id : null);
    $('#tbar-title').textContent = parent ? parent.nombre : 'Proyectos';
    $('#tbar-sub').textContent = parent ? rutaActual() : `Hola, ${state.tecnico.nombre}`;
    $('#btn-back').classList.toggle('hidden', state.stack.length === 0);

    const screen = $('#screen'); screen.innerHTML = '';
    if (parent) {
      const cb = el('div', { class: 'crumb-bar' });
      cb.innerHTML = '📍 ' + state.stack.map((n) => esc(n.nombre)).join(' <span style="color:#c4c9cf">›</span> ');
      screen.appendChild(cb);
    }
    if (items.length === 0) { screen.appendChild(el('div', { class: 'empty' }, '<div class="ic">📭</div><p>No hay carpetas aquí.</p>')); return; }

    const list = el('div', { class: 'list' });
    items.forEach((n) => {
      const isSub = n.tipo === 'subida';
      const card = el('div', { class: 'node-card' });
      const meta = isSub
        ? `<span class="tag ${n.con_mascara ? 'mask' : 'doc'}">${n.con_mascara ? '📷 con máscara' : '📄 documento'}</span>`
        : `${childrenOf(n.id).length} carpeta(s)`;
      card.innerHTML = `<div class="nic ${isSub ? 'sub' : 'cont'}">${isSub ? '📷' : '📁'}</div>
        <div class="nbody"><div class="nname">${esc(n.nombre)}</div><div class="nmeta">${meta}</div></div>
        <div class="chev">${isSub ? '📸' : '›'}</div>`;
      card.addEventListener('click', () => { if (isSub) openUpload(n); else { state.stack.push(n); renderTree(); } });
      list.appendChild(card);
    });
    screen.appendChild(list);
  }
  $('#btn-back').addEventListener('click', () => {
    if (state.currentNodo) { renderTree(); return; }
    if (state.stack.length) { state.stack.pop(); renderTree(); }
  });

  // ============================================================
  // CARPETA DE SUBIDA · captura
  // ============================================================
  async function openUpload(nodo) {
    state.currentNodo = nodo;
    $('#tbar-title').textContent = nodo.nombre;
    $('#tbar-sub').textContent = rutaActual();
    $('#btn-back').classList.remove('hidden');
    const screen = $('#screen'); screen.innerHTML = '';
    const gpsOn = !!state.lastPos;
    const head = el('div', { class: 'upload-head' });
    head.innerHTML = `<div class="ruta">${esc(rutaActual())}</div>
      <div class="nm">📷 ${esc(nodo.nombre)}</div>
      <div class="gps-chip ${gpsOn ? 'on' : 'off'}" id="gps-chip">${gpsOn ? '📍 Ubicación lista' : '📍 Buscando ubicación…'}</div>
      <span class="tag ${nodo.con_mascara ? 'mask' : 'doc'}" style="margin-left:8px">${nodo.con_mascara ? 'con máscara' : 'documento'}</span>`;
    screen.appendChild(head);
    screen.appendChild(el('div', { class: 'shots', id: 'shots' }));
    const bar = el('div', { class: 'capture-bar' });
    const driveBtn = el('button', { class: 'btn btn-secondary', title: 'Abrir en Drive' }, '🔗');
    driveBtn.addEventListener('click', () => { if (nodo.drive_url) window.open(nodo.drive_url, '_blank'); else toast('Carpeta de Drive aún no creada', 'err'); });
    const camBtn = el('button', { class: 'btn btn-primary' }, '📸 Tomar foto');
    camBtn.addEventListener('click', () => $('#cam-input').click());
    bar.appendChild(driveBtn); bar.appendChild(camBtn);
    screen.appendChild(bar);
    if (!gpsOn) requestGPS();
    await renderShots();
  }

  async function renderShots() {
    const cont = $('#shots'); if (!cont) return;
    const all = await idbAll();
    const mine = all.filter((s) => s.nodo_id === state.currentNodo.id).sort((a, b) => b.id - a.id);
    cont.innerHTML = '';
    if (mine.length === 0) {
      cont.style.display = 'block';
      cont.innerHTML = '<div class="empty" style="grid-column:1/-1"><div class="ic">📸</div><p>Toca “Tomar foto” para empezar.<br>Si no hay señal, las fotos se guardan y suben al reconectar.</p></div>';
      return;
    }
    cont.style.display = 'grid';
    const labels = { pending: 'En cola', uploading: 'Subiendo…', done: '✓ Subida', error: 'Reintentar' };
    mine.forEach((s) => {
      const div = el('div', { class: 'shot' });
      div.innerHTML = `<img src="${s.thumb}"><div class="st ${s.status}">${labels[s.status]}</div>`;
      if (s.status === 'pending' || s.status === 'error') {
        const rm = el('button', { class: 'rm' }, '×');
        rm.addEventListener('click', async (e) => { e.stopPropagation(); await idbDel(s.id); renderShots(); updatePendingBadge(); });
        div.appendChild(rm);
      }
      if (s.status === 'error') div.addEventListener('click', () => flushQueue());
      cont.appendChild(div);
    });
  }

  // ---------- Captura: aplicar máscara y encolar ----------
  $('#cam-input').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0]; e.target.value = '';
    if (!file || !state.currentNodo) return;
    toast('Procesando foto…');
    try {
      const dataUrl = await fileToImage(file);
      const masked = state.currentNodo.con_mascara ? await applyMascara(dataUrl) : await downscale(dataUrl);
      const thumb = await downscale(masked, 240, 0.7);
      const rec = {
        tecnico_id: state.tecnico.id, nodo_id: state.currentNodo.id,
        base64: masked.split(',')[1], thumb, mime: 'image/jpeg',
        filename: `${slug(state.currentNodo.nombre)}_${Date.now()}.jpg`,
        lat: state.lastPos?.lat ?? null, lng: state.lastPos?.lng ?? null,
        fecha: new Date().toISOString(), status: 'pending',
      };
      await idbAdd(rec);
      await renderShots(); updatePendingBadge();
      flushQueue();
    } catch (err) { toast('No se pudo procesar la foto', 'err'); }
  });

  function fileToImage(file) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); }); }
  function loadImg(src) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; }); }

  async function downscale(dataUrl, max = 1600, q = 0.85) {
    const img = await loadImg(dataUrl);
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
    const c = $('#canvas'); c.width = w; c.height = h;
    c.getContext('2d').drawImage(img, 0, 0, w, h);
    return c.toDataURL('image/jpeg', q);
  }

  async function applyMascara(dataUrl, max = 1600) {
    const img = await loadImg(dataUrl);
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
    const c = $('#canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    const barH = Math.round(h * 0.16);
    const grad = ctx.createLinearGradient(0, h - barH, 0, h);
    grad.addColorStop(0, 'rgba(0,0,0,0)'); grad.addColorStop(0.35, 'rgba(0,0,0,0.45)'); grad.addColorStop(1, 'rgba(0,0,0,0.78)');
    ctx.fillStyle = grad; ctx.fillRect(0, h - barH, w, barH);
    const pad = Math.round(w * 0.035), fs = Math.max(14, Math.round(w * 0.028));
    ctx.fillStyle = '#fff'; ctx.font = `800 ${Math.round(fs * 1.1)}px Manrope, sans-serif`;
    ctx.fillText('REPO PRINT', pad, h - pad - fs * 3.1);
    ctx.font = `600 ${fs}px Manrope, sans-serif`;
    const fecha = new Date().toLocaleString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    ctx.fillText('🕓 ' + fecha, pad, h - pad - fs * 1.9);
    ctx.fillText(state.lastPos ? `📍 ${state.lastPos.lat.toFixed(6)}, ${state.lastPos.lng.toFixed(6)}` : '📍 Sin ubicación GPS', pad, h - pad - fs * 0.7);
    ctx.textAlign = 'right'; ctx.font = `700 ${Math.round(fs * 0.9)}px Manrope, sans-serif`; ctx.fillStyle = 'rgba(255,255,255,.9)';
    ctx.fillText(state.currentNodo.nombre.slice(0, 40), w - pad, h - pad - fs * 0.7); ctx.textAlign = 'left';
    ctx.fillStyle = state.accent; ctx.fillRect(0, h - barH, Math.round(w * 0.012), barH);
    return c.toDataURL('image/jpeg', 0.85);
  }
  function slug(s) { return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40); }

  // ============================================================
  // COLA OFFLINE · sincronización
  // ============================================================
  let _flushing = false;
  async function flushQueue() {
    if (_flushing) return;
    if (!navigator.onLine) { return; }
    _flushing = true;
    try {
      let pendientes = (await idbAll()).filter((r) => r.status === 'pending' || r.status === 'error');
      for (const rec of pendientes) {
        rec.status = 'uploading'; await idbPut(rec); await renderShots(); updatePendingBadge();
        const { data, error } = await sb.functions.invoke('drive-upload', {
          body: {
            tecnico_id: rec.tecnico_id, nodo_id: rec.nodo_id, filename: rec.filename,
            image_base64: rec.base64, mime: rec.mime, lat: rec.lat, lng: rec.lng,
            direccion: rec.lat ? `${rec.lat.toFixed(6)}, ${rec.lng.toFixed(6)}` : null, fecha_captura: rec.fecha,
          },
        });
        if (error || (data && data.error)) {
          rec.status = 'error'; await idbPut(rec);
          if (!navigator.onLine) break; // sin señal: dejar el resto en cola
        } else {
          rec.status = 'done'; rec.drive_url = data.drive_url; rec.base64 = null; // soltar la imagen pesada
          await idbPut(rec);
        }
        await renderShots(); updatePendingBadge();
      }
    } finally { _flushing = false; }
  }

  async function updatePendingBadge() {
    const all = await idbAll();
    const pend = all.filter((r) => r.status === 'pending' || r.status === 'error' || r.status === 'uploading').length;
    let badge = $('#pend-badge');
    if (!badge) {
      badge = el('div', { id: 'pend-badge', class: 'pend-badge', onclick: () => flushQueue() });
      $('#tbar').insertBefore(badge, $('#btn-logout'));
    }
    if (pend > 0) { badge.classList.remove('hidden'); badge.innerHTML = `<span class="${navigator.onLine ? 'dot-on' : 'dot-off'}"></span>${pend} en cola`; }
    else badge.classList.add('hidden');
  }

  window.addEventListener('online', () => { toast('Conexión restablecida — subiendo cola…'); flushQueue(); updatePendingBadge(); });
  window.addEventListener('offline', () => { toast('Sin conexión — las fotos se guardarán', 'info'); updatePendingBadge(); });
  setInterval(() => { if (state.tecnico && navigator.onLine) flushQueue(); }, 30000);

  // ============================================================
  // Boot + Service Worker (PWA)
  // ============================================================
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
  (async () => {
    await initLogin();
    const saved = sessionStorage.getItem('repo_tec');
    if (saved) { try { state.tecnico = JSON.parse(saved); enterApp(); } catch (_) { sessionStorage.removeItem('repo_tec'); } }
  })();
})();
