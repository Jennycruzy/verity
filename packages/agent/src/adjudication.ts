import type { DeterministicVerdict, RuleId, Verdict } from "@verity/types";

export interface CrossCheckInput {
  readonly ruleId: RuleId;
  readonly value: unknown;
}

export interface CrossChecker {
  readonly id: string;
  check(input: CrossCheckInput): Promise<DeterministicVerdict>;
}

export interface AdjudicationResult {
  readonly ruleId: RuleId;
  readonly verdict: Verdict;
  readonly votes: readonly { checkerId: string; verdict: Verdict; reasonCode: string }[];
}

export async function adjudicate(input: CrossCheckInput, checkers: readonly CrossChecker[]): Promise<AdjudicationResult> {
  if (checkers.length < 3 || checkers.length % 2 === 0) {
    throw new Error("VERITY_CHECKER_QUORUM: provide an odd number of at least three cross-checkers");
  }
  const votes = await Promise.all(checkers.map(async (checker) => {
    const verdict = await checker.check(input);
    if (verdict.ruleId !== input.ruleId) {
      throw new Error(`VERITY_CHECKER_RULE_MISMATCH: ${checker.id} returned ${verdict.ruleId}`);
    }
    return { checkerId: checker.id, verdict: verdict.verdict, reasonCode: verdict.reasonCode };
  }));
  const accepted = votes.filter((vote) => vote.verdict === "accept").length;
  const rejected = votes.length - accepted;
  if (accepted === rejected) {
    throw new Error("VERITY_CHECKER_TIE: majority rule cannot resolve a tie");
  }
  return {
    ruleId: input.ruleId,
    verdict: accepted > rejected ? "accept" : "reject",
    votes
  };
}
