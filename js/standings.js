

const TRACKS_JSON_PATH = 'data/tracks.json';

document.addEventListener('DOMContentLoaded', () => {
  initStandings();
});

async function initStandings() {
  try {
    const res = await fetch('/api/standings');
    const data = await res.json();

    if (!res.ok) {
      showError(data.error || 'Ocurrió un error al cargar la tabla de tiempos.');
      return;
    }

    setMonthLabel(data.month, data.year);
    renderTrackMap(data.monthNumber);

    if (!data.record || !data.drivers || data.drivers.length === 0) {
      renderEventInfo(data.circuito, null);
      showError('No hay tiempos registrados todavía este mes.');
      return;
    }

    renderEventInfo(data.circuito, data.record);
    renderLeaderboard(data.drivers);
  } catch (err) {
    console.error('Error cargando la tabla de tiempos:', err);
    showError('Ocurrió un error al cargar la tabla de tiempos. Intenta de nuevo más tarde.');
  }
}

function setMonthLabel(monthName, year) {
  const el = document.getElementById('eventMonth');
  if (el) el.textContent = `${monthName.toUpperCase()} ${year}`;
}

function renderEventInfo(trackName, record) {
  const circuitoEl = document.getElementById('circuitoName');
  if (circuitoEl) circuitoEl.textContent = trackName || 'N/D';

  const recordEl = document.getElementById('recordTime');
  if (recordEl) recordEl.textContent = record ? record.time : '--:--.---';

  const pilotoEl = document.getElementById('recordPiloto');
  if (pilotoEl) pilotoEl.textContent = record ? record.piloto : '-';
}

async function renderTrackMap(monthNumber) {
  const trackImgEl = document.getElementById('trackMapImg');
  if (!trackImgEl || !monthNumber) return;

  try {
    const res = await fetch(TRACKS_JSON_PATH);
    if (!res.ok) throw new Error(`No se pudo cargar ${TRACKS_JSON_PATH}`);
    const tracksByMonth = await res.json();
    const trackUrl = tracksByMonth[String(monthNumber)];
    if (trackUrl) trackImgEl.src = trackUrl;
  } catch (err) {
    console.error('Error cargando el mapa del circuito:', err);
  }
}

function renderLeaderboard(drivers) {
  const leaderboardEl = document.getElementById('leaderboard');
  if (!leaderboardEl) return;

  leaderboardEl.innerHTML = '';

  drivers.forEach((driver) => {
    const row = document.createElement('div');
    row.className = 'standing-row' + (driver.position === 1 ? ' leader' : '');

    const positionSpan = document.createElement('span');
    positionSpan.className = 'position';
    positionSpan.textContent = String(driver.position);

    const driverSpan = document.createElement('span');
    driverSpan.className = 'driver';
    driverSpan.textContent = driver.name;

    const timeSpan = document.createElement('span');
    timeSpan.className = 'time';
    timeSpan.textContent = driver.time;

    const diffSpan = document.createElement('span');
    diffSpan.className = 'difference';
    diffSpan.textContent = driver.difference;

    row.append(positionSpan, driverSpan, timeSpan, diffSpan);
    leaderboardEl.appendChild(row);
  });
}

function showError(message) {
  const leaderboardEl = document.getElementById('leaderboard');
  if (leaderboardEl) {
    leaderboardEl.innerHTML = '';
    const p = document.createElement('p');
    p.className = 'standings-error';
    p.textContent = message;
    leaderboardEl.appendChild(p);
  }
}