import assert from "node:assert/strict";
import test from "node:test";
import { HttpCrossChecker } from "../src/crosschecker.ts";

test("requires an absolute HTTP(S) checker URL", () => {
  assert.throws(() => new HttpCrossChecker("checker-a", "file:///checker"), /VERITY_CHECKER_URL_INVALID/);
  assert.throws(() => new HttpCrossChecker("checker-a", "checker"), /VERITY_CHECKER_URL_INVALID/);
});

test("returns a structured checker verdict", async () => {
  const checker = new HttpCrossChecker(" checker-a ", "https://checker.invalid/check", 1000, async (input, init) => {
    assert.equal(String(input), "https://checker.invalid/check");
    assert.equal(init?.method, "POST");
    return new Response(JSON.stringify({ verdict: "accept", ruleId: "fx-rate-v1", reasonCode: "RATE_WITHIN_TOLERANCE", evidence: {} }), { status: 200 });
  });
  const result = await checker.check({ ruleId: "fx-rate-v1", value: { expectedRate: "1", actualRate: "1", toleranceBps: 0 } });
  assert.equal(checker.id, "checker-a");
  assert.equal(result.verdict, "accept");
});
