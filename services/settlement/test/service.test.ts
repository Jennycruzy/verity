import assert from "node:assert/strict";
import test from "node:test";
import { Blocky402Client } from "@verity/hedera";
import { encodeHcsRecord } from "@verity/hcs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileSettlementStore, SettlementCoordinator } from "../src/index.ts";

class FacilitatorForTest extends Blocky402Client {
  public settleCalls = 0;

  public override async supported() {
    return {
      kinds: [{ x402Version: 2, scheme: "exact", network: "hedera:testnet", extra: { feePayer: "0.0.999" } }],
      extensions: [],
      signers: { "hedera:*": ["0.0.999"] }
    };
  }

  public override async settle() {
    this.settleCalls += 1;
    return { success: true, transaction: "0.0.99@1.000000000", network: "hedera:testnet", payer: "0.0.98" };
  }
}

test("anchors an accepted settlement after the facilitator returns a transaction", async () => {
  const published: unknown[] = [];
  const coordinator = new SettlementCoordinator(
    new FacilitatorForTest("https://facilitator.invalid"),
    { publish: async (_topic, record) => { published.push(record); return "0.0.7@2.000000000"; } },
    { settlement: "0.0.7", dispute: "0.0.8" }
  );
  const result = await coordinator.settleAccepted({
    requestId: "request-1",
    providerId: "provider-1",
    buyerId: "buyer-1",
    ruleId: "fx-rate-v1",
    paymentPayload: { x402Version: 2, accepted: { scheme: "exact", network: "hedera:testnet", amount: "1", payTo: "0.0.1", maxTimeoutSeconds: 30, asset: "0.0.0", extra: { feePayer: "0.0.999" } }, payload: { transaction: "payload" } },
    paymentRequirements: { scheme: "exact", network: "hedera:testnet", amount: "1", payTo: "0.0.1", maxTimeoutSeconds: 30, asset: "0.0.0", extra: { feePayer: "0.0.999" } }
  });
  assert.equal(result.state, "settled");
  assert.equal(result.transactionId, "0.0.99@1.000000000");
  assert.equal(published.length, 1);
});

test("reports the Hedera transaction when HCS anchoring fails", async () => {
  const coordinator = new SettlementCoordinator(
    new FacilitatorForTest("https://facilitator.invalid"),
    { publish: async () => { throw new Error("topic unavailable"); } },
    { settlement: "0.0.7", dispute: "0.0.8" }
  );
  await assert.rejects(
    coordinator.settleAccepted({
      requestId: "request-2",
      providerId: "provider-1",
      buyerId: "buyer-1",
      ruleId: "fx-rate-v1",
      paymentPayload: { x402Version: 2, accepted: { scheme: "exact", network: "hedera:testnet", amount: "1", payTo: "0.0.1", maxTimeoutSeconds: 30, asset: "0.0.0", extra: { feePayer: "0.0.999" } }, payload: { transaction: "payload" } },
      paymentRequirements: { scheme: "exact", network: "hedera:testnet", amount: "1", payTo: "0.0.1", maxTimeoutSeconds: 30, asset: "0.0.0", extra: { feePayer: "0.0.999" } }
    }),
    /VERITY_SETTLEMENT_ANCHOR_FAILED: payment 0\.0\.99@1\.000000000 succeeded/
  );
});

test("coalesces concurrent accepted settlements for one request", async () => {
  const facilitator = new FacilitatorForTest("https://facilitator.invalid");
  const published: unknown[] = [];
  const coordinator = new SettlementCoordinator(
    facilitator,
    { publish: async (_topic, record) => { published.push(record); return "0.0.7@2.000000000"; } },
    { settlement: "0.0.7", dispute: "0.0.8" }
  );
  const request = acceptedRequest("request-idempotent");
  const [first, second] = await Promise.all([coordinator.settleAccepted(request), coordinator.settleAccepted(request)]);
  assert.deepEqual(second, first);
  assert.equal(facilitator.settleCalls, 1);
  assert.equal(published.length, 1);
});

