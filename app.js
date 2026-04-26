const SUPABASE_URL = 'https://xmiyieuwpwriggdthoiv.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhtaXlpZXV3cHdyaWdnZHRob2l2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxOTQ5MDgsImV4cCI6MjA5Mjc3MDkwOH0.SG8lUuTtq5cb7wjfEYOQuEGeydGargD5aoyNhBaoSjo';
const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_KEY);

let currentUser = null;
let currentUsuario = null;
let locales = [];
let localActual = null;
let stockItems = [];

// ─── AUTH ────────────────────────────────────────────────
async function login() {
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;
  const errEl = document.getElementById('login-error');
  errEl.textContent = '';
  const { data, error } = await db.auth.signInWithPassword({ email, password });
  if (error) { errEl.textContent = 'Email o contraseña incorrectos'; return; }
  currentUser = data.user;
  await iniciarApp();
}

async function logout() {
  await db.auth.signOut();
  currentUser = null; currentUsuario = null; locales = []; localActual = null; stockItems = [];
  document.getElementById('app').style.display = 'none';
  document.getElementById('login-screen').style.display = 'flex';
}

async function iniciarApp() {
  // 1. Cargar perfil del usuario
  const { data: usuario, error: uError } = await db
    .from('usuarios')
    .select('*, locales(*)')
    .eq('id', currentUser.id)
    .single();

  if (uError || !usuario) {
    document.getElementById('login-error').textContent = 'No tienes perfil asignado. Contacta con el administrador.';
    await db.auth.signOut();
    return;
  }
  currentUsuario = usuario;

  // 2. Cargar locales
  const { data: ls } = await db.from('locales').select('*').order('ciudad');
  locales = ls || [];

  // 3. Determinar local actual
  const isAdmin = currentUsuario.rol === 'admin';
  localActual = isAdmin ? (locales[0]?.id || null) : currentUsuario.local_id;

  // 4. Mostrar app
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  if (isAdmin) document.getElementById('app').classList.add('is-admin');

  document.getElementById('nav-local').textContent = isAdmin ? 'Todos los locales' : (currentUsuario.locales?.ciudad || '');
  document.getElementById('nav-rol').textContent = isAdmin ? 'Admin' : 'Encargado';

  // 5. Renderizar secciones
  await renderStock();
  await renderPedidos();
  await renderTraspasos();
  if (isAdmin) await renderAdmin();
}

// ─── TABS ────────────────────────────────────────────────
function showTab(name, btn) {
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  btn.classList.add('active');
}

// ─── STOCK ───────────────────────────────────────────────
async function renderStock() {
  const isAdmin = currentUsuario?.rol === 'admin';
  const el = document.getElementById('tab-stock');

  let localSelectorHTML = '';
  if (isAdmin && locales.length > 0) {
    localSelectorHTML = `<div class="local-selector">
      ${locales.map((l, i) => `
        <button class="local-btn ${i === 0 ? 'active' : ''}"
          onclick="cambiarLocal('${l.id}', this)">${l.ciudad}</button>
      `).join('')}
    </div>`;
  }

  el.innerHTML = `
    ${localSelectorHTML}
    <div class="metrics" id="stock-metrics">
      <div class="metric"><div class="metric-label">Cargando...</div></div>
    </div>
    <div class="card">
      <div class="card-header">
        <span class="card-title">Inventario</span>
        <select id="filtro-estado" onchange="filtrarStock()"
          style="padding:6px 10px;border:1px solid #ddd;border-radius:8px;font-size:13px">
          <option value="">Todos</option>
          <option value="bajo">Solo bajos</option>
          <option value="ok">Solo correctos</option>
        </select>
      </div>
      <p class="hint">Haz clic en cualquier mínimo para editarlo. Los valores en azul son manuales.</p>
      <div class="filters">
        <input type="text" placeholder="Buscar producto..." id="filtro-texto" oninput="filtrarStock()">
        <select id="filtro-grupo" onchange="filtrarStock()">
          <option value="">Todos los grupos</option>
          <option>Carnes y pescados</option>
          <option>Lácteos y huevos</option>
          <option>Frutas y verduras</option>
          <option>Salsas</option>
          <option>Secos y granos</option>
          <option>Desechables</option>
          <option>Subrecetas</option>
          <option>Otros</option>
        </select>
      </div>
      <div id="stock-loading" style="padding:2rem;text-align:center;color:#aaa">Cargando productos...</div>
      <div style="overflow-x:auto">
        <table>
          <thead><tr>
            <th>Producto</th><th>Stock actual</th><th>Mínimo</th>
            <th>Proveedor</th><th>Grupo</th><th>Estado</th>
          </tr></thead>
          <tbody id="tabla-stock"></tbody>
        </table>
      </div>
    </div>`;

  await cargarStock();
}

