import assert from "node:assert/strict";
import test from "node:test";
import { assertCompactMessage, canonicalizeEntity, evaluateEntity, evaluateFxRate, stableJson } from "../src/index.ts";

test("accepts an FX rate on the tolerance boundary", () => {
  const result = evaluateFxRate({ expectedRate: "1.0000", actualRate: "1.0010", toleranceBps: 10 });
  assert.equal(result.verdict, "accept");
  assert.equal(result.reasonCode, "RATE_WITHIN_TOLERANCE");
});

test("rejects an FX rate outside the tolerance", () => {
  const result = evaluateFxRate({ expectedRate: "1.0000", actualRate: "1.0011", toleranceBps: 10 });
  assert.equal(result.verdict, "reject");
  assert.equal(result.reasonCode, "RATE_OUTSIDE_TOLERANCE");
});

test("canonicalizes entity text deterministically", () => {
  assert.equal(canonicalizeEntity("  Acme, Inc.  "), "acme inc");
  assert.equal(evaluateEntity({ expected: "Acme, Inc.", actual: "ACME INC" }).verdict, "accept");
  assert.equal(evaluateEntity({ expected: "Acme, Inc.", actual: "Acme Holdings" }).verdict, "reject");
});

test("stable JSON sorts object keys without changing array order", () => {
  assert.equal(stableJson({ b: 2, a: 1, list: [{ z: true, y: false }] }), '{"a":1,"b":2,"list":[{"y":false,"z":true}]}');
});

test("compact message assertion rejects oversized records", () => {
  assert.throws(() => assertCompactMessage("12345", 4), /maximum is 4 bytes/);
});
