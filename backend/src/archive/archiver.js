'use strict';
// Publishes signed batches (provider file, records, signed manifest) to the private IPFS node.
// If IPFS is unavailable the batch stays "pending archive" and is retried later, so data
// collection never stops because of the archive (Integration Reference, step 6).
const path = require('path');
const config = require('../config');
const { pool } = require('../db');
const { readDataFile } = require('../lib/storage');
const ipfs = require('./ipfs');

const state = { running: false, last_error: null, last_success: null, published: 0 };

async function publishBatch(batchId) {
  const { rows } = await pool.query('SELECT id, source_id, files, manifest_sha256, ipfs_cid FROM batches WHERE id = $1', [batchId]);
  if (!rows.length) throw new Error(`batch ${batchId} not found`);
  const b = rows[0];
  if (b.ipfs_cid) return { dir: b.ipfs_cid, skipped: true };
  if (!b.files || !b.files.records || !b.files.manifest) throw new Error(`batch ${batchId} has no signed files`);

  const files = [];
  const manifest = await readDataFile(b.files.manifest);
  const records = await readDataFile(b.files.records);
  if (manifest === null || records === null) throw new Error(`batch ${batchId}: signed files missing on disk`);
  files.push({ name: 'manifest.json', content: manifest });
  files.push({ name: 'records.ndjson', content: records });
  if (b.files.raw) {
    const raw = await readDataFile(b.files.raw);
    if (raw !== null) files.push({ name: `provider-original${path.extname(b.files.raw) || '.txt'}`, content: raw });
  }

  const added = await ipfs.addDirectory(files);
  const info = {
    dir: added.dir,
    manifest: added.files['manifest.json'],
    records: added.files['records.ndjson'],
    raw: Object.entries(added.files).find(([n]) => n.startsWith('provider-original'))?.[1] || null,
    published_at: new Date().toISOString(),
  };
  await pool.query('UPDATE batches SET ipfs_cid = $2, ipfs = $3 WHERE id = $1', [batchId, info.dir, info]);
  state.published++;
  return info;
}

// Publishes every signed batch that is not archived yet (oldest first).
async function archivePending(limit = 25) {
  if (!config.ipfs.enabled || state.running) return { skipped: true };
  state.running = true;
  let done = 0;
  try {
    const { rows } = await pool.query(
      `SELECT id FROM batches WHERE batch_sig IS NOT NULL AND ipfs_cid IS NULL AND files IS NOT NULL ORDER BY id LIMIT $1`, [limit]);
    for (const r of rows) {
      await publishBatch(r.id);
      done++;
    }
    state.last_error = null;
    if (done) state.last_success = new Date().toISOString();
    if (done) console.log(`[ipfs] archived ${done} pending batch(es)`);
  } catch (err) {
    state.last_error = err.message;
    console.error(`[ipfs] archive retry failed: ${err.message}`);
  } finally {
    state.running = false;
  }
  return { published: done };
}

function startArchiver() {
  if (!config.ipfs.enabled) { console.log('[ipfs] archive disabled'); return; }
  const every = config.ipfs.retryMinutes * 60 * 1000;
  setTimeout(() => archivePending().catch(() => {}), 15000).unref();
  setInterval(() => archivePending().catch(() => {}), every).unref();
  console.log(`[ipfs] archive retry every ${config.ipfs.retryMinutes} min`);
}

module.exports = { publishBatch, archivePending, startArchiver, state };
