// ═══════════════════════════════════════════
// API Client — thin wrapper around fetch
// ═══════════════════════════════════════════

const API_BASE = '/api';

const api = {
  async get(path) {
    const res = await fetch(API_BASE + path);
    if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
    return res.json();
  },

  async post(path, body) {
    const res = await fetch(API_BASE + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `POST ${path} → ${res.status}`);
    }
    return res.json();
  },

  async put(path, body) {
    const res = await fetch(API_BASE + path, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`PUT ${path} → ${res.status}`);
    return res.json();
  },

  async del(path) {
    const res = await fetch(API_BASE + path, { method: 'DELETE' });
    if (!res.ok) throw new Error(`DELETE ${path} → ${res.status}`);
    return res.json();
  },

  // Convenience methods
  stations: {
    list: (wardId) => api.get('/stations' + (wardId ? `?ward_id=${wardId}` : '')),
    geojson: (wardId) => api.get('/stations/geojson' + (wardId ? `?ward_id=${wardId}` : '')),
    get: (id) => api.get(`/stations/${id}`),
    history: (id, hours = 24) => api.get(`/stations/${id}/history?hours=${hours}`),
    update: (id, body) => api.put(`/stations/${id}`, body),
    create: (body) => api.post('/stations', body),
    delete: (id) => api.del(`/stations/${id}`),
  },

  wards: {
    list: () => api.get('/wards'),
    geojson: () => api.get('/wards/geojson'),
  },

  dashboard: {
    summary: () => api.get('/dashboard/summary'),
    wardRanking: () => api.get('/dashboard/ward-ranking'),
    stationRanking: (limit = 5) => api.get(`/dashboard/station-ranking?limit=${limit}`),
    timeseries: (stationId, hours = 24) =>
      api.get('/dashboard/timeseries' + (stationId ? `?station_id=${stationId}&hours=${hours}` : `?hours=${hours}`)),
    alerts: () => api.get('/dashboard/alerts'),
  },

  interpolate: (wardId, method = 'idw') => api.post('/interpolate', {
    ward_id: wardId || null,
    method,
    resolution: 50,
    clip_to_ward: true,
    per_ward: true,
  }),
};

// ═══════════════════════════════════════════
// AQI helpers
// ═══════════════════════════════════════════
function aqiColor(aqi) {
  if (aqi <= 50) return '#00e400';
  if (aqi <= 100) return '#ffff00';
  if (aqi <= 150) return '#ff7e00';
  if (aqi <= 200) return '#ff0000';
  if (aqi <= 300) return '#8f3f97';
  return '#7e0023';
}
function aqiLabel(aqi) {
  if (aqi <= 50) return 'Tốt';
  if (aqi <= 100) return 'Trung bình';
  if (aqi <= 150) return 'Kém';
  if (aqi <= 200) return 'Xấu';
  if (aqi <= 300) return 'Rất xấu';
  return 'Nguy hiểm';
}
function aqiChip(aqi) {
  if (!aqi && aqi !== 0) return '<span style="color:#6b7394">–</span>';
  const c = aqiColor(aqi);
  const textColor = (aqi <= 100) ? '#000' : '#fff';
  return `<span class="aqi-chip" style="background:${c};color:${textColor}">${aqi} ${aqiLabel(aqi)}</span>`;
}

// ═══════════════════════════════════════════
// Toast notifications
// ═══════════════════════════════════════════
let toastTimer;
function showToast(msg, type = 'success') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast hidden'; }, 3500);
}

// ═══════════════════════════════════════════
// WebSocket — auto-reconnect
// ═══════════════════════════════════════════
const wsEvents = {};
function onWsEvent(event, handler) { wsEvents[event] = handler; }

function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws`);

  ws.onopen = () => {
    document.getElementById('live-badge').style.opacity = '1';
    // Heartbeat
    setInterval(() => { if (ws.readyState === 1) ws.send('ping'); }, 20000);
  };
  ws.onclose = () => {
    document.getElementById('live-badge').style.opacity = '0.3';
    setTimeout(connectWS, 3000);
  };
  ws.onmessage = ({ data }) => {
    try {
      const msg = JSON.parse(data);
      if (msg.event && wsEvents[msg.event]) wsEvents[msg.event](msg.data);
      // Generic refresh trigger
      if (msg.event && wsEvents['__any__']) wsEvents['__any__'](msg);
    } catch { }
  };
}
