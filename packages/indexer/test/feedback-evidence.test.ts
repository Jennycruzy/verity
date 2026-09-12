import assert from "node:assert/strict";
import test from "node:test";
import { keccak256, toUtf8Bytes } from "ethers";
import { createVerityFeedbackEvidence } from "../src/feedback-evidence.ts";

const input = {
  disputeId: "dispute-1",
  disputeTopicId: "0.0.7",
  recordedAt: "2026-09-13T12:00:00.000Z",
  ruleId: "fx-rate-v1" as const,
  verdict: "reject" as const,
  subject: "provider" as const,
  agentRegistry: "eip155:84532:0x8004A818BFB912233c491871b3d84c89A494BD9e",
  agentId: "7",
  outcome: false,
  humanRoot: "123456789"
};

test("binds the provider human root into the replayable Agent0 evidence", () => {
  const evidence = createVerityFeedbackEvidence(input);
  const encoded = evidence.feedbackURI.split(",", 2)[1]?.split("#", 1)[0];
  assert.ok(encoded);
  const document = Buffer.from(encoded, "base64").toString("utf8");
  assert.match(evidence.feedbackURI, /#verity-human-root=123456789$/);
  assert.match(document, /"humanRoot":"123456789"/);
  assert.equal(evidence.feedbackHash, keccak256(toUtf8Bytes(document)));
});

test("changes the signed evidence when the human root changes", () => {
  const first = createVerityFeedbackEvidence(input);
  const second = createVerityFeedbackEvidence({ ...input, humanRoot: "987654321" });
  assert.notEqual(first.feedbackHash, second.feedbackHash);
  assert.notEqual(first.feedbackURI, second.feedbackURI);
});

test("rejects a non-canonical or missing human root", () => {
  assert.throws(() => createVerityFeedbackEvidence({ ...input, humanRoot: "000123" }), /ROOT_INVALID/);
  assert.throws(() => createVerityFeedbackEvidence({ ...input, humanRoot: "0" }), /ROOT_INVALID/);
});
