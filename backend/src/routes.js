'use strict';
// Read-only API over the database. All inputs are validated; all SQL is parameterised.
const express = require('express');
const { pool } = require('./db');
const { listSources } = require('./collectors');

const router = express.Router();

const SOURCE_RE = /^[a-z0-9_-]{1,32}$/;
const PARAM_RE = /^[a-z0-9_]{1,80}$/;
const DID_RE = /^did:web:[A-Za-z0-9._:-]{1,200}$/;

function bad(res, msg) { return res.status(400).json({ error: msg }); }
function intIn(v, def, min, max) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : def;
}
function parseTime(v) {
  if (v === undefined) return undefined;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}
// bbox = lon_min,lat_min,lon_max,lat_max
function parseBbox(v) {
  if (v === undefined) return undefined;
  const p = String(v).split(',').map(Number);
  if (p.length !== 4 || p.some((x) => !Number.isFinite(x))) return null;
  const [x1, y1, x2, y2] = p;
  if (x1 < -180 || x2 > 180 || y1 < -90 || y2 > 90 || x1 > x2 || y1 > y2) return null;
  return p;
}
const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);

router.get('/health', wrap(async (req, res) => {
  let database = 'ok';
  try { await pool.query('SELECT 1'); } catch { database = 'unreachable'; }
  res.status(database === 'ok' ? 200 : 503).json({ status: database === 'ok' ? 'ok' : 'degraded', database, time: new Date().toISOString() });
}));

// Sources with collector status and database totals
router.get('/sources', wrap(async (req, res) => {
  const { rows } = await pool.query(`
    SELECT s.id, max(b.fetched_at) AS last_batch_at, count(b.id)::int AS batches, coalesce(sum(b.inserted), 0)::bigint AS rows_stored
    FROM sources s LEFT JOIN batches b ON b.source_id = s.id GROUP BY s.id`);
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  res.json({ sources: listSources().map((s) => ({ ...s, database: byId[s.id] || null })) });
}));

// Platform summary for dashboards
router.get('/stats', wrap(async (req, res) => {
  const [dev, obs, occ] = await Promise.all([
    pool.query(`SELECT source_id, platform, count(*)::int AS devices,
                       count(*) FILTER (WHERE last_observed > now() - interval '24 hours')::int AS active_24h
                FROM devices GROUP BY source_id, platform ORDER BY source_id, platform`),
    pool.query(`SELECT source_id, count(*)::bigint AS rows, max(time) AS newest FROM observations GROUP BY source_id`),
    pool.query(`SELECT count(*)::bigint AS rows, count(DISTINCT aphia_id)::int AS taxa, count(DISTINCT dataset_id)::int AS datasets,
                       min(time) AS oldest, max(time) AS newest FROM occurrences`),
  ]);
  res.json({ devices: dev.rows, observations: obs.rows, biodiversity: occ.rows[0] });
}));

// Devices for the map, e.g. /devices?source=ndbc&bbox=60,0,100,30&active_hours=24
router.get('/devices', wrap(async (req, res) => {
  const { source } = req.query;
  if (source !== undefined && !SOURCE_RE.test(source)) return bad(res, 'invalid source');
  const bbox = parseBbox(req.query.bbox);
  if (bbox === null) return bad(res, 'invalid bbox, expected lon_min,lat_min,lon_max,lat_max');
  const activeHours = intIn(req.query.active_hours, 72, 1, 24 * 60);
  const limit = intIn(req.query.limit, 5000, 1, 20000);
  const where = ['last_observed > now() - make_interval(hours => $1)'];
  const args = [activeHours];
  if (source) { args.push(source); where.push(`source_id = $${args.length}`); }
  if (bbox) {
    args.push(bbox[0], bbox[2], bbox[1], bbox[3]);
    where.push(`lon BETWEEN $${args.length - 3} AND $${args.length - 2} AND lat BETWEEN $${args.length - 1} AND $${args.length}`);
  }
  args.push(limit);
  const { rows } = await pool.query(
    `SELECT did, source_id, site, platform, lon, lat, depth_m, last_observed FROM devices
     WHERE ${where.join(' AND ')} ORDER BY last_observed DESC LIMIT $${args.length}`, args);
  res.json({ count: rows.length, devices: rows });
}));

