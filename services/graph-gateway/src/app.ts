import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { protect, type ProtectedApplication } from "@verity/sdk";
import type { GraphGatewayConfig } from "./config.js";

interface GraphQuery {
  readonly query: string;
  readonly variables?: Readonly<Record<string, unknown>>;
  readonly operationName?: string;
}

const GRAPH_READINESS_QUERY = "query VerityGraphReadiness { _meta { block { number } } }";

export interface GraphReadiness {
  readonly blockNumber: string;
}

export function createGraphGatewayServer(config: GraphGatewayConfig, fetchImpl: typeof fetch = fetch) {
  const queryHandler = protect(createGraphQueryHandler(config, fetchImpl), {
    price: config.price,
    verifier: "graph-reputation-v1",
    description: "Verity provider reliability and buyer honesty query"
  });
  return createServer((request, response) => {
    void route(request, response, queryHandler, () => checkGraphReadiness(config, fetchImpl)).catch((error: unknown) => {
      if (!response.writableEnded) writeJson(response, statusFor(error), { error: messageFor(error) });
    });
  });
}

export async function checkGraphReadiness(config: GraphGatewayConfig, fetchImpl: typeof fetch = fetch): Promise<GraphReadiness> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.requestTimeoutMs);
  try {
    const response = await fetchImpl(config.subgraphUrl, {
      method: "POST",
      signal: controller.signal,
      headers: upstreamHeaders(config),
      body: JSON.stringify({ query: GRAPH_READINESS_QUERY })
    });
    const raw = await response.text();
    const value = parseUpstreamJson(raw);
    if (!response.ok) throw new Error(`VERITY_GRAPH_READY_HTTP: hosted Graph returned ${response.status}`);
    if (hasGraphErrors(value)) throw new Error(`VERITY_GRAPH_READY_QUERY: hosted Graph returned ${JSON.stringify(value.errors)}`);
    const blockNumber = readBlockNumber(value);
    return { blockNumber };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`VERITY_GRAPH_READY_TIMEOUT: hosted Graph exceeded ${config.requestTimeoutMs}ms`, { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function createGraphQueryHandler(config: GraphGatewayConfig, fetchImpl: typeof fetch = fetch): ProtectedApplication {
  return async (request, response) => {
    if (request.method !== "POST" || pathOf(request.url) !== "/query") {
      writeJson(response, 404, { error: "not_found" });
      return;
    }
    if (!request.raw) throw new Error("VERITY_GRAPH_QUERY_STREAM_MISSING: the protected request has no readable body stream");
    const body = parseQuery(await readBody(request.raw, config.maxBodyBytes));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);
    try {
      const upstream = await fetchImpl(config.subgraphUrl, {
        method: "POST",
        signal: controller.signal,
        headers: upstreamHeaders(config),
        body: JSON.stringify(body)
      });
      const text = await upstream.text();
      const value = parseUpstreamJson(text);
      if (!upstream.ok) throw new Error(`VERITY_GRAPH_UPSTREAM_HTTP: hosted Graph returned ${upstream.status}`);
      response.setHeader("cache-control", "private, no-store");
      writeJson(response, 200, value);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`VERITY_GRAPH_UPSTREAM_TIMEOUT: hosted Graph exceeded ${config.requestTimeoutMs}ms`, { cause: error });
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  };
}

async function route(
  request: IncomingMessage,
  response: ServerResponse,
  queryHandler: ProtectedApplication,
  readiness: () => Promise<GraphReadiness>
): Promise<void> {
  if (request.method === "GET" && pathOf(request.url ?? "/") === "/health") {
    writeJson(response, 200, { status: "ok", source: "graph-gateway" });
    return;
  }
  if (request.method === "GET" && pathOf(request.url ?? "/") === "/ready") {
    const result = await readiness();
    writeJson(response, 200, { status: "ready", source: "graph-gateway", ...result });
    return;
  }
  await queryHandler({
    method: request.method ?? "GET",
    url: request.url ?? "/",
    headers: request.headers,
    raw: request
  }, response);
}

async function readBody(request: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += value.byteLength;
    if (total > maxBytes) throw new Error(`VERITY_GRAPH_QUERY_TOO_LARGE: request exceeds ${maxBytes} bytes`);
    chunks.push(value);
  }
  return Buffer.concat(chunks, total);
}

function parseQuery(raw: Buffer): GraphQuery {
  let value: unknown;
  try {
    value = JSON.parse(raw.toString("utf8"));
  } catch (error) {
    throw new Error("VERITY_GRAPH_QUERY_JSON: request body must be valid JSON", { cause: error });
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("VERITY_GRAPH_QUERY_INVALID: body must be an object");
  const record = value as Record<string, unknown>;
  if (typeof record.query !== "string" || !record.query.trim()) throw new Error("VERITY_GRAPH_QUERY_INVALID: query must be a non-empty string");
  const operation = record.query.replace(/#[^\n\r]*/g, "").trimStart().match(/^([A-Za-z]+)/)?.[1]?.toLowerCase();
  if (operation === "mutation" || operation === "subscription") throw new Error("VERITY_GRAPH_QUERY_READ_ONLY: mutations and subscriptions are not permitted");
  if (record.variables !== undefined && (!record.variables || typeof record.variables !== "object" || Array.isArray(record.variables))) {
    throw new Error("VERITY_GRAPH_QUERY_INVALID: variables must be an object");
  }
  if (record.operationName !== undefined && typeof record.operationName !== "string") {
    throw new Error("VERITY_GRAPH_QUERY_INVALID: operationName must be a string");
  }
  return {
    query: record.query,
    ...(record.variables !== undefined ? { variables: record.variables as Readonly<Record<string, unknown>> } : {}),
    ...(record.operationName !== undefined ? { operationName: record.operationName as string } : {})
  };
}

function parseUpstreamJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error("VERITY_GRAPH_UPSTREAM_JSON: hosted Graph returned invalid JSON", { cause: error });
  }
}

function hasGraphErrors(value: unknown): value is { readonly errors: readonly unknown[] } {
  return isRecord(value) && Array.isArray(value.errors) && value.errors.length > 0;
}

function readBlockNumber(value: unknown): string {
  if (!isRecord(value) || !isRecord(value.data) || !isRecord(value.data._meta) || !isRecord(value.data._meta.block)) {
    throw new Error("VERITY_GRAPH_READY_SCHEMA: hosted Graph omitted data._meta.block.number");
  }
  const raw = value.data._meta.block.number;
  const blockNumber = typeof raw === "number" && Number.isSafeInteger(raw) ? String(raw) : typeof raw === "string" ? raw.trim() : "";
  if (!/^\d+$/.test(blockNumber)) throw new Error("VERITY_GRAPH_READY_SCHEMA: hosted Graph returned an invalid block number");
  return blockNumber;
}

function pathOf(url: string): string {
  return url.split("?", 1)[0] ?? "/";
}

function upstreamHeaders(config: GraphGatewayConfig): Record<string, string> {
  return {
    ...(config.upstreamApiKey ? { authorization: `Bearer ${config.upstreamApiKey}` } : {}),
    "content-type": "application/json"
  };
}

function statusFor(error: unknown): number {
  const message = messageFor(error);
  if (message.startsWith("VERITY_GRAPH_QUERY_TOO_LARGE")) return 413;
  if (message.startsWith("VERITY_GRAPH_QUERY_")) return 400;
  return 502;
}

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function writeJson(response: ServerResponse, statusCode: number, value: unknown): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(value));
}
