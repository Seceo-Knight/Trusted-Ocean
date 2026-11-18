'use strict';
// Argo profiling floats: about 4,000 robotic floats that dive to 2,000 m and report
// temperature and salinity. We take the near-surface measurement of every profile
// received in the last few days. Source: Ifremer ERDDAP (Argo GDAC), no key needed.
const config = require('../config');
const { fetchTable } = require('../lib/erddap');
const { buildEnvelope } = require('../lib/envelope');
const { qcFlag } = require('../lib/qc');

const SOURCE = {
  source_id: 'argo',
  source_name: 'International Argo Program (via Ifremer ERDDAP)',
  source_url: 'https://argo.ucsd.edu/',
  licence: 'Free and open, citation required (Argo data policy)',
  attribution: 'These data were collected and made freely available by the International Argo Program and the national programs that contribute to it (https://argo.ucsd.edu, https://www.ocean-ops.org). Argo data DOI: 10.17882/42182',
};

const VARIABLES = [
  'platform_number', 'cycle_number', 'data_mode', 'time', 'latitude', 'longitude', 'position_qc',
  'pres', 'pres_qc', 'temp', 'temp_qc', 'psal', 'psal_qc',
  'pres_adjusted', 'pres_adjusted_qc', 'temp_adjusted', 'temp_adjusted_qc', 'psal_adjusted', 'psal_adjusted_qc',
];

const num = (v) => (v === null || v === undefined || v === '' ? NaN : Number(v));
const flag = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : 0; };

// Argo rule: use *_adjusted values when data_mode is A (adjusted) or D (delayed), else raw values.
function pick(row, base) {
  const adjusted = row.data_mode === 'A' || row.data_mode === 'D';
  const v = num(row[adjusted ? `${base}_adjusted` : base]);
  const f = flag(row[adjusted ? `${base}_adjusted_qc` : `${base}_qc`]);
  return { value: v, argoQc: f };
}

// Argo QC flags: 1 good, 2 probably good, 3 probably bad, 4 bad. 0 = not checked.
function combinedQc(name, value, argoQc) {
  const ours = qcFlag(name, value);
  if (ours === 4 || argoQc === 3 || argoQc === 4) return 4;
  if (argoQc === 1 || argoQc === 2) return 1;
  return ours;
}

function rowsToEnvelopes(rows, provenance) {
  // keep the shallowest level of each profile (platform + cycle)
  const best = new Map();
  for (const r of rows) {
    const lat = num(r.latitude), lon = num(r.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !r.time) continue;
    if (flag(r.position_qc) === 3 || flag(r.position_qc) === 4) continue;
    const pres = pick(r, 'pres');
    if (!Number.isFinite(pres.value) || pres.argoQc === 3 || pres.argoQc === 4) continue;
    const key = `${String(r.platform_number).trim()}_${r.cycle_number}`;
    const cur = best.get(key);
    if (!cur || pres.value < cur.pres) best.set(key, { row: r, pres: pres.value, lat, lon });
  }

  const envelopes = [];
  for (const { row, pres, lat, lon } of best.values()) {
    const parameters = [{ name: 'sea_water_pressure', value: pres, unit: 'dbar', qc_flag: 1 }];
    const t = pick(row, 'temp');
    if (Number.isFinite(t.value)) parameters.push({ name: 'sea_water_temperature', value: t.value, unit: 'Cel', qc_flag: combinedQc('sea_water_temperature', t.value, t.argoQc) });
    const s = pick(row, 'psal');
    if (Number.isFinite(s.value)) parameters.push({ name: 'sea_water_practical_salinity', value: s.value, unit: '1', qc_flag: combinedQc('sea_water_practical_salinity', s.value, s.argoQc) });
    if (parameters.length < 2) continue;
    const platform = String(row.platform_number).trim();
    envelopes.push(buildEnvelope({
      sourceId: 'argo',
      deviceId: platform,
      site: `argo-${platform}`,
      platform: 'profiling_float',
      observedAt: new Date(row.time).toISOString(),
      lon, lat,
      depthM: Math.round(pres * 10) / 10, // 1 dbar is about 1 m near the surface
      parameters: parameters.concat([{ name: 'argo_cycle_number', value: Number(row.cycle_number), unit: '1', qc_flag: 0 }]),
      provenance,
    }));
  }
  return envelopes;
}

async function collect() {
  const s = config.argo;
  const { rawText, rawSha256, rows, url } = await fetchTable({
    server: s.erddapServer,
    datasetId: 'ArgoFloats',
    variables: VARIABLES,
    constraints: [`time>=now-${s.lookbackDays}days`, `pres<=${s.maxPressureDbar}`],
  });
  const provenance = { ...SOURCE, request_url: url, raw_sha256: rawSha256 };
  const envelopes = rowsToEnvelopes(rows, provenance);
  const summary = {
    source: SOURCE,
    fetched_at: new Date().toISOString(),
    stations: envelopes.length,
    observations: envelopes.reduce((n, e) => n + e.parameters.length, 0),
    flagged_bad: envelopes.reduce((n, e) => n + e.parameters.filter((x) => x.qc_flag === 4).length, 0),
    rows_received: rows.length, // several depth levels per float; we keep the shallowest
    raw_sha256: rawSha256,
  };
  return { rawText, rawSha256, envelopes, summary };
}

module.exports = { id: 'argo', name: SOURCE.source_name, info: SOURCE, collect, rowsToEnvelopes };
