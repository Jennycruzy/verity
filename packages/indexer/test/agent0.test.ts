import assert from "node:assert/strict";
import test from "node:test";
import { normalizeAgent0Id, parseAgent0Buyer, parseAgent0Provider } from "../src/agent0.ts";
import { VERITY_BUYER_FEEDBACK_TAG, VERITY_PROVIDER_FEEDBACK_TAG } from "../src/reputation-registry.ts";

test("normalizes an Agent0 chain and agent identity", () => {
  assert.equal(normalizeAgent0Id("296:0007"), "296:7");
  assert.equal(normalizeAgent0Id("eip155:296:0x8004A818BFB912233c491871b3d84c89A494BD9e:7"), "296:7");
});

test("derives reliability only from non-revoked Verity feedback", () => {
  const result = parseAgent0Provider({
    agent: {
      id: "296:7",
      registrationFile: { webEndpoint: "https://provider.example/fx" },
      feedback: [
        { value: "1", tag1: VERITY_PROVIDER_FEEDBACK_TAG, isRevoked: false },
        { value: "0.5", tag1: VERITY_PROVIDER_FEEDBACK_TAG, isRevoked: false },
        { value: "0", tag1: VERITY_PROVIDER_FEEDBACK_TAG, isRevoked: true },
        { value: "0", tag1: "unrelated", isRevoked: false }
      ]
    }
  }, "296:7");
  assert.deepEqual(result, {
    agentId: "296:7",
    endpoint: "https://provider.example/fx",
    reliabilityScore: 0.75,
    completedRequests: 2
  });
});

test("rejects an Agent0 provider with malformed score evidence", () => {
  assert.throws(() => parseAgent0Provider({
    id: "296:7",
    feedback: [{ value: "1.01", tag1: VERITY_PROVIDER_FEEDBACK_TAG, isRevoked: false, endpoint: "https://provider.example/fx" }]
  }, "296:7"), /values must be between 0 and 1/);
});

test("requires an endpoint in the standard Agent0 response", () => {
  assert.throws(() => parseAgent0Provider({ id: "296:7", feedback: [] }, "296:7"), /no HTTP endpoint/);
});

test("derives buyer honesty from the standard Agent0 response", () => {
  const result = parseAgent0Buyer({
    agent: {
      id: "84532:9",
      feedback: [
        { value: "1", tag1: VERITY_BUYER_FEEDBACK_TAG, isRevoked: false },
        { value: "0", tag1: VERITY_BUYER_FEEDBACK_TAG, isRevoked: false },
        { value: "0", tag1: VERITY_PROVIDER_FEEDBACK_TAG, isRevoked: false },
        { value: "0", tag1: VERITY_BUYER_FEEDBACK_TAG, isRevoked: true }
      ]
    }
  }, "eip155:84532:0x8004A818BFB912233c491871b3d84c89A494BD9e:9");
  assert.deepEqual(result, { root: "eip155:84532:0x8004A818BFB912233c491871b3d84c89A494BD9e:9", honestyScore: 0.5, disputes: 2 });
});

test("rejects a standard Agent0 buyer with an invalid score", () => {
  assert.throws(() => parseAgent0Buyer({ id: "84532:9", feedback: [{ value: "1.1", tag1: VERITY_BUYER_FEEDBACK_TAG, isRevoked: false }] }, "84532:9"), /values must be between 0 and 1/);
});
