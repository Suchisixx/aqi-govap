let map;
let stationsLayer;
let wardsLayer;
let heatLayer = null;
let gridLayer = null;
let mapHoverTooltip = null;
let activeInterpolationFeatures = [];

let allStations = [];
let wardGeoJSON = { type: 'FeatureCollection', features: [] };
let currentWardId = null;
let exportInProgress = false;

const interpolationCache = new Map();
const interpolationPending = new Map();

const DEFAULT_CENTER = [10.827, 106.675];
const DEFAULT_ZOOM = 14;
const INTERPOLATION_RESOLUTION = 60;
const HEAT_GRADIENT = {
  0.0: '#00e400',
  0.2: '#ffff00',
  0.4: '#ff7e00',
  0.6: '#ff0000',
  0.8: '#8f3f97',
  1.0: '#7e0023',
};
const AQI_LEGEND_ROWS = [
  ['#00e400', '0-50 Tốt'],
  ['#ffff00', '51-100 Trung bình'],
  ['#ff7e00', '101-150 Kém'],
  ['#ff0000', '151-200 Xấu'],
  ['#8f3f97', '201-300 Rất xấu'],
  ['#7e0023', '>300 Nguy hại'],
];

function resetInterpolationCache() {
  interpolationCache.clear();
  interpolationPending.clear();
}

function initMap() {
  map = L.map('map', { center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM, zoomControl: true });
  map.createPane('wardsPane');
  map.createPane('stationsPane');
  map.getPane('wardsPane').style.zIndex = '410';
  map.getPane('stationsPane').style.zIndex = '430';
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: 'OpenStreetMap contributors',
    maxZoom: 19,
    crossOrigin: 'anonymous',
  }).addTo(map);
  stationsLayer = L.layerGroup().addTo(map);
  wardsLayer = L.layerGroup().addTo(map);
  setupMapControls();
  setupExportControls();
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
  const props = feature.properties || {};
  const avg = props.avg_aqi != null ? Number(props.avg_aqi) : null;
  const isSelected = selectedId && Number(props.id) === Number(selectedId);
  return {
    color: isSelected ? '#f8fafc' : '#dbeafe',
    weight: isSelected ? 4 : 2.6,
    opacity: isSelected ? 1 : 0.95,
    fillColor: avg != null ? aqiColor(avg) : '#3b82f6',
    fillOpacity: isSelected ? 0.28 : 0.16,
    dashArray: isSelected ? null : '8 5',
  };
}

function getVisibleWardGeoJSON() {
  const features = currentWardId
    ? wardGeoJSON.features.filter((feature) => Number(feature.properties?.id) === Number(currentWardId))
    : wardGeoJSON.features;
  return { type: 'FeatureCollection', features };
}

function getVisibleStations() {
  return currentWardId ? allStations.filter((station) => Number(station.ward_id) === Number(currentWardId)) : [...allStations];
}

function getStationsByWardId(wardId) {
  return allStations.filter((station) => Number(station.ward_id) === Number(wardId));
}

function recalculateWardMetrics() {
  for (const feature of wardGeoJSON.features || []) {
    const wardId = Number(feature.properties?.id);
    const values = allStations
      .filter((station) => Number(station.ward_id) === wardId)
      .map((station) => Number(station.aqi))
      .filter((value) => Number.isFinite(value));
    feature.properties = {
      ...(feature.properties || {}),
      station_count: values.length,
      avg_aqi: values.length ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1)) : null,
      max_aqi: values.length ? Math.max(...values) : null,
    };
  }
}

async function loadWards() {
  try {
    wardGeoJSON = normalizeGeoJSON(await api.wards.geojson());
    recalculateWardMetrics();
    renderWards();
    populateWardFilters();
  } catch (error) {
    console.error('loadWards error:', error);
    showToast(`Không tải được dữ liệu phường: ${error.message}`, 'error');
  }
}

function renderWards() {
  wardsLayer.clearLayers();
  const visibleWardGeoJSON = getVisibleWardGeoJSON();
  if (!visibleWardGeoJSON.features?.length) return;
  const layer = L.geoJSON(visibleWardGeoJSON, {
    pane: 'wardsPane',
    interactive: true,
    style: (feature) => wardStyle(feature, currentWardId),
    onEachFeature: (feature, leafletLayer) => {
      leafletLayer.on('mousemove', (event) => {
        showMapHoverTooltip(event.latlng, buildWardHoverTooltipContent(feature));
      });
      leafletLayer.on('mouseover', () => {
        leafletLayer.setStyle({ fillOpacity: currentWardId ? 0.34 : 0.24, weight: currentWardId ? 4.4 : 3.2 });
      });
      leafletLayer.on('mouseout', () => {
        leafletLayer.setStyle(wardStyle(feature, currentWardId));
        hideMapHoverTooltip();
      });
    },
  });
  layer.addTo(wardsLayer);
  if (!currentWardId) {
    const bounds = layer.getBounds();
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [20, 20] });
  }
}

async function loadStations() {
  try {
    const geojson = await api.stations.geojson();
    allStations = (Array.isArray(geojson.features) ? geojson.features : []).map((feature) => {
      const [lng, lat] = feature.geometry.coordinates;
      return { ...feature.properties, lat, lng };
    });
    resetInterpolationCache();
    recalculateWardMetrics();
    renderWards();
    renderStations();
    populateStationSelect();
    updateStationFormBySelection();
    updateGlobalAQI();
  } catch (error) {
    console.error('loadStations error:', error);
    showToast(`Không tải được dữ liệu trạm: ${error.message}`, 'error');
  }
}

