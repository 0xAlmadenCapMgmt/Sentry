/**
 * OFAC SDN list — digital currency addresses.
 *
 * The SDN CSV's Remarks column embeds addresses as
 * "Digital Currency Address - <ASSET> <address>;" (an entry can carry many).
 * Public U.S. government data.
 */
const DATA_URL = "https://www.treasury.gov/ofac/downloads/sdn.csv";
const INFO_URL = "https://ofac.treasury.gov/sanctions-list-service";

const ADDR_RE = /Digital Currency Address - ([A-Z0-9]{2,12}) ([a-zA-Z0-9]{20,90})/g;
const EVM_RE = /^0x[0-9a-fA-F]{40}$/;

/** Minimal quote-aware CSV field splitter (sdn.csv has no embedded newlines). */
function splitCsvLine(line) {
  const fields = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      fields.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  fields.push(cur);
  return fields;
}

/** Parse the full sdn.csv text into finding records. Exported for tests. */
function parseSdnCsv(text) {
  const records = [];
  const seen = new Set();
  for (const line of text.split(/\r?\n/)) {
    if (!line.includes("Digital Currency Address")) continue;
    const fields = splitCsvLine(line);
    // sdn.csv columns: ent_num, SDN_Name, SDN_Type, Program, ..., Remarks (last)
    const name = (fields[1] || "").trim();
    const programs = (fields[3] || "").trim();
    const remarks = fields[fields.length - 1] || line;
    for (const m of remarks.matchAll(ADDR_RE)) {
      const asset = m[1];
      const addr = m[2];
      const isEvm = EVM_RE.test(addr);
      const addressKey = isEvm ? addr.toLowerCase() : addr;
      const chain = isEvm ? "eip155:*" : asset.toLowerCase();
      const dedupeKey = `${addressKey}|${chain}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      records.push({
        addressKey,
        chain,
        category: "sanctions",
        firstSeen: null, // SDN CSV carries no listing date; first ingestion date is recorded instead
        sourceUrl: DATA_URL,
        details: `${name} — OFAC SDN, program(s): ${programs}; asset: ${asset}`,
      });
    }
  }
  return records;
}

async function fetchRecords() {
  const res = await fetch(DATA_URL, {
    signal: AbortSignal.timeout(120_000),
    headers: { "user-agent": "sentry402-ingest/0.1 (+public sanctions data mirror)" },
  });
  if (!res.ok) throw new Error(`OFAC fetch failed: HTTP ${res.status}`);
  const text = await res.text();
  const records = parseSdnCsv(text);
  if (records.length === 0) throw new Error("OFAC parse yielded 0 addresses — format change?");
  return records;
}

module.exports = {
  name: "OFAC_SDN",
  description:
    "U.S. Treasury OFAC Specially Designated Nationals list — digital currency addresses (sanctions).",
  url: INFO_URL,
  dataUrl: DATA_URL,
  refresh: "daily",
  namespaces: ["evm", "other"], // OFAC lists BTC/TRX/etc. as well as EVM
  fetchRecords,
  parseSdnCsv, // exported for tests
};
