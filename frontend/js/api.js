const API_BASE = '/api';
const AUTH_STORAGE_KEY = 'aqi-gv-auth';

let authState = {
  token: localStorage.getItem(AUTH_STORAGE_KEY) || '',
  role: '',
  username: '',
  userId: null,
};

function extractErrorMessage(payload, fallback) {
  if (!payload) return fallback;
  if (typeof payload === 'string') return payload;
  if (typeof payload.detail === 'string') return payload.detail;
  if (Array.isArray(payload.detail)) {
    return payload.detail.map((item) => item?.msg || JSON.stringify(item)).join('; ');
  }
  if (payload.detail?.message) return payload.detail.message;
  if (payload.message) return payload.message;
  return fallback;
}

function getAuthHeaders(extraHeaders = {}) {
  const headers = { ...extraHeaders };
  if (authState.token) headers.Authorization = `Bearer ${authState.token}`;
  return headers;
}

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: getAuthHeaders(options.headers || {}),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const message = extractErrorMessage(data, `${options.method || 'GET'} ${path} -> ${response.status}`);
    console.error('API request failed', {
      path,
      method: options.method || 'GET',
      status: response.status,
      payload: data,
      auth: Boolean(authState.token),
    });
    throw new Error(message);
  }
  return data;
}

function setAuth(auth) {
  authState = { ...authState, ...auth };
  if (authState.token) localStorage.setItem(AUTH_STORAGE_KEY, authState.token);
  else localStorage.removeItem(AUTH_STORAGE_KEY);
}

function clearAuth() {
  authState = { token: '', role: '', username: '', userId: null };
  localStorage.removeItem(AUTH_STORAGE_KEY);
}

function getAuth() {
  return { ...authState };
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

  upload(path, formData) {
    return request(path, {
      method: 'POST',
      body: formData,
    });
  },

  auth: {
    async login(username, password) {
      const result = await api.post('/auth/login', { username, password });
      setAuth({ token: result.access_token, role: result.role });
      try {
        const me = await api.get('/auth/me');
        setAuth({ username: me.username, userId: me.id, role: me.role });
      } catch (_) {
        setAuth({ username: username || 'admin', role: result.role });
      }
      return getAuth();
    },
    async hydrate() {
      if (!authState.token) return null;
      try {
        const me = await api.get('/auth/me');
        setAuth({ username: me.username, userId: me.id, role: me.role });
        return getAuth();
      } catch (_) {
        clearAuth();
        return null;
      }
    },
    logout() {
      clearAuth();
    },
  },

  stations: {
    list: (wardId) => api.get('/stations' + (wardId ? `?ward_id=${wardId}` : '')),
    geojson: (wardId) => api.get('/stations/geojson' + (wardId ? `?ward_id=${wardId}` : '')),
    get: (id) => api.get(`/stations/${id}`),
    detail: (id, hours = 72) => api.get(`/stations/detail/${id}?hours=${hours}`),
    history: (id, hours = 24) => api.get(`/stations/${id}/history?hours=${hours}`),
    update: (id, body) => api.put(`/stations/${id}`, body),
    create: (body) => api.post('/stations', body),
    delete: (id) => api.del(`/stations/${id}`),
    importFile: (formData) => api.upload('/stations/import', formData),
  },

  wards: {
    list: () => api.get('/wards'),
    geojson: () => api.get('/wards/geojson'),
  },

  dashboard: {
    summary: (wardId) => api.get('/dashboard/summary' + (wardId ? `?ward_id=${wardId}` : '')),
    wardRanking: (hours) => api.get('/dashboard/ward-ranking' + (hours ? `?hours=${hours}` : '')),
    stationRanking: (limit = 5, wardId) => api.get(`/dashboard/station-ranking?limit=${limit}${wardId ? `&ward_id=${wardId}` : ''}`),
    timeseries: ({ stationId, wardId, hours = 24, bucket = 'hour' } = {}) =>
      api.get(`/dashboard/timeseries?hours=${hours}&bucket=${bucket}${stationId ? `&station_id=${stationId}` : ''}${wardId ? `&ward_id=${wardId}` : ''}`),
    trends: (hours = 24, wardId) => api.get(`/dashboard/trends?hours=${hours}${wardId ? `&ward_id=${wardId}` : ''}`),
    alerts: (wardId) => api.get('/dashboard/alerts' + (wardId ? `?ward_id=${wardId}` : '')),
    thresholds: () => api.get('/dashboard/thresholds'),
    updateThresholds: (body) => api.put('/dashboard/thresholds', body),
    auditLogs: (limit = 30, entityType = '') => api.get(`/dashboard/audit-logs?limit=${limit}${entityType ? `&entity_type=${entityType}` : ''}`),
  },

  interpolate(payload) {
    return api.post('/interpolate', payload);
  },
};

