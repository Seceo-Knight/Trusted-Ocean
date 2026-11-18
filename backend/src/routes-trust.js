'use strict';
// Trust API: public keys, signed batch manifests and live verification.
const express = require('express');
const { pool } = require('./db');
const { verifyManifest } = require('./trust/manifest');
const { readDataFile } = require('./lib/storage');

const router = express.Router();
const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);
const intIn = (v, d, min, max) => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : d; };

// Public keys anyone can use to verify our signatures
router.get('/keys', wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT key_id, alg, public_key, created_at, retired_at FROM signing_keys ORDER BY created_at');
  res.json({ keys: rows.map((k) => ({ ...k, public_key: k.public_key.toString('base64') })) });
}));

// Summary for the dashboard
router.get('/summary', wrap(async (req, res) => {
  const { rows } = await pool.query(`
    SELECT count(*)::int AS batches,
           count(*) FILTER (WHERE batch_sig IS NOT NULL)::int AS signed,
           count(DISTINCT key_id)::int AS keys,
           max(fetched_at) FILTER (WHERE batch_sig IS NOT NULL) AS last_signed,
           min(fetched_at) FILTER (WHERE batch_sig IS NOT NULL) AS first_signed
    FROM batches`);
  res.json(rows[0]);
}));

// Recent batches with their signature details
router.get('/batches', wrap(async (req, res) => {
  const { source } = req.query;
  if (source !== undefined && !/^[a-z0-9_-]{1,32}$/.test(source)) return res.status(400).json({ error: 'invalid source' });
  const limit = intIn(req.query.limit, 50, 1, 500);
  const args = [limit];
  let where = '';
  if (source) { args.push(source); where = 'WHERE source_id = $2'; }
  const { rows } = await pool.query(
    `SELECT id, source_id, fetched_at, records, inserted, duplicates, raw_sha256, sig_alg, key_id, manifest_sha256,
            (batch_sig IS NOT NULL) AS signed
     FROM batches ${where} ORDER BY id DESC LIMIT $1`, args);
  res.json({ count: rows.length, batches: rows });
}));

// Full manifest, signature and a fresh verification of one batch
router.get('/batches/:id', wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id < 1) return res.status(400).json({ error: 'invalid batch id' });
  const { rows } = await pool.query(
    `SELECT b.id, b.source_id, b.fetched_at, b.records, b.manifest, b.manifest_sha256, b.batch_sig, b.key_id, b.files,
            k.public_key, k.alg
     FROM batches b LEFT JOIN signing_keys k ON k.key_id = b.key_id WHERE b.id = $1`, [id]);
  if (!rows.length) return res.status(404).json({ error: 'batch not found' });
  const b = rows[0];
  if (!b.batch_sig) return res.json({ id: b.id, source_id: b.source_id, signed: false, note: 'collected before signing was enabled' });
  if (!b.public_key) return res.json({ id: b.id, signed: true, verification: { verified: false, error: 'public key not found' } });
  const recordsText = b.files && b.files.records ? await readDataFile(b.files.records) : null;
  const verification = await verifyManifest(b.manifest, b.batch_sig, b.public_key, recordsText);
  res.json({
    id: b.id,
    source_id: b.source_id,
    signed: true,
    manifest: b.manifest,
    manifest_sha256: b.manifest_sha256,
    signature: b.batch_sig.toString('base64'),
    signature_bytes: b.batch_sig.length,
    public_key_id: b.key_id,
    verification,
    checked_at: new Date().toISOString(),
  });
}));

module.exports = router;
