// ═══════════════════════════════════════════
// STATIONS TABLE MODULE
// ═══════════════════════════════════════════

let stationsData = [];

async function loadStationsTable(wardId) {
  try {
    stationsData = await api.stations.list(wardId);
    renderStationsTable(stationsData);
    populateFormStations(stationsData);
  } catch (e) {
    console.error('loadStationsTable:', e);
  }
}

function renderStationsTable(stations) {
  const tbody = document.getElementById('stations-tbody');
  tbody.innerHTML = stations.map(s => `
    <tr>
      <td><code style="color:#06b6d4">${s.code}</code></td>
      <td><strong>${s.name}</strong></td>
      <td>${s.ward_name || ''}</td>
      <td style="font-family:'IBM Plex Mono',monospace">${s.pm25 ?? '–'}</td>
      <td style="font-family:'IBM Plex Mono',monospace">${s.pm10 ?? '–'}</td>
      <td style="font-family:'IBM Plex Mono',monospace;font-weight:700;color:${aqiColor(s.aqi || 0)}">${s.aqi ?? '–'}</td>
      <td>${aqiChip(s.aqi)}</td>
      <td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#6b7394" title="${s.note || ''}">${s.note || '–'}</td>
      <td style="color:#6b7394;font-size:12px">${new Date(s.timestamp).toLocaleString('vi-VN')}</td>
    </tr>
  `).join('');
}

function filterStationsTable() {
  const search = document.getElementById('stations-search').value.toLowerCase();
  const wardId = document.getElementById('stations-ward-filter').value;
  const filtered = stationsData.filter(s => {
    const matchSearch = !search ||
      s.name.toLowerCase().includes(search) ||
      s.code.toLowerCase().includes(search) ||
      (s.ward_name || '').toLowerCase().includes(search);
    const matchWard = !wardId || String(s.ward_id) === wardId;
    return matchSearch && matchWard;
  });
  renderStationsTable(filtered);
}

function populateFormStations(stations) {
  const sel = document.getElementById('form-station');
  sel.innerHTML = '<option value="">-- Chọn trạm --</option>' +
    stations.map(s => `<option value="${s.id}">${s.code} — ${s.name}</option>`).join('');
}

async function setupReadingForm() {
  document.getElementById('reading-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const stationId = document.getElementById('form-station').value;
    if (!stationId) { showToast('Vui lòng chọn trạm', 'error'); return; }

    const body = {
      pm25:          parseFloat(document.getElementById('form-pm25').value) || null,
      pm10:          parseFloat(document.getElementById('form-pm10').value) || null,
      traffic_level: parseInt(document.getElementById('form-traffic').value) || 0,
      factory_near:  parseFloat(document.getElementById('form-factory').value) || 0,
      construction:  document.getElementById('form-construction').checked,
      note:          document.getElementById('form-note').value || null,
    };

    try {
      await api.stations.update(stationId, body);
      showToast('✅ Đã cập nhật đo lường!');
      document.getElementById('reading-form').reset();
    } catch (err) {
      showToast('❌ ' + err.message, 'error');
    }
  });
}
