'use strict';
// Post-quantum signatures with ML-DSA-65 (NIST FIPS 204), via @noble/post-quantum
// (audited, pure JavaScript). The secret key never leaves this server; the public key is
// stored in the database and published through the API so anyone can verify.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const config = require('../config');

// Node 18 has no global WebCrypto object by default; the library needs it for randomness.
if (!globalThis.crypto) globalThis.crypto = crypto.webcrypto;

const ALG = 'ML-DSA-65';
let mlDsaPromise = null;
const mlDsa = () => (mlDsaPromise ||= import('@noble/post-quantum/ml-dsa.js').then((m) => m.ml_dsa65));

const keyIdOf = (publicKey) => `mldsa65:${crypto.createHash('sha256').update(publicKey).digest('hex').slice(0, 16)}`;

let cached = null;

// Loads the signing key, creating one on first use. Stored with owner-only permissions.
async function loadSigningKey() {
  if (cached) return cached;
  const dir = config.keysDir;
  const file = path.join(dir, 'signing-key.json');
  if (fs.existsSync(file)) {
    const k = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (k.alg !== ALG) throw new Error(`signing key in ${file} is ${k.alg}, expected ${ALG}`);
    cached = {
      alg: k.alg,
      keyId: k.key_id,
      createdAt: k.created_at,
      publicKey: Buffer.from(k.public_key, 'base64'),
      secretKey: Buffer.from(k.secret_key, 'base64'),
    };
    return cached;
  }
  const dsa = await mlDsa();
  const { publicKey, secretKey } = dsa.keygen();
  const keyId = keyIdOf(publicKey);
  const createdAt = new Date().toISOString();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify({
    alg: ALG, key_id: keyId, created_at: createdAt,
    public_key: Buffer.from(publicKey).toString('base64'),
    secret_key: Buffer.from(secretKey).toString('base64'),
  }, null, 1), { mode: 0o600 });
  fs.writeFileSync(path.join(dir, 'signing-key.pub.json'), JSON.stringify(publicKeyDoc({ alg: ALG, keyId, createdAt, publicKey }), null, 1));
  console.log(`[trust] created new ${ALG} signing key ${keyId} in ${dir} (back up this folder!)`);
  cached = { alg: ALG, keyId, createdAt, publicKey: Buffer.from(publicKey), secretKey: Buffer.from(secretKey) };
  return cached;
}

function publicKeyDoc(k) {
  return { alg: k.alg, key_id: k.keyId, created_at: k.createdAt, public_key: Buffer.from(k.publicKey).toString('base64') };
}

async function sign(messageBytes) {
  const key = await loadSigningKey();
  const dsa = await mlDsa();
  return Buffer.from(dsa.sign(new Uint8Array(messageBytes), new Uint8Array(key.secretKey)));
}

async function verify(messageBytes, signature, publicKey) {
  const dsa = await mlDsa();
  try {
    return dsa.verify(new Uint8Array(signature), new Uint8Array(messageBytes), new Uint8Array(publicKey));
  } catch {
    return false;
  }
}

module.exports = { ALG, loadSigningKey, publicKeyDoc, sign, verify, keyIdOf };
