const { test } = require("node:test");
const assert = require("node:assert");
const { parseAddress, InvalidAddressError } = require("../src/normalize");

const CHAIN = "eip155:8453";

test("bare EVM address lowercases and gets default chain", () => {
  const p = parseAddress("0x8589427373D6D84E98730D7795D8f6f8731FDA16", CHAIN);
  assert.equal(p.caip10, "eip155:8453:0x8589427373d6d84e98730d7795d8f6f8731fda16");
  assert.equal(p.addressKey, "0x8589427373d6d84e98730d7795d8f6f8731fda16");
  assert.equal(p.namespace, "evm");
});

test("CAIP-10 EVM address keeps its chain", () => {
  const p = parseAddress("eip155:1:0x8589427373D6D84E98730D7795D8f6f8731FDA16", CHAIN);
  assert.equal(p.caip10, "eip155:1:0x8589427373d6d84e98730d7795d8f6f8731fda16");
  assert.equal(p.namespace, "evm");
});

test("bitcoin base58 address is namespace other, kept verbatim", () => {
  const p = parseAddress("1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa", CHAIN);
  assert.equal(p.addressKey, "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa");
  assert.equal(p.namespace, "other");
});

test("tron base58 address accepted", () => {
  const p = parseAddress("TNiq9AXBp9EjUqhDhrwrfvAA8U3GUQZH81", CHAIN);
  assert.equal(p.namespace, "other");
});

test("bech32 address accepted", () => {
  const p = parseAddress("bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh", CHAIN);
  assert.equal(p.namespace, "other");
});

test("garbage throws InvalidAddressError", () => {
  for (const bad of ["", "hello world", "0x123", "0xZZ89427373D6D84E98730D7795D8f6f8731FDA16", "eip155:8453:0x123", "x".repeat(200), "<script>"]) {
    assert.throws(() => parseAddress(bad, CHAIN), InvalidAddressError, `should reject: ${bad}`);
  }
});
