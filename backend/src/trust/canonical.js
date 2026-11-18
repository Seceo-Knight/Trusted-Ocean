'use strict';
// Canonical JSON: object keys sorted at every level, no extra whitespace.
// The same data always produces the same bytes, so hashes and signatures are reproducible.
function canonicalize(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  const out = {};
  for (const k of Object.keys(value).sort()) {
    if (value[k] !== undefined) out[k] = canonicalize(value[k]);
  }
  return out;
}
const canonicalJson = (value) => JSON.stringify(canonicalize(value));

module.exports = { canonicalJson };
