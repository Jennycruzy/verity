import assert from "node:assert/strict";
import test from "node:test";
import { createExplorerHandler } from "../src/app.ts";

test("explorer serves queried provider reputation", async () => {
  const handler = createExplorerHandler({
    provider: async (agentId) => ({ agentId, endpoint: "https://provider.invalid", reliabilityScore: 0.9, completedRequests: 3 }),
    buyer: async (root) => ({ root, honestyScore: 0.8, disputes: 1 })
  });
  const headers = new Map<string, string>();
  let body = "";
  const response = {
    statusCode: 0,
    setHeader(name: string, value: string) { headers.set(name, value); },
    end(value: string) { body = value; }
  } as never;
  await handler({ url: "/provider?agentId=agent-1" }, response);
  assert.equal((response as { statusCode: number }).statusCode, 200);
  assert.equal(headers.get("content-type"), "application/json; charset=utf-8");
  assert.deepEqual(JSON.parse(body), { agentId: "agent-1", endpoint: "https://provider.invalid", reliabilityScore: 0.9, completedRequests: 3 });
});

test("explorer serves a browser page without querying local state", async () => {
  const handler = createExplorerHandler({
    provider: async () => ({ agentId: "agent-1", endpoint: "https://provider.invalid", reliabilityScore: 0.9, completedRequests: 3 }),
    buyer: async () => ({ root: "root-1", honestyScore: 0.8, disputes: 1 })
  });
  const headers = new Map<string, string>();
  let body = "";
  const response = {
    statusCode: 0,
    setHeader(name: string, value: string) { headers.set(name, value); },
    end(value: string) { body = value; }
  } as never;
  await handler({ url: "/" }, response);
  assert.equal((response as { statusCode: number }).statusCode, 200);
  assert.equal(headers.get("content-type"), "text/html; charset=utf-8");
  assert.match(body, /Verity reputation/);
  assert.match(body, /GraphReputationClient/);
  assert.match(body, /provider reliability/i);
  assert.match(body, /Run live purchase/);
});

test("interactive purchase returns only structured runner evidence", async () => {
  const handler = createExplorerHandler({
    provider: async () => ({ agentId: "agent-1", endpoint: "https://provider.invalid", reliabilityScore: 0.9, completedRequests: 3 }),
    buyer: async () => ({ root: "root-1", honestyScore: 0.8, disputes: 1 })
  }, {
    runHonestPurchase: async () => ({
      startedAt: "2026-09-13T00:00:00.000Z",
      finishedAt: "2026-09-13T00:00:01.000Z",
      events: [{ requestId: "request-1", verdict: "accept" }]
    })
  });
  let body = "";
  const response = {
    statusCode: 0,
    setHeader() {},
    end(value: string) { body = value; }
  } as never;
  await handler({ url: "/demo/honest", method: "POST" }, response);
  assert.equal((response as { statusCode: number }).statusCode, 200);
  assert.deepEqual(JSON.parse(body).events, [{ requestId: "request-1", verdict: "accept" }]);
});

test("interactive purchase is disabled unless explicitly configured", async () => {
  const handler = createExplorerHandler({
    provider: async () => ({ agentId: "agent-1", endpoint: "https://provider.invalid", reliabilityScore: 0.9, completedRequests: 3 }),
    buyer: async () => ({ root: "root-1", honestyScore: 0.8, disputes: 1 })
  });
  let body = "";
  const response = {
    statusCode: 0,
    setHeader() {},
    end(value: string) { body = value; }
  } as never;
  await handler({ url: "/demo/honest", method: "POST" }, response);
  assert.equal((response as { statusCode: number }).statusCode, 503);
  assert.equal(JSON.parse(body).error, "interactive_demo_unavailable");
});
