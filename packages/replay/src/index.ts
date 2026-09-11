import { readTopicRecords } from "@verity/hcs";
import { evaluateEntity, evaluateFxRate, type DisputeRecord, type RuleId } from "@verity/types";

export interface ReplayConfig {
  readonly mirrorNodeBaseUrl: string;
  readonly disputeTopicId: string;
  readonly contentStoreBaseUrl: string;
}

export interface ReplayResult {
  readonly disputeId: string;
  readonly recordedVerdict: string;
  readonly replayedVerdict: string;
  readonly matches: boolean;
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
  const replayed = evaluateInput(dispute.ruleId, input);
  const recordedVerdict = dispute.verdict;
  return {
    disputeId,
    recordedVerdict,
    replayedVerdict: replayed.verdict,
    matches: recordedVerdict === replayed.verdict
  };
}

async function fetchContent(reference: DisputeRecord["evaluationInput"], baseUrl: string, fetchImpl: FetchLike): Promise<unknown> {
  const uri = reference.uri ?? `${baseUrl.replace(/\/$/, "")}/${encodeURIComponent(reference.sha256)}`;
  const response = await fetchImpl(uri);
  const raw = await response.text();
  if (!response.ok) throw new Error(`VERITY_CONTENT_HTTP_${response.status}: ${raw}`);
  if (reference.mediaType.includes("json")) {
    try {
      return JSON.parse(raw);
    } catch (error) {
      throw new Error(`VERITY_CONTENT_JSON: ${uri} was not valid JSON`, { cause: error });
    }
  }
  return raw;
}

function evaluateInput(ruleId: RuleId, input: unknown) {
  if (!input || typeof input !== "object") {
    throw new Error("VERITY_REPLAY_INPUT: evaluation input must be a JSON object");
  }
  const value = input as Record<string, unknown>;
  if (ruleId === "fx-rate-v1") {
    if (typeof value.expectedRate !== "string" || typeof value.actualRate !== "string" || typeof value.toleranceBps !== "number") {
      throw new Error("VERITY_REPLAY_INPUT: fx-rate-v1 requires expectedRate, actualRate, and toleranceBps");
    }
    return evaluateFxRate({ expectedRate: value.expectedRate, actualRate: value.actualRate, toleranceBps: value.toleranceBps });
  }
  if (ruleId === "entity-canonical-v1") {
    if (typeof value.expected !== "string" || typeof value.actual !== "string") {
      throw new Error("VERITY_REPLAY_INPUT: entity-canonical-v1 requires expected and actual");
    }
    return evaluateEntity({ expected: value.expected, actual: value.actual });
  }
  throw new Error(`VERITY_RULE_UNKNOWN: ${ruleId}`);
}

function parseDisputeRecord(value: Record<string, unknown>, disputeId: string): DisputeRecord {
  const candidate = value as Partial<DisputeRecord>;
  if (candidate.disputeId !== disputeId || typeof candidate.ruleId !== "string" || typeof candidate.verdict !== "string" || !candidate.evaluationInput) {
    throw new Error(`VERITY_REPLAY_SCHEMA: dispute ${disputeId} did not contain the replay inputs`);
  }
  return candidate as DisputeRecord;
}
