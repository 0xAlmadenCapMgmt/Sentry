const { test } = require("node:test");
const assert = require("node:assert");
const ofac = require("../src/sources/ofac");

// Two realistic sdn.csv lines: one entity with EVM + TRX addresses in quoted
// remarks (with embedded commas), one unrelated row.
const FIXTURE = [
  `36351,"SOME SANCTIONED EXCHANGE","-0- ","CYBER2",-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,"Digital Currency Address - ETH 0x8589427373D6D84E98730D7795D8f6f8731FDA16; Digital Currency Address - TRX TNiq9AXBp9EjUqhDhrwrfvAA8U3GUQZH81; Registration Number 12345 (Russia)."`,
  `12345,"HARMLESS SHIPPING CO","-0- ","IRAN",-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,"Vessel operator."`,
].join("\n");

test("parses EVM + non-EVM addresses out of SDN remarks", () => {
  const records = ofac.parseSdnCsv(FIXTURE);
  assert.equal(records.length, 2);

  const evm = records.find((r) => r.chain === "eip155:*");
  assert.equal(evm.addressKey, "0x8589427373d6d84e98730d7795d8f6f8731fda16");
  assert.equal(evm.category, "sanctions");
  assert.match(evm.details, /SOME SANCTIONED EXCHANGE/);
  assert.match(evm.details, /CYBER2/);
  assert.ok(evm.sourceUrl.startsWith("https://"));

  const trx = records.find((r) => r.chain === "trx");
  assert.equal(trx.addressKey, "TNiq9AXBp9EjUqhDhrwrfvAA8U3GUQZH81");
});

test("dedupes repeated addresses", () => {
  const records = ofac.parseSdnCsv(FIXTURE + "\n" + FIXTURE);
  assert.equal(records.length, 2);
});