function renderStations(stations = getVisibleStations()) {
  stationsLayer.clearLayers();
  for (const station of stations) {
    const aqi = station.aqi || 0;
    const color = aqiColor(aqi);
    const marker = L.circleMarker([station.lat, station.lng], {
      pane: 'stationsPane',
      radius: 8 + Math.min(aqi / 45, 8),
      fillColor: color,
      color: '#f8fafc',
      weight: 1.6,
      fillOpacity: 0.9,
    });
    marker.bindPopup(buildStationPopup(station, color));
    marker.addTo(stationsLayer);
  }
}

function buildStationPopup(station, color) {
  const readableTime = station.timestamp ? new Date(station.timestamp).toLocaleString('vi-VN') : '-';
  return `
    <div class="popup-station">
      <h3>${station.name || ''}</h3>
      <div class="pm">PM2.5: <span>${station.pm25 ?? '-'}</span> ug/m3</div>
      <div class="pm">PM10: <span>${station.pm10 ?? '-'}</span> ug/m3</div>
      <div style="margin-top:6px">
        <span class="aqi-chip" style="background:${color};color:${(station.aqi || 0) <= 100 ? '#000' : '#fff'}">${station.aqi ?? 0} ${aqiLabel(station.aqi || 0)}</span>
      </div>
      <div class="note">AQI PM2.5: ${station.aqi_pm25 ?? '-'} | AQI PM10: ${station.aqi_pm10 ?? '-'}</div>
      <div class="note">Thông số chi phối: ${pollutantLabel(station.primary_pollutant)}</div>
      <div class="ward">${station.ward_name || ''}</div>
      ${station.note ? `<div class="note">Ghi chú: ${station.note}</div>` : ''}
      <div class="note">${readableTime}</div>
    </div>
  `;
}

function populateWardFilters() {
  for (const id of ['ward-filter', 'stations-ward-filter', 'dashboard-ward-filter']) {
    const select = document.getElementById(id);
    if (!select) continue;
    const current = select.value || '';
    const defaultLabel = 'Tất cả phường';
    select.innerHTML = `<option value="">${defaultLabel}</option>`;
    for (const feature of wardGeoJSON.features) {
      const option = document.createElement('option');
      option.value = String(feature.properties?.id);
      option.textContent = feature.properties?.name;
      select.appendChild(option);
    }
    select.value = currentWardId ? String(currentWardId) : current;
  }
}

function populateStationSelect() {
  const select = document.getElementById('station-select');
  if (!select) return;
  const current = select.value;
  const visibleStations = getVisibleStations();
  select.innerHTML = '<option value="">-- Chọn trạm --</option>';
  for (const station of visibleStations) {
    const option = document.createElement('option');
    option.value = String(station.id);
    option.textContent = `${station.code} - ${station.name}`;
    select.appendChild(option);
  }
  if (current && visibleStations.some((station) => String(station.id) === current)) select.value = current;
}

function updateStationFormBySelection() {
  const stationId = Number(document.getElementById('station-select')?.value || 0);
  const station = allStations.find((item) => Number(item.id) === stationId);
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
    box.textContent = '-';
    box.style.color = '#93a3c2';
    label.textContent = 'Không có dữ liệu';
    return;
  }
  const avg = Math.round(allStations.reduce((sum, station) => sum + (station.aqi || 0), 0) / allStations.length);
  box.textContent = String(avg);
  box.style.color = aqiColor(avg);
  label.textContent = aqiLabel(avg);
}

function clearInterpolationLayers(resetToggles = true) {
  if (heatLayer) { map.removeLayer(heatLayer); heatLayer = null; }
  if (gridLayer) { map.removeLayer(gridLayer); gridLayer = null; }
  activeInterpolationFeatures = [];
  hideMapHoverTooltip();
  syncInterpolationCursor();
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
  if (!currentWardId) map.setView(DEFAULT_CENTER, DEFAULT_ZOOM);
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
  renderWards();
  renderStations();
  populateStationSelect();
  updateStationFormBySelection();
  updateGlobalAQI();
  resetInterpolationCache();
  applyWardHighlightAndZoom();
  clearInterpolationLayers(true);
  if (typeof refreshStationsTableView === 'function') refreshStationsTableView();
}

async function filterByWard(wardId) {
  await setWardSelection(wardId ? Number(wardId) : null);
}

function formatWarningMessage(warnings) {
  if (!Array.isArray(warnings) || !warnings.length) return '';
  return `Bỏ qua ${warnings.length} phường: ${warnings.map((warning) => `${warning.ward_name} (${warning.reason})`).join(', ')}`;
}

function getInterpolationMethod() {
  return document.getElementById('interp-method')?.value || 'idw';
}

function buildInterpolationPayload(method = getInterpolationMethod()) {
  return { ward_id: currentWardId, method, resolution: INTERPOLATION_RESOLUTION, clip_to_ward: true, per_ward: !currentWardId };
}

function getInterpolationCacheKey(payload) {
  return JSON.stringify([payload.ward_id || null, payload.method, payload.resolution, payload.clip_to_ward, payload.per_ward]);
}

