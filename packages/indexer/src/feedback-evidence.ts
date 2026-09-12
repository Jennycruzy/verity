import { keccak256, toUtf8Bytes } from "ethers";
import { stableJson, RULE_IDS, type RuleId, type Verdict } from "@verity/types";
import { normalizeErc8004AgentId, normalizeErc8004Registry } from "./erc8004.js";

export interface FeedbackEvidenceInput {
  readonly disputeId: string;
  readonly disputeTopicId: string;
  readonly recordedAt: string;
  readonly ruleId: RuleId;
  readonly verdict: Verdict;
  readonly subject: "provider" | "buyer";
  readonly agentRegistry: string;
  readonly agentId: string;
  readonly outcome: boolean;
  readonly humanRoot: string;
}

export interface FeedbackEvidence {
  readonly feedbackURI: string;
  readonly feedbackHash: string;
}

export function createVerityFeedbackEvidence(input: FeedbackEvidenceInput): FeedbackEvidence {
  const disputeId = requiredText(input.disputeId, "disputeId");
  const disputeTopicId = requiredTopicId(input.disputeTopicId);
  const recordedAt = requiredText(input.recordedAt, "recordedAt");
  if (input.ruleId !== RULE_IDS.fxRate && input.ruleId !== RULE_IDS.entityCanonical) {
    throw new Error(`VERITY_AGENT0_EVIDENCE_RULE_INVALID: ${input.ruleId}`);
  }
  if (input.verdict !== "accept" && input.verdict !== "reject") {
    throw new Error(`VERITY_AGENT0_EVIDENCE_VERDICT_INVALID: ${input.verdict}`);
  }
  if (input.subject !== "provider" && input.subject !== "buyer") {
    throw new Error(`VERITY_AGENT0_EVIDENCE_SUBJECT_INVALID: ${input.subject}`);
  }
  const agentRegistry = normalizeErc8004Registry(requiredText(input.agentRegistry, "agentRegistry"));
  const agentId = normalizeErc8004AgentId(requiredText(input.agentId, "agentId"));
  const humanRoot = canonicalHumanRoot(input.humanRoot);
  const document = stableJson({
    schema: "verity/agent0-feedback/v1",
    disputeId,
    disputeTopicId,
    recordedAt,
    ruleId: input.ruleId,
    verdict: input.verdict,
    subject: input.subject,
    agentRegistry,
    agentId,
    outcome: input.outcome,
    humanRoot
  });
  return {
    feedbackURI: `data:application/json;base64,${Buffer.from(document, "utf8").toString("base64")}#verity-human-root=${humanRoot}`,
    feedbackHash: keccak256(toUtf8Bytes(document))
  };
}

export function canonicalHumanRoot(value: string): string {
  const normalized = requiredText(value, "humanRoot");
  if (!/^\d+$/.test(normalized) || BigInt(normalized) === 0n || BigInt(normalized).toString(10) !== normalized) {
    throw new Error("VERITY_AGENT0_EVIDENCE_ROOT_INVALID: humanRoot must be a canonical positive decimal World nullifier");
  }
  return normalized;
}

function requiredTopicId(value: string): string {
  const normalized = requiredText(value, "disputeTopicId");
  if (!/^0\.0\.\d+$/.test(normalized)) throw new Error("VERITY_AGENT0_EVIDENCE_TOPIC_INVALID: disputeTopicId must use Hedera 0.0.N format");
  return normalized;
}

function requiredText(value: string, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`VERITY_AGENT0_EVIDENCE_${name.toUpperCase()}_MISSING: ${name} is required`);
  return value.trim();
}