async function cargarStock() {
  if (!localActual) {
    document.getElementById('stock-loading').textContent = 'Error: no hay local seleccionado.';
    return;
  }

  document.getElementById('stock-loading').style.display = 'block';
  document.getElementById('stock-loading').textContent = 'Cargando productos...';

  const { data, error } = await db
    .from('stock')
    .select('*, productos(*)')
    .eq('local_id', localActual);

  document.getElementById('stock-loading').style.display = 'none';

  if (error) {
    console.error('Error:', error);
    document.getElementById('stock-loading').style.display = 'block';
    document.getElementById('stock-loading').textContent = 'Error cargando productos: ' + error.message;
    return;
  }

  stockItems = (data || []).sort((a, b) =>
    a.productos.nombre.localeCompare(b.productos.nombre)
  );

  actualizarMetricasStock();
  filtrarStock();
}

function actualizarMetricasStock() {
  const bajos = stockItems.filter(i => i.cantidad < i.minimo).length;
  const criticos = stockItems.filter(i => i.cantidad < i.minimo * 0.5).length;
  const el = document.getElementById('stock-metrics');
  if (!el) return;
  el.innerHTML = `
    <div class="metric"><div class="metric-label">Productos</div><div class="metric-value">${stockItems.length}</div></div>
    <div class="metric"><div class="metric-label">Stock bajo</div><div class="metric-value" style="color:#A32D2D">${bajos}</div><div class="metric-sub">bajo mínimo</div></div>
    <div class="metric"><div class="metric-label">Críticos</div><div class="metric-value" style="color:#993C1D">${criticos}</div><div class="metric-sub">bajo 50%</div></div>
    <div class="metric"><div class="metric-label">Correctos</div><div class="metric-value" style="color:#3B6D11">${stockItems.length - bajos}</div></div>
  `;
}

