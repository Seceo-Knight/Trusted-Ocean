'use strict';
// Database access: connection pool, schema migration and batch ingestion.
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const config = require('../config');

const pool = new Pool({
  host: config.db.host,
  port: config.db.port,
  database: config.db.name,
  user: config.db.user,
  password: config.db.password,
  max: 10,
  connectionTimeoutMillis: 10000,
});
pool.on('error', (err) => console.error('[db] idle client error:', err.message));

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
}

async function waitForDb(attempts = 15) {
  for (let i = 1; i <= attempts; i++) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (err) {
      if (i === attempts) throw new Error(`database not reachable at ${config.db.host}:${config.db.port} (${err.message}). Is it running? Try: npm run db:up`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

function chunks(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function insertObservations(client, rows, batchId) {
  let inserted = 0;
  for (const part of chunks(rows, 5000)) {
    const cols = { t: [], d: [], p: [], v: [], u: [], q: [], z: [], x: [], y: [], s: [], m: [] };
    for (const r of part) {
      cols.t.push(r.time); cols.d.push(r.device_did); cols.p.push(r.parameter); cols.v.push(r.value);
      cols.u.push(r.unit); cols.q.push(r.qc_flag); cols.z.push(r.depth_m); cols.x.push(r.lon); cols.y.push(r.lat);
      cols.s.push(r.source_id); cols.m.push(r.msg_id);
    }
    const res = await client.query(
      `INSERT INTO observations (time, device_did, parameter, value, unit, qc_flag, depth_m, lon, lat, source_id, batch_id, msg_id)
       SELECT t, d, p, v, u, q, z, x, y, s, $12, m
       FROM unnest($1::timestamptz[], $2::text[], $3::text[], $4::float8[], $5::text[], $6::int2[], $7::float4[],
                   $8::float8[], $9::float8[], $10::text[], $11::uuid[]) AS r(t, d, p, v, u, q, z, x, y, s, m)
       ON CONFLICT (device_did, parameter, time) DO NOTHING`,
      [cols.t, cols.d, cols.p, cols.v, cols.u, cols.q, cols.z, cols.x, cols.y, cols.s, cols.m, batchId],
    );
    inserted += res.rowCount;
  }
  return inserted;
}

async function upsertDevices(client, envelopes, sourceId, batchId) {
  const latest = new Map(); // one row per device: its newest position
  for (const e of envelopes) {
    const cur = latest.get(e.device_did);
    if (!cur || e.observed_at > cur.observed_at) latest.set(e.device_did, e);
  }
  for (const part of chunks([...latest.values()], 5000)) {
    await client.query(
      `INSERT INTO devices (did, source_id, site, platform, lon, lat, depth_m, last_observed, last_batch_id)
       SELECT d, $8, s, p, x, y, z, t, $9
       FROM unnest($1::text[], $2::text[], $3::text[], $4::float8[], $5::float8[], $6::float4[], $7::timestamptz[])
            AS r(d, s, p, x, y, z, t)
       ON CONFLICT (did) DO UPDATE SET
         site = EXCLUDED.site, platform = EXCLUDED.platform, last_batch_id = EXCLUDED.last_batch_id,
         lon = CASE WHEN EXCLUDED.last_observed >= COALESCE(devices.last_observed, '-infinity') THEN EXCLUDED.lon ELSE devices.lon END,
         lat = CASE WHEN EXCLUDED.last_observed >= COALESCE(devices.last_observed, '-infinity') THEN EXCLUDED.lat ELSE devices.lat END,
         depth_m = CASE WHEN EXCLUDED.last_observed >= COALESCE(devices.last_observed, '-infinity') THEN EXCLUDED.depth_m ELSE devices.depth_m END,
         last_observed = GREATEST(devices.last_observed, EXCLUDED.last_observed)`,
      [
        part.map((e) => e.device_did), part.map((e) => e.site), part.map((e) => e.platform),
        part.map((e) => e.position.coordinates[0]), part.map((e) => e.position.coordinates[1]),
        part.map((e) => e.position.depth_m), part.map((e) => e.observed_at), sourceId, batchId,
      ],
    );
  }
}

async function insertOccurrences(client, envelopes, batchId) {
  let inserted = 0;
  const F = ['time', 'occurrence_id', 'dataset_id', 'dataset_title', 'licence', 'lon', 'lat', 'depth_m', 'aphia_id',
    'scientific_name', 'rank', 'kingdom', 'phylum', 'class', 'order', 'family', 'genus', 'species', 'qc_flag', 'source_id'];
  const TYPES = ['timestamptz', 'text', 'text', 'text', 'text', 'float8', 'float8', 'float4', 'int4',
    'text', 'text', 'text', 'text', 'text', 'text', 'text', 'text', 'text', 'int2', 'text'];
  for (const part of chunks(envelopes, 5000)) {
    const cols = F.map(() => []);
    for (const e of part) {
      const t = e.taxon || {};
      const pr = e.provenance || {};
      const rank = t.rank ? String(t.rank).toLowerCase()
        : (['species', 'genus', 'family', 'order', 'class', 'phylum', 'kingdom'].find((k) => t[k]) || null);
      const vals = [e.observed_at, pr.occurrence_id, String(e.device_did).split(':').pop(), pr.dataset_title, pr.dataset_licence,
        e.position.coordinates[0], e.position.coordinates[1], e.position.depth_m, t.aphia_id,
        t.scientific_name, rank, t.kingdom, t.phylum, t.class, t.order, t.family, t.genus, t.species,
        e.parameters[0] ? e.parameters[0].qc_flag : 0, pr.source_id || 'obis'];
      vals.forEach((v, i) => cols[i].push(v === undefined ? null : v));
    }
    const res = await client.query(
      `INSERT INTO occurrences (${F.map((f) => (f === 'order' ? '"order"' : f)).join(', ')}, batch_id)
       SELECT r.*, $${F.length + 1}::bigint FROM unnest(${F.map((f, i) => `$${i + 1}::${TYPES[i]}[]`).join(', ')}) AS r
       ON CONFLICT (occurrence_id, time) DO NOTHING`,
      [...cols, batchId],
    );
    inserted += res.rowCount;
  }
  return inserted;
}

// Stores one collected batch in a single transaction (all or nothing).
async function registerKey(client, key) {
  await client.query(
    `INSERT INTO signing_keys (key_id, alg, public_key, created_at) VALUES ($1, $2, $3, $4) ON CONFLICT (key_id) DO NOTHING`,
    [key.key_id, key.alg, Buffer.from(key.public_key, 'base64'), key.created_at],
  );
}

async function ingestBatch(sourceId, info, batch, signed = null, files = null) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO sources (id, name, licence, attribution, url) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, licence = EXCLUDED.licence,
         attribution = EXCLUDED.attribution, url = EXCLUDED.url, updated_at = now()`,
      [sourceId, info.source_name, info.licence, info.attribution, info.source_url],
    );
    if (signed) {
      // publish our public key (only if it is the key that signed this manifest)
      const { publicKeyDoc, loadSigningKey } = require('../trust/pqc');
      const own = publicKeyDoc(await loadSigningKey());
      if (own.key_id === signed.manifest.key_id) await registerKey(client, own);
    }
    const { rows } = await client.query(
      `INSERT INTO batches (source_id, fetched_at, raw_sha256, records, summary, sig_alg, batch_sig, key_id, manifest, manifest_sha256, files)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
      [sourceId, batch.summary.fetched_at || new Date().toISOString(), batch.rawSha256, batch.envelopes.length, batch.summary,
        signed ? signed.manifest.sig_alg : null, signed ? signed.signature : null, signed ? signed.manifest.key_id : null,
        signed ? signed.manifest : null, signed ? signed.manifestSha256 : null, files],
    );
    const batchId = rows[0].id;

    let records = 0;
    let inserted = 0;
    if (sourceId === 'obis') {
      records = batch.envelopes.length;
      inserted = await insertOccurrences(client, batch.envelopes, batchId);
    } else {
      const flat = [];
      for (const e of batch.envelopes) {
        for (const p of e.parameters) {
          if (!Number.isFinite(p.value)) continue;
          flat.push({
            time: e.observed_at, device_did: e.device_did, parameter: p.name, value: p.value, unit: p.unit,
            qc_flag: p.qc_flag, depth_m: e.position.depth_m, lon: e.position.coordinates[0], lat: e.position.coordinates[1],
            source_id: sourceId, msg_id: e.msg_id,
          });
        }
      }
      records = flat.length;
      inserted = await insertObservations(client, flat, batchId);
      await upsertDevices(client, batch.envelopes, sourceId, batchId);
    }
    await client.query('UPDATE batches SET inserted = $2, duplicates = $3 WHERE id = $1', [batchId, inserted, records - inserted]);
    await client.query('COMMIT');
    return { batch_id: Number(batchId), records, inserted, duplicates: records - inserted };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, migrate, waitForDb, ingestBatch };
