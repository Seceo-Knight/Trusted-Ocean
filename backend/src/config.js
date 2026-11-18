'use strict';
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const int = (v, d) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : d;
};

module.exports = {
  host: process.env.HOST || '127.0.0.1',
  port: int(process.env.PORT, 4100),
  dataDir: path.resolve(__dirname, '..', process.env.DATA_DIR || 'data'),
  // ML-DSA signing key (secret). Keep out of Git and back it up safely.
  keysDir: path.resolve(__dirname, '..', process.env.KEYS_DIR || 'keys'),
  didDomain: process.env.DID_DOMAIN || 'trustedocean.local',
  userAgent: process.env.HTTP_USER_AGENT || 'TrustedOcean/0.1',
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: int(process.env.DB_PORT, 5433),
    name: process.env.DB_NAME || 'trusted_ocean',
    user: process.env.DB_USER || 'ocean',
    password: process.env.DB_PASSWORD || '',
  },
  ipfs: {
    enabled: process.env.IPFS_ENABLED !== 'false',
    apiUrl: (process.env.IPFS_API_URL || 'http://127.0.0.1:5101').replace(/\/$/, ''),
    gatewayUrl: (process.env.IPFS_GATEWAY_URL || 'http://127.0.0.1:8089').replace(/\/$/, ''),
    retryMinutes: Math.max(1, int(process.env.IPFS_RETRY_MINUTES, 10)),
  },
  chain: {
    enabled: process.env.CHAIN_ENABLED !== 'false',
    rpcUrl: process.env.CHAIN_RPC_URL || 'http://127.0.0.1:8545',
  },
  ndbc: {
    enabled: process.env.NDBC_ENABLED !== 'false',
    // NDBC refreshes its latest-observations file about every 5 minutes; 10 is polite.
    intervalMinutes: Math.max(5, int(process.env.NDBC_INTERVAL_MINUTES, 10)),
    url: process.env.NDBC_URL || 'https://www.ndbc.noaa.gov/data/latest_obs/latest_obs.txt',
  },
  argo: {
    enabled: process.env.ARGO_ENABLED !== 'false',
    // floats surface about every 10 days, so a few runs per day is plenty
    intervalMinutes: Math.max(30, int(process.env.ARGO_INTERVAL_MINUTES, 360)),
    erddapServer: process.env.ARGO_ERDDAP_SERVER || 'https://erddap.ifremer.fr/erddap',
    lookbackDays: Math.min(int(process.env.ARGO_LOOKBACK_DAYS, 2), 10),
    maxPressureDbar: int(process.env.ARGO_MAX_PRESSURE_DBAR, 10),
  },
  copernicus: {
    enabled: process.env.COPERNICUS_ENABLED !== 'false',
    intervalMinutes: Math.max(60, int(process.env.COPERNICUS_INTERVAL_MINUTES, 180)),
    python: path.resolve(__dirname, '..', process.env.COPERNICUS_PYTHON || 'python/.venv/bin/python'),
    datasetId: process.env.COPERNICUS_DATASET_ID || 'cmems_obs-ins_glo_phybgcwav_mynrt_na_irr',
    lookbackHours: Math.min(int(process.env.COPERNICUS_LOOKBACK_HOURS, 24), 72),
    platformTypes: process.env.COPERNICUS_PLATFORM_TYPES || 'MO,DB,TG,GL,SD,FB',
    maxFiles: Math.min(int(process.env.COPERNICUS_MAX_FILES, 300), 2000),
    bbox: (process.env.COPERNICUS_BBOX || '').trim(),
  },
  obis: {
    enabled: process.env.OBIS_ENABLED !== 'false',
    intervalMinutes: Math.max(60, int(process.env.OBIS_INTERVAL_MINUTES, 360)),
    ednaOnly: process.env.OBIS_EDNA_ONLY !== 'false',
    lookbackYears: Math.min(int(process.env.OBIS_LOOKBACK_YEARS, 5), 30),
    maxRecords: Math.min(int(process.env.OBIS_MAX_RECORDS_PER_RUN, 30000), 100000),
    geometry: (process.env.OBIS_GEOMETRY || '').trim(),
    // biodiversity records are published late, so allow old observation dates
    maxAgeDays: Math.min(int(process.env.OBIS_LOOKBACK_YEARS, 5), 30) * 366 + 31,
  },
};
