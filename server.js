/**
 * Sentry402 — x402-native counterparty address screening for agents.
 *
 * Sells evidence, never clearance: "address X appears / does not appear on
 * sources A, B, C as of time T", signed. Verdicts: flagged | no_findings |
 * unknown. There is no "clean".
 *
 * Free:  GET  /              landing page
 *        GET  /v1/health
 *        GET  /v1/sources    source list + freshness + signing pubkey (the trust page)
 *        GET  /v1/receipts/:id  verify a past attestation
 * Paid:  GET  /v1/screen/:address   $0.005
 *        POST /v1/screen/batch      $0.02  (<= 50 addresses)
 *
 * With PAY_TO_ADDRESS unset the server boots in DEV MODE (no payment gate).
 */
const express = require("express");
const path = require("path");

const defaults = require("./src/config");
const { openDb, latestOkSnapshot, latestSnapshot, countFindings, getReceipt } = require("./src/db");
const { screenAddress } = require("./src/screen");
const { makeSigner, issueReceipt, SIGNING_SCHEME } = require("./src/receipts");
const { parseAddress, InvalidAddressError } = require("./src/normalize");
const { SOURCES } = require("./src/sources");
const { ingestAll } = require("./src/ingest");
const pkg = require("./package.json");

const EXAMPLE_REPORT = {
  address: "eip155:8453:0x098b716b8aaf21512996dc57eb0615e2383e2f96",
  verdict: "flagged",
  findings: [
    {
      source: "OFAC_SDN",
      category: "sanctions",
      chain: "eip155:*",
      first_seen: "2026-07-15",
      source_url: "https://www.treasury.gov/ofac/downloads/sdn.csv",
      source_snapshot_time: "2026-07-19T04:00:00Z",
    },
  ],
  sources_checked: ["OFAC_SDN", "SCAMSNIFFER", "MEW_DARKLIST"],
  sources_stale: [],
  checked_at: "2026-07-19T06:12:03Z",
  disclaimer: "Evidence of presence/absence on listed public sources at the stated time. Not a safety determination, not financial or legal advice.",
  receipt: {
    id: "rcpt_9f2c0a1b2c3d4e5f60718293",
    payload_hash: "sha256:...",
    signature: "0x...",
    verify_url: "https://host/v1/receipts/rcpt_9f2c0a1b2c3d4e5f60718293",
  },
};

