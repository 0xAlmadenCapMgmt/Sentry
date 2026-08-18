# Sentry402 — Deployment (Stage 3, AWS Lightsail, testnet)

Goal of Stage 3: prove the agent can **communicate with and pay** a *cloud-hosted*
Sentry402 over public HTTPS — same 402 → settle → verify loop as Stage 2, but remote.
Still on Base Sepolia (free testnet money).

The image is host-agnostic ([`Dockerfile`](../Dockerfile)); these steps target AWS
Lightsail. `node:sqlite` needs no native build.

---

## Two sub-stages

| | What it proves | Storage | Use when |
|---|---|---|---|
| **3a** — Lightsail **Container Service** | Agent pays a public cloud URL end-to-end | Ephemeral (receipts reset on redeploy) | Proving the payment loop — **the Stage 3 goal** |
| **3b** — Lightsail **Instance + block-storage disk** | Same, with **durable** receipts + backups | Persistent volume at `/data` | Before Stage 4 / mainnet |

Container Service is stateless by design, so 3a is the fast path to the goal; 3b adds
durability. Do **not** go to mainnet on 3a — receipts (the product) must persist first.

---

## Secrets & env (both sub-stages)

Set these as service env vars / secrets — **never** in the image or git:

| Var | Value | Notes |
|---|---|---|
| `PAY_TO_ADDRESS` | `Sentry_AI_Rec_BaseSepTest` (see local `WALLETS.md`) | Receiving wallet; public |
| `RECEIPT_SIGNING_KEY` | **generate once, persist** (below) | Rotating it invalidates all prior receipts |
| `NETWORK` | `eip155:84532` | Base Sepolia |
| `FACILITATOR_URL` | `https://x402.org/facilitator` | Free testnet facilitator |
| `PORT` | `4023` | Container listens here |

`AGENT_PRIVATE_KEY` is **not** deployed — it belongs only to the buyer/test client.

Generate a persistent signing key locally and paste it into the service's secret store:
```
node -e "console.log(require('viem/accounts').generatePrivateKey())"
```
Publish nothing but the derived address — it already appears at `/v1/sources`.

---

## 3a — Lightsail Container Service

Prereqs: AWS account, AWS CLI + the `lightsailctl` plugin, Docker locally (to build).

```bash
# 1. Build the image
docker build -t sentry402 .

# 2. Create a container service (nano is plenty for this workload)
aws lightsail create-container-service \
  --service-name sentry402 --power nano --scale 1

# 3. Push the local image (returns a ref like :sentry402.sentry402.N)
aws lightsail push-container-image \
  --service-name sentry402 --label sentry402 --image sentry402:latest
```

Then create a deployment (via the console, or a `containers.json` + `public-endpoint.json`)
with:
- image = the pushed ref from step 3
- environment = the vars above (leave `DISABLE_AUTO_INGEST` **unset** so the container
  ingests on boot and on the 24 h interval — Container Service has no separate cron)
- public endpoint = container port `4023`, health check path `/v1/health`

Lightsail returns a managed HTTPS URL like `https://sentry402.<hash>.us-east-1.cs.amazonlightsail.com`.
Because we set `trust proxy`, receipt `verify_url`s and the 402 `resource.url` come back
as `https://` automatically.

### Verify 3a (the Stage 3 milestone)
```bash
PUB=https://sentry402.<hash>.<region>.cs.amazonlightsail.com
curl -s $PUB/v1/health
curl -s $PUB/v1/sources | grep -o '"stale":[a-z]*' | sort | uniq -c   # freshness

# The real test: buyer pays the CLOUD url (run from anywhere; keys stay local)
SENTRY402_URL=$PUB node agent.js
# expect: FLAGGED verdict, "Settled on-chain: tx 0x…", receipt signature VALID
```
If that settles and verifies, Stage 3's goal is met: agent ↔ cloud payment works.

---

## 3b — Durable receipts (before mainnet)

Container Service can't persist SQLite. Two options:

1. **Lightsail Instance + block-storage disk** (keeps SQLite): launch a small instance,
   attach a disk, mount at `/data`, run the same image with `-v /data:/data` and
   `DB_PATH=/data/sentry402.db`. Front it with Caddy for automatic HTTPS (a hostname —
   a real domain, or `<ip>.sslip.io` to avoid buying one). Move ingestion to the box's
   `cron` (`npm run ingest`) and set `DISABLE_AUTO_INGEST=1`.
2. **Managed DB** (Postgres/Turso): survives statelessly but is a code change
   (`node:sqlite` → a network client). Defer unless horizontal scale is needed.

### Off-host receipt backup (either option)
Receipts cannot be regenerated. Schedule a daily backup + sync:
```bash
BACKUP_DIR=/data/backups npm run backup
aws s3 sync /data/backups s3://<your-bucket>/sentry402-receipts/
```

---

## Stage 4 preview (mainnet)
Once 3b is durable: `NETWORK=eip155:8453`, CDP facilitator via `@coinbase/x402`
(`CDP_API_KEY_ID` / `CDP_API_KEY_SECRET` in secrets), move the signing key to **AWS KMS**,
add rate-limiting on free endpoints, legal review of the disclaimer, then confirm the
Bazaar catalog listing after the first settled mainnet payment.
