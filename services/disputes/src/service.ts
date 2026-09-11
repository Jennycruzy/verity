import { adjudicate, requireDisputeEligibility, type CrossChecker, type VerifiedRoot, type WorldIdProof } from "@verity/agent";
import type { ContentStore } from "@verity/content";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { sha256, stableJson, RULE_IDS, type ContentReference, type CrossCheckerVerdict, type DeterministicVerdict, type RuleId } from "@verity/types";
import type { DisputeResolutionRequest, SettlementOutcome, SettlementCoordinator } from "@verity/settlement";
import type { BondVerifier } from "./bond.js";
import { MemoryDisputeStore, type DisputeStore, type StoredDispute } from "./store.js";

export interface ProviderRecord {
  readonly providerRoot: string;
  readonly providerStakeAmount: string;
  readonly providerAddress: string;
}

export interface ProviderRegistry {
  get(providerId: string): Promise<ProviderRecord | undefined>;
}

export class MemoryProviderRegistry implements ProviderRegistry {
  public constructor(private readonly records: ReadonlyMap<string, ProviderRecord>) {}

  public async get(providerId: string): Promise<ProviderRecord | undefined> {
    return this.records.get(providerId);
  }
}

export interface DisputeIdentityVerifier {
  verify(proof: WorldIdProof, signal: string): Promise<VerifiedRoot>;
}

export interface DisputeSubmission {
  readonly disputeId: string;
  readonly requestId: string;
  readonly providerId: string;
  readonly buyerId: string;
  readonly ruleId: RuleId;
  readonly paymentPayload: PaymentPayload;
  readonly paymentRequirements: PaymentRequirements;
  readonly identityProof: WorldIdProof;
  readonly identitySignal: string;
  readonly buyerAddress: string;
  readonly buyerBondAmount: string;
  readonly bondTransactionId: string;
  readonly evaluationInput: ContentReference;
  readonly buyerResponse: ContentReference;
  readonly providerResponses: readonly ContentReference[];
}

export interface DisputeResult {
  readonly disputeId: string;
  readonly requestId: string;
  readonly buyerRoot: string;
  readonly providerRoot: string;
  readonly bondTransactionId: string;
  readonly verdict: DeterministicVerdict;
  readonly votes: readonly CrossCheckerVerdict[];
  readonly state: Extract<SettlementOutcome["state"], "settled" | "void">;
  readonly transactionId?: string;
  readonly hcsTransactionId: string;
  readonly recordedAt: string;
}

export interface DisputeSubmissionResult {
  readonly created: boolean;
  readonly result: DisputeResult;
}

export class IdempotencyConflictError extends Error {
  public constructor(disputeId: string) {
    super(`VERITY_DISPUTE_IDEMPOTENCY_CONFLICT: ${disputeId} already has a different request`);
    this.name = "IdempotencyConflictError";
  }
}

export class DisputeInputError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "DisputeInputError";
  }
}

export class DisputeProcessor {
  private readonly store: DisputeStore;

  public constructor(
    private readonly identity: DisputeIdentityVerifier,
    private readonly providers: ProviderRegistry,
    private readonly content: ContentStore,
    private readonly checkers: readonly CrossChecker[],
    private readonly settlement: Pick<SettlementCoordinator, "recordAdjudication">,
    private readonly bondVerifier: BondVerifier,
    store: DisputeStore = new MemoryDisputeStore()
  ) {
    if (checkers.length < 3 || checkers.length % 2 === 0) {
      throw new Error("VERITY_CHECKER_QUORUM: provide an odd number of at least three cross-checkers");
    }
    const checkerIds = new Set(checkers.map((checker) => checker.id));
    if (checkerIds.size !== checkers.length) throw new Error("VERITY_CHECKER_IDS: checker IDs must be unique");
    this.store = store;
  }

