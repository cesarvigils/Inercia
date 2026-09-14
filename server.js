import http from 'node:http';
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync, appendFile } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, timingSafeEqual } from 'node:crypto';

const root = fileURLToPath(new URL('.', import.meta.url));
const publicDir = join(root, 'public');
const dataDir = join(root, '.data');
const configPath = process.env.INERCIA_CONFIG || join(root, 'config.json');

function loadConfig() {
  const source = existsSync(configPath) ? configPath : join(root, 'config.example.json');
  const file = JSON.parse(readFileSync(source, 'utf8').replace(/^\uFEFF/, ''));
  return {
    port: Number(process.env.PORT || file.port || 8787),
    host: process.env.HOST || file.host || '0.0.0.0',
    adminPin: process.env.ADMIN_PIN || file.adminPin,
    agentToken: process.env.AGENT_TOKEN || file.agentToken,
    offlineAfterSeconds: Number(process.env.OFFLINE_AFTER_SECONDS || file.offlineAfterSeconds || 25),
    siteName: file.siteName || 'Inercia Control',
    fleet: Array.isArray(file.fleet) ? file.fleet : []
  };
}

const config = loadConfig();
if (!config.adminPin || !config.agentToken || config.adminPin === 'CHANGE-ME' || config.agentToken === 'CHANGE-ME') {
  console.error('Configuración incompleta. Ejecutá scripts/setup-server.ps1 o definí ADMIN_PIN y AGENT_TOKEN.');
  process.exit(1);
}

mkdirSync(dataDir, { recursive: true });

const sessions = new Map();
const machines = new Map();
const commands = new Map();
const activity = [];
const sseClients = new Set();
const loginAttempts = new Map();

for (const item of config.fleet) {
  const id = cleanId(item.id);
  if (!id) continue;
  machines.set(id, {
    id,
    name: safeText(item.name, 64) || id,
    station: safeText(item.station, 64),
    protected: item.protected === true,
    registered: true,
    lastSeen: null,
    stats: null,
    agentVersion: null
  });
}

function safeText(value, max = 128) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function cleanId(value) {
  return safeText(value, 64).toLowerCase().replace(/[^a-z0-9_-]/g, '');
}

function clampNumber(value, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : null;
}

function equalSecret(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && timingSafeEqual(a, b);
}

function json(res, status, payload, headers = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers
  });
  res.end(body);
}

function getClientIp(req) {
  return req.socket.remoteAddress || 'unknown';
}

function getCookie(req, name) {
  const cookies = String(req.headers.cookie || '').split(';');
  for (const cookie of cookies) {
    const [key, ...rest] = cookie.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

function isAdmin(req) {
  const token = getCookie(req, 'inercia_session');
  if (!token) return false;
  const session = sessions.get(token);
  if (!session || session.expiresAt < Date.now()) {
    if (session) sessions.delete(token);
    return false;
  }
  session.expiresAt = Date.now() + 12 * 60 * 60 * 1000;
  return true;
}

function isAgent(req) {
  const header = String(req.headers.authorization || '');
  return header.startsWith('Bearer ') && equalSecret(header.slice(7), config.agentToken);
}

async function readJson(req, limit = 64 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('PAYLOAD_TOO_LARGE');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Error('INVALID_JSON');
  }
}

function logEvent(type, message, details = {}) {
  const event = {
    id: randomBytes(8).toString('hex'),
    type,
    message,
    details,
    at: new Date().toISOString()
  };
  activity.unshift(event);
  if (activity.length > 100) activity.length = 100;
  appendFile(join(dataDir, 'events.jsonl'), `${JSON.stringify(event)}\n`, () => {});
  broadcast('activity', event);
  return event;
}

function publicMachine(machine) {
  const online = machine.lastSeen !== null && Date.now() - machine.lastSeen < config.offlineAfterSeconds * 1000;
  return {
    id: machine.id,
    name: machine.name,
    station: machine.station,
    protected: machine.protected,
    registered: machine.registered,
    online,
    lastSeen: machine.lastSeen ? new Date(machine.lastSeen).toISOString() : null,
    stats: machine.stats,
    agentVersion: machine.agentVersion
  };
}

function fleetPayload() {
  const fleet = [...machines.values()].map(publicMachine).sort((a, b) => {
    if (a.protected !== b.protected) return a.protected ? 1 : -1;
    return a.name.localeCompare(b.name, 'es', { numeric: true });
  });
  const online = fleet.filter(item => item.online).length;
  const highLoad = fleet.filter(item => item.online && ((item.stats?.cpuPercent || 0) >= 90 || (item.stats?.memoryPercent || 0) >= 90)).length;
  return {
    generatedAt: new Date().toISOString(),
    offlineAfterSeconds: config.offlineAfterSeconds,
    summary: { total: fleet.length, online, offline: fleet.length - online, highLoad },
    fleet,
    activity: activity.slice(0, 20)
  };
}

function broadcast(eventName, payload) {
  const frame = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of sseClients) client.write(frame);
}

