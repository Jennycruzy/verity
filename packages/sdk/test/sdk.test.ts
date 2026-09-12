import assert from "node:assert/strict";
import { PrivateKey } from "@hiero-ledger/sdk";
import test from "node:test";
import { Blocky402Client } from "@verity/hedera";
import { buy, protect } from "../src/index.ts";

class DiscoveryOnlyFacilitator extends Blocky402Client {
  public override async supported() {
    return {
      kinds: [{ x402Version: 2, scheme: "exact", network: "hedera:testnet", extra: { feePayer: "0.0.999" } }],
      extensions: [],
      signers: { "hedera:*": ["0.0.999"] }
    };
  }
}

test("protect returns a v2 payment challenge before invoking the application", async () => {
  process.env.BLOCKY402_URL = "https://facilitator.invalid";
  process.env.HEDERA_NETWORK = "hedera:testnet";
  process.env.HEDERA_ASSET_ID = "0.0.0";
  process.env.HEDERA_PAY_TO_ACCOUNT_ID = "0.0.1";

  let applicationCalled = false;
  const handler = protect(
    async () => {
      applicationCalled = true;
    },
    { price: "1", verifier: "fx-rate-v1", facilitator: new DiscoveryOnlyFacilitator("https://facilitator.invalid") }
  );

  const headers = new Map<string, string>();
  let body = "";
  const response = {
    statusCode: 200,
    setHeader(name: string, value: string) {
      headers.set(name.toLowerCase(), value);
    },
    end(value: string) {
      body = value;
    }
  } as never;

  await handler({ method: "GET", url: "/fx", headers: {} }, response);

  assert.equal(applicationCalled, false);
  assert.equal((response as { statusCode: number }).statusCode, 402);
  assert.ok(headers.get("payment-required"));
  assert.match(body, /"x402Version":2/);
});

test("protect rejects invalid timeout and stake metadata", async () => {
  process.env.BLOCKY402_URL = "https://facilitator.invalid";
  process.env.HEDERA_NETWORK = "hedera:testnet";
  process.env.HEDERA_ASSET_ID = "0.0.0";
  process.env.HEDERA_PAY_TO_ACCOUNT_ID = "0.0.1";
  const response = { setHeader() {}, end() {} } as never;
  const timeoutHandler = protect(async () => {}, {
    price: "1",
    verifier: "fx-rate-v1",
    maxTimeoutSeconds: 0,
    facilitator: new DiscoveryOnlyFacilitator("https://facilitator.invalid")
  });
  await assert.rejects(timeoutHandler({ method: "GET", url: "/fx", headers: {} }, response), /VERITY_TIMEOUT_INVALID/);

  assert.throws(() => protect(async () => {}, {
    price: "1",
    verifier: "fx-rate-v1",
    stake: "0",
    facilitator: new DiscoveryOnlyFacilitator("https://facilitator.invalid")
  }), /VERITY_STAKE_INVALID/);
});

test("buy rejects an invalid dispute URL before any bond callback", async () => {
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
    return new Response(JSON.stringify({ expectedRate: "1.00", rate: "1.10", toleranceBps: 0 }), { status: 200, headers: { "content-type": "application/json" } });
  };
  let bondPosted = false;

  await assert.rejects(
    buy("https://provider.invalid/fx", {
      evaluate: "fx-rate-v1",
      bond: "10",
      disputeUrl: "not-a-url",
      providerId: "provider-1",
      buyerId: "buyer-1",
      providerRoot: "provider-root",
      identityProof: { proof: "opaque" },
      identitySignal: "request-1",
      providerResponses: [
        { sha256: "a".repeat(64), mediaType: "application/json", byteLength: 2 },
        { sha256: "b".repeat(64), mediaType: "application/json", byteLength: 2 },
        { sha256: "c".repeat(64), mediaType: "application/json", byteLength: 2 }
      ],
      postBond: async () => {
        bondPosted = true;
        return { transactionId: "0.0.9@1.000000000" };
      },
      facilitator: new DiscoveryOnlyFacilitator("https://facilitator.invalid"),
      fetchImpl
    }),
    /VERITY_DISPUTE_URL_INVALID/
  );
  assert.equal(bondPosted, false);
});
