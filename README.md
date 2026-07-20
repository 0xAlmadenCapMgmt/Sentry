# Sentry402

**x402-native counterparty address screening for agents. Evidence, never clearance.**

A pay-per-call API ($0.005/check, USDC on Base over [x402](https://x402.org)) where an
agent submits a blockchain address and receives a structured, timestamped, **signed**
risk-evidence report before it transacts. No accounts, no API keys — the payment is
the rate limit.

Positioning invariants (do not violate):

1. **Evidence, never clearance.** Verdicts are `flagged` | `no_findings` | `unknown`.
   There is no `clean` — reports state what public sources say at a point in time,
   never "safe" or "approved".
2. Every response embeds a **signed attestation receipt**. The durable product is the
   audit trail, not the lookup.
3. All data sources are **public / permissively licensed**, with provenance recorded
   per finding. Findings from different sources are never merged.

## Endpoints

| | Endpoint | Price |
|---|---|---|
| free | `GET /` | landing page |
| free | `GET /v1/health` | |
| free | `GET /v1/sources` | source list + freshness + receipt-signing pubkey (the trust page) |
| free | `GET /v1/receipts/:id` | verify a past attestation |
| paid | `GET /v1/screen/:address` | $0.005 |
| paid | `POST /v1/screen/batch` | $0.02, ≤ 50 addresses (each result gets its own receipt) |

Addresses: bare EVM hex (`0xabc…`), CAIP-10 (`eip155:8453:0xabc…`), or base58/bech32
(BTC, TRX, … — OFAC coverage only). EVM findings are matched on the hex address across
all EVM chains. Garbage input is rejected with a 400 **before** the payment gate.

`unknown` = every applicable source's snapshot is older than the SLA (default 48h) —
the check ran, so it is still charged, but agents can route on the honesty.
A `flagged` finding is still reported even when its source is stale.

## Data sources (v1)

| Source | What | Refresh |
|---|---|---|
| `OFAC_SDN` | U.S. Treasury SDN list — digital currency addresses (sanctions) | daily |
| `SCAMSNIFFER` | ScamSniffer open scam database — drainer/phishing addresses (MIT) | daily |
| `MEW_DARKLIST` | MyEtherWallet ethereum-lists darklist — community scam reports (MIT) | daily |

CryptoScamDB was in the original spec but its API is dead (verified 502, 2026-07-15);
MEW_DARKLIST fills that slot. Adding a source = one adapter file in `src/sources/`
exporting `{ name, description, url, dataUrl, refresh, namespaces, fetchRecords }`.

`first_seen` caveat: OFAC and ScamSniffer publish no per-address listing dates, so
`first_seen` there is the date *this instance* first ingested the record (MEW provides
real dates). It is preserved across re-ingestions; delisted records are deleted.

## Receipts

- `payload_hash` = `sha256(canonical_json(report-without-receipt))`
- `signature` = secp256k1 signature over `keccak256(canonical_json)` by the server key
  (viem `account.sign`); canonical JSON = recursively sorted keys, no whitespace.
- The signing address is published at `/v1/sources`; `agent.js` shows independent
  verification with `recoverAddress`. Receipts persist in SQLite and are served at
  `/v1/receipts/:id` forever.
- Set `RECEIPT_SIGNING_KEY` in production — without it a fresh ephemeral key is
  generated each boot (receipts won't verify across restarts; `/v1/sources` flags this
  with `ephemeral_key: true`).

## Run it

```bash
npm install
npm run ingest        # pull OFAC + ScamSniffer + MEW into SQLite (data/sentry402.db)
npm start             # DEV MODE (no payment gate) until PAY_TO_ADDRESS is set
node agent.js         # buyer demo: screens an OFAC-listed Lazarus address, verifies receipt
npm test              # 21 tests: parsing, verdicts, 400s, staleness, receipt round-trip
```

The server auto-ingests on boot when data is missing/stale and re-ingests every
`INGEST_INTERVAL_HOURS` (default 24) in-process; for real deployments point a cron at
`npm run ingest` and set `DISABLE_AUTO_INGEST=1`.

### Enable payments (testnet — milestone 3)

Copy `.env.example` to `.env`, set `PAY_TO_ADDRESS` (your receiving wallet). Defaults
use Base Sepolia + the free `https://x402.org/facilitator`. Fund a second wallet with
testnet USDC (CDP faucet), set `AGENT_PRIVATE_KEY`, and `node agent.js` performs the
full 402 → sign → settle → verify loop.

### Mainnet (milestone 5 — not yet done)

- `NETWORK=eip155:8453`, CDP facilitator via `@coinbase/x402` (`CDP_API_KEY_ID/SECRET`).
- Bazaar discovery metadata is already declared on both paid routes
  (`@x402/extensions/bazaar`), so the CDP facilitator should auto-catalog the service
  after the first settled mainnet payment — confirm it appears.
- Legal review of the disclaimer language before launch.

## Layout

```
server.js            app factory + x402 gate + routes (TollBooth pattern)
agent.js             example buyer with independent receipt verification
src/config.js        env config
src/db.js            SQLite (node:sqlite) — findings, snapshots, receipts
src/normalize.js     address parsing/normalization (400s live here)
src/canonical.js     deterministic JSON for hashing/signing
src/receipts.js      sign / store / verify attestations
src/screen.js        verdict logic
src/ingest.js        ingestion worker (cron-able CLI + in-process schedule)
src/sources/*.js     one adapter per public source
public/index.html    landing page; the sources-freshness board IS the marketing
test/                node --test suite
```
