# Sentry402 — Progress to Date

_As of 2026-08-29. This is a public progress summary; it deliberately contains **no**
account identifiers, endpoints, wallet addresses, transaction hashes, keys, or other
secrets._

## What Sentry402 is

A pay-per-call API where an autonomous agent submits a blockchain address and receives a
structured, timestamped, **signed** risk-evidence report before it transacts with that
counterparty. Sold over the **x402** protocol (USDC on Base). No accounts, no API keys —
the payment is the rate limit.

Positioning invariant, upheld throughout: **evidence, never clearance.** Verdicts are
`flagged | no_findings | unknown` — never "safe" or "clean." Every response carries a
signed attestation receipt; the durable product is the audit trail, not the lookup. All
data sources are public/permissively licensed, with provenance attributed per finding.

## Milestone progress

| Stage | Scope | Status |
|---|---|---|
| **1** | Ingestion + storage + screening logic (no payments) | ✅ Done & verified |
| **2** | x402 payment gate on testnet, real on-chain settlement | ✅ Done & verified |
| **3a** | Cloud deployment; agent pays the hosted service over the internet | ✅ **Done & verified** |
| **3b** | Hardening — HTTPS/TLS in front, scheduled off-host receipt backups | ◻️ Next |
| **4** | Mainnet + CDP facilitator + discovery catalog + key custody hardening | ◻️ Planned |

## What has been built and verified

### Stage 1 — Core service ✅
- **Ingestion worker** pulling three public risk sources into a local store, with
  per-record provenance (source, category, first-seen, source URL, snapshot time). Sources
  are never merged — findings stay attributed.
- **Screening logic** with a strict verdict model (`flagged | no_findings | unknown`);
  unrecognized input is rejected before any billing.
- **Signed attestation receipts** — each report is hashed and signed; anyone can
  independently recover the signer and verify integrity.
- **Automated test suite: 21 tests passing** — address parsing, source parsing, verdict
  logic, staleness handling, input rejection, and receipt sign/verify round-trips
  (including tamper detection).

### Stage 2 — Payments on testnet ✅
- x402 payment gate wired in; unpaid requests receive a well-formed `402` challenge
  carrying exact payment requirements and machine-readable discovery metadata.
- **Real end-to-end settlement on a test network:** an agent signs a gasless payment
  authorization, a facilitator settles the transfer on-chain, and the service returns the
  signed report. Each receipt is linked to its on-chain settlement transaction, closing the
  loop between "what was paid" and "what evidence was issued."
- Multiple testnet settlements completed successfully.

### Stage 3a — Cloud deployment ✅
- Service **containerized** with a portable image built automatically in CI.
- Deployed to **AWS** and reachable over the **public internet**, with the payment gate
  active, a **persistent** signing key, and a **durable volume** so the store and receipts
  survive restarts.
- **Milestone proven:** a buyer agent, running remotely, paid the *cloud-hosted* service
  end-to-end — 402 → on-chain settlement → signed report → receipt verified against the
  service's published key, with the settlement transaction linked into the stored receipt.
- Data ingestion runs on the deployed instance and stays current.

## Architecture (summary)

- **API:** Express with the x402 resource-server middleware; free endpoints for health,
  source freshness (the trust page), and receipt verification; paid endpoints for single
  and batch screening.
- **Storage:** a single-file embedded database (no external DB dependency) holding
  findings, ingestion snapshots, and receipts.
- **Signing:** an EVM keypair signs a canonical hash of each report; the public key is
  published so receipts verify without trusting the server.
- **Discovery:** each paid route declares input/output schemas so the payment network can
  auto-catalog the service after its first settled payment.
- **Data sources (v1):** a government sanctions list plus two permissively licensed
  community scam/phishing registries; each finding records its own source and snapshot
  time. Freshness is surfaced in every response and on the public trust page.

## What's next

- **Stage 3b — hardening:** put TLS/HTTPS in front of the service; schedule recurring,
  off-host backups of the receipts (they cannot be regenerated).
- **Stage 4 — mainnet:** switch to the production network and facilitator, move the signing
  key into a managed key service, add rate-limiting on the free endpoints, complete a legal
  review of the disclaimer language, and confirm the service appears in the discovery
  catalog after the first settled production payment.

## Verification at a glance

| Claim | How it's been proven |
|---|---|
| Core logic correct | 21 automated tests passing |
| Real data ingested | Live pulls from all three public sources |
| Payments work | Real on-chain settlements on a test network |
| Receipts are trustworthy | Independent signature recovery; tamper tests fail as expected |
| Runs in the cloud | Public deployment; remote agent paid it end-to-end |
| Audit trail complete | Each receipt links its on-chain settlement transaction |