function filtrarStock() {
  const txt = (document.getElementById('filtro-texto')?.value || '').toLowerCase();
  const grp = document.getElementById('filtro-grupo')?.value || '';
  const est = document.getElementById('filtro-estado')?.value || '';

  const items = stockItems.filter(i => {
    if (!i.productos) return false;
    if (txt && !i.productos.nombre.toLowerCase().includes(txt)) return false;
    if (grp && i.productos.grupo !== grp) return false;
    const bajo = i.cantidad < i.minimo;
    if (est === 'bajo' && !bajo) return false;
    if (est === 'ok' && bajo) return false;
    return true;
  });

  const isAdmin = currentUsuario?.rol === 'admin';
  const tbody = document.getElementById('tabla-stock');
  if (!tbody) return;

  if (items.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#aaa;padding:2rem">No se encontraron productos</td></tr>`;
    return;
  }

  tbody.innerHTML = items.map(i => {
    const bajo = i.cantidad < i.minimo;
    const pct = i.minimo > 0 ? Math.min(100, Math.round((i.cantidad / i.minimo) * 100)) : 100;
    const color = bajo ? (pct < 50 ? '#993C1D' : '#E24B4A') : '#639922';
    const estado = bajo ? (pct < 50 ? 'crítico' : 'bajo') : 'ok';
    const badgeCls = estado === 'ok' ? 'success' : estado === 'bajo' ? 'warning' : 'danger';
    const fmt = v => v >= 1 ? parseFloat(v).toFixed(1) : parseFloat(v).toFixed(2);
    const minCls = i.minimo_override ? 'min-val min-override' : 'min-val';
    const resetBtn = i.minimo_override && isAdmin
      ? `<span class="reset-btn" onclick="resetMinimo('${i.id}')">↺</span>` : '';
    const editMin = isAdmin
      ? `<span class="${minCls}" onclick="editarMinimo(this,'${i.id}','${i.productos.unidad}',${i.minimo})">${fmt(i.minimo)} ${i.productos.unidad}</span>${resetBtn}`
      : `${fmt(i.minimo)} ${i.productos.unidad}`;

    return `<tr class="${bajo ? 'low-stock' : ''}">
      <td style="font-weight:${bajo ? '500' : '400'}">${i.productos.nombre}</td>
      <td>
        <input type="number" value="${i.cantidad}" min="0" step="0.1"
          style="width:65px;padding:2px 6px;border:1px solid #ddd;border-radius:4px;font-size:13px"
          onchange="actualizarStock('${i.id}', this.value)">
        <span style="font-size:11px;color:#aaa">${i.productos.unidad}</span>
        <div class="stock-bar"><div class="stock-fill" style="width:${pct}%;background:${color}"></div></div>
      </td>
      <td>${editMin}</td>
      <td style="color:#888;font-size:12px">${i.productos.proveedor || ''}</td>
      <td style="font-size:12px;color:#666">${i.productos.grupo || ''}</td>
      <td><span class="badge badge-${badgeCls}">${estado}</span></td>
    </tr>`;
  }).join('');
}

async function actualizarStock(id, valor) {
  const { error } = await db.from('stock')
    .update({ cantidad: parseFloat(valor), updated_at: new Date() })
    .eq('id', id);
  if (!error) {
    const item = stockItems.find(i => i.id === id);
    if (item) { item.cantidad = parseFloat(valor); actualizarMetricasStock(); }
  }
}

function editarMinimo(el, id, unidad, current) {
  el.style.display = 'none';
  const input = document.createElement('input');
  input.type = 'number'; input.className = 'min-input';
  input.value = current; input.step = unidad === 'pz' ? 1 : 0.1; input.min = 0;
  input.onblur = () => guardarMinimo(id, unidad, input, el);
  input.onkeydown = e => {
    if (e.key === 'Enter') input.blur();
    if (e.key === 'Escape') { input.remove(); el.style.display = ''; }
  };
  el.parentNode.insertBefore(input, el.nextSibling);
  input.focus(); input.select();
}

async function guardarMinimo(id, unidad, input, el) {
  const val = parseFloat(input.value);
  if (!isNaN(val) && val >= 0) {
    await db.from('stock').update({ minimo: val, minimo_override: true }).eq('id', id);
    const item = stockItems.find(i => i.id === id);
    if (item) { item.minimo = val; item.minimo_override = true; }
  }
  input.remove();
  filtrarStock();
}

async function resetMinimo(id) {
  await db.from('stock').update({ minimo_override: false }).eq('id', id);
  const item = stockItems.find(i => i.id === id);
  if (item) item.minimo_override = false;
  filtrarStock();
}

