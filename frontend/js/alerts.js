// ═══════════════════════════════════════════
// ALERTS MODULE
// ═══════════════════════════════════════════

async function loadAlerts() {
  try {
    const alerts = await api.dashboard.alerts();
    renderAlerts(alerts);

    // Update nav badge
    const badge = document.querySelector('[data-view="alerts"]');
    if (alerts.length > 0) {
      badge.textContent = `🚨 Cảnh báo (${alerts.length})`;
    }
  } catch (e) {
    console.error('loadAlerts:', e);
  }
}

function renderAlerts(alerts) {
  const container = document.getElementById('alerts-list');
  if (!alerts.length) {
    container.innerHTML = `
      <div style="text-align:center;padding:60px;color:#6b7394">
        <div style="font-size:48px">✅</div>
        <div style="margin-top:12px;font-size:16px">Không có cảnh báo</div>
        <div style="margin-top:4px;font-size:13px">Tất cả trạm đều trong ngưỡng an toàn</div>
      </div>`;
    return;
  }

  container.innerHTML = alerts.map(a => {
    const c = aqiColor(a.aqi);
    const textColor = a.aqi <= 100 ? '#000' : '#fff';
    return `
      <div class="alert-card" style="border-left-color:${c}">
        <div class="alert-aqi-badge" style="color:${c}">${a.aqi}</div>
        <div class="alert-info">
          <div class="alert-name">${a.name}</div>
          <div class="alert-ward">📍 ${a.ward_name}</div>
          <div class="alert-message" style="color:${c}">${a.message}</div>
          <div class="alert-pm">PM2.5: ${a.pm25 ?? '–'} µg/m³ &nbsp;|&nbsp; PM10: ${a.pm10 ?? '–'} µg/m³</div>
          ${a.note ? `<div style="font-size:12px;color:#6b7394;margin-top:4px">📝 ${a.note}</div>` : ''}
        </div>
        <div style="font-size:11px;color:#6b7394;white-space:nowrap">
          ${new Date(a.timestamp).toLocaleString('vi-VN')}
        </div>
      </div>`;
  }).join('');
}
