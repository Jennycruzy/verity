import assert from "node:assert/strict";
import test from "node:test";
import { adjudicate } from "../src/adjudication.ts";
import { requireDisputeEligibility } from "../src/dispute.ts";
import { MemoryRootStore, WorldIdVerifier } from "../src/identity.ts";

test("majority adjudication is deterministic and rule-bound", async () => {
  const result = await adjudicate(
    { ruleId: "fx-rate-v1", value: {} },
    [
      { id: "a", check: async () => ({ verdict: "reject", ruleId: "fx-rate-v1", reasonCode: "bad", evidence: {} }) },
      { id: "b", check: async () => ({ verdict: "reject", ruleId: "fx-rate-v1", reasonCode: "bad", evidence: {} }) },
      { id: "c", check: async () => ({ verdict: "accept", ruleId: "fx-rate-v1", reasonCode: "ok", evidence: {} }) }
    ]
  );
  assert.equal(result.verdict, "reject");
});

test("disputes require both a verified root and a bond", () => {
  assert.throws(() => requireDisputeEligibility(undefined, "1"), /VERITY_IDENTITY_REQUIRED/);
  assert.throws(() => requireDisputeEligibility({ root: "root", action: "action", verifiedAt: "now", provider: "world-id" }, undefined), /VERITY_NO_BOND/);
});

test("World ID verifier stores a root before returning eligibility", async () => {
  const roots = new MemoryRootStore();
  const verifier = new WorldIdVerifier(
    { verifyUrl: "https://world.invalid/verify", action: "register-provider" },
    roots,
    async () => new Response(JSON.stringify({ success: true, nullifier: "root-1" }), { status: 200 })
  );
  const verified = await verifier.verify({ proof: "opaque" }, "provider-account");
  assert.equal(verified.root, "root-1");
  await assert.rejects(verifier.verify({ proof: "opaque" }, "provider-account"), /VERITY_WORLD_ID_REPLAY/);
});
