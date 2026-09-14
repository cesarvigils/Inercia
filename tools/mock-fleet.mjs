const baseUrl = (process.env.SERVER_URL || 'http://127.0.0.1:8787').replace(/\/$/, '');
const token = process.env.AGENT_TOKEN;

if (!token) {
  console.error('Definí AGENT_TOKEN antes de iniciar la flota de demostración.');
  process.exit(1);
}

const stations = Array.from({ length: 10 }, (_, index) => ({
  id: `sim-${String(index + 1).padStart(2, '0')}`,
  name: `Simulador ${String(index + 1).padStart(2, '0')}`,
  ip: `192.168.20.${101 + index}`,
  premium: index >= 8
}));

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...options
  });
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  return response.json();
}

async function tick(station, index) {
  const now = Date.now() / 1000;
  const cpu = Math.max(4, Math.min(98, Math.round(28 + Math.sin(now / 7 + index) * 18 + Math.random() * 12)));
  const memory = station.premium ? 32 : 16;
  const used = Math.round((memory * (.42 + Math.random() * .18)) * 10) / 10;
  await request('/api/agent/check-in', {
    method: 'POST',
    body: JSON.stringify({
      pcId: station.id,
      name: station.name,
      ip: station.ip,
      agentVersion: 'demo-1.0.0',
      stats: {
        os: 'Microsoft Windows 11 Pro',
        model: 'Inercia Custom Rig',
        loggedInUser: `INERCIA\\driver${index + 1}`,
        cpuName: station.premium ? 'AMD Ryzen 7 5700X' : 'AMD Ryzen 5 5500',
        cpuPercent: cpu,
        memoryTotalGb: memory,
        memoryUsedGb: used,
        diskTotalGb: 930,
        diskFreeGb: Math.round(280 + Math.random() * 280),
        gpuName: station.premium ? 'NVIDIA GeForce RTX 4070' : 'NVIDIA GeForce RTX 3060',
        uptimeSeconds: Math.round(3600 * (2 + index * .8)),
        pendingReboot: index === 6
      }
    })
  });

  const { command } = await request(`/api/agent/commands?pcId=${station.id}`);
  if (command) {
    console.log(`[DEMO] ${station.name} recibió ${command.type}. No se apagará ningún equipo.`);
    await request('/api/agent/command-result', {
      method: 'POST',
      body: JSON.stringify({ pcId: station.id, commandId: command.id, status: 'accepted', message: 'Simulación: comando aceptado sin apagar.' })
    });
  }
}

async function run() {
  await Promise.all(stations.map(tick));
  console.log(`Flota demo conectada a ${baseUrl}. Ctrl+C para detener.`);
}

await run();
setInterval(() => Promise.all(stations.map(tick)).catch(error => console.error(error.message)), 8000);
