const { test, before, after } = require("node:test");
const assert = require("node:assert");
const { createApp } = require("../server");
const { replaceSourceFindings, recordSnapshot } = require("../src/db");
const { verifyReceipt } = require("../src/receipts");

const BAD = "0x8589427373D6D84E98730D7795D8f6f8731FDA16";

let srv, base, db, signerAddress;

before(async () => {
  const made = createApp({ dbPath: ":memory:", payTo: null });
  db = made.db;
  signerAddress = made.account.address;
  replaceSourceFindings(db, "OFAC_SDN", [
    { addressKey: BAD.toLowerCase(), chain: "eip155:*", category: "sanctions", firstSeen: "2022-08-08", sourceUrl: "https://www.treasury.gov/ofac/downloads/sdn.csv", details: "TORNADO CASH" },
  ]);
  for (const s of ["OFAC_SDN", "SCAMSNIFFER", "MEW_DARKLIST"]) recordSnapshot(db, s, "ok", 1);
  srv = made.app.listen(0);
  await new Promise((r) => srv.once("listening", r));
  base = `http://127.0.0.1:${srv.address().port}`;
});

after(() => {
  srv.close();
  db.close();
});

test("receipt round-trip: screen -> fetch receipt -> verify signature", async () => {
  const report = await (await fetch(`${base}/v1/screen/${BAD}`)).json();
  const { receipt, ...payload } = report;

  // 1. Embedded receipt verifies against the live response payload.
  const inline = await verifyReceipt(payload, receipt.signature, signerAddress);
  assert.equal(inline.valid, true);
  assert.equal(inline.payloadHash, receipt.payload_hash);

  // 2. Stored receipt returns the same payload and verifies independently.
  const storedRes = await fetch(`${base}/v1/receipts/${receipt.id}`);
  assert.equal(storedRes.status, 200);
  const stored = await storedRes.json();
  assert.equal(stored.signer, signerAddress);
  assert.deepEqual(stored.payload, payload);
  const independent = await verifyReceipt(stored.payload, stored.signature, stored.signer);
  assert.equal(independent.valid, true);
  assert.equal(stored.payload_hash, receipt.payload_hash);
});

test("tampered payload fails verification", async () => {
  const report = await (await fetch(`${base}/v1/screen/${BAD}`)).json();
  const { receipt, ...payload } = report;
  payload.verdict = "no_findings"; // the forgery we exist to prevent
  const check = await verifyReceipt(payload, receipt.signature, signerAddress);
  assert.equal(check.valid, false);
});

test("unknown receipt id -> 404", async () => {
  const res = await fetch(`${base}/v1/receipts/rcpt_doesnotexist`);
  assert.equal(res.status, 404);
});

test("verify_url points at the receipts endpoint", async () => {
  const report = await (await fetch(`${base}/v1/screen/${BAD}`)).json();
  assert.match(report.receipt.verify_url, /\/v1\/receipts\/rcpt_[0-9a-f]{24}$/);
});
