let currentView = 'map';

function switchView(viewName) {
  document.querySelectorAll('.nav-btn').forEach((button) => button.classList.remove('active'));
  document.querySelector(`[data-view="${viewName}"]`).classList.add('active');

  document.querySelectorAll('.view').forEach((view) => view.classList.remove('active'));
  document.getElementById(`view-${viewName}`).classList.add('active');

  document.getElementById('map-controls').style.display = viewName === 'map' ? 'flex' : 'none';
  currentView = viewName;

  if (viewName === 'dashboard') loadDashboard();
  if (viewName === 'stations') loadStationsTable(currentWardId);
  if (viewName === 'alerts') loadAlerts();
  if (viewName === 'map') setTimeout(() => map && map.invalidateSize(), 50);
}

document.getElementById('stations-ward-filter').addEventListener('change', filterStationsTable);
document.getElementById('stations-search').addEventListener('input', filterStationsTable);

document.querySelectorAll('.nav-btn').forEach((button) => {
  button.addEventListener('click', () => switchView(button.dataset.view));
});

onWsEvent('station_updated', (station) => {
  showToast(`📡 ${station.name}: AQI ${station.aqi} (${aqiLabel(station.aqi)})`);
  if (currentView === 'map') loadStations(currentWardId);
  if (currentView === 'dashboard') loadDashboard();
  if (currentView === 'stations') loadStationsTable(currentWardId);
  if (currentView === 'alerts') loadAlerts();
});

onWsEvent('station_created', (station) => {
  showToast(`➕ Trạm mới: ${station.name}`);
  loadStations(currentWardId);
  if (currentView === 'stations') loadStationsTable(currentWardId);
});

onWsEvent('station_deleted', () => {
  loadStations(currentWardId);
  if (currentView === 'stations') loadStationsTable(currentWardId);
});

function startPolling() {
  setInterval(() => {
    if (currentView === 'map') loadStations(currentWardId);
  }, 30000);
}

async function init() {
  try {
    await api.get('/health');
  } catch (_) {
    showToast('Không thể kết nối API', 'error');
  }

  initMap();
  setupReadingForm();
  connectWS();
  startPolling();
}

init();
