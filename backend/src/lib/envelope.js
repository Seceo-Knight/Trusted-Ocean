'use strict';
// Observation envelope, as defined in the Integration Reference (section 8.3).
// Every source is converted into this one format, so the rest of the platform
// (database, signing, archive, blockchain, dashboard) only has to understand one shape.
const { v7: uuidv7 } = require('uuid');
const config = require('../config');

const SCHEMA_VERSION = '1.0.0';

function deviceDid(sourceId, deviceId) {
  const safe = String(deviceId).toLowerCase().replace(/[^a-z0-9._-]/g, '-');
  return `did:web:${config.didDomain}:src:${sourceId}:${safe}`;
}

function buildEnvelope({ sourceId, deviceId, site, platform, observedAt, lon, lat, depthM = 0, parameters, provenance }) {
  return {
    schema_version: SCHEMA_VERSION,
    msg_id: uuidv7(),
    device_did: deviceDid(sourceId, deviceId),
    site,
    platform,
    seq: Math.floor(Date.parse(observedAt) / 1000),
    observed_at: observedAt,
    received_at: new Date().toISOString(),
    position: { type: 'Point', coordinates: [lon, lat], depth_m: depthM },
    parameters, // [{ name (CF standard name), value, unit (UCUM), qc_flag }]
    provenance, // { source_id, source_name, source_url, licence, attribution, raw_sha256 }
    fw_version: null,
    model_version: null,
    sig_alg: null, // filled in by the PQC signing step (ML-DSA)
    batch_sig: null,
  };
}

module.exports = { SCHEMA_VERSION, buildEnvelope, deviceDid };
