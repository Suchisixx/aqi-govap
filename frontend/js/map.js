let map;
let stationsLayer;
let wardsLayer;
let heatLayer = null;
let gridLayer = null;

let allStations = [];
let wardGeoJSON = { type: 'FeatureCollection', features: [] };
let currentWardId = null;

const DEFAULT_CENTER = [10.827, 106.675];
const DEFAULT_ZOOM = 14;

function initMap() {
  map = L.map('map', {
    center: DEFAULT_CENTER,
    zoom: DEFAULT_ZOOM,
    zoomControl: true,
  });

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19,
  }).addTo(map);

  stationsLayer = L.layerGroup().addTo(map);
  wardsLayer = L.layerGroup().addTo(map);

  setupMapControls();
  loadWards();
  loadStations();
}

function normalizeGeoJSON(input) {
  if (!input) return { type: 'FeatureCollection', features: [] };
  if (Array.isArray(input)) return { type: 'FeatureCollection', features: input };
  if (!Array.isArray(input.features)) return { type: 'FeatureCollection', features: [] };
  return { type: 'FeatureCollection', features: input.features };
}

function wardStyle(feature, selectedId = null) {
  const p = feature.properties || {};
  const avg = p.avg_aqi ? Number(p.avg_aqi) : null;
  const isSelected = selectedId && Number(p.id) === Number(selectedId);

  return {
    color: isSelected ? '#67e8f9' : '#22d3ee',
    weight: isSelected ? 3 : 1.6,
    fillColor: avg != null ? aqiColor(avg) : '#3b82f6',
    fillOpacity: isSelected ? 0.28 : 0.12,
  };
}

async function loadWards() {
  try {
    wardGeoJSON = normalizeGeoJSON(await api.wards.geojson());
    renderWards();
    populateWardFilters();
  } catch (error) {
    console.error('loadWards error:', error);
    showToast(`Không tải được dữ liệu phường: ${error.message}`, 'error');
  }
}

function renderWards() {
  wardsLayer.clearLayers();
  const features = wardGeoJSON.features || [];
  if (!features.length) return;

  const layer = L.geoJSON(wardGeoJSON, {
    style: (feature) => wardStyle(feature, currentWardId),
    onEachFeature: (feature, leafletLayer) => {
      const p = feature.properties || {};
      const avg = p.avg_aqi != null ? Math.round(p.avg_aqi) : '–';
      leafletLayer.bindTooltip(`${p.name || 'Phường'}\nAQI TB: ${avg}`, {
        sticky: true,
        className: 'ward-tooltip',
      });

      leafletLayer.on('click', () => {
        const wid = p.id ? Number(p.id) : null;
        setWardSelection(wid);
      });
    },
  });

  layer.addTo(wardsLayer);

  if (!currentWardId) {
    const bounds = layer.getBounds();
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [20, 20] });
    }
  }
}

async function loadStations(wardId = null) {
  try {
    const geojson = await api.stations.geojson(wardId);
    const features = Array.isArray(geojson.features) ? geojson.features : [];
    allStations = features.map((f) => {
      const [lng, lat] = f.geometry.coordinates;
      return {
        ...f.properties,
        lat,
        lng,
      };
    });

    renderStations(features);
    populateStationSelect();
    updateStationFormBySelection();
    updateGlobalAQI();
  } catch (error) {
    console.error('loadStations error:', error);
    showToast(`Không tải được dữ liệu trạm: ${error.message}`, 'error');
  }
}

function renderStations(features) {
  stationsLayer.clearLayers();

  for (const feature of features) {
    const p = feature.properties || {};
    const [lng, lat] = feature.geometry.coordinates;
    const aqi = p.aqi || 0;
    const color = aqiColor(aqi);

    const marker = L.circleMarker([lat, lng], {
      radius: 8 + Math.min(aqi / 45, 8),
      fillColor: color,
      color: '#f8fafc',
      weight: 1.6,
      fillOpacity: 0.9,
    });

    marker.bindPopup(buildStationPopup(p, color));
    marker.addTo(stationsLayer);
  }
}

