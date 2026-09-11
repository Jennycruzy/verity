import assert from "node:assert/strict";
import test from "node:test";
import { transition } from "../src/state.ts";

test("acceptance moves a held payment to settled", () => {
  assert.equal(transition("held", "accepted"), "settled");
});

test("a held payment can enter adjudication", () => {
  assert.equal(transition("held", "adjudication_started"), "adjudicating");
});

test("an upheld rejection voids the held payment", () => {
  assert.equal(transition("adjudicating", "adjudication_upheld"), "void");
  assert.equal(transition("adjudicating", "adjudication_overturned"), "settled");
});

test("terminal states reject further transitions", () => {
  assert.throws(() => transition("settled", "accepted"), /VERITY_INVALID_TRANSITION/);
});
