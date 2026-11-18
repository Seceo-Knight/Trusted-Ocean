'use strict';
// Minimal client for the Kubo (IPFS) HTTP RPC API. Uses only standard endpoints, so any
// Kubo-compatible IPFS implementation can replace it. Docs: https://docs.ipfs.tech/reference/kubo/rpc/
const config = require('../config');

async function rpc(path, { body, timeoutMs = 120000 } = {}) {
  const res = await fetch(`${config.ipfs.apiUrl}/api/v0/${path}`, { method: 'POST', body, signal: AbortSignal.timeout(timeoutMs) });
  const text = await res.text();
  if (!res.ok) throw new Error(`IPFS ${path.split('?')[0]}: HTTP ${res.status} ${text.slice(0, 200).replace(/\s+/g, ' ')}`);
  return text;
}

// Adds files as one directory. Returns { dir: <directory CID>, files: { name: CID } }.
// CIDv1 + raw leaves: the modern, stable content-addressing format.
async function addDirectory(files) {
  const form = new FormData();
  for (const f of files) form.append('file', new Blob([f.content]), f.name);
  const text = await rpc('add?cid-version=1&raw-leaves=true&pin=true&wrap-with-directory=true&progress=false', { body: form, timeoutMs: 600000 });
  const entries = text.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
  const dirEntry = entries.find((e) => e.Name === '');
  if (!dirEntry) throw new Error('IPFS add: no directory entry in response');
  const out = { dir: dirEntry.Hash, files: {} };
  for (const e of entries) if (e.Name) out.files[e.Name] = e.Hash;
  return out;
}

async function cat(cid, maxBytes = 200 * 1024 * 1024) {
  if (!/^[a-z0-9]{20,100}(\/[A-Za-z0-9._-]{1,200})?$/.test(cid)) throw new Error('invalid CID');
  return rpc(`cat?arg=${encodeURIComponent(cid)}&length=${maxBytes}`, { timeoutMs: 300000 });
}

async function id() {
  return JSON.parse(await rpc('id', { timeoutMs: 5000 }));
}

module.exports = { addDirectory, cat, id };
