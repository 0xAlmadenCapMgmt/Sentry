/**
 * Screening core: evidence, never clearance.
 *
 * Verdicts:
 *   flagged     — at least one finding on an applicable source
 *   no_findings — checked all applicable sources, nothing found
 *   unknown     — every applicable source is stale/never-ingested (the check
 *                 ran, but the evidence is too old to assert absence)
 * There is no "clean". Unrecognized input never reaches here (400 earlier).
 */
const { parseAddress } = require("./normalize");
const { findingsForAddress, latestOkSnapshot } = require("./db");
const { sourcesForNamespace } = require("./sources");

const DISCLAIMER =
  "Evidence of presence/absence on listed public sources at the stated time. " +
  "Not a safety determination, not financial or legal advice.";

/**
 * Build a screening report (without receipt) for one address.
 * Throws InvalidAddressError on garbage input.
 */
function screenAddress(db, input, config) {
  const parsed = parseAddress(input, config.defaultEvmChain);
  const applicable = sourcesForNamespace(parsed.namespace);
  const staleCutoff = Date.now() - config.sourceSlaHours * 3600 * 1000;

  const snapshotBySource = {};
  const sourcesStale = [];
  for (const source of applicable) {
    const snap = latestOkSnapshot(db, source.name);
    snapshotBySource[source.name] = snap ? snap.snapshot_time : null;
    if (!snap || Date.parse(snap.snapshot_time) < staleCutoff) {
      sourcesStale.push(source.name);
    }
  }

  const applicableNames = new Set(applicable.map((s) => s.name));
  const findings = findingsForAddress(db, parsed.addressKey)
    .filter((row) => applicableNames.has(row.source))
    .map((row) => ({
      source: row.source,
      category: row.category,
      chain: row.chain,
      first_seen: row.first_seen,
      source_url: row.source_url,
      source_snapshot_time: snapshotBySource[row.source],
      details: row.details || undefined,
    }));

  let verdict;
  if (findings.length > 0) verdict = "flagged";
  else if (sourcesStale.length === applicable.length) verdict = "unknown";
  else verdict = "no_findings";

  return {
    address: parsed.caip10,
    verdict,
    findings,
    sources_checked: applicable.map((s) => s.name),
    sources_stale: sourcesStale,
    checked_at: new Date().toISOString(),
    disclaimer: DISCLAIMER,
  };
}

module.exports = { screenAddress, DISCLAIMER };
