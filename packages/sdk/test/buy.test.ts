import assert from "node:assert/strict";
import { PrivateKey } from "@hiero-ledger/sdk";
import test from "node:test";
import { Blocky402Client } from "@verity/hedera";
import { evaluateFxRate, sha256, type ContentReference } from "@verity/types";
import { buy } from "../src/buy.ts";

class DiscoveryOnlyFacilitator extends Blocky402Client {
  public override async supported() {
    return {
      kinds: [{ x402Version: 2, scheme: "exact", network: "hedera:testnet", extra: { feePayer: "0.0.999" } }],
      extensions: [],
      signers: { "hedera:*": ["0.0.999"] }
    };
  }
}

test("posts a bond before submitting the deterministic dispute payload", async () => {
  process.env.BLOCKY402_URL = "https://facilitator.invalid";
  process.env.HEDERA_NETWORK = "hedera:testnet";
  process.env.HEDERA_CLIENT_ACCOUNT_ID = "0.0.2";
  const clientKey = PrivateKey.generateECDSA();
  process.env.HEDERA_CLIENT_PRIVATE_KEY = clientKey.toStringRaw();
  process.env.HEDERA_CLIENT_EVM_ADDRESS = "";
  const calls: string[] = [];
  const references = [reference("checker-a"), reference("checker-b"), reference("checker-c"), reference("checker-d"), reference("checker-e")];
  const bondExpiry = new Date(Date.now() + 120_000);
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
    assert.equal(body.bondScheduleId, "0.0.10");
    assert.equal(body.providerRoot, undefined);
    assert.equal((body.providerResponses as unknown[]).length, 5);
    return new Response(JSON.stringify({ state: "void", hcsTransactionId: "0.0.8@2.000000000" }), { status: 201, headers: { "content-type": "application/json" } });
  };
  const result = await buy("https://provider.invalid/fx", {
    evaluate: (value: unknown) => {
      const record = value as { rate?: unknown };
      if (typeof record.rate !== "string") throw new Error("test response did not contain a rate");
      return evaluateFxRate({ expectedRate: "1.00", actualRate: record.rate, toleranceBps: 0 });
    },
    evaluationInput: (value: unknown) => {
      const record = value as { rate?: unknown };
      if (typeof record.rate !== "string") throw new Error("test response did not contain a rate");
      return { expectedRate: "1.00", actualRate: record.rate, toleranceBps: 0 };
    },
    bond: "10",
    bondExpiry,
    disputeUrl: "https://dispute.invalid/disputes",
    providerId: "provider-1",
    buyerId: "buyer-1",
    buyerAddress: `0x${clientKey.publicKey.toEvmAddress()}`,
    providerRoot: "provider-root",
    identityProof: { proof: "opaque" },
    identitySignal: "request-1",
    providerResponses: references,
    contentStore,
    postBond: async (disputeId, providerRoot, amount, expiresAt) => {
      calls.push(`bond:${disputeId}:${providerRoot}:${amount}`);
      assert.equal(expiresAt?.getTime(), bondExpiry.getTime());
      return { transactionId: "0.0.9@1.000000000", scheduleId: "0.0.10" };
    },
    facilitator: new DiscoveryOnlyFacilitator("https://facilitator.invalid"),
    fetchImpl
  });
  assert.equal(result.verdict.verdict, "reject");
  assert.equal(result.bondTransactionId, "0.0.9@1.000000000");
  assert.equal(result.bondScheduleId, "0.0.10");
  assert.equal(result.disputeId !== undefined, true);
  assert.equal(calls[0], "delivery");
  assert.match(calls[1] ?? "", /^content:/);
  assert.match(calls[2] ?? "", /^content:/);
  assert.match(calls[3] ?? "", /^bond:/);
  assert.equal(calls[4], "dispute");
});

