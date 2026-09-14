import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const port = 19000 + Math.floor(Math.random() * 3000);
const baseUrl = `http://127.0.0.1:${port}`;
const projectRoot = resolve(new URL('..', import.meta.url).pathname);
const tempDir = mkdtempSync(join(tmpdir(), 'inercia-test-'));
const configPath = join(tempDir, 'config.json');
const adminPin = 'test-4268';
const agentToken = 'test-agent-token-that-is-long';

writeFileSync(configPath, JSON.stringify({
  port,
  host: '127.0.0.1',
  adminPin,
  agentToken,
  offlineAfterSeconds: 25,
  fleet: [
    { id: 'sim-01', name: 'Simulador 01', station: 'Standard 1' },
    { id: 'sim-02', name: 'Simulador 02', station: 'Standard 2' },
    { id: 'admin', name: 'Administración', station: 'Front desk', protected: true }
  ]
}));

let server;
let cookie;

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/session`);
      if (response.ok) return;
    } catch {}
    await new Promise(resolvePromise => setTimeout(resolvePromise, 80));
  }
  throw new Error('El servidor de prueba no inició.');
}

async function request(path, { agent = false, ...options } = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (agent) headers.Authorization = `Bearer ${agentToken}`;
  if (cookie) headers.Cookie = cookie;
  return fetch(`${baseUrl}${path}`, { ...options, headers });
}

test.before(async () => {
  server = spawn(process.execPath, ['server.js'], {
    cwd: projectRoot,
    env: { ...process.env, INERCIA_CONFIG: configPath },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  await waitForServer();
});

test.after(() => {
  server?.kill('SIGTERM');
});

test('rechaza agentes sin token', async () => {
  const response = await request('/api/agent/check-in', { method: 'POST', body: JSON.stringify({ pcId: 'sim-01' }) });
  assert.equal(response.status, 401);
});

test('sirve la interfaz con cabeceras de seguridad', async () => {
  const response = await request('/');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/html/);
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.match(await response.text(), /Inercia Control/);
});

test('inicia sesión y entrega cookie HttpOnly', async () => {
  const wrong = await request('/api/login', { method: 'POST', body: JSON.stringify({ pin: 'wrong' }) });
  assert.equal(wrong.status, 401);

  const response = await request('/api/login', { method: 'POST', body: JSON.stringify({ pin: adminPin }) });
  assert.equal(response.status, 200);
  cookie = response.headers.get('set-cookie').split(';')[0];
  assert.match(response.headers.get('set-cookie'), /HttpOnly/);
  assert.match(response.headers.get('set-cookie'), /SameSite=Strict/);
});

test('recibe telemetría y marca la PC en línea', async () => {
  const response = await request('/api/agent/check-in', {
    agent: true,
    method: 'POST',
    body: JSON.stringify({
      pcId: 'sim-01',
      name: 'PC alterado',
      ip: '192.168.20.101',
      agentVersion: 'test',
      stats: { cpuPercent: 37, memoryTotalGb: 16, memoryUsedGb: 8, diskTotalGb: 1000, diskFreeGb: 400, os: 'Windows 11' }
    })
  });
  assert.equal(response.status, 200);

  const fleetResponse = await request('/api/fleet');
  assert.equal(fleetResponse.status, 200);
  const payload = await fleetResponse.json();
  const pc = payload.fleet.find(item => item.id === 'sim-01');
  assert.equal(pc.online, true);
  assert.equal(pc.name, 'Simulador 01', 'el agente no puede cambiar el inventario registrado');
  assert.equal(pc.stats.memoryPercent, 50);
});

test('requiere confirmación y entrega solo el comando permitido', async () => {
  const invalid = await request('/api/shutdown', {
    method: 'POST',
    body: JSON.stringify({ scope: 'single', pcId: 'sim-01', confirmation: 'wrong' })
  });
  assert.equal(invalid.status, 400);

  const queued = await request('/api/shutdown', {
    method: 'POST',
    body: JSON.stringify({ scope: 'single', pcId: 'sim-01', confirmation: 'sim-01' })
  });
  assert.equal(queued.status, 202);
  assert.equal((await queued.json()).queued, 1);

  const poll = await request('/api/agent/commands?pcId=sim-01', { agent: true });
  const { command } = await poll.json();
  assert.equal(command.type, 'shutdown');
  assert.match(command.id, /^[a-f0-9]{24}$/);

  const ack = await request('/api/agent/command-result', {
    agent: true,
    method: 'POST',
    body: JSON.stringify({ pcId: 'sim-01', commandId: command.id, status: 'accepted', message: 'Test accepted' })
  });
  assert.equal(ack.status, 200);
});

test('apagado general excluye la PC protegida', async () => {
  for (const pcId of ['sim-02', 'admin']) {
    const response = await request('/api/agent/check-in', {
      agent: true,
      method: 'POST',
      body: JSON.stringify({ pcId, stats: { cpuPercent: 10, memoryTotalGb: 16, memoryUsedGb: 4 } })
    });
    assert.equal(response.status, 200);
  }

  const invalid = await request('/api/shutdown', {
    method: 'POST',
    body: JSON.stringify({ scope: 'all', confirmation: 'apagar todo' })
  });
  assert.equal(invalid.status, 400);

  const response = await request('/api/shutdown', {
    method: 'POST',
    body: JSON.stringify({ scope: 'all', confirmation: 'APAGAR TODO' })
  });
  assert.equal(response.status, 202);
  assert.equal((await response.json()).queued, 2);

  const protectedPoll = await request('/api/agent/commands?pcId=admin', { agent: true });
  assert.equal((await protectedPoll.json()).command, null);
});
