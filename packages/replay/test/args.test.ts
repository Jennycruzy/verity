import assert from "node:assert/strict";
import test from "node:test";
import { readReplayDisputeId } from "../src/args.ts";

test("reads the documented replay command", () => {
  assert.equal(readReplayDisputeId(["replay", "dispute-1"]), "dispute-1");
});

test("rejects incomplete and ambiguous commands", () => {
  assert.throws(() => readReplayDisputeId([]), /Usage: verity replay/);
  assert.throws(() => readReplayDisputeId(["dispute-1"]), /Usage: verity replay/);
  assert.throws(() => readReplayDisputeId(["replay", "one", "two"]), /Usage: verity replay/);
});
