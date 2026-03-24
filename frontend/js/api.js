const API_BASE = '/api';

function extractErrorMessage(payload, fallback) {
  if (!payload) return fallback;
  if (typeof payload === 'string') return payload;

  if (typeof payload.detail === 'string') return payload.detail;
  if (Array.isArray(payload.detail)) {
    return payload.detail
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item?.msg && Array.isArray(item?.loc)) return `${item.loc.join('.')} - ${item.msg}`;
        if (item?.msg) return item.msg;
        return JSON.stringify(item);
      })
      .join('; ');
  }

  if (payload.detail && typeof payload.detail === 'object') {
    if (payload.detail.message) return payload.detail.message;
    return JSON.stringify(payload.detail);
  }

  if (payload.message) return payload.message;
  return fallback;
}

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, options);
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const message = extractErrorMessage(data, `${options.method || 'GET'} ${path} -> ${response.status}`);
    throw new Error(message);
  }

  return data;
}

const api = {
  get(path) {
    return request(path);
  },

  post(path, body) {
    return request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  },

  put(path, body) {
    return request(path, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  },

  del(path) {
    return request(path, { method: 'DELETE' });
  },

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

  interpolate(payload) {
    return api.post('/interpolate', payload);
  },
};

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
  const color = aqiColor(aqi);
  const textColor = aqi <= 100 ? '#000' : '#fff';
  return `<span class="aqi-chip" style="background:${color};color:${textColor}">${aqi} ${aqiLabel(aqi)}</span>`;
}

let toastTimer;
function showToast(message, type = 'success') {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.className = `toast ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.className = 'toast hidden';
  }, 3500);
}

const wsEvents = {};
function onWsEvent(event, handler) {
  wsEvents[event] = handler;
}

function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws`);

  let heartbeat = null;

  ws.onopen = () => {
    document.getElementById('live-badge').style.opacity = '1';
    heartbeat = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send('ping');
    }, 20000);
  };

  ws.onclose = () => {
    if (heartbeat) clearInterval(heartbeat);
    document.getElementById('live-badge').style.opacity = '0.3';
    setTimeout(connectWS, 3000);
  };

  ws.onmessage = ({ data }) => {
    try {
      const message = JSON.parse(data);
      if (message.event && wsEvents[message.event]) wsEvents[message.event](message.data);
      if (message.event && wsEvents.__any__) wsEvents.__any__(message);
    } catch (_) {
      // Ignore malformed messages.
    }
  };
}
