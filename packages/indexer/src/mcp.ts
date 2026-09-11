import type { BuyerReputation, ProviderReputation, ReputationClient } from "./client.js";

export const MCP_PROTOCOL_VERSION = "2024-11-05" as const;

export interface McpTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: {
    readonly type: "object";
    readonly properties: Readonly<Record<string, { readonly type: "string"; readonly description: string }>>;
    readonly required: readonly string[];
    readonly additionalProperties: false;
  };
}

export interface McpResponse {
  readonly jsonrpc: "2.0";
  readonly id: string | number | null;
  readonly result?: unknown;
  readonly error?: { readonly code: number; readonly message: string };
}

interface McpRequest {
  readonly jsonrpc: "2.0";
  readonly id?: string | number | null;
  readonly method: string;
  readonly params?: unknown;
}

const TOOLS: readonly McpTool[] = [
  {
    name: "verity_provider_reputation",
    description: "Query the live reliability score and completed request count for an ERC-8004 provider agent.",
    inputSchema: {
      type: "object",
      properties: { agentId: { type: "string", description: "The provider agent ID in the configured registry." } },
      required: ["agentId"],
      additionalProperties: false
    }
  },
  {
    name: "verity_buyer_honesty",
    description: "Query the live honesty score and dispute count for a Verity human root.",
    inputSchema: {
      type: "object",
      properties: { root: { type: "string", description: "The canonical human root, not a wallet address." } },
      required: ["root"],
      additionalProperties: false
    }
  }
];

export class VerityMcpServer {
  public constructor(private readonly reputation: ReputationClient) {}

  public async handle(message: unknown): Promise<McpResponse | undefined> {
    if (!isMcpRequest(message)) return errorResponse(null, -32600, "invalid JSON-RPC request");
    if (message.method.startsWith("notifications/")) return undefined;
    const id = message.id ?? null;
    if (message.method === "initialize") {
      return response(id, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "verity-reputation", version: "0.1.0" }
      });
    }
    if (message.method === "tools/list") return response(id, { tools: TOOLS });
    if (message.method === "tools/call") return this.callTool(id, message.params);
    return errorResponse(id, -32601, `method not found: ${message.method}`);
  }

  private async callTool(id: string | number | null, params: unknown): Promise<McpResponse> {
    if (!isRecord(params) || typeof params.name !== "string") {
      return toolError(id, "VERITY_MCP_TOOL_SCHEMA: tools/call requires a tool name");
    }
    const argumentsValue = params.arguments;
    if (!isRecord(argumentsValue)) return toolError(id, "VERITY_MCP_TOOL_SCHEMA: tools/call arguments must be an object");
    try {
      let value: ProviderReputation | BuyerReputation;
      if (params.name === "verity_provider_reputation") {
        value = await this.reputation.provider(requiredText(argumentsValue.agentId, "agentId"));
      } else if (params.name === "verity_buyer_honesty") {
        value = await this.reputation.buyer(requiredText(argumentsValue.root, "root"));
      } else {
        return toolError(id, `VERITY_MCP_TOOL_UNKNOWN: ${params.name}`);
      }
      return response(id, {
        content: [{ type: "text", text: JSON.stringify(value) }],
        structuredContent: value,
        isError: false
      });
    } catch (error) {
      return toolError(id, error instanceof Error ? error.message : String(error));
    }
  }
}

function response(id: string | number | null, result: unknown): McpResponse {
  return { jsonrpc: "2.0", id, result };
}

function errorResponse(id: string | number | null, code: number, message: string): McpResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function toolError(id: string | number | null, message: string): McpResponse {
  return response(id, { content: [{ type: "text", text: message }], isError: true });
}

function requiredText(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`VERITY_MCP_ARGUMENT_INVALID: ${name} must be a non-empty string`);
  return value.trim();
}

function isMcpRequest(value: unknown): value is McpRequest {
  return isRecord(value)
    && value.jsonrpc === "2.0"
    && typeof value.method === "string"
    && value.method.length > 0
    && (value.id === undefined || value.id === null || typeof value.id === "string" || typeof value.id === "number");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
