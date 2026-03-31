let stationsData = [];
let selectedStationId = null;
let stationDetailChart = null;

function openStationDetail() {
  const shell = document.querySelector('.station-detail-shell');
  if (!shell) return;
  shell.hidden = false;
  shell.classList.add('is-open');
}

function closeStationDetail() {
  const shell = document.querySelector('.station-detail-shell');
  if (!shell) return;
  shell.classList.remove('is-open');
  shell.hidden = true;
}

async function loadStationsTable() {
  try {
    stationsData = await api.stations.list();
    refreshStationsTableView();
    if (selectedStationId) loadStationDetail(selectedStationId);
  } catch (error) {
    console.error('loadStationsTable error:', error);
    showToast(`Không tải được bảng trạm: ${error.message}`, 'error');
  }
}

function getFilteredStationsTableData() {
  const search = document.getElementById('stations-search')?.value.toLowerCase() || '';
  const selectedWardId = document.getElementById('stations-ward-filter')?.value || '';
  const activeWardId = currentWardId ? String(currentWardId) : '';
  const wardId = selectedWardId || activeWardId;

  return stationsData.filter((station) => {
    const matchSearch = !search
      || station.name.toLowerCase().includes(search)
      || station.code.toLowerCase().includes(search)
      || (station.ward_name || '').toLowerCase().includes(search);
    const matchWard = !wardId || String(station.ward_id) === wardId;
    return matchSearch && matchWard;
  });
}

function refreshStationsTableView() {
  renderStationsTable(getFilteredStationsTableData());
}

function renderStationsTable(stations) {
  const tbody = document.getElementById('stations-tbody');
  tbody.innerHTML = stations.map((station) => {
    const aqiTitle = `AQI PM2.5: ${station.aqi_pm25 ?? '-'} | AQI PM10: ${station.aqi_pm10 ?? '-'} | Chỉ phối: ${pollutantLabel(station.primary_pollutant)}`;
    return `
      <tr data-station-id="${station.id}">
        <td><code style="color:#06b6d4">${station.code}</code></td>
        <td><strong>${station.name}</strong></td>
        <td>${station.ward_name || ''}</td>
        <td style="font-family:'IBM Plex Mono',monospace">${station.pm25 ?? '-'}</td>
        <td style="font-family:'IBM Plex Mono',monospace">${station.pm10 ?? '-'}</td>
        <td title="${aqiTitle}" style="font-family:'IBM Plex Mono',monospace;font-weight:700;color:${aqiColor(station.aqi || 0)}">${station.aqi ?? '-'}</td>
        <td title="${aqiTitle}">${aqiChip(station.aqi)}</td>
        <td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#6b7394" title="${station.note || ''}">
          ${station.note || '-'}
        </td>
        <td style="color:#6b7394;font-size:12px">${new Date(station.timestamp).toLocaleString('vi-VN')}</td>
        <td><button class="topbar-btn station-detail-btn" type="button" data-station-id="${station.id}">Xem</button></td>
      </tr>
    `;
  }).join('');

  document.querySelectorAll('.station-detail-btn').forEach((button) => {
    button.addEventListener('click', () => {
      selectedStationId = Number(button.dataset.stationId);
      loadStationDetail(selectedStationId);
    });
  });
}

function filterStationsTable() {
  refreshStationsTableView();
}

function upsertStationInTable(station) {
  const index = stationsData.findIndex((item) => Number(item.id) === Number(station.id));
  if (index >= 0) stationsData[index] = { ...stationsData[index], ...station };
  else stationsData.push(station);
  refreshStationsTableView();
}

function removeStationFromTable(stationId) {
  stationsData = stationsData.filter((station) => Number(station.id) !== Number(stationId));
  refreshStationsTableView();
}

function setupReadingForm() {
  const form = document.getElementById('reading-form');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!canManageData()) {
      showToast('Cần đăng nhập với quyền officer hoặc admin', 'error');
      return;
    }

    const stationId = document.getElementById('station-select').value;
    if (!stationId) {
      showToast('Vui lòng chọn trạm', 'error');
      return;
    }

    const pm25Value = parseFloat(document.getElementById('form-pm25').value);
    const pm10Value = parseFloat(document.getElementById('form-pm10').value);
    const trafficValue = parseInt(document.getElementById('form-traffic').value, 10);
    const factoryValue = parseFloat(document.getElementById('form-factory').value);

    const body = {
      pm25: Number.isNaN(pm25Value) ? null : pm25Value,
      pm10: Number.isNaN(pm10Value) ? null : pm10Value,
      traffic_level: Number.isNaN(trafficValue) ? 0 : trafficValue,
      factory_near: Number.isNaN(factoryValue) ? 0 : factoryValue,
      construction: document.getElementById('form-construction').checked,
      note: document.getElementById('form-note').value || null,
    };

    try {
      const updatedStation = await api.stations.update(stationId, body);
      upsertStationInState(updatedStation);
      upsertStationInTable(updatedStation);
      if (selectedStationId && Number(selectedStationId) === Number(stationId)) {
        loadStationDetail(selectedStationId);
      }
      showToast('Đã cập nhật đo lường');
      refreshLiveViews();
    } catch (error) {
      showToast(`Lỗi cập nhật: ${error.message}`, 'error');
    }
  });
}

