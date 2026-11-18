'use strict';
// Builds and signs the manifest for one collected batch.
const crypto = require('crypto');
const { canonicalJson } = require('./canonical');
const pqc = require('./pqc');

const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');
const MANIFEST_VERSION = '1.0';

// Marks every envelope with the signature algorithm and key, then serialises the batch
// in canonical form. These exact bytes are what the manifest fingerprints.
async function prepareEnvelopes(envelopes) {
  const key = await pqc.loadSigningKey();
  for (const e of envelopes) {
    e.sig_alg = pqc.ALG;
    e.key_id = key.keyId;
    e.batch_sig = null; // the signature lives in the batch manifest (it cannot sign itself)
  }
  const text = envelopes.map(canonicalJson).join('\n') + (envelopes.length ? '\n' : '');
  return { text, sha256: sha256(text) };
}

async function signBatch(sourceId, info, batch) {
  const key = await pqc.loadSigningKey();
  const envFile = await prepareEnvelopes(batch.envelopes);
  const manifest = {
    manifest_version: MANIFEST_VERSION,
    platform: 'trusted-ocean',
    source_id: sourceId,
    source_name: info.source_name,
    source_licence: info.licence,
    fetched_at: batch.summary.fetched_at,
    raw_sha256: batch.rawSha256,
    raw_bytes: Buffer.byteLength(batch.rawText || ''),
    envelopes_sha256: envFile.sha256,
    envelope_count: batch.envelopes.length,
    signed_at: new Date().toISOString(),
    sig_alg: pqc.ALG,
    key_id: key.keyId,
  };
  const manifestBytes = Buffer.from(canonicalJson(manifest));
  const signature = await pqc.sign(manifestBytes);
  return {
    manifest,
    manifestSha256: sha256(manifestBytes),
    signature,
    envelopesText: envFile.text,
  };
}

// Checks a manifest signature, and optionally that a records file matches its fingerprint.
async function verifyManifest(manifest, signature, publicKey, envelopesText) {
  const manifestBytes = Buffer.from(canonicalJson(manifest));
  const signatureValid = await pqc.verify(manifestBytes, signature, publicKey);
  const result = {
    signature_valid: signatureValid,
    key_matches: pqc.keyIdOf(publicKey) === manifest.key_id,
    manifest_sha256: sha256(manifestBytes),
  };
  if (envelopesText !== undefined) {
    result.records_file_found = envelopesText !== null;
    result.records_match = envelopesText !== null && sha256(envelopesText) === manifest.envelopes_sha256;
  }
  result.verified = result.signature_valid && result.key_matches && (envelopesText === undefined || result.records_match === true);
  return result;
}

module.exports = { signBatch, verifyManifest, sha256 };