function buildStationPopup(station, color) {
  const readableTime = station.timestamp
    ? new Date(station.timestamp).toLocaleString('vi-VN')
    : '–';
  return `
    <div class="popup-station">
      <h3>${station.name || ''}</h3>
      <div class="pm">PM2.5: <span>${station.pm25 ?? '–'}</span> µg/m³</div>
      <div class="pm">PM10: <span>${station.pm10 ?? '–'}</span> µg/m³</div>
      <div style="margin-top:6px">
        <span class="aqi-chip" style="background:${color};color:${(station.aqi || 0) <= 100 ? '#000' : '#fff'}">
          ${station.aqi ?? 0} ${aqiLabel(station.aqi || 0)}
        </span>
      </div>
      <div class="ward">${station.ward_name || ''}</div>
      ${station.note ? `<div class="note">📝 ${station.note}</div>` : ''}
      <div class="note">${readableTime}</div>
    </div>
  `;
}

function populateWardFilters() {
  const selectIds = ['ward-filter', 'stations-ward-filter'];
  for (const id of selectIds) {
    const select = document.getElementById(id);
    if (!select) continue;

    const current = select.value || '';
    select.innerHTML = '<option value="">Tất cả phường</option>';
    for (const feature of wardGeoJSON.features) {
      const p = feature.properties || {};
      const opt = document.createElement('option');
      opt.value = String(p.id);
      opt.textContent = p.name;
      select.appendChild(opt);
    }
    select.value = currentWardId ? String(currentWardId) : current;
  }
}

function populateStationSelect() {
  const select = document.getElementById('station-select');
  if (!select) return;

  select.innerHTML = '<option value="">-- Chọn trạm --</option>';
  for (const station of allStations) {
    const opt = document.createElement('option');
    opt.value = String(station.id);
    opt.textContent = `${station.code} — ${station.name}`;
    select.appendChild(opt);
  }
}

function updateStationFormBySelection() {
  const stationId = Number(document.getElementById('station-select')?.value || 0);
  const station = allStations.find((s) => Number(s.id) === stationId);

  const pm25 = document.getElementById('form-pm25');
  const pm10 = document.getElementById('form-pm10');
  const traffic = document.getElementById('form-traffic');
  const factory = document.getElementById('form-factory');
  const construction = document.getElementById('form-construction');
  const note = document.getElementById('form-note');

  if (!station) {
    pm25.value = '';
    pm10.value = '';
    traffic.value = '3';
    factory.value = '2.0';
    construction.checked = false;
    note.value = '';
    return;
  }

  pm25.value = station.pm25 ?? '';
  pm10.value = station.pm10 ?? '';
  traffic.value = station.traffic_level ?? 3;
  factory.value = station.factory_near ?? 2.0;
  construction.checked = Boolean(station.construction);
  note.value = station.note ?? '';
}

function updateGlobalAQI() {
  const box = document.getElementById('global-aqi');
  const label = document.getElementById('global-label');

  if (!allStations.length) {
    box.textContent = '–';
    box.style.color = '#93a3c2';
    label.textContent = 'Không có dữ liệu';
    return;
  }

  const avg = Math.round(allStations.reduce((sum, s) => sum + (s.aqi || 0), 0) / allStations.length);
  box.textContent = String(avg);
  box.style.color = aqiColor(avg);
  label.textContent = aqiLabel(avg);
}

function clearInterpolationLayers(resetToggles = true) {
  if (heatLayer) {
    map.removeLayer(heatLayer);
    heatLayer = null;
  }
  if (gridLayer) {
    map.removeLayer(gridLayer);
    gridLayer = null;
  }
  if (resetToggles) {
    document.getElementById('layer-heatmap').checked = false;
    document.getElementById('layer-grid').checked = false;
  }
  const warning = document.getElementById('interp-warning');
  if (warning) warning.textContent = '';
}

function applyWardHighlightAndZoom() {
  wardsLayer.eachLayer((layer) => {
    if (!layer.feature) return;
    layer.setStyle(wardStyle(layer.feature, currentWardId));
    if (currentWardId && Number(layer.feature.properties?.id) === Number(currentWardId)) {
      const bounds = layer.getBounds();
      if (bounds.isValid()) map.fitBounds(bounds, { padding: [40, 40] });
    }
  });

  if (!currentWardId) {
    map.setView(DEFAULT_CENTER, DEFAULT_ZOOM);
  }
}

