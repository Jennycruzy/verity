import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { protect, type ProtectedApplication, type ProtectedRequest } from "@verity/sdk";
import { canonicalizeEntity } from "@verity/types";
import type { ProviderServiceConfig } from "./config.js";

export function createProviderServer(config: ProviderServiceConfig) {
  const protectedApplication = config.kind === "fx" ? createFxApplication(config) : createEntityApplication(config);
  const protectedHandler = protect(protectedApplication, {
    price: config.kind === "fx" ? config.fxPrice : (request) => entityPrice(config, request),
    verifier: config.kind === "fx" ? "fx-rate-v1" : "entity-canonical-v1",
    description: config.kind === "fx" ? "Verity FX rate lookup" : "Verity entity resolution lookup"
  });

  return createServer(async (request, response) => {
    if (request.url === "/health") {
      writeJson(response, 200, { status: "ok", provider: config.kind });
      return;
    }
    if (request.method !== "GET") {
      writeJson(response, 405, { error: "method_not_allowed" });
      return;
    }
    const path = request.url?.split("?", 1)[0] ?? "/";
    const expectedPath = config.kind === "fx" ? "/fx" : "/entity";
    if (path !== expectedPath) {
      writeJson(response, 404, { error: "not_found" });
      return;
    }
    await protectedHandler(
      { method: request.method ?? "GET", url: request.url ?? "/", headers: request.headers },
      response
    );
  });
}

function createFxApplication(config: ProviderServiceConfig): ProtectedApplication {
  return async (_request, response) => {
    const rate = config.degradeMode ? config.degradedFxRate : config.fxReferenceRate;
    if (!rate) throw new Error("VERITY_PROVIDER_RATE_MISSING: rate was not available after config validation");
    writeJson(response, 200, {
      service: "fx-rate",
      pair: config.fxPair,
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

export function startProvider(config: ProviderServiceConfig): ReturnType<typeof createServer> {
  const server = createProviderServer(config);
  server.listen(config.port, () => {
    console.log(JSON.stringify({ provider: config.kind, port: config.port, degradeMode: config.degradeMode }));
  });
  return server;
}
