import assert from "node:assert/strict";
import test from "node:test";
import { ReputationRouter } from "../src/index.ts";

test("routing changes with queried reliability", async () => {
  const router = new ReputationRouter(
    { provider: async (agentId) => ({ agentId, endpoint: `${agentId}.invalid`, reliabilityScore: agentId === "trusted" ? 0.99 : 0.2, completedRequests: 10 }), buyer: async (root) => ({ root, honestyScore: 1, disputes: 0 }) },
    0.8
  );
  const selected = await router.choose([{ agentId: "untrusted", endpoint: "https://untrusted.invalid" }, { agentId: "trusted", endpoint: "https://trusted.invalid" }]);
  assert.equal(selected.agentId, "trusted");
});

test("routing fails when the queried subgraph rejects every provider", async () => {
  const router = new ReputationRouter(
    { provider: async (agentId) => ({ agentId, endpoint: "https://provider.invalid", reliabilityScore: 0.1, completedRequests: 2 }), buyer: async (root) => ({ root, honestyScore: 1, disputes: 0 }) },
    0.8
  );
  await assert.rejects(router.choose([{ agentId: "provider", endpoint: "https://provider.invalid" }]), /VERITY_ROUTER_NO_ELIGIBLE_PROVIDER/);
});

test("routing breaks equal scores with stable byte ordering", async () => {
  const router = new ReputationRouter(
    { provider: async (agentId) => ({ agentId, endpoint: `https://${agentId}.invalid`, reliabilityScore: 0.9, completedRequests: 1 }), buyer: async (root) => ({ root, honestyScore: 1, disputes: 0 }) },
    0.5
  );
  const selected = await router.choose([
    { agentId: "provider-z", endpoint: "https://z.invalid" },
    { agentId: "provider-a", endpoint: "https://a.invalid" }
  ]);
  assert.equal(selected.agentId, "provider-a");
});

test("routing queries buyer honesty and refuses a low-standing root", async () => {
  const queriedRoots: string[] = [];
  const router = new ReputationRouter(
    {
      provider: async (agentId) => ({ agentId, endpoint: "https://provider.invalid", reliabilityScore: 0.95, completedRequests: 4 }),
      buyer: async (root) => {
        queriedRoots.push(root);
        return { root, honestyScore: 0.2, disputes: 3 };
      }
    },
    0.8,
    0.8
  );
  await assert.rejects(
    router.choose([{ agentId: "provider", endpoint: "https://provider.invalid" }], { buyerRoot: "human-root-1" }),
    /VERITY_ROUTER_BUYER_INELIGIBLE/
  );
  assert.deepEqual(queriedRoots, ["human-root-1"]);
});

test("routing returns the queried buyer record with a selected provider", async () => {
  const router = new ReputationRouter(
    {
      provider: async (agentId) => ({ agentId, endpoint: "https://provider.invalid", reliabilityScore: 0.95, completedRequests: 4 }),
      buyer: async (root) => ({ root, honestyScore: 0.99, disputes: 1 })
    },
    0.8,
    0.8
  );
  const selected = await router.choose([{ agentId: "provider", endpoint: "https://provider.invalid" }], { buyerRoot: "human-root-1" });
  assert.equal(selected.buyerReputation?.honestyScore, 0.99);
});
