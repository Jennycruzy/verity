import "dotenv/config";

const endpoint = requiredUrl("GRAPH_STUDIO_QUERY_URL");
const apiKey = process.env.GRAPH_API_KEY?.trim() || process.env.GRAPH_GATEWAY_UPSTREAM_API_KEY?.trim();
if (!apiKey && !isStudioEndpoint(endpoint)) {
  throw new Error("VERITY_GRAPH_HOSTED_KEY_MISSING: set GRAPH_API_KEY or GRAPH_GATEWAY_UPSTREAM_API_KEY for non-Studio Graph endpoints");
}

const timeoutMs = positiveInteger(process.env.GRAPH_GATEWAY_TIMEOUT_MS?.trim() || "10000", "GRAPH_GATEWAY_TIMEOUT_MS");
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), timeoutMs);
try {
  const response = await fetch(endpoint, {
    method: "POST",
    signal: controller.signal,
    headers: {
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      "content-type": "application/json"
    },
    body: JSON.stringify({ query: "query VerityHostedReadiness { _meta { block { number } } }" })
  });
  const raw = await response.text();
  const body = parseJson(raw);
  if (!response.ok) throw new Error(`VERITY_GRAPH_HOSTED_HTTP: endpoint returned HTTP ${response.status}`);
  if (hasErrors(body)) throw new Error(`VERITY_GRAPH_HOSTED_QUERY: ${JSON.stringify(body.errors)}`);
  const blockNumber = readBlockNumber(body);
  console.log(JSON.stringify({ state: "ready", endpoint, blockNumber, authentication: apiKey ? "bearer" : "studio-anonymous" }, null, 2));
} catch (error) {
  if (error instanceof Error && error.name === "AbortError") {
    throw new Error(`VERITY_GRAPH_HOSTED_TIMEOUT: endpoint exceeded ${timeoutMs}ms`, { cause: error });
  }
  throw error;
} finally {
  clearTimeout(timer);
}

function requiredUrl(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`VERITY_CONFIG_MISSING: ${name} is required; set it in .env`);
  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    throw new Error(`VERITY_CONFIG_INVALID: ${name} must be an absolute HTTP(S) URL`, { cause: error });
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`VERITY_CONFIG_INVALID: ${name} must use HTTP(S)`);
  return url.toString();
}

function isStudioEndpoint(value: string): boolean {
  return new URL(value).hostname === "api.studio.thegraph.com";
}

function positiveInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`VERITY_CONFIG_INVALID: ${name} must be a positive integer`);
  return parsed;
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error("VERITY_GRAPH_HOSTED_JSON: endpoint returned invalid JSON", { cause: error });
  }
}

function hasErrors(value: unknown): value is { readonly errors: readonly unknown[] } {
  return isRecord(value) && Array.isArray(value.errors) && value.errors.length > 0;
}

function readBlockNumber(value: unknown): string {
  if (!isRecord(value) || !isRecord(value.data) || !isRecord(value.data._meta) || !isRecord(value.data._meta.block)) {
    throw new Error("VERITY_GRAPH_HOSTED_SCHEMA: endpoint omitted data._meta.block.number");
  }
  const raw = value.data._meta.block.number;
  const blockNumber = typeof raw === "number" && Number.isSafeInteger(raw) ? String(raw) : typeof raw === "string" ? raw.trim() : "";
  if (!/^\d+$/.test(blockNumber)) throw new Error("VERITY_GRAPH_HOSTED_SCHEMA: endpoint returned an invalid block number");
  return blockNumber;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
