import { Blocky402Client, type PaymentPayload, type PaymentRequirements, readSettlementConfig } from "@verity/hedera";
import { createHederaClient, HederaHcsPublisher, type HcsPublisher } from "@verity/hcs";
import type { DeterministicVerdict, RuleId } from "@verity/types";
import { transition, type SettlementState } from "./state.js";

export interface SettlementRequest {
  readonly requestId: string;
  readonly providerId: string;
  readonly buyerId: string;
  readonly ruleId: RuleId;
  readonly paymentPayload: PaymentPayload;
  readonly paymentRequirements: PaymentRequirements;
}

export interface DisputeResolutionRequest extends SettlementRequest {
  readonly disputeId: string;
  readonly buyerRoot: string;
  readonly providerRoot: string;
  readonly verdict: DeterministicVerdict;
  readonly buyerBondAmount: string;
  readonly providerStakeAmount: string;
}

export interface SettlementOutcome {
  readonly state: Extract<SettlementState, "settled" | "void">;
  readonly transactionId?: string;
  readonly hcsTransactionId: string;
}

export class SettlementCoordinator {
  public constructor(
    private readonly facilitator: Blocky402Client,
    private readonly hcs: HcsPublisher,
    private readonly topics: { settlement: string; dispute: string }
  ) {}

  public async settleAccepted(request: SettlementRequest): Promise<SettlementOutcome> {
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

  public async recordVoid(request: DisputeResolutionRequest): Promise<SettlementOutcome> {
    let state = transition("created", "verified");
    state = transition(state, "held");
    state = transition(state, "adjudication_started");
    state = transition(state, request.verdict.verdict === "reject" ? "adjudication_upheld" : "adjudication_overturned");
    if (state !== "void") {
      throw new Error("VERITY_VOID_EXPECTED: recordVoid requires an upheld provider dispute");
    }
    const hcsTransactionId = await this.hcs.publish(this.topics.dispute, {
      schema: "verity/hcs/v1",
      kind: "dispute",
      id: request.disputeId,
      recordedAt: new Date().toISOString(),
      payload: {
        disputeId: request.disputeId,
        requestId: request.requestId,
        providerId: request.providerId,
        buyerId: request.buyerId,
        providerRoot: request.providerRoot,
        buyerRoot: request.buyerRoot,
        ruleId: request.ruleId,
        verdict: request.verdict.verdict,
        buyerBondAmount: request.buyerBondAmount,
        providerStakeAmount: request.providerStakeAmount,
        resolution: state
      }
    });
    return { state, hcsTransactionId };
  }
}

export function createSettlementCoordinator(): SettlementCoordinator {
  const config = readSettlementConfig();
  const client = new Blocky402Client(config.facilitatorUrl, { requestTimeoutMs: config.requestTimeoutMs });
  const hederaClient = createHederaClient(config.network, config.operatorAccountId, config.operatorPrivateKey);
  const hcs = new HederaHcsPublisher(hederaClient);
  return new SettlementCoordinator(client, hcs, { settlement: config.settlementTopicId, dispute: config.disputeTopicId });
}
