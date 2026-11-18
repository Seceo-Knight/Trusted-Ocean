'use strict';
// Trust API: public keys, signed batch manifests and live verification.
const express = require('express');
const { pool } = require('./db');
const { verifyManifest } = require('./trust/manifest');
const { readDataFile } = require('./lib/storage');
const config = require('./config');
const ipfs = require('./archive/ipfs');
const archiver = require('./archive/archiver');
const { sha256 } = require('./trust/manifest');
const chain = require('./chain/anchor');

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
           min(fetched_at) FILTER (WHERE batch_sig IS NOT NULL) AS first_signed,
           count(*) FILTER (WHERE ipfs_cid IS NOT NULL)::int AS archived,
           count(*) FILTER (WHERE batch_sig IS NOT NULL AND ipfs_cid IS NULL)::int AS pending_archive,
           count(*) FILTER (WHERE anchor_tx IS NOT NULL)::int AS anchored,
           count(*) FILTER (WHERE ipfs_cid IS NOT NULL AND anchor_tx IS NULL)::int AS pending_anchor
    FROM batches`);
  let node = null;
  if (config.ipfs.enabled) {
    try { const n = await ipfs.id(); node = { online: true, peer_id: n.ID, agent: n.AgentVersion }; } catch (e) { node = { online: false, error: e.message }; }
  }
  res.json({ ...rows[0], ipfs: { enabled: config.ipfs.enabled, gateway_url: config.ipfs.gatewayUrl, node, archiver: archiver.state }, chain: await chain.status() });
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
            (batch_sig IS NOT NULL) AS signed, ipfs_cid, anchor_tx, anchor->>'block_number' AS anchor_block
     FROM batches ${where} ORDER BY id DESC LIMIT $1`, args);
  res.json({ count: rows.length, batches: rows });
}));

// Full proof of one batch, freshly verified: ML-DSA signature, records fingerprint,
// IPFS archive copy and blockchain anchor.
async function proofForBatch(id) {
  const { rows } = await pool.query(
    `SELECT b.id, b.source_id, b.fetched_at, b.records, b.manifest, b.manifest_sha256, b.batch_sig, b.key_id, b.files, b.ipfs, b.anchor,
            k.public_key, k.alg
     FROM batches b LEFT JOIN signing_keys k ON k.key_id = b.key_id WHERE b.id = $1`, [id]);
  if (!rows.length) return null;
  const b = rows[0];
  if (!b.batch_sig) return { id: b.id, source_id: b.source_id, signed: false, note: 'collected before signing was enabled' };
  if (!b.public_key) return { id: b.id, signed: true, verification: { verified: false, error: 'public key not found' } };
  let recordsText = b.files && b.files.records ? await readDataFile(b.files.records) : null;

  // independent check of the IPFS archive copy: fetch it by CID and compare its fingerprint
  let archive = { archived: !!(b.ipfs && b.ipfs.dir) };
  if (archive.archived) {
    archive = { ...archive, dir_cid: b.ipfs.dir, records_cid: b.ipfs.records, published_at: b.ipfs.published_at };
    try {
      const fromIpfs = await ipfs.cat(b.ipfs.records);
      archive.records_match = sha256(fromIpfs) === b.manifest.envelopes_sha256;
      if (recordsText === null) recordsText = fromIpfs; // local file gone: verify from the archive
    } catch (e) {
      archive.error = e.message;
    }
  }

  // independent check of the blockchain: read the anchor from the chain itself (not our database)
  let anchor = { anchored: !!b.anchor };
  if (config.chain.enabled && b.manifest_sha256) {
    try {
      const onChain = await chain.readAnchor(b.manifest_sha256);
      anchor = {
        anchored: onChain.exists,
        on_chain: onChain,
        tx: b.anchor ? b.anchor.tx : null,
        manifest_matches: onChain.exists, // looked up by the manifest's own SHA-256
        cid_matches: onChain.exists && !!b.ipfs && onChain.cid === b.ipfs.dir,
      };
    } catch (e) {
      anchor.error = e.message;
    }
  }

  const verification = await verifyManifest(b.manifest, b.batch_sig, b.public_key, recordsText);
  return {
    id: b.id,
    source_id: b.source_id,
    signed: true,
    manifest: b.manifest,
    manifest_sha256: b.manifest_sha256,
    signature: b.batch_sig.toString('base64'),
    signature_bytes: b.batch_sig.length,
    public_key_id: b.key_id,
    public_key: b.public_key.toString('base64'),
    verification,
    archive,
    anchor,
    fully_verified: verification.verified && archive.records_match === true && anchor.cid_matches === true,
    gateway_url: config.ipfs.gatewayUrl,
    checked_at: new Date().toISOString(),
  };
}

router.get('/batches/:id', wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id < 1) return res.status(400).json({ error: 'invalid batch id' });
  const proof = await proofForBatch(id);
  if (!proof) return res.status(404).json({ error: 'batch not found' });
  res.json(proof);
}));

// Public proof endpoint (Integration Reference IP-30): give an archive CID, get the full proof
router.get('/proof/:cid', wrap(async (req, res) => {
  const { cid } = req.params;
  if (!/^[a-z0-9]{20,100}$/.test(cid)) return res.status(400).json({ error: 'invalid CID' });
  const { rows } = await pool.query('SELECT id FROM batches WHERE ipfs_cid = $1 ORDER BY id LIMIT 1', [cid]);
  if (!rows.length) return res.status(404).json({ error: 'no batch with this CID' });
  res.json(await proofForBatch(rows[0].id));
}));

module.exports = router;
