const { test, before, after } = require("node:test");
const assert = require("node:assert");
const { createApp } = require("../server");
const { replaceSourceFindings, recordSnapshot } = require("../src/db");

// Fixture address seeded into the test DB (mechanics only — live listings change;
// Tornado Cash, for example, was delisted from OFAC in March 2025).
const BAD = "0x8589427373D6D84E98730D7795D8f6f8731FDA16";
const BAD_KEY = BAD.toLowerCase();
const CLEAN = "0x000000000000000000000000000000000000dEaD";

let srv, base, db;

function seed(theDb) {
  replaceSourceFindings(theDb, "OFAC_SDN", [
    {
      addressKey: BAD_KEY,
      chain: "eip155:*",
      category: "sanctions",
      firstSeen: "2022-08-08",
      sourceUrl: "https://www.treasury.gov/ofac/downloads/sdn.csv",
      details: "TORNADO CASH — OFAC SDN, program(s): CYBER2; asset: ETH",
    },
  ]);
  recordSnapshot(theDb, "OFAC_SDN", "ok", 1);
  recordSnapshot(theDb, "SCAMSNIFFER", "ok", 0);
  recordSnapshot(theDb, "MEW_DARKLIST", "ok", 0);
}

before(async () => {
  const made = createApp({ dbPath: ":memory:", payTo: null });
  db = made.db;
  seed(db);
  srv = made.app.listen(0);
  await new Promise((r) => srv.once("listening", r));
  base = `http://127.0.0.1:${srv.address().port}`;
});

after(() => {
  srv.close();
  db.close();
});

test("known OFAC address -> flagged with correct provenance", async () => {
  const res = await fetch(`${base}/v1/screen/${BAD}`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.verdict, "flagged");
  assert.equal(body.address, `eip155:8453:${BAD_KEY}`);
  assert.equal(body.findings.length, 1);
  assert.equal(body.findings[0].source, "OFAC_SDN");
  assert.equal(body.findings[0].category, "sanctions");
  assert.equal(body.findings[0].source_url, "https://www.treasury.gov/ofac/downloads/sdn.csv");
  assert.ok(body.findings[0].source_snapshot_time);
  assert.deepEqual(body.sources_checked, ["OFAC_SDN", "SCAMSNIFFER", "MEW_DARKLIST"]);
  assert.deepEqual(body.sources_stale, []);
  assert.match(body.disclaimer, /Not a safety determination/);
  assert.ok(body.receipt.id.startsWith("rcpt_"));
});

test("fresh random address -> no_findings (never 'clean')", async () => {
  const res = await fetch(`${base}/v1/screen/${CLEAN}`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.verdict, "no_findings");
  assert.equal(body.findings.length, 0);
  assert.ok(!JSON.stringify(body).includes('"clean"'));
});

test("garbage input -> 400", async () => {
  for (const bad of ["not-an-address", "0x123"]) {
    const res = await fetch(`${base}/v1/screen/${encodeURIComponent(bad)}`);
    assert.equal(res.status, 400, `expected 400 for ${bad}`);
    const body = await res.json();
    assert.ok(body.error);
  }
});

test("non-EVM address checked against OFAC only", async () => {
  const res = await fetch(`${base}/v1/screen/1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa`);
  const body = await res.json();
  assert.deepEqual(body.sources_checked, ["OFAC_SDN"]);
  assert.equal(body.verdict, "no_findings");
});

test("batch screens each address, invalid entries become per-item errors", async () => {
  const res = await fetch(`${base}/v1/screen/batch`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ addresses: [BAD, CLEAN, "garbage!!"] }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.count, 3);
  assert.equal(body.results[0].verdict, "flagged");
  assert.equal(body.results[1].verdict, "no_findings");
  assert.ok(body.results[2].error);
  assert.ok(body.results[0].receipt.id !== body.results[1].receipt.id);
});

test("batch rejects >50 addresses and malformed bodies", async () => {
  const many = Array.from({ length: 51 }, () => CLEAN);
  let res = await fetch(`${base}/v1/screen/batch`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ addresses: many }),
  });
  assert.equal(res.status, 400);
  res = await fetch(`${base}/v1/screen/batch`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ nope: true }),
  });
  assert.equal(res.status, 400);
});

test("all sources stale -> unknown; flagged still wins over stale", async () => {
  const made = createApp({ dbPath: ":memory:", payTo: null, sourceSlaHours: 48 });
  const stale = new Date(Date.now() - 100 * 3600e3).toISOString();
  made.db
    .prepare("INSERT INTO source_snapshots (source, snapshot_time, status, record_count) VALUES (?, ?, 'ok', 1)")
    .run("OFAC_SDN", stale);
  // SCAMSNIFFER / MEW never ingested -> stale too
  replaceSourceFindings(made.db, "OFAC_SDN", [
    { addressKey: BAD_KEY, chain: "eip155:*", category: "sanctions", firstSeen: "2022-08-08", sourceUrl: "https://x", details: null },
  ]);
  // restore snapshot after replaceSourceFindings (it doesn't touch snapshots, but re-check ordering)
  const s = made.app.listen(0);
  await new Promise((r) => s.once("listening", r));
  const b = `http://127.0.0.1:${s.address().port}`;

  const unknownRes = await (await fetch(`${b}/v1/screen/${CLEAN}`)).json();
  assert.equal(unknownRes.verdict, "unknown");
  assert.deepEqual(unknownRes.sources_stale, ["OFAC_SDN", "SCAMSNIFFER", "MEW_DARKLIST"]);

  const flaggedRes = await (await fetch(`${b}/v1/screen/${BAD}`)).json();
  assert.equal(flaggedRes.verdict, "flagged", "evidence still reported even when stale");

  s.close();
  made.db.close();
});

test("paid-mode app boots with x402 routes + bazaar extensions", () => {
  const made = createApp({
    dbPath: ":memory:",
    payTo: "0x1111111111111111111111111111111111111111",
  });
  assert.equal(made.paymentsEnabled, true);
  made.db.close();
});

test("health and sources endpoints are free and honest", async () => {
  const health = await (await fetch(`${base}/v1/health`)).json();
  assert.equal(health.ok, true);
  const sources = await (await fetch(`${base}/v1/sources`)).json();
  assert.equal(sources.sources.length, 3);
  assert.match(sources.receipt_signing.address, /^0x[0-9a-fA-F]{40}$/);
  assert.deepEqual(sources.verdicts, ["flagged", "no_findings", "unknown"]);
});
