/* ============================================================
   REPO PRINT · Panel del administrador — lógica
   Vanilla JS + supabase-js. Acceso protegido por RLS.
   ============================================================ */
(function () {
  'use strict';

  const cfg = window.REPO_PRINT_CONFIG;
  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

  // ---------- Helpers ----------
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const el = (tag, attrs = {}, html) => {
    const n = document.createElement(tag);
    for (const k in attrs) {
      if (k === 'class') n.className = attrs[k];
      else if (k === 'dataset') Object.assign(n.dataset, attrs[k]);
      else if (k.startsWith('on') && typeof attrs[k] === 'function') n.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    }
    if (html != null) n.innerHTML = html;
    return n;
  };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtDate = (d) => d ? new Date(d).toLocaleString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
  const fmtDay = (d) => d ? new Date(d).toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';

  function toast(msg, type = 'ok') {
    const t = el('div', { class: 'toast ' + type }, esc(msg));
    $('#toast').appendChild(t);
    setTimeout(() => t.remove(), 3200);
  }

  // ---------- Estado global ----------
  const state = { user: null, route: 'inicio', nodos: [], selectedNodo: null, expanded: new Set(), showArchived: false };

  // ============================================================
  // AUTENTICACIÓN
  // ============================================================
  const loginForm = $('#login-form');
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#login-btn');
    const errBox = $('#login-error');
    errBox.classList.add('hidden');
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
    const { error } = await sb.auth.signInWithPassword({
      email: $('#login-email').value.trim(),
      password: $('#login-password').value,
    });
    btn.disabled = false; btn.textContent = 'Ingresar';
    if (error) {
      $('#login-error-msg').textContent = 'Usuario o contraseña incorrectos.';
      errBox.classList.remove('hidden');
    }
  });

  $('#logout-btn').addEventListener('click', async () => { await sb.auth.signOut(); });

  sb.auth.onAuthStateChange((_event, session) => {
    if (session && session.user) enterApp(session.user);
    else showLogin();
  });

  function showLogin() {
    state.user = null;
    $('#app').classList.add('hidden');
    $('#login-screen').classList.remove('hidden');
  }

  async function enterApp(user) {
    state.user = user;
    $('#login-screen').classList.add('hidden');
    $('#app').classList.remove('hidden');
    const meta = user.user_metadata || {};
    const nombre = meta.nombre || user.email;
    $('#user-name').textContent = nombre;
    $('#user-initials').textContent = nombre.split(/[\s.]+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
    await loadAccent();
    navigate('inicio');
  }

  async function loadAccent() {
    const { data } = await sb.from('configuracion').select('accent_color').eq('id', 1).single();
    if (data && data.accent_color) document.documentElement.style.setProperty('--accent', data.accent_color);
  }

  // ============================================================
  // NAVEGACIÓN
  // ============================================================
  const TITLES = { inicio: 'Inicio', estructura: 'Estructura', tecnicos: 'Técnicos', bitacora: 'Bitácora' };
  $$('#nav .nav-item').forEach((b) => b.addEventListener('click', () => navigate(b.dataset.route)));

  function navigate(route) {
    state.route = route;
    $$('#nav .nav-item').forEach((b) => b.classList.toggle('active', b.dataset.route === route));
    $('#page-title').textContent = TITLES[route];
    const action = $('#topbar-action');
    if (route === 'estructura') { action.classList.remove('hidden'); action.innerHTML = '<span style="font-size:17px">+</span> Crear proyecto'; action.onclick = () => openCreateNode(null); }
    else if (route === 'tecnicos') { action.classList.remove('hidden'); action.innerHTML = '<span style="font-size:17px">+</span> Agregar técnico'; action.onclick = () => openTecnicoModal(); }
    else if (route === 'bitacora') { action.classList.remove('hidden'); action.innerHTML = '⬇ Exportar CSV'; action.onclick = exportBitacoraCSV; }
    else action.classList.add('hidden');
    ({ inicio: renderInicio, estructura: renderEstructura, tecnicos: renderTecnicos, bitacora: renderBitacora }[route])();
  }

  // ============================================================
  // INICIO / DASHBOARD
  // ============================================================
  async function renderInicio() {
    const view = $('#view');
    view.innerHTML = '<div class="center-load"><div class="spinner dark"></div></div>';

    const [nodosR, tecR, subR] = await Promise.all([
      sb.from('nodos').select('id,tipo,parent_id,estado'),
      sb.from('tecnicos').select('id,estado'),
      sb.from('v_bitacora').select('id', { count: 'exact', head: true }),
    ]);
    const nodos = nodosR.data || [];
    const proyectos = nodos.filter((n) => !n.parent_id && n.estado === 'activo').length;
    const subidaFolders = nodos.filter((n) => n.tipo === 'subida' && n.estado === 'activo').length;
    const tecnicos = (tecR.data || []).filter((t) => t.estado === 'activo').length;
    const totalFotos = subR.count || 0;

    const recientesR = await sb.from('v_bitacora').select('*').order('fecha_subida', { ascending: false }).limit(8);
    const recientes = recientesR.data || [];

    view.innerHTML = '';
    const cards = el('div', { class: 'cards' });
    [
      ['Proyectos', proyectos, ''],
      ['Carpetas de subida', subidaFolders, ''],
      ['Fotos subidas', totalFotos.toLocaleString('es-PE'), 'accent'],
      ['Técnicos activos', tecnicos, ''],
      ['Nodos totales', nodos.filter((n) => n.estado === 'activo').length, ''],
    ].forEach(([label, value, cls]) => {
      cards.appendChild(el('div', { class: 'card' }, `<div class="label">${label}</div><div class="value ${cls}">${value}</div>`));
    });
    view.appendChild(cards);

    const panel = el('div', { class: 'panel', style: 'margin-top:18px' });
    panel.appendChild(el('div', { class: 'panel-head' }, '<h3>Actividad reciente</h3>'));
    if (recientes.length === 0) {
      panel.appendChild(el('div', { class: 'empty-state' }, 'Aún no hay subidas registradas.'));
    } else {
      const tbl = el('table', { class: 'tbl' });
      tbl.innerHTML = '<thead><tr><th>Archivo</th><th>Ruta</th><th>Técnico</th><th>Subido</th></tr></thead>';
      const tb = el('tbody');
      recientes.forEach((r) => {
        tb.appendChild(el('tr', {}, `<td>${esc(r.archivo_nombre)}</td><td class="crumb">${esc(r.ruta || '—')}</td><td>${esc(r.tecnico)}</td><td class="muted">${fmtDate(r.fecha_subida)}</td>`));
      });
      tbl.appendChild(tb); panel.appendChild(tbl);
    }
    view.appendChild(panel);
  }

  // ============================================================
  // ESTRUCTURA (EL ÁRBOL)
  // ============================================================
  async function loadNodos() {
    const { data, error } = await sb.from('nodos').select('*').order('orden', { ascending: true }).order('created_at', { ascending: true });
    if (error) { toast('Error al cargar el árbol', 'err'); return []; }
    state.nodos = data || [];
    // contar hijos y fotos por nodo
    const childCount = {};
    state.nodos.forEach((n) => { if (n.parent_id) childCount[n.parent_id] = (childCount[n.parent_id] || 0) + 1; });
    state.nodos.forEach((n) => { n._children = childCount[n.id] || 0; });
    return state.nodos;
  }

  async function renderEstructura() {
    const view = $('#view');
    view.innerHTML = '<div class="center-load"><div class="spinner dark"></div></div>';
    await loadNodos();
    // contar fotos por nodo de subida
    const { data: fotos } = await sb.from('subidas').select('nodo_id');
    const fotoCount = {};
    (fotos || []).forEach((f) => { fotoCount[f.nodo_id] = (fotoCount[f.nodo_id] || 0) + 1; });
    state.nodos.forEach((n) => { n._fotos = fotoCount[n.id] || 0; });

    view.innerHTML = '';
    const layout = el('div', { class: 'tree-layout' });

    // --- Caja del árbol ---
    const box = el('div', { class: 'tree-box' });
    const toolbar = el('div', { class: 'tree-toolbar' });
    toolbar.innerHTML = '<span style="font:800 14px Manrope">Árbol de estructura</span><span class="sp"></span>';
    const archToggle = el('label', { class: 'badge badge-archivado', style: 'cursor:pointer' });
    archToggle.innerHTML = `<input type="checkbox" ${state.showArchived ? 'checked' : ''} style="margin-right:4px"> Ver archivados`;
    archToggle.querySelector('input').addEventListener('change', (e) => { state.showArchived = e.target.checked; renderEstructura(); });
    toolbar.appendChild(archToggle);
    box.appendChild(toolbar);

    const scroll = el('div', { class: 'tree-scroll' });
    const roots = state.nodos.filter((n) => !n.parent_id);
    const visibleRoots = roots.filter((n) => state.showArchived || n.estado === 'activo');
    if (visibleRoots.length === 0) {
      scroll.appendChild(el('div', { class: 'tree-empty' }, `
        <div class="ic">🗂️</div><h3>Aún no hay estructura</h3>
        <p>Crea tu primer proyecto para empezar a armar el árbol de carpetas.</p>`));
      const cta = el('button', { class: 'btn btn-primary', onclick: () => openCreateNode(null) }, '<span style="font-size:17px">+</span> Crear primer proyecto');
      cta.style.margin = '0 auto'; scroll.querySelector('.tree-empty').appendChild(cta);
    } else {
      visibleRoots.forEach((r) => scroll.appendChild(renderNodeRow(r)));
    }
    box.appendChild(scroll);
    layout.appendChild(box);

    // --- Panel de detalle ---
    const detail = el('div', { class: 'detail', id: 'detail-panel' });
    detail.appendChild(el('div', { class: 'detail-empty' }, 'Selecciona un nodo del árbol para ver y editar sus detalles.'));
    layout.appendChild(detail);

    view.appendChild(layout);
    if (state.selectedNodo) {
      const still = state.nodos.find((n) => n.id === state.selectedNodo.id);
      if (still) selectNode(still);
    }
  }

  function renderNodeRow(node) {
    const wrap = el('div');
    const hasChildren = node._children > 0;
    const isExpanded = state.expanded.has(node.id);
    const row = el('div', { class: 'node-row' + (node.estado === 'archivado' ? ' archived' : '') + (state.selectedNodo && state.selectedNodo.id === node.id ? ' selected' : '') });

    const twisty = el('span', { class: 'twisty' }, hasChildren ? (isExpanded ? '▾' : '▸') : '');
    twisty.addEventListener('click', (e) => { e.stopPropagation(); if (!hasChildren) return; if (isExpanded) state.expanded.delete(node.id); else state.expanded.add(node.id); renderEstructura(); });
    row.appendChild(twisty);

    row.appendChild(el('span', { class: 'nicon' }, node.tipo === 'subida' ? '📷' : '📁'));
    row.appendChild(el('span', { class: 'nname' }, esc(node.nombre)));

    // badges
    if (node.tipo === 'subida') {
      row.appendChild(el('span', { class: 'badge ' + (node.con_mascara ? 'badge-mascara' : 'badge-documento') }, node.con_mascara ? 'con máscara' : 'documento'));
      row.appendChild(el('span', { class: 'badge badge-count' }, node._fotos + ' fotos'));
    } else {
      row.appendChild(el('span', { class: 'badge badge-count' }, node._children + (node._children === 1 ? ' hijo' : ' hijos')));
    }
    if (node.estado === 'archivado') row.appendChild(el('span', { class: 'badge badge-archivado' }, 'archivado'));

    // botón "+" solo en contenedores activos
    if (node.tipo === 'contenedor' && node.estado === 'activo') {
      const add = el('button', { class: 'nadd', title: 'Agregar dentro' }, '+');
      add.addEventListener('click', (e) => { e.stopPropagation(); openCreateNode(node); });
      row.appendChild(add);
    }

    row.addEventListener('click', () => selectNode(node));
    wrap.appendChild(row);

    if (hasChildren && isExpanded) {
      const kids = el('div', { class: 'node-children' });
      state.nodos.filter((n) => n.parent_id === node.id)
        .filter((n) => state.showArchived || n.estado === 'activo')
        .forEach((c) => kids.appendChild(renderNodeRow(c)));
      wrap.appendChild(kids);
    }
    return wrap;
  }

  function selectNode(node) {
    state.selectedNodo = node;
    $$('.node-row.selected').forEach((r) => r.classList.remove('selected'));
    renderDetail(node);
    // marcar fila seleccionada sin re-render completo
    renderEstructura();
  }

  function renderDetail(node) {
    const panel = $('#detail-panel');
    if (!panel) return;
    panel.innerHTML = '';
    const head = el('div', { class: 'detail-head' });
    head.innerHTML = `<span class="nicon">${node.tipo === 'subida' ? '📷' : '📁'}</span>
      <div style="font:800 16px Manrope;margin-top:6px">${esc(node.nombre)}</div>
      <div style="font:600 12px Manrope;color:var(--muted);margin-top:2px">${node.tipo === 'subida' ? 'Carpeta de subida (hoja)' : 'Contenedor'} · ${node.estado}</div>`;
    panel.appendChild(head);

    const body = el('div', { class: 'detail-body' });

    // nombre editable
    const nameRow = el('div', { class: 'detail-row' });
    nameRow.innerHTML = '<label>NOMBRE</label>';
    const nameInput = el('input', { type: 'text', value: node.nombre, id: 'detail-name' });
    nameRow.appendChild(nameInput);
    body.appendChild(nameRow);

    // clase + conversión
    const claseRow = el('div', { class: 'detail-row' });
    const canBeSubida = node._children === 0;
    claseRow.innerHTML = '<label>CLASE</label>';
    const choice = el('div', { class: 'choice' });
    const optCont = el('div', { class: 'opt' + (node.tipo === 'contenedor' ? ' sel' : ''), dataset: { tipo: 'contenedor' } }, '<div class="oic">📁</div><div class="ot">Contenedor</div><div class="od">Agrupa otros nodos</div>');
    const optSub = el('div', { class: 'opt' + (node.tipo === 'subida' ? ' sel' : '') + (canBeSubida ? '' : ' disabled'), dataset: { tipo: 'subida' } }, '<div class="oic">📷</div><div class="ot">De subida</div><div class="od">El técnico sube fotos aquí</div>');
    let chosenTipo = node.tipo;
    optCont.addEventListener('click', () => { chosenTipo = 'contenedor'; optCont.classList.add('sel'); optSub.classList.remove('sel'); maskBox.classList.add('hidden'); });
    optSub.addEventListener('click', () => { if (!canBeSubida) return; chosenTipo = 'subida'; optSub.classList.add('sel'); optCont.classList.remove('sel'); maskBox.classList.remove('hidden'); });
    choice.appendChild(optCont); choice.appendChild(optSub);
    claseRow.appendChild(choice);
    if (!canBeSubida) claseRow.appendChild(el('div', { class: 'explain', style: 'margin-top:10px' }, 'Para marcar este nodo como carpeta de subida no debe tener subcarpetas.'));
    body.appendChild(claseRow);

    // toggle máscara
    const maskBox = el('div', { class: 'toggle-wrap' + (chosenTipo === 'subida' ? '' : ' hidden') });
    let maskOn = node.con_mascara;
    maskBox.innerHTML = '<div><div class="tl">Con máscara</div><div class="ts">Sella la foto con logo, fecha y GPS. Apágalo para modo documento.</div></div>';
    const sw = el('button', { class: 'switch' + (maskOn ? ' on' : '') });
    sw.addEventListener('click', () => { maskOn = !maskOn; sw.classList.toggle('on', maskOn); });
    maskBox.appendChild(sw);
    body.appendChild(maskBox);

    // Drive
    if (node.drive_url) {
      body.appendChild(el('a', { class: 'drive-link', href: node.drive_url, target: '_blank' }, '🔗 Abrir carpeta en Google Drive'));
    } else {
      body.appendChild(el('div', { class: 'drive-note' }, '📁 La carpeta de Google Drive se generará al sincronizar (pendiente de integración con Drive).'));
    }

    // fechas
    body.appendChild(el('div', { class: 'muted', style: 'font:500 11px Manrope' }, `Creado: ${fmtDate(node.created_at)} · Actualizado: ${fmtDate(node.updated_at)}`));

    panel.appendChild(body);

    // footer acciones
    const foot = el('div', { class: 'detail-foot' });
    const saveBtn = el('button', { class: 'btn btn-primary' }, 'Guardar');
    saveBtn.addEventListener('click', async () => {
      const patch = { nombre: nameInput.value.trim(), tipo: chosenTipo, con_mascara: chosenTipo === 'subida' ? maskOn : node.con_mascara };
      saveBtn.disabled = true; saveBtn.innerHTML = '<span class="spinner"></span>';
      const { error } = await sb.from('nodos').update(patch).eq('id', node.id);
      saveBtn.disabled = false; saveBtn.textContent = 'Guardar';
      if (error) toast(cleanErr(error.message), 'err');
      else { toast('Cambios guardados'); await renderEstructura(); }
    });
    foot.appendChild(saveBtn);

    const archBtn = el('button', { class: 'btn ' + (node.estado === 'activo' ? 'btn-danger' : 'btn-secondary') }, node.estado === 'activo' ? 'Archivar' : 'Restaurar');
    archBtn.addEventListener('click', () => {
      if (node.estado === 'activo') {
        confirmModal('Archivar nodo', 'Se ocultará al técnico, pero las fotos en Drive se conservan. Podrás restaurarlo cuando quieras.', 'Archivar', async () => {
          await setEstadoNodo(node, 'archivado');
        });
      } else { setEstadoNodo(node, 'activo'); }
    });
    foot.appendChild(archBtn);
    panel.appendChild(foot);
  }

  async function setEstadoNodo(node, estado) {
    const { error } = await sb.from('nodos').update({ estado }).eq('id', node.id);
    if (error) toast(cleanErr(error.message), 'err');
    else { toast(estado === 'archivado' ? 'Nodo archivado' : 'Nodo restaurado'); await renderEstructura(); }
  }

  // --- Crear nodo (modal) ---
  function openCreateNode(parent) {
    const parentHasChildren = parent ? state.nodos.some((n) => n.parent_id === parent.id) : false;
    let tipo = 'contenedor', maskOn = true;
    const root = $('#modal-root');
    const overlay = el('div', { class: 'modal-overlay' });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) root.innerHTML = ''; });
    const modal = el('div', { class: 'modal' });
    modal.innerHTML = `
      <div class="modal-head">
        <h3>${parent ? 'Agregar dentro de' : 'Crear proyecto'}</h3>
        <p>${parent ? esc(parent.nombre) : 'Nuevo nodo raíz del árbol'}</p>
      </div>`;
    const body = el('div', { class: 'modal-body' });
    const nameRow = el('div', { class: 'detail-row' });
    nameRow.innerHTML = '<label>NOMBRE</label>';
    const nameInput = el('input', { type: 'text', placeholder: 'Ej. I.E. San Martín', id: 'new-name' });
    nameRow.appendChild(nameInput); body.appendChild(nameRow);

    const claseRow = el('div', { class: 'detail-row' });
    claseRow.innerHTML = '<label>CLASE</label>';
    const choice = el('div', { class: 'choice' });
    const optCont = el('div', { class: 'opt sel', dataset: { tipo: 'contenedor' } }, '<div class="oic">📁</div><div class="ot">Contenedor</div><div class="od">Agrupa otros nodos</div>');
    const optSub = el('div', { class: 'opt', dataset: { tipo: 'subida' } }, '<div class="oic">📷</div><div class="ot">De subida</div><div class="od">El técnico sube fotos aquí</div>');
    optCont.addEventListener('click', () => { tipo = 'contenedor'; optCont.classList.add('sel'); optSub.classList.remove('sel'); maskBox.classList.add('hidden'); });
    optSub.addEventListener('click', () => { tipo = 'subida'; optSub.classList.add('sel'); optCont.classList.remove('sel'); maskBox.classList.remove('hidden'); });
    choice.appendChild(optCont); choice.appendChild(optSub);
    claseRow.appendChild(choice); body.appendChild(claseRow);

    const maskBox = el('div', { class: 'toggle-wrap hidden' });
    maskBox.innerHTML = '<div><div class="tl">Con máscara</div><div class="ts">Sella la foto con logo, fecha y GPS.</div></div>';
    const sw = el('button', { class: 'switch on' });
    sw.addEventListener('click', () => { maskOn = !maskOn; sw.classList.toggle('on', maskOn); });
    maskBox.appendChild(sw); body.appendChild(maskBox);
    modal.appendChild(body);

    const foot = el('div', { class: 'modal-foot' });
    const cancel = el('button', { class: 'btn btn-secondary', onclick: () => root.innerHTML = '' }, 'Cancelar');
    const create = el('button', { class: 'btn btn-primary' }, 'Crear');
    create.addEventListener('click', async () => {
      const nombre = nameInput.value.trim();
      if (!nombre) { toast('Ingresa un nombre', 'err'); return; }
      create.disabled = true; create.innerHTML = '<span class="spinner"></span>';
      const maxOrden = Math.max(-1, ...state.nodos.filter((n) => n.parent_id === (parent ? parent.id : null)).map((n) => n.orden));
      const { error } = await sb.from('nodos').insert({
        nombre, tipo, parent_id: parent ? parent.id : null,
        con_mascara: tipo === 'subida' ? maskOn : true, orden: maxOrden + 1,
      });
      create.disabled = false; create.textContent = 'Crear';
      if (error) { toast(cleanErr(error.message), 'err'); return; }
      root.innerHTML = '';
      if (parent) state.expanded.add(parent.id);
      toast('Nodo creado');
      await renderEstructura();
    });
    foot.appendChild(cancel); foot.appendChild(create);
    modal.appendChild(foot);
    overlay.appendChild(modal); root.innerHTML = ''; root.appendChild(overlay);
    nameInput.focus();
  }

  // ============================================================
  // TÉCNICOS
  // ============================================================
  async function renderTecnicos() {
    const view = $('#view');
    view.innerHTML = '<div class="center-load"><div class="spinner dark"></div></div>';
    const { data, error } = await sb.from('tecnicos').select('*').order('created_at', { ascending: false });
    if (error) { view.innerHTML = '<div class="empty-state">Error al cargar técnicos.</div>'; return; }
    view.innerHTML = '';
    const panel = el('div', { class: 'panel' });
    panel.appendChild(el('div', { class: 'panel-head' }, '<h3>Técnicos</h3>'));
    if (!data || data.length === 0) {
      panel.appendChild(el('div', { class: 'empty-state' }, 'Aún no hay técnicos. Usa “Agregar técnico” para crear el primero.'));
    } else {
      const tbl = el('table', { class: 'tbl' });
      tbl.innerHTML = '<thead><tr><th>Nombre</th><th>Estado</th><th>Creado</th><th style="text-align:right">Acciones</th></tr></thead>';
      const tb = el('tbody');
      data.forEach((t) => {
        const tr = el('tr');
        tr.innerHTML = `<td><b>${esc(t.nombre)}</b></td>
          <td><span class="badge ${t.estado === 'activo' ? 'badge-subida' : 'badge-archivado'}">${t.estado}</span></td>
          <td class="muted">${fmtDay(t.created_at)}</td>`;
        const actions = el('td', { style: 'text-align:right' });
        const resetBtn = el('button', { class: 'btn btn-secondary btn-sm', style: 'margin-right:6px' }, 'Restablecer PIN');
        resetBtn.addEventListener('click', () => openPinModal(t));
        const archBtn = el('button', { class: 'btn btn-sm ' + (t.estado === 'activo' ? 'btn-danger' : 'btn-secondary') }, t.estado === 'activo' ? 'Archivar' : 'Restaurar');
        archBtn.addEventListener('click', async () => {
          const nuevo = t.estado === 'activo' ? 'archivado' : 'activo';
          const { error } = await sb.from('tecnicos').update({ estado: nuevo }).eq('id', t.id);
          if (error) toast(cleanErr(error.message), 'err'); else { toast('Técnico actualizado'); renderTecnicos(); }
        });
        actions.appendChild(resetBtn); actions.appendChild(archBtn);
        tr.appendChild(actions); tb.appendChild(tr);
      });
      tbl.appendChild(tb); panel.appendChild(tbl);
    }
    view.appendChild(panel);
  }

  function openTecnicoModal() {
    const root = $('#modal-root');
    const overlay = el('div', { class: 'modal-overlay' });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) root.innerHTML = ''; });
    const modal = el('div', { class: 'modal' });
    modal.innerHTML = '<div class="modal-head"><h3>Agregar técnico</h3><p>El PIN de 4 dígitos es lo que el técnico usará para ingresar a la app.</p></div>';
    const body = el('div', { class: 'modal-body' });
    const nameRow = el('div', { class: 'detail-row' }); nameRow.innerHTML = '<label>NOMBRE</label>';
    const nameInput = el('input', { type: 'text', placeholder: 'Ej. Juan Pérez' }); nameRow.appendChild(nameInput);
    const pinRow = el('div', { class: 'detail-row' }); pinRow.innerHTML = '<label>PIN (4 DÍGITOS)</label>';
    const pinInput = el('input', { type: 'text', inputmode: 'numeric', maxlength: '4', placeholder: '••••' }); pinRow.appendChild(pinInput);
    body.appendChild(nameRow); body.appendChild(pinRow); modal.appendChild(body);
    const foot = el('div', { class: 'modal-foot' });
    foot.appendChild(el('button', { class: 'btn btn-secondary', onclick: () => root.innerHTML = '' }, 'Cancelar'));
    const create = el('button', { class: 'btn btn-primary' }, 'Crear técnico');
    create.addEventListener('click', async () => {
      const nombre = nameInput.value.trim(); const pin = pinInput.value.trim();
      if (!nombre) { toast('Ingresa el nombre', 'err'); return; }
      if (!/^[0-9]{4}$/.test(pin)) { toast('El PIN debe tener 4 dígitos', 'err'); return; }
      create.disabled = true; create.innerHTML = '<span class="spinner"></span>';
      const { error } = await sb.rpc('crear_tecnico', { p_nombre: nombre, p_pin: pin });
      create.disabled = false; create.textContent = 'Crear técnico';
      if (error) { toast(cleanErr(error.message), 'err'); return; }
      root.innerHTML = ''; toast('Técnico creado'); renderTecnicos();
    });
    foot.appendChild(create); modal.appendChild(foot);
    overlay.appendChild(modal); root.innerHTML = ''; root.appendChild(overlay); nameInput.focus();
  }

  function openPinModal(t) {
    const root = $('#modal-root');
    const overlay = el('div', { class: 'modal-overlay' });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) root.innerHTML = ''; });
    const modal = el('div', { class: 'modal' });
    modal.innerHTML = `<div class="modal-head"><h3>Restablecer PIN</h3><p>Nuevo PIN para <b>${esc(t.nombre)}</b>.</p></div>`;
    const body = el('div', { class: 'modal-body' });
    const pinRow = el('div', { class: 'detail-row' }); pinRow.innerHTML = '<label>NUEVO PIN (4 DÍGITOS)</label>';
    const pinInput = el('input', { type: 'text', inputmode: 'numeric', maxlength: '4', placeholder: '••••' }); pinRow.appendChild(pinInput);
    body.appendChild(pinRow); modal.appendChild(body);
    const foot = el('div', { class: 'modal-foot' });
    foot.appendChild(el('button', { class: 'btn btn-secondary', onclick: () => root.innerHTML = '' }, 'Cancelar'));
    const save = el('button', { class: 'btn btn-primary' }, 'Guardar PIN');
    save.addEventListener('click', async () => {
      const pin = pinInput.value.trim();
      if (!/^[0-9]{4}$/.test(pin)) { toast('El PIN debe tener 4 dígitos', 'err'); return; }
      save.disabled = true; save.innerHTML = '<span class="spinner"></span>';
      const { error } = await sb.rpc('restablecer_pin', { p_tecnico_id: t.id, p_pin: pin });
      save.disabled = false; save.textContent = 'Guardar PIN';
      if (error) { toast(cleanErr(error.message), 'err'); return; }
      root.innerHTML = ''; toast('PIN actualizado');
    });
    foot.appendChild(save); modal.appendChild(foot);
    overlay.appendChild(modal); root.innerHTML = ''; root.appendChild(overlay); pinInput.focus();
  }

  // ============================================================
  // BITÁCORA
  // ============================================================
  let bitacoraCache = [];
  async function renderBitacora() {
    const view = $('#view');
    view.innerHTML = '<div class="center-load"><div class="spinner dark"></div></div>';
    const [subR, tecR] = await Promise.all([
      sb.from('v_bitacora').select('*').order('fecha_subida', { ascending: false }).limit(500),
      sb.from('tecnicos').select('id,nombre'),
    ]);
    bitacoraCache = subR.data || [];
    view.innerHTML = '';

    const filters = el('div', { class: 'filters' });
    const fTexto = el('input', { type: 'text', placeholder: 'Buscar por ruta o archivo…', style: 'min-width:240px' });
    const fTec = el('select');
    fTec.innerHTML = '<option value="">Todos los técnicos</option>' + (tecR.data || []).map((t) => `<option value="${t.id}">${esc(t.nombre)}</option>`).join('');
    const fDesde = el('input', { type: 'date' });
    const fHasta = el('input', { type: 'date' });
    [fTexto, fTec, fDesde, fHasta].forEach((f) => f.addEventListener('input', applyFilters));
    filters.append('Filtrar: ', fTexto, fTec, fDesde, fHasta);
    view.appendChild(filters);

    const panel = el('div', { class: 'panel' });
    panel.appendChild(el('div', { class: 'panel-head' }, '<h3>Bitácora de subidas</h3>'));
    const holder = el('div', { id: 'bitacora-table' });
    panel.appendChild(holder); view.appendChild(panel);

    function applyFilters() {
      const q = fTexto.value.toLowerCase();
      const tec = fTec.value; const desde = fDesde.value; const hasta = fHasta.value;
      const rows = bitacoraCache.filter((r) => {
        if (q && !((r.ruta || '').toLowerCase().includes(q) || (r.archivo_nombre || '').toLowerCase().includes(q))) return false;
        if (tec && r.tecnico_id !== tec) return false;
        if (desde && new Date(r.fecha_subida) < new Date(desde)) return false;
        if (hasta && new Date(r.fecha_subida) > new Date(hasta + 'T23:59:59')) return false;
        return true;
      });
      renderBitacoraTable(holder, rows);
    }
    applyFilters();
  }

  function renderBitacoraTable(holder, rows) {
    holder.innerHTML = '';
    if (rows.length === 0) { holder.appendChild(el('div', { class: 'empty-state' }, 'No hay subidas que coincidan con los filtros.')); return; }
    const tbl = el('table', { class: 'tbl' });
    tbl.innerHTML = '<thead><tr><th></th><th>Archivo</th><th>Ruta</th><th>Técnico</th><th>Capturado</th><th>Subido</th><th>Ubicación</th><th>Drive</th></tr></thead>';
    const tb = el('tbody');
    rows.forEach((r) => {
      const tr = el('tr');
      const ubic = r.direccion ? esc(r.direccion) : (r.latitud ? `${r.latitud}, ${r.longitud}` : '—');
      tr.innerHTML = `
        <td><div class="thumb">${r.miniatura_url ? `<img src="${esc(r.miniatura_url)}" style="width:100%;height:100%;border-radius:8px;object-fit:cover">` : '📷'}</div></td>
        <td><b>${esc(r.archivo_nombre)}</b> ${r.con_mascara ? '<span class="badge badge-mascara">máscara</span>' : '<span class="badge badge-documento">doc</span>'}</td>
        <td class="crumb">${esc(r.ruta || '—')}</td>
        <td>${esc(r.tecnico)}</td>
        <td class="muted">${fmtDate(r.fecha_captura)}</td>
        <td class="muted">${fmtDate(r.fecha_subida)}</td>
        <td class="muted">${ubic}</td>
        <td>${r.drive_url ? `<a href="${esc(r.drive_url)}" target="_blank">Abrir</a>` : '—'}</td>`;
      tb.appendChild(tr);
    });
    tbl.appendChild(tb); holder.appendChild(tbl);
  }

  function exportBitacoraCSV() {
    if (!bitacoraCache.length) { toast('No hay datos para exportar', 'err'); return; }
    const cols = ['archivo_nombre', 'ruta', 'tecnico', 'fecha_captura', 'fecha_subida', 'direccion', 'latitud', 'longitud', 'con_mascara', 'drive_url'];
    const head = cols.join(',');
    const lines = bitacoraCache.map((r) => cols.map((c) => `"${String(r[c] ?? '').replace(/"/g, '""')}"`).join(','));
    const csv = [head, ...lines].join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const a = el('a', { href: URL.createObjectURL(blob), download: `bitacora_repoprint_${new Date().toISOString().slice(0, 10)}.csv` });
    document.body.appendChild(a); a.click(); a.remove();
  }

  // ============================================================
  // MODAL DE CONFIRMACIÓN
  // ============================================================
  function confirmModal(title, msg, confirmLabel, onConfirm) {
    const root = $('#modal-root');
    const overlay = el('div', { class: 'modal-overlay' });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) root.innerHTML = ''; });
    const modal = el('div', { class: 'modal' });
    modal.innerHTML = `<div class="modal-head"><h3>${esc(title)}</h3><p>${esc(msg)}</p></div>`;
    const foot = el('div', { class: 'modal-foot' });
    foot.appendChild(el('button', { class: 'btn btn-secondary', onclick: () => root.innerHTML = '' }, 'Cancelar'));
    const ok = el('button', { class: 'btn btn-danger' }, confirmLabel);
    ok.addEventListener('click', async () => { root.innerHTML = ''; await onConfirm(); });
    foot.appendChild(ok); modal.appendChild(foot);
    overlay.appendChild(modal); root.innerHTML = ''; root.appendChild(overlay);
  }

  // Limpia mensajes de error de Postgres para mostrarlos legibles
  function cleanErr(msg) {
    if (!msg) return 'Ocurrió un error.';
    return msg.replace(/^.*?:\s*/, '').replace(/\s+$/, '');
  }

  // ---------- Boot ----------
  (async () => {
    const { data } = await sb.auth.getSession();
    if (data.session && data.session.user) enterApp(data.session.user);
    else showLogin();
  })();
})();