  public async submit(submission: DisputeSubmission): Promise<DisputeSubmissionResult> {
    validateSubmission(submission, this.checkers.length);
    const requestHash = sha256(stableJson(submission));
    const existing = await this.store.get(submission.disputeId);
    if (existing) {
      if (existing.requestHash !== requestHash) throw new IdempotencyConflictError(submission.disputeId);
      return { created: false, result: existing.result };
    }

    const provider = await this.providers.get(submission.providerId);
    if (!provider) throw new DisputeInputError(`VERITY_PROVIDER_UNKNOWN: no registered provider ${submission.providerId}`);
    if (!provider.providerRoot.trim()) throw new DisputeInputError(`VERITY_PROVIDER_ROOT_MISSING: ${submission.providerId} has no verified root`);
    if (!/^\d+$/.test(provider.providerStakeAmount) || BigInt(provider.providerStakeAmount) <= 0n) {
      throw new DisputeInputError(`VERITY_PROVIDER_STAKE_INVALID: ${submission.providerId} has an invalid stake amount`);
    }
    if (!isEvmAddress(provider.providerAddress)) throw new DisputeInputError(`VERITY_PROVIDER_ADDRESS_INVALID: ${submission.providerId} has an invalid payout address`);
    await this.bondVerifier.verify({
      transactionId: submission.bondTransactionId,
      disputeId: submission.disputeId,
      providerRoot: provider.providerRoot,
      buyerAddress: submission.buyerAddress,
      amountTinybars: submission.buyerBondAmount
    });
    const evaluationInput = await this.content.readJson(submission.evaluationInput);
    await this.content.readJson(submission.buyerResponse);
    const providerResponses = await Promise.all(submission.providerResponses.map((reference) => this.content.readJson(reference)));
    const buyer = await this.identity.verify(submission.identityProof, submission.identitySignal);
    const eligibility = requireDisputeEligibility(buyer, submission.buyerBondAmount);
    const boundCheckers = this.checkers.map((checker, index) => ({
      id: checker.id,
      check: (input: { ruleId: RuleId; value: unknown }) => checker.check({
        ruleId: input.ruleId,
        value: checkerValue(submission.ruleId, evaluationInput, providerResponses[index])
      })
    }));
    const adjudication = await adjudicate({ ruleId: submission.ruleId, value: evaluationInput }, boundCheckers);
    const verdict = majorityVerdict(submission.ruleId, adjudication.verdict, adjudication.votes.length);
    const request: DisputeResolutionRequest = {
      requestId: submission.requestId,
      providerId: submission.providerId,
      buyerId: submission.buyerId,
      ruleId: submission.ruleId,
      paymentPayload: submission.paymentPayload,
      paymentRequirements: submission.paymentRequirements,
      disputeId: submission.disputeId,
      buyerRoot: eligibility.buyer.root,
      providerRoot: provider.providerRoot,
      verdict,
      buyerBondAmount: eligibility.bondAmount,
      bondTransactionId: submission.bondTransactionId,
      providerStakeAmount: provider.providerStakeAmount,
      buyerAddress: submission.buyerAddress,
      providerAddress: provider.providerAddress,
      evaluationInput: submission.evaluationInput,
      buyerResponse: submission.buyerResponse,
      providerResponses: submission.providerResponses,
      crossCheckerVerdicts: adjudication.votes
    };
    const outcome = await this.settlement.recordAdjudication(request);
    const result: DisputeResult = {
      disputeId: submission.disputeId,
      requestId: submission.requestId,
      buyerRoot: eligibility.buyer.root,
      providerRoot: provider.providerRoot,
      bondTransactionId: submission.bondTransactionId,
      verdict,
      votes: adjudication.votes,
      state: outcome.state,
      ...(outcome.transactionId ? { transactionId: outcome.transactionId } : {}),
      hcsTransactionId: outcome.hcsTransactionId,
      recordedAt: new Date().toISOString()
    };
    const stored: StoredDispute = { requestHash, result };
    await this.store.put(submission.disputeId, stored);
    return { created: true, result };
  }
}

function majorityVerdict(ruleId: RuleId, verdict: "accept" | "reject", checkerCount: number): DeterministicVerdict {
  return {
    verdict,
    ruleId,
    reasonCode: verdict === "reject" ? "CHECKER_MAJORITY_REJECT" : "CHECKER_MAJORITY_ACCEPT",
    evidence: { checkerCount, ruleId, majorityRule: "strict-majority" }
  };
}

