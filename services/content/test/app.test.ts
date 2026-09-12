import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { sha256 } from "@verity/types";
import { handleContentRequest } from "../src/app.ts";

test("stores and serves content by its hash", async () => {
  const directory = await mkdtemp(join(tmpdir(), "verity-content-"));
  const config = { port: 1, directory, publicUrl: "http://content.invalid", maxBytes: 1024 };
  const body = '{"ok":true}';
  const hash = sha256(body);
  try {
    const put = responseForTest();
    await handleContentRequest(requestForTest("PUT", `/content/${hash}`, body), put.response, config);
    assert.equal(put.response.statusCode, 201);
    assert.deepEqual(JSON.parse(put.body()), { sha256: hash, mediaType: "application/json", byteLength: Buffer.byteLength(body), uri: `http://content.invalid/content/${hash}` });
    const get = responseForTest();
    await handleContentRequest(requestForTest("GET", `/content/${hash}`), get.response, config);
    assert.equal(get.response.statusCode, 200);
    assert.equal(get.body(), body);
    assert.equal((await readFile(join(directory, hash))).toString(), body);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects uploads whose path hash does not match the bytes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "verity-content-"));
  const config = { port: 1, directory, publicUrl: "http://content.invalid", maxBytes: 1024 };
  try {
    const response = responseForTest();
    await handleContentRequest(requestForTest("PUT", `/content/${"ab".repeat(32)}`, "{\"ok\":true}"), response.response, config);
    assert.equal(response.response.statusCode, 422);
    assert.match(response.body(), /content_hash_mismatch/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("requires the configured bearer token for public writes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "verity-content-"));
  const body = '{"secured":true}';
  const hash = sha256(body);
  const config = { port: 1, directory, publicUrl: "http://content.invalid", maxBytes: 1024, writeToken: "write-secret" };
  try {
    const unauthorized = responseForTest();
    await handleContentRequest(requestForTest("PUT", `/content/${hash}`, body), unauthorized.response, config);
    assert.equal(unauthorized.response.statusCode, 401);

    const authorized = responseForTest();
    await handleContentRequest(requestForTest("PUT", `/content/${hash}`, body, { authorization: "Bearer write-secret" }), authorized.response, config);
    assert.equal(authorized.response.statusCode, 201);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

function requestForTest(method: string, url: string, body = "", extraHeaders: Record<string, string> = {}) {
  const request = Readable.from(body ? [Buffer.from(body)] : []) as Readable & { method: string; url: string; headers: Record<string, string> };
  request.method = method;
  request.url = url;
  request.headers = method === "PUT" ? { "content-type": "application/json", ...extraHeaders } : extraHeaders;
  return request as never;
}

function responseForTest() {
  const chunks: Buffer[] = [];
  const response = {
    statusCode: 0,
    writableEnded: false,
    setHeader(_name: string, _value: string) {},
    end(value?: string | Uint8Array) {
      if (value !== undefined) chunks.push(Buffer.from(value));
      this.writableEnded = true;
    }
  } as never;
  return { response, body: () => Buffer.concat(chunks).toString("utf8") };
}