// Latest value of every parameter for each device, e.g. /observations/latest?parameter=sea_surface_temperature
router.get('/observations/latest', wrap(async (req, res) => {
  const { source, parameter } = req.query;
  if (source !== undefined && !SOURCE_RE.test(source)) return bad(res, 'invalid source');
  if (parameter !== undefined && !PARAM_RE.test(parameter)) return bad(res, 'invalid parameter');
  const bbox = parseBbox(req.query.bbox);
  if (bbox === null) return bad(res, 'invalid bbox');
  const hours = intIn(req.query.hours, 48, 1, 24 * 30);
  const goodOnly = req.query.good_only !== 'false';
  const limit = intIn(req.query.limit, 5000, 1, 50000);
  const where = ['time > now() - make_interval(hours => $1)'];
  const args = [hours];
  if (source) { args.push(source); where.push(`source_id = $${args.length}`); }
  if (parameter) { args.push(parameter); where.push(`parameter = $${args.length}`); }
  if (goodOnly) where.push('qc_flag <> 4');
  if (bbox) {
    args.push(bbox[0], bbox[2], bbox[1], bbox[3]);
    where.push(`lon BETWEEN $${args.length - 3} AND $${args.length - 2} AND lat BETWEEN $${args.length - 1} AND $${args.length}`);
  }
  args.push(limit);
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (device_did, parameter) device_did, source_id, parameter, value, unit, qc_flag, time, lon, lat, depth_m
     FROM observations WHERE ${where.join(' AND ')}
     ORDER BY device_did, parameter, time DESC LIMIT $${args.length}`, args);
  res.json({ count: rows.length, observations: rows });
}));

// Time series for one device, e.g. /devices/did:web:.../timeseries?parameter=sea_surface_temperature&from=2026-11-01
router.get('/devices/:did/timeseries', wrap(async (req, res) => {
  const { did } = req.params;
  const { parameter } = req.query;
  if (!DID_RE.test(did)) return bad(res, 'invalid device id');
  if (parameter !== undefined && !PARAM_RE.test(parameter)) return bad(res, 'invalid parameter');
  const from = parseTime(req.query.from);
  const to = parseTime(req.query.to);
  if (from === null || to === null) return bad(res, 'invalid from/to time');
  const limit = intIn(req.query.limit, 5000, 1, 100000);
  const args = [did, from || new Date(Date.now() - 30 * 86400000).toISOString(), to || new Date().toISOString()];
  let extra = '';
  if (parameter) { args.push(parameter); extra = ` AND parameter = $${args.length}`; }
  args.push(limit);
  const { rows } = await pool.query(
    `SELECT time, parameter, value, unit, qc_flag, depth_m FROM observations
     WHERE device_did = $1 AND time BETWEEN $2 AND $3${extra}
     ORDER BY time DESC LIMIT $${args.length}`, args);
  res.json({ device: did, count: rows.length, points: rows });
}));

// Biodiversity records, e.g. /biodiversity/occurrences?bbox=60,0,100,30&aphia_id=104467
router.get('/biodiversity/occurrences', wrap(async (req, res) => {
  const bbox = parseBbox(req.query.bbox);
  if (bbox === null) return bad(res, 'invalid bbox');
  const from = parseTime(req.query.from);
  const to = parseTime(req.query.to);
  if (from === null || to === null) return bad(res, 'invalid from/to time');
  const aphia = req.query.aphia_id !== undefined ? parseInt(req.query.aphia_id, 10) : undefined;
  if (aphia !== undefined && !Number.isFinite(aphia)) return bad(res, 'invalid aphia_id');
  const limit = intIn(req.query.limit, 1000, 1, 20000);
  const where = ['qc_flag <> 4'];
  const args = [];
  if (bbox) {
    args.push(bbox[0], bbox[2], bbox[1], bbox[3]);
    where.push(`lon BETWEEN $1 AND $2 AND lat BETWEEN $3 AND $4`);
  }
  if (from) { args.push(from); where.push(`time >= $${args.length}`); }
  if (to) { args.push(to); where.push(`time <= $${args.length}`); }
  if (aphia !== undefined) { args.push(aphia); where.push(`aphia_id = $${args.length}`); }
  args.push(limit);
  const { rows } = await pool.query(
    `SELECT time, occurrence_id, scientific_name, aphia_id, rank, kingdom, phylum, class, family, genus, species,
            lon, lat, depth_m, dataset_id, dataset_title, licence
     FROM occurrences WHERE ${where.join(' AND ')} ORDER BY time DESC LIMIT $${args.length}`, args);
  res.json({ count: rows.length, occurrences: rows });
}));

// One row per sampling site (records grouped by position), for the biodiversity map.
// Scales to millions of records because the grouping happens in the database.
router.get('/biodiversity/sites', wrap(async (req, res) => {
  const bbox = parseBbox(req.query.bbox);
  if (bbox === null) return bad(res, 'invalid bbox');
  const aphia = req.query.aphia_id !== undefined ? parseInt(req.query.aphia_id, 10) : undefined;
  if (aphia !== undefined && !Number.isFinite(aphia)) return bad(res, 'invalid aphia_id');
  const limit = intIn(req.query.limit, 20000, 1, 100000);
  const where = ['qc_flag <> 4'];
  const args = [];
  if (bbox) { args.push(bbox[0], bbox[2], bbox[1], bbox[3]); where.push('lon BETWEEN $1 AND $2 AND lat BETWEEN $3 AND $4'); }
  if (aphia !== undefined) { args.push(aphia); where.push(`aphia_id = $${args.length}`); }
  args.push(limit);
  const { rows } = await pool.query(
    `SELECT round(lon::numeric, 3)::float8 AS lon, round(lat::numeric, 3)::float8 AS lat,
            count(*)::int AS records,
            count(DISTINCT aphia_id) FILTER (WHERE aphia_id <> 12)::int AS taxa,
            min(time) AS first, max(time) AS last,
            array_agg(DISTINCT dataset_title) AS datasets
     FROM occurrences WHERE ${where.join(' AND ')}
     GROUP BY 1, 2 ORDER BY records DESC LIMIT $${args.length}`, args);
  res.json({ count: rows.length, sites: rows });
}));

// Taxa found at one sampling site, e.g. /biodiversity/site?lon=54.228&lat=12.411
router.get('/biodiversity/site', wrap(async (req, res) => {
  const lon = Number(req.query.lon);
  const lat = Number(req.query.lat);
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lon) > 180 || Math.abs(lat) > 90) return bad(res, 'invalid lon/lat');
  const { rows } = await pool.query(
    `SELECT aphia_id, min(scientific_name) AS scientific_name, min(rank) AS rank, min(kingdom) AS kingdom,
            min(phylum) AS phylum, count(*)::int AS records, min(time) AS first, max(time) AS last
     FROM occurrences
     WHERE qc_flag <> 4 AND aphia_id IS NOT NULL AND aphia_id <> 12
       AND lon BETWEEN $1 - 0.0006 AND $1 + 0.0006 AND lat BETWEEN $2 - 0.0006 AND $2 + 0.0006
       AND round(lon::numeric, 3) = round($1::numeric, 3) AND round(lat::numeric, 3) = round($2::numeric, 3)
     GROUP BY aphia_id ORDER BY records DESC LIMIT 500`, [lon, lat]);
  res.json({ count: rows.length, taxa: rows });
}));

// Datasets contributing records in an area (for crediting the publishers)
router.get('/biodiversity/datasets', wrap(async (req, res) => {
  const bbox = parseBbox(req.query.bbox);
  if (bbox === null) return bad(res, 'invalid bbox');
  const args = [];
  let where = 'qc_flag <> 4';
  if (bbox) { args.push(bbox[0], bbox[2], bbox[1], bbox[3]); where += ' AND lon BETWEEN $1 AND $2 AND lat BETWEEN $3 AND $4'; }
  const { rows } = await pool.query(
    `SELECT dataset_id, min(dataset_title) AS title, min(licence) AS licence, count(*)::int AS records,
            min(time) AS first, max(time) AS last
     FROM occurrences WHERE ${where} GROUP BY dataset_id ORDER BY records DESC LIMIT 500`, args);
  res.json({ count: rows.length, datasets: rows });
}));

// Most frequently detected taxa in an area
router.get('/biodiversity/taxa', wrap(async (req, res) => {
  const bbox = parseBbox(req.query.bbox);
  if (bbox === null) return bad(res, 'invalid bbox');
  const limit = intIn(req.query.limit, 100, 1, 2000);
  const args = [];
  // AphiaID 12 = "Biota incertae sedis" (classification unknown): not a real taxon, hidden from rankings
  let where = 'qc_flag <> 4 AND aphia_id IS NOT NULL AND aphia_id <> 12';
  if (bbox) { args.push(bbox[0], bbox[2], bbox[1], bbox[3]); where += ' AND lon BETWEEN $1 AND $2 AND lat BETWEEN $3 AND $4'; }
  args.push(limit);
  const { rows } = await pool.query(
    `SELECT aphia_id, min(scientific_name) AS scientific_name, min(rank) AS rank, min(kingdom) AS kingdom,
            min(phylum) AS phylum, count(*)::int AS records, count(DISTINCT dataset_id)::int AS datasets, max(time) AS last_seen
     FROM occurrences WHERE ${where} GROUP BY aphia_id ORDER BY records DESC LIMIT $${args.length}`, args);
  res.json({ count: rows.length, taxa: rows });
}));

module.exports = router;
