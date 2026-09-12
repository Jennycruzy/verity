import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http";

export type Verdict = "accept" | "reject";
export type VerityVerifierId = "fx-rate-v1" | "entity-canonical-v1" | "graph-reputation-v1";
export type DeterministicVerdict = {
  readonly verdict: Verdict;
  readonly ruleId: "fx-rate-v1" | "entity-canonical-v1";
  readonly reasonCode: string;
  readonly evidence: Readonly<Record<string, string | number | boolean>>;
};
export type PaymentRequirements = Readonly<Record<string, unknown>>;
export type PaymentPayload = Readonly<Record<string, unknown>>;

export interface ProtectedRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: IncomingHttpHeaders;
  readonly raw?: IncomingMessage;
}

export type ProtectedApplication = (request: ProtectedRequest, response: ServerResponse) => void | Promise<void>;
export type PriceResolver = string | ((request: ProtectedRequest) => string | Promise<string>);

export interface ProtectOptions {
  readonly price: PriceResolver;
  readonly verifier: VerityVerifierId;
  readonly stake?: string;
  readonly description?: string;
  readonly maxTimeoutSeconds?: number;
}

export function protect(application: ProtectedApplication, options: ProtectOptions): ProtectedApplication;

export type Evaluator = VerityVerifierId | ((value: unknown, response: Response, requirements: PaymentRequirements) => DeterministicVerdict | Promise<DeterministicVerdict>);
export interface BuyOptions {
  readonly evaluate: Evaluator;
  readonly bond?: string;
  readonly bondExpiry?: Date;
  readonly maxPrice?: string;
  readonly disputeUrl?: string;
  readonly requestId?: string;
  readonly disputeId?: string;
  readonly providerId?: string;
  readonly buyerId?: string;
  readonly humanRoot?: string;
  readonly buyerAddress?: string;
  readonly providerRoot?: string;
  readonly identityProof?: Readonly<Record<string, unknown>>;
  readonly identitySignal?: string;
  readonly evaluationInput?: unknown | ((value: unknown, response: Response, requirements: PaymentRequirements) => unknown | Promise<unknown>);
  readonly providerResponses?: readonly ContentReference[];
  readonly fetchImpl?: typeof fetch;
}

export interface ContentReference {
  readonly sha256: string;
  readonly mediaType: string;
  readonly byteLength: number;
  readonly uri?: string;
}

export interface BuyResult {
  readonly data: unknown;
  readonly verdict: DeterministicVerdict;
  readonly paymentPayload: PaymentPayload;
  readonly requirements: PaymentRequirements;
  readonly settlement?: Readonly<Record<string, unknown>>;
  readonly dispute?: unknown;
  readonly disputeId?: string;
  readonly bondTransactionId?: string;
  readonly bondScheduleId?: string;
}

export function buy(url: string, options: BuyOptions): Promise<BuyResult>;

export interface ReplayConfig {
  readonly mirrorNodeBaseUrl: string;
  readonly disputeTopicId: string;
  readonly contentStoreBaseUrl: string;
}
export interface ReplayResult {
  readonly disputeId: string;
  readonly ruleId: "fx-rate-v1" | "entity-canonical-v1";
  readonly recordedVerdict: Verdict;
  readonly replayedVerdict: Verdict;
  readonly buyerVerdict: Verdict;
  readonly providerVotes: readonly { readonly checkerId: string; readonly verdict: Verdict; readonly reasonCode: string }[];
  readonly recordedVotesMatch: boolean;
  readonly matches: boolean;
}

export function replayDispute(disputeId: string, config: ReplayConfig): Promise<ReplayResult>;
