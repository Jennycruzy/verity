import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { ReputationClient } from "@verity/indexer";

export function createExplorerServer(client: ReputationClient) {
  const handler = createExplorerHandler(client);
  return createServer(handler);
}

export function createExplorerHandler(client: ReputationClient) {
  return async (request: Pick<IncomingMessage, "url">, response: ServerResponse) => {
    const path = request.url?.split("?", 1)[0] ?? "/";
    if (path === "/health") {
      writeJson(response, 200, { status: "ok", source: "graph" });
      return;
    }
    const query = new URLSearchParams(request.url?.split("?", 2)[1] ?? "");
    try {
      if (path === "/provider") {
        const agentId = query.get("agentId");
        if (!agentId) return writeJson(response, 400, { error: "agentId_required" });
        writeJson(response, 200, await client.provider(agentId));
        return;
      }
      if (path === "/buyer") {
        const root = query.get("root");
        if (!root) return writeJson(response, 400, { error: "root_required" });
        writeJson(response, 200, await client.buyer(root));
        return;
      }
      writeJson(response, 404, { error: "not_found" });
    } catch (error) {
      writeJson(response, 502, { error: error instanceof Error ? error.message : String(error) });
    }
  };
}

function writeJson(response: ServerResponse, statusCode: number, value: unknown): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(value));
}
