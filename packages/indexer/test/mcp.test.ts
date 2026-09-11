import assert from "node:assert/strict";
import test from "node:test";
import { VerityMcpServer } from "../src/mcp.ts";

test("exposes reputation tools through MCP request handling", async () => {
  const server = new VerityMcpServer({
    provider: async (agentId) => ({ agentId, endpoint: "https://provider.invalid/fx", reliabilityScore: 0.98, completedRequests: 21 }),
    buyer: async (root) => ({ root, honestyScore: 0.75, disputes: 4 })
  });
  const initialize = await server.handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
  assert.equal((initialize?.result as { protocolVersion: string }).protocolVersion, "2024-11-05");
  const listed = await server.handle({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  assert.equal((listed?.result as { tools: readonly { name: string }[] }).tools.length, 2);

  const provider = await server.handle({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "verity_provider_reputation", arguments: { agentId: "agent-7" } }
  });
  assert.deepEqual((provider?.result as { structuredContent: unknown }).structuredContent, {
    agentId: "agent-7",
    endpoint: "https://provider.invalid/fx",
    reliabilityScore: 0.98,
    completedRequests: 21
  });

  const buyer = await server.handle({
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: { name: "verity_buyer_honesty", arguments: { root: "root-7" } }
  });
  assert.equal((buyer?.result as { structuredContent: { honestyScore: number } }).structuredContent.honestyScore, 0.75);
  assert.equal(await server.handle({ jsonrpc: "2.0", method: "notifications/initialized" }), undefined);
});

test("returns a tool error for invalid or unknown calls", async () => {
  const server = new VerityMcpServer({
    provider: async () => ({ agentId: "agent", endpoint: "https://provider.invalid", reliabilityScore: 1, completedRequests: 1 }),
    buyer: async (root) => ({ root, honestyScore: 1, disputes: 0 })
  });
  const invalid = await server.handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "verity_provider_reputation", arguments: {} } });
  assert.equal((invalid?.result as { isError: boolean }).isError, true);
  const unknown = await server.handle({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "unknown", arguments: {} } });
  assert.equal((unknown?.result as { isError: boolean }).isError, true);
});
