import "dotenv/config";
import { createInterface } from "node:readline";
import { readFile } from "node:fs/promises";
import { Blocky402Client, readBuyerConfig } from "@verity/hedera";
import { GraphReputationClient, VerityMcpServer, X402GraphPayment, type ReputationQuery } from "@verity/indexer";

const graphEndpoint = required("GRAPH_SUBGRAPH_URL");
const buyer = readBuyerConfig();
const facilitator = new Blocky402Client(buyer.facilitatorUrl, { requestTimeoutMs: buyer.requestTimeoutMs });
const transport = new X402GraphPayment(facilitator, {
  network: buyer.network,
  accountId: buyer.clientAccountId,
  privateKey: buyer.clientPrivateKey,
  maxHoldSeconds: buyer.maxHoldSeconds,
  ...(process.env.GRAPH_MAX_PRICE?.trim() ? { maxPrice: process.env.GRAPH_MAX_PRICE.trim() } : {})
});
const reputation = new GraphReputationClient(
  graphEndpoint,
  {
    provider: await readQueryFile(required("GRAPH_PROVIDER_QUERY_FILE")),
    buyer: await readQueryFile(required("GRAPH_BUYER_QUERY_FILE"))
  },
  fetch,
  process.env.GRAPH_API_KEY?.trim() || undefined,
  transport
);
const server = new VerityMcpServer(reputation);
const input = createInterface({ input: process.stdin, crlfDelay: Number.POSITIVE_INFINITY });
let queue = Promise.resolve();

input.on("line", (line) => {
  queue = queue.then(() => handleLine(line)).catch((error: unknown) => {
    process.stderr.write(`verity-mcp: ${errorMessage(error)}\n`);
  });
});

async function handleLine(line: string): Promise<void> {
  if (!line.trim()) return;
  let message: unknown;
  try {
    message = JSON.parse(line);
  } catch (error) {
    writeMessage({ jsonrpc: "2.0", id: null, error: { code: -32700, message: `invalid JSON: ${errorMessage(error)}` } });
    return;
  }
  const response = await server.handle(message);
  if (response) writeMessage(response);
}

async function readQueryFile(path: string): Promise<ReputationQuery> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    throw new Error(`VERITY_MCP_QUERY_FILE_READ: could not read ${path}`, { cause: error });
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new Error(`VERITY_MCP_QUERY_FILE_JSON: ${path} was not valid JSON`, { cause: error });
  }
  if (!isRecord(value) || typeof value.query !== "string" || !value.query.trim()) {
    throw new Error(`VERITY_MCP_QUERY_FILE_SCHEMA: ${path} must contain a non-empty query string`);
  }
  const variables = value.variables ?? {};
  if (!isRecord(variables)) throw new Error(`VERITY_MCP_QUERY_FILE_SCHEMA: ${path}.variables must be an object`);
  if (value.format !== undefined && value.format !== "verity-v1" && value.format !== "agent0-v1") {
    throw new Error(`VERITY_MCP_QUERY_FILE_SCHEMA: ${path}.format must be verity-v1 or agent0-v1`);
  }
  return {
    query: value.query,
    variables,
    ...(value.format === undefined ? {} : { format: value.format })
  };
}

function writeMessage(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`VERITY_MCP_CONFIG_MISSING: ${name} is required; set it in .env`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
