import assert from "node:assert/strict";
import test from "node:test";
import { Blocky402Client, discoverHederaCapability } from "../src/index.ts";

const supported = {
  kinds: [{ x402Version: 2, scheme: "exact", network: "hedera:testnet", extra: { feePayer: "0.0.999" } }],
  extensions: [],
  signers: { "hedera:*": ["0.0.999"] }
};

test("discovers the advertised Hedera fee payer", async () => {
  const client = new Blocky402Client("https://facilitator.invalid", {
    fetchImpl: async () => new Response(JSON.stringify(supported), { status: 200 })
  });
  const capability = await discoverHederaCapability(client, "hedera:testnet");
  assert.deepEqual(capability, {
    x402Version: 2,
    scheme: "exact",
    network: "hedera:testnet",
    feePayer: "0.0.999"
  });
});

test("fails closed when fee payer is not one of the advertised signers", async () => {
  const client = new Blocky402Client("https://facilitator.invalid", {
    fetchImpl: async () => new Response(JSON.stringify({ ...supported, signers: { "hedera:*": ["0.0.998"] } }), { status: 200 })
  });
  await assert.rejects(discoverHederaCapability(client, "hedera:testnet"), /VERITY_FEE_PAYER_MISMATCH/);
});

test("sends the v2 envelope to verify", async () => {
  let requestBody: unknown;
  const client = new Blocky402Client("https://facilitator.invalid", {
    fetchImpl: async (_input, init) => {
      requestBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ isValid: true, payer: "payer" }), { status: 200 });
    }
  });
  const result = await client.verify(
    { x402Version: 2, accepted: { scheme: "exact", network: "hedera:testnet", amount: "1", payTo: "0.0.1", maxTimeoutSeconds: 30, asset: "0.0.0", extra: {} }, payload: { transaction: "abc" } },
    { scheme: "exact", network: "hedera:testnet", amount: "1", payTo: "0.0.1", maxTimeoutSeconds: 30, asset: "0.0.0", extra: {} }
  );
  assert.equal(result.isValid, true);
  assert.deepEqual(requestBody, {
    x402Version: 2,
    paymentPayload: { x402Version: 2, accepted: { scheme: "exact", network: "hedera:testnet", amount: "1", payTo: "0.0.1", maxTimeoutSeconds: 30, asset: "0.0.0", extra: {} }, payload: { transaction: "abc" } },
    paymentRequirements: { scheme: "exact", network: "hedera:testnet", amount: "1", payTo: "0.0.1", maxTimeoutSeconds: 30, asset: "0.0.0", extra: {} }
  });
});
