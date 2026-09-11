import assert from "node:assert/strict";
import test from "node:test";
import { HttpContentStore } from "../src/index.ts";
import { sha256, stableJson } from "@verity/types";

test("uploads canonical JSON and returns a verified content reference", async () => {
  const input = { b: 2, a: 1 };
  const body = stableJson(input);
  const hash = sha256(body);
  const store = new HttpContentStore("https://content.invalid", async (request, init) => {
    assert.equal(String(request), `https://content.invalid/content/${hash}`);
    assert.equal(init?.method, "PUT");
    assert.equal(init?.body, body);
    return new Response(JSON.stringify({ sha256: hash, mediaType: "application/json", byteLength: Buffer.byteLength(body), uri: String(request) }), { status: 201 });
  });
  assert.deepEqual(await store.putJson(input), { sha256: hash, mediaType: "application/json", byteLength: Buffer.byteLength(body), uri: `https://content.invalid/content/${hash}` });
});

test("verifies the hash and length before decoding content", async () => {
  const body = '{"ok":true}';
  const reference = { sha256: sha256(body), mediaType: "application/json", byteLength: Buffer.byteLength(body), uri: "https://content.invalid/content" };
  const store = new HttpContentStore("https://content.invalid", async () => new Response(body, { status: 200 }));
  assert.deepEqual(await store.readJson(reference), { ok: true });
  await assert.rejects(store.readJson({ ...reference, byteLength: reference.byteLength + 1 }), /VERITY_CONTENT_LENGTH_MISMATCH/);
});

test("rejects content whose bytes do not match the recorded hash", async () => {
  const reference = { sha256: sha256("expected"), mediaType: "application/json", byteLength: Buffer.byteLength("actual"), uri: "https://content.invalid/content" };
  const store = new HttpContentStore("https://content.invalid", async () => new Response("actual", { status: 200 }));
  await assert.rejects(store.readJson(reference), /VERITY_CONTENT_HASH_MISMATCH/);
});
