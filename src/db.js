/**
 * SQLite store (node:sqlite, built into Node >= 22.5 — no native deps).
 *
 * findings          one row per (address, chain, source, category); sources
 *                   are never merged — provenance stays attributed.
 * source_snapshots  append-only ingestion log; the latest ok row per source
 *                   is that source's freshness.
 * receipts          signed attestation receipts (the durable product).
 */
const { DatabaseSync } = require("node:sqlite");
const fs = require("fs");
const path = require("path");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS findings (
  address_key  TEXT NOT NULL,
  chain        TEXT NOT NULL,
  source       TEXT NOT NULL,
  category     TEXT NOT NULL,
  first_seen   TEXT,
  source_url   TEXT NOT NULL,
  details      TEXT,
  ingested_at  TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  PRIMARY KEY (address_key, chain, source, category)
);
CREATE INDEX IF NOT EXISTS idx_findings_address ON findings(address_key);

CREATE TABLE IF NOT EXISTS source_snapshots (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  source        TEXT NOT NULL,
  snapshot_time TEXT NOT NULL,
  status        TEXT NOT NULL,
  record_count  INTEGER,
  error         TEXT
);
CREATE INDEX IF NOT EXISTS idx_snapshots_source ON source_snapshots(source, snapshot_time);

CREATE TABLE IF NOT EXISTS receipts (
  id           TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  signature    TEXT NOT NULL,
  signer       TEXT NOT NULL,
  payment_ref  TEXT,
  created_at   TEXT NOT NULL
);
`;

function openDb(dbPath) {
  if (dbPath !== ":memory:") {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(SCHEMA);
  return db;
}

/**
 * Replace a source's records atomically while preserving first_seen for
 * addresses that were already listed. Records delisted upstream are removed.
 * @param {Array<{addressKey,chain,category,firstSeen,sourceUrl,details}>} records
 */
function replaceSourceFindings(db, source, records, now = new Date().toISOString()) {
  const today = now.slice(0, 10);
  const upsert = db.prepare(`
    INSERT INTO findings (address_key, chain, source, category, first_seen, source_url, details, ingested_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(address_key, chain, source, category) DO UPDATE SET
      first_seen   = COALESCE(findings.first_seen, excluded.first_seen),
      source_url   = excluded.source_url,
      details      = excluded.details,
      last_seen_at = excluded.last_seen_at
  `);
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const r of records) {
      upsert.run(
        r.addressKey,
        r.chain,
        source,
        r.category,
        r.firstSeen || today, // when the source gives no date, first_seen = date we first ingested it
        r.sourceUrl,
        r.details || null,
        now,
        now
      );
    }
    db.prepare("DELETE FROM findings WHERE source = ? AND last_seen_at < ?").run(source, now);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

function recordSnapshot(db, source, status, recordCount = null, error = null) {
  db.prepare(
    "INSERT INTO source_snapshots (source, snapshot_time, status, record_count, error) VALUES (?, ?, ?, ?, ?)"
  ).run(source, new Date().toISOString(), status, recordCount, error);
}

/** Latest successful snapshot for a source, or undefined. */
function latestOkSnapshot(db, source) {
  return db
    .prepare(
      "SELECT snapshot_time, record_count FROM source_snapshots WHERE source = ? AND status = 'ok' ORDER BY id DESC LIMIT 1"
    )
    .get(source);
}

/** Latest snapshot attempt of any status (to surface last errors). */
function latestSnapshot(db, source) {
  return db
    .prepare(
      "SELECT snapshot_time, status, record_count, error FROM source_snapshots WHERE source = ? ORDER BY id DESC LIMIT 1"
    )
    .get(source);
}

function findingsForAddress(db, addressKey) {
  return db
    .prepare(
      "SELECT source, chain, category, first_seen, source_url, details FROM findings WHERE address_key = ? ORDER BY source, category"
    )
    .all(addressKey);
}

function countFindings(db) {
  return db.prepare("SELECT COUNT(*) AS n FROM findings").get().n;
}

function insertReceipt(db, r) {
  db.prepare(
    "INSERT INTO receipts (id, payload_json, payload_hash, signature, signer, payment_ref, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(r.id, r.payloadJson, r.payloadHash, r.signature, r.signer, r.paymentRef, r.createdAt);
}

function getReceipt(db, id) {
  return db.prepare("SELECT * FROM receipts WHERE id = ?").get(id);
}

module.exports = {
  openDb,
  replaceSourceFindings,
  recordSnapshot,
  latestOkSnapshot,
  latestSnapshot,
  findingsForAddress,
  countFindings,
  insertReceipt,
  getReceipt,
};