function broadcastFleet() {
  broadcast('fleet', fleetPayload());
}

function sanitizeStats(body, req) {
  const stats = body.stats || {};
  const memoryTotalGb = clampNumber(stats.memoryTotalGb, 0, 4096);
  const memoryUsedGb = clampNumber(stats.memoryUsedGb, 0, 4096);
  const diskTotalGb = clampNumber(stats.diskTotalGb, 0, 65536);
  const diskFreeGb = clampNumber(stats.diskFreeGb, 0, 65536);
  return {
    ip: safeText(body.ip || getClientIp(req).replace(/^::ffff:/, ''), 64),
    os: safeText(stats.os, 128),
    model: safeText(stats.model, 128),
    loggedInUser: safeText(stats.loggedInUser, 128),
    cpuName: safeText(stats.cpuName, 128),
    cpuPercent: clampNumber(stats.cpuPercent, 0, 100),
    memoryTotalGb,
    memoryUsedGb,
    memoryPercent: memoryTotalGb && memoryUsedGb !== null ? Math.round(memoryUsedGb / memoryTotalGb * 100) : clampNumber(stats.memoryPercent, 0, 100),
    diskTotalGb,
    diskFreeGb,
    diskPercent: diskTotalGb && diskFreeGb !== null ? Math.round((diskTotalGb - diskFreeGb) / diskTotalGb * 100) : clampNumber(stats.diskPercent, 0, 100),
    gpuName: safeText(stats.gpuName, 160),
    uptimeSeconds: clampNumber(stats.uptimeSeconds, 0, 315360000),
    pendingReboot: stats.pendingReboot === true
  };
}

function queueCommand(machine, commandType) {
  const existingQueue = commands.get(machine.id) || [];
  const queue = existingQueue.filter(item => {
    if (!item.completedAt) return true;
    return Date.now() - new Date(item.completedAt).getTime() < 24 * 60 * 60 * 1000;
  }).slice(-20);
  const pending = queue.find(item => item.type === commandType && (item.status === 'queued' || item.status === 'delivered'));
  if (pending) return pending;
  const item = {
    id: randomBytes(12).toString('hex'),
    type: commandType,
    createdAt: new Date().toISOString(),
    status: 'queued',
    deliveries: 0,
    lastDeliveredAt: null
  };
  queue.push(item);
  commands.set(machine.id, queue);
  return item;
}

