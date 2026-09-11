import assert from "node:assert/strict";
import { PrivateKey } from "@hiero-ledger/sdk";
import test from "node:test";
import { sha256, type ContentReference } from "@verity/types";
import { buy } from "../src/buy.ts";

test("posts a bond before submitting the deterministic dispute payload", async () => {
  process.env.BLOCKY402_URL = "https://facilitator.invalid";
  process.env.HEDERA_NETWORK = "hedera:testnet";
  process.env.HEDERA_CLIENT_ACCOUNT_ID = "0.0.2";
  process.env.HEDERA_CLIENT_PRIVATE_KEY = PrivateKey.generateECDSA().toStringRaw();
  const calls: string[] = [];
  const references = [reference("checker-a"), reference("checker-b"), reference("checker-c"), reference("checker-d"), reference("checker-e")];
  const contentStore = {
    async putJson(value: unknown): Promise<ContentReference> {
      calls.push(`content:${JSON.stringify(value)}`);
      return reference("uploaded");
    },
    async readJson(): Promise<unknown> {
      throw new Error("readJson is not used by the buyer");
    }
  };
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url === "https://provider.invalid/fx" && !init?.headers) {
      return new Response(JSON.stringify({
        x402Version: 2,
        resource: { url, description: "test", mimeType: "application/json" },
        accepts: [{ scheme: "exact", network: "hedera:testnet", amount: "1", payTo: "0.0.1", maxTimeoutSeconds: 30, asset: "0.0.0", extra: { feePayer: "0.0.999" } }]
      }), { status: 402 });
    }
    if (url === "https://provider.invalid/fx") {
      calls.push("delivery");
      return new Response(JSON.stringify({ expectedRate: "1.00", rate: "1.10", toleranceBps: 0 }), { status: 200, headers: { "content-type": "application/json" } });
    }
    assert.equal(url, "https://dispute.invalid/disputes");
    calls.push("dispute");
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    assert.equal(body.bondTransactionId, "0.0.9@1.000000000");
    assert.equal(body.providerRoot, undefined);
    assert.equal((body.providerResponses as unknown[]).length, 5);
    return new Response(JSON.stringify({ state: "void", hcsTransactionId: "0.0.8@2.000000000" }), { status: 201, headers: { "content-type": "application/json" } });
  };
  const result = await buy("https://provider.invalid/fx", {
    evaluate: "fx-rate-v1",
    bond: "10",
    disputeUrl: "https://dispute.invalid/disputes",
    providerId: "provider-1",
    buyerId: "buyer-1",
    buyerAddress: `0x${"03".repeat(20)}`,
    providerRoot: "provider-root",
    identityProof: { proof: "opaque" },
    identitySignal: "request-1",
    providerResponses: references,
    contentStore,
    postBond: async (disputeId, providerRoot, amount) => {
      calls.push(`bond:${disputeId}:${providerRoot}:${amount}`);
      return { transactionId: "0.0.9@1.000000000" };
    },
    fetchImpl
  });
  assert.equal(result.verdict.verdict, "reject");
  assert.equal(result.bondTransactionId, "0.0.9@1.000000000");
  assert.equal(result.disputeId !== undefined, true);
  assert.equal(calls[0], "delivery");
  assert.match(calls[1] ?? "", /^content:/);
  assert.match(calls[2] ?? "", /^content:/);
  assert.match(calls[3] ?? "", /^bond:/);
  assert.equal(calls[4], "dispute");
});

function reference(seed: string): ContentReference {
  return { sha256: sha256(seed), mediaType: "application/json", byteLength: 2, uri: `https://content.invalid/${seed}` };
}
