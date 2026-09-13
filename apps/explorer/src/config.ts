import { readFile } from "node:fs/promises";
import type { ReputationQuery } from "@verity/indexer";

export interface ExplorerConfig {
  readonly port: number;
  readonly graphEndpoint: string;
  readonly graphApiKey?: string;
  readonly providerQueryFile: string;
  readonly buyerQueryFile: string;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`VERITY_EXPLORER_CONFIG_MISSING: ${name} is required`);
  return value;
}

export function readExplorerConfig(env: NodeJS.ProcessEnv = process.env): ExplorerConfig {
  const port = Number(required(env, "EXPLORER_PORT"));
  if (!Number.isSafeInteger(port) || port <= 0) throw new Error("VERITY_EXPLORER_CONFIG_INVALID: EXPLORER_PORT must be a positive integer");
  return {
    port,
    graphEndpoint: requiredUrl(env, env.EXPLORER_GRAPH_URL?.trim() || env.GRAPH_STUDIO_QUERY_URL?.trim(), "EXPLORER_GRAPH_URL or GRAPH_STUDIO_QUERY_URL"),
    ...(env.GRAPH_API_KEY?.trim() ? { graphApiKey: env.GRAPH_API_KEY.trim() } : {}),
    providerQueryFile: required(env, "GRAPH_PROVIDER_QUERY_FILE"),
    buyerQueryFile: required(env, "GRAPH_BUYER_QUERY_FILE")
  };
}

function requiredUrl(env: NodeJS.ProcessEnv, value: string | undefined, name: string): string {
  if (!value) throw new Error(`VERITY_EXPLORER_CONFIG_MISSING: ${name} is required`);
  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    throw new Error(`VERITY_EXPLORER_CONFIG_INVALID: ${name} must be an absolute HTTP(S) URL`, { cause: error });
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`VERITY_EXPLORER_CONFIG_INVALID: ${name} must be an absolute HTTP(S) URL`);
  }
  return url.toString();
}

export async function readQueryFile(path: string): Promise<ReputationQuery> {
  const raw = await readFile(path, "utf8");
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new Error(`VERITY_EXPLORER_QUERY_JSON: ${path} was not valid JSON`, { cause: error });
  }
  if (!value || typeof value !== "object" || typeof (value as { query?: unknown }).query !== "string") {
    throw new Error(`VERITY_EXPLORER_QUERY_SCHEMA: ${path} must contain a query string`);
  }
  const query = value as { query: string; variables?: unknown; format?: unknown };
  if (query.variables !== undefined && (typeof query.variables !== "object" || query.variables === null || Array.isArray(query.variables))) {
    throw new Error(`VERITY_EXPLORER_QUERY_SCHEMA: ${path} variables must be an object`);
  }
  if (query.format !== undefined && query.format !== "verity-v1" && query.format !== "agent0-v1") {
    throw new Error(`VERITY_EXPLORER_QUERY_SCHEMA: ${path} format must be verity-v1 or agent0-v1`);
  }
  return {
    query: query.query,
    variables: (query.variables ?? {}) as Readonly<Record<string, unknown>>,
    ...(query.format === undefined ? {} : { format: query.format })
  };
}
