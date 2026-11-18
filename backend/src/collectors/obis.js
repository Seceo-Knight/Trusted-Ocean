'use strict';
// OBIS (Ocean Biodiversity Information System): species occurrence records, by default only
// eDNA records (DNADerivedData extension). Taxonomy is already matched to WoRMS by OBIS.
// Not a live feed: results are published weeks to years after sampling, so this is a
// biodiversity baseline layer covering the last few years, walked through page by page.
// Licences differ per dataset: we keep CC0 / CC BY / CC BY-SA and drop NC, ND and unknown.
const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const config = require('../config');
const { buildEnvelope } = require('../lib/envelope');

const API = 'https://api.obis.org/v3';
const SOURCE = {
  source_id: 'obis',
  source_name: 'OBIS - Ocean Biodiversity Information System (taxonomy matched to WoRMS)',
  source_url: 'https://obis.org/',
  licence: 'Per dataset; only CC0, CC BY and CC BY-SA datasets are kept',
  attribution: 'OBIS (YEAR) Ocean Biodiversity Information System. Intergovernmental Oceanographic Commission of UNESCO. www.obis.org. Cite each dataset as given in its OBIS record.',
};
const FIELDS = [
  'id', 'dataset_id', 'decimalLatitude', 'decimalLongitude', 'date_mid', 'date_start', 'eventDate',
  'scientificName', 'aphiaID', 'taxonRank', 'kingdom', 'phylum', 'class', 'order', 'family', 'genus', 'species',
  'basisOfRecord', 'occurrenceStatus', 'depth', 'minimumDepthInMeters', 'flags',
];
const BAD_FLAGS = ['on_land', 'depth_exceeds_bath', 'no_coord', 'zero_coord', 'lon_out_of_range', 'lat_out_of_range'];

async function getJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': config.userAgent, Accept: 'application/json' }, signal: AbortSignal.timeout(120000) });
  const text = await res.text();
  if (!res.ok) throw new Error(`OBIS: HTTP ${res.status} ${text.slice(0, 200).replace(/\s+/g, ' ')}`);
  return { text, json: JSON.parse(text) };
}

// Same classification idea as OBIS's own licence report (iobis/obis-licenses).
function classifyLicence(text) {
  const t = String(text || '').toLowerCase();
  if (!t.trim()) return 'unknown';
  if (/cc0|publicdomain\/zero|public domain/.test(t)) return 'CC0';
  if (/by[- ]?nc|by-nc|noncommercial|non-commercial/.test(t)) return 'CC BY-NC';
  if (/by[- ]?nd|noderivatives|no derivatives/.test(t)) return 'CC BY-ND';
  if (/by[- ]?sa|sharealike|share alike/.test(t)) return 'CC BY-SA';
  if (/cc[- ]?by|creativecommons\.org\/licenses\/by\/|attribution/.test(t)) return 'CC BY';
  return 'unknown';
}
const ALLOWED = new Set(['CC0', 'CC BY', 'CC BY-SA']);

async function readJsonFile(p, fallback) {
  try { return JSON.parse(await fs.readFile(p, 'utf8')); } catch { return fallback; }
}
async function writeJsonFile(p, data) {
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(`${p}.tmp`, JSON.stringify(data, null, 1));
  await fs.rename(`${p}.tmp`, p);
}

async function datasetInfo(id, cache) {
  if (cache[id] && Date.now() - cache[id].checked < 30 * 24 * 3600 * 1000) return cache[id];
  const { json } = await getJson(`${API}/dataset/${encodeURIComponent(id)}`);
  const d = (json.results && json.results[0]) || {};
  cache[id] = {
    title: d.title || null,
    url: d.url || `https://obis.org/dataset/${id}`,
    citation: d.citation || null,
    licence_text: d.intellectualrights || null,
    licence: classifyLicence(d.intellectualrights),
    checked: Date.now(),
  };
  return cache[id];
}

function toMillis(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return NaN;
  return n < 1e11 ? n * 1000 : n; // OBIS timestamps may be seconds or milliseconds
}

