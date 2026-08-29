# Sentry402 — Test Log & Status

_Last updated: 2026-07-23_

Companion to [`README.md`](../README.md) (architecture) and [`SPEC`](../README.md). This
document records **what has been tested, the actual results, and the planned path to
production.** Positioning invariant throughout: Sentry402 sells **evidence, never
clearance** — verdicts are `flagged | no_findings | unknown`, every response carries a
signed attestation receipt, and the durable product is the audit trail.

---

## 1. Stage model

We test in stages, cheapest and lowest-risk first, deliberately separating "does it run"
from "does the money work" from "does it run remotely" from "is it real money."

| Stage | Scope | Status |
|---|---|---|
| **1** | Ingestion + SQLite + screening logic, no payments | ✅ Done & verified |
| **2** | x402 payment gate on **testnet** (Base Sepolia), real settlement | ✅ **Done & verified 2026-07-23** |
| **3a** | **Cloud hosting** — public endpoint on AWS, agent pays it on testnet | ✅ **Done & verified 2026-08-29** |
| **3b** | Hardening — HTTPS/TLS (Caddy + auto-cert) + off-host backups (auto-snapshots + daily receipt dump) | ✅ **Done 2026-08-29** |
| **4** | **Mainnet** (Base) + CDP facilitator + Bazaar catalog + KMS | ◻️ Planned |

Stages 3 and 4 are intentionally split so that infrastructure problems (DNS, TLS,
persistence, ingestion scheduling) are diagnosed on free testnet money before real funds
are involved. Stage 4 should then be a **config/secrets change on already-proven infra**,
not a fresh deploy.

---

## 2. Tests run and results

### 2.1 Automated test suite — ✅ 21/21 passing
`npm test` (`node --test`). Coverage:

- **Address normalization** — bare EVM hex, CAIP-10, Bitcoin/Tron base58, bech32; garbage
  rejected with `InvalidAddressError`.
- **OFAC CSV parser** — extracts EVM + non-EVM addresses from SDN "Remarks", handles quoted
  fields with embedded commas, dedupes.
- **Screening verdicts** — known-listed → `flagged` with correct provenance; fresh address →
  `no_findings` (asserts the word `"clean"` never appears); garbage → HTTP 400; non-EVM →
  checked against OFAC only; all-sources-stale → `unknown`; `flagged` still wins when stale.
- **Batch** — per-item results, invalid entries become per-item errors, >50 rejected.
- **Receipts** — sign → fetch → independently verify signature; **tampered payload fails
  verification**; unknown id → 404.
- **Payments** — paid-mode app boots with x402 routes + Bazaar extensions.

### 2.2 Live data ingestion — ✅
`npm run ingest` pulled all three public sources into SQLite (`data/sentry402.db`):

| Source | Records | License |
|---|---|---|
| `OFAC_SDN` (US Treasury sanctions) | **448** | Public (US Gov) |
| `SCAMSNIFFER` (drainer/phishing) | **2,530** | MIT |
| `MEW_DARKLIST` (community scam reports) | **652** | MIT |

Total findings in store: **3,630**. (OFAC grew 441→448 between 2026-07-19 and 07-23 — the
list is genuinely live.) Note: CryptoScamDB from the original spec is dead (API returns 502,
verified 2026-07-15); `MEW_DARKLIST` replaces it.

### 2.3 Local screening (dev mode, no payments) — ✅
- OFAC-listed Lazarus Group address → `verdict: flagged`, source `OFAC_SDN`, category
  `sanctions`, correct `source_url` and snapshot time.
- Random fresh address → `no_findings`.
- `garbage` → HTTP 400 **before** any payment logic (garbage is never charged).
- Batch of `[flagged, no_findings, garbage]` → 3 results, each valid item with its own receipt.

### 2.4 Payment-gate smoke test (payments on, no money spent) — ✅
Booted with `PAY_TO_ADDRESS` set; requested a paid route with no payment. Decoding the
`402 Payment Required` challenge confirmed the economics and discovery metadata:

- `amount: "5000"` → 5000 ÷ 10⁶ decimals = **$0.005 USDC** ✓
- `asset: 0x036CbD…CF7e` = canonical **Base Sepolia USDC** contract ✓
- `payTo`, `network: eip155:84532`, `maxTimeoutSeconds: 60` ✓
- `extensions.bazaar` (input/output JSON schemas) embedded in the challenge → **Bazaar
  discovery is live** and will auto-catalog the service on first mainnet settlement ✓

