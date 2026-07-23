/**
 * agent.js — example buyer: what "an agent screening a counterparty" looks like.
 *
 * 1. Reads /v1/sources (free) — freshness + the receipt-signing pubkey.
 * 2. Screens an address. With AGENT_PRIVATE_KEY set, the wrapped fetch handles
 *    the 402 (signs a USDC transfer authorization and retries). Against a
 *    dev-mode server it just works without payment.
 * 3. Independently verifies the attestation receipt signature.
 *
 * Usage:
 *   node agent.js [address]        (default: an OFAC-listed Tornado Cash address)
 */
require("dotenv").config();
const { verifyReceipt } = require("./src/receipts");

const BASE_URL = process.env.SENTRY402_URL || "http://localhost:4023";
const NETWORK = process.env.NETWORK || "eip155:84532";
// Lazarus Group (Ronin bridge exploiter) — on the OFAC SDN list. A reliable "flagged".
// (Don't use Tornado Cash addresses as demos: OFAC delisted them in March 2025.)
const DEFAULT_TARGET = "0x098B716B8Aaf21512996dC57EB0615e2383E2f96";

async function buildFetch() {
  const pk = process.env.AGENT_PRIVATE_KEY;
  if (!pk) {
    console.log("(no AGENT_PRIVATE_KEY — using plain fetch; fine against a dev-mode server)\n");
    return fetch;
  }
  const { wrapFetchWithPayment, x402Client } = require("@x402/fetch");
  const { ExactEvmScheme } = require("@x402/evm/exact/client");
  const { privateKeyToAccount } = require("viem/accounts");
  const signer = privateKeyToAccount(pk);
  console.log(`Agent wallet: ${signer.address}\n`);
  const client = new x402Client().register(NETWORK, new ExactEvmScheme(signer));
  return wrapFetchWithPayment(fetch, client);
}

async function main() {
  const target = process.argv[2] || DEFAULT_TARGET;
  const fetchWithPay = await buildFetch();

  // 1. Free trust page: what gets checked, how fresh, who signs.
  const sources = await (await fetch(`${BASE_URL}/v1/sources`)).json();
  console.log("Sources:");
  for (const s of sources.sources) {
    const age = s.snapshot_time
      ? `${((Date.now() - Date.parse(s.snapshot_time)) / 3600e3).toFixed(1)}h old`
      : "never ingested";
    console.log(`  ${s.stale ? "STALE" : "fresh"}  ${s.source.padEnd(14)} ${String(s.record_count).padStart(6)} records  ${age}`);
  }
  console.log(`Receipts signed by: ${sources.receipt_signing.address}\n`);

  // 2. Paid screen (the 402 negotiation happens inside fetchWithPay).
  console.log(`Screening ${target} ...`);
  const res = await fetchWithPay(`${BASE_URL}/v1/screen/${target}`);
  if (!res.ok) {
    console.error(`Failed: ${res.status} ${await res.text()}`);
    process.exit(1);
  }
  const settlementHeader = res.headers.get("payment-response");
  if (settlementHeader) {
    try {
      const s = JSON.parse(Buffer.from(settlementHeader, "base64").toString());
      console.log(`Settled on-chain: tx ${s.transaction}`);
      if (NETWORK === "eip155:84532") console.log(`  https://sepolia.basescan.org/tx/${s.transaction}`);
    } catch {
      console.log("Settled (payment-response header present).");
    }
  }

  const report = await res.json();
  console.log(`\nVerdict: ${report.verdict.toUpperCase()}`);
  for (const f of report.findings) {
    console.log(`  - [${f.source}] ${f.category} · first_seen ${f.first_seen} · snapshot ${f.source_snapshot_time}`);
    if (f.details) console.log(`      ${f.details}`);
  }
  if (report.findings.length === 0) console.log("  (no findings on checked sources)");
  console.log(`Sources checked: ${report.sources_checked.join(", ")}${report.sources_stale.length ? `  (stale: ${report.sources_stale.join(", ")})` : ""}`);

  // 3. Verify the attestation independently: recompute hashes from the payload,
  //    recover the signer, compare with the published key.
  const { receipt, ...payload } = report;
  const check = await verifyReceipt(payload, receipt.signature, sources.receipt_signing.address);
  console.log(`\nReceipt ${receipt.id}`);
  console.log(`  payload_hash ${receipt.payload_hash === check.payloadHash ? "matches" : "MISMATCH!"}`);
  console.log(`  signature    ${check.valid ? "VALID" : "INVALID"} (recovered ${check.recovered})`);
  console.log(`  verify later: ${receipt.verify_url}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
