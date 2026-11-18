'use strict';
// One-time setup of the private QBFT blockchain, using Besu's own official tool:
//  - creates the network's genesis file (besu/genesis.json)
//  - creates the validator key directly inside the chain's Docker volume (never on disk here)
// Safe to run again: it does nothing if the chain is already set up.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const IMAGE = 'hyperledger/besu:26.8.1';
const VOLUME = 'trusted-ocean-chain-data';
const besuDir = path.resolve(__dirname, '..', '..', 'besu');

const genesis = path.join(besuDir, 'genesis.json');
if (fs.existsSync(genesis) && fs.statSync(genesis).isFile()) {
  console.log('[chain] already initialised (besu/genesis.json exists). Nothing to do.');
  process.exit(0);
}
const script = [
  'set -e',
  '/opt/besu/bin/besu operator generate-blockchain-config --config-file=/cfg/qbft-config.json --to=/tmp/net --private-key-file-name=key',
  'mkdir -p /opt/besu/data',
  'cp /tmp/net/genesis.json /cfg/genesis.json',
  'cp /tmp/net/keys/*/key /opt/besu/data/key',
  'cp /tmp/net/keys/*/key.pub /cfg/validator-key.pub',
  'ls /tmp/net/keys > /cfg/validator-address.txt',
  'chown -R besu:besu /opt/besu/data && chmod 600 /opt/besu/data/key && chmod 644 /cfg/genesis.json',
].join(' && ');
if (fs.existsSync(genesis)) { console.error('[chain] besu/genesis.json is a folder (Docker created it because the chain was started before chain:init). Delete that folder, then run npm run chain:init again.'); process.exit(1); }
console.log(`[chain] generating QBFT network with ${IMAGE} ...`);
execFileSync('docker', ['run', '--rm', '--user', 'root', '--entrypoint', 'sh',
  '-v', `${besuDir}:/cfg`, '-v', `${VOLUME}:/opt/besu/data`, IMAGE, '-c', script], { stdio: 'inherit' });
const validator = fs.readFileSync(path.join(besuDir, 'validator-address.txt'), 'utf8').trim();
console.log(`[chain] done. Validator ${validator}. Now run: npm run db:up`);
