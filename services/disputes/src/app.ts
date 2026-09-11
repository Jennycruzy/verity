import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { DisputeInputError, DisputeProcessor, IdempotencyConflictError, isDisputeSubmission } from "./service.js";

export interface DisputeHttpConfig {
  readonly maxBodyBytes: number;
}

export function createDisputeServer(processor: DisputeProcessor, config: DisputeHttpConfig) {
  return createServer((request, response) => {
    void handleRequest(request, response, processor, config).catch((error: unknown) => {
      if (response.writableEnded) return;
      const status = error instanceof DisputeInputError ? 400 : error instanceof IdempotencyConflictError ? 409 : 500;
      writeJson(response, status, { error: error instanceof Error ? error.message : String(error) });
    });
  });
}

export async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  processor: DisputeProcessor,
  config: DisputeHttpConfig
): Promise<void> {
  const path = request.url?.split("?", 1)[0] ?? "/";
  if (request.method === "GET" && path === "/health") {
    writeJson(response, 200, { status: "ok", service: "disputes" });
    return;
  }
  if (request.method !== "POST" || path !== "/disputes") {
    response.setHeader("allow", "GET, POST");
    writeJson(response, 404, { error: "not_found" });
    return;
  }
  const body = await readBody(request, config.maxBodyBytes);
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch (error) {
    throw new DisputeInputError("VERITY_DISPUTE_JSON: request body was not valid JSON");
  }
  if (!isDisputeSubmission(value)) throw new DisputeInputError("VERITY_DISPUTE_SCHEMA: request body did not match the dispute schema");
  const idempotencyKey = headerValue(request.headers["idempotency-key"]);
  if (idempotencyKey !== undefined && idempotencyKey !== value.disputeId) {
    throw new DisputeInputError("VERITY_DISPUTE_IDEMPOTENCY_KEY: header must match disputeId");
  }
  const result = await processor.submit(value);
  writeJson(response, result.created ? 201 : 200, result.result);
}

async function readBody(request: IncomingMessage, maxBytes: number): Promise<string> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new Error("VERITY_DISPUTE_BODY_LIMIT_INVALID: maxBodyBytes must be positive");
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += value.byteLength;
    if (total > maxBytes) throw new DisputeInputError(`VERITY_DISPUTE_BODY_TOO_LARGE: request exceeds ${maxBytes} bytes`);
    chunks.push(value);
  }
  return Buffer.concat(chunks, total).toString("utf8");
}

function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function writeJson(response: ServerResponse, statusCode: number, value: unknown): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(value));
}