Free endpoints (`/v1/health`, `/v1/sources`, `/v1/receipts/:id`) stayed open.

### 2.5 Stage 2 — real testnet payment, end-to-end — ✅ **PASSED**
`node agent.js` ran the full loop against Base Sepolia via the free x402.org facilitator.

**Wallets** (MetaMask, Base Sepolia). Addresses are kept out of this public repo; the
labeled registry with addresses lives only in the local, git-ignored `docs/WALLETS.md`:
- `Sentry_AI_Send_BaseSepTest` — buyer / agent (maps to `AGENT_PRIVATE_KEY`, key in `.env` only)
- `Sentry_AI_Rec_BaseSepTest` — service `PAY_TO` (receive only; no key)

**Result of the loop:** `402` challenge → buyer signs an EIP-3009 `transferWithAuthorization`
(gasless for the payer — the facilitator submits and pays gas) → facilitator settles 0.005
USDC on-chain → server returns the `flagged` report → agent independently verifies the
receipt signature.

| Check | Evidence |
|---|---|
| Funds moved on-chain | buyer **1 → 0.995 USDC**, receiver **0 → 0.005** (per call) |
| Verdict correct | `flagged` — Lazarus Group, OFAC SDN, with provenance |
| Receipt signature | recovers to the server's published signing address ✓ |
| Buyer needs no ETH | held 0 ETH; gasless scheme confirmed ✓ |
| Settlement tx | recorded in local `WALLETS.md` / receipt `payment_ref`; omitted here (resolves to the wallet addresses on-chain) |

**Cumulative:** 4 settled payments during testing = **0.02 USDC** moved buyer→receiver;
buyer balance now 0.98 USDC. All 4 settled successfully.

### 2.6 Bug found and fixed during Stage 2
The x402 **v2** settlement header is named **`payment-response`** (base64 JSON:
`{success, payer, transaction, network}`), **not** the pre-v2 `x-payment-response`. Both
`agent.js` and `server.js` read the old name, silently dropping the on-chain tx reference.

Fixed (commit `5050b63`):
- `agent.js` now prints the settlement tx + BaseScan link.
- `server.js` hooks `res.on("finish")` to decode the header and store the settlement JSON in
  each receipt's `payment_ref` (single + batch) — **so every receipt now links to the
  on-chain transaction that paid for it.** This closes the loop on the "audit trail is the
  product" thesis.
- `src/db.js` gained `updateReceiptPaymentRef`.

Verified: `payment_ref` populated with the on-chain settlement tx; 21 tests still green.

### 2.7 Stage 3a — cloud deployment, end-to-end — ✅ **PASSED (2026-08-29)**
The service now runs on **AWS Lightsail** (a Docker container from
`ghcr.io/0xalmadencapmgmt/sentry`, built by GitHub Actions), reachable over the public
internet with the x402 gate on, a **persistent** signing key, and a **durable volume** for
the DB + receipts.

- Public `/v1/health` → `200` with the payment gate active (`eip155:84532`).
- Ingestion runs on the box (OFAC/ScamSniffer/MEW; OFAC now 479 — live).
- **The buyer agent, over the internet, paid the cloud service end-to-end:** 402 →
  EIP-3009 authorization → on-chain settlement on Base Sepolia → `flagged` report →
  receipt signature **verified** against the published key, with `payment_ref` linking the
  settlement tx. (Endpoint/tx specifics kept in the local, git-ignored registry.)

Note: 3a runs plain HTTP; TLS is the 3b hardening step. AWS put a 0-quota on Lightsail
*container services* for this (new) account, so the deploy uses a Lightsail **instance**
(VM) running the same image — which also gives the durable volume 3b wanted.

---

## 3. Repository state

- GitHub: **https://github.com/0xAlmadenCapMgmt/Sentry** (branch `main`, in sync).
- Commit identity scrubbed to `0xAlmadenCapMgmt` with empty email (prior local-machine
  "Jason" identity was rewritten out of all history).
- Commits: `853e92e` (v0.1) → `e698768` / `cd9df37` (ignore hygiene) → `5050b63`
  (settlement-tx capture).
- Secrets: `.env` is git-ignored and never committed. The server holds only the
  receipt-signing key (**holds no funds**); the funded buyer key lives only in the test
  client's `.env`.