function createApp(overrides = {}) {
  const config = { ...defaults, ...overrides };
  const db = openDb(config.dbPath);
  const { account, ephemeral } = makeSigner(config.receiptSigningKey);
  const paymentsEnabled = Boolean(config.payTo);

  const app = express();
  app.use(express.json({ limit: "100kb" }));
  app.use(express.static(path.join(__dirname, "public")));

  // Input validation BEFORE the payment gate: garbage is a 400, never a charge.
  app.use("/v1/screen", (req, res, next) => {
    if (req.method === "GET") {
      const raw = decodeURIComponent(req.path.replace(/^\//, ""));
      if (raw !== "batch") {
        try {
          parseAddress(raw, config.defaultEvmChain);
        } catch (err) {
          return res.status(400).json({ error: err.message });
        }
      }
    } else if (req.method === "POST" && req.path === "/batch") {
      const body = req.body;
      if (!body || !Array.isArray(body.addresses)) {
        return res.status(400).json({ error: 'body must be JSON: {"addresses": ["0x...", ...]}' });
      }
      if (body.addresses.length === 0 || body.addresses.length > config.batchMax) {
        return res
          .status(400)
          .json({ error: `addresses must contain 1..${config.batchMax} entries` });
      }
    }
    next();
  });

  // ---------------------------------------------------------------------------
  // x402 payment gate (TollBooth pattern) + Bazaar discovery metadata
  // ---------------------------------------------------------------------------
  if (paymentsEnabled) {
    const { paymentMiddleware, x402ResourceServer } = require("@x402/express");
    const { ExactEvmScheme } = require("@x402/evm/exact/server");
    const { HTTPFacilitatorClient } = require("@x402/core/server");
    const {
      declareDiscoveryExtension,
      bazaarResourceServerExtension,
    } = require("@x402/extensions/bazaar");

    const facilitatorClient = new HTTPFacilitatorClient({ url: config.facilitatorUrl });
    const resourceServer = new x402ResourceServer(facilitatorClient).register(
      config.network,
      new ExactEvmScheme()
    );
    resourceServer.registerExtension(bazaarResourceServerExtension);

    const routes = {
      "GET /v1/screen/:address": {
        accepts: {
          scheme: "exact",
          price: config.screenPrice,
          network: config.network,
          payTo: config.payTo,
          maxTimeoutSeconds: 60,
        },
        description:
          "Screen one blockchain address against public risk sources (OFAC SDN sanctions, ScamSniffer phishing, MEW darklist). Returns attributed findings with provenance and a signed attestation receipt. Evidence, not clearance — verdicts are flagged | no_findings | unknown.",
        mimeType: "application/json",
        extensions: declareDiscoveryExtension({
          method: "GET",
          pathParams: { address: "0x098B716B8Aaf21512996dC57EB0615e2383E2f96" },
          pathParamsSchema: {
            properties: {
              address: {
                type: "string",
                description:
                  "EVM address (bare 0x hex or CAIP-10 eip155:<chain>:<0x...>), or base58/bech32 address (OFAC coverage only)",
              },
            },
            required: ["address"],
          },
          output: { example: EXAMPLE_REPORT },
        }),
      },
      "POST /v1/screen/batch": {
        accepts: {
          scheme: "exact",
          price: config.batchPrice,
          network: config.network,
          payTo: config.payTo,
          maxTimeoutSeconds: 60,
        },
        description: `Screen up to ${config.batchMax} addresses in one call. Each result carries its own signed attestation receipt.`,
        mimeType: "application/json",
        extensions: declareDiscoveryExtension({
          method: "POST",
          bodyType: "json",
          input: { addresses: ["0x098B716B8Aaf21512996dC57EB0615e2383E2f96"] },
          inputSchema: {
            properties: {
              addresses: {
                type: "array",
                items: { type: "string" },
                minItems: 1,
                maxItems: config.batchMax,
              },
            },
            required: ["addresses"],
          },
          output: { example: { count: 1, results: [EXAMPLE_REPORT] } },
        }),
      },
    };

    app.use(
      paymentMiddleware(routes, resourceServer, {
        appName: "Sentry402",
        testnet: config.network === "eip155:84532",
      })
    );
  }

  const baseUrlOf = (req) => `${req.protocol}://${req.get("host")}`;

  // ---------------------------------------------------------------------------
  // Free endpoints
  // ---------------------------------------------------------------------------
  app.get("/v1/health", (req, res) => {
    res.json({
      ok: true,
      service: "Sentry402",
      version: pkg.version,
      time: new Date().toISOString(),
      findings: countFindings(db),
      payments: paymentsEnabled ? { network: config.network } : "disabled (dev mode)",
    });
  });

  // The trust page: what we check, how fresh it is, and the key that signs receipts.
  app.get("/v1/sources", (req, res) => {
    const staleCutoff = Date.now() - config.sourceSlaHours * 3600 * 1000;
    res.json({
      service: "Sentry402",
      tagline: "x402-native counterparty address screening. Evidence, never clearance.",
      receipt_signing: {
        address: account.address,
        scheme: SIGNING_SCHEME,
        ephemeral_key: ephemeral, // true only in dev: receipts won't outlive a restart
      },
      sla_hours: config.sourceSlaHours,
      verdicts: ["flagged", "no_findings", "unknown"],
      prices: paymentsEnabled
        ? {
            "GET /v1/screen/:address": config.screenPrice,
            "POST /v1/screen/batch": `${config.batchPrice} (<=${config.batchMax} addresses)`,
            currency: "USDC",
            protocol: "x402",
            network: config.network,
            facilitator: config.facilitatorUrl,
          }
        : "payments disabled (dev mode)",
      sources: SOURCES.map((s) => {
        const ok = latestOkSnapshot(db, s.name);
        const last = latestSnapshot(db, s.name);
        return {
          source: s.name,
          description: s.description,
          url: s.url,
          data_url: s.dataUrl,
          refresh: s.refresh,
          namespaces: s.namespaces,
          record_count: ok ? ok.record_count : 0,
          snapshot_time: ok ? ok.snapshot_time : null,
          stale: !ok || Date.parse(ok.snapshot_time) < staleCutoff,
          last_attempt: last
            ? { time: last.snapshot_time, status: last.status, error: last.error || undefined }
            : null,
        };
      }),
    });
  });

  // Verify a past attestation. Anyone can recompute the hashes from `payload`
  // and recover the signer from `signature` — no trust in this server needed.
  app.get("/v1/receipts/:id", (req, res) => {
    const row = getReceipt(db, req.params.id);
    if (!row) return res.status(404).json({ error: "no such receipt" });
    res.json({
      id: row.id,
      payload: JSON.parse(row.payload_json),
      payload_hash: row.payload_hash,
      signature: row.signature,
      signer: row.signer,
      signing_scheme: SIGNING_SCHEME,
      payment_ref: row.payment_ref ? JSON.parse(row.payment_ref) : null,
      created_at: row.created_at,
      how_to_verify:
        "recoverAddress({ hash: keccak256(utf8(canonical_json(payload))), signature }) must equal `signer`; sha256(canonical_json(payload)) must equal `payload_hash`.",
    });
  });

  // ---------------------------------------------------------------------------
  // Paid endpoints (if payment gate is on, reaching here means it settled)
  // ---------------------------------------------------------------------------
  app.get("/v1/screen/:address", async (req, res, next) => {
    try {
      const report = screenAddress(db, req.params.address, config);
      const paymentRef = res.getHeader("X-PAYMENT-RESPONSE")
        ? JSON.stringify({ x_payment_response: String(res.getHeader("X-PAYMENT-RESPONSE")) })
        : null;
      const receipt = await issueReceipt(db, account, report, baseUrlOf(req), paymentRef);
      res.json({ ...report, receipt });
    } catch (err) {
      if (err instanceof InvalidAddressError) return res.status(400).json({ error: err.message });
      next(err);
    }
  });

  app.post("/v1/screen/batch", async (req, res, next) => {
    try {
      const baseUrl = baseUrlOf(req);
      const results = [];
      for (const input of req.body.addresses) {
        try {
          const report = screenAddress(db, input, config);
          const receipt = await issueReceipt(db, account, report, baseUrl, null);
          results.push({ ...report, receipt });
        } catch (err) {
          if (err instanceof InvalidAddressError) {
            results.push({ address: String(input).slice(0, 120), error: err.message });
          } else {
            throw err;
          }
        }
      }
      res.json({ count: results.length, results, checked_at: new Date().toISOString() });
    } catch (err) {
      next(err);
    }
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: "internal error" });
  });

  return { app, db, account, config, paymentsEnabled };
}

