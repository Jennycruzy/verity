import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { adjudicate } from "../src/adjudication.ts";
import { requireDisputeEligibility } from "../src/dispute.ts";
import { FileRootStore, hashWorldSignal, MemoryRootStore, normalizeWorldRoot, WorldIdVerifier } from "../src/identity.ts";

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

test("hashWorldSignal matches the World ID reference vector", () => {
  assert.equal(
    hashWorldSignal("test_signal"),
    "0x00c1636e0a961a3045054c4d61374422c31a95846b8442f0927ad2ff1d6112ed"
  );
});

test("normalizes equivalent hexadecimal roots to one durable key", () => {
  assert.equal(normalizeWorldRoot("0x000A"), "10");
  assert.equal(normalizeWorldRoot("0x0a"), "10");
  assert.throws(() => normalizeWorldRoot("0x0"), /VERITY_WORLD_ID_ROOT_INVALID/);
});

test("World ID verifier stores a durable root and rejects proof reuse", async () => {
  const roots = new MemoryRootStore();
  const verifier = new WorldIdVerifier(
    { verifyUrl: "https://world.invalid/verify", action: "register-provider" },
    roots,
    async () => new Response(JSON.stringify({ success: true, action: "register-provider", nullifier: "root-1" }), { status: 200 })
  );
  const proof = { proof: "opaque", signal_hash: hashWorldSignal("provider-account") };
  const verified = await verifier.verify(proof, "provider-account");
  assert.equal(verified.root, "root-1");
  await assert.rejects(verifier.verify(proof, "provider-account"), /VERITY_WORLD_ID_REPLAY/);
});

test("World ID verifier rejects a proof verified for another action", async () => {
  const verifier = new WorldIdVerifier(
    { verifyUrl: "https://world.invalid/verify", action: "register-provider" },
    new MemoryRootStore(),
    async () => new Response(JSON.stringify({ success: true, action: "dispute", nullifier: "root-1" }), { status: 200 })
  );
  await assert.rejects(
    verifier.verify({ proof: "opaque", signal_hash: hashWorldSignal("provider-account") }, "provider-account"),
    /VERITY_WORLD_ID_ACTION_MISMATCH/
  );
});

test("World ID verifier rejects a proof bound to another signal", async () => {
  const verifier = new WorldIdVerifier(
    { verifyUrl: "https://world.invalid/verify", action: "register-provider" },
    new MemoryRootStore(),
    async () => new Response(JSON.stringify({ success: true, action: "register-provider", nullifier: "root-1" }), { status: 200 })
  );
  await assert.rejects(
    verifier.verify({ proof: "opaque", signal_hash: hashWorldSignal("other-signal") }, "provider-account"),
    /VERITY_WORLD_ID_SIGNAL_MISMATCH/
  );
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
