export interface GraphGatewayConfig {
  readonly port: number;
  readonly price: string;
  readonly maxBodyBytes: number;
  readonly requestTimeoutMs: number;
  readonly subgraphUrl: string;
  readonly upstreamApiKey: string;
}

export function readGraphGatewayConfig(env: NodeJS.ProcessEnv = process.env): GraphGatewayConfig {
  return {
    port: positiveInteger(env, "GRAPH_GATEWAY_PORT"),
    price: positiveAmount(env, "GRAPH_GATEWAY_PRICE"),
    maxBodyBytes: optionalPositiveInteger(env, "GRAPH_GATEWAY_MAX_BODY_BYTES", 65_536),
    requestTimeoutMs: optionalPositiveInteger(env, "GRAPH_GATEWAY_TIMEOUT_MS", 10_000),
    subgraphUrl: httpUrl(env, "GRAPH_STUDIO_QUERY_URL"),
    upstreamApiKey: required(env, "GRAPH_GATEWAY_UPSTREAM_API_KEY")
  };
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`VERITY_GRAPH_GATEWAY_CONFIG_MISSING: ${name} is required`);
  return value;
}

function positiveInteger(env: NodeJS.ProcessEnv, name: string): number {
  const value = Number(required(env, name));
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`VERITY_GRAPH_GATEWAY_CONFIG_INVALID: ${name} must be a positive integer`);
  }
  return value;
}

function optionalPositiveInteger(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  return env[name]?.trim() ? positiveInteger(env, name) : fallback;
}

function positiveAmount(env: NodeJS.ProcessEnv, name: string): string {
  const value = required(env, name);
  if (!/^\d+$/.test(value) || BigInt(value) <= 0n) {
    throw new Error(`VERITY_GRAPH_GATEWAY_CONFIG_INVALID: ${name} must be a positive integer amount`);
  }
  return value;
}

function httpUrl(env: NodeJS.ProcessEnv, name: string): string {
  const value = required(env, name);
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch (error) {
    throw new Error(`VERITY_GRAPH_GATEWAY_CONFIG_INVALID: ${name} must be an absolute HTTP(S) URL`, { cause: error });
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`VERITY_GRAPH_GATEWAY_CONFIG_INVALID: ${name} must be an absolute HTTP(S) URL`);
  }
  return parsed.toString();
}
