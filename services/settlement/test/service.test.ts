import assert from "node:assert/strict";
import test from "node:test";
import { Blocky402Client } from "@verity/hedera";
import { SettlementCoordinator } from "../src/service.ts";

class FacilitatorForTest extends Blocky402Client {
  public override async settle() {
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
    paymentPayload: { x402Version: 2, accepted: { scheme: "exact", network: "hedera:testnet", amount: "1", payTo: "0.0.1", maxTimeoutSeconds: 30, asset: "0.0.0", extra: {} }, payload: { transaction: "payload" } },
    paymentRequirements: { scheme: "exact", network: "hedera:testnet", amount: "1", payTo: "0.0.1", maxTimeoutSeconds: 30, asset: "0.0.0", extra: {} }
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
      paymentPayload: { x402Version: 2, accepted: { scheme: "exact", network: "hedera:testnet", amount: "1", payTo: "0.0.1", maxTimeoutSeconds: 30, asset: "0.0.0", extra: {} }, payload: { transaction: "payload" } },
      paymentRequirements: { scheme: "exact", network: "hedera:testnet", amount: "1", payTo: "0.0.1", maxTimeoutSeconds: 30, asset: "0.0.0", extra: {} }
    }),
    /VERITY_SETTLEMENT_ANCHOR_FAILED: payment 0\.0\.99@1\.000000000 succeeded/
  );
});

function disputeRequest(verdict: "accept" | "reject") {
  return {
    requestId: "request-dispute",
    providerId: "provider-1",
    buyerId: "buyer-1",
    ruleId: "fx-rate-v1" as const,
    paymentPayload: { x402Version: 2, accepted: { scheme: "exact", network: "hedera:testnet", amount: "1", payTo: "0.0.1", maxTimeoutSeconds: 30, asset: "0.0.0", extra: {} }, payload: { transaction: "payload" } },
    paymentRequirements: { scheme: "exact", network: "hedera:testnet", amount: "1", payTo: "0.0.1", maxTimeoutSeconds: 30, asset: "0.0.0", extra: {} },
    disputeId: "dispute-1",
    buyerRoot: "buyer-root",
    providerRoot: "provider-root",
    verdict: { verdict, ruleId: "fx-rate-v1" as const, reasonCode: verdict === "reject" ? "RATE_OUTSIDE_TOLERANCE" : "RATE_WITHIN_TOLERANCE", evidence: {} },
    buyerBondAmount: "10",
    providerStakeAmount: "20",
    evaluationInput: { sha256: "input-hash", mediaType: "application/json", byteLength: 42, uri: "https://content.invalid/input" },
    buyerResponse: { sha256: "buyer-hash", mediaType: "application/json", byteLength: 42, uri: "https://content.invalid/buyer" },
    providerResponses: [{ sha256: "provider-hash", mediaType: "application/json", byteLength: 42, uri: "https://content.invalid/provider" }],
    crossCheckerVerdicts: [
      { checkerId: "checker-a", ruleId: "fx-rate-v1" as const, verdict, reasonCode: "RATE_CHECK" }
    ]
  };
}

test("records a complete upheld dispute without settling the held payment", async () => {
  const published: unknown[] = [];
  const coordinator = new SettlementCoordinator(
    new FacilitatorForTest("https://facilitator.invalid"),
    { publish: async (_topic, record) => { published.push(record); return "0.0.8@3.000000000"; } },
    { settlement: "0.0.7", dispute: "0.0.8" }
  );
  const result = await coordinator.recordAdjudication(disputeRequest("reject"));
  assert.equal(result.state, "void");
  assert.equal(result.transactionId, undefined);
  assert.deepEqual((published[0] as { payload: { evaluationInput: unknown; resolution: string } }).payload.evaluationInput, disputeRequest("reject").evaluationInput);
  assert.equal((published[0] as { payload: { resolution: string } }).payload.resolution, "void");
});

test("settles and records an overturned dispute", async () => {
  const published: unknown[] = [];
  const coordinator = new SettlementCoordinator(
    new FacilitatorForTest("https://facilitator.invalid"),
    { publish: async (_topic, record) => { published.push(record); return "0.0.8@4.000000000"; } },
    { settlement: "0.0.7", dispute: "0.0.8" }
  );
  const result = await coordinator.recordAdjudication(disputeRequest("accept"));
  assert.equal(result.state, "settled");
  assert.equal(result.transactionId, "0.0.99@1.000000000");
  assert.equal((published[0] as { payload: { resolutionTransactionId: string } }).payload.resolutionTransactionId, "0.0.99@1.000000000");
});
