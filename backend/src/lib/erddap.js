'use strict';
// Reusable client for ERDDAP "tabledap" servers (Argo, EMODnet, NOAA CoastWatch, IOOS ...).
// Docs: https://coastwatch.pfeg.noaa.gov/erddap/rest.html
const crypto = require('crypto');
const config = require('../config');

// Builds: <server>/tabledap/<dataset>.json?var1,var2&constraint1&constraint2
function buildUrl(server, datasetId, variables, constraints = []) {
  const q = [variables.join(','), ...constraints.map((c) => encodeURIComponent(c).replace(/%3D/g, '='))];
  return `${server.replace(/\/$/, '')}/tabledap/${datasetId}.json?${q.join('&')}`;
}

// Turns ERDDAP JSON ({table:{columnNames, rows}}) into an array of plain objects.
function tableToObjects(json) {
  const t = json && json.table;
  if (!t || !Array.isArray(t.columnNames) || !Array.isArray(t.rows)) {
    throw new Error('ERDDAP: unexpected response format');
  }
  return t.rows.map((r) => Object.fromEntries(t.columnNames.map((c, i) => [c, r[i]])));
}

async function fetchTable({ server, datasetId, variables, constraints, timeoutMs = 120000 }) {
  const url = buildUrl(server, datasetId, variables, constraints);
  const res = await fetch(url, { headers: { 'User-Agent': config.userAgent }, signal: AbortSignal.timeout(timeoutMs) });
  const rawText = await res.text();
  const rawSha256 = crypto.createHash('sha256').update(rawText).digest('hex');
  // ERDDAP answers 404 with this message when the query is valid but nothing matches.
  if (res.status === 404 && /no matching results/i.test(rawText)) {
    return { url, rawText, rawSha256, rows: [] };
  }
  if (!res.ok) throw new Error(`ERDDAP ${datasetId}: HTTP ${res.status} ${rawText.slice(0, 200).replace(/\s+/g, ' ')}`);
  return { url, rawText, rawSha256, rows: tableToObjects(JSON.parse(rawText)) };
}

module.exports = { buildUrl, tableToObjects, fetchTable };
