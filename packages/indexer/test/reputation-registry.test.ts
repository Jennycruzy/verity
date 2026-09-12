import assert from "node:assert/strict";
import test from "node:test";
import { createVerityProviderFeedback, VERITY_PROVIDER_FEEDBACK_TAG } from "../src/reputation-registry.ts";

test("encodes a bounded Agent0 provider feedback value", () => {
  assert.deepEqual(createVerityProviderFeedback({
    agentId: "0007",
    providerWasCorrect: true,
    endpoint: "https://provider.example/fx"
  }), {
    agentId: "7",
    value: "100",
    valueDecimals: 2,
    tag1: VERITY_PROVIDER_FEEDBACK_TAG,
    tag2: "correct",
    endpoint: "https://provider.example/fx",
    feedbackURI: "",
    feedbackHash: `0x${"0".repeat(64)}`
  });
});

test("rejects feedback evidence that cannot be replayed", () => {
  assert.throws(() => createVerityProviderFeedback({
    agentId: "7",
    providerWasCorrect: false,
    endpoint: "https://provider.example/fx",
    feedbackHash: `0x${"1".repeat(64)}`
  }), /HASH_WITHOUT_URI/);
  assert.throws(() => createVerityProviderFeedback({
    agentId: "7",
    providerWasCorrect: false,
    endpoint: "file:///provider/fx"
  }), /ENDPOINT_INVALID/);
});

test("accepts an integrity-bound feedback URI", () => {
  const feedback = createVerityProviderFeedback({
    agentId: "7",
    providerWasCorrect: false,
    endpoint: "https://provider.example/fx",
    feedbackURI: "ipfs://bafyverity",
    feedbackHash: `0x${"a".repeat(64)}`
  });
  assert.equal(feedback.value, "0");
  assert.equal(feedback.tag2, "incorrect");
  assert.equal(feedback.feedbackURI, "ipfs://bafyverity");
});
