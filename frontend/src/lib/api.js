// Small client for the Trusted Ocean API (same origin; Vite proxies /api in development).
async function get(path, params = {}) {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''));
  const res = await fetch(`/api/v1${path}${q.toString() ? `?${q}` : ''}`);
  if (!res.ok) {
    let msg = `${res.status}`;
    try { msg = (await res.json()).error || msg; } catch { /* ignore */ }
    throw new Error(`API ${path}: ${msg}`);
  }
  return res.json();
}

export const api = {
  health: () => get('/health'),
  stats: () => get('/stats'),
  sources: () => get('/sources'),
  devices: (p) => get('/devices', p),
  latest: (p) => get('/observations/latest', p),
  timeseries: (did, p) => get(`/devices/${encodeURIComponent(did)}/timeseries`, p),
  occurrences: (p) => get('/biodiversity/occurrences', p),
  taxa: (p) => get('/biodiversity/taxa', p),
  sites: (p) => get('/biodiversity/sites', p),
  site: (p) => get('/biodiversity/site', p),
  datasets: (p) => get('/biodiversity/datasets', p),
};