**Current infrastructure: local only.** Nothing is hosted yet — that is Stage 3.

---

## 4. Planned next steps

### Stage 3 — Cloud hosting (testnet)
Goal: the exact Stage-2 loop, but `agent.js` pays a **public HTTPS URL** instead of
localhost. Requires (mostly host-agnostic):

1. **Persistent storage for the DB.** Findings are disposable (re-ingest), but **receipts
   cannot be regenerated** — they are signed attestations tied to payments. Needs a
   persistent volume/disk **plus off-host backups** (e.g., daily receipts dump to object
   storage).
2. **Persistent, secret-managed `RECEIPT_SIGNING_KEY`.** Today it is ephemeral per boot;
   in cloud that would rotate the key on every restart and invalidate all prior receipts.
   One key, injected via the host's secret store, pubkey published at `/v1/sources`.
3. **Ingestion scheduling.** Keep in-process on a single always-on instance (simplest), or
   move to a platform scheduled job against a shared DB.
4. **Code:** `app.set('trust proxy', true)` (so `req.protocol` is `https` behind a load
   balancer — otherwise 402 `resource.url` and receipt `verify_url` come out as `http`),
   a portable **Dockerfile** + `.dockerignore`, and the daily backup job.

**Host decision (open).** All options consume the same Dockerfile, so the choice is
reversible.

| Option | Fit for this service | Cost | Trade-off |
|---|---|---|---|
| **AWS Lightsail** | "AWS but simple" VPS/container + disk | ~$5–7/mo | Ecosystem fit; a bit more setup than PaaS |
| **AWS EC2** | Raw VM, full control, EBS + snapshots | ~$5–10/mo | Most ops (you own TLS, patching) |
| **AWS ECS + RDS** | Container-native, scalable | Higher (ALB ~$16/mo floor) | Overkill today; right for real scale |
| **Fly.io** | Always-on instance + volume; best small-stateful fit | ~$3–5/mo | CLI-centric |
| **Railway** | Fastest to a live URL, push-to-deploy | ~$5/mo | Volume binds to one service |
| **Render** | First-class Cron Jobs + `render.yaml` | ~$7–10/mo | Priciest; must use paid tier |

**Notes for the decision:** account already exists on **AWS**. If this is intended firm
infrastructure, AWS wins on ecosystem + governance, and unlocks **KMS** to hold the
secp256k1 signing key so it never enters app memory (a real upgrade for a signing service),
plus **S3** for receipt backups and **Secrets Manager** for CDP keys. Simplest AWS path:
**Lightsail** now → **ECS/RDS/KMS** if it becomes production. If the priority is proving the
x402 model remotely with minimal ops, **Railway/Fly** ship today for ~$5 and migrate to AWS
later cheaply (it's the same container).

### Stage 4 — Mainnet + hardening
- Switch `NETWORK=eip155:8453`; CDP facilitator via `@coinbase/x402`
  (`CDP_API_KEY_ID` / `CDP_API_KEY_SECRET`).
- Confirm the service appears in the **Bazaar catalog** after the first settled mainnet
  payment (discovery metadata already declared and verified embedded in the 402 challenge).
- **KMS-backed signing** (if on AWS) — sign receipts via KMS instead of a local key.
- Basic **rate-limiting** on the free endpoints (paid routes are self-limiting by design).
- **Legal review of the disclaimer** language before launch.

---

## 5. Open questions
- **Host** — AWS (Lightsail vs ECS/RDS) vs Fly/Railway. Weighs ecosystem/governance vs.
  speed-to-live.
- **Batch pricing** — flat $0.02 / 50 vs per-address; measure settlement latency under batch.
- **Free demo check** vs. "payment is the rate limit" (cleaner story) for marketing.
- **Signing-key custody** — env-var vs KMS/HSM from the start.
- **Receipt backup** cadence and destination.

---

## 6. Known caveats
- `node:sqlite` is single-writer — fine for one instance, does not support horizontal
  scaling. Defer a managed DB (Postgres / Turso) until traffic requires it.
- `first_seen` for OFAC and ScamSniffer is the date **this instance** first ingested the
  record (those feeds publish no per-address listing dates); MEW provides real dates.
  Preserved across re-ingestions; delisted records are deleted.
- Free endpoints are currently unauthenticated and unthrottled — add rate-limiting before
  mainnet.
