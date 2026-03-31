let currentView = 'map';

function switchView(viewName) {
  document.querySelectorAll('.nav-btn').forEach((button) => button.classList.remove('active'));
  document.querySelector(`[data-view="${viewName}"]`).classList.add('active');

  document.querySelectorAll('.view').forEach((view) => view.classList.remove('active'));
  document.getElementById(`view-${viewName}`).classList.add('active');

  document.getElementById('map-controls').style.display = viewName === 'map' ? 'flex' : 'none';
  currentView = viewName;

  if (viewName !== 'stations') closeStationDetail();

  if (viewName === 'dashboard') loadDashboard();
  if (viewName === 'stations') loadStationsTable();
  if (viewName === 'alerts') loadAlerts();
  if (viewName === 'map') setTimeout(() => map && map.invalidateSize(), 50);
}

document.getElementById('stations-ward-filter').addEventListener('change', filterStationsTable);
document.getElementById('stations-search').addEventListener('input', filterStationsTable);
document.getElementById('stations-hours-filter').addEventListener('change', () => {
  if (selectedStationId) loadStationDetail(selectedStationId);
});

document.querySelectorAll('.nav-btn').forEach((button) => {
  button.addEventListener('click', () => switchView(button.dataset.view));
});

document.getElementById('btn-dashboard-refresh').addEventListener('click', loadDashboard);
document.getElementById('btn-station-refresh').addEventListener('click', () => {
  if (selectedStationId) loadStationDetail(selectedStationId);
});
document.getElementById('btn-station-close').addEventListener('click', clearStationDetail);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && currentView === 'stations') clearStationDetail();
});

function refreshLiveViews() {
  if (currentView === 'dashboard') loadDashboard();
  if (currentView === 'alerts') loadAlerts();
  if (currentView === 'stations') loadStationsTable();
}

onWsEvent('station_updated', (station) => {
  showToast(`${station.name}: AQI ${station.aqi} (${aqiLabel(station.aqi)})`);
  upsertStationInState(station);
  upsertStationInTable(station);
  if (selectedStationId && Number(selectedStationId) === Number(station.id)) loadStationDetail(selectedStationId);
  refreshLiveViews();
});

onWsEvent('station_created', (station) => {
  showToast(`Trạm mới: ${station.name}`);
  upsertStationInState(station);
  upsertStationInTable(station);
  refreshLiveViews();
});

onWsEvent('station_deleted', ({ id }) => {
  removeStationFromState(id);
  removeStationFromTable(id);
  if (selectedStationId && Number(selectedStationId) === Number(id)) clearStationDetail();
  refreshLiveViews();
});

function startPolling() {
  setInterval(() => {
    if (currentView === 'map') loadStations();
    if (currentView === 'dashboard') loadDashboard();
  }, 30000);
}

async function init() {
  try {
    await api.get('/health');
  } catch (_) {
    showToast('Không thể kết nối API', 'error');
  }

  await api.auth.hydrate();
  renderAuthUi();
  initMap();
  setupReadingForm();
  setupImportControls();
  setupThresholdControls();
  clearStationDetail();
  connectWS();
  startPolling();
}

init();