function toEnvelope(r, ds, base) {
  const flags = Array.isArray(r.flags) ? r.flags : [];
  const t = toMillis(r.date_mid ?? r.date_start);
  if (!Number.isFinite(t)) return null;
  const lat = Number(r.decimalLatitude);
  const lon = Number(r.decimalLongitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const depth = Number(r.depth ?? r.minimumDepthInMeters);
  const env = buildEnvelope({
    sourceId: 'obis',
    deviceId: r.dataset_id,
    site: `obis-${String(r.dataset_id).slice(0, 8)}`,
    platform: config.obis.ednaOnly ? 'edna_sample' : String(r.basisOfRecord || 'occurrence').toLowerCase(),
    observedAt: new Date(t).toISOString(),
    lon, lat,
    depthM: Number.isFinite(depth) ? depth : 0,
    parameters: [{ name: 'species_occurrence', value: 1, unit: '1', qc_flag: flags.some((f) => BAD_FLAGS.includes(f)) ? 4 : 1 }],
    provenance: {
      ...base,
      occurrence_id: r.id,
      dataset_title: ds.title,
      dataset_url: ds.url,
      dataset_citation: ds.citation,
      dataset_licence: ds.licence,
      obis_flags: flags,
    },
  });
  // OBIS does not always return taxonRank: use the most specific classification level present
  const derivedRank = ['species', 'genus', 'family', 'order', 'class', 'phylum', 'kingdom'].find((k) => r[k]) || null;
  env.taxon = {
    scientific_name: r.scientificName || null,
    aphia_id: r.aphiaID ?? null,
    rank: r.taxonRank ? String(r.taxonRank).toLowerCase() : derivedRank,
    kingdom: r.kingdom || null, phylum: r.phylum || null, class: r.class || null,
    order: r.order || null, family: r.family || null, genus: r.genus || null, species: r.species || null,
  };
  env.event_date = r.eventDate || null;
  return env;
}

async function collect() {
  const s = config.obis;
  const dir = path.join(config.dataDir, 'obis');
  const statePath = path.join(dir, 'state.json');
  const cachePath = path.join(dir, 'datasets.json');
  const state = await readJsonFile(statePath, { after: null, sweeps_completed: 0 });
  const cache = await readJsonFile(cachePath, {});

  const start = new Date(Date.now() - s.lookbackYears * 365.25 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  // if the area or filters changed since the last run, start a fresh sweep
  const queryKey = JSON.stringify({ geometry: s.geometry, ednaOnly: s.ednaOnly, lookbackYears: s.lookbackYears });
  if (state.query_key !== queryKey) state.after = null;
  const pages = [];
  const raws = [];
  let after = state.after;
  let reachedEnd = false;
  let total = null;
  while (pages.reduce((n, p) => n + p.length, 0) < s.maxRecords) {
    const params = new URLSearchParams({ startdate: start, size: String(Math.min(5000, s.maxRecords)), fields: FIELDS.join(',') });
    if (s.ednaOnly) params.set('hasextensions', 'DNADerivedData');
    if (s.geometry) params.set('geometry', s.geometry);
    if (after) params.set('after', after);
    const { text, json } = await getJson(`${API}/occurrence?${params}`);
    raws.push(text);
    if (total === null) total = json.total ?? null;
    const results = Array.isArray(json.results) ? json.results : [];
    pages.push(results);
    if (!results.length || results.length < Number(params.get('size'))) { reachedEnd = true; break; }
    after = results[results.length - 1].id;
  }

  const rows = pages.flat();
  const rawText = raws.join('\n');
  const rawSha256 = crypto.createHash('sha256').update(rawText).digest('hex');
  const base = { ...SOURCE, raw_sha256: rawSha256 };

  const envelopes = [];
  const dropped = { licence_not_allowed: 0, invalid: 0 };
  for (const id of [...new Set(rows.map((r) => r.dataset_id).filter(Boolean))]) {
    try { await datasetInfo(id, cache); } catch (e) { cache[id] = cache[id] || { licence: 'unknown', checked: 0 }; }
  }
  for (const r of rows) {
    const ds = cache[r.dataset_id] || { licence: 'unknown' };
    if (!ALLOWED.has(ds.licence)) { dropped.licence_not_allowed++; continue; }
    const env = toEnvelope(r, ds, base);
    if (env) envelopes.push(env); else dropped.invalid++;
  }

  await writeJsonFile(cachePath, cache);
  await writeJsonFile(statePath, {
    after: reachedEnd ? null : after,
    sweeps_completed: (state.query_key === queryKey ? state.sweeps_completed || 0 : 0) + (reachedEnd ? 1 : 0),
    query_key: queryKey,
    last_run: new Date().toISOString(),
  });

  const species = new Set(envelopes.map((e) => e.taxon.aphia_id).filter((x) => x !== null));
  const summary = {
    source: SOURCE,
    fetched_at: new Date().toISOString(),
    stations: new Set(envelopes.map((e) => e.device_did)).size,
    observations: envelopes.length,
    taxa: species.size,
    flagged_bad: envelopes.filter((e) => e.parameters[0].qc_flag === 4).length,
    records_received: rows.length,
    records_matching_total: total,
    dropped,
    sweep_finished: reachedEnd,
    raw_sha256: rawSha256,
  };
  return { rawText, rawSha256, envelopes, summary };
}

module.exports = { id: 'obis', name: 'OBIS biodiversity (eDNA)', info: SOURCE, collect, classifyLicence, toEnvelope };
