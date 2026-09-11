import assert from "node:assert/strict";
import test from "node:test";
import { encodeHcsRecord, HCS_SCHEMA } from "@verity/hcs";
import { replayDispute } from "../src/index.ts";
import { sha256, stableJson } from "@verity/types";

test("replays an FX dispute from Mirror Node and content storage", async () => {
  const input = { actualRate: "1.10", expectedRate: "1.00", toleranceBps: 100 };
  const inputSerialized = stableJson(input);
  const inputHash = sha256(inputSerialized);
  const buyerResponse = JSON.stringify({ rate: "1.10" });
  const buyerResponseHash = sha256(buyerResponse);
  const providerResponses = [JSON.stringify({ rate: "1.10" }), JSON.stringify({ rate: "1.10" }), JSON.stringify({ rate: "1.00" })];
  const providerResponseHashes = providerResponses.map(sha256);
  const record = {
    schema: HCS_SCHEMA,
    kind: "dispute" as const,
    id: "dispute-1",
    recordedAt: "2026-09-11T00:00:00.000Z",
    payload: {
      disputeId: "dispute-1",
      ruleId: "fx-rate-v1" as const,
      verdict: "reject" as const,
      evaluationInput: { sha256: inputHash },
      buyerResponse: { sha256: buyerResponseHash },
      providerResponses: providerResponseHashes.map((sha256) => ({ sha256 })),
      crossCheckerVerdicts: [
        { checkerId: "checker-a", verdict: "reject" as const },
        { checkerId: "checker-b", verdict: "reject" as const },
        { checkerId: "checker-c", verdict: "accept" as const }
      ]
    }
  };
  const encoded = Buffer.from(encodeHcsRecord(record)).toString("base64");
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    if (url === "https://mirror.invalid/api/v1/topics/0.0.7/messages") {
      return new Response(JSON.stringify({ messages: [{ consensus_timestamp: "1", sequence_number: 1, message: encoded }], links: { next: null } }), { status: 200 });
    }
    if (url === `https://content.invalid/content/${inputHash}`) return new Response(inputSerialized, { status: 200, headers: { "content-type": "application/json" } });
    if (url === `https://content.invalid/content/${buyerResponseHash}`) return new Response(buyerResponse, { status: 200, headers: { "content-type": "application/json" } });
    const providerIndex = providerResponseHashes.findIndex((hash) => url === `https://content.invalid/content/${hash}`);
    if (providerIndex >= 0) return new Response(providerResponses[providerIndex], { status: 200, headers: { "content-type": "application/json" } });
    throw new Error(`unexpected URL ${url}`);
  };
  const result = await replayDispute("dispute-1", { mirrorNodeBaseUrl: "https://mirror.invalid", disputeTopicId: "0.0.7", contentStoreBaseUrl: "https://content.invalid" }, { fetchImpl });
  assert.deepEqual(result, {
    disputeId: "dispute-1",
    ruleId: "fx-rate-v1",
    recordedVerdict: "reject",
    replayedVerdict: "reject",
    buyerVerdict: "reject",
    providerVotes: [
      { checkerId: "checker-a", verdict: "reject", reasonCode: "RATE_OUTSIDE_TOLERANCE" },
      { checkerId: "checker-b", verdict: "reject", reasonCode: "RATE_OUTSIDE_TOLERANCE" },
      { checkerId: "checker-c", verdict: "accept", reasonCode: "RATE_WITHIN_TOLERANCE" }
    ],
    recordedVotesMatch: true,
    matches: true
  });
});
