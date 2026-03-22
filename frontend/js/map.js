// ═══════════════════════════════════════════
// MAP MODULE — Leaflet + Heatmap + IDW
// ═══════════════════════════════════════════

let map, stationsLayer, wardsLayer, heatLayer, gridLayer;
let allStations = [];
let wardGeoJSON = null;
let currentWardId = null;

function initMap() {
  map = L.map('map', {
    center: [10.827, 106.675],
    zoom: 14,
    zoomControl: true,
  });

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19,
  }).addTo(map);

  stationsLayer = L.layerGroup().addTo(map);
  wardsLayer = L.layerGroup().addTo(map);
  heatLayer = null;
  gridLayer = null;

  loadWards();
  loadStations();
  setupMapControls();
}

// ── Wards (polygon outlines + choropleth) ──
async function loadWards() {
  try {
    wardGeoJSON = await api.wards.geojson();
    renderWards(wardGeoJSON);
    populateWardFilters(wardGeoJSON);
  } catch (e) {
    console.error('loadWards:', e);
  }
}

function renderWards(geojson) {
  wardsLayer.clearLayers();
  if (!geojson?.features) return;

  L.geoJSON(geojson, {
    style: (feature) => {
      const avg = feature.properties.avg_aqi || 0;
      return {
        color: '#3b82f6',
        weight: 2,
        fillColor: avg ? aqiColor(avg) : '#3b82f6',
        fillOpacity: avg ? 0.15 : 0.05,
        dashArray: '4 4',
      };
    },
    onEachFeature: (feature, layer) => {
      const p = feature.properties;
      const avg = p.avg_aqi ? Math.round(p.avg_aqi) : '–';
      layer.bindTooltip(
        `<strong>${p.name}</strong><br>AQI TB: <b style="color:${aqiColor(avg || 0)}">${avg}</b>`,
        { sticky: true, className: 'ward-tooltip' }
      );
      layer.on('click', () => {
        // Filter to this ward
        const sel = document.getElementById('ward-filter');
        sel.value = p.id;
        filterByWard(p.id);
      });
    },
  }).addTo(wardsLayer);
}

// ── Stations (circle markers) ──
async function loadStations(wardId) {
  try {
    const geojson = await api.stations.geojson(wardId);
    allStations = geojson.features.map(f => ({ ...f.properties, lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0] }));
    renderStationMarkers(geojson);
    updateGlobalAQI();
  } catch (e) {
    console.error('loadStations:', e);
  }
}

function renderStationMarkers(geojson) {
  stationsLayer.clearLayers();
  if (!geojson?.features) return;

  geojson.features.forEach(f => {
    const p = f.properties;
    const aqi = p.aqi || 0;
    const color = aqiColor(aqi);
    const [lng, lat] = f.geometry.coordinates;

    const marker = L.circleMarker([lat, lng], {
      radius: 10 + Math.min(aqi / 40, 8),
      fillColor: color,
      color: '#fff',
      weight: 2,
      fillOpacity: 0.9,
    });

    marker.bindPopup(`
      <div class="popup-station">
        <h3>${p.name}</h3>
        <div class="pm">
          PM2.5: <span>${p.pm25 ?? '–'}</span> µg/m³ &nbsp;
          PM10: <span>${p.pm10 ?? '–'}</span> µg/m³
        </div>
        <div style="margin-top:6px">
          <span class="aqi-chip" style="background:${color};color:${aqi <= 100 ? '#000' : '#fff'}">${aqi} ${aqiLabel(aqi)}</span>
        </div>
        <div class="ward">${p.ward_name || ''}</div>
        ${p.note ? `<div class="note">📝 ${p.note}</div>` : ''}
        ${p.construction ? '<div class="note">🏗 Có công trình xây dựng</div>' : ''}
        ${p.factory_near < 0.5 ? '<div class="note">🏭 Gần nhà máy</div>' : ''}
        <div style="margin-top:8px">
          <small style="color:#6b7394">${new Date(p.timestamp).toLocaleString('vi-VN')}</small>
        </div>
      </div>
    `);

    // Pulse ring for high AQI
    if (aqi > 150) {
      const pulse = L.circleMarker([lat, lng], {
        radius: 18, fillColor: 'none',
        color: color, weight: 1.5, opacity: 0.5, fillOpacity: 0,
      }).addTo(stationsLayer);
    }

    marker.addTo(stationsLayer);
  });
}

