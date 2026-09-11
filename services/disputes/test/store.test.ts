import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FileDisputeStore, type StoredDispute } from "../src/store.ts";

test("file dispute store preserves complete records and rejects conflicts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "verity-disputes-"));
  try {
    const store = new FileDisputeStore(directory);
    const value = stored("request-a");
    await store.put("dispute-1", value);
    assert.deepEqual(await store.get("dispute-1"), value);
    await assert.rejects(store.put("dispute-1", stored("request-b")), /VERITY_DISPUTE_IDEMPOTENCY_CONFLICT/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("concurrent file dispute writes leave one valid record", async () => {
  const directory = await mkdtemp(join(tmpdir(), "verity-disputes-"));
  try {
    const first = new FileDisputeStore(directory);
    const second = new FileDisputeStore(directory);
    const value = stored("request-a");
    await Promise.all([first.put("dispute-1", value), second.put("dispute-1", value)]);
    assert.deepEqual(await first.get("dispute-1"), value);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

function stored(requestHash: string): StoredDispute {
  return {
    requestHash,
    result: {
      disputeId: "dispute-1",
      requestId: "request-1",
      buyerRoot: "buyer-root",
      providerRoot: "provider-root",
      bondTransactionId: "0.0.7@1.000000000",
      verdict: { verdict: "reject", ruleId: "fx-rate-v1", reasonCode: "CHECKER_MAJORITY_REJECT", evidence: { checkerCount: 3 } },
      votes: [],
      state: "void",
      hcsTransactionId: "0.0.8@1.000000000",
      recordedAt: "2026-01-01T00:00:00.000Z"
    }
  };
}