async function fetchInterpolationResult(method = getInterpolationMethod()) {
  const payload = buildInterpolationPayload(method);
  const key = getInterpolationCacheKey(payload);
  if (interpolationCache.has(key)) return interpolationCache.get(key);
  if (interpolationPending.has(key)) return interpolationPending.get(key);
  const promise = api.interpolate(payload).then((result) => {
    interpolationCache.set(key, result);
    interpolationPending.delete(key);
    return result;
  }).catch((error) => {
    interpolationPending.delete(key);
    throw error;
  });
  interpolationPending.set(key, promise);
  return promise;
}

function createHeatLayer(targetMap, result) {
  if (!Array.isArray(result?.heatmap_points) || !result.heatmap_points.length) return null;
  return L.heatLayer(result.heatmap_points, { radius: 24, blur: 20, maxZoom: 17, gradient: HEAT_GRADIENT }).addTo(targetMap);
}

function createGridLayer(targetMap, result) {
  if (!result?.geojson?.features?.length) return null;
  return L.geoJSON(result.geojson, {
    interactive: true,
    style: (feature) => ({ fillColor: aqiColor(feature.properties.aqi), fillOpacity: 0.32, color: '#0f172a', weight: 0.2 }),
    onEachFeature: (feature, layer) => {
      layer.on('mousemove', (event) => {
        const wardFeature = findWardFeatureAtLatLng(event.latlng);
        const content = wardFeature
          ? buildWardHoverTooltipContent(wardFeature, feature)
          : `<div class="map-hover-card">${buildInterpolationTooltipContent(feature)}</div>`;
        showMapHoverTooltip(event.latlng, content);
      });
      layer.on('mouseover', () => {
        layer.setStyle({ fillOpacity: 0.52, weight: 0.7 });
      });
      layer.on('mouseout', () => {
        layer.setStyle({ fillOpacity: 0.32, weight: 0.2 });
        hideMapHoverTooltip();
      });
    },
  }).addTo(targetMap);
}

function buildInterpolationTooltipContent(feature) {
  const props = feature?.properties || {};
  return `
    <div><strong>AQI nội suy:</strong> ${props.aqi ?? '-'}</div>
    <div>Vị trí: ${formatNumber(props.lat, 4)}, ${formatNumber(props.lng, 4)}</div>
  `;
}

function buildWardStationDetails(stations) {
  if (!stations.length) return 'Không có trạm';
  return stations.map((station) => {
    const stationName = escapeHtml(station.name || station.code || `Trạm ${station.id || ''}`.trim());
    return `${stationName} (AQI ${formatNumber(station.aqi, 0)})`;
  }).join(', ');
}

function getLatestTimestamp(stations) {
  const timestamps = stations
    .map((station) => station.timestamp)
    .filter(Boolean)
    .map((value) => new Date(value))
    .filter((value) => !Number.isNaN(value.getTime()))
    .sort((left, right) => right.getTime() - left.getTime());
  return timestamps[0] || null;
}

function buildWardHoverTooltipContent(wardFeature, interpolationFeature = null) {
  const props = wardFeature?.properties || {};
  const wardStations = getStationsByWardId(props.id);
  const pm25Values = wardStations.map((station) => Number(station.pm25)).filter((value) => Number.isFinite(value));
  const pm10Values = wardStations.map((station) => Number(station.pm10)).filter((value) => Number.isFinite(value));
  const latestTimestamp = getLatestTimestamp(wardStations);
  const averagePm25 = pm25Values.length ? pm25Values.reduce((sum, value) => sum + value, 0) / pm25Values.length : null;
  const averagePm10 = pm10Values.length ? pm10Values.reduce((sum, value) => sum + value, 0) / pm10Values.length : null;

  return `
    <div class="map-hover-card">
      <div class="map-hover-title">${escapeHtml(props.name || 'Phường')}</div>
      <div><strong>AQI:</strong> ${formatNumber(props.avg_aqi)} ${props.avg_aqi != null ? `(${aqiLabel(props.avg_aqi)})` : ''}</div>
      <div><strong>Dữ liệu trạm:</strong> ${buildWardStationDetails(wardStations)}</div>
      <div><strong>Tổng hợp trạm:</strong> ${wardStations.length} trạm | PM2.5 TB ${formatNumber(averagePm25)} | PM10 TB ${formatNumber(averagePm10)}</div>
      <div><strong>Cập nhật:</strong> ${latestTimestamp ? latestTimestamp.toLocaleString('vi-VN') : '-'}</div>
      ${interpolationFeature ? buildInterpolationTooltipContent(interpolationFeature) : ''}
    </div>
  `;
}

function findInterpolationFeatureAtLatLng(latlng) {
  if (!latlng || !activeInterpolationFeatures.length) return null;
  return activeInterpolationFeatures.find((feature) => featureContainsLatLng(feature, latlng)) || null;
}

function pointInLinearRing(latlng, ring) {
  let inside = false;
  const x = latlng.lng;
  const y = latlng.lat;

  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersects = ((yi > y) !== (yj > y))
      && (x < ((xj - xi) * (y - yi)) / ((yj - yi) || Number.EPSILON) + xi);
    if (intersects) inside = !inside;
  }

  return inside;
}