// ── Heatmap (Leaflet.heat) ──
async function runInterpolation() {
  const method = document.getElementById('interp-method').value;
  const btn = document.getElementById('btn-interpolate');
  btn.textContent = '⏳ Đang tính...';
  btn.disabled = true;

  try {
    const result = await api.interpolate(currentWardId, method);

    // Remove old layers
    if (heatLayer) { map.removeLayer(heatLayer); heatLayer = null; }
    if (gridLayer) { map.removeLayer(gridLayer); gridLayer = null; }

    // Heatmap toggle
    if (document.getElementById('layer-heatmap').checked) {
      const pts = result.heatmap_points.map(([lat, lng, i]) => [lat, lng, i]);
      heatLayer = L.heatLayer(pts, {
        radius: 30, blur: 25, maxZoom: 17,
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

    // Grid GeoJSON toggle
    if (document.getElementById('layer-grid').checked) {
      gridLayer = L.geoJSON(result.geojson, {
        style: (feature) => ({
          fillColor: aqiColor(feature.properties.aqi),
          fillOpacity: 0.35,
          color: 'none',
          weight: 0,
        }),
        onEachFeature: (feature, layer) => {
          layer.bindTooltip(`AQI: ${feature.properties.aqi}`, { sticky: true });
        },
      }).addTo(map);
    }

    showToast(`✅ Nội suy ${method.toUpperCase()} hoàn tất (${result.station_count} trạm)`);
  } catch (e) {
    showToast('❌ Lỗi nội suy: ' + e.message, 'error');
  } finally {
    btn.textContent = '▶ Chạy nội suy';
    btn.disabled = false;
  }
}

// ── Layer toggles ──
function setupMapControls() {
  document.getElementById('layer-stations').addEventListener('change', (e) => {
    e.target.checked ? map.addLayer(stationsLayer) : map.removeLayer(stationsLayer);
  });
  document.getElementById('layer-wards').addEventListener('change', (e) => {
    e.target.checked ? map.addLayer(wardsLayer) : map.removeLayer(wardsLayer);
  });
  document.getElementById('layer-heatmap').addEventListener('change', (e) => {
    if (!e.target.checked && heatLayer) { map.removeLayer(heatLayer); heatLayer = null; }
    else if (e.target.checked) runInterpolation();
  });
  document.getElementById('layer-grid').addEventListener('change', (e) => {
    if (!e.target.checked && gridLayer) { map.removeLayer(gridLayer); gridLayer = null; }
    else if (e.target.checked) runInterpolation();
  });
  document.getElementById('btn-interpolate').addEventListener('click', runInterpolation);
}

// ── Ward filter ──
function populateWardFilters(geojson) {
  const selects = ['ward-filter', 'stations-ward-filter'];
  geojson.features.forEach(f => {
    selects.forEach(id => {
      const sel = document.getElementById(id);
      if (sel) {
        const opt = document.createElement('option');
        opt.value = f.properties.id;
        opt.textContent = f.properties.name;
        sel.appendChild(opt);
      }
    });
    // Reading form
    const formSel = document.getElementById('form-station');
    // populated later with station list
  });
}

async function filterByWard(wardId) {
  currentWardId = wardId ? parseInt(wardId) : null;

  // Load KMZ if ward selected
  if (currentWardId) {
    try {
      const kmzUrl = `${api.baseURL}/wards/${currentWardId}/kmz`;
      // Create download link for KMZ
      const kmzLink = document.getElementById('kmz-download');
      if (kmzLink) {
        kmzLink.href = kmzUrl;
        kmzLink.style.display = 'inline-block';
        kmzLink.download = `ward_${currentWardId}.kmz`;
      }
    } catch (e) {
      console.error('Error loading KMZ:', e);
    }
  } else {
    // Hide KMZ download link
    const kmzLink = document.getElementById('kmz-download');
    if (kmzLink) {
      kmzLink.style.display = 'none';
    }
  }

  // Reload stations for this ward
  await loadStations(currentWardId);

  // Highlight ward polygon
  if (wardGeoJSON && currentWardId) {
    wardsLayer.eachLayer(layer => {
      const props = layer.feature?.properties;
      if (props) {
        const isSelected = props.id === currentWardId;
        layer.setStyle({
          weight: isSelected ? 3 : 2,
          color: isSelected ? '#06b6d4' : '#3b82f6',
          fillOpacity: isSelected ? 0.25 : 0.05,
        });
        if (isSelected) {
          layer.bringToFront();
          map.fitBounds(layer.getBounds(), { padding: [40, 40] });
        }
      }
    });
  } else {
    // Reset ward styles
    wardsLayer.eachLayer(layer => {
      if (layer.feature) {
        const avg = layer.feature.properties.avg_aqi || 0;
        layer.setStyle({ weight: 2, color: '#3b82f6', fillOpacity: avg ? 0.15 : 0.05 });
      }
    });
    map.setView([10.827, 106.675], 14);
  }

  // Clear interpolation layers
  if (heatLayer) { map.removeLayer(heatLayer); heatLayer = null; }
  if (gridLayer) { map.removeLayer(gridLayer); gridLayer = null; }
  document.getElementById('layer-heatmap').checked = false;
  document.getElementById('layer-grid').checked = false;
}

function updateGlobalAQI() {
  if (!allStations.length) return;
  const avg = Math.round(allStations.reduce((s, x) => s + (x.aqi || 0), 0) / allStations.length);
  const el = document.getElementById('global-aqi');
  el.textContent = avg;
  el.style.color = aqiColor(avg);
  document.getElementById('global-label').textContent = aqiLabel(avg);
}
