/**
 * ScamSniffer open scam database — wallet drainer / phishing addresses.
 * MIT-licensed public feed on GitHub.
 */
const DATA_URL =
  "https://raw.githubusercontent.com/scamsniffer/scam-database/main/blacklist/address.json";
const INFO_URL = "https://github.com/scamsniffer/scam-database";

const EVM_RE = /^0x[0-9a-fA-F]{40}$/;

async function fetchRecords() {
  const res = await fetch(DATA_URL, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`ScamSniffer fetch failed: HTTP ${res.status}`);
  const list = await res.json();
  if (!Array.isArray(list)) throw new Error("ScamSniffer feed is not an array — format change?");
  const records = [];
  const seen = new Set();
  for (const addr of list) {
    if (typeof addr !== "string" || !EVM_RE.test(addr)) continue;
    const key = addr.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    records.push({
      addressKey: key,
      chain: "eip155:*",
      category: "phishing",
      firstSeen: null,
      sourceUrl: DATA_URL,
      details: "Listed in ScamSniffer wallet-drainer/phishing address blacklist",
    });
  }
  if (records.length === 0) throw new Error("ScamSniffer parse yielded 0 addresses");
  return records;
}

module.exports = {
  name: "SCAMSNIFFER",
  description: "ScamSniffer open scam database — wallet drainer and phishing addresses (MIT).",
  url: INFO_URL,
  dataUrl: DATA_URL,
  refresh: "daily",
  namespaces: ["evm"],
  fetchRecords,
};