function pointInPolygonCoordinates(latlng, polygonCoordinates) {
  if (!polygonCoordinates?.length) return false;
  if (!pointInLinearRing(latlng, polygonCoordinates[0])) return false;
  for (let index = 1; index < polygonCoordinates.length; index += 1) {
    if (pointInLinearRing(latlng, polygonCoordinates[index])) return false;
  }
  return true;
}

function featureContainsLatLng(feature, latlng) {
  const geometry = feature?.geometry;
  if (!geometry || !latlng) return false;
  if (geometry.type === 'Polygon') {
    return pointInPolygonCoordinates(latlng, geometry.coordinates);
  }
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.some((polygonCoordinates) => pointInPolygonCoordinates(latlng, polygonCoordinates));
  }
  return false;
}

function findWardFeatureAtLatLng(latlng) {
  const visibleWardGeoJSON = getVisibleWardGeoJSON();
  return visibleWardGeoJSON.features.find((feature) => featureContainsLatLng(feature, latlng)) || null;
}

function hideMapHoverTooltip() {
  if (!mapHoverTooltip || !map) return;
  map.removeLayer(mapHoverTooltip);
  mapHoverTooltip = null;
}

function showMapHoverTooltip(latlng, content) {
  if (!map || !content) return;
  if (!mapHoverTooltip) {
    mapHoverTooltip = L.tooltip({
      permanent: false,
      sticky: false,
      direction: 'top',
      offset: [0, -10],
      className: 'map-hover-tooltip',
    });
  }
  mapHoverTooltip
    .setLatLng(latlng)
    .setContent(content);

  if (!map.hasLayer(mapHoverTooltip)) {
    mapHoverTooltip.addTo(map);
  }
}

function syncInterpolationCursor() {
  if (!map) return;
  const hasVisibleInterpolation = Boolean(heatLayer || gridLayer);
  map.getContainer().style.cursor = hasVisibleInterpolation ? 'pointer' : '';
}

function handleMapHover(event) {
  const wardFeature = findWardFeatureAtLatLng(event.latlng);
  const hasVisibleInterpolation = Boolean(heatLayer || gridLayer);
  const interpolationFeature = hasVisibleInterpolation ? findInterpolationFeatureAtLatLng(event.latlng) : null;

  if (!wardFeature && !interpolationFeature) {
    hideMapHoverTooltip();
    return;
  }

  const content = wardFeature
    ? buildWardHoverTooltipContent(wardFeature, interpolationFeature)
    : `<div class="map-hover-card">${buildInterpolationTooltipContent(interpolationFeature)}</div>`;

  showMapHoverTooltip(event.latlng, content);
}

function renderInterpolationWarning(warnings) {
  const warningEl = document.getElementById('interp-warning');
  if (warningEl) warningEl.textContent = formatWarningMessage(warnings);
}

async function renderInterpolationLayersOnMainMap(showHeat, showGrid) {
  const result = await fetchInterpolationResult();
  clearInterpolationLayers(false);
  activeInterpolationFeatures = result?.geojson?.features || [];
  if (showHeat) heatLayer = createHeatLayer(map, result);
  if (showGrid) gridLayer = createGridLayer(map, result);
  syncInterpolationCursor();
  renderInterpolationWarning(result.warnings);
  return result;
}

