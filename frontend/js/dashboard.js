// ═══════════════════════════════════════════
// DASHBOARD MODULE
// ═══════════════════════════════════════════

let tsChart = null, wardChart = null, pieChart = null;

async function loadDashboard() {
  try {
    const [summary, wardRank, stationRank, ts] = await Promise.all([
      api.dashboard.summary(),
      api.dashboard.wardRanking(),
      api.dashboard.stationRanking(5),
      api.dashboard.timeseries(null, 24),
    ]);

    renderStatCards(summary);
    renderWardBar(wardRank);
    renderPie(summary);
    renderTimeseries(ts);
    renderRankTable(stationRank);
  } catch (e) {
    console.error('loadDashboard:', e);
  }
}

function renderStatCards(s) {
  const avg = parseFloat(s.avg_aqi) || 0;
  document.getElementById('stat-cards').innerHTML = `
    <div class="stat-card">
      <div class="label">AQI Trung bình</div>
      <div class="value" style="color:${aqiColor(avg)}">${Math.round(avg)}</div>
      <div class="sub">${aqiLabel(avg)}</div>
    </div>
    <div class="stat-card">
      <div class="label">AQI Cao nhất</div>
      <div class="value" style="color:${aqiColor(s.max_aqi || 0)}">${s.max_aqi || '–'}</div>
      <div class="sub">${aqiLabel(s.max_aqi || 0)}</div>
    </div>
    <div class="stat-card">
      <div class="label">Tổng trạm đo</div>
      <div class="value" style="color:#06b6d4">${s.total_stations}</div>
      <div class="sub">đang hoạt động</div>
    </div>
    <div class="stat-card">
      <div class="label">Cần chú ý</div>
      <div class="value" style="color:${(s.unhealthy + s.very_unhealthy) > 0 ? '#ff0000' : '#22c55e'}">${s.unhealthy + s.very_unhealthy}</div>
      <div class="sub">trạm vượt ngưỡng</div>
    </div>
  `;
}

function renderWardBar(wards) {
  const ctx = document.getElementById('chart-ward-bar').getContext('2d');
  if (wardChart) wardChart.destroy();

  wardChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: wards.map(w => w.name),
      datasets: [{
        label: 'AQI trung bình',
        data: wards.map(w => parseFloat(w.avg_aqi) || 0),
        backgroundColor: wards.map(w => aqiColor(parseFloat(w.avg_aqi) || 0) + 'cc'),
        borderColor: wards.map(w => aqiColor(parseFloat(w.avg_aqi) || 0)),
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

function renderPie(s) {
  const ctx = document.getElementById('chart-pie').getContext('2d');
  if (pieChart) pieChart.destroy();

  pieChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Tốt (0-50)', 'Trung bình (51-100)', 'Kém (101-150)', 'Xấu (151-200)', 'Rất xấu (>200)'],
      datasets: [{
        data: [
          s.good,
          s.moderate,
          s.unhealthy_sensitive,
          s.unhealthy,
          s.very_unhealthy,
        ],
        backgroundColor: ['#00e400cc', '#ffff00cc', '#ff7e00cc', '#ff0000cc', '#8f3f97cc'],
        borderColor: ['#00e400', '#ffff00', '#ff7e00', '#ff0000', '#8f3f97'],
        borderWidth: 2,
      }],
    },
    options: {
      responsive: true,
      cutout: '55%',
      plugins: {
        legend: {
          position: 'right',
          labels: { color: '#d8dce8', font: { size: 11 }, boxWidth: 12, padding: 8 },
        },
      },
    },
  });
}

function renderTimeseries(data) {
  const ctx = document.getElementById('chart-timeseries').getContext('2d');
  if (tsChart) tsChart.destroy();

  const labels = data.map(d => new Date(d.timestamp).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }));

  tsChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'PM2.5',
          data: data.map(d => d.pm25),
          borderColor: '#06b6d4',
          backgroundColor: '#06b6d420',
          borderWidth: 2,
          tension: 0.4,
          fill: true,
          pointRadius: 3,
        },
        {
          label: 'PM10',
          data: data.map(d => d.pm10),
          borderColor: '#f97316',
          backgroundColor: '#f9731620',
          borderWidth: 2,
          tension: 0.4,
          fill: true,
          pointRadius: 3,
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
  tbody.innerHTML = stations.map((s, i) => `
    <tr>
      <td><strong>${i + 1}</strong></td>
      <td><strong>${s.name}</strong></td>
      <td>${s.ward_name}</td>
      <td style="font-family:'IBM Plex Mono',monospace">${s.pm25 ?? '–'}</td>
      <td style="font-family:'IBM Plex Mono',monospace">${s.pm10 ?? '–'}</td>
      <td style="font-family:'IBM Plex Mono',monospace;font-weight:700;color:${aqiColor(s.aqi || 0)}">${s.aqi}</td>
      <td>${aqiChip(s.aqi)}</td>
    </tr>
  `).join('');
}
