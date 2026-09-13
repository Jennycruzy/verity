import { Blocky402Client, discoverHederaCapability, type PaymentPayload, type PaymentRequirements, readSettlementConfig } from "@verity/hedera";
import { createHederaClient, createVerityEscrowClient, HederaHcsPublisher, type EscrowCallResult, type HcsPublisher } from "@verity/hcs";
import { sha256, stableJson, type ContentReference, type CrossCheckerVerdict, type DeterministicVerdict, type RuleId } from "@verity/types";
import { transition, type SettlementState } from "./state.js";
import { FileSettlementStore, MemorySettlementStore, type SettlementOperation, type SettlementStore } from "./store.js";

export interface SettlementRequest {
  readonly requestId: string;
  readonly providerId: string;
  readonly buyerId: string;
  readonly ruleId: RuleId;
  readonly paymentPayload: PaymentPayload;
  readonly paymentRequirements: PaymentRequirements;
}

export interface EscrowSettlementClient {
  lockStake(disputeId: string, amountTinybars: string): Promise<EscrowCallResult>;
  resolveBond(disputeId: string, providerWasWrong: boolean, buyerAddress: string, providerAddress: string): Promise<EscrowCallResult>;
  anchorReputation(providerRoot: string, buyerRoot: string, providerWasCorrect: boolean, buyerWasHonest: boolean): Promise<EscrowCallResult>;
}

export interface DisputeResolutionRequest extends SettlementRequest {
  readonly disputeId: string;
  readonly buyerRoot: string;
  readonly providerRoot: string;
  readonly verdict: DeterministicVerdict;
  readonly buyerBondAmount: string;
  readonly bondTransactionId?: string;
  readonly bondScheduleId?: string;
  readonly providerStakeAmount: string;
  readonly buyerAddress: string;
  readonly providerAddress: string;
  readonly evaluationInput: ContentReference;
  readonly buyerResponse: ContentReference;
  readonly providerResponses: readonly ContentReference[];
  readonly crossCheckerVerdicts: readonly CrossCheckerVerdict[];
}

export interface SettlementOutcome {
  readonly state: Extract<SettlementState, "settled" | "void">;
  readonly transactionId?: string;
  readonly stakeLockTransactionId?: string;
  readonly bondResolutionTransactionId?: string;
  readonly reputationTransactionId?: string;
  readonly hcsTransactionId: string;
  readonly hcsTransactionIds?: readonly string[];
}

export class SettlementIdempotencyConflictError extends Error {
  public constructor(key: string) {
    super(`VERITY_SETTLEMENT_IDEMPOTENCY_CONFLICT: ${key} already has a different request`);
    this.name = "SettlementIdempotencyConflictError";
  }
}

interface PendingSettlement<T> {
  readonly requestHash: string;
  readonly promise: Promise<T>;
}

export class SettlementCoordinator {
  private readonly accepted = new Map<string, PendingSettlement<SettlementOutcome>>();
  private readonly adjudications = new Map<string, PendingSettlement<SettlementOutcome>>();

  public constructor(
    private readonly facilitator: Blocky402Client,
    private readonly hcs: HcsPublisher,
    private readonly topics: { settlement: string; dispute: string },
    private readonly escrow?: EscrowSettlementClient,
    private readonly store: SettlementStore = new MemorySettlementStore()
  ) {}

  public settleAccepted(request: SettlementRequest): Promise<SettlementOutcome> {
    return this.runIdempotently(this.accepted, "accepted", request.requestId, request, () => this.settleAcceptedInternal(request));
  }

  public recordAdjudication(request: DisputeResolutionRequest): Promise<SettlementOutcome> {
    return this.runIdempotently(this.adjudications, "adjudication", request.disputeId, request, () => this.recordAdjudicationInternal(request));
  }

  public close(): void {
    this.hcs.close?.();
  }

  private async settleAcceptedInternal(request: SettlementRequest): Promise<SettlementOutcome> {
    await this.validatePaymentCapability(request.paymentRequirements);
    let state = transition("created", "verified");
    state = transition(state, "held");
    const result = await this.facilitator.settle(request.paymentPayload, request.paymentRequirements);
    if (!result.success || !result.transaction) {
      transition(state, "settlement_failed");
      throw new Error(`VERITY_SETTLEMENT_FAILED: ${result.errorReason ?? "unknown"} ${result.errorMessage ?? ""}`.trim());
    }
    state = transition(state, "accepted");
    if (state !== "settled") {
      throw new Error(`VERITY_SETTLEMENT_STATE: accepted payment ended in ${state}`);
    }
    let hcsTransactionId: string;
    try {
      hcsTransactionId = await this.hcs.publish(this.topics.settlement, {
        schema: "verity/hcs/v1",
        kind: "settlement",
        id: request.requestId,
        recordedAt: new Date().toISOString(),
        payload: {
          requestId: request.requestId,
          providerId: request.providerId,
          buyerId: request.buyerId,
          ruleId: request.ruleId,
          verdict: "accept",
          state,
          transactionId: result.transaction,
          amount: request.paymentRequirements.amount,
          assetId: request.paymentRequirements.asset,
          network: request.paymentRequirements.network
        }
      });
    } catch (error) {
      throw new Error(`VERITY_SETTLEMENT_ANCHOR_FAILED: payment ${result.transaction} succeeded but HCS publication failed`, { cause: error });
    }
    return { state, transactionId: result.transaction, hcsTransactionId };
  }

