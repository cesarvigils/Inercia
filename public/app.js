const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];

const state = {
  fleet: [],
  activity: [],
  summary: { total: 0, online: 0, offline: 0, highLoad: 0 },
  generatedAt: null,
  filter: 'all',
  search: '',
  eventSource: null,
  shutdownMode: null,
  shutdownPc: null
};

const icons = {
  pc: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg>',
  power: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.8 0"/></svg>',
  login: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="m10 17 5-5-5-5M15 12H3"/></svg>',
  agent: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8V4H8"/><rect x="4" y="8" width="16" height="12" rx="2"/><path d="M8 13h.01M16 13h.01M9 17h6"/></svg>',
  alert: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.7 2.6 17a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 3.7a2 2 0 0 0-3.4 0Z"/></svg>'
};

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || 'No se pudo completar la solicitud.');
    error.status = response.status;
    throw error;
  }
  return data;
}

function formatPercent(value) {
  return Number.isFinite(value) ? `${Math.round(value)}%` : '—';
}

function formatGb(value) {
  return Number.isFinite(value) ? `${value.toFixed(value >= 100 ? 0 : 1)} GB` : '—';
}

function formatUptime(seconds) {
  if (!Number.isFinite(seconds)) return '—';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  if (days) return `${days}d ${hours}h`;
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

function relativeTime(input) {
  if (!input) return 'Nunca conectado';
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(input).getTime()) / 1000));
  if (seconds < 5) return 'Ahora mismo';
  if (seconds < 60) return `Hace ${seconds}s`;
  if (seconds < 3600) return `Hace ${Math.floor(seconds / 60)} min`;
  if (seconds < 86400) return `Hace ${Math.floor(seconds / 3600)} h`;
  return `Hace ${Math.floor(seconds / 86400)} d`;
}

function meterClass(value) {
  if (!Number.isFinite(value)) return '';
  if (value >= 90) return 'danger';
  if (value >= 75) return 'warning';
  return 'green';
}

function compactOs(os) {
  if (!os) return 'Sin datos';
  return os.replace('Microsoft ', '').replace(/\s+/g, ' ').trim();
}

function render() {
  $('#totalCount').textContent = state.summary.total;
  $('#onlineCount').textContent = state.summary.online;
  $('#offlineCount').textContent = state.summary.offline;
  $('#highLoadCount').textContent = state.summary.highLoad;
  $('#fleetCaption').textContent = `${state.summary.online} de ${state.summary.total} estaciones disponibles`;
  $('#shutdownAllButton').disabled = state.summary.online === 0;
  $('#updatedAt').dataset.timestamp = state.generatedAt || '';
  renderFleet();
  renderActivity();
  refreshRelativeTimes();
}