test("rejects a changed retry for an already settled request", async () => {
  const facilitator = new FacilitatorForTest("https://facilitator.invalid");
  const coordinator = new SettlementCoordinator(
    facilitator,
    { publish: async () => "0.0.7@2.000000000" },
    { settlement: "0.0.7", dispute: "0.0.8" }
  );
  const request = acceptedRequest("request-conflict");
  await coordinator.settleAccepted(request);
  assert.throws(
    () => coordinator.settleAccepted({ ...request, paymentRequirements: { ...request.paymentRequirements, amount: "2" } }),
    /VERITY_SETTLEMENT_IDEMPOTENCY_CONFLICT/
  );
  assert.equal(facilitator.settleCalls, 1);
});

test("returns a completed payment from the journal after a coordinator restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "verity-settlements-"));
  try {
    const request = acceptedRequest("request-restart");
    const firstFacilitator = new FacilitatorForTest("https://facilitator.invalid");
    const first = new SettlementCoordinator(
      firstFacilitator,
      { publish: async () => "0.0.7@2.000000000" },
      { settlement: "0.0.7", dispute: "0.0.8" },
      undefined,
      new FileSettlementStore(directory)
    );
    const expected = await first.settleAccepted(request);

    const secondFacilitator = new FacilitatorForTest("https://facilitator.invalid");
    const second = new SettlementCoordinator(
      secondFacilitator,
      { publish: async () => { throw new Error("journal replay must not publish HCS"); } },
      { settlement: "0.0.7", dispute: "0.0.8" },
      undefined,
      new FileSettlementStore(directory)
    );
    assert.deepEqual(await second.settleAccepted(request), expected);
    assert.equal(firstFacilitator.settleCalls, 1);
    assert.equal(secondFacilitator.settleCalls, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("closes an owned HCS publisher when the coordinator shuts down", () => {
  let closed = false;
  const coordinator = new SettlementCoordinator(
    new FacilitatorForTest("https://facilitator.invalid"),
    { publish: async () => "0.0.7@2.000000000", close: () => { closed = true; } },
    { settlement: "0.0.7", dispute: "0.0.8" }
  );
  coordinator.close();
  assert.equal(closed, true);
});

function disputeRequest(verdict: "accept" | "reject") {
  return {
    requestId: "request-dispute",
    providerId: "provider-1",
    buyerId: "buyer-1",
    ruleId: "fx-rate-v1" as const,
    paymentPayload: { x402Version: 2, accepted: { scheme: "exact", network: "hedera:testnet", amount: "1", payTo: "0.0.1", maxTimeoutSeconds: 30, asset: "0.0.0", extra: { feePayer: "0.0.999" } }, payload: { transaction: "payload" } },
    paymentRequirements: { scheme: "exact", network: "hedera:testnet", amount: "1", payTo: "0.0.1", maxTimeoutSeconds: 30, asset: "0.0.0", extra: { feePayer: "0.0.999" } },
    disputeId: "dispute-1",
    buyerRoot: "buyer-root",
    providerRoot: "provider-root",
    verdict: { verdict, ruleId: "fx-rate-v1" as const, reasonCode: verdict === "reject" ? "RATE_OUTSIDE_TOLERANCE" : "RATE_WITHIN_TOLERANCE", evidence: {} },
    buyerBondAmount: "10",
    bondTransactionId: "0.0.9@1.000000000",
    providerStakeAmount: "20",
    buyerAddress: `0x${"01".repeat(20)}`,
    providerAddress: `0x${"02".repeat(20)}`,
    evaluationInput: { sha256: "input-hash", mediaType: "application/json", byteLength: 42, uri: "https://content.invalid/input" },
    buyerResponse: { sha256: "buyer-hash", mediaType: "application/json", byteLength: 42, uri: "https://content.invalid/buyer" },
    providerResponses: [{ sha256: "provider-hash", mediaType: "application/json", byteLength: 42, uri: "https://content.invalid/provider" }],
    crossCheckerVerdicts: [
      { checkerId: "checker-a", ruleId: "fx-rate-v1" as const, verdict, reasonCode: "RATE_CHECK" }
    ]
  };
}

function acceptedRequest(requestId: string) {
  return {
    requestId,
    providerId: "provider-1",
    buyerId: "buyer-1",
    ruleId: "fx-rate-v1" as const,
    paymentPayload: { x402Version: 2, accepted: { scheme: "exact", network: "hedera:testnet", amount: "1", payTo: "0.0.1", maxTimeoutSeconds: 30, asset: "0.0.0", extra: { feePayer: "0.0.999" } }, payload: { transaction: requestId } },
    paymentRequirements: { scheme: "exact", network: "hedera:testnet", amount: "1", payTo: "0.0.1", maxTimeoutSeconds: 30, asset: "0.0.0", extra: { feePayer: "0.0.999" } }
  };
}

test("records a complete upheld dispute without settling the held payment", async () => {
  const published: unknown[] = [];
  const coordinator = new SettlementCoordinator(
    new FacilitatorForTest("https://facilitator.invalid"),
    { publish: async (_topic, record) => { encodeHcsRecord(record); published.push(record); return "0.0.8@3.000000000"; } },
    { settlement: "0.0.7", dispute: "0.0.8" },
    escrowForTest()
  );
  const result = await coordinator.recordAdjudication(disputeRequest("reject"));
  assert.equal(result.state, "void");
  assert.equal(result.transactionId, undefined);
  assert.equal(published.length, 3);
  assert.deepEqual((published[0] as { payload: { evaluationInput: unknown; resolution: string } }).payload.evaluationInput, { sha256: "input-hash" });
  assert.equal((published[0] as { payload: { bondTransactionId: string } }).payload.bondTransactionId, "0.0.9@1.000000000");
  assert.equal((published[0] as { payload: { resolution: string } }).payload.resolution, "void");
});

test("settles and records an overturned dispute", async () => {
  const published: unknown[] = [];
  const calls: string[] = [];
  const facilitator = new FacilitatorForTest("https://facilitator.invalid");
  const coordinator = new SettlementCoordinator(
    facilitator,
    { publish: async (_topic, record) => { encodeHcsRecord(record); published.push(record); return "0.0.8@4.000000000"; } },
    { settlement: "0.0.7", dispute: "0.0.8" },
    escrowForTest(calls)
  );
  const result = await coordinator.recordAdjudication(disputeRequest("accept"));
  assert.equal(result.state, "settled");
  assert.equal(result.transactionId, "0.0.99@1.000000000");
  assert.equal((published[2] as { payload: { resolutionTransactionId: string } }).payload.resolutionTransactionId, "0.0.99@1.000000000");
  assert.deepEqual(calls, ["lock", "resolve", "reputation"]);
  assert.equal(facilitator.settleCalls, 1);
});

test("does not settle an overturned dispute when escrow resolution fails", async () => {
  const facilitator = new FacilitatorForTest("https://facilitator.invalid");
  const coordinator = new SettlementCoordinator(
    facilitator,
    { publish: async () => "0.0.8@5.000000000" },
    { settlement: "0.0.7", dispute: "0.0.8" },
    {
      async lockStake() { return { transactionId: "0.0.10@1.000000000" }; },
      async resolveBond() { throw new Error("escrow unavailable"); },
      async anchorReputation() { return { transactionId: "0.0.10@3.000000000" }; }
    }
  );

  await assert.rejects(coordinator.recordAdjudication(disputeRequest("accept")), /VERITY_ESCROW_RESOLUTION_FAILED: correct-provider resolution did not complete/);
  assert.equal(facilitator.settleCalls, 0);
});

function escrowForTest(calls: string[] = []) {
  return {
    async lockStake() { calls.push("lock"); return { transactionId: "0.0.10@1.000000000" }; },
    async resolveBond() { calls.push("resolve"); return { transactionId: "0.0.10@2.000000000" }; },
    async anchorReputation() { calls.push("reputation"); return { transactionId: "0.0.10@3.000000000" }; }
  };
}