module.exports = { createApp };

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
if (require.main === module) {
  const { app, db, account, config, paymentsEnabled } = createApp();

  const scheduleIngest = () => {
    const staleCutoff = Date.now() - config.sourceSlaHours * 3600 * 1000;
    const needsIngest = SOURCES.some((s) => {
      const snap = latestOkSnapshot(db, s.name);
      return !snap || Date.parse(snap.snapshot_time) < staleCutoff;
    });
    const run = () =>
      ingestAll(db)
        .then((results) =>
          results.forEach((r) =>
            console.log(
              r.status === "ok"
                ? `  ingest ok    ${r.source} (${r.records} records)`
                : `  ingest ERROR ${r.source}: ${r.error}`
            )
          )
        )
        .catch((e) => console.error("  ingest crashed:", e));
    if (config.autoIngest && needsIngest) {
      console.log("  Data missing or stale — ingesting now...");
      run();
    }
    if (config.autoIngest) {
      setInterval(run, config.ingestIntervalHours * 3600 * 1000).unref();
    }
  };

  app.listen(config.port, () => {
    console.log(`Sentry402 running on http://localhost:${config.port}`);
    console.log(`  Receipts signed by: ${account.address}${config.receiptSigningKey ? "" : "  (EPHEMERAL dev key — set RECEIPT_SIGNING_KEY)"}`);
    if (paymentsEnabled) {
      console.log(`  Network:     ${config.network}${config.network === "eip155:84532" ? " (Base Sepolia testnet)" : ""}`);
      console.log(`  Pay to:      ${config.payTo}`);
      console.log(`  Facilitator: ${config.facilitatorUrl}`);
      console.log(`  Prices:      screen ${config.screenPrice} · batch ${config.batchPrice}`);
    } else {
      console.log("  DEV MODE — payment gate disabled (set PAY_TO_ADDRESS to enable x402)");
    }
    console.log(`  Sources:     http://localhost:${config.port}/v1/sources`);
    scheduleIngest();
  });
}
