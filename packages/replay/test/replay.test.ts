import assert from "node:assert/strict";
import test from "node:test";
import { encodeHcsRecord, HCS_SCHEMA } from "@verity/hcs";
import { replayDispute } from "../src/index.ts";
import { sha256, stableJson } from "@verity/types";

test("replays an FX dispute from Mirror Node and content storage", async () => {
  const input = { actualRate: "1.10", expectedRate: "1.00", toleranceBps: 100 };
  const serialized = stableJson(input);
  const hash = sha256(serialized);
  const record = {
    schema: HCS_SCHEMA,
    kind: "dispute" as const,
    id: "dispute-1",
    recordedAt: "2026-09-11T00:00:00.000Z",
    payload: {
      disputeId: "dispute-1",
      ruleId: "fx-rate-v1" as const,
      verdict: "reject" as const,
      evaluationInput: { sha256: hash }
    }
  };
  const encoded = Buffer.from(encodeHcsRecord(record)).toString("base64");
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    if (url === "https://mirror.invalid/api/v1/topics/0.0.7/messages") {
      return new Response(JSON.stringify({ messages: [{ consensus_timestamp: "1", sequence_number: 1, message: encoded }], links: { next: null } }), { status: 200 });
    }
    if (url === `https://content.invalid/content/${hash}`) return new Response(serialized, { status: 200, headers: { "content-type": "application/json" } });
    throw new Error(`unexpected URL ${url}`);
  };
  const result = await replayDispute("dispute-1", { mirrorNodeBaseUrl: "https://mirror.invalid", disputeTopicId: "0.0.7", contentStoreBaseUrl: "https://content.invalid" }, { fetchImpl });
  assert.deepEqual(result, { disputeId: "dispute-1", recordedVerdict: "reject", replayedVerdict: "reject", matches: true });
});