  private async recordAdjudicationInternal(request: DisputeResolutionRequest): Promise<SettlementOutcome> {
    await this.validatePaymentCapability(request.paymentRequirements);
    let state = transition("created", "verified");
    state = transition(state, "held");
    state = transition(state, "adjudication_started");
    if (!this.escrow) throw new Error("VERITY_ESCROW_NOT_CONFIGURED: set VERITY_ESCROW_CONTRACT_ID and VERITY_ESCROW_GAS before processing disputes");
    let transactionId: string | undefined;
    let stakeLockTransactionId: string | undefined;
    let bondResolutionTransactionId: string | undefined;
    let reputationTransactionId: string | undefined;
    if (request.verdict.verdict === "reject") {
      const escrowResult = await resolveEscrow(this.escrow, request, true);
      stakeLockTransactionId = escrowResult.stakeLockTransactionId;
      bondResolutionTransactionId = escrowResult.bondResolutionTransactionId;
      reputationTransactionId = escrowResult.reputationTransactionId;
      state = transition(state, "adjudication_upheld");
    } else {
      let escrowResult: Awaited<ReturnType<typeof resolveEscrow>>;
      try {
        escrowResult = await resolveEscrow(this.escrow, request, false);
      } catch (error) {
        throw new Error("VERITY_ESCROW_RESOLUTION_FAILED: correct-provider resolution did not complete; payment was not settled", { cause: error });
      }
      stakeLockTransactionId = escrowResult.stakeLockTransactionId;
      bondResolutionTransactionId = escrowResult.bondResolutionTransactionId;
      reputationTransactionId = escrowResult.reputationTransactionId;

      const result = await this.facilitator.settle(request.paymentPayload, request.paymentRequirements);
      if (!result.success || !result.transaction) {
        transition(state, "settlement_failed");
        throw new Error(`VERITY_SETTLEMENT_FAILED: ${result.errorReason ?? "unknown"} ${result.errorMessage ?? ""}`.trim());
      }
      transactionId = result.transaction;
      state = transition(state, "adjudication_overturned");
    }
    if (state !== "void" && state !== "settled") {
      throw new Error(`VERITY_ADJUDICATION_STATE: resolution ended in ${state}`);
    }
    const disputeRecord = {
      schema: "verity/hcs/v1" as const,
      kind: "dispute" as const,
      id: request.disputeId,
      recordedAt: new Date().toISOString(),
      payload: {
        requestId: request.requestId,
        providerId: request.providerId,
        buyerId: request.buyerId,
        providerRoot: request.providerRoot,
        buyerRoot: request.buyerRoot,
        ruleId: request.ruleId,
        evaluationInput: compactReference(request.evaluationInput),
        buyerResponse: compactReference(request.buyerResponse),
        providerResponses: request.providerResponses.map(compactReference),
        crossCheckerVerdicts: request.crossCheckerVerdicts.map((vote) => ({ checkerId: vote.checkerId, verdict: vote.verdict })),
        verdict: request.verdict.verdict,
        buyerBondAmount: request.buyerBondAmount,
        ...(request.bondTransactionId ? { bondTransactionId: request.bondTransactionId } : {}),
        ...(request.bondScheduleId ? { bondScheduleId: request.bondScheduleId } : {}),
        providerStakeAmount: request.providerStakeAmount,
        resolution: state
      }
    };
    const verdictRecord = {
      schema: "verity/hcs/v1" as const,
      kind: "verdict" as const,
      id: `${request.disputeId}:verdict`,
      recordedAt: disputeRecord.recordedAt,
      payload: {
        disputeId: request.disputeId,
        ruleId: request.ruleId,
        verdict: request.verdict.verdict,
        crossCheckerVerdicts: request.crossCheckerVerdicts.map((vote) => ({ checkerId: vote.checkerId, verdict: vote.verdict }))
      }
    };
    const bondRecord = {
      schema: "verity/hcs/v1" as const,
      kind: "bond" as const,
      id: `${request.disputeId}:bond`,
      recordedAt: disputeRecord.recordedAt,
      payload: {
        disputeId: request.disputeId,
        resolution: state,
        ...(request.bondTransactionId ? { bondTransactionId: request.bondTransactionId } : {}),
        ...(request.bondScheduleId ? { bondScheduleId: request.bondScheduleId } : {}),
        ...(stakeLockTransactionId ? { stakeLockTransactionId } : {}),
        ...(bondResolutionTransactionId ? { bondResolutionTransactionId } : {}),
        ...(reputationTransactionId ? { reputationTransactionId } : {}),
        ...(transactionId ? { resolutionTransactionId: transactionId } : {})
      }
    };
    const hcsTransactionIds: string[] = [];
    try {
      hcsTransactionIds.push(await this.hcs.publish(this.topics.dispute, disputeRecord));
      hcsTransactionIds.push(await this.hcs.publish(this.topics.dispute, verdictRecord));
      hcsTransactionIds.push(await this.hcs.publish(this.topics.dispute, bondRecord));
    } catch (error) {
      throw new Error(`VERITY_DISPUTE_ANCHOR_FAILED: ${hcsTransactionIds.length} dispute records published`, { cause: error });
    }
    return {
      state,
      ...(transactionId ? { transactionId } : {}),
      stakeLockTransactionId,
      bondResolutionTransactionId,
      reputationTransactionId,
      hcsTransactionId: hcsTransactionIds[0] as string,
      hcsTransactionIds
    };
  }

