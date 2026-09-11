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
