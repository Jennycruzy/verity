import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { adjudicate } from "../src/adjudication.ts";
import { requireDisputeEligibility } from "../src/dispute.ts";
import { FileRootStore, MemoryRootStore, WorldIdVerifier } from "../src/identity.ts";

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
    async () => new Response(JSON.stringify({ success: true, action: "register-provider", nullifier: "root-1" }), { status: 200 })
  );
  const verified = await verifier.verify({ proof: "opaque" }, "provider-account");
  assert.equal(verified.root, "root-1");
  await assert.rejects(verifier.verify({ proof: "opaque" }, "provider-account"), /VERITY_WORLD_ID_REPLAY/);
});

test("World ID verifier rejects a proof verified for another action", async () => {
  const verifier = new WorldIdVerifier(
    { verifyUrl: "https://world.invalid/verify", action: "register-provider" },
    new MemoryRootStore(),
    async () => new Response(JSON.stringify({ success: true, action: "dispute", nullifier: "root-1" }), { status: 200 })
  );
  await assert.rejects(verifier.verify({ proof: "opaque" }, "provider-account"), /VERITY_WORLD_ID_ACTION_MISMATCH/);
});

test("persists verified roots across FileRootStore instances", async () => {
  const directory = await mkdtemp(join(tmpdir(), "verity-roots-"));
  const path = join(directory, "roots.json");
  try {
    const first = new FileRootStore(path);
    await first.add("dispute", "root-1");
    const second = new FileRootStore(path);
    assert.equal(await second.has("dispute", "root-1"), true);
    await assert.rejects(second.add("dispute", "root-1"), /VERITY_WORLD_ID_REPLAY/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
