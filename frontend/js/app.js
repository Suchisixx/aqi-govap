// ═══════════════════════════════════════════
// APP — Main orchestrator
// ═══════════════════════════════════════════

let currentView = 'map';

// ── Navigation ──
function switchView(viewName) {
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.querySelector(`[data-view="${viewName}"]`).classList.add('active');

  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(`view-${viewName}`).classList.add('active');

  // Map controls only visible in map view
  document.getElementById('map-controls').style.display = viewName === 'map' ? 'flex' : 'none';

  currentView = viewName;

  // Load view data
  if (viewName === 'dashboard') loadDashboard();
  if (viewName === 'stations')  loadStationsTable(currentWardId);
  if (viewName === 'alerts')    loadAlerts();
  if (viewName === 'map') {
    // Leaflet needs resize event when revealed
    setTimeout(() => map && map.invalidateSize(), 50);
  }
}

// ── Ward filter (shared) ──
document.getElementById('ward-filter').addEventListener('change', (e) => {
  const wardId = e.target.value || null;
  filterByWard(wardId);
  if (currentView === 'stations') loadStationsTable(wardId ? parseInt(wardId) : null);
});

document.getElementById('stations-ward-filter').addEventListener('change', (e) => {
  filterStationsTable();
});
document.getElementById('stations-search').addEventListener('input', filterStationsTable);

// ── Nav buttons ──
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => switchView(btn.dataset.view));
});

// ── WebSocket event handlers ──
onWsEvent('station_updated', (data) => {
  showToast(`📡 ${data.name}: AQI ${data.aqi} (${aqiLabel(data.aqi)})`);
  // Refresh current view
  if (currentView === 'map')       loadStations(currentWardId);
  if (currentView === 'dashboard') loadDashboard();
  if (currentView === 'stations')  loadStationsTable(currentWardId);
  if (currentView === 'alerts')    loadAlerts();
});

onWsEvent('station_created', (data) => {
  showToast(`➕ Trạm mới: ${data.name}`);
  loadStations(currentWardId);
});

// ── Polling fallback (5s) in case WS fails ──
let pollInterval;
function startPolling() {
  pollInterval = setInterval(() => {
    if (currentView === 'map')  loadStations(currentWardId);
  }, 30000); // every 30s for map
}

// ── Init ──
async function init() {
  // Check API health
  try {
    await api.get('/health');
  } catch (e) {
    showToast('⚠️ Không thể kết nối API', 'error');
  }

  // Setup modules
  initMap();
  setupReadingForm();

  // Connect WebSocket
  connectWS();

  // Start polling
  startPolling();

  // Hide map-controls from non-map views initially
  // (already visible by default)
}

init();
