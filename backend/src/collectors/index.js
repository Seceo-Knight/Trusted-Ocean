'use strict';
// Registry and scheduler for all data collectors.
const config = require('../config');
const { saveBatch } = require('../lib/storage');
const db = require('../db');
const { signBatch } = require('../trust/manifest');
const ndbc = require('./ndbc');
const argo = require('./argo');
const copernicus = require('./copernicus');
const obis = require('./obis');

const collectors = [
  { collector: ndbc, settings: config.ndbc },
  { collector: argo, settings: config.argo },
  { collector: copernicus, settings: config.copernicus },
  { collector: obis, settings: config.obis },
];

const status = {};

// Applies to every source: drop records with an impossible observation time
// (device clock errors). Future = more than 1 hour ahead; stale = older than maxAgeDays.
function timeGuard(batch, maxAgeDays = 30) {
  const now = Date.now();
  const max = now + 60 * 60 * 1000;
  const min = now - maxAgeDays * 24 * 60 * 60 * 1000;
  const kept = [];
  let rejected = 0;
  for (const e of batch.envelopes) {
    const t = Date.parse(e.observed_at);
    if (Number.isFinite(t) && t <= max && t >= min) kept.push(e);
    else rejected++;
  }
  if (rejected) {
    batch.envelopes = kept;
    batch.summary.stations = kept.length;
    batch.summary.observations = kept.reduce((n, e) => n + e.parameters.length, 0);
    batch.summary.flagged_bad = kept.reduce((n, e) => n + e.parameters.filter((x) => x.qc_flag === 4).length, 0);
  }
  batch.summary.rejected_bad_time = rejected;
  return batch;
} // id -> { last_run, last_success, last_error, stations, observations, running }

async function runOnce(id) {
  const entry = collectors.find((c) => c.collector.id === id);
  if (!entry) throw new Error(`Unknown collector: ${id}`);
  const st = (status[id] ||= { running: false });
  if (st.running) return { skipped: 'already running' };
  st.running = true;
  st.last_run = new Date().toISOString();
  try {
    const batch = timeGuard(await entry.collector.collect(), entry.settings.maxAgeDays || 30);
    const signed = await signBatch(id, entry.collector.info, batch); // ML-DSA-65 signed manifest
    const files = await saveBatch(id, batch, signed); // raw + records + manifest files
    const stored = await db.ingestBatch(id, entry.collector.info, batch, signed, files);
    batch.summary.signature = { alg: signed.manifest.sig_alg, key_id: signed.manifest.key_id, manifest_sha256: signed.manifestSha256 };
    batch.summary.database = stored;
    Object.assign(st, {
      last_success: st.last_run,
      last_error: null,
      stations: batch.summary.stations,
      observations: batch.summary.observations,
      database: stored,
    });
    console.log(`[${id}] ok: ${batch.summary.stations} stations, ${batch.summary.observations} values, db +${stored.inserted} new / ${stored.duplicates} already stored, signed ${signed.manifest.sig_alg} ${signed.manifestSha256.slice(0, 12)}`);
    return batch.summary;
  } catch (err) {
    st.last_error = err.message;
    console.error(`[${id}] failed: ${err.message}`);
    throw err;
  } finally {
    st.running = false;
  }
}

function startScheduler() {
  for (const { collector, settings } of collectors) {
    if (!settings.enabled) continue;
    const every = settings.intervalMinutes * 60 * 1000;
    runOnce(collector.id).catch(() => {});
    setInterval(() => runOnce(collector.id).catch(() => {}), every).unref();
    console.log(`[${collector.id}] scheduled every ${settings.intervalMinutes} min`);
  }
}

function listSources() {
  return collectors.map(({ collector, settings }) => ({
    id: collector.id,
    name: collector.name,
    licence: collector.info.licence,
    attribution: collector.info.attribution,
    enabled: settings.enabled,
    interval_minutes: settings.intervalMinutes,
    status: status[collector.id] || null,
  }));
}

module.exports = { runOnce, startScheduler, listSources };
