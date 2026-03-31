let tsChart = null;
let wardChart = null;
let pieChart = null;

function getDashboardFilters() {
  return {
    wardId: Number(document.getElementById('dashboard-ward-filter')?.value || 0) || null,
    hours: Number(document.getElementById('dashboard-hours')?.value || 24),
    bucket: document.getElementById('dashboard-bucket')?.value || 'hour',
  };
}

async function loadDashboard() {
  try {
    const filters = getDashboardFilters();
    const [summary, wardRank, stationRank, ts, trends] = await Promise.all([
      api.dashboard.summary(filters.wardId),
      api.dashboard.wardRanking(filters.hours),
      api.dashboard.stationRanking(5, filters.wardId),
      api.dashboard.timeseries(filters),
      api.dashboard.trends(filters.hours, filters.wardId),
    ]);

    renderStatCards(summary);
    renderTrendCards(trends);
    renderWardBar(wardRank);
    renderPie(summary);
    renderTimeseries(ts, filters.bucket);
    renderRankTable(stationRank);
  } catch (error) {
    console.error('loadDashboard:', error);
    showToast(`Không tải được dashboard: ${error.message}`, 'error');
  }
}

function renderStatCards(summary) {
  const avg = parseFloat(summary.avg_aqi) || 0;
  document.getElementById('stat-cards').innerHTML = `
    <div class="stat-card">
      <div class="label">AQI trung bình</div>
      <div class="value" style="color:${aqiColor(avg)}">${Math.round(avg || 0)}</div>
      <div class="sub">${aqiLabel(avg)}</div>
    </div>
    <div class="stat-card">
      <div class="label">AQI cao nhất</div>
      <div class="value" style="color:${aqiColor(summary.max_aqi || 0)}">${summary.max_aqi || '-'}</div>
      <div class="sub">${aqiLabel(summary.max_aqi || 0)}</div>
    </div>
    <div class="stat-card">
      <div class="label">Tổng trạm đo</div>
      <div class="value" style="color:#06b6d4">${summary.total_stations || 0}</div>
      <div class="sub">Đang được tổng hợp</div>
    </div>
    <div class="stat-card">
      <div class="label">Vượt ngưỡng</div>
      <div class="value" style="color:${(summary.unhealthy + summary.very_unhealthy) > 0 ? '#ff6b6b' : '#22c55e'}">${(summary.unhealthy || 0) + (summary.very_unhealthy || 0)}</div>
      <div class="sub">Cần theo dõi</div>
    </div>
  `;
}

function renderTrendCards(trends) {
  const cards = [
    ['AQI trung bình', trends.current.avg_aqi, trends.delta.avg_aqi],
    ['PM2.5 TB', trends.current.avg_pm25, trends.delta.avg_pm25],
    ['PM10 TB', trends.current.avg_pm10, trends.delta.avg_pm10],
  ];
  document.getElementById('trend-cards').innerHTML = cards.map(([label, value, delta]) => `
    <div class="trend-card">
      <div class="label">${label}</div>
      <div class="value">${formatNumber(value)}</div>
      <div class="sub">So với kỳ trước: ${delta == null ? '-' : `${delta > 0 ? '+' : ''}${formatNumber(delta)}`}</div>
    </div>
  `).join('');
}

function renderWardBar(wards) {
  const ctx = document.getElementById('chart-ward-bar').getContext('2d');
  if (wardChart) wardChart.destroy();
  wardChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: wards.map((item) => item.name),
      datasets: [{
        label: 'AQI trung bình',
        data: wards.map((item) => parseFloat(item.avg_aqi) || 0),
        backgroundColor: wards.map((item) => `${aqiColor(parseFloat(item.avg_aqi) || 0)}cc`),
        borderColor: wards.map((item) => aqiColor(parseFloat(item.avg_aqi) || 0)),
        borderWidth: 2,
        borderRadius: 4,
      }],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, max: 300, grid: { color: '#252a3a' }, ticks: { color: '#6b7394' } },
        x: { grid: { display: false }, ticks: { color: '#d8dce8', font: { size: 11 } } },
      },
    },
  });
}

function renderPie(summary) {
  const ctx = document.getElementById('chart-pie').getContext('2d');
  if (pieChart) pieChart.destroy();
  pieChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Tốt', 'Trung bình', 'Kém', 'Xấu', 'Rất xấu'],
      datasets: [{
        data: [summary.good, summary.moderate, summary.unhealthy_sensitive, summary.unhealthy, summary.very_unhealthy],
        backgroundColor: ['#00e400cc', '#ffff00cc', '#ff7e00cc', '#ff0000cc', '#8f3f97cc'],
        borderColor: ['#00e400', '#ffff00', '#ff7e00', '#ff0000', '#8f3f97'],
        borderWidth: 2,
      }],
    },
    options: {
      responsive: true,
      cutout: '55%',
      plugins: {
        legend: { position: 'right', labels: { color: '#d8dce8', font: { size: 11 }, boxWidth: 12, padding: 8 } },
      },
    },
  });
}

function renderTimeseries(data, bucket) {
  const ctx = document.getElementById('chart-timeseries').getContext('2d');
  if (tsChart) tsChart.destroy();
  const labels = data.map((item) => {
    const date = new Date(item.timestamp);
    return bucket === 'day'
      ? date.toLocaleDateString('vi-VN')
      : date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  });

  tsChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'PM2.5',
          data: data.map((item) => item.pm25),
          borderColor: '#06b6d4',
          backgroundColor: '#06b6d420',
          borderWidth: 2,
          tension: 0.35,
          fill: true,
          pointRadius: 2,
        },
        {
          label: 'PM10',
          data: data.map((item) => item.pm10),
          borderColor: '#f97316',
          backgroundColor: '#f9731620',
          borderWidth: 2,
          tension: 0.35,
          fill: true,
          pointRadius: 2,
        },
      ],
    },
    options: {
      responsive: true,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { color: '#d8dce8', font: { size: 12 } } },
      },
      scales: {
        y: { grid: { color: '#252a3a' }, ticks: { color: '#6b7394' } },
        x: { grid: { color: '#1c2030' }, ticks: { color: '#6b7394', maxTicksLimit: 8 } },
      },
    },
  });
}

function renderRankTable(stations) {
  const tbody = document.querySelector('#rank-table tbody');
  tbody.innerHTML = stations.map((station, index) => `
    <tr>
      <td><strong>${index + 1}</strong></td>
      <td><strong>${station.name}</strong></td>
      <td>${station.ward_name}</td>
      <td style="font-family:'IBM Plex Mono',monospace">${station.pm25 ?? '-'}</td>
      <td style="font-family:'IBM Plex Mono',monospace">${station.pm10 ?? '-'}</td>
      <td style="font-family:'IBM Plex Mono',monospace;font-weight:700;color:${aqiColor(station.aqi || 0)}">${station.aqi}</td>
      <td>${aqiChip(station.aqi)}</td>
    </tr>
  `).join('');
}
