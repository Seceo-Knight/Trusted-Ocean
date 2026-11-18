'use strict';
// File archive next to the database. For every batch it keeps:
//   raw/<stamp>_<hash>.txt               exactly what the provider sent
//   signed/<stamp>_<hash>.ndjson         our records in canonical form (fingerprinted in the manifest)
//   signed/<stamp>_<hash>.manifest.json  the ML-DSA signed manifest
// These files are what the IPFS archive step will publish.
const fs = require('fs/promises');
const path = require('path');
const config = require('../config');

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

async function saveBatch(sourceId, batch, signed) {
  const dir = path.join(config.dataDir, sourceId);
  const rawDir = await ensureDir(path.join(dir, 'raw'));
  const signedDir = await ensureDir(path.join(dir, 'signed'));
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const name = `${stamp}_${signed.manifestSha256.slice(0, 12)}`;

  const files = {
    raw: path.join(sourceId, 'raw', `${stamp}_${batch.rawSha256.slice(0, 12)}.txt`),
    records: path.join(sourceId, 'signed', `${name}.ndjson`),
    manifest: path.join(sourceId, 'signed', `${name}.manifest.json`),
  };
  await fs.writeFile(path.join(rawDir, path.basename(files.raw)), batch.rawText || '');
  await fs.writeFile(path.join(signedDir, path.basename(files.records)), signed.envelopesText);
  await fs.writeFile(path.join(signedDir, path.basename(files.manifest)), JSON.stringify({
    manifest: signed.manifest,
    manifest_sha256: signed.manifestSha256,
    signature: signed.signature.toString('base64'),
    records_file: path.basename(files.records),
  }, null, 1));
  return files;
}

async function readDataFile(relPath) {
  const full = path.resolve(config.dataDir, relPath);
  if (!full.startsWith(path.resolve(config.dataDir) + path.sep)) throw new Error('invalid data path');
  try { return await fs.readFile(full, 'utf8'); } catch (err) { if (err.code === 'ENOENT') return null; throw err; }
}

module.exports = { saveBatch, readDataFile };
