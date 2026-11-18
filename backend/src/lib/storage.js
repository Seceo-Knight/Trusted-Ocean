'use strict';
// File archive next to the database.
// Keeps: a daily NDJSON log of all envelopes, and the untouched raw
// source file with its SHA-256 hash (proof of exactly what the provider sent us).
const fs = require('fs/promises');
const path = require('path');
const config = require('../config');

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

async function saveBatch(sourceId, { rawText, rawSha256, envelopes }) {
  const dir = await ensureDir(path.join(config.dataDir, sourceId));
  const rawDir = await ensureDir(path.join(dir, 'raw'));
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const day = stamp.slice(0, 10);

  await fs.writeFile(path.join(rawDir, `${stamp}_${rawSha256.slice(0, 12)}.txt`), rawText);
  if (envelopes.length) {
    await fs.appendFile(path.join(dir, `${day}.ndjson`), envelopes.map((e) => JSON.stringify(e)).join('\n') + '\n');
  }
}

module.exports = { saveBatch };
