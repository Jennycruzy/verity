import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import { checkGraphReadiness, createGraphQueryHandler } from "../src/app.ts";
import type { GraphGatewayConfig } from "../src/config.ts";

const config: GraphGatewayConfig = {
  port: 8092,
  price: "10",
  maxBodyBytes: 1024,
  requestTimeoutMs: 1000,
  subgraphUrl: "https://graph.invalid/query",
  upstreamApiKey: "private-token"
};

test("forwards a bounded read-only query with server credentials", async () => {
  let authorization = "";
  const fetchImpl: typeof fetch = async (_input, init) => {
    authorization = new Headers(init?.headers).get("authorization") ?? "";
    return new Response(JSON.stringify({ data: { agents: [{ id: "84532:1" }] } }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };
  const result = responseForTest();
  const raw = requestForTest(JSON.stringify({ query: "query Reputation { agents { id } }" }));
  await createGraphQueryHandler(config, fetchImpl)({ method: "POST", url: "/query", headers: raw.headers, raw }, result.response);

  assert.equal(result.status(), 200);
  assert.equal(authorization, "Bearer private-token");
  assert.deepEqual(JSON.parse(result.body()), { data: { agents: [{ id: "84532:1" }] } });
});

test("refuses mutations before contacting the hosted Graph endpoint", async () => {
  let called = false;
  const fetchImpl: typeof fetch = async () => {
    called = true;
    return new Response("{}");
  };
  const result = responseForTest();
  const raw = requestForTest(JSON.stringify({ query: "mutation Change { remove(id: 1) }" }));

  await assert.rejects(
    createGraphQueryHandler(config, fetchImpl)({ method: "POST", url: "/query", headers: raw.headers, raw }, result.response),
    /VERITY_GRAPH_QUERY_READ_ONLY/
  );
  assert.equal(called, false);
});

test("requires a live hosted Graph block for readiness", async () => {
  let authorization = "";
  const result = await checkGraphReadiness(config, async (_input, init) => {
    authorization = new Headers(init?.headers).get("authorization") ?? "";
    return new Response(JSON.stringify({ data: { _meta: { block: { number: "12345" } } } }), { status: 200 });
  });
  assert.deepEqual(result, { blockNumber: "12345" });
  assert.equal(authorization, "Bearer private-token");
});

test("does not send an empty authorization header for anonymous Studio access", async () => {
  let authorization: string | null = "present";
  const anonymousConfig: GraphGatewayConfig = { ...config, upstreamApiKey: undefined };
  const result = await checkGraphReadiness(anonymousConfig, async (_input, init) => {
    authorization = new Headers(init?.headers).get("authorization");
    return new Response(JSON.stringify({ data: { _meta: { block: { number: "12345" } } } }), { status: 200 });
  });
  assert.deepEqual(result, { blockNumber: "12345" });
  assert.equal(authorization, null);
});

test("fails readiness when the hosted Graph reports an error", async () => {
  await assert.rejects(
    checkGraphReadiness(config, async () => new Response(JSON.stringify({ errors: [{ message: "subgraph unavailable" }] }), { status: 200 })),
    /VERITY_GRAPH_READY_QUERY/
  );
});

function requestForTest(body: string): Readable & { method: string; url: string; headers: Record<string, string> } {
  const request = Readable.from([Buffer.from(body)]) as Readable & { method: string; url: string; headers: Record<string, string> };
  request.method = "POST";
  request.url = "/query";
  request.headers = { "content-type": "application/json" };
  return request;
}

function responseForTest() {
  const chunks: Buffer[] = [];
  let statusCode = 0;
  const response = {
    get statusCode() { return statusCode; },
    set statusCode(value: number) { statusCode = value; },
    setHeader() {},
    end(value?: string | Uint8Array) {
      if (value !== undefined) chunks.push(Buffer.from(value));
    }
  } as never;
  return { response, status: () => statusCode, body: () => Buffer.concat(chunks).toString("utf8") };
}
