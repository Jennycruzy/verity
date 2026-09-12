import type { CrossCheckerVerdict, DeterministicVerdict, RuleId, Verdict } from "@verity/types";

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
  readonly votes: readonly CrossCheckerVerdict[];
}

export async function adjudicate(input: CrossCheckInput, checkers: readonly CrossChecker[]): Promise<AdjudicationResult> {
  if (checkers.length < 3 || checkers.length % 2 === 0) {
    throw new Error("VERITY_CHECKER_QUORUM: provide an odd number of at least three cross-checkers");
  }
  if (checkers.some((checker) => !checker.id.trim())) {
    throw new Error("VERITY_CHECKER_IDS: every checker needs a non-empty ID");
  }
  const checkerIds = new Set(checkers.map((checker) => checker.id));
  if (checkerIds.size !== checkers.length) throw new Error("VERITY_CHECKER_IDS: checker IDs must be unique");
  const votes = await Promise.all(checkers.map(async (checker) => {
    const verdict = await checker.check(input);
    if (!isDeterministicVerdict(verdict)) {
      throw new Error(`VERITY_CHECKER_SCHEMA: ${checker.id} returned an invalid verdict`);
    }
    if (verdict.ruleId !== input.ruleId) {
      throw new Error(`VERITY_CHECKER_RULE_MISMATCH: ${checker.id} returned ${verdict.ruleId}`);
    }
    return { checkerId: checker.id, ruleId: verdict.ruleId, verdict: verdict.verdict, reasonCode: verdict.reasonCode };
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

function isDeterministicVerdict(value: unknown): value is DeterministicVerdict {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<DeterministicVerdict>;
  return (candidate.verdict === "accept" || candidate.verdict === "reject")
    && typeof candidate.ruleId === "string"
    && typeof candidate.reasonCode === "string"
    && candidate.reasonCode.trim().length > 0
    && Boolean(candidate.evidence && typeof candidate.evidence === "object" && !Array.isArray(candidate.evidence));
}
