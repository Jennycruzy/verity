import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { signRequest } from "@worldcoin/idkit-core/signing";
import { normalizeWorldSessionId } from "@verity/agent";
import type { WorldIdServiceConfig } from "./config.js";
import { renderWorldIdProofPage } from "./page.js";

export function createWorldIdServer(config: WorldIdServiceConfig, fetchImpl: typeof fetch = fetch) {
  return createServer((request, response) => {
    void handleWorldIdRequest(request, response, config, fetchImpl).catch((error: unknown) => {
      if (!response.writableEnded) writeJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
    });
  });
}

export async function handleWorldIdRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: WorldIdServiceConfig,
  fetchImpl: typeof fetch = fetch
): Promise<void> {
  const path = request.url?.split("?", 1)[0] ?? "/";
  if (request.method === "GET" && path === "/") {
    response.statusCode = 200;
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.setHeader("cache-control", "no-store");
    response.end(renderWorldIdProofPage(config.proofMode ?? "uniqueness", config.environment));
    return;
  }
  if (request.method === "GET" && path === "/health") {
    writeJson(response, 200, { status: "ok", source: "world-id" });
    return;
  }
  if (request.method !== "POST" || (path !== "/rp-signature" && path !== "/verify-proof")) {
    writeJson(response, 404, { error: "not_found" });
    return;
  }
  const body = await readJson(request, 32_768);
  if (path === "/rp-signature") {
    if ((config.proofMode ?? "uniqueness") === "session") {
      const suppliedSessionId = optionalString(body.session_id);
      if (suppliedSessionId) normalizeWorldSessionId(suppliedSessionId);
      const signature = signRequest({ signingKeyHex: config.signingKeyHex });
      writeJson(response, 200, {
        app_id: config.appId,
        rp_id: config.rpId,
        sig: signature.sig,
        nonce: signature.nonce,
        created_at: signature.createdAt,
        expires_at: signature.expiresAt,
        environment: config.environment,
        proof_mode: "session",
        ...(suppliedSessionId ? { session_id: suppliedSessionId } : {})
      });
      return;
    }
    const action = requiredString(body.action, "action");
    if (!config.allowedActions.includes(action)) throw new Error(`VERITY_WORLD_ACTION_FORBIDDEN: action ${action} is not configured`);
    const signature = signRequest({ signingKeyHex: config.signingKeyHex, action });
    writeJson(response, 200, {
      app_id: config.appId,
      rp_id: config.rpId,
      action,
      sig: signature.sig,
      nonce: signature.nonce,
      created_at: signature.createdAt,
      expires_at: signature.expiresAt,
      environment: config.environment
    });
    return;
  }

  const proof = body.idkitResponse;
  if (!proof || typeof proof !== "object" || Array.isArray(proof)) throw new Error("VERITY_WORLD_PROOF_INVALID: idkitResponse must be an object");
  const upstream = await fetchImpl(config.verifyUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(proof)
  });
  const raw = await upstream.text();
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new Error("VERITY_WORLD_VERIFY_JSON: Developer Portal returned invalid JSON", { cause: error });
  }
  writeJson(response, upstream.ok ? 200 : 400, value);
}

async function readJson(request: IncomingMessage, maxBytes: number): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += value.byteLength;
    if (total > maxBytes) throw new Error(`VERITY_WORLD_BODY_TOO_LARGE: request exceeds ${maxBytes} bytes`);
    chunks.push(value);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks, total).toString("utf8"));
  } catch (error) {
    throw new Error("VERITY_WORLD_JSON: request body must be valid JSON", { cause: error });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("VERITY_WORLD_JSON: request body must be an object");
  return parsed as Record<string, unknown>;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`VERITY_WORLD_FIELD_MISSING: ${name} is required`);
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || !value.trim()) throw new Error("VERITY_WORLD_SESSION_INVALID: session_id must be a non-empty string");
  return value.trim();
}

function writeJson(response: ServerResponse, statusCode: number, value: unknown): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(value));
}