function renderFleet() {
  const query = state.search.toLocaleLowerCase('es');
  const filtered = state.fleet.filter(pc => {
    if (state.filter === 'online' && !pc.online) return false;
    if (state.filter === 'offline' && pc.online) return false;
    return !query || `${pc.name} ${pc.station} ${pc.id} ${pc.stats?.ip || ''}`.toLocaleLowerCase('es').includes(query);
  });

  if (!filtered.length) {
    $('#fleetGrid').innerHTML = '<div class="empty-state">No hay estaciones que coincidan con este filtro.</div>';
    return;
  }

  $('#fleetGrid').innerHTML = filtered.map(pc => {
    const stats = pc.stats || {};
    const highLoad = pc.online && ((stats.cpuPercent || 0) >= 90 || (stats.memoryPercent || 0) >= 90);
    const needsReboot = pc.online && stats.pendingReboot;
    const stateLabel = highLoad ? 'Carga alta' : needsReboot ? 'Reinicio pendiente' : pc.online ? 'En línea' : 'Sin conexión';
    const badgeClass = highLoad || needsReboot ? 'warning' : pc.online ? '' : 'offline';
    const statusClasses = `${pc.online ? '' : 'is-offline'} ${highLoad ? 'load-high' : ''}`;
    const shutdownDisabled = !pc.online || pc.protected;
    const offlineCopy = pc.lastSeen ? `Última señal ${relativeTime(pc.lastSeen).toLowerCase()}` : 'El agente todavía no ha reportado datos';
    const meta = pc.online ? `
      <div class="resource-pair">
        <div class="resource-block">
          <div class="resource-label"><span>CPU</span><strong>${formatPercent(stats.cpuPercent)}</strong></div>
          <div class="meter ${meterClass(stats.cpuPercent)}"><span style="width:${Number.isFinite(stats.cpuPercent) ? stats.cpuPercent : 0}%"></span></div>
        </div>
        <div class="resource-block">
          <div class="resource-label"><span>RAM</span><strong>${formatPercent(stats.memoryPercent)}</strong></div>
          <div class="meter ${meterClass(stats.memoryPercent)}"><span style="width:${Number.isFinite(stats.memoryPercent) ? stats.memoryPercent : 0}%"></span></div>
        </div>
      </div>
      <div class="pc-meta">
        <div class="meta-item"><span>Memoria</span><strong title="${escapeHtml(formatGb(stats.memoryUsedGb))} de ${escapeHtml(formatGb(stats.memoryTotalGb))}">${escapeHtml(formatGb(stats.memoryUsedGb))} / ${escapeHtml(formatGb(stats.memoryTotalGb))}</strong></div>
        <div class="meta-item"><span>Disco libre</span><strong>${escapeHtml(formatGb(stats.diskFreeGb))}</strong></div>
        <div class="meta-item"><span>Dirección IP</span><strong>${escapeHtml(stats.ip || '—')}</strong></div>
        <div class="meta-item"><span>Encendida</span><strong>${escapeHtml(formatUptime(stats.uptimeSeconds))}</strong></div>
        <div class="meta-item"><span>GPU</span><strong title="${escapeHtml(stats.gpuName || '—')}">${escapeHtml(stats.gpuName || '—')}</strong></div>
        <div class="meta-item"><span>Usuario</span><strong title="${escapeHtml(stats.loggedInUser || 'Sin sesión')}">${escapeHtml(stats.loggedInUser || 'Sin sesión')}</strong></div>
      </div>` : `
      <div class="offline-message"><div><strong>Sin telemetría en vivo</strong>${escapeHtml(offlineCopy)}</div></div>`;

    return `
      <article class="pc-card ${statusClasses}" data-pc-id="${escapeHtml(pc.id)}">
        <div class="pc-top">
          <div class="pc-identity">
            <div class="pc-icon">${icons.pc}<span class="status-pin"></span></div>
            <div class="pc-title">
              <h3 title="${escapeHtml(pc.name)}">${escapeHtml(pc.name)}</h3>
              <p title="${escapeHtml([stats.cpuName, stats.model].filter(Boolean).join(' · '))}">${escapeHtml(pc.station || pc.id)} · ${escapeHtml(compactOs(stats.os))}</p>
            </div>
          </div>
          <span class="status-badge ${badgeClass}">${stateLabel}</span>
        </div>
        ${meta}
        <div class="pc-footer">
          <span class="seen-time" data-relative="${escapeHtml(pc.lastSeen || '')}">${escapeHtml(relativeTime(pc.lastSeen))}</span>
          <button class="shutdown-one" type="button" data-shutdown="${escapeHtml(pc.id)}" ${shutdownDisabled ? 'disabled' : ''} title="${pc.protected ? 'Protegida contra apagado remoto' : pc.online ? 'Apagar esta PC' : 'PC fuera de línea'}">
            ${icons.power}${pc.protected ? 'Protegida' : 'Apagar'}
          </button>
        </div>
      </article>`;
  }).join('');

  $$('[data-shutdown]').forEach(button => {
    button.addEventListener('click', () => openShutdownModal(button.dataset.shutdown));
  });
}

