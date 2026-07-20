/**
 * Central config. Everything comes from env with sane defaults;
 * tests override via createApp() options instead of env.
 */
require("dotenv").config();
const path = require("path");

const ROOT = path.join(__dirname, "..");

module.exports = {
  port: parseInt(process.env.PORT || "4023", 10),

  // x402 / payments. If payTo is unset the server boots in DEV MODE with the
  // payment gate disabled (milestone-1 behavior).
  payTo: process.env.PAY_TO_ADDRESS || null,
  network: process.env.NETWORK || "eip155:84532", // Base Sepolia; mainnet = eip155:8453
  facilitatorUrl: process.env.FACILITATOR_URL || "https://x402.org/facilitator",
  screenPrice: process.env.SCREEN_PRICE || "$0.005",
  batchPrice: process.env.BATCH_PRICE || "$0.02",
  batchMax: 50,

  // Storage + signing
  dbPath: process.env.DB_PATH || path.join(ROOT, "data", "sentry402.db"),
  receiptSigningKey: process.env.RECEIPT_SIGNING_KEY || null,

  // Freshness SLA: a source whose newest successful snapshot is older than
  // this is reported in sources_stale. All-applicable-sources-stale => unknown.
  sourceSlaHours: parseFloat(process.env.SOURCE_SLA_HOURS || "48"),

  // Ingestion scheduling (in-process; a real cron can call `npm run ingest`)
  ingestIntervalHours: parseFloat(process.env.INGEST_INTERVAL_HOURS || "24"),
  autoIngest: process.env.DISABLE_AUTO_INGEST !== "1",

  // Bare EVM addresses are reported under this CAIP-2 namespace. Findings are
  // matched on the hex address across all EVM chains regardless.
  defaultEvmChain: process.env.DEFAULT_EVM_CHAIN || "eip155:8453",
};
