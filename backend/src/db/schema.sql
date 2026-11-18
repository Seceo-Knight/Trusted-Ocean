-- Trusted Ocean schema. Safe to run many times (everything is "IF NOT EXISTS").
CREATE EXTENSION IF NOT EXISTS timescaledb;

CREATE TABLE IF NOT EXISTS sources (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  licence     text,
  attribution text,
  url         text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- One row per collection run. Columns for PQC signature, IPFS CID and blockchain anchor
-- are filled by later steps.
CREATE TABLE IF NOT EXISTS batches (
  id           bigserial PRIMARY KEY,
  source_id    text NOT NULL REFERENCES sources(id),
  fetched_at   timestamptz NOT NULL,
  raw_sha256   text NOT NULL,
  records      integer NOT NULL DEFAULT 0,
  inserted     integer NOT NULL DEFAULT 0,
  duplicates   integer NOT NULL DEFAULT 0,
  summary      jsonb,
  sig_alg      text,
  batch_sig    bytea,
  ipfs_cid     text,
  anchor_tx    text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS batches_source_time ON batches (source_id, fetched_at DESC);

-- Stations, buoys, floats, gauges ... (one row per device identity)
CREATE TABLE IF NOT EXISTS devices (
  did            text PRIMARY KEY,
  source_id      text NOT NULL REFERENCES sources(id),
  site           text,
  platform       text,
  lon            double precision,
  lat            double precision,
  depth_m        real,
  first_seen     timestamptz NOT NULL DEFAULT now(),
  last_observed  timestamptz,
  last_batch_id  bigint
);
CREATE INDEX IF NOT EXISTS devices_source ON devices (source_id);
CREATE INDEX IF NOT EXISTS devices_last_observed ON devices (last_observed DESC);

-- Physical measurements (one row per device + parameter + time). Time-series hypertable.
CREATE TABLE IF NOT EXISTS observations (
  time        timestamptz NOT NULL,
  device_did  text NOT NULL,
  parameter   text NOT NULL,
  value       double precision NOT NULL,
  unit        text NOT NULL,
  qc_flag     smallint NOT NULL,
  depth_m     real,
  lon         double precision,
  lat         double precision,
  source_id   text NOT NULL,
  batch_id    bigint,
  msg_id      uuid
);
SELECT create_hypertable('observations', by_range('time', INTERVAL '7 days'), if_not_exists => TRUE);
CREATE UNIQUE INDEX IF NOT EXISTS observations_uniq ON observations (device_did, parameter, time);
CREATE INDEX IF NOT EXISTS observations_param_time ON observations (parameter, time DESC);
CREATE INDEX IF NOT EXISTS observations_source_time ON observations (source_id, time DESC);

-- Biodiversity / eDNA occurrence records (OBIS). Hypertable on observation time.
CREATE TABLE IF NOT EXISTS occurrences (
  time             timestamptz NOT NULL,
  occurrence_id    text NOT NULL,
  dataset_id       text,
  dataset_title    text,
  licence          text,
  lon              double precision NOT NULL,
  lat              double precision NOT NULL,
  depth_m          real,
  aphia_id         integer,
  scientific_name  text,
  rank             text,
  kingdom          text,
  phylum           text,
  class            text,
  "order"          text,
  family           text,
  genus            text,
  species          text,
  qc_flag          smallint NOT NULL,
  source_id        text NOT NULL,
  batch_id         bigint
);
SELECT create_hypertable('occurrences', by_range('time', INTERVAL '90 days'), if_not_exists => TRUE);
CREATE UNIQUE INDEX IF NOT EXISTS occurrences_uniq ON occurrences (occurrence_id, time);
CREATE INDEX IF NOT EXISTS occurrences_aphia ON occurrences (aphia_id, time DESC);
CREATE INDEX IF NOT EXISTS occurrences_lat_lon ON occurrences (lat, lon);

-- Trust layer: public keys used to sign batch manifests (secret keys never stored here)
CREATE TABLE IF NOT EXISTS signing_keys (
  key_id      text PRIMARY KEY,
  alg         text NOT NULL,
  public_key  bytea NOT NULL,
  created_at  timestamptz NOT NULL,
  retired_at  timestamptz
);
ALTER TABLE batches ADD COLUMN IF NOT EXISTS key_id text;
ALTER TABLE batches ADD COLUMN IF NOT EXISTS manifest jsonb;
ALTER TABLE batches ADD COLUMN IF NOT EXISTS manifest_sha256 text;
ALTER TABLE batches ADD COLUMN IF NOT EXISTS files jsonb;
CREATE INDEX IF NOT EXISTS batches_manifest_sha ON batches (manifest_sha256);