function activityIcon(type) {
  if (type.includes('shutdown')) return { icon: icons.power, cls: 'shutdown' };
  if (type === 'agent') return { icon: icons.agent, cls: 'agent' };
  if (type === 'error') return { icon: icons.alert, cls: 'error' };
  return { icon: icons.login, cls: '' };
}

function renderActivity() {
  if (!state.activity.length) {
    $('#activityList').innerHTML = '<div class="activity-empty">Todavía no hay actividad registrada en esta sesión.</div>';
    return;
  }
  $('#activityList').innerHTML = state.activity.slice(0, 8).map(event => {
    const visual = activityIcon(event.type || '');
    const pc = event.details?.pcId ? state.fleet.find(item => item.id === event.details.pcId) : null;
    return `<div class="activity-item">
      <span class="activity-symbol ${visual.cls}">${visual.icon}</span>
      <div class="activity-copy"><strong>${escapeHtml(event.message)}</strong><span>${escapeHtml(pc?.station || event.details?.ip || 'Sistema')}</span></div>
      <time class="activity-time" data-relative="${escapeHtml(event.at)}">${escapeHtml(relativeTime(event.at))}</time>
    </div>`;
  }).join('');
}

function refreshRelativeTimes() {
  $$('[data-relative]').forEach(element => {
    element.textContent = relativeTime(element.dataset.relative);
  });
  const stamp = $('#updatedAt').dataset.timestamp;
  $('#updatedAt').textContent = stamp ? `Actualizado ${relativeTime(stamp).toLowerCase()}` : 'Esperando datos…';
  $('#serverClock').textContent = new Intl.DateTimeFormat('es-HN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date());
}

function applyPayload(payload) {
  state.fleet = payload.fleet || [];
  state.activity = payload.activity || state.activity;
  state.summary = payload.summary || state.summary;
  state.generatedAt = payload.generatedAt || new Date().toISOString();
  render();
}

async function loadFleet() {
  try {
    applyPayload(await api('/api/fleet'));
  } catch (error) {
    if (error.status === 401) showLogin();
    else toast(error.message, true);
  }
}

function connectEvents() {
  if (state.eventSource) state.eventSource.close();
  const source = new EventSource('/api/events');
  state.eventSource = source;
  source.addEventListener('open', () => setConnection(true));
  source.addEventListener('fleet', event => {
    try { applyPayload(JSON.parse(event.data)); } catch { /* Ignore malformed frame. */ }
  });
  source.addEventListener('activity', event => {
    try {
      const item = JSON.parse(event.data);
      state.activity = [item, ...state.activity.filter(existing => existing.id !== item.id)].slice(0, 20);
      renderActivity();
    } catch { /* Ignore malformed frame. */ }
  });
  source.onerror = () => setConnection(false);
}

function setConnection(connected) {
  const pill = $('#connectionPill');
  pill.className = `connection-pill ${connected ? 'online' : 'offline'}`;
  pill.innerHTML = `<span></span>${connected ? ' En vivo' : ' Reconectando'}`;
}

function showDashboard() {
  $('#loginShell').hidden = true;
  $('#app').hidden = false;
  loadFleet();
  connectEvents();
}

function showLogin() {
  if (state.eventSource) state.eventSource.close();
  state.eventSource = null;
  $('#app').hidden = true;
  $('#loginShell').hidden = false;
  $('#pin').focus();
}

function openShutdownModal(pcId = null) {
  const modal = $('#shutdownModal');
  const input = $('#confirmInput');
  if (pcId) {
    const pc = state.fleet.find(item => item.id === pcId);
    if (!pc || !pc.online || pc.protected) return;
    state.shutdownMode = 'single';
    state.shutdownPc = pc;
    $('#modalEyebrow').textContent = pc.station || 'CONTROL REMOTO';
    $('#modalTitle').textContent = `Apagar ${pc.name}`;
    $('#modalDescription').textContent = 'La estación recibirá una orden de apagado con 20 segundos de aviso.';
    $('#confirmField').hidden = true;
    $('#modalConfirm').disabled = false;
    $('#modalConfirm').textContent = 'Programar apagado';
  } else {
    const count = state.fleet.filter(pc => pc.online && !pc.protected).length;
    if (!count) return;
    state.shutdownMode = 'all';
    state.shutdownPc = null;
    $('#modalEyebrow').textContent = 'ACCIÓN GENERAL';
    $('#modalTitle').textContent = `Apagar ${count} PCs`;
    $('#modalDescription').textContent = 'Se enviará la orden a todas las estaciones en línea. Las PCs protegidas no se apagarán.';
    $('#confirmField').hidden = false;
    input.value = '';
    $('#modalConfirm').disabled = true;
    $('#modalConfirm').textContent = 'Apagar todas';
  }
  modal.hidden = false;
  document.body.style.overflow = 'hidden';
  setTimeout(() => state.shutdownMode === 'all' ? input.focus() : $('#modalConfirm').focus(), 30);
}

function closeShutdownModal() {
  $('#shutdownModal').hidden = true;
  document.body.style.overflow = '';
  state.shutdownMode = null;
  state.shutdownPc = null;
}

async function confirmShutdown() {
  const button = $('#modalConfirm');
  const original = button.textContent;
  button.disabled = true;
  button.textContent = 'Enviando…';
  try {
    const isAll = state.shutdownMode === 'all';
    const payload = isAll
      ? { scope: 'all', confirmation: $('#confirmInput').value.trim() }
      : { scope: 'single', pcId: state.shutdownPc.id, confirmation: state.shutdownPc.id };
    const result = await api('/api/shutdown', { method: 'POST', body: JSON.stringify(payload) });
    closeShutdownModal();
    toast(result.queued === 1 ? 'Orden de apagado en cola.' : `${result.queued} órdenes de apagado en cola.`);
    await loadFleet();
  } catch (error) {
    toast(error.message, true);
    button.disabled = false;
    button.textContent = original;
  }
}

function toast(message, isError = false) {
  const item = document.createElement('div');
  item.className = `toast ${isError ? 'error' : ''}`;
  item.textContent = message;
  $('#toastRegion').append(item);
  setTimeout(() => item.remove(), 4200);
}

$('#loginForm').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button');
  const errorElement = $('#loginError');
  button.disabled = true;
  errorElement.textContent = '';
  try {
    await api('/api/login', { method: 'POST', body: JSON.stringify({ pin: $('#pin').value }) });
    $('#pin').value = '';
    showDashboard();
  } catch (error) {
    errorElement.textContent = error.message;
    $('#pin').select();
  } finally {
    button.disabled = false;
  }
});

