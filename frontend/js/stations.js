let stationsData = [];

async function loadStationsTable(wardId) {
  try {
    stationsData = await api.stations.list(wardId);
    renderStationsTable(stationsData);
    populateFormStations(stationsData);
  } catch (error) {
    console.error('loadStationsTable error:', error);
    showToast(`Không tải được bảng trạm: ${error.message}`, 'error');
  }
}

function renderStationsTable(stations) {
  const tbody = document.getElementById('stations-tbody');
  tbody.innerHTML = stations
    .map(
      (station) => `
      <tr>
        <td><code style="color:#06b6d4">${station.code}</code></td>
        <td><strong>${station.name}</strong></td>
        <td>${station.ward_name || ''}</td>
        <td style="font-family:'IBM Plex Mono',monospace">${station.pm25 ?? '–'}</td>
        <td style="font-family:'IBM Plex Mono',monospace">${station.pm10 ?? '–'}</td>
        <td style="font-family:'IBM Plex Mono',monospace;font-weight:700;color:${aqiColor(station.aqi || 0)}">${station.aqi ?? '–'}</td>
        <td>${aqiChip(station.aqi)}</td>
        <td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#6b7394" title="${station.note || ''}">
          ${station.note || '–'}
        </td>
        <td style="color:#6b7394;font-size:12px">${new Date(station.timestamp).toLocaleString('vi-VN')}</td>
      </tr>
    `
    )
    .join('');
}

function filterStationsTable() {
  const search = document.getElementById('stations-search').value.toLowerCase();
  const wardId = document.getElementById('stations-ward-filter').value;

  const filtered = stationsData.filter((station) => {
    const matchSearch =
      !search ||
      station.name.toLowerCase().includes(search) ||
      station.code.toLowerCase().includes(search) ||
      (station.ward_name || '').toLowerCase().includes(search);

    const matchWard = !wardId || String(station.ward_id) === wardId;
    return matchSearch && matchWard;
  });

  renderStationsTable(filtered);
}

function populateFormStations(stations) {
  const select = document.getElementById('station-select');
  if (!select) return;

  const current = select.value;
  select.innerHTML =
    '<option value="">-- Chọn trạm --</option>' +
    stations.map((station) => `<option value="${station.id}">${station.code} — ${station.name}</option>`).join('');

  if (current && stations.some((s) => String(s.id) === current)) {
    select.value = current;
  }

  if (typeof updateStationFormBySelection === 'function') {
    updateStationFormBySelection();
  }
}

function setupReadingForm() {
  const form = document.getElementById('reading-form');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    const stationId = document.getElementById('station-select').value;
    if (!stationId) {
      showToast('Vui lòng chọn trạm', 'error');
      return;
    }

    const body = {
      pm25: parseFloat(document.getElementById('form-pm25').value) || null,
      pm10: parseFloat(document.getElementById('form-pm10').value) || null,
      traffic_level: parseInt(document.getElementById('form-traffic').value, 10) || 0,
      factory_near: parseFloat(document.getElementById('form-factory').value) || 0,
      construction: document.getElementById('form-construction').checked,
      note: document.getElementById('form-note').value || null,
    };

    try {
      await api.stations.update(stationId, body);
      showToast('Đã cập nhật đo lường');
      await loadStations(currentWardId);
      await loadStationsTable(currentWardId);
    } catch (error) {
      showToast(`Lỗi cập nhật: ${error.message}`, 'error');
    }
  });
}
