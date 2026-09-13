import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FileSettlementStore, type StoredSettlement } from "../src/store.ts";

test("persists accepted outcomes across coordinator restarts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "verity-settlements-"));
  try {
    const store = new FileSettlementStore(directory);
    const value = stored("request-a");
    await store.put("accepted", "request-1", value);
    assert.deepEqual(await new FileSettlementStore(directory).get("accepted", "request-1"), value);
    await assert.rejects(store.put("accepted", "request-1", stored("request-b")), /VERITY_SETTLEMENT_IDEMPOTENCY_CONFLICT/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("concurrent journal writes leave one valid outcome", async () => {
  const directory = await mkdtemp(join(tmpdir(), "verity-settlements-"));
  try {
    const first = new FileSettlementStore(directory);
    const second = new FileSettlementStore(directory);
    const value = stored("request-a");
    await Promise.all([
      first.put("adjudication", "dispute-1", value),
      second.put("adjudication", "dispute-1", value)
    ]);
    assert.deepEqual(await first.get("adjudication", "dispute-1"), value);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

function stored(requestHash: string): StoredSettlement {
  return {
    requestHash: requestHash === "request-a" ? "a".repeat(64) : "b".repeat(64),
    outcome: {
      state: "settled",
      transactionId: "0.0.99@1.000000000",
      hcsTransactionId: "0.0.7@2.000000000"
    }
  };
}