$('#logoutButton').addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' }).catch(() => {});
  showLogin();
});

$('#searchInput').addEventListener('input', event => {
  state.search = event.target.value.trim();
  renderFleet();
});

$('#filterTabs').addEventListener('click', event => {
  const button = event.target.closest('[data-filter]');
  if (!button) return;
  state.filter = button.dataset.filter;
  $$('[data-filter]').forEach(item => item.classList.toggle('active', item === button));
  renderFleet();
});

$('#shutdownAllButton').addEventListener('click', () => openShutdownModal());
$('#modalClose').addEventListener('click', closeShutdownModal);
$('#modalCancel').addEventListener('click', closeShutdownModal);
$('#modalConfirm').addEventListener('click', confirmShutdown);
$('#shutdownModal').addEventListener('click', event => { if (event.target === $('#shutdownModal')) closeShutdownModal(); });
$('#confirmInput').addEventListener('input', event => { $('#modalConfirm').disabled = event.target.value.trim() !== 'APAGAR TODO'; });
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !$('#shutdownModal').hidden) closeShutdownModal(); });

setInterval(refreshRelativeTimes, 1000);

(async function init() {
  try {
    const session = await api('/api/session');
    document.title = session.siteName || 'Inercia Control';
    if (session.authenticated) showDashboard();
    else showLogin();
  } catch {
    showLogin();
    $('#loginError').textContent = 'No se pudo conectar con el servidor local.';
  }
})();
