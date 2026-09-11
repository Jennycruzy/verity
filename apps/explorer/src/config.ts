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
    graphEndpoint: required(env, "GRAPH_SUBGRAPH_URL"),
    ...(env.GRAPH_API_KEY?.trim() ? { graphApiKey: env.GRAPH_API_KEY.trim() } : {}),
    providerQueryFile: required(env, "GRAPH_PROVIDER_QUERY_FILE"),
    buyerQueryFile: required(env, "GRAPH_BUYER_QUERY_FILE")
  };
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
  const query = value as { query: string; variables?: unknown };
  if (query.variables !== undefined && (typeof query.variables !== "object" || query.variables === null || Array.isArray(query.variables))) {
    throw new Error(`VERITY_EXPLORER_QUERY_SCHEMA: ${path} variables must be an object`);
  }
  return { query: query.query, variables: (query.variables ?? {}) as Readonly<Record<string, unknown>> };
}