function validateSubmission(value: DisputeSubmission, checkerCount: number): void {
  if (!value.disputeId.trim() || !value.requestId.trim() || !value.providerId.trim() || !value.buyerId.trim()) {
    throw new DisputeInputError("VERITY_DISPUTE_FIELDS_REQUIRED: disputeId, requestId, providerId, and buyerId are required");
  }
  if (!isEvmAddress(value.buyerAddress)) throw new DisputeInputError("VERITY_BUYER_ADDRESS_INVALID: provide a 20-byte EVM address");
  if (!Object.values(RULE_IDS).includes(value.ruleId)) throw new DisputeInputError(`VERITY_RULE_UNKNOWN: ${value.ruleId}`);
  if (!/^\d+$/.test(value.buyerBondAmount) || BigInt(value.buyerBondAmount) <= 0n) {
    throw new DisputeInputError("VERITY_NO_BOND: buyerBondAmount must be a positive integer");
  }
  if (!value.bondTransactionId.trim()) throw new DisputeInputError("VERITY_BOND_TRANSACTION_MISSING: provide the posted bond transaction ID");
  validateReference(value.evaluationInput, "evaluationInput");
  validateReference(value.buyerResponse, "buyerResponse");
  if (value.providerResponses.length !== checkerCount) {
    throw new DisputeInputError(`VERITY_PROVIDER_RESPONSES: expected one response reference for each of the ${checkerCount} configured checkers`);
  }
  for (const reference of value.providerResponses) validateReference(reference, "providerResponses");
}

function validateReference(value: ContentReference, name: string): void {
  if (!/^[0-9a-f]{64}$/.test(value.sha256) || !value.mediaType.trim() || !Number.isSafeInteger(value.byteLength) || value.byteLength < 0) {
    throw new DisputeInputError(`VERITY_CONTENT_REFERENCE_INVALID: ${name} is not a valid content reference`);
  }
  if (value.uri !== undefined && !value.uri.trim()) throw new DisputeInputError(`VERITY_CONTENT_REFERENCE_INVALID: ${name}.uri is empty`);
}

function checkerValue(ruleId: RuleId, evaluationInput: unknown, providerResponse: unknown): unknown {
  if (!isRecord(evaluationInput) || !isRecord(providerResponse)) {
    throw new DisputeInputError(`VERITY_PROVIDER_RESPONSE_INVALID: ${ruleId} responses must be JSON objects`);
  }
  if (ruleId === RULE_IDS.fxRate) {
    return {
      expectedRate: requiredResponseString(evaluationInput.expectedRate, "evaluationInput.expectedRate"),
      actualRate: requiredResponseString(providerResponse.rate ?? providerResponse.actualRate, "providerResponse.rate"),
      toleranceBps: requiredResponseInteger(evaluationInput.toleranceBps, "evaluationInput.toleranceBps")
    };
  }
  return {
    expected: requiredResponseString(evaluationInput.expected, "evaluationInput.expected"),
    actual: requiredResponseString(providerResponse.entity ?? providerResponse.actual, "providerResponse.entity")
  };
}

function requiredResponseString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new DisputeInputError(`VERITY_PROVIDER_RESPONSE_INVALID: ${name} must be a non-empty string`);
  return value;
}

function requiredResponseInteger(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new DisputeInputError(`VERITY_PROVIDER_RESPONSE_INVALID: ${name} must be an integer`);
  return value;
}

export function isDisputeSubmission(value: unknown): value is DisputeSubmission {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<DisputeSubmission>;
  return typeof candidate.disputeId === "string"
    && typeof candidate.requestId === "string"
    && typeof candidate.providerId === "string"
    && typeof candidate.buyerId === "string"
    && typeof candidate.ruleId === "string"
    && isRecord(candidate.paymentPayload)
    && isRecord(candidate.paymentRequirements)
    && isRecord(candidate.identityProof)
    && typeof candidate.identitySignal === "string"
    && typeof candidate.buyerAddress === "string"
    && typeof candidate.buyerBondAmount === "string"
    && typeof candidate.bondTransactionId === "string"
    && isContentReference(candidate.evaluationInput)
    && isContentReference(candidate.buyerResponse)
    && Array.isArray(candidate.providerResponses)
    && candidate.providerResponses.every(isContentReference);
}

function isContentReference(value: unknown): value is ContentReference {
  if (!isRecord(value)) return false;
  return typeof value.sha256 === "string" && typeof value.mediaType === "string" && typeof value.byteLength === "number"
    && (value.uri === undefined || typeof value.uri === "string");
}

function isEvmAddress(value: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
