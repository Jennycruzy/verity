import assert from "node:assert/strict";
import test from "node:test";
import { readGraphGatewayConfig } from "../src/config.ts";

const valid = {
  GRAPH_GATEWAY_PORT: "8092",
  GRAPH_GATEWAY_PRICE: "10",
  GRAPH_STUDIO_QUERY_URL: "https://gateway.thegraph.com/api/subgraphs/id/example",
  GRAPH_GATEWAY_UPSTREAM_API_KEY: "secret"
};

test("reads a complete Graph gateway configuration", () => {
  assert.deepEqual(readGraphGatewayConfig(valid), {
    port: 8092,
    price: "10",
    maxBodyBytes: 65_536,
    requestTimeoutMs: 10_000,
    subgraphUrl: "https://gateway.thegraph.com/api/subgraphs/id/example",
    upstreamApiKey: "secret"
  });
});

test("rejects an unsafe upstream URL", () => {
  assert.throws(() => readGraphGatewayConfig({ ...valid, GRAPH_STUDIO_QUERY_URL: "file:///tmp/query" }), /GRAPH_STUDIO_QUERY_URL/);
});
