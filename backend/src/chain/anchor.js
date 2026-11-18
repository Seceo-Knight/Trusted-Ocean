'use strict';
// Anchors batch proofs on the private Besu (QBFT) chain with the TrustedOceanAnchor contract.
// What goes on-chain: SHA-256 of the ML-DSA signed manifest, IPFS CID, source id, collection time.
// Note (HLD 6.4): chain transactions use classical ECDSA signatures; long-term authenticity
// rests on the ML-DSA signature of the manifest, the chain provides ordering and timestamps.
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');
const config = require('../config');
const { pool } = require('../db');
const artifact = require('./TrustedOceanAnchor.json');

const state = { running: false, last_error: null, last_success: null, anchored: 0 };
let ctx = null; // { provider, wallet, contract, chainId, address }
let queue = Promise.resolve(); // one transaction at a time (nonce safety)

async function rpc(method, params = []) {
  const res = await fetch(config.chain.rpcUrl, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(5000),
  });
  const j = await res.json();
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return j.result;
}

function loadAccount() {
  const file = path.join(config.keysDir, 'anchor-account.json');
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const w = ethers.Wallet.createRandom();
  const acc = { address: w.address, private_key: w.privateKey, created_at: new Date().toISOString() };
  fs.mkdirSync(config.keysDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify(acc, null, 1), { mode: 0o600 });
  console.log(`[chain] created anchoring account ${acc.address} in ${config.keysDir}`);
  return acc;
}

const txOpts = { type: 0, gasPrice: 0n, gasLimit: 1_000_000n }; // private chain: zero gas price

async function connect() {
  if (ctx) return ctx;
  const chainId = Number(BigInt(await rpc('eth_chainId'))); // fails fast if the node is down
  const provider = new ethers.JsonRpcProvider(config.chain.rpcUrl, chainId, { staticNetwork: true, pollingInterval: 1000 });
  const acc = loadAccount();
  const wallet = new ethers.Wallet(acc.private_key, provider);

  // reuse the deployed contract for this chain, or deploy it (first run, or chain was reset)
  const { rows } = await pool.query(`SELECT address FROM chain_contracts WHERE name = 'TrustedOceanAnchor' AND chain_id = $1 ORDER BY deployed_at DESC LIMIT 1`, [chainId]);
  let address = rows.length ? rows[0].address : null;
  if (address && (await provider.getCode(address)) === '0x') address = null;
  if (!address) {
    const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
    const c = await factory.deploy(txOpts);
    const receipt = await c.deploymentTransaction().wait(1, 60000);
    address = await c.getAddress();
    await pool.query(
      `INSERT INTO chain_contracts (name, chain_id, address, tx_hash, block_number, deployer, compiler) VALUES ('TrustedOceanAnchor', $1, $2, $3, $4, $5, $6)`,
      [chainId, address, receipt.hash, receipt.blockNumber, wallet.address, artifact.compiler]);
    console.log(`[chain] deployed TrustedOceanAnchor at ${address} (chain ${chainId}, block ${receipt.blockNumber})`);
  }
  ctx = { provider, wallet, chainId, address, contract: new ethers.Contract(address, artifact.abi, wallet) };
  return ctx;
}

async function readAnchor(manifestSha256) {
  const c = await connect();
  const a = await c.contract.getAnchor(`0x${manifestSha256}`);
  return {
    exists: a.exists, block_number: Number(a.blockNumber), anchored_at: new Date(Number(a.anchoredAt) * 1000).toISOString(),
    fetched_at: new Date(Number(a.fetchedAt) * 1000).toISOString(), submitter: a.submitter, cid: a.cid, source_id: a.sourceId,
    chain_id: c.chainId, contract: c.address,
  };
}

async function anchorBatchNow(batchId) {
  const { rows } = await pool.query('SELECT id, source_id, fetched_at, manifest_sha256, ipfs_cid, anchor_tx FROM batches WHERE id = $1', [batchId]);
  if (!rows.length) throw new Error(`batch ${batchId} not found`);
  const b = rows[0];
  if (b.anchor_tx) return { skipped: true, tx: b.anchor_tx };
  if (!b.manifest_sha256 || !b.ipfs_cid) throw new Error(`batch ${batchId} is not signed and archived yet`);
  const c = await connect();

  let info;
  const existing = await readAnchor(b.manifest_sha256);
  if (existing.exists) {
    info = { ...existing, tx: null, note: 'already anchored' };
  } else {
    const fetched = BigInt(Math.floor(new Date(b.fetched_at).getTime() / 1000));
    const tx = await c.contract.anchor(`0x${b.manifest_sha256}`, b.ipfs_cid, b.source_id, fetched, txOpts);
    const receipt = await tx.wait(1, 60000); // QBFT: a block is final as soon as it is produced
    if (receipt.status !== 1) throw new Error(`anchor transaction failed (${receipt.hash})`);
    const block = await c.provider.getBlock(receipt.blockNumber);
    info = { tx: receipt.hash, block_number: receipt.blockNumber, anchored_at: new Date(block.timestamp * 1000).toISOString(),
      chain_id: c.chainId, contract: c.address, submitter: c.wallet.address };
  }
  await pool.query('UPDATE batches SET anchor_tx = $2, anchor = $3 WHERE id = $1', [batchId, info.tx || `existing:${info.block_number}`, info]);
  state.anchored++;
  return info;
}

// serialised so two collectors finishing together never clash on the account nonce
function anchorBatch(batchId) {
  const run = queue.then(() => anchorBatchNow(batchId));
  queue = run.catch(() => {});
  return run;
}

async function anchorPending(limit = 25) {
  if (!config.chain.enabled || state.running) return { skipped: true };
  state.running = true;
  let done = 0;
  try {
    const { rows } = await pool.query(
      `SELECT id FROM batches WHERE ipfs_cid IS NOT NULL AND manifest_sha256 IS NOT NULL AND anchor_tx IS NULL ORDER BY id LIMIT $1`, [limit]);
    for (const r of rows) { await anchorBatch(r.id); done++; }
    state.last_error = null;
    if (done) { state.last_success = new Date().toISOString(); console.log(`[chain] anchored ${done} pending batch(es)`); }
  } catch (err) {
    ctx = null; // reconnect next time (node restarted or chain reset)
    state.last_error = err.message;
    console.error(`[chain] anchor retry failed: ${err.message}`);
  } finally {
    state.running = false;
  }
  return { anchored: done };
}

async function status() {
  if (!config.chain.enabled) return { enabled: false };
  try {
    const c = await connect();
    const [block, count] = await Promise.all([c.provider.getBlockNumber(), c.contract.count()]);
    return { enabled: true, online: true, chain_id: c.chainId, block_number: block, contract: c.address, account: c.wallet.address, anchors_on_chain: Number(count), worker: state };
  } catch (err) {
    ctx = null;
    return { enabled: true, online: false, error: err.message, worker: state };
  }
}

module.exports = { anchorBatch, anchorPending, readAnchor, status, state };