async function setWardSelection(wardId) {
  currentWardId = wardId ? Number(wardId) : null;

  const wardFilter = document.getElementById('ward-filter');
  const stationWardFilter = document.getElementById('stations-ward-filter');
  if (wardFilter) wardFilter.value = currentWardId ? String(currentWardId) : '';
  if (stationWardFilter) stationWardFilter.value = currentWardId ? String(currentWardId) : '';

  const kmzLink = document.getElementById('kmz-download');
  if (kmzLink && currentWardId) {
    kmzLink.href = `${API_BASE}/wards/${currentWardId}/kmz`;
    kmzLink.style.display = 'inline-flex';
    kmzLink.download = `ward_${currentWardId}.kmz`;
  } else if (kmzLink) {
    kmzLink.style.display = 'none';
  }

  await loadStations(currentWardId);
  applyWardHighlightAndZoom();
  clearInterpolationLayers(true);

  if (typeof loadStationsTable === 'function') {
    loadStationsTable(currentWardId);
  }
}

async function filterByWard(wardId) {
  await setWardSelection(wardId ? Number(wardId) : null);
}

function formatWarningMessage(warnings) {
  if (!Array.isArray(warnings) || !warnings.length) return '';
  const names = warnings.map((w) => `${w.ward_name} (${w.reason})`);
  return `Bỏ qua ${warnings.length} phường: ${names.join(', ')}`;
}

async function runInterpolation() {
  const button = document.getElementById('btn-interpolate');
  const warningEl = document.getElementById('interp-warning');
  const method = document.getElementById('interp-method').value;

  button.disabled = true;
  button.textContent = '⏳ Đang tính...';
  if (warningEl) warningEl.textContent = '';

  try {
    const payload = {
      ward_id: currentWardId,
      method,
      resolution: 60,
      clip_to_ward: true,
      per_ward: !currentWardId,
    };

    const result = await api.interpolate(payload);
    const showHeat = document.getElementById('layer-heatmap').checked;
    const showGrid = document.getElementById('layer-grid').checked;
    clearInterpolationLayers(false);

    if (showHeat && Array.isArray(result.heatmap_points) && result.heatmap_points.length) {
      heatLayer = L.heatLayer(result.heatmap_points, {
        radius: 24,
        blur: 20,
        maxZoom: 17,
        gradient: {
          0.0: '#00e400',
          0.2: '#ffff00',
          0.4: '#ff7e00',
          0.6: '#ff0000',
          0.8: '#8f3f97',
          1.0: '#7e0023',
        },
      }).addTo(map);
    }

    if (showGrid && result.geojson?.features?.length) {
      gridLayer = L.geoJSON(result.geojson, {
        style: (feature) => ({
          fillColor: aqiColor(feature.properties.aqi),
          fillOpacity: 0.32,
          color: '#0f172a',
          weight: 0.2,
        }),
        onEachFeature: (feature, layer) => {
          layer.bindTooltip(`AQI: ${feature.properties.aqi}`, { sticky: true });
        },
      }).addTo(map);
    }

    const warningText = formatWarningMessage(result.warnings);
    if (warningEl) warningEl.textContent = warningText;
    showToast(`Nội suy ${method.toUpperCase()} hoàn tất (${result.station_count || 0} trạm)`);
  } catch (error) {
    console.error('runInterpolation error:', error);
    showToast(`Lỗi nội suy: ${error.message}`, 'error');
  } finally {
    button.disabled = false;
    button.textContent = '▶ Chạy nội suy';
  }
}

function setupMapControls() {
  const stationToggle = document.getElementById('layer-stations');
  const wardToggle = document.getElementById('layer-wards');
  const heatToggle = document.getElementById('layer-heatmap');
  const gridToggle = document.getElementById('layer-grid');

  stationToggle.addEventListener('change', (event) => {
    if (event.target.checked) map.addLayer(stationsLayer);
    else map.removeLayer(stationsLayer);
  });

  wardToggle.addEventListener('change', (event) => {
    if (event.target.checked) map.addLayer(wardsLayer);
    else map.removeLayer(wardsLayer);
  });

  heatToggle.addEventListener('change', (event) => {
    if (!event.target.checked && heatLayer) {
      map.removeLayer(heatLayer);
      heatLayer = null;
    } else if (event.target.checked && !heatLayer) {
      runInterpolation();
    }
  });

  gridToggle.addEventListener('change', (event) => {
    if (!event.target.checked && gridLayer) {
      map.removeLayer(gridLayer);
      gridLayer = null;
    } else if (event.target.checked && !gridLayer) {
      runInterpolation();
    }
  });

  document.getElementById('ward-filter').addEventListener('change', (event) => {
    const value = event.target.value ? Number(event.target.value) : null;
    setWardSelection(value);
  });

  document.getElementById('btn-interpolate').addEventListener('click', runInterpolation);
  document.getElementById('station-select').addEventListener('change', updateStationFormBySelection);
}
