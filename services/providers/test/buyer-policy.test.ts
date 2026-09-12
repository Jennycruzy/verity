import assert from "node:assert/strict";
import test from "node:test";
import { BuyerAdmissionError, BuyerReputationPolicy } from "../src/buyer-policy.ts";
import { VERITY_HUMAN_ROOT_HEADER, VERITY_WORLD_PROOF_HEADER, VERITY_WORLD_SIGNAL_HEADER } from "@verity/types";

test("requires a World proof and human root before provider delivery", async () => {
  const policy = new BuyerReputationPolicy(
    { verify: async () => ({ root: "42", action: "verity-dispute", verifiedAt: "now", provider: "world-id" }) },
    { buyer: async (root) => ({ root, honestyScore: 1, disputes: 0 }) },
    0.8
  );
  await assert.rejects(
    policy.assertEligible({ headers: {} } as never),
    (error: unknown) => error instanceof BuyerAdmissionError && /VERITY_BUYER_HUMAN_ROOT_REQUIRED/.test(error.message)
  );
});

test("binds provider admission to the proof's nullifier root", async () => {
  const policy = new BuyerReputationPolicy(
    { verify: async () => ({ root: "42", action: "verity-dispute", verifiedAt: "now", provider: "world-id" }) },
    { buyer: async (root) => ({ root, honestyScore: 1, disputes: 0 }) },
    0.8
  );
  await assert.rejects(
    policy.assertEligible(request("41")),
    /VERITY_BUYER_ROOT_MISMATCH/
  );
});

test("refuses a buyer whose queried honesty is below policy", async () => {
  const queried: string[] = [];
  const policy = new BuyerReputationPolicy(
    { verify: async () => ({ root: "42", action: "verity-dispute", verifiedAt: "now", provider: "world-id" }) },
    {
      buyer: async (root) => {
        queried.push(root);
        return { root, honestyScore: 0.4, disputes: 2 };
      }
    },
    0.8
  );
  await assert.rejects(policy.assertEligible(request("42")), /VERITY_BUYER_REPUTATION_REJECTED/);
  assert.deepEqual(queried, ["42"]);
});

function request(root: string) {
  return {
    headers: {
      [VERITY_HUMAN_ROOT_HEADER]: root,
      [VERITY_WORLD_SIGNAL_HEADER]: "request-1",
      [VERITY_WORLD_PROOF_HEADER]: Buffer.from(JSON.stringify({ responses: [] }), "utf8").toString("base64url")
    }
  } as never;
}