  public async recordVoid(request: DisputeResolutionRequest): Promise<SettlementOutcome> {
    if (request.verdict.verdict !== "reject") {
      throw new Error("VERITY_VOID_EXPECTED: recordVoid requires an upheld provider dispute");
    }
    return this.recordAdjudication(request);
  }

  private async validatePaymentCapability(requirements: PaymentRequirements): Promise<void> {
    const capability = await discoverHederaCapability(this.facilitator, requirements.network);
    if (requirements.scheme !== capability.scheme || requirements.network !== capability.network || requirements.extra?.feePayer !== capability.feePayer) {
      throw new Error("VERITY_FEE_PAYER_MISMATCH: payment requirements do not match the facilitator capability");
    }
  }

  private runIdempotently<T>(
    operations: Map<string, PendingSettlement<T>>,
    operationKind: SettlementOperation,
    key: string,
    request: unknown,
    run: () => Promise<T>
  ): Promise<T> {
    if (!key.trim()) throw new Error("VERITY_SETTLEMENT_IDEMPOTENCY_KEY_MISSING: request key must be non-empty");
    const requestHash = sha256(stableJson(request));
    const existing = operations.get(key);
    if (existing) {
      if (existing.requestHash !== requestHash) throw new SettlementIdempotencyConflictError(key);
      return existing.promise;
    }
    const promise = this.readStoredOrRun(operationKind, key, requestHash, run);
    operations.set(key, { requestHash, promise });
    return promise;
  }

  private async readStoredOrRun<T>(
    operation: SettlementOperation,
    key: string,
    requestHash: string,
    run: () => Promise<T>
  ): Promise<T> {
    const stored = await this.store.get(operation, key);
    if (stored) {
      if (stored.requestHash !== requestHash) throw new SettlementIdempotencyConflictError(key);
      return stored.outcome as T;
    }
    const outcome = await run();
    await this.store.put(operation, key, { requestHash, outcome: outcome as SettlementOutcome });
    return outcome;
  }
}

export function createSettlementCoordinator(): SettlementCoordinator {
  const config = readSettlementConfig();
  const client = new Blocky402Client(config.facilitatorUrl, { requestTimeoutMs: config.requestTimeoutMs });
  const hederaClient = createHederaClient(config.network, config.operatorAccountId, config.operatorPrivateKey);
  const hcs = new HederaHcsPublisher(hederaClient);
  const escrow = config.escrowContractId && config.escrowGas !== undefined
    ? createVerityEscrowClient(hederaClient, config.escrowContractId, config.escrowGas)
    : undefined;
  const storeDirectory = process.env.VERITY_SETTLEMENT_STORE_DIR?.trim() || "artifacts/settlements";
  return new SettlementCoordinator(
    client,
    hcs,
    { settlement: config.settlementTopicId, dispute: config.disputeTopicId },
    escrow,
    new FileSettlementStore(storeDirectory)
  );
}

async function resolveEscrow(
  escrow: EscrowSettlementClient,
  request: DisputeResolutionRequest,
  providerWasWrong: boolean
): Promise<{ stakeLockTransactionId: string; bondResolutionTransactionId: string; reputationTransactionId: string }> {
  const lock = await escrow.lockStake(request.disputeId, request.providerStakeAmount);
  const resolution = await escrow.resolveBond(request.disputeId, providerWasWrong, request.buyerAddress, request.providerAddress);
  const reputation = await escrow.anchorReputation(request.providerRoot, request.buyerRoot, !providerWasWrong, providerWasWrong);
  return {
    stakeLockTransactionId: lock.transactionId,
    bondResolutionTransactionId: resolution.transactionId,
    reputationTransactionId: reputation.transactionId
  };
}

function compactReference(reference: ContentReference): { sha256: string } {
  return { sha256: reference.sha256 };
}
