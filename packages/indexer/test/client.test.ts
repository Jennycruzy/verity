import assert from "node:assert/strict";
import { PrivateKey } from "@hiero-ledger/sdk";
import test from "node:test";
import { Blocky402Client } from "@verity/hedera";
import { GraphReputationClient, X402GraphPayment } from "../src/client.ts";

class FacilitatorForTest extends Blocky402Client {
  public override async supported() {
    return {
      kinds: [{ x402Version: 2, scheme: "exact", network: "hedera:testnet", extra: { feePayer: "0.0.999" } }],
      extensions: [],
      signers: { "hedera:*": ["0.0.999"] }
    };
  }

  public settled = false;

  public override async settle() {
    this.settled = true;
    return { success: true, transaction: "0.0.9@1.000000000", network: "hedera:testnet" };
  }
}

test("pays and settles a Graph reputation query through x402", async () => {
  const facilitator = new FacilitatorForTest("https://facilitator.invalid");
  const requirements = {
    scheme: "exact" as const,
    network: "hedera:testnet" as const,
    amount: "2",
    payTo: "0.0.1",
    maxTimeoutSeconds: 30,
    asset: "0.0.0",
    extra: { feePayer: "0.0.999" }
  };
  const paymentRequired = {
    x402Version: 2 as const,
    resource: { url: "https://graph.invalid/query", description: "reputation", mimeType: "application/json" },
    accepts: [requirements]
  };
  const requests: RequestInit[] = [];
  const payment = new X402GraphPayment(
    facilitator,
    { network: "hedera:testnet", accountId: "0.0.2", privateKey: PrivateKey.generateECDSA().toStringRaw() },
    async (_input, init) => {
      requests.push(init);
      if (requests.length === 1) return new Response(JSON.stringify(paymentRequired), { status: 402 });
      return new Response(JSON.stringify({
        data: { agentId: "agent-1", endpoint: "https://provider.invalid/fx", reliabilityScore: 0.97, completedRequests: 12 }
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
  );
  const client = new GraphReputationClient(
    "https://graph.invalid/query",
    { provider: { query: "query Provider($agentId: ID!) { agent(id: $agentId) { id } }", variables: {} }, buyer: { query: "query Buyer { buyer { root } }", variables: {} } },
    fetch,
    undefined,
    payment
  );

  const result = await client.provider("agent-1");
  assert.equal(result.reliabilityScore, 0.97);
  assert.equal(facilitator.settled, true);
  assert.equal(requests.length, 2);
  assert.equal(new Headers(requests[1]?.headers).has("payment-signature"), true);
  assert.match(String(requests[0]?.body), /agentId/);
});

test("paid Graph transport rejects an endpoint that skips the payment challenge", async () => {
  const payment = new X402GraphPayment(
    new FacilitatorForTest("https://facilitator.invalid"),
    { network: "hedera:testnet", accountId: "0.0.2", privateKey: PrivateKey.generateECDSA().toStringRaw() },
    async () => new Response(JSON.stringify({ data: {} }), { status: 200 })
  );
  await assert.rejects(payment.request("https://graph.invalid/query", { method: "POST" }), /VERITY_GRAPH_PAYMENT_REQUIRED/);
});