test("rejects a facilitator success response that has no transaction ID", async () => {
  process.env.BLOCKY402_URL = "https://facilitator.invalid";
  process.env.HEDERA_NETWORK = "hedera:testnet";
  process.env.HEDERA_CLIENT_ACCOUNT_ID = "0.0.2";
  process.env.HEDERA_CLIENT_PRIVATE_KEY = PrivateKey.generateECDSA().toStringRaw();
  process.env.HEDERA_CLIENT_EVM_ADDRESS = "";
  const facilitator = new DiscoveryOnlyFacilitator("https://facilitator.invalid");
  const fetchImpl: typeof fetch = async (input, init) => {
    if (!init?.headers) {
      return new Response(JSON.stringify({
        x402Version: 2,
        resource: { url: String(input), description: "test", mimeType: "application/json" },
        accepts: [{ scheme: "exact", network: "hedera:testnet", amount: "1", payTo: "0.0.1", maxTimeoutSeconds: 30, asset: "0.0.0", extra: { feePayer: "0.0.999" } }]
      }), { status: 402 });
    }
    return new Response(JSON.stringify({ expectedRate: "1.00", rate: "1.00", toleranceBps: 0 }), { status: 200, headers: { "content-type": "application/json" } });
  };

  await assert.rejects(
    buy("https://provider.invalid/fx", {
      evaluate: "fx-rate-v1",
      facilitator,
      fetchImpl,
      maxPrice: "",
      settle: async () => ({ success: true })
    }),
    /VERITY_SETTLEMENT_FAILED: transaction missing/
  );
});

test("rejects a malformed evaluator result before settlement", async () => {
  process.env.BLOCKY402_URL = "https://facilitator.invalid";
  process.env.HEDERA_NETWORK = "hedera:testnet";
  process.env.HEDERA_CLIENT_ACCOUNT_ID = "0.0.2";
  process.env.HEDERA_CLIENT_PRIVATE_KEY = PrivateKey.generateECDSA().toStringRaw();
  process.env.HEDERA_CLIENT_EVM_ADDRESS = "";
  const fetchImpl: typeof fetch = async (input, init) => {
    if (!init?.headers) {
      return new Response(JSON.stringify({
        x402Version: 2,
        resource: { url: String(input), description: "test", mimeType: "application/json" },
        accepts: [{ scheme: "exact", network: "hedera:testnet", amount: "1", payTo: "0.0.1", maxTimeoutSeconds: 30, asset: "0.0.0", extra: { feePayer: "0.0.999" } }]
      }), { status: 402 });
    }
    return new Response(JSON.stringify({ expectedRate: "1.00", rate: "1.00", toleranceBps: 0 }), { status: 200, headers: { "content-type": "application/json" } });
  };

  await assert.rejects(
    buy("https://provider.invalid/fx", {
      evaluate: (() => ({})) as never,
      facilitator: new DiscoveryOnlyFacilitator("https://facilitator.invalid"),
      fetchImpl,
      settle: async () => {
        throw new Error("settlement should not run");
      }
    }),
    /VERITY_EVALUATOR_SCHEMA/
  );
});

test("rejects malformed provider content before posting a bond", async () => {
  process.env.BLOCKY402_URL = "https://facilitator.invalid";
  process.env.HEDERA_NETWORK = "hedera:testnet";
  process.env.HEDERA_CLIENT_ACCOUNT_ID = "0.0.2";
  process.env.HEDERA_CLIENT_PRIVATE_KEY = PrivateKey.generateECDSA().toStringRaw();
  const fetchImpl: typeof fetch = async (input, init) => {
    if (!init?.headers) {
      return new Response(JSON.stringify({
        x402Version: 2,
        resource: { url: String(input), description: "test", mimeType: "application/json" },
        accepts: [{ scheme: "exact", network: "hedera:testnet", amount: "1", payTo: "0.0.1", maxTimeoutSeconds: 30, asset: "0.0.0", extra: { feePayer: "0.0.999" } }]
      }), { status: 402 });
    }
    return new Response(JSON.stringify({ expectedRate: "1.00", rate: "1.10", toleranceBps: 0 }), { status: 200, headers: { "content-type": "application/json" } });
  };
  let bondPosted = false;

  await assert.rejects(
    buy("https://provider.invalid/fx", {
      evaluate: "fx-rate-v1",
      bond: "10",
      disputeUrl: "https://dispute.invalid/disputes",
      providerId: "provider-1",
      buyerId: "buyer-1",
      providerRoot: "provider-root",
      identityProof: { proof: "opaque" },
      identitySignal: "request-1",
      providerResponses: [
        { sha256: "invalid", mediaType: "application/json", byteLength: 2 },
        reference("checker-b"),
        reference("checker-c")
      ],
      postBond: async () => {
        bondPosted = true;
        return { transactionId: "0.0.9@1.000000000" };
      },
      facilitator: new DiscoveryOnlyFacilitator("https://facilitator.invalid"),
      fetchImpl
    }),
    /VERITY_CONTENT_REFERENCE_INVALID: providerResponses\[0\]/
  );
  assert.equal(bondPosted, false);
});

function reference(seed: string): ContentReference {
  return { sha256: sha256(seed), mediaType: "application/json", byteLength: 2, uri: `https://content.invalid/${seed}` };
}
