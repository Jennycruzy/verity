import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createErc8004Registration } from "@verity/indexer";
import { protect, type ProtectedApplication, type ProtectedRequest } from "@verity/sdk";
import { canonicalizeEntity, evaluateEntity, evaluateFxRate, RULE_IDS, type RuleId } from "@verity/types";
import type { ProviderServiceConfig } from "./config.js";

export function createProviderServer(config: ProviderServiceConfig) {
  return createServer(createProviderHandler(config));
}

export function createProviderHandler(config: ProviderServiceConfig) {
  const protectedApplication = config.kind === "fx" ? createFxApplication(config) : createEntityApplication(config);
  const registration = config.erc8004 ? createErc8004Registration({
    name: `Verity ${config.kind} provider`,
    description: config.kind === "fx" ? "An objectively verifiable foreign-exchange rate service." : "An objectively verifiable entity-resolution service.",
    services: [
      { name: "x402-resource", endpoint: `${config.erc8004.publicUrl}/${config.kind === "fx" ? "fx" : "entity"}`, version: "1" },
      { name: "cross-checker", endpoint: `${config.erc8004.publicUrl}/check`, version: "1" },
      { name: "agent-registration", endpoint: `${config.erc8004.publicUrl}/.well-known/agent-registration.json`, version: "1" }
    ],
    x402Support: true,
    active: true,
    registrations: [{ agentRegistry: config.erc8004.registry, agentId: config.erc8004.agentId }],
    supportedTrust: ["verity/hcs/v1"]
  }) : undefined;
  let protectedHandler: ReturnType<typeof protect> | undefined;

  return async (request: IncomingMessage, response: ServerResponse) => {
    const path = request.url?.split("?", 1)[0] ?? "/";
    try {
      if (path === "/health") {
        writeJson(response, 200, { status: "ok", provider: config.kind });
        return;
      }
      if (path === "/.well-known/agent-registration.json") {
        if (request.method !== "GET") {
          writeJson(response, 405, { error: "method_not_allowed" });
          return;
        }
        if (!registration) {
          writeJson(response, 503, { error: "agent_registration_not_configured" });
          return;
        }
        writeJson(response, 200, registration);
        return;
      }
      if (request.method === "POST" && path === "/check") {
        await handleCheck(request, response, config);
        return;
      }
      if (request.method !== "GET") {
        writeJson(response, 405, { error: "method_not_allowed" });
        return;
      }
      const expectedPath = config.kind === "fx" ? "/fx" : "/entity";
      if (path !== expectedPath) {
        writeJson(response, 404, { error: "not_found" });
        return;
      }
      protectedHandler ??= protect(protectedApplication, {
        price: config.kind === "fx" ? config.fxPrice : (request) => entityPrice(config, request),
        verifier: config.kind === "fx" ? "fx-rate-v1" : "entity-canonical-v1",
        description: config.kind === "fx" ? "Verity FX rate lookup" : "Verity entity resolution lookup"
      });
      await protectedHandler(
        { method: request.method ?? "GET", url: request.url ?? "/", headers: request.headers },
        response
      );
    } catch (error) {
      if (response.writableEnded) return;
      writeJson(response, error instanceof CheckerBodyTooLargeError ? 413 : 502, {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  };
}

async function handleCheck(request: IncomingMessage, response: ServerResponse, config: ProviderServiceConfig): Promise<void> {
  const body = await readBody(request, 65_536);
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    writeJson(response, 400, { error: "checker_json_invalid" });
    return;
  }
  if (!isRecord(value) || typeof value.ruleId !== "string" || !isRecord(value.value)) {
    writeJson(response, 400, { error: "checker_schema_invalid" });
    return;
  }
  const ruleId = value.ruleId as RuleId;
  if (ruleId !== expectedRule(config.kind)) {
    writeJson(response, 400, { error: "checker_rule_unsupported", expectedRule: expectedRule(config.kind) });
    return;
  }
  try {
    const verdict = ruleId === RULE_IDS.fxRate
      ? evaluateFxRate({
        expectedRate: requiredString(value.value.expectedRate, "expectedRate"),
        actualRate: requiredString(value.value.actualRate, "actualRate"),
        toleranceBps: requiredInteger(value.value.toleranceBps, "toleranceBps")
      })
      : evaluateEntity({
        expected: requiredString(value.value.expected, "expected"),
        actual: requiredString(value.value.actual, "actual")
      });
    writeJson(response, 200, verdict);
  } catch (error) {
    writeJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
  }
}

function createFxApplication(config: ProviderServiceConfig): ProtectedApplication {
  return async (_request, response) => {
    const rate = config.degradeMode ? config.degradedFxRate : config.fxReferenceRate;
    if (!rate) throw new Error("VERITY_PROVIDER_RATE_MISSING: rate was not available after config validation");
    writeJson(response, 200, {
      service: "fx-rate",
      pair: config.fxPair,
      expectedRate: config.fxReferenceRate,
      rate,
      toleranceBps: config.fxToleranceBps,
      usageUnits: 1,
      observedAt: new Date().toISOString()
    });
  };
}

function createEntityApplication(config: ProviderServiceConfig): ProtectedApplication {
  return async (request, response) => {
    const name = queryValue(request, "name");
    if (!name) {
      writeJson(response, 400, { error: "name_required" });
      return;
    }
    const fresh = queryValue(request, "fresh") === "true";
    const canonical = canonicalizeEntity(name);
    writeJson(response, 200, {
      service: "entity-resolution",
      input: name,
      expected: name,
      entity: canonical,
      cached: !fresh,
      usageUnits: fresh ? 3 : 1,
      price: fresh ? config.entityFreshPrice : config.entityCachedPrice,
      observedAt: new Date().toISOString()
    });
  };
}

function entityPrice(config: ProviderServiceConfig, request: ProtectedRequest): string {
  return queryValue(request, "fresh") === "true" ? config.entityFreshPrice : config.entityCachedPrice;
}

function queryValue(request: ProtectedRequest, key: string): string | undefined {
  const query = request.url.split("?", 2)[1];
  if (!query) return undefined;
  return new URLSearchParams(query).get(key) ?? undefined;
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

async function readBody(request: IncomingMessage, maxBytes: number): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += value.byteLength;
    if (total > maxBytes) throw new CheckerBodyTooLargeError(maxBytes);
    chunks.push(value);
  }
  return Buffer.concat(chunks, total).toString("utf8");
}

function expectedRule(kind: ProviderServiceConfig["kind"]): RuleId {
  return kind === "fx" ? RULE_IDS.fxRate : RULE_IDS.entityCanonical;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`VERITY_CHECKER_FIELD_INVALID: ${name} must be a non-empty string`);
  return value;
}

function requiredInteger(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new Error(`VERITY_CHECKER_FIELD_INVALID: ${name} must be an integer`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

class CheckerBodyTooLargeError extends Error {
  public constructor(maxBytes: number) {
    super(`VERITY_CHECKER_BODY_TOO_LARGE: request exceeds ${maxBytes} bytes`);
    this.name = "CheckerBodyTooLargeError";
  }
}

export function startProvider(config: ProviderServiceConfig): ReturnType<typeof createServer> {
  const server = createProviderServer(config);
  server.listen(config.port, () => {
    console.log(JSON.stringify({ provider: config.kind, port: config.port, degradeMode: config.degradeMode }));
  });
  return server;
}
