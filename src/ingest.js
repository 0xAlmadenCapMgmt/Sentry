/**
 * Ingestion worker. Run all sources or one:
 *   npm run ingest
 *   node src/ingest.js OFAC_SDN
 *
 * Meant for a daily cron; the server also runs it in-process on an interval.
 * A failed fetch keeps the previous data and logs an error snapshot — the
 * source then ages toward stale, which /v1/sources and every screening
 * response disclose.
 */
const config = require("./config");
const { openDb, replaceSourceFindings, recordSnapshot } = require("./db");
const { SOURCES } = require("./sources");

async function ingestSource(db, source) {
  const started = Date.now();
  try {
    const records = await source.fetchRecords();
    replaceSourceFindings(db, source.name, records);
    recordSnapshot(db, source.name, "ok", records.length);
    return { source: source.name, status: "ok", records: records.length, ms: Date.now() - started };
  } catch (err) {
    recordSnapshot(db, source.name, "error", null, String(err.message || err));
    return { source: source.name, status: "error", error: String(err.message || err), ms: Date.now() - started };
  }
}

async function ingestAll(db, only = null) {
  const targets = only ? SOURCES.filter((s) => s.name === only) : SOURCES;
  if (only && targets.length === 0) {
    throw new Error(`unknown source "${only}" — known: ${SOURCES.map((s) => s.name).join(", ")}`);
  }
  const results = [];
  for (const source of targets) {
    results.push(await ingestSource(db, source));
  }
  return results;
}

module.exports = { ingestAll, ingestSource };

if (require.main === module) {
  (async () => {
    const db = openDb(config.dbPath);
    const results = await ingestAll(db, process.argv[2] || null);
    for (const r of results) {
      if (r.status === "ok") {
        console.log(`[ok]    ${r.source.padEnd(14)} ${String(r.records).padStart(6)} records  (${r.ms}ms)`);
      } else {
        console.error(`[error] ${r.source.padEnd(14)} ${r.error}`);
      }
    }
    db.close();
    if (results.some((r) => r.status === "error")) process.exitCode = 1;
  })();
}
