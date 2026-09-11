import assert from "node:assert/strict";
import test from "node:test";
import type { CrossChecker } from "@verity/agent";
import type { ContentStore } from "@verity/content";
import { sha256 } from "@verity/types";
import { DisputeProcessor, MemoryProviderRegistry, MemoryDisputeStore, type DisputeSubmission } from "../src/index.ts";

const input = { actualRate: "1.10", expectedRate: "1.00", toleranceBps: 100 };
const ref = (value: string) => ({ sha256: sha256(value), mediaType: "application/json", byteLength: Buffer.byteLength(value), uri: `https://content.invalid/${sha256(value)}` });
const checkers: CrossChecker[] = [
  { id: "checker-a", check: async () => ({ verdict: "reject", ruleId: "fx-rate-v1", reasonCode: "RATE_OUTSIDE_TOLERANCE", evidence: {} }) },
  { id: "checker-b", check: async () => ({ verdict: "reject", ruleId: "fx-rate-v1", reasonCode: "RATE_OUTSIDE_TOLERANCE", evidence: {} }) },
  { id: "checker-c", check: async () => ({ verdict: "accept", ruleId: "fx-rate-v1", reasonCode: "RATE_WITHIN_TOLERANCE", evidence: {} }) }
];

test("adjudicates a bonded rejection and records the complete result", async () => {
  const stored: unknown[] = [];
  const content: ContentStore = {
    putJson: async () => ref(JSON.stringify(input)),
    readJson: async () => input
  };
  const settlement = {
    async recordAdjudication(request: { verdict: { verdict: string }; crossCheckerVerdicts: readonly unknown[] }) {
      stored.push(request);
      return { state: "void" as const, hcsTransactionId: "0.0.8@1.000000000" };
    }
  };
  const bondVerifier = { verify: async () => undefined };
  const provider = new MemoryProviderRegistry(new Map([["provider-1", { providerRoot: "provider-root", providerStakeAmount: "20", providerAddress: `0x${"01".repeat(20)}` }]]));
  const processor = new DisputeProcessor(
    { verify: async () => ({ root: "buyer-root", action: "dispute", verifiedAt: "now", provider: "world-id" as const }) },
    provider,
    content,
    checkers,
    settlement,
    bondVerifier,
    new MemoryDisputeStore()
  );
  const submission = submissionForTest();
  const first = await processor.submit(submission);
  assert.equal(first.created, true);
  assert.equal(first.result.verdict.verdict, "reject");
  assert.equal(first.result.state, "void");
  assert.equal(first.result.votes.length, 3);
  assert.equal(stored.length, 1);
  const retry = await processor.submit(submission);
  assert.equal(retry.created, false);
  assert.deepEqual(retry.result, first.result);
});

test("rejects a conflicting retry and missing providers", async () => {
  const content: ContentStore = { putJson: async () => ref("{}"), readJson: async () => input };
  const settlement = { recordAdjudication: async () => ({ state: "void" as const, hcsTransactionId: "hcs-1" }) };
  const processor = new DisputeProcessor(
    { verify: async () => ({ root: "buyer-root", action: "dispute", verifiedAt: "now", provider: "world-id" as const }) },
    new MemoryProviderRegistry(new Map([["provider-1", { providerRoot: "provider-root", providerStakeAmount: "20", providerAddress: `0x${"01".repeat(20)}` }]])),
    content,
    checkers,
    settlement,
    { verify: async () => undefined },
    new MemoryDisputeStore()
  );
  await processor.submit(submissionForTest());
  await assert.rejects(processor.submit({ ...submissionForTest(), buyerId: "different-buyer" }), /VERITY_DISPUTE_IDEMPOTENCY_CONFLICT/);
  await assert.rejects(processor.submit({ ...submissionForTest(), disputeId: "dispute-2", providerId: "missing" }), /VERITY_PROVIDER_UNKNOWN/);
});

test("requires one provider response reference per checker", async () => {
  const content: ContentStore = { putJson: async () => ref("{}"), readJson: async () => input };
  const settlement = { recordAdjudication: async () => ({ state: "void" as const, hcsTransactionId: "hcs-1" }) };
  const processor = new DisputeProcessor(
    { verify: async () => ({ root: "buyer-root", action: "dispute", verifiedAt: "now", provider: "world-id" as const }) },
    new MemoryProviderRegistry(new Map([["provider-1", { providerRoot: "provider-root", providerStakeAmount: "20", providerAddress: `0x${"01".repeat(20)}` }]])),
    content,
    checkers,
    settlement,
    { verify: async () => undefined }
  );
  await assert.rejects(processor.submit({ ...submissionForTest(), providerResponses: [] }), /VERITY_PROVIDER_RESPONSES/);
});

function submissionForTest(): DisputeSubmission {
  const serialized = JSON.stringify(input);
  return {
    disputeId: "dispute-1",
    requestId: "request-1",
    providerId: "provider-1",
    buyerId: "buyer-1",
    ruleId: "fx-rate-v1",
    paymentPayload: { x402Version: 2, accepted: { scheme: "exact", network: "hedera:testnet", amount: "1", payTo: "0.0.1", maxTimeoutSeconds: 30, asset: "0.0.0", extra: {} }, payload: { transaction: "payload" } },
    paymentRequirements: { scheme: "exact", network: "hedera:testnet", amount: "1", payTo: "0.0.1", maxTimeoutSeconds: 30, asset: "0.0.0", extra: {} },
    identityProof: { proof: "opaque" },
    identitySignal: "request-1",
    buyerAddress: `0x${"02".repeat(20)}`,
    buyerBondAmount: "10",
    bondTransactionId: "0.0.9@1.000000000",
    evaluationInput: ref(serialized),
    buyerResponse: ref('{"rate":"1.10"}'),
    providerResponses: [ref('{"rate":"1.10"}'), ref('{"rate":"1.10"}'), ref('{"rate":"1.00"}')]
  };
}
