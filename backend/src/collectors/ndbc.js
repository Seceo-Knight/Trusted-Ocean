'use strict';
// NOAA National Data Buoy Center: latest observation from every reporting station.
// Public domain (U.S. Government), no API key. Docs: https://www.ndbc.noaa.gov/faq/measdes.shtml
const crypto = require('crypto');
const config = require('../config');
const { buildEnvelope } = require('../lib/envelope');
const { qcFlag } = require('../lib/qc');

const SOURCE = {
  source_id: 'ndbc',
  source_name: 'NOAA National Data Buoy Center',
  source_url: 'https://www.ndbc.noaa.gov/',
  licence: 'Public domain (U.S. Government work)',
  attribution: 'Data: NOAA National Data Buoy Center',
};

// NDBC column -> CF standard name + UCUM unit (units as published by NDBC)
const FIELD_MAP = {
  WDIR: { name: 'wind_from_direction', unit: 'deg' },
  WSPD: { name: 'wind_speed', unit: 'm/s' },
  GST: { name: 'wind_speed_of_gust', unit: 'm/s' },
  WVHT: { name: 'sea_surface_wave_significant_height', unit: 'm' },
  DPD: { name: 'sea_surface_wave_period_at_variance_spectral_density_maximum', unit: 's' },
  APD: { name: 'sea_surface_wave_mean_period', unit: 's' },
  MWD: { name: 'sea_surface_wave_from_direction', unit: 'deg' },
  PRES: { name: 'air_pressure_at_mean_sea_level', unit: 'hPa' },
  ATMP: { name: 'air_temperature', unit: 'Cel' },
  WTMP: { name: 'sea_surface_temperature', unit: 'Cel' },
  DEWP: { name: 'dew_point_temperature', unit: 'Cel' },
  VIS: { name: 'visibility_in_air', unit: '[nmi_i]' },
};

const REQUIRED = ['STN', 'LAT', 'LON', 'YYYY', 'MM', 'DD', 'hh', 'mm'];

function parseLatestObs(text) {
  const lines = text.split(/\r?\n/);
  const header = lines.find((l) => l.startsWith('#'));
  if (!header) throw new Error('NDBC: header line not found (file format may have changed)');
  const cols = header.replace(/^#/, '').trim().split(/\s+/);
  const missing = REQUIRED.filter((c) => !cols.includes(c));
  if (missing.length) throw new Error(`NDBC: expected columns missing: ${missing.join(', ')}`);
  const at = Object.fromEntries(cols.map((c, i) => [c, i]));

  const rows = [];
  let skipped = 0;
  for (const line of lines) {
    if (!line.trim() || line.startsWith('#')) continue;
    const p = line.trim().split(/\s+/);
    if (p.length < cols.length) { skipped++; continue; }
    const lat = Number(p[at.LAT]);
    const lon = Number(p[at.LON]);
    const iso = `${p[at.YYYY]}-${p[at.MM]}-${p[at.DD]}T${p[at.hh]}:${p[at.mm]}:00Z`;
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Number.isNaN(Date.parse(iso))) { skipped++; continue; }

    const parameters = [];
    for (const [col, def] of Object.entries(FIELD_MAP)) {
      if (!(col in at)) continue;
      const raw = p[at[col]];
      if (raw === 'MM' || raw === undefined) continue; // MM = missing in NDBC files
      const value = Number(raw);
      if (!Number.isFinite(value)) continue;
      parameters.push({ name: def.name, value, unit: def.unit, qc_flag: qcFlag(def.name, value) });
    }
    if (!parameters.length) { skipped++; continue; }
    rows.push({ station: p[at.STN], lat, lon, observedAt: new Date(iso).toISOString(), parameters });
  }
  return { rows, skipped };
}

async function collect() {
  const res = await fetch(config.ndbc.url, {
    headers: { 'User-Agent': config.userAgent },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`NDBC: HTTP ${res.status} ${res.statusText}`);
  const rawText = await res.text();
  const rawSha256 = crypto.createHash('sha256').update(rawText).digest('hex');
  const { rows, skipped } = parseLatestObs(rawText);

  const provenance = { ...SOURCE, raw_sha256: rawSha256 };
  const envelopes = rows.map((r) => buildEnvelope({
    sourceId: 'ndbc',
    deviceId: r.station,
    site: `ndbc-${r.station.toLowerCase()}`,
    platform: 'buoy_or_coastal_station',
    observedAt: r.observedAt,
    lon: r.lon,
    lat: r.lat,
    depthM: 0,
    parameters: r.parameters,
    provenance,
  }));

  const summary = {
    source: SOURCE,
    fetched_at: new Date().toISOString(),
    stations: envelopes.length,
    observations: envelopes.reduce((n, e) => n + e.parameters.length, 0),
    flagged_bad: envelopes.reduce((n, e) => n + e.parameters.filter((x) => x.qc_flag === 4).length, 0),
    skipped_rows: skipped,
    raw_sha256: rawSha256,
  };
  return { rawText, rawSha256, envelopes, summary };
}

module.exports = { id: 'ndbc', name: SOURCE.source_name, info: SOURCE, collect, parseLatestObs };
