import { readTopicRecords } from "@verity/hcs";
import { evaluateEntity, evaluateFxRate, RULE_IDS, sha256, type ContentHashReference, type DisputeRecord, type RuleId, type Verdict } from "@verity/types";

export interface ReplayConfig {
  readonly mirrorNodeBaseUrl: string;
  readonly disputeTopicId: string;
  readonly contentStoreBaseUrl: string;
}

export interface ReplayResult {
  readonly disputeId: string;
  readonly ruleId: RuleId;
  readonly recordedVerdict: Verdict;
  readonly replayedVerdict: Verdict;
  readonly buyerVerdict: Verdict;
  readonly providerVotes: readonly ReplayVote[];
  readonly recordedVotesMatch: boolean;
  readonly matches: boolean;
}

export interface ReplayVote {
  readonly checkerId: string;
  readonly verdict: Verdict;
  readonly reasonCode: string;
}

type FetchLike = typeof fetch;

export async function replayDispute(disputeId: string, config: ReplayConfig, options: { fetchImpl?: FetchLike } = {}): Promise<ReplayResult> {
  if (!disputeId) throw new Error("VERITY_REPLAY_ID_MISSING: provide a dispute ID");
  const fetchImpl = options.fetchImpl ?? fetch;
  const records = await readTopicRecords(config.mirrorNodeBaseUrl, config.disputeTopicId, { fetchImpl });
  const record = records.find((candidate) => candidate.kind === "dispute" && candidate.id === disputeId);
  if (!record) {
    throw new Error(`VERITY_REPLAY_NOT_FOUND: no dispute ${disputeId} was found on topic ${config.disputeTopicId}`);
  }

  const dispute = parseDisputeRecord(record.payload, disputeId);
  const input = await fetchContent(dispute.evaluationInput, config.contentStoreBaseUrl, fetchImpl);
  const buyerResponse = await fetchContent(dispute.buyerResponse, config.contentStoreBaseUrl, fetchImpl);
  const providerResponses = await Promise.all(
    dispute.providerResponses.map((reference) => fetchContent(reference, config.contentStoreBaseUrl, fetchImpl))
  );
  const buyerVerdict = evaluateResponse(dispute.ruleId, input, buyerResponse);
  const providerVotes = providerResponses.map((response, index) => {
    const verdict = evaluateResponse(dispute.ruleId, input, response);
    const recordedVote = dispute.crossCheckerVerdicts[index];
    if (!recordedVote) throw new Error(`VERITY_REPLAY_SCHEMA: dispute ${disputeId} is missing checker vote ${index}`);
    return {
      checkerId: recordedVote.checkerId,
      verdict: verdict.verdict,
      reasonCode: verdict.reasonCode
    };
  });
  const replayed = majority(providerVotes.map((vote) => vote.verdict), dispute.ruleId);
  const recordedVotesMatch = providerVotes.every((vote, index) => {
    const recordedVote = dispute.crossCheckerVerdicts[index];
    return recordedVote?.checkerId === vote.checkerId && recordedVote.verdict === vote.verdict;
  });
  const recordedVerdict = dispute.verdict;
  return {
    disputeId,
    ruleId: dispute.ruleId,
    recordedVerdict,
    replayedVerdict: replayed.verdict,
    buyerVerdict: buyerVerdict.verdict,
    providerVotes,
    recordedVotesMatch,
    matches: recordedVerdict === replayed.verdict && recordedVotesMatch
  };
}

async function fetchContent(reference: ContentHashReference, baseUrl: string, fetchImpl: FetchLike): Promise<unknown> {
  const uri = `${baseUrl.replace(/\/$/, "")}/content/${encodeURIComponent(reference.sha256)}`;
  const response = await fetchImpl(uri);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!response.ok) throw new Error(`VERITY_CONTENT_HTTP_${response.status}: ${new TextDecoder().decode(bytes)}`);
  const actualHash = sha256(bytes);
  if (actualHash !== reference.sha256) throw new Error(`VERITY_CONTENT_HASH_MISMATCH: expected ${reference.sha256}, received ${actualHash}`);
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    throw new Error(`VERITY_CONTENT_JSON: ${uri} was not valid JSON`, { cause: error });
  }
}

function evaluateResponse(ruleId: RuleId, evaluationInput: unknown, response: unknown) {
  if (!isRecord(evaluationInput) || !isRecord(response)) {
    throw new Error(`VERITY_REPLAY_INPUT: ${ruleId} requires JSON object input and response`);
  }
  if (ruleId === RULE_IDS.fxRate) {
    return evaluateFxRate({
      expectedRate: requiredString(evaluationInput.expectedRate, "expectedRate"),
      actualRate: requiredString(response.rate ?? response.actualRate, "response.rate"),
      toleranceBps: requiredInteger(evaluationInput.toleranceBps, "toleranceBps")
    });
  }
  if (ruleId === RULE_IDS.entityCanonical) {
    return evaluateEntity({
      expected: requiredString(evaluationInput.expected, "expected"),
      actual: requiredString(response.entity ?? response.actual, "response.entity")
    });
  }
  throw new Error(`VERITY_RULE_UNKNOWN: ${ruleId}`);
}

function majority(votes: readonly Verdict[], ruleId: RuleId): { verdict: Verdict } {
  if (votes.length < 3 || votes.length % 2 === 0) {
    throw new Error(`VERITY_REPLAY_QUORUM: ${ruleId} dispute must contain an odd number of at least three provider responses`);
  }
  const accepted = votes.filter((vote) => vote === "accept").length;
  return { verdict: accepted > votes.length / 2 ? "accept" : "reject" };
}

function parseDisputeRecord(value: Record<string, unknown>, disputeId: string): DisputeRecord {
  const candidate = value as Partial<DisputeRecord>;
  if ((candidate.disputeId !== undefined && candidate.disputeId !== disputeId)
    || !isRuleId(candidate.ruleId)
    || (candidate.verdict !== "accept" && candidate.verdict !== "reject")
    || !isHashReference(candidate.evaluationInput)
    || !isHashReference(candidate.buyerResponse)
    || !Array.isArray(candidate.providerResponses)
    || !candidate.providerResponses.every(isHashReference)
    || !Array.isArray(candidate.crossCheckerVerdicts)
    || !candidate.crossCheckerVerdicts.every(isCheckerReceipt)
    || candidate.providerResponses.length !== candidate.crossCheckerVerdicts.length) {
    throw new Error(`VERITY_REPLAY_SCHEMA: dispute ${disputeId} did not contain the replay inputs`);
  }
  return { ...candidate, disputeId } as DisputeRecord;
}

function isHashReference(value: unknown): value is ContentHashReference {
  return isRecord(value) && typeof value.sha256 === "string" && /^[0-9a-f]{64}$/.test(value.sha256);
}

function isCheckerReceipt(value: unknown): value is { checkerId: string; verdict: Verdict } {
  return isRecord(value)
    && typeof value.checkerId === "string"
    && value.checkerId.trim().length > 0
    && (value.verdict === "accept" || value.verdict === "reject");
}

function isRuleId(value: unknown): value is RuleId {
  return value === RULE_IDS.fxRate || value === RULE_IDS.entityCanonical;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`VERITY_REPLAY_FIELD_INVALID: ${name} must be a non-empty string`);
  return value;
}

function requiredInteger(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new Error(`VERITY_REPLAY_FIELD_INVALID: ${name} must be an integer`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
