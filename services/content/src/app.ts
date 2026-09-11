import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { sha256 } from "@verity/types";
import type { ContentServiceConfig } from "./config.js";

const HASH_PATTERN = /^[0-9a-f]{64}$/;

export function createContentServer(config: ContentServiceConfig) {
  return createServer((request, response) => {
    void handleContentRequest(request, response, config).catch((error: unknown) => {
      if (response.writableEnded) return;
      if (isBodyTooLargeError(error)) {
        writeJson(response, 413, { error: error.message });
        return;
      }
      writeJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
    });
  });
}

export async function handleContentRequest(request: IncomingMessage, response: ServerResponse, config: ContentServiceConfig): Promise<void> {
  const path = request.url?.split("?", 1)[0] ?? "/";
  if (request.method === "GET" && path === "/health") {
    writeJson(response, 200, { status: "ok", source: "content-store" });
    return;
  }

  const match = /^\/content\/([^/]+)$/.exec(path);
  if (!match || !match[1] || !HASH_PATTERN.test(match[1])) {
    writeJson(response, 404, { error: "not_found" });
    return;
  }
  const hash = match[1];
  const filePath = join(config.directory, hash);

  if (request.method === "GET") {
    await sendContent(response, filePath, hash);
    return;
  }
  if (request.method === "PUT") {
    await storeContent(request, response, config, filePath, hash);
    return;
  }
  response.setHeader("allow", "GET, PUT");
  writeJson(response, 405, { error: "method_not_allowed" });
}

async function sendContent(response: ServerResponse, filePath: string, hash: string): Promise<void> {
  let body: Buffer;
  try {
    body = await readFile(filePath);
  } catch (error) {
    if (isFileNotFound(error)) {
      writeJson(response, 404, { error: "content_not_found" });
      return;
    }
    throw error;
  }
  if (sha256(body) !== hash) throw new Error(`VERITY_CONTENT_CORRUPT: stored object ${hash} failed its hash check`);
  response.statusCode = 200;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "public, immutable");
  response.setHeader("etag", `"${hash}"`);
  response.end(body);
}

async function storeContent(
  request: IncomingMessage,
  response: ServerResponse,
  config: ContentServiceConfig,
  filePath: string,
  hash: string
): Promise<void> {
  const contentType = request.headers["content-type"] ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    writeJson(response, 415, { error: "application_json_required" });
    return;
  }
  const body = await readBody(request, config.maxBytes);
  const actualHash = sha256(body);
  if (actualHash !== hash) {
    writeJson(response, 422, { error: "content_hash_mismatch", expected: hash, received: actualHash });
    return;
  }
  await mkdir(config.directory, { recursive: true });
  let created = true;
  try {
    await writeFile(filePath, body, { flag: "wx" });
  } catch (error) {
    if (!isFileExists(error)) throw error;
    created = false;
    const existing = await readFile(filePath);
    if (!existing.equals(body)) throw new Error(`VERITY_CONTENT_CORRUPT: stored object ${hash} differs from the uploaded bytes`);
  }
  writeJson(response, created ? 201 : 200, {
    sha256: hash,
    mediaType: "application/json",
    byteLength: body.byteLength,
    uri: `${config.publicUrl}/content/${hash}`
  });
}

async function readBody(request: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += value.byteLength;
    if (total > maxBytes) throw new BodyTooLargeError(maxBytes);
    chunks.push(value);
  }
  return Buffer.concat(chunks, total);
}

function writeJson(response: ServerResponse, statusCode: number, value: unknown): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(value));
}

function isFileNotFound(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function isFileExists(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}

class BodyTooLargeError extends Error {
  public constructor(maxBytes: number) {
    super(`VERITY_CONTENT_TOO_LARGE: request exceeds ${maxBytes} bytes`);
    this.name = "BodyTooLargeError";
  }
}

export function isBodyTooLargeError(error: unknown): error is Error {
  return error instanceof BodyTooLargeError;
}