function setupImportControls() {
  document.getElementById('btn-import').addEventListener('click', async () => {
    if (!canManageData()) {
      showToast('Cần quyền officer hoặc admin để import', 'error');
      return;
    }
    const input = document.getElementById('import-file');
    const file = input.files?.[0];
    if (!file) {
      showToast('Vui lòng chọn file CSV hoặc XLSX', 'error');
      return;
    }
    const formData = new FormData();
    formData.append('file', file);
    const resultEl = document.getElementById('import-result');
    resultEl.textContent = 'Đang import...';
    try {
      const result = await api.stations.importFile(formData);
      resultEl.textContent = `Đã xử lý ${result.total_rows} dòng: tạo mới ${result.created}, cập nhật ${result.updated}.`;
      input.value = '';
      showToast('Import dữ liệu thành công');
      await loadStations();
      if (currentView === 'stations') loadStationsTable();
      if (currentView === 'alerts') loadAlerts();
    } catch (error) {
      resultEl.textContent = error.message;
      showToast(`Import thất bại: ${error.message}`, 'error');
    }
  });
}

function renderStationMetrics(summary, station) {
  const metrics = [
    ['AQI hiện tại', station.aqi ?? '-', station.aqi != null ? aqiLabel(station.aqi) : ''],
    ['AQI trung bình', formatNumber(summary.avg_aqi), `Trong ${summary.reading_count || 0} bản ghi`],
    ['AQI cao nhất', formatNumber(summary.max_aqi, 0), 'Mốc cao nhất'],
    ['AQI thấp nhất', formatNumber(summary.min_aqi, 0), 'Mốc thấp nhất'],
    ['Biến động', summary.delta_aqi == null ? '-' : `${summary.delta_aqi > 0 ? '+' : ''}${formatNumber(summary.delta_aqi)}`, 'So với mốc đầu kỳ'],
  ];
  document.getElementById('station-detail-metrics').innerHTML = metrics.map(([label, value, note]) => `
    <div class="detail-metric">
      <div class="label">${label}</div>
      <div class="value" style="color:${label.includes('AQI hiện tại') ? aqiColor(station.aqi || 0) : '#e2e8f0'}">${value}</div>
      <div class="sub" style="color:#93a3c2;font-size:12px;margin-top:6px">${note}</div>
    </div>
  `).join('');
}

function renderStationDetailChart(history) {
  const ctx = document.getElementById('chart-station-detail').getContext('2d');
  if (stationDetailChart) stationDetailChart.destroy();
  stationDetailChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: history.map((item) => new Date(item.timestamp).toLocaleString('vi-VN')),
      datasets: [
        {
          label: 'PM2.5',
          data: history.map((item) => item.pm25),
          borderColor: '#06b6d4',
          backgroundColor: '#06b6d420',
          fill: true,
          tension: 0.25,
        },
        {
          label: 'PM10',
          data: history.map((item) => item.pm10),
          borderColor: '#f97316',
          backgroundColor: '#f9731620',
          fill: true,
          tension: 0.25,
        },
        {
          label: 'AQI',
          data: history.map((item) => item.aqi),
          borderColor: '#ef4444',
          backgroundColor: '#ef444410',
          fill: false,
          tension: 0.25,
          yAxisID: 'y1',
        },
      ],
    },
    options: {
      responsive: true,
      interaction: { mode: 'index', intersect: false },
      scales: {
        y: { grid: { color: '#252a3a' }, ticks: { color: '#6b7394' } },
        y1: { position: 'right', grid: { drawOnChartArea: false }, ticks: { color: '#fca5a5' } },
        x: { ticks: { color: '#6b7394', maxTicksLimit: 8 } },
      },
      plugins: { legend: { labels: { color: '#d8dce8' } } },
    },
  });
}

async function loadStationDetail(stationId) {
  selectedStationId = Number(stationId);
  try {
    const hours = Number(document.getElementById('stations-hours-filter')?.value || 72);
    const detail = await api.stations.detail(selectedStationId, hours);
    document.getElementById('station-detail-title').textContent = `${detail.station.code} - ${detail.station.name}`;
    document.getElementById('station-detail-subtitle').textContent = `${detail.station.ward_name || '-'} | Cập nhật ${formatDateTime(detail.station.timestamp)}`;
    renderStationMetrics(detail.summary, detail.station);
    renderStationDetailChart(detail.history || []);
    openStationDetail();
  } catch (error) {
    showToast(`Không tải được chi tiết trạm: ${error.message}`, 'error');
  }
}

function clearStationDetail() {
  selectedStationId = null;
  document.getElementById('station-detail-title').textContent = 'Chi tiết trạm';
  document.getElementById('station-detail-subtitle').textContent = 'Chọn một trạm trong bảng để xem lịch sử PM2.5, PM10 và AQI.';
  document.getElementById('station-detail-metrics').innerHTML = '';
  if (stationDetailChart) {
    stationDetailChart.destroy();
    stationDetailChart = null;
  }
  closeStationDetail();
}
