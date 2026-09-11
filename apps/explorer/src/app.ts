import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { ReputationClient } from "@verity/indexer";

export function createExplorerServer(client: ReputationClient) {
  const handler = createExplorerHandler(client);
  return createServer(handler);
}

export function createExplorerHandler(client: ReputationClient) {
  return async (request: Pick<IncomingMessage, "url">, response: ServerResponse) => {
    const path = request.url?.split("?", 1)[0] ?? "/";
    if (path === "/" || path === "/index.html") {
      writeHtml(response, 200, explorerPage);
      return;
    }
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

function writeHtml(response: ServerResponse, statusCode: number, value: string): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", "text/html; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.end(value);
}

const explorerPage = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Verity reputation explorer</title>
    <style>
      :root { color-scheme: dark; font-family: ui-sans-serif, system-ui, sans-serif; background: #0b1020; color: #edf2ff; }
      body { margin: 0; min-height: 100vh; background: radial-gradient(circle at top right, #263b7a, transparent 42%), #0b1020; }
      main { width: min(960px, calc(100% - 32px)); margin: 0 auto; padding: 64px 0; }
      h1 { margin: 0 0 12px; font-size: clamp(2rem, 6vw, 4rem); letter-spacing: -0.05em; }
      p { color: #aab7d8; line-height: 1.6; max-width: 680px; }
      .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; margin-top: 36px; }
      section { padding: 22px; border: 1px solid #35436f; border-radius: 16px; background: #111a32cc; box-shadow: 0 18px 60px #05081466; }
      label { display: block; margin-bottom: 8px; color: #aab7d8; font-size: 0.85rem; }
      input { box-sizing: border-box; width: 100%; padding: 12px; border: 1px solid #455684; border-radius: 8px; background: #0b1020; color: #edf2ff; }
      button { margin-top: 12px; padding: 11px 16px; border: 0; border-radius: 8px; background: #8ee6c1; color: #08131a; font-weight: 700; cursor: pointer; }
      pre { min-height: 72px; overflow: auto; white-space: pre-wrap; color: #c9d5f5; }
      .status { margin-top: 28px; color: #8ee6c1; }
      code { color: #8ee6c1; }
    </style>
  </head>
  <body>
    <main>
      <h1>Verity reputation</h1>
      <p>Read the reliability and honesty records that agents use to route objectively verifiable x402 work. Results come from the configured Graph index; this page stores nothing locally.</p>
      <div class="grid">
        <section>
          <h2>Provider reliability</h2>
          <label for="agent">ERC-8004 agent ID</label>
          <input id="agent" autocomplete="off" placeholder="eip155:296:registry:7">
          <button data-kind="provider">Look up provider</button>
          <pre id="provider" aria-live="polite"></pre>
        </section>
        <section>
          <h2>Buyer honesty</h2>
          <label for="root">Human root</label>
          <input id="root" autocomplete="off" placeholder="nullifier root">
          <button data-kind="buyer">Look up buyer</button>
          <pre id="buyer" aria-live="polite"></pre>
        </section>
      </div>
      <div class="status">Source: <code>GraphReputationClient</code> · <a href="/health" style="color:#8ee6c1">health</a></div>
    </main>
    <script>
      for (const button of document.querySelectorAll('button[data-kind]')) {
        button.addEventListener('click', async () => {
          const kind = button.dataset.kind;
          const input = document.getElementById(kind === 'provider' ? 'agent' : 'root');
          const output = document.getElementById(kind);
          const value = input.value.trim();
          if (!value) { output.textContent = 'Enter a lookup key.'; return; }
          output.textContent = 'Loading…';
          try {
            const response = await fetch('/' + kind + '?' + (kind === 'provider' ? 'agentId=' : 'root=') + encodeURIComponent(value));
            const body = await response.json();
            if (!response.ok) throw new Error(body.error || 'lookup failed');
            output.textContent = JSON.stringify(body, null, 2);
          } catch (error) {
            output.textContent = error instanceof Error ? error.message : String(error);
          }
        });
      }
    </script>
  </body>
</html>`;
