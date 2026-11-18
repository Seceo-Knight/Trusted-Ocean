'use strict';
// Imports the daily NDJSON archive files (data/<source>/<day>.ndjson) into the database.
// Safe to run again: records already stored are skipped automatically.
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const crypto = require('crypto');
const config = require('../config');
const db = require('../db');

const INFO = {
  ndbc: require('../collectors/ndbc').info,
  argo: require('../collectors/argo').info,
  copernicus: require('../collectors/copernicus').info,
  obis: require('../collectors/obis').info,
};

async function importFile(sourceId, file) {
  const hash = crypto.createHash('sha256');
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  let envelopes = [];
  const totals = { records: 0, inserted: 0, duplicates: 0 };
  const flush = async () => {
    if (!envelopes.length) return;
    const r = await db.ingestBatch(sourceId, INFO[sourceId], {
      rawSha256: hash.copy().digest('hex'),
      envelopes,
      summary: { imported_from: path.basename(file), fetched_at: envelopes[0].received_at },
    });
    totals.records += r.records; totals.inserted += r.inserted; totals.duplicates += r.duplicates;
    envelopes = [];
  };
  for await (const line of rl) {
    if (!line.trim()) continue;
    hash.update(line);
    envelopes.push(JSON.parse(line));
    if (envelopes.length >= 5000) await flush();
  }
  await flush();
  return totals;
}

// Signed batches (signed/*.manifest.json + records): re-imported together with their signature,
// so a database rebuilt from the archive keeps full verifiability.
async function importSigned(sourceId, dir) {
  const totals = { batches: 0, inserted: 0, duplicates: 0 };
  const signedDir = path.join(dir, 'signed');
  if (!fs.existsSync(signedDir)) return totals;
  const known = await db.pool.query('SELECT manifest_sha256 FROM batches WHERE manifest_sha256 IS NOT NULL');
  const seen = new Set(known.rows.map((r) => r.manifest_sha256));
  for (const f of fs.readdirSync(signedDir).filter((n) => n.endsWith('.manifest.json')).sort()) {
    const doc = JSON.parse(fs.readFileSync(path.join(signedDir, f), 'utf8'));
    if (seen.has(doc.manifest_sha256)) continue;
    const recordsRel = path.join(sourceId, 'signed', doc.records_file);
    const text = fs.readFileSync(path.join(config.dataDir, recordsRel), 'utf8');
    const envelopes = text.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
    const r = await db.ingestBatch(sourceId, INFO[sourceId], {
      rawSha256: doc.manifest.raw_sha256,
      envelopes,
      summary: { imported_from: f, fetched_at: doc.manifest.fetched_at },
    }, { manifest: doc.manifest, manifestSha256: doc.manifest_sha256, signature: Buffer.from(doc.signature, 'base64') },
    { records: recordsRel, manifest: path.join(sourceId, 'signed', f) });
    totals.batches++; totals.inserted += r.inserted; totals.duplicates += r.duplicates;
  }
  return totals;
}

(async () => {
  try {
    await db.waitForDb(3);
    await db.migrate();
    for (const sourceId of Object.keys(INFO)) {
      const dir = path.join(config.dataDir, sourceId);
      if (!fs.existsSync(dir)) continue;
      for (const f of fs.readdirSync(dir).filter((n) => /^\d{4}-\d{2}-\d{2}\.ndjson$/.test(n)).sort()) {
        const t = await importFile(sourceId, path.join(dir, f));
        console.log(`[import] ${sourceId}/${f}: ${t.inserted} new, ${t.duplicates} already stored`);
      }
      const sg = await importSigned(sourceId, dir);
      if (sg.batches) console.log(`[import] ${sourceId}/signed: ${sg.batches} signed batches, ${sg.inserted} new, ${sg.duplicates} already stored`);
    }
  } catch (err) {
    console.error(`[import] ${err.message}`);
    process.exitCode = 1;
  } finally {
    await db.pool.end();
  }
})();