function isAdmin() {
  return authState.role === 'admin';
}

function canManageData() {
  return ['admin', 'officer'].includes(authState.role);
}

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
  return 'Nguy hại';
}

function pollutantLabel(code) {
  if (code === 'pm25') return 'PM2.5';
  if (code === 'pm10') return 'PM10';
  return 'AQI';
}

function aqiChip(aqi) {
  if (!aqi && aqi !== 0) return '<span style="color:#6b7394">-</span>';
  const color = aqiColor(aqi);
  const textColor = aqi <= 100 ? '#000' : '#fff';
  return `<span class="aqi-chip" style="background:${color};color:${textColor}">${aqi} ${aqiLabel(aqi)}</span>`;
}

let toastTimer;
function showToast(message, type = 'success') {
  const el = document.getElementById('toast');
  if (!el) return;
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

function renderAuthUi() {
  const auth = getAuth();
  const status = document.getElementById('auth-status');
  const loginBtn = document.getElementById('login-btn');
  const logoutBtn = document.getElementById('logout-btn');
  const userInput = document.getElementById('login-username');
  const passInput = document.getElementById('login-password');
  const importButton = document.getElementById('btn-import');
  const saveThresholds = document.getElementById('btn-save-thresholds');
  const form = document.getElementById('reading-form');

  if (status) {
    status.textContent = auth.token
      ? `${auth.username} • quyền ${auth.role}`
      : 'Chưa đăng nhập • viewer chỉ được xem';
  }
  if (loginBtn) loginBtn.style.display = auth.token ? 'none' : 'inline-flex';
  if (logoutBtn) logoutBtn.style.display = auth.token ? 'inline-flex' : 'none';
  if (userInput) userInput.disabled = Boolean(auth.token);
  if (passInput) passInput.disabled = Boolean(auth.token);
  if (importButton) importButton.disabled = !canManageData();
  if (saveThresholds) saveThresholds.disabled = !isAdmin();
  if (form) {
    Array.from(form.elements).forEach((element) => {
      if (element.id !== 'station-select') element.disabled = !canManageData();
    });
  }
}

async function handleLogin() {
  const userInput = document.getElementById('login-username');
  const passInput = document.getElementById('login-password');
  const username = userInput?.value.trim() || '';
  const password = passInput?.value || '';

  try {
    await api.auth.login(username, password);
    renderAuthUi();
    showToast('Đăng nhập thành công');
    if (typeof refreshLiveViews === 'function') refreshLiveViews();
    if (typeof loadAlerts === 'function') loadAlerts();
  } catch (error) {
    console.error('Đăng nhập thất bại:', error);
    showToast(`Không đăng nhập được: ${error.message}`, 'error');
  }
}

function handleLogout() {
  api.auth.logout();
  renderAuthUi();
  showToast('Đã đăng xuất');
}

function bindAuthControls() {
  const loginForm = document.getElementById('login-form');
  const logoutBtn = document.getElementById('logout-btn');

  if (loginForm && !loginForm.dataset.authBound) {
    loginForm.dataset.authBound = 'true';
    loginForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      await handleLogin();
    });
  }

  if (logoutBtn && !logoutBtn.dataset.authBound) {
    logoutBtn.dataset.authBound = 'true';
    logoutBtn.addEventListener('click', handleLogout);
  }
}

function initAuthControls() {
  bindAuthControls();
  renderAuthUi();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAuthControls, { once: true });
} else {
  initAuthControls();
}
