/* ============================================================
   REPO PRINT · App del técnico (móvil)
   Login por PIN → árbol → captura con máscara → subida a Drive
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

  // ---------- Estado ----------
  const state = { tecnico: null, accent: '#006eb1', stack: [], nodos: [], lastPos: null, currentNodo: null, shots: [], pin: '' };

  // ============================================================
  // LOGIN POR PIN
  // ============================================================
  async function initLogin() {
    const { data, error } = await sb.rpc('tecnicos_activos');
    const sel = $('#tec-select');
    if (error) { sel.innerHTML = '<option>Error al cargar</option>'; return; }
    sel.innerHTML = '<option value="">Selecciona tu nombre…</option>' +
      (data || []).map((t) => `<option value="${t.id}">${esc(t.nombre)}</option>`).join('');
  }

  function renderPin() {
    $('#pin-display').querySelectorAll('.pin-dot').forEach((d, i) => d.classList.toggle('filled', i < state.pin.length));
  }

  $('#keypad').addEventListener('click', async (e) => {
    const btn = e.target.closest('.key'); if (!btn) return;
    const k = btn.dataset.k;
    $('#pin-error').textContent = '';
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
      $('#pin-error').textContent = 'PIN incorrecto';
      state.pin = ''; renderPin();
      navigator.vibrate && navigator.vibrate(200);
      return;
    }
    state.tecnico = data[0];
    sessionStorage.setItem('repo_tec', JSON.stringify(data[0]));
    enterApp();
  }

  async function enterApp() {
    $('#login').classList.add('hidden');
    $('#tbar').classList.remove('hidden');
    $('#screen').classList.remove('hidden');
    $('#btn-logout').textContent = initials(state.tecnico.nombre);
    // cargar acento
    const { data: c } = await sb.from('configuracion').select('accent_color').eq('id', 1).single();
    if (c && c.accent_color) { state.accent = c.accent_color; document.documentElement.style.setProperty('--accent', c.accent_color); }
    // pedir GPS temprano
    requestGPS();
    // cargar árbol
    await loadNodos();
    state.stack = [];
    renderTree();
  }

  $('#btn-logout').addEventListener('click', () => {
    if (!confirm('¿Cerrar sesión?')) return;
    sessionStorage.removeItem('repo_tec');
    location.reload();
  });

  // ============================================================
  // GPS
  // ============================================================
  function requestGPS() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => { state.lastPos = { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy }; },
      () => { state.lastPos = null; },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
    );
  }

  // ============================================================
  // ÁRBOL (drill-down)
  // ============================================================
  async function loadNodos() {
    // anon ve solo nodos activos (RLS)
    const { data } = await sb.from('nodos').select('id,parent_id,nombre,tipo,con_mascara,drive_url,orden')
      .order('orden', { ascending: true });
    state.nodos = data || [];
  }

  function childrenOf(parentId) {
    return state.nodos.filter((n) => n.parent_id === parentId)
      .sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre));
  }

  function rutaActual() {
    return state.stack.map((n) => n.nombre).join(' › ');
  }

  function renderTree() {
    state.currentNodo = null;
    const parent = state.stack.length ? state.stack[state.stack.length - 1] : null;
    const parentId = parent ? parent.id : null;
    const items = childrenOf(parentId);

    $('#tbar-title').textContent = parent ? parent.nombre : 'Proyectos';
    $('#tbar-sub').textContent = parent ? rutaActual() : `Hola, ${state.tecnico.nombre}`;
    $('#btn-back').classList.toggle('hidden', state.stack.length === 0);

    const screen = $('#screen');
    screen.innerHTML = '';
    if (parent) {
      const cb = el('div', { class: 'crumb-bar' });
      cb.innerHTML = '📍 ' + (state.stack.map((n) => esc(n.nombre)).join(' <span style="color:#c4c9cf">›</span> '));
      screen.appendChild(cb);
    }

    if (items.length === 0) {
      screen.appendChild(el('div', { class: 'empty' }, '<div class="ic">📭</div><p>No hay carpetas aquí todavía.</p>'));
      return;
    }

    const list = el('div', { class: 'list' });
    items.forEach((n) => {
      const isSub = n.tipo === 'subida';
      const card = el('div', { class: 'node-card' });
      const meta = isSub
        ? `<span class="tag ${n.con_mascara ? 'mask' : 'doc'}">${n.con_mascara ? '📷 con máscara' : '📄 documento'}</span>`
        : `${childrenOf(n.id).length} carpeta(s)`;
      card.innerHTML = `
        <div class="nic ${isSub ? 'sub' : 'cont'}">${isSub ? '📷' : '📁'}</div>
        <div class="nbody"><div class="nname">${esc(n.nombre)}</div><div class="nmeta">${meta}</div></div>
        <div class="chev">${isSub ? '📸' : '›'}</div>`;
      card.addEventListener('click', () => {
        if (isSub) openUpload(n);
        else { state.stack.push(n); renderTree(); }
      });
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
  function openUpload(nodo) {
    state.currentNodo = nodo;
    state.shots = [];
    $('#tbar-title').textContent = nodo.nombre;
    $('#tbar-sub').textContent = rutaActual();
    $('#btn-back').classList.remove('hidden');

    const screen = $('#screen');
    screen.innerHTML = '';

    const head = el('div', { class: 'upload-head' });
    const gpsOn = !!state.lastPos;
    head.innerHTML = `
      <div class="ruta">${esc(rutaActual())}</div>
      <div class="nm">📷 ${esc(nodo.nombre)}</div>
      <div class="gps-chip ${gpsOn ? 'on' : 'off'}" id="gps-chip">${gpsOn ? '📍 Ubicación lista' : '📍 Buscando ubicación…'}</div>
      <span class="tag ${nodo.con_mascara ? 'mask' : 'doc'}" style="margin-left:8px">${nodo.con_mascara ? 'con máscara' : 'documento'}</span>`;
    screen.appendChild(head);

    const shots = el('div', { class: 'shots', id: 'shots' });
    screen.appendChild(shots);

    const bar = el('div', { class: 'capture-bar' });
    const openDriveBtn = el('button', { class: 'btn btn-secondary', title: 'Abrir carpeta en Drive' }, '🔗');
    openDriveBtn.addEventListener('click', () => { if (nodo.drive_url) window.open(nodo.drive_url, '_blank'); else toast('Carpeta de Drive aún no creada', 'err'); });
    const camBtn = el('button', { class: 'btn btn-primary' }, '📸 Tomar foto');
    camBtn.addEventListener('click', () => $('#cam-input').click());
    bar.appendChild(openDriveBtn); bar.appendChild(camBtn);
    screen.appendChild(bar);

    if (!gpsOn) requestGPS();
    renderShots();
  }

  function renderShots() {
    const cont = $('#shots'); if (!cont) return;
    cont.innerHTML = '';
    if (state.shots.length === 0) {
      cont.style.display = 'block';
      cont.innerHTML = '<div class="empty" style="grid-column:1/-1"><div class="ic">📸</div><p>Toca “Tomar foto” para empezar.<br>Las fotos se suben a la carpeta de Drive de este taller.</p></div>';
      return;
    }
    cont.style.display = 'grid';
    state.shots.forEach((s, i) => {
      const div = el('div', { class: 'shot' });
      const labels = { pending: 'En cola', uploading: 'Subiendo…', done: '✓ Subida', error: 'Error' };
      div.innerHTML = `<img src="${s.preview}"><div class="st ${s.status}">${labels[s.status]}</div>`;
      if (s.status === 'pending' || s.status === 'error') {
        const rm = el('button', { class: 'rm' }, '×');
        rm.addEventListener('click', (e) => { e.stopPropagation(); state.shots.splice(i, 1); renderShots(); });
        div.appendChild(rm);
      }
      if (s.status === 'error') div.addEventListener('click', () => uploadShot(s));
      cont.appendChild(div);
    });
  }

  // ---------- Captura: aplicar máscara y encolar ----------
  $('#cam-input').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file || !state.currentNodo) return;
    toast('Procesando foto…', 'info');
    try {
      const dataUrl = await fileToImage(file);
      const masked = state.currentNodo.con_mascara
        ? await applyMascara(dataUrl)
        : await downscale(dataUrl);
      const shot = {
        preview: masked, base64: masked.split(',')[1], mime: 'image/jpeg',
        status: 'pending', filename: `${slug(state.currentNodo.nombre)}_${Date.now()}.jpg`,
        lat: state.lastPos?.lat ?? null, lng: state.lastPos?.lng ?? null,
        fecha: new Date().toISOString(),
      };
      state.shots.unshift(shot);
      renderShots();
      uploadShot(shot);
    } catch (err) {
      toast('No se pudo procesar la foto', 'err');
    }
  });

  function fileToImage(file) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = rej;
      r.readAsDataURL(file);
    });
  }

  function loadImg(src) {
    return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
  }

  async function downscale(dataUrl, max = 1600) {
    const img = await loadImg(dataUrl);
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
    const c = $('#canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    return c.toDataURL('image/jpeg', 0.85);
  }

  // Sella la foto con logo + fecha/hora + GPS + taller
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

    const pad = Math.round(w * 0.035);
    const fs = Math.max(14, Math.round(w * 0.028));
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#fff';
    ctx.font = `800 ${Math.round(fs * 1.1)}px Manrope, sans-serif`;
    ctx.fillText('REPO PRINT', pad, h - pad - fs * 3.1);

    ctx.font = `600 ${fs}px Manrope, sans-serif`;
    const now = new Date();
    const fecha = now.toLocaleString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    ctx.fillText('🕓 ' + fecha, pad, h - pad - fs * 1.9);

    const gps = state.lastPos
      ? `📍 ${state.lastPos.lat.toFixed(6)}, ${state.lastPos.lng.toFixed(6)}`
      : '📍 Sin ubicación GPS';
    ctx.fillText(gps, pad, h - pad - fs * 0.7);

    // nombre del taller a la derecha
    ctx.textAlign = 'right';
    ctx.font = `700 ${Math.round(fs * 0.9)}px Manrope, sans-serif`;
    ctx.fillStyle = 'rgba(255,255,255,.9)';
    ctx.fillText(state.currentNodo.nombre.slice(0, 40), w - pad, h - pad - fs * 0.7);
    ctx.textAlign = 'left';

    // franja de acento
    ctx.fillStyle = state.accent;
    ctx.fillRect(0, h - barH, Math.round(w * 0.012), barH);

    return c.toDataURL('image/jpeg', 0.85);
  }

  function slug(s) { return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40); }

  // ---------- Subida a Drive vía edge function ----------
  async function uploadShot(shot) {
    shot.status = 'uploading'; renderShots();
    const { data, error } = await sb.functions.invoke('drive-upload', {
      body: {
        tecnico_id: state.tecnico.id, nodo_id: state.currentNodo.id,
        filename: shot.filename, image_base64: shot.base64, mime: shot.mime,
        lat: shot.lat, lng: shot.lng,
        direccion: shot.lat ? `${shot.lat.toFixed(6)}, ${shot.lng.toFixed(6)}` : null,
        fecha_captura: shot.fecha,
      },
    });
    if (error || (data && data.error)) {
      shot.status = 'error'; renderShots();
      toast((data && data.error) ? data.error : 'Error al subir. Toca la foto para reintentar.', 'err');
      return;
    }
    shot.status = 'done'; shot.drive_url = data.drive_url; renderShots();
    toast('✓ Foto subida a Drive', 'ok');
  }

  // ============================================================
  // Boot
  // ============================================================
  (async () => {
    await initLogin();
    const saved = sessionStorage.getItem('repo_tec');
    if (saved) {
      try { state.tecnico = JSON.parse(saved); enterApp(); } catch (_) { sessionStorage.removeItem('repo_tec'); }
    }
  })();
})();
