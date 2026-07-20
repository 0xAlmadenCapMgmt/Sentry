/**
 * MyEtherWallet ethereum-lists darklist — community-reported malicious
 * ETH addresses. MIT-licensed. (Replaces CryptoScamDB, whose API is dead —
 * verified 502 on 2026-07-15.)
 */
const DATA_URL =
  "https://raw.githubusercontent.com/MyEtherWallet/ethereum-lists/master/src/addresses/addresses-darklist.json";
const INFO_URL = "https://github.com/MyEtherWallet/ethereum-lists";

const EVM_RE = /^0x[0-9a-fA-F]{40}$/;

async function fetchRecords() {
  const res = await fetch(DATA_URL, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`MEW darklist fetch failed: HTTP ${res.status}`);
  const list = await res.json();
  if (!Array.isArray(list)) throw new Error("MEW darklist is not an array — format change?");
  const records = [];
  const seen = new Set();
  for (const entry of list) {
    const addr = entry && entry.address;
    if (typeof addr !== "string" || !EVM_RE.test(addr)) continue;
    const key = addr.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    records.push({
      addressKey: key,
      chain: "eip155:*",
      category: "scam-report",
      firstSeen: typeof entry.date === "string" ? entry.date : null,
      sourceUrl: DATA_URL,
      details: (entry.comment || "Listed in MEW ethereum-lists darklist").slice(0, 300),
    });
  }
  if (records.length === 0) throw new Error("MEW darklist parse yielded 0 addresses");
  return records;
}

module.exports = {
  name: "MEW_DARKLIST",
  description:
    "MyEtherWallet ethereum-lists darklist — community-reported malicious addresses (MIT).",
  url: INFO_URL,
  dataUrl: DATA_URL,
  refresh: "daily",
  namespaces: ["evm"],
  fetchRecords,
};
