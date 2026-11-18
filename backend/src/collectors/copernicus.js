'use strict';
// Copernicus Marine In Situ near-real-time observations (moorings, drifting buoys, tide gauges,
// gliders, ferryboxes, sail drones). Runs python/copernicus_insitu.py with the official toolbox.
// Licence: Copernicus Marine licence, free incl. commercial use, credit required.
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { buildEnvelope } = require('../lib/envelope');
const { qcFlag } = require('../lib/qc');

const SOURCE = {
  source_id: 'copernicus',
  source_name: 'Copernicus Marine Service - In Situ NRT observations (INSITU_GLO_PHYBGCWAV_DISCRETE_MYNRT_013_030)',
  source_url: 'https://data.marine.copernicus.eu/product/INSITU_GLO_PHYBGCWAV_DISCRETE_MYNRT_013_030',
  licence: 'Copernicus Marine Service licence (free, commercial use allowed, attribution required)',
  attribution: 'Generated using E.U. Copernicus Marine Service Information; https://doi.org/10.48670/moi-00036',
};

const PLATFORM_TYPES = {
  MO: 'mooring', DB: 'drifting_buoy', TG: 'tide_gauge', GL: 'glider', SD: 'surface_drone', FB: 'ferrybox',
};

function runPython(args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const py = config.copernicus.python;
    if (!fs.existsSync(py)) {
      return reject(new Error(`Python environment not found at ${py}. Run the Copernicus setup step first.`));
    }
    const child = spawn(py, [path.join(__dirname, '..', '..', 'python', 'copernicus_insitu.py'), ...args], {
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
    });
    let out = '';
    let errTail = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => {
      const s = d.toString();
      errTail = (errTail + s).slice(-2000);
      s.split('\n').filter((l) => l.startsWith('[copernicus]')).forEach((l) => console.log(l));
    });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (code !== 0) {
        const hint = /credential|login|401|unauthori/i.test(errTail) ? ' (credentials missing or wrong: run "copernicusmarine login")' : '';
        return reject(new Error(`Copernicus worker failed${signal ? ` (${signal})` : ''}${hint}: ${errTail.trim().split('\n').slice(-3).join(' | ')}`));
      }
      resolve(out);
    });
  });
}

function toEnvelope(rec, base) {
  const parameters = rec.parameters.map((p) => {
    const ours = qcFlag(p.name, p.value);
    const qc = ours === 4 ? 4 : (p.provider_qc === 1 || p.provider_qc === 2 ? 1 : ours);
    return { name: p.name, value: p.value, unit: p.unit, qc_flag: qc };
  });
  return buildEnvelope({
    sourceId: 'copernicus',
    deviceId: rec.platform_code,
    site: `cmems-${String(rec.platform_code).toLowerCase()}`,
    platform: PLATFORM_TYPES[rec.platform_type] || rec.platform_type.toLowerCase(),
    observedAt: new Date(rec.time).toISOString(),
    lon: rec.lon,
    lat: rec.lat,
    depthM: rec.depth_m,
    parameters,
    provenance: {
      ...base,
      file_name: rec.file_name,
      file_sha256: rec.file_sha256,
      data_provider: rec.institution || rec.provider || null,
    },
  });
}

async function collect() {
  const s = config.copernicus;
  const args = [
    '--work-dir', path.join(config.dataDir, 'copernicus', 'work'),
    '--dataset-id', s.datasetId,
    '--hours', String(s.lookbackHours),
    '--types', s.platformTypes,
    '--max-files', String(s.maxFiles),
  ];
  if (s.bbox) args.push('--bbox', s.bbox);
  const rawText = await runPython(args, 15 * 60 * 1000);
  const result = JSON.parse(rawText);
  const rawSha256 = crypto.createHash('sha256').update(rawText).digest('hex');
  const base = { ...SOURCE, dataset_id: result.dataset_id, index_sha256: result.index_sha256, raw_sha256: rawSha256 };
  const envelopes = result.records.map((r) => toEnvelope(r, base));
  const summary = {
    source: SOURCE,
    fetched_at: new Date().toISOString(),
    stations: envelopes.length,
    observations: envelopes.reduce((n, e) => n + e.parameters.length, 0),
    flagged_bad: envelopes.reduce((n, e) => n + e.parameters.filter((x) => x.qc_flag === 4).length, 0),
    files_selected: result.files_selected,
    files_skipped: result.skipped,
    raw_sha256: rawSha256,
  };
  return { rawText, rawSha256, envelopes, summary };
}

module.exports = { id: 'copernicus', name: 'Copernicus Marine In Situ', info: SOURCE, collect, toEnvelope };
