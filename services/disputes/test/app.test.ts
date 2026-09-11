import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import type { CrossChecker } from "@verity/agent";
import type { ContentStore } from "@verity/content";
import { sha256 } from "@verity/types";
import { handleRequest } from "../src/app.ts";
import { DisputeProcessor } from "../src/service.ts";

test("accepts a valid dispute request and makes retries idempotent", async () => {
  const processor = processorForTest();
  const body = submissionForTest();
  const first = responseForTest();
  await handleRequest(requestForTest("POST", "/disputes", body, "dispute-1"), first.response, processor, { maxBodyBytes: 20_000 });
  assert.equal(first.response.statusCode, 201);
  assert.equal(JSON.parse(first.body()).state, "void");

  const retry = responseForTest();
  await handleRequest(requestForTest("POST", "/disputes", body, "dispute-1"), retry.response, processor, { maxBodyBytes: 20_000 });
  assert.equal(retry.response.statusCode, 200);
  assert.deepEqual(JSON.parse(retry.body()), JSON.parse(first.body()));
});

test("rejects an idempotency key that does not match the dispute ID", async () => {
  const response = responseForTest();
  await assert.rejects(
    handleRequest(requestForTest("POST", "/disputes", submissionForTest(), "different-id"), response.response, processorForTest(), { maxBodyBytes: 20_000 }),
    /VERITY_DISPUTE_IDEMPOTENCY_KEY/
  );
});

test("serves a health response without invoking the processor", async () => {
  const response = responseForTest();
  await handleRequest(requestForTest("GET", "/health"), response.response, processorForTest(), { maxBodyBytes: 20_000 });
  assert.equal(response.response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body()), { status: "ok", service: "disputes" });
});

function processorForTest(): DisputeProcessor {
  const checkers: CrossChecker[] = [
    { id: "checker-a", check: async () => ({ verdict: "reject", ruleId: "fx-rate-v1", reasonCode: "bad", evidence: {} }) },
    { id: "checker-b", check: async () => ({ verdict: "reject", ruleId: "fx-rate-v1", reasonCode: "bad", evidence: {} }) },
    { id: "checker-c", check: async () => ({ verdict: "accept", ruleId: "fx-rate-v1", reasonCode: "ok", evidence: {} }) }
  ];
  const content: ContentStore = { putJson: async () => reference("put"), readJson: async () => ({ expectedRate: "1", actualRate: "2", toleranceBps: 0 }) };
  return new DisputeProcessor(
    { verify: async () => ({ root: "buyer-root", action: "dispute", verifiedAt: "now", provider: "world-id" as const }) },
    { get: async () => ({ providerRoot: "provider-root", providerStakeAmount: "20" }) },
    content,
    checkers,
    { recordAdjudication: async () => ({ state: "void" as const, hcsTransactionId: "0.0.8@1.000000000" }) }
  );
}

function submissionForTest() {
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
    buyerBondAmount: "10",
    evaluationInput: reference("input"),
    buyerResponse: reference("buyer"),
    providerResponses: [reference("provider-a"), reference("provider-b"), reference("provider-c")]
  };
}

function reference(value: string) {
  return { sha256: sha256(value), mediaType: "application/json", byteLength: Buffer.byteLength(value), uri: `https://content.invalid/${value}` };
}

function requestForTest(method: string, url: string, body?: unknown, idempotencyKey?: string) {
  const serialized = body === undefined ? "" : JSON.stringify(body);
  const request = Readable.from(serialized ? [Buffer.from(serialized)] : []) as Readable & { method: string; url: string; headers: Record<string, string> };
  request.method = method;
  request.url = url;
  request.headers = idempotencyKey ? { "idempotency-key": idempotencyKey } : {};
  return request as never;
}

function responseForTest() {
  const chunks: Buffer[] = [];
  const response = {
    statusCode: 0,
    writableEnded: false,
    setHeader(_name: string, _value: string) {},
    end(value?: string | Uint8Array) {
      if (value !== undefined) chunks.push(Buffer.from(value));
      this.writableEnded = true;
    }
  } as never;
  return { response, body: () => Buffer.concat(chunks).toString("utf8") };
}