async function cambiarLocal(localId, btn) {
  document.querySelectorAll('.local-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  localActual = localId;
  await cargarStock();
}

// ─── PEDIDOS ─────────────────────────────────────────────
async function renderPedidos() {
  const isAdmin = currentUsuario?.rol === 'admin';
  const el = document.getElementById('tab-pedidos');
  el.innerHTML = `
    <div class="metrics" id="pedidos-metrics"></div>
    <div class="card">
      <div class="card-header">
        <span class="card-title">Pedidos a proveedores</span>
        <button class="btn btn-primary btn-sm" onclick="toggleFormPedido()">+ Nuevo pedido</button>
      </div>
      <div style="overflow-x:auto">
        <table>
          <thead><tr>
            <th>Proveedor</th>${isAdmin ? '<th>Local</th>' : ''}
            <th>Importe</th><th>Fecha entrega</th><th>Estado</th><th>Notas</th>
          </tr></thead>
          <tbody id="tabla-pedidos"></tbody>
        </table>
      </div>
    </div>
    <div class="card" id="form-pedido" style="display:none">
      <div class="card-header"><span class="card-title">Nuevo pedido</span></div>
      <div class="form-row">
        <div class="form-group"><label>Proveedor</label>
          <select id="np-prov">
            <option>CRISTIAN MARTIN</option><option>MERCADONA</option><option>PUNTOQPACK</option>
            <option>CONPE</option><option>ALGIRSO</option><option>PATRICIO PEREZ</option>
            <option>CARLOS TEXEIRA</option><option>GARCIA DE POU</option><option>UNICASH</option>
            <option>FABRIPAN</option><option>DIA</option>
          </select>
        </div>
        ${isAdmin ? `<div class="form-group"><label>Local</label>
          <select id="np-local">${locales.map(l => `<option value="${l.id}">${l.ciudad}</option>`).join('')}</select>
        </div>` : ''}
      </div>
      <div class="form-row">
        <div class="form-group"><label>Importe (€)</label><input type="number" id="np-importe" placeholder="0.00"></div>
        <div class="form-group"><label>Fecha entrega</label><input type="date" id="np-fecha"></div>
      </div>
      <div class="form-group" style="margin-bottom:12px">
        <label>Notas / productos</label>
        <textarea id="np-notas" rows="2" placeholder="Ej: 10kg carne ternera, 300ud brioche..."></textarea>
      </div>
      <div class="form-actions">
        <button class="btn btn-primary" onclick="crearPedido()">Crear pedido</button>
        <button class="btn" onclick="toggleFormPedido()">Cancelar</button>
      </div>
    </div>`;
  await cargarPedidos();
}

async function cargarPedidos() {
  const isAdmin = currentUsuario?.rol === 'admin';
  let query = db.from('pedidos').select('*, locales(ciudad)').order('created_at', { ascending: false });
  if (!isAdmin) query = query.eq('local_id', localActual);
  const { data } = await query;
  const pedidos = data || [];
  const pendientes = pedidos.filter(p => p.estado === 'pendiente' || p.estado === 'en tránsito').length;
  document.getElementById('pedidos-metrics').innerHTML = `
    <div class="metric"><div class="metric-label">Total</div><div class="metric-value">${pedidos.length}</div></div>
    <div class="metric"><div class="metric-label">En tránsito</div><div class="metric-value">${pendientes}</div></div>
  `;
  const badgeMap = { 'recibido': 'success', 'en tránsito': 'info', 'pendiente': 'warning', 'cancelado': 'danger' };
  document.getElementById('tabla-pedidos').innerHTML = pedidos.map(p => `<tr>
    <td>${p.proveedor}</td>
    ${isAdmin ? `<td style="color:#888">${p.locales?.ciudad || ''}</td>` : ''}
    <td>${p.importe ? p.importe + '€' : '—'}</td>
    <td style="color:#888">${p.fecha_entrega || '—'}</td>
    <td><span class="badge badge-${badgeMap[p.estado] || 'info'}">${p.estado}</span></td>
    <td style="color:#888;font-size:12px">${p.notas || ''}</td>
  </tr>`).join('') || '<tr><td colspan="6" style="text-align:center;color:#aaa;padding:1rem">No hay pedidos</td></tr>';
}

function toggleFormPedido() {
  const f = document.getElementById('form-pedido');
  f.style.display = f.style.display === 'none' ? 'block' : 'none';
}

async function crearPedido() {
  const isAdmin = currentUsuario?.rol === 'admin';
  const localId = isAdmin ? document.getElementById('np-local').value : localActual;
  await db.from('pedidos').insert({
    local_id: localId,
    proveedor: document.getElementById('np-prov').value,
    importe: parseFloat(document.getElementById('np-importe').value) || 0,
    fecha_entrega: document.getElementById('np-fecha').value || null,
    notas: document.getElementById('np-notas').value,
    estado: 'pendiente'
  });
  toggleFormPedido();
  await cargarPedidos();
}

// ─── TRASPASOS ───────────────────────────────────────────
async function renderTraspasos() {
  const el = document.getElementById('tab-traspasos');
  const { data: prods } = await db.from('productos').select('id, nombre').order('nombre');
  const productos = prods || [];
  el.innerHTML = `
    <div class="card">
      <div class="card-header">
        <span class="card-title">Traspasos entre locales</span>
        <button class="btn btn-primary btn-sm" onclick="toggleFormTraspaso()">+ Nuevo traspaso</button>
      </div>
      <div style="overflow-x:auto">
        <table>
          <thead><tr><th>Producto</th><th>Desde</th><th>Hacia</th><th>Cantidad</th><th>Estado</th></tr></thead>
          <tbody id="tabla-traspasos"></tbody>
        </table>
      </div>
    </div>
    <div class="card" id="form-traspaso" style="display:none">
      <div class="card-header"><span class="card-title">Nuevo traspaso</span></div>
      <div class="form-row">
        <div class="form-group"><label>Desde</label>
          <select id="tr-desde">${locales.map(l => `<option value="${l.id}">${l.ciudad}</option>`).join('')}</select>
        </div>
        <div class="form-group"><label>Hacia</label>
          <select id="tr-hacia">${locales.map(l => `<option value="${l.id}">${l.ciudad}</option>`).join('')}</select>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Producto</label>
          <select id="tr-producto">
            <option value="">Seleccionar...</option>
            ${productos.map(p => `<option value="${p.id}">${p.nombre}</option>`).join('')}
          </select>
        </div>
        <div class="form-group"><label>Cantidad</label>
          <input type="number" id="tr-cantidad" placeholder="0" min="0" step="0.1">
        </div>
      </div>
      <div class="form-actions">
        <button class="btn btn-primary" onclick="crearTraspaso()">Registrar traspaso</button>
        <button class="btn" onclick="toggleFormTraspaso()">Cancelar</button>
      </div>
    </div>`;
  await cargarTraspasos();
}

async function cargarTraspasos() {
  const isAdmin = currentUsuario?.rol === 'admin';
  let query = db.from('traspasos')
    .select('*, productos(nombre), desde:locales!traspasos_desde_local_id_fkey(ciudad), hacia:locales!traspasos_hacia_local_id_fkey(ciudad)')
    .order('created_at', { ascending: false });
  if (!isAdmin) query = query.or(`desde_local_id.eq.${localActual},hacia_local_id.eq.${localActual}`);
  const { data } = await query;
  const badgeMap = { 'completado': 'success', 'pendiente': 'warning', 'cancelado': 'danger' };
  document.getElementById('tabla-traspasos').innerHTML = (data || []).map(t => `<tr>
    <td>${t.productos?.nombre || ''}</td>
    <td style="color:#888">${t.desde?.ciudad || ''}</td>
    <td style="color:#888">${t.hacia?.ciudad || ''}</td>
    <td>${t.cantidad}</td>
    <td><span class="badge badge-${badgeMap[t.estado] || 'info'}">${t.estado}</span></td>
  </tr>`).join('') || '<tr><td colspan="5" style="text-align:center;color:#aaa;padding:1rem">No hay traspasos</td></tr>';
}

function toggleFormTraspaso() {
  const f = document.getElementById('form-traspaso');
  f.style.display = f.style.display === 'none' ? 'block' : 'none';
}

async function crearTraspaso() {
  const desde = document.getElementById('tr-desde').value;
  const hacia = document.getElementById('tr-hacia').value;
  const producto = document.getElementById('tr-producto').value;
  const cantidad = parseFloat(document.getElementById('tr-cantidad').value) || 0;
  if (!producto) { alert('Selecciona un producto'); return; }
  if (desde === hacia) { alert('El local de origen y destino no pueden ser el mismo'); return; }
  await db.from('traspasos').insert({ desde_local_id: desde, hacia_local_id: hacia, producto_id: producto, cantidad, estado: 'pendiente' });
  toggleFormTraspaso();
  await cargarTraspasos();
}

// ─── ADMIN ───────────────────────────────────────────────
async function renderAdmin() {
  const el = document.getElementById('tab-admin');
  el.innerHTML = `
    <div class="card">
      <div class="card-header">
        <span class="card-title">Usuarios y accesos</span>
        <button class="btn btn-primary btn-sm" onclick="toggleFormUsuario()">+ Nuevo usuario</button>
      </div>
      <table>
        <thead><tr><th>Nombre</th><th>Rol</th><th>Local</th></tr></thead>
        <tbody id="tabla-usuarios"></tbody>
      </table>
    </div>
    <div class="card" id="form-usuario" style="display:none">
      <div class="card-header"><span class="card-title">Añadir usuario</span></div>
      <p style="font-size:13px;color:#888;margin-bottom:12px">
        Crea primero el usuario en Supabase → Authentication → Users, luego asígnalo aquí.
      </p>
      <div class="form-row">
        <div class="form-group"><label>Nombre</label><input type="text" id="u-nombre" placeholder="Nombre del encargado"></div>
        <div class="form-group"><label>User ID (de Supabase)</label><input type="text" id="u-id" placeholder="uuid del usuario"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Rol</label>
          <select id="u-rol"><option value="encargado">Encargado</option><option value="admin">Admin</option></select>
        </div>
        <div class="form-group"><label>Local asignado</label>
          <select id="u-local">
            <option value="">— (solo admin)</option>
            ${locales.map(l => `<option value="${l.id}">${l.ciudad}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="form-actions">
        <button class="btn btn-primary" onclick="crearUsuario()">Guardar usuario</button>
        <button class="btn" onclick="toggleFormUsuario()">Cancelar</button>
      </div>
    </div>`;
  await cargarUsuarios();
}

async function cargarUsuarios() {
  const { data } = await db.from('usuarios').select('*, locales(ciudad)');
  document.getElementById('tabla-usuarios').innerHTML = (data || []).map(u => `<tr>
    <td>${u.nombre || '—'}</td>
    <td><span class="badge badge-${u.rol === 'admin' ? 'info' : 'success'}">${u.rol}</span></td>
    <td style="color:#888">${u.locales?.ciudad || 'Todos los locales'}</td>
  </tr>`).join('');
}

function toggleFormUsuario() {
  const f = document.getElementById('form-usuario');
  f.style.display = f.style.display === 'none' ? 'block' : 'none';
}

async function crearUsuario() {
  const id = document.getElementById('u-id').value.trim();
  const nombre = document.getElementById('u-nombre').value.trim();
  const rol = document.getElementById('u-rol').value;
  const localId = document.getElementById('u-local').value || null;
  if (!id || !nombre) { alert('Completa todos los campos'); return; }
  const { error } = await db.from('usuarios').insert({ id, nombre, rol, local_id: localId });
  if (error) { alert('Error: ' + error.message); return; }
  toggleFormUsuario();
  await cargarUsuarios();
}

// ─── INIT ────────────────────────────────────────────────
db.auth.getSession().then(({ data: { session } }) => {
  if (session) { currentUser = session.user; iniciarApp(); }
});