async function runInterpolation() {
  const button = document.getElementById('btn-interpolate');
  button.disabled = true;
  button.textContent = 'Đang tính...';
  renderInterpolationWarning([]);
  try {
    const result = await renderInterpolationLayersOnMainMap(
      document.getElementById('layer-heatmap').checked,
      document.getElementById('layer-grid').checked,
    );
    showToast(`Nội suy ${getInterpolationMethod().toUpperCase()} hoàn tất (${result.station_count || 0} trạm)`);
  } catch (error) {
    console.error('runInterpolation error:', error);
    showToast(`Lỗi nội suy: ${error.message}`, 'error');
  } finally {
    button.disabled = false;
    button.textContent = 'Chạy nội suy';
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

  heatToggle.addEventListener('change', async (event) => {
    if (!event.target.checked && heatLayer) {
      map.removeLayer(heatLayer);
      heatLayer = null;
      syncInterpolationCursor();
      return;
    }
    if (event.target.checked && !heatLayer) {
      try {
        await renderInterpolationLayersOnMainMap(true, document.getElementById('layer-grid').checked);
      } catch (error) {
        console.error('heat toggle error:', error);
        showToast(`Lỗi nội suy: ${error.message}`, 'error');
        event.target.checked = false;
      }
    }
  });

  gridToggle.addEventListener('change', async (event) => {
    if (!event.target.checked && gridLayer) {
      map.removeLayer(gridLayer);
      gridLayer = null;
      syncInterpolationCursor();
      return;
    }
    if (event.target.checked && !gridLayer) {
      try {
        await renderInterpolationLayersOnMainMap(document.getElementById('layer-heatmap').checked, true);
      } catch (error) {
        console.error('grid toggle error:', error);
        showToast(`Lỗi nội suy: ${error.message}`, 'error');
        event.target.checked = false;
      }
    }
  });

  document.getElementById('ward-filter').addEventListener('change', (event) => {
    setWardSelection(event.target.value ? Number(event.target.value) : null);
  });
  document.getElementById('btn-interpolate').addEventListener('click', runInterpolation);
  document.getElementById('station-select').addEventListener('change', updateStationFormBySelection);
  map.on('mousemove', handleMapHover);
  map.on('mouseout', hideMapHoverTooltip);
}

function upsertStationInState(station) {
  const normalizedStation = { ...station, lat: Number(station.lat), lng: Number(station.lng) };
  const index = allStations.findIndex((item) => Number(item.id) === Number(normalizedStation.id));
  if (index >= 0) allStations[index] = { ...allStations[index], ...normalizedStation };
  else allStations.push(normalizedStation);
  resetInterpolationCache();
  recalculateWardMetrics();
  renderWards();
  renderStations();
  populateStationSelect();
  updateStationFormBySelection();
  updateGlobalAQI();
}

function removeStationFromState(stationId) {
  allStations = allStations.filter((station) => Number(station.id) !== Number(stationId));
  resetInterpolationCache();
  recalculateWardMetrics();
  renderWards();
  renderStations();
  populateStationSelect();
  updateStationFormBySelection();
  updateGlobalAQI();
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getCurrentWardName() {
  if (!currentWardId) return 'Khung bản đồ hiện tại';
  const feature = wardGeoJSON.features.find((item) => Number(item.properties?.id) === Number(currentWardId));
  return feature?.properties?.name || `Phường ${currentWardId}`;
}

function setExportBusy(isBusy, text = 'Xuất báo cáo PDF') {
  const button = document.getElementById('btn-export');
  if (button) {
    button.disabled = isBusy;
    button.textContent = text;
    button.setAttribute('aria-busy', isBusy ? 'true' : 'false');
  }
}

function setupExportControls() {
  const exportButton = document.getElementById('btn-export');
  if (!exportButton) return;
  exportButton.addEventListener('click', () => {
    exportReportPdf();
  });
}

function formatExportFilename(now) {
  const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  const time = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
  return `bao-cao-aqi-govap-${date}-${time}.pdf`;
}

async function renderShellToPdf(shell, filename) {
  if (!window.html2canvas) throw new Error('Thiếu html2canvas');
  if (!window.jspdf?.jsPDF) throw new Error('Thiếu jsPDF');
  const canvas = await window.html2canvas(shell, { useCORS: true, allowTaint: false, backgroundColor: '#ffffff', scale: 2 });
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const imageData = canvas.toDataURL('image/png');
  const imageHeight = (canvas.height * pageWidth) / canvas.width;
  let renderedHeight = 0;

  pdf.addImage(imageData, 'PNG', 0, 0, pageWidth, imageHeight, undefined, 'FAST');
  renderedHeight += pageHeight;

  while (renderedHeight < imageHeight) {
    pdf.addPage();
    pdf.addImage(imageData, 'PNG', 0, -renderedHeight, pageWidth, imageHeight, undefined, 'FAST');
    renderedHeight += pageHeight;
  }

  pdf.save(filename);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatNumber(value, digits = 1) {
  if (value == null || Number.isNaN(Number(value))) return '-';
  return Number(value).toLocaleString('vi-VN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
}

function formatDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('vi-VN');
}

function buildSummaryFromStations(stations) {
  const aqiValues = stations.map((station) => Number(station.aqi)).filter((value) => Number.isFinite(value));
  return {
    total_stations: stations.length,
    avg_aqi: aqiValues.length ? Number((aqiValues.reduce((sum, value) => sum + value, 0) / aqiValues.length).toFixed(1)) : null,
    max_aqi: aqiValues.length ? Math.max(...aqiValues) : null,
    min_aqi: aqiValues.length ? Math.min(...aqiValues) : null,
    good: aqiValues.filter((value) => value <= 50).length,
    moderate: aqiValues.filter((value) => value > 50 && value <= 100).length,
    unhealthy_sensitive: aqiValues.filter((value) => value > 100 && value <= 150).length,
    unhealthy: aqiValues.filter((value) => value > 150 && value <= 200).length,
    very_unhealthy: aqiValues.filter((value) => value > 200).length,
  };
}

function buildWardReportRows(stations, wardRanking) {
  if (!currentWardId) return Array.isArray(wardRanking) ? wardRanking : [];
  const summary = buildSummaryFromStations(stations);
  return [{
    id: currentWardId,
    name: getCurrentWardName(),
    avg_aqi: summary.avg_aqi,
    max_aqi: summary.max_aqi,
    station_count: stations.length,
    aqi_label: summary.avg_aqi != null ? aqiLabel(summary.avg_aqi) : '-',
  }];
}

function summarizeInterpolationResult(result, errorMessage) {
  if (errorMessage) {
    return {
      ok: false,
      message: errorMessage,
      method: getInterpolationMethod().toUpperCase(),
      scope: currentWardId ? getCurrentWardName() : 'Toàn bộ Gò Vấp',
      station_count: 0,
      processed_ward_count: 0,
      skipped_ward_count: 0,
      grid_cell_count: 0,
      min_aqi: null,
      max_aqi: null,
      avg_aqi: null,
      bbox: null,
      warnings: [],
    };
  }

  const features = result?.geojson?.features || [];
  const values = features
    .map((feature) => Number(feature?.properties?.aqi))
    .filter((value) => Number.isFinite(value));
  const warnings = Array.isArray(result?.warnings) ? result.warnings : [];

  return {
    ok: true,
    message: '',
    method: String(result?.method || getInterpolationMethod()).toUpperCase(),
    scope: currentWardId ? (result?.ward_name || getCurrentWardName()) : 'Toàn bộ Gò Vấp',
    station_count: Number(result?.station_count || 0),
    processed_ward_count: Array.isArray(result?.wards) ? result.wards.length : (result?.mode === 'single_ward' ? 1 : 0),
    skipped_ward_count: warnings.length,
    grid_cell_count: values.length,
    min_aqi: values.length ? Math.min(...values) : null,
    max_aqi: values.length ? Math.max(...values) : null,
    avg_aqi: values.length ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1)) : null,
    bbox: result?.bbox || null,
    warnings,
  };
}

function buildReportInsights(summary, stations, interpolationSummary) {
  const insights = [];
  const worstStation = [...stations]
    .filter((station) => Number.isFinite(Number(station.aqi)))
    .sort((left, right) => Number(right.aqi || 0) - Number(left.aqi || 0))[0];

  if ((summary.avg_aqi || 0) > 150) {
    insights.push(`Chất lượng không khí trung bình đang ở mức ${aqiLabel(summary.avg_aqi)}, cần ưu tiên cảnh báo sức khỏe cộng đồng.`);
  } else if ((summary.avg_aqi || 0) > 100) {
    insights.push(`AQI trung bình đang ở mức ${aqiLabel(summary.avg_aqi)}, nhóm nhạy cảm cần được khuyến cáo hạn chế hoạt động ngoài trời.`);
  } else if (summary.total_stations) {
    insights.push(`Phần lớn trạm đang nằm trong ngưỡng ${aqiLabel(summary.avg_aqi || 0).toLowerCase()}, nhưng vẫn cần theo dõi các điểm có xu hướng tăng AQI.`);
  }

  if (worstStation) {
    insights.push(`Trạm có AQI cao nhất hiện tại là ${worstStation.name} (${worstStation.ward_name || '-'}) với AQI ${worstStation.aqi ?? '-'}.`);
  }

  if (interpolationSummary.ok) {
    insights.push(`Nội suy ${interpolationSummary.method} sử dụng ${interpolationSummary.station_count} trạm, cho AQI ước tính trung bình ${formatNumber(interpolationSummary.avg_aqi)} và cực đại ${formatNumber(interpolationSummary.max_aqi)}.`);
    if (interpolationSummary.skipped_ward_count > 0) {
      insights.push(`Có ${interpolationSummary.skipped_ward_count} phường không đủ điều kiện nội suy do thiếu trạm có dữ liệu AQI.`);
    }
  } else {
    insights.push(`Phần nội suy chưa đủ điều kiện để tính toán: ${interpolationSummary.message}.`);
  }

  return insights.slice(0, 4);
}

function renderMetricCards(summary) {
  const cards = [
    ['AQI trung bình', formatNumber(summary.avg_aqi), summary.avg_aqi != null ? aqiLabel(summary.avg_aqi) : 'Chưa có dữ liệu'],
    ['AQI cao nhất', formatNumber(summary.max_aqi, 0), summary.max_aqi != null ? aqiLabel(summary.max_aqi) : 'Chưa có dữ liệu'],
    ['AQI thấp nhất', formatNumber(summary.min_aqi, 0), summary.min_aqi != null ? aqiLabel(summary.min_aqi) : 'Chưa có dữ liệu'],
    ['Tổng trạm', formatNumber(summary.total_stations, 0), 'Đang được tổng hợp'],
    ['Vượt ngưỡng >100', formatNumber((summary.unhealthy_sensitive || 0) + (summary.unhealthy || 0) + (summary.very_unhealthy || 0), 0), 'Cần theo dõi'],
  ];

  return cards.map(([label, value, note]) => `
    <div class="report-metric-card">
      <div class="report-metric-label">${label}</div>
      <div class="report-metric-value">${value}</div>
      <div class="report-metric-note">${note}</div>
    </div>
  `).join('');
}

function renderStationsRows(stations) {
  if (!stations.length) {
    return '<tr><td colspan="10" class="report-empty">Không có dữ liệu trạm đo trong phạm vi báo cáo.</td></tr>';
  }
  return stations.map((station, index) => `
    <tr>
      <td>${index + 1}</td>
      <td><strong>${escapeHtml(station.code || '-')}</strong></td>
      <td>${escapeHtml(station.name || '-')}</td>
      <td>${escapeHtml(station.ward_name || '-')}</td>
      <td>${formatNumber(station.pm25)}</td>
      <td>${formatNumber(station.pm10)}</td>
      <td><span class="report-aqi-pill" style="background:${aqiColor(station.aqi || 0)};color:${(station.aqi || 0) <= 100 ? '#111827' : '#fff'}">${station.aqi ?? '-'} ${aqiLabel(station.aqi || 0)}</span></td>
      <td>${escapeHtml(pollutantLabel(station.primary_pollutant) || '-')}</td>
      <td>${formatDateTime(station.timestamp)}</td>
      <td>${escapeHtml(station.note || '-')}</td>
    </tr>
  `).join('');
}

function renderWardRows(wards) {
  if (!wards.length) {
    return '<tr><td colspan="6" class="report-empty">Không có dữ liệu tổng hợp theo phường.</td></tr>';
  }
  return wards.map((ward, index) => `
    <tr>
      <td>${index + 1}</td>
      <td>${escapeHtml(ward.name || '-')}</td>
      <td>${formatNumber(ward.avg_aqi)}</td>
      <td>${formatNumber(ward.max_aqi, 0)}</td>
      <td>${formatNumber(ward.station_count, 0)}</td>
      <td>${escapeHtml(ward.aqi_label || aqiLabel(ward.avg_aqi || 0))}</td>
    </tr>
  `).join('');
}

function renderAlertRows(alerts) {
  if (!alerts.length) {
    return '<tr><td colspan="7" class="report-empty">Không có trạm nào vượt ngưỡng AQI > 100 trong phạm vi báo cáo.</td></tr>';
  }
  return alerts.map((station, index) => `
    <tr>
      <td>${index + 1}</td>
      <td>${escapeHtml(station.name || '-')}</td>
      <td>${escapeHtml(station.ward_name || '-')}</td>
      <td>${formatNumber(station.pm25)}</td>
      <td>${formatNumber(station.pm10)}</td>
      <td>${station.aqi ?? '-'}</td>
      <td>${escapeHtml(station.message || aqiLabel(station.aqi || 0))}</td>
    </tr>
  `).join('');
}

function renderRankingRows(stations) {
  if (!stations.length) {
    return '<tr><td colspan="7" class="report-empty">Không có dữ liệu xếp hạng trạm.</td></tr>';
  }
  return stations.map((station, index) => `
    <tr>
      <td>${index + 1}</td>
      <td>${escapeHtml(station.name || '-')}</td>
      <td>${escapeHtml(station.ward_name || '-')}</td>
      <td>${formatNumber(station.pm25)}</td>
      <td>${formatNumber(station.pm10)}</td>
      <td>${station.aqi ?? '-'}</td>
      <td>${escapeHtml(aqiLabel(station.aqi || 0))}</td>
    </tr>
  `).join('');
}

function collectBBoxLines(bbox) {
  if (!bbox) return ['Không có thông tin khung nội suy'];
  return [
    `Lat: ${formatNumber(bbox.lat_min, 4)} den ${formatNumber(bbox.lat_max, 4)}`,
    `Lng: ${formatNumber(bbox.lng_min, 4)} den ${formatNumber(bbox.lng_max, 4)}`,
  ];
}

async function collectReportData() {
  const stationPromise = api.stations.list(currentWardId || undefined);
  const summaryPromise = api.dashboard.summary();
  const wardPromise = api.dashboard.wardRanking();
  const rankingPromise = api.dashboard.stationRanking(5);
  const alertsPromise = api.dashboard.alerts();

  const [stations, summaryApi, wardRanking, stationRanking, alertsApi] = await Promise.all([
    stationPromise,
    summaryPromise,
    wardPromise,
    rankingPromise,
    alertsPromise,
  ]);

  let interpolationResult = null;
  let interpolationError = '';
  try {
    interpolationResult = await fetchInterpolationResult();
  } catch (error) {
    interpolationError = error.message;
  }

  const scopedSummary = buildSummaryFromStations(stations);
  const scopedAlerts = currentWardId
    ? stations.filter((station) => Number(station.aqi || 0) > 100).map((station) => ({
      ...station,
      message: station.aqi > 200
        ? 'Nguy hiểm - hạn chế ra ngoài'
        : station.aqi > 150
          ? 'Xấu - cần giảm tiếp xúc'
          : 'Kém - nhóm nhạy cảm cần chú ý',
    }))
    : alertsApi;
  const scopedRanking = currentWardId
    ? [...stations].sort((left, right) => Number(right.aqi || 0) - Number(left.aqi || 0)).slice(0, 5)
    : stationRanking;

  return {
    now: new Date(),
    stations,
    summary: currentWardId ? scopedSummary : { ...summaryApi, ...scopedSummary },
    wards: buildWardReportRows(stations, wardRanking),
    alerts: scopedAlerts,
    ranking: scopedRanking,
    interpolation: summarizeInterpolationResult(interpolationResult, interpolationError),
  };
}

function createReportShell(report) {
  const shell = document.createElement('div');
  shell.className = 'report-export-shell';

  const interpolation = report.interpolation;
  const insights = buildReportInsights(report.summary, report.stations, interpolation);
  const warningRows = interpolation.warnings?.length
    ? interpolation.warnings.map((warning) => `<li>${escapeHtml(warning.ward_name || warning.ward_id || '-')} - ${escapeHtml(warning.reason || 'Không đủ điều kiện')}</li>`).join('')
    : '<li>Không có cảnh báo bỏ qua phường.</li>';
  const bboxLines = collectBBoxLines(interpolation.bbox)
    .map((line) => `<li>${escapeHtml(line)}</li>`)
    .join('');

  shell.innerHTML = `
    <div class="report-page">
      <div class="report-header">
        <div>
          <div class="report-kicker">BÁO CÁO CHẤT LƯỢNG KHÔNG KHÍ</div>
          <h1>BÁO CÁO TỔNG HỢP AQI CÁC TRẠM ĐO GÒ VẤP</h1>
          <div class="report-subtitle">Phạm vi báo cáo: ${escapeHtml(currentWardId ? getCurrentWardName() : 'Toàn bộ Gò Vấp')}</div>
        </div>
        <div class="report-meta">
          <div><strong>Thời gian xuất:</strong> ${report.now.toLocaleString('vi-VN')}</div>
          <div><strong>Phương pháp nội suy:</strong> ${escapeHtml(interpolation.method)}</div>
          <div><strong>Số trạm tổng hợp:</strong> ${formatNumber(report.summary.total_stations, 0)}</div>
        </div>
      </div>

      <section class="report-section">
        <h2>Tổng quan hiện trạng</h2>
        <div class="report-metric-grid">${renderMetricCards(report.summary)}</div>
      </section>

      <section class="report-section">
        <h2>Nhiều điểm cần lưu ý</h2>
        <div class="report-insights">
          ${insights.map((line) => `<div class="report-insight-item">${escapeHtml(line)}</div>`).join('')}
        </div>
      </section>

      <section class="report-section">
        <h2>Tổng hợp theo phường</h2>
        <table class="report-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Phường</th>
              <th>AQI trung bình</th>
              <th>AQI cao nhất</th>
              <th>Số trạm</th>
              <th>Mức đánh giá</th>
            </tr>
          </thead>
          <tbody>${renderWardRows(report.wards)}</tbody>
        </table>
      </section>

      <section class="report-section">
        <h2>Top trạm có AQI cao nhất</h2>
        <table class="report-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Trạm</th>
              <th>Phường</th>
              <th>PM2.5</th>
              <th>PM10</th>
              <th>AQI</th>
              <th>Đánh giá</th>
            </tr>
          </thead>
          <tbody>${renderRankingRows(report.ranking)}</tbody>
        </table>
      </section>

      <section class="report-section">
        <h2>Danh sách tất cả trạm đo</h2>
        <table class="report-table report-table-compact">
          <thead>
            <tr>
              <th>#</th>
              <th>Mã</th>
              <th>Tên trạm</th>
              <th>Phường</th>
              <th>PM2.5</th>
              <th>PM10</th>
              <th>AQI</th>
              <th>Chất chi phối</th>
              <th>Cập nhật</th>
              <th>Ghi chú</th>
            </tr>
          </thead>
          <tbody>${renderStationsRows(report.stations)}</tbody>
        </table>
      </section>

      <section class="report-section">
        <h2>Trạm ô nhiễm và cảnh báo</h2>
        <table class="report-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Trạm</th>
              <th>Phường</th>
              <th>PM2.5</th>
              <th>PM10</th>
              <th>AQI</th>
              <th>Khuyến nghị</th>
            </tr>
          </thead>
          <tbody>${renderAlertRows(report.alerts)}</tbody>

        </table>
      </section>

      <section class="report-section">
        <h2>Chuyên mục nội suy</h2>
        <div class="report-interpolation-grid">
          <div class="report-panel">
            <h3>Thông tin chung</h3>
            <ul>
              <li>Phạm vi áp dụng: ${escapeHtml(interpolation.scope)}</li>
              <li>Trạng thái: ${interpolation.ok ? 'Đã tính thành công' : 'Chưa đủ điều kiện'}</li>
              <li>Số trạm tham gia: ${formatNumber(interpolation.station_count, 0)}</li>
              <li>Số phường đủ điều kiện: ${formatNumber(interpolation.processed_ward_count, 0)}</li>
              <li>Số phường bị bỏ qua: ${formatNumber(interpolation.skipped_ward_count, 0)}</li>
            </ul>
          </div>
          <div class="report-panel">
            <h3>Thống kê AQI nội suy</h3>
            <ul>
              <li>Số ô lưới thống kê: ${formatNumber(interpolation.grid_cell_count, 0)}</li>
              <li>AQI nhỏ nhất: ${formatNumber(interpolation.min_aqi)}</li>
              <li>AQI trung bình: ${formatNumber(interpolation.avg_aqi)}</li>
              <li>AQI lớn nhất: ${formatNumber(interpolation.max_aqi)}</li>
            </ul>
          </div>
          <div class="report-panel">
            <h3>Phạm vi tính toán</h3>
            <ul>${bboxLines}</ul>
          </div>
        </div>
        ${interpolation.ok ? '' : `<div class="report-warning">Nội suy không đủ điều kiện: ${escapeHtml(interpolation.message)}</div>`}
        <div class="report-panel report-panel-wide">
          <h3>Cảnh báo bỏ qua phường</h3>
          <ul>${warningRows}</ul>
        </div>
      </section>
    </div>
  `;

  document.body.appendChild(shell);
  return shell;
}

async function exportReportPdf() {
  if (exportInProgress) {
    showToast('Hệ thống đang tạo một file PDF khác, vui lòng chờ một chút', 'error');
    return;
  }
  exportInProgress = true;
  setExportBusy(true, 'Đang xuất báo cáo...');
  let shell = null;
  try {
    showToast('Đang tổng hợp dữ liệu báo cáo...');
    const report = await collectReportData();
    shell = createReportShell(report);
    await wait(200);
    showToast('Đang tạo file PDF...');
    await renderShellToPdf(shell, formatExportFilename(report.now));
    showToast('Đã xuất báo cáo PDF thành công');
  } catch (error) {
    console.error('exportReportPdf error:', error);
    showToast(`Không thể xuất báo cáo: ${error.message}`, 'error');
  } finally {
    if (shell?.parentNode) shell.parentNode.removeChild(shell);
    exportInProgress = false;
    setExportBusy(false, 'Xuất báo cáo PDF');
  }
}
