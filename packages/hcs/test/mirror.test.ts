import assert from "node:assert/strict";
import test from "node:test";
import { normalizeMirrorNodeBaseUrl, readTopicRecords } from "../src/index.ts";

test("normalizes Mirror Node root and versioned URLs", () => {
  assert.equal(normalizeMirrorNodeBaseUrl("https://mirror.invalid"), "https://mirror.invalid/api/v1");
  assert.equal(normalizeMirrorNodeBaseUrl("https://mirror.invalid/api/v1/"), "https://mirror.invalid/api/v1");
});

test("reads topics without duplicating the Mirror Node API path", async () => {
  const result = await readTopicRecords("https://mirror.invalid/api/v1", "0.0.7", {
    fetchImpl: async (input) => {
      assert.equal(String(input), "https://mirror.invalid/api/v1/topics/0.0.7/messages");
      return new Response(JSON.stringify({ messages: [], links: { next: null } }), { status: 200 });
    }
  });
  assert.deepEqual(result, []);
});

test("rejects a topic page with malformed message metadata", async () => {
  await assert.rejects(
    () => readTopicRecords("https://mirror.invalid", "0.0.7", {
      fetchImpl: async () => new Response(JSON.stringify({
        messages: [{ consensus_timestamp: "1.000000000", sequence_number: 0, message: "e30=" }],
        links: { next: null }
      }), { status: 200 })
    }),
    /VERITY_MIRROR_SCHEMA/
  );
});

test("rejects invalid base64 before decoding a topic message", async () => {
  await assert.rejects(
    () => readTopicRecords("https://mirror.invalid", "0.0.7", {
      fetchImpl: async () => new Response(JSON.stringify({
        messages: [{ consensus_timestamp: "1.000000000", sequence_number: 1, message: "not-base64" }],
        links: { next: null }
      }), { status: 200 })
    }),
    /VERITY_MIRROR_SCHEMA/
  );
});
