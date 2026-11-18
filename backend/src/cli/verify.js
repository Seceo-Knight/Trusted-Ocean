'use strict';
// Independent verifier for auditors and clients. Needs only the files, not our database:
//   node src/cli/verify.js <batch.manifest.json> <signing-key.pub.json> [records.ndjson]
// If the records file is not given, it is looked up next to the manifest.
const fs = require('fs');
const path = require('path');
const { verifyManifest } = require('../trust/manifest');

(async () => {
  const [manifestPath, keyPath, recordsArg] = process.argv.slice(2);
  if (!manifestPath || !keyPath) {
    console.error('Usage: npm run verify -- <batch.manifest.json> <signing-key.pub.json> [records.ndjson]');
    process.exit(2);
  }
  const doc = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const key = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
  const recordsPath = recordsArg || path.join(path.dirname(manifestPath), doc.records_file || '');
  const records = recordsPath && fs.existsSync(recordsPath) && fs.statSync(recordsPath).isFile() ? fs.readFileSync(recordsPath, 'utf8') : null;
  const r = await verifyManifest(doc.manifest, Buffer.from(doc.signature, 'base64'), Buffer.from(key.public_key, 'base64'), records);
  const line = (ok, text) => console.log(`${ok ? 'PASS' : 'FAIL'}  ${text}`);
  console.log(`Batch from ${doc.manifest.source_name}, collected ${doc.manifest.fetched_at}`);
  line(r.key_matches, `signed by key ${doc.manifest.key_id} (${doc.manifest.sig_alg})`);
  line(r.signature_valid, 'post-quantum signature over the manifest is valid');
  line(r.records_match === true, records === null ? 'records file not found' : `records file matches fingerprint (${doc.manifest.envelope_count} records)`);
  console.log(r.verified ? '\nVERIFIED: data is exactly as collected and signed.' : '\nNOT VERIFIED: do not trust this data.');
  process.exit(r.verified ? 0 : 1);
})().catch((err) => { console.error(err.message); process.exit(2); });