function nextCommand(pcId) {
  const queue = commands.get(pcId) || [];
  const now = Date.now();
  return queue.find(item => {
    if (item.status === 'queued') return true;
    if (item.status === 'delivered' && item.deliveries < 3 && now - item.lastDeliveredAt > 15000) return true;
    return false;
  }) || null;
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

function securityHeaders(res) {
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
}

async function handleApi(req, res, url) {
  if (req.method === 'POST' && url.pathname === '/api/login') {
    const ip = getClientIp(req);
    const attempts = loginAttempts.get(ip) || { count: 0, blockedUntil: 0 };
    if (attempts.blockedUntil > Date.now()) return json(res, 429, { error: 'Esperá un minuto antes de intentar otra vez.' });
    const body = await readJson(req);
    if (!equalSecret(body.pin, config.adminPin)) {
      attempts.count += 1;
      if (attempts.count >= 5) {
        attempts.count = 0;
        attempts.blockedUntil = Date.now() + 60000;
      }
      loginAttempts.set(ip, attempts);
      return json(res, 401, { error: 'PIN incorrecto.' });
    }
    loginAttempts.delete(ip);
    const token = randomBytes(32).toString('base64url');
    sessions.set(token, { ip, expiresAt: Date.now() + 12 * 60 * 60 * 1000 });
    logEvent('login', 'Sesión de administración iniciada', { ip });
    return json(res, 200, { ok: true }, {
      'Set-Cookie': `inercia_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200`
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/logout') {
    const token = getCookie(req, 'inercia_session');
    if (token) sessions.delete(token);
    return json(res, 200, { ok: true }, {
      'Set-Cookie': 'inercia_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/session') {
    return json(res, 200, { authenticated: isAdmin(req), siteName: config.siteName });
  }

  if (req.method === 'POST' && url.pathname === '/api/agent/check-in') {
    if (!isAgent(req)) return json(res, 401, { error: 'Agent token inválido.' });
    const body = await readJson(req);
    const id = cleanId(body.pcId);
    if (!id) return json(res, 400, { error: 'pcId requerido.' });
    let machine = machines.get(id);
    const firstSeen = !machine;
    if (!machine) {
      machine = {
        id,
        name: safeText(body.name, 64) || id,
        station: 'Sin asignar',
        protected: false,
        registered: false,
        lastSeen: null,
        stats: null,
        agentVersion: null
      };
      machines.set(id, machine);
    }
    machine.name = machine.registered ? machine.name : (safeText(body.name, 64) || machine.name);
    machine.lastSeen = Date.now();
    machine.agentVersion = safeText(body.agentVersion, 24);
    machine.stats = sanitizeStats(body, req);
    if (firstSeen) logEvent('agent', `${machine.name} se registró por primera vez`, { pcId: id });
    broadcastFleet();
    return json(res, 200, { ok: true, nextCheckSeconds: 10 });
  }

  if (req.method === 'GET' && url.pathname === '/api/agent/commands') {
    if (!isAgent(req)) return json(res, 401, { error: 'Agent token inválido.' });
    const pcId = cleanId(url.searchParams.get('pcId'));
    const machine = machines.get(pcId);
    if (!pcId || !machine) return json(res, 404, { error: 'PC desconocida.' });
    const command = nextCommand(pcId);
    if (!command) return json(res, 200, { command: null });
    command.status = 'delivered';
    command.deliveries += 1;
    command.lastDeliveredAt = Date.now();
    return json(res, 200, { command: { id: command.id, type: command.type } });
  }

  if (req.method === 'POST' && url.pathname === '/api/agent/command-result') {
    if (!isAgent(req)) return json(res, 401, { error: 'Agent token inválido.' });
    const body = await readJson(req);
    const pcId = cleanId(body.pcId);
    const queue = commands.get(pcId) || [];
    const command = queue.find(item => item.id === safeText(body.commandId, 64));
    if (!command) return json(res, 404, { error: 'Comando desconocido.' });
    command.status = body.status === 'failed' ? 'failed' : 'accepted';
    command.result = safeText(body.message, 180);
    command.completedAt = new Date().toISOString();
    const machine = machines.get(pcId);
    logEvent(command.status === 'failed' ? 'error' : 'shutdown', command.status === 'failed' ? `No se pudo apagar ${machine?.name || pcId}` : `Apagado enviado a ${machine?.name || pcId}`, { pcId, commandId: command.id, result: command.result });
    broadcastFleet();
    return json(res, 200, { ok: true });
  }

  if (!isAdmin(req)) return json(res, 401, { error: 'Sesión requerida.' });

  if (req.method === 'GET' && url.pathname === '/api/fleet') {
    return json(res, 200, fleetPayload());
  }

  if (req.method === 'GET' && url.pathname === '/api/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.write(`event: fleet\ndata: ${JSON.stringify(fleetPayload())}\n\n`);
    sseClients.add(res);
    const keepAlive = setInterval(() => res.write(': keepalive\n\n'), 20000);
    req.on('close', () => {
      clearInterval(keepAlive);
      sseClients.delete(res);
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/shutdown') {
    if (!sameOrigin(req)) return json(res, 403, { error: 'Origen inválido.' });
    const body = await readJson(req);
    const scope = body.scope === 'all' ? 'all' : 'single';
    const eligible = [...machines.values()].filter(machine => {
      const online = machine.lastSeen && Date.now() - machine.lastSeen < config.offlineAfterSeconds * 1000;
      return online && !machine.protected;
    });

    if (scope === 'all') {
      if (body.confirmation !== 'APAGAR TODO') return json(res, 400, { error: 'Confirmación inválida.' });
      if (!eligible.length) return json(res, 409, { error: 'No hay PCs en línea disponibles para apagar.' });
      const queued = eligible.map(machine => ({ machine, command: queueCommand(machine, 'shutdown') }));
      logEvent('shutdown-all', `Apagado general programado para ${queued.length} PCs`, { pcIds: queued.map(item => item.machine.id) });
      broadcastFleet();
      return json(res, 202, { ok: true, queued: queued.length });
    }

    const pcId = cleanId(body.pcId);
    const machine = machines.get(pcId);
    if (!machine) return json(res, 404, { error: 'PC no encontrada.' });
    if (machine.protected) return json(res, 403, { error: 'Esta PC está protegida contra apagado remoto.' });
    const online = machine.lastSeen && Date.now() - machine.lastSeen < config.offlineAfterSeconds * 1000;
    if (!online) return json(res, 409, { error: 'La PC está fuera de línea.' });
    if (body.confirmation !== machine.id) return json(res, 400, { error: 'Confirmación inválida.' });
    const command = queueCommand(machine, 'shutdown');
    logEvent('shutdown-request', `Apagado solicitado para ${machine.name}`, { pcId: machine.id, commandId: command.id });
    broadcastFleet();
    return json(res, 202, { ok: true, queued: 1, commandId: command.id });
  }

  return json(res, 404, { error: 'Ruta no encontrada.' });
}

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

function serveStatic(req, res, url) {
  const requested = url.pathname === '/' ? '/index.html' : url.pathname;
  const resolved = normalize(join(publicDir, requested));
  if (!resolved.startsWith(publicDir)) return json(res, 403, { error: 'Acceso denegado.' });
  const file = existsSync(resolved) ? resolved : join(publicDir, 'index.html');
  securityHeaders(res);
  res.writeHead(200, {
    'Content-Type': mime[extname(file)] || 'application/octet-stream',
    'Cache-Control': extname(file) === '.html' ? 'no-cache' : 'public, max-age=3600'
  });
  createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  securityHeaders(res);
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'Método no permitido.' });
    return serveStatic(req, res, url);
  } catch (error) {
    const status = error.message === 'PAYLOAD_TOO_LARGE' ? 413 : error.message === 'INVALID_JSON' ? 400 : 500;
    if (status === 500) console.error(error);
    return json(res, status, { error: status === 500 ? 'Error interno.' : 'Solicitud inválida.' });
  }
});

const expirySweep = setInterval(() => {
  const now = Date.now();
  for (const [token, session] of sessions) if (session.expiresAt < now) sessions.delete(token);
  for (const [pcId, queue] of commands) {
    for (const command of queue) {
      if (command.status === 'delivered' && command.deliveries >= 3 && now - command.lastDeliveredAt > 20000) {
        command.status = 'failed';
        command.completedAt = new Date().toISOString();
        command.result = 'El agente no confirmó la orden después de tres intentos.';
        logEvent('error', `Sin confirmación de ${machines.get(pcId)?.name || pcId}`, { pcId, commandId: command.id });
      }
    }
  }
  broadcastFleet();
}, 10000);
expirySweep.unref();

server.listen(config.port, config.host, () => {
  console.log(`Inercia Control disponible en http://${config.host}:${config.port}`);
});

function shutdownServer() {
  for (const client of sseClients) client.end();
  server.close(() => process.exit(0));
}
process.on('SIGINT', shutdownServer);
process.on('SIGTERM', shutdownServer);

export { server, config };
