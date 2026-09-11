import assert from "node:assert/strict";
import test from "node:test";
import { decodeHcsRecord, encodeHcsRecord, HCS_SCHEMA } from "../src/index.ts";

test("encodes compact HCS records canonically", () => {
  const record = {
    schema: HCS_SCHEMA,
    kind: "settlement" as const,
    id: "request-1",
    recordedAt: "2026-09-11T00:00:00.000Z",
    payload: { transactionId: "tx-1", amount: "10" }
  };
  const encoded = encodeHcsRecord(record);
  assert.deepEqual(decodeHcsRecord(encoded), record);
});

test("rejects oversized HCS records before network submission", () => {
  assert.throws(
    () => encodeHcsRecord({ schema: HCS_SCHEMA, kind: "dispute", id: "d", recordedAt: "now", payload: { data: "x".repeat(2000) } }),
    /maximum is 1024 bytes/
  );
});
