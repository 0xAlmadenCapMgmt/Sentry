/**
 * Address parsing + normalization.
 *
 * Accepted inputs:
 *   - bare EVM hex        0xAbC...            -> eip155:<default>:<lowercase>
 *   - CAIP-10 EVM         eip155:8453:0xabc.. -> eip155:8453:<lowercase>
 *   - base58 / bech32     (BTC, TRX, LTC, ...) kept verbatim, case-sensitive.
 *     These are covered by OFAC only ("other" namespace).
 *
 * Anything else is garbage -> InvalidAddressError -> HTTP 400 (rejected
 * BEFORE the payment gate so garbage is never charged).
 */
const EVM_BARE = /^0x[0-9a-fA-F]{40}$/;
const CAIP10_EVM = /^eip155:(\d{1,10}):(0x[0-9a-fA-F]{40})$/;
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{25,60}$/;
const BECH32 = /^(bc1|tb1|ltc1)[02-9ac-hj-np-z]{6,90}$/;

class InvalidAddressError extends Error {
  constructor(message) {
    super(message);
    this.name = "InvalidAddressError";
    this.status = 400;
  }
}

/**
 * @returns {{ caip10: string, addressKey: string, namespace: "evm"|"other" }}
 */
function parseAddress(input, defaultEvmChain) {
  if (typeof input !== "string") {
    throw new InvalidAddressError("address must be a string");
  }
  const raw = input.trim();
  if (raw.length === 0 || raw.length > 120) {
    throw new InvalidAddressError("address is empty or implausibly long");
  }

  if (EVM_BARE.test(raw)) {
    const key = raw.toLowerCase();
    return { caip10: `${defaultEvmChain}:${key}`, addressKey: key, namespace: "evm" };
  }

  const m = raw.match(CAIP10_EVM);
  if (m) {
    const key = m[2].toLowerCase();
    return { caip10: `eip155:${m[1]}:${key}`, addressKey: key, namespace: "evm" };
  }

  if (BECH32.test(raw) || BASE58.test(raw)) {
    return { caip10: raw, addressKey: raw, namespace: "other" };
  }

  throw new InvalidAddressError(
    `unrecognized address format: ${raw.slice(0, 40)}${raw.length > 40 ? "..." : ""}`
  );
}

module.exports = { parseAddress, InvalidAddressError };
