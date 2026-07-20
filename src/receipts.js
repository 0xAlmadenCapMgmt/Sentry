/**
 * Signed attestation receipts — the durable product.
 *
 * payload_hash = sha256(canonical_json(report))            (integrity id)
 * signature    = secp256k1 sign of keccak256(canonical_json(report))
 *                by the server key (EVM raw-hash signature, viem account.sign)
 *
 * Verify: recoverAddress({ hash: keccak256(canonical_json), signature })
 * must equal the signing address published at /v1/sources.
 */
const crypto = require("crypto");
const { keccak256, stringToBytes, recoverAddress } = require("viem");
const { privateKeyToAccount, generatePrivateKey } = require("viem/accounts");
const { canonicalize } = require("./canonical");
const { insertReceipt } = require("./db");

const SIGNING_SCHEME =
  "secp256k1 signature over keccak256(canonical_json(payload)); canonical_json = JSON with recursively sorted keys, no whitespace";

function makeSigner(receiptSigningKey) {
  if (receiptSigningKey) {
    return { account: privateKeyToAccount(receiptSigningKey), ephemeral: false };
  }
  const account = privateKeyToAccount(generatePrivateKey());
  return { account, ephemeral: true };
}

function hashes(payload) {
  const canonical = canonicalize(payload);
  return {
    canonical,
    payloadHash: "sha256:" + crypto.createHash("sha256").update(canonical).digest("hex"),
    signDigest: keccak256(stringToBytes(canonical)),
  };
}

/** Sign a report, persist it, and return the receipt block to embed. */
async function issueReceipt(db, account, payload, baseUrl, paymentRef = null) {
  const { canonical, payloadHash, signDigest } = hashes(payload);
  const signature = await account.sign({ hash: signDigest });
  const id = "rcpt_" + crypto.randomBytes(12).toString("hex");
  insertReceipt(db, {
    id,
    payloadJson: canonical,
    payloadHash,
    signature,
    signer: account.address,
    paymentRef,
    createdAt: new Date().toISOString(),
  });
  return {
    id,
    payload_hash: payloadHash,
    signature,
    verify_url: `${baseUrl}/v1/receipts/${id}`,
  };
}

/** Independent verification helper (also used by agent.js and tests). */
async function verifyReceipt(payload, signature, expectedSigner) {
  const { signDigest, payloadHash } = hashes(payload);
  const recovered = await recoverAddress({ hash: signDigest, signature });
  return {
    valid: recovered.toLowerCase() === expectedSigner.toLowerCase(),
    recovered,
    payloadHash,
  };
}

module.exports = { makeSigner, issueReceipt, verifyReceipt, hashes, SIGNING_SCHEME };
