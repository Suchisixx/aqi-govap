async function loadThresholds() {
  try {
    const thresholds = await api.dashboard.thresholds();
    document.getElementById('threshold-aqi-warning').value = thresholds.aqi_warning;
    document.getElementById('threshold-aqi-danger').value = thresholds.aqi_danger;
    document.getElementById('threshold-pm25-warning').value = thresholds.pm25_warning;
    document.getElementById('threshold-pm10-warning').value = thresholds.pm10_warning;
    document.getElementById('threshold-consecutive').value = thresholds.consecutive_readings;
    document.getElementById('threshold-note').textContent = thresholds.updated_at
      ? `Cập nhật lần cuối: ${formatDateTime(thresholds.updated_at)}`
      : 'Đang dùng ngưỡng mặc định.';
  } catch (error) {
    console.error('loadThresholds:', error);
  }
}

function setupThresholdControls() {
  document.getElementById('btn-save-thresholds').addEventListener('click', async () => {
    if (!isAdmin()) {
      showToast('Chỉ admin mới được sửa ngưỡng cảnh báo', 'error');
      return;
    }
    const payload = {
      aqi_warning: Number(document.getElementById('threshold-aqi-warning').value),
      aqi_danger: Number(document.getElementById('threshold-aqi-danger').value),
      pm25_warning: Number(document.getElementById('threshold-pm25-warning').value),
      pm10_warning: Number(document.getElementById('threshold-pm10-warning').value),
      consecutive_readings: Number(document.getElementById('threshold-consecutive').value),
    };
    try {
      await api.dashboard.updateThresholds(payload);
      showToast('Đã cập nhật ngưỡng cảnh báo');
      loadAlerts();
    } catch (error) {
      showToast(`Không lưu được ngưỡng: ${error.message}`, 'error');
    }
  });
}

async function loadAlerts() {
  try {
    const alerts = await api.dashboard.alerts(currentWardId || null);
    renderAlerts(alerts);
    await loadThresholds();
    const badge = document.querySelector('[data-view="alerts"]');
    badge.textContent = alerts.length > 0 ? `Cảnh báo (${alerts.length})` : 'Cảnh báo';
  } catch (error) {
    console.error('loadAlerts:', error);
    showToast(`Không tải được cảnh báo: ${error.message}`, 'error');
  }
}

function renderAlerts(alerts) {
  const container = document.getElementById('alerts-list');
  const sortedAlerts = [...alerts].sort((left, right) => {
    const leftTime = new Date(left.timestamp || left.updated_at || 0).getTime();
    const rightTime = new Date(right.timestamp || right.updated_at || 0).getTime();
    return rightTime - leftTime;
  });

  if (!sortedAlerts.length) {
    container.innerHTML = `
      <div style="text-align:center;padding:60px;color:#6b7394">
        <div style="font-size:38px">OK</div>
        <div style="margin-top:12px;font-size:16px">Không có cảnh báo</div>
        <div style="margin-top:4px;font-size:13px">Tất cả trạm đều trong ngưỡng an toàn hiện tại</div>
      </div>`;
    return;
  }

  container.innerHTML = sortedAlerts.map((alert) => {
    const color = aqiColor(alert.aqi || 0);
    const alertTime = alert.timestamp || alert.updated_at;
    return `
      <div class="alert-card" style="border-left-color:${color}">
        <div class="alert-aqi-badge" style="color:${color}">${alert.aqi}</div>
        <div class="alert-info">
          <div class="alert-name">${alert.name}</div>
          <div class="alert-ward">${alert.ward_name}</div>
          <div class="alert-message" style="color:${color}">${alert.message}</div>
          <div class="alert-pm">PM2.5: ${alert.pm25 ?? '-'} ug/m3 | PM10: ${alert.pm10 ?? '-'} ug/m3</div>
          <div class="alert-pm">Ngưỡng: AQI ${alert.thresholds.aqi_warning} / PM2.5 ${alert.thresholds.pm25_warning} / PM10 ${alert.thresholds.pm10_warning}</div>
          ${alert.note ? `<div style="font-size:12px;color:#6b7394;margin-top:4px">${alert.note}</div>` : ''}
        </div>
        <div style="font-size:11px;color:#6b7394;white-space:nowrap">
          ${alertTime ? new Date(alertTime).toLocaleString('vi-VN') : '-'}
        </div>
      </div>
    `;
  }).join('');
}
