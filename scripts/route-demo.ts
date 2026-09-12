import "dotenv/config";
import { readFile } from "node:fs/promises";
import { Blocky402Client, readBuyerConfig } from "@verity/hedera";
import { GraphReputationClient, ReputationRouter, X402GraphPayment, type ProviderCandidate, type ReputationQuery } from "@verity/indexer";

const buyer = readBuyerConfig();
const facilitator = new Blocky402Client(buyer.facilitatorUrl, { requestTimeoutMs: buyer.requestTimeoutMs });
const transport = new X402GraphPayment(facilitator, {
  network: buyer.network,
  accountId: buyer.clientAccountId,
  privateKey: buyer.clientPrivateKey,
  ...(process.env.GRAPH_MAX_PRICE?.trim() ? { maxPrice: process.env.GRAPH_MAX_PRICE.trim() } : {})
});
const reputation = new GraphReputationClient(
  required("GRAPH_SUBGRAPH_URL"),
  {
    provider: await readQuery(required("GRAPH_PROVIDER_QUERY_FILE")),
    buyer: await readQuery(required("GRAPH_BUYER_QUERY_FILE"))
  },
  fetch,
  undefined,
  transport
);
const router = new ReputationRouter(reputation, readThreshold());
const selected = await router.choose(readCandidates(required("GRAPH_ROUTE_CANDIDATES_JSON")));
console.log(JSON.stringify({
  source: "paid-graph-reputation",
  selected: selected.agentId,
  endpoint: selected.endpoint,
  reliabilityScore: selected.reputation.reliabilityScore,
  completedRequests: selected.reputation.completedRequests
}, null, 2));

async function readQuery(path: string): Promise<ReputationQuery> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    throw new Error(`VERITY_GRAPH_QUERY_FILE_READ: could not read ${path}`, { cause: error });
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new Error(`VERITY_GRAPH_QUERY_FILE_JSON: ${path} was not valid JSON`, { cause: error });
  }
  if (!isRecord(value) || typeof value.query !== "string" || !value.query.trim()) {
    throw new Error(`VERITY_GRAPH_QUERY_FILE_SCHEMA: ${path} must contain a non-empty query string`);
  }
  const variables = value.variables ?? {};
  if (!isRecord(variables)) throw new Error(`VERITY_GRAPH_QUERY_FILE_SCHEMA: ${path}.variables must be an object`);
  if (value.format !== undefined && value.format !== "verity-v1" && value.format !== "agent0-v1") {
    throw new Error(`VERITY_GRAPH_QUERY_FILE_SCHEMA: ${path}.format must be verity-v1 or agent0-v1`);
  }
  return { query: value.query, variables, ...(value.format === undefined ? {} : { format: value.format }) };
}

function readCandidates(raw: string): readonly ProviderCandidate[] {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new Error("VERITY_GRAPH_ROUTE_CANDIDATES_JSON: value must be valid JSON", { cause: error });
  }
  if (!Array.isArray(value) || value.length === 0) throw new Error("VERITY_GRAPH_ROUTE_CANDIDATES_JSON: provide a non-empty array");
  return value.map((candidate, index) => {
    if (!isRecord(candidate) || typeof candidate.agentId !== "string" || typeof candidate.endpoint !== "string") {
      throw new Error(`VERITY_GRAPH_ROUTE_CANDIDATES_JSON: candidate ${index} needs agentId and endpoint`);
    }
    let url: URL;
    try {
      url = new URL(candidate.endpoint);
    } catch (error) {
      throw new Error(`VERITY_GRAPH_ROUTE_CANDIDATES_JSON: candidate ${index} endpoint must be HTTP(S)`, { cause: error });
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`VERITY_GRAPH_ROUTE_CANDIDATES_JSON: candidate ${index} endpoint must be HTTP(S)`);
    return { agentId: candidate.agentId, endpoint: candidate.endpoint };
  });
}

function readThreshold(): number {
  const value = Number(required("GRAPH_MIN_RELIABILITY"));
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error("VERITY_GRAPH_MIN_RELIABILITY: set a number between 0 and 1");
  return value;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`VERITY_CONFIG_MISSING: ${name} is required; set it in .env`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
