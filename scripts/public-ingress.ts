import "dotenv/config";
import { createServer, type IncomingMessage } from "node:http";

const routes = [
  { prefix: "/provider", target: "http://127.0.0.1:3101" },
  { prefix: "/content", target: "http://127.0.0.1:8090" },
  { prefix: "/disputes", target: "http://127.0.0.1:8091" },
  { prefix: "/reputation", target: "http://127.0.0.1:8092" }
] as const;

const host = process.env.PUBLIC_INGRESS_HOST?.trim() || "0.0.0.0";
const port = parsePort(process.env.PUBLIC_INGRESS_PORT, 8080);
const explorerTarget = process.env.PUBLIC_EXPLORER_TARGET?.trim() || "http://127.0.0.1:8787";

createServer(async (request, response) => {
  try {
    const incomingUrl = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    const route = routes.find(({ prefix }) => incomingUrl.pathname === prefix || incomingUrl.pathname.startsWith(`${prefix}/`));
    const target = route?.target || explorerTarget;
    const pathname = route ? incomingUrl.pathname.slice(route.prefix.length) || "/" : incomingUrl.pathname;
    const upstreamUrl = new URL(`${pathname}${incomingUrl.search}`, target);
    const body = request.method === "GET" || request.method === "HEAD" ? undefined : await readBody(request);
    const headers = new Headers();
    for (const [name, value] of Object.entries(request.headers)) {
      if (value !== undefined && name !== "host") headers.set(name, Array.isArray(value) ? value.join(", ") : value);
    }

    const upstream = await fetch(upstreamUrl, { method: request.method, headers, body });
    response.statusCode = upstream.status;
    upstream.headers.forEach((value, name) => {
      if (name !== "content-encoding" && name !== "content-length" && name !== "transfer-encoding") {
        response.setHeader(name, value);
      }
    });
    response.end(Buffer.from(await upstream.arrayBuffer()));
  } catch (error) {
    response.statusCode = 502;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({
      code: "VERITY_PUBLIC_UPSTREAM_FAILED",
      message: error instanceof Error ? error.message : String(error)
    }));
  }
}).listen(port, host, () => {
  console.log(JSON.stringify({ service: "verity-public-ingress", host, port }));
});

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function parsePort(value: string | undefined, fallback: number): number {
  if (!value?.trim()) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error("VERITY_PUBLIC_PORT_INVALID: PUBLIC_INGRESS_PORT must be an integer from 1 through 65535");
  }
  return parsed;
}
