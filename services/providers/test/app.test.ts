import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import { createProviderHandler } from "../src/app.ts";
import type { ProviderServiceConfig } from "../src/config.ts";

const config: ProviderServiceConfig = {
  facilitatorUrl: "https://facilitator.invalid",
  network: "hedera:testnet",
  assetId: "0.0.0",
  payToAccountId: "0.0.1",
  requestTimeoutMs: 1_000,
  kind: "fx",
  port: 1,
  fxPrice: "10",
  fxPair: "EUR/USD",
  fxReferenceRate: "1.08",
  fxToleranceBps: 25,
  entityCachedPrice: "10",
  entityFreshPrice: "30",
  degradeMode: false
};

test("checker endpoint returns a deterministic FX verdict", async () => {
  const response = responseForTest();
  await createProviderHandler(config)(requestForTest("POST", "/check", JSON.stringify({
    ruleId: "fx-rate-v1",
    value: { expectedRate: "1.00", actualRate: "1.01", toleranceBps: 100 }
  })), response.response);
  assert.equal(response.response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body()), {
    verdict: "accept",
    ruleId: "fx-rate-v1",
    reasonCode: "RATE_WITHIN_TOLERANCE",
    evidence: { expectedRate: "1.00", actualRate: "1.01", toleranceBps: 100 }
  });
});

test("checker endpoint rejects an unsupported rule before evaluation", async () => {
  const response = responseForTest();
  await createProviderHandler(config)(requestForTest("POST", "/check", JSON.stringify({
    ruleId: "entity-canonical-v1",
    value: { expected: "Acme", actual: "acme" }
  })), response.response);
  assert.equal(response.response.statusCode, 400);
  assert.match(response.body(), /checker_rule_unsupported/);
});

function requestForTest(method: string, url: string, body: string) {
  const request = Readable.from([Buffer.from(body)]) as Readable & { method: string; url: string; headers: Record<string, string> };
  request.method = method;
  request.url = url;
  request.headers = { "content-type": "application/json" };
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
