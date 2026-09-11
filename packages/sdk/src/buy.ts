import { randomUUID } from "node:crypto";
import { decodePaymentRequiredHeader, encodePaymentSignatureHeader } from "@x402/core/http";
import type { Network, PaymentPayload, PaymentRequired, PaymentRequirements, SettleResponse } from "@x402/core/types";
import { HttpContentStore, type ContentStore } from "@verity/content";
import { Blocky402Client, readBuyerConfig } from "@verity/hedera";
import { createHederaClient, createVerityEscrowClient } from "@verity/hcs";
import { evaluateEntity, evaluateFxRate, RULE_IDS, type ContentReference, type DeterministicVerdict, type RuleId } from "@verity/types";

export type Evaluator = RuleId | ((value: unknown, response: Response, requirements: PaymentRequirements) => DeterministicVerdict | Promise<DeterministicVerdict>);

export interface BuyOptions {
  readonly evaluate: Evaluator;
  readonly bond?: string;
  readonly maxPrice?: string;
  readonly disputeUrl?: string;
  readonly requestId?: string;
  readonly disputeId?: string;
  readonly providerId?: string;
  readonly buyerId?: string;
  readonly buyerAddress?: string;
  readonly providerRoot?: string;
  readonly identityProof?: Readonly<Record<string, unknown>>;
  readonly identitySignal?: string;
  readonly evaluationInput?: unknown;
  readonly providerResponses?: readonly ContentReference[];
  readonly contentStore?: ContentStore;
  readonly postBond?: (disputeId: string, providerRoot: string, amountTinybars: string) => Promise<{ transactionId: string }>;
  readonly fetchImpl?: typeof fetch;
  readonly facilitator?: Blocky402Client;
  readonly settle?: (paymentPayload: PaymentPayload, requirements: PaymentRequirements) => Promise<SettleResponse>;
}

export interface BuyResult {
  readonly data: unknown;
  readonly verdict: DeterministicVerdict;
  readonly paymentPayload: PaymentPayload;
  readonly requirements: PaymentRequirements;
  readonly settlement?: SettleResponse;
  readonly dispute?: unknown;
  readonly disputeId?: string;
  readonly bondTransactionId?: string;
}

export async function buy(url: string, options: BuyOptions): Promise<BuyResult> {
  const config = readBuyerConfig();
  const fetchImpl = options.fetchImpl ?? fetch;
  const facilitator = options.facilitator ?? new Blocky402Client(config.facilitatorUrl, { requestTimeoutMs: config.requestTimeoutMs });
  const unpaidResponse = await fetchImpl(url, { method: "GET" });
  if (unpaidResponse.status !== 402) {
    throw new Error(`VERITY_PAYMENT_REQUIRED_EXPECTED: ${url} returned ${unpaidResponse.status} without a payment challenge`);
  }

  const paymentRequired = await parsePaymentRequired(unpaidResponse);
  const requirements = selectRequirements(paymentRequired, config.network, options.maxPrice);
  const [{ x402Client }, { ExactHederaScheme, PrivateKey, createClientHederaSigner }] = await Promise.all([
    import("@x402/core/client"),
    import("@x402/hedera")
  ]);
  const signer = createClientHederaSigner(
    config.clientAccountId,
    PrivateKey.fromStringECDSA(config.clientPrivateKey),
    { network: config.network }
  );
  const client = new x402Client().setSpendControls(false).register(config.network as Network, new ExactHederaScheme(signer));
  const paymentPayload = await client.createPaymentPayload(paymentRequired);
  const paidResponse = await fetchImpl(url, {
    method: "GET",
    headers: { "payment-signature": encodePaymentSignatureHeader(paymentPayload) }
  });
  if (!paidResponse.ok) {
    const detail = await paidResponse.text();
    throw new Error(`VERITY_RESOURCE_REQUEST_FAILED: ${paidResponse.status} ${detail}`);
  }

  const data = await readResponseBody(paidResponse);
  const verdict = await evaluateValue(options.evaluate, data, paidResponse, requirements);
  if (verdict.verdict === "accept") {
    const settlement = await (options.settle ? options.settle(paymentPayload, requirements) : facilitator.settle(paymentPayload, requirements));
    if (!settlement.success) {
      throw new Error(`VERITY_SETTLEMENT_FAILED: ${settlement.errorReason ?? "unknown"} ${settlement.errorMessage ?? ""}`.trim());
    }
    return { data, verdict, paymentPayload, requirements, settlement };
  }

  if (!options.bond) {
    throw new Error("VERITY_NO_BOND: reject() requires a bond; call buy() with { bond } or see docs/bonds");
  }
  if (!/^\d+$/.test(options.bond) || BigInt(options.bond) <= 0n) {
    throw new Error("VERITY_BOND_INVALID: bond must be a positive integer in the configured asset's smallest unit");
  }
  const disputeUrl = options.disputeUrl ?? process.env.VERITY_DISPUTE_URL;
  if (!disputeUrl) {
    throw new Error("VERITY_DISPUTE_URL_MISSING: configure disputeUrl to submit a bonded rejection");
  }

  const providerId = requiredOption(options.providerId, "VERITY_PROVIDER_ID_MISSING: configure providerId for a bonded rejection");
  const buyerId = requiredOption(options.buyerId, "VERITY_BUYER_ID_MISSING: configure buyerId for a bonded rejection");
  const buyerAddress = requiredOption(options.buyerAddress ?? process.env.HEDERA_CLIENT_EVM_ADDRESS, "VERITY_BUYER_ADDRESS_MISSING: configure the buyer EVM address for escrow resolution");
  const providerRoot = requiredOption(options.providerRoot, "VERITY_PROVIDER_ROOT_MISSING: configure providerRoot before posting a bond");
  const identityProof = options.identityProof;
  if (!identityProof) throw new Error("VERITY_IDENTITY_PROOF_MISSING: provide a verified World ID proof before rejecting a response");
  const identitySignal = requiredOption(options.identitySignal, "VERITY_IDENTITY_SIGNAL_MISSING: provide the signal bound to the dispute");
  const providerResponses = options.providerResponses;
  if (!providerResponses || providerResponses.length < 3 || providerResponses.length % 2 === 0) {
    throw new Error("VERITY_PROVIDER_RESPONSES_MISSING: provide an odd number of at least three independent provider response references");
  }

  const contentStore = options.contentStore ?? new HttpContentStore(requiredEnvironment("CONTENT_STORE_BASE_URL"));
  const evaluationInput = await contentStore.putJson(options.evaluationInput ?? replayInput(options.evaluate, data));
  const buyerResponse = await contentStore.putJson(data);
  const disputeId = options.disputeId ?? randomUUID();
  const requestId = options.requestId ?? randomUUID();
  const bond = options.postBond ?? createBondPoster(config);
  let bondTransactionId: string;
  try {
    const bondResult = await bond(disputeId, providerRoot, options.bond);
    bondTransactionId = bondResult.transactionId;
  } catch (error) {
    throw new Error(`VERITY_BOND_POST_FAILED: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }

  const disputeResponse = await fetchImpl(disputeUrl, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": disputeId },
    body: JSON.stringify({
      disputeId,
      requestId,
      providerId,
      buyerId,
      buyerAddress,
      ruleId: verdict.ruleId,
      paymentPayload,
      paymentRequirements: requirements,
      identityProof,
      identitySignal,
      buyerBondAmount: options.bond,
      bondTransactionId,
      evaluationInput,
      buyerResponse,
      providerResponses
    })
  });
  const disputeBody = await readResponseBody(disputeResponse);
  if (!disputeResponse.ok) {
    throw new Error(`VERITY_DISPUTE_FAILED: ${disputeResponse.status} ${JSON.stringify(disputeBody)}`);
  }
  return { data, verdict, paymentPayload, requirements, dispute: disputeBody, disputeId, bondTransactionId };
}

function requiredOption(value: string | undefined, message: string): string {
  if (!value?.trim()) throw new Error(message);
  return value.trim();
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`VERITY_CONFIG_MISSING: ${name} is required; set it in .env`);
  return value;
}

function createBondPoster(config: ReturnType<typeof readBuyerConfig>) {
  if (process.env.HEDERA_ASSET_ID?.trim() !== "0.0.0") {
    throw new Error("VERITY_ESCROW_ASSET_UNSUPPORTED: bond escrow currently accepts HBAR only; set HEDERA_ASSET_ID=0.0.0");
  }
  const contractId = requiredEnvironment("VERITY_ESCROW_CONTRACT_ID");
  const gas = Number(requiredEnvironment("VERITY_ESCROW_GAS"));
  if (!Number.isSafeInteger(gas) || gas <= 0) throw new Error("VERITY_ESCROW_GAS_INVALID: use a positive integer gas limit");
  const client = createHederaClient(config.network, config.clientAccountId, config.clientPrivateKey);
  return async (disputeId: string, providerRoot: string, amountTinybars: string) => createVerityEscrowClient(client, contractId, gas).postBond(disputeId, providerRoot, amountTinybars);
}

function replayInput(evaluator: Evaluator, value: unknown): unknown {
  if (typeof evaluator !== "string") {
    throw new Error("VERITY_EVALUATION_INPUT_MISSING: custom evaluators must provide { evaluationInput } for replay");
  }
  if (!value || typeof value !== "object") throw new Error(`VERITY_EVALUATION_INPUT: ${evaluator} requires a JSON object response`);
  const record = value as Record<string, unknown>;
  if (evaluator === RULE_IDS.fxRate) {
    if (typeof record.expectedRate !== "string" || typeof record.rate !== "string" || typeof record.toleranceBps !== "number") {
      throw new Error("VERITY_EVALUATION_INPUT: fx-rate-v1 requires expectedRate, rate, and toleranceBps");
    }
    return { expectedRate: record.expectedRate, actualRate: record.rate, toleranceBps: record.toleranceBps };
  }
  if (evaluator === RULE_IDS.entityCanonical) {
    if (typeof record.expected !== "string" || typeof record.entity !== "string") {
      throw new Error("VERITY_EVALUATION_INPUT: entity-canonical-v1 requires expected and entity");
    }
    return { expected: record.expected, actual: record.entity };
  }
  throw new Error(`VERITY_RULE_UNKNOWN: ${evaluator}`);
}

async function parsePaymentRequired(response: Response): Promise<PaymentRequired> {
  const encoded = response.headers.get("payment-required");
  if (encoded) return decodePaymentRequiredHeader(encoded);
  const raw = await response.text();
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new Error("VERITY_PAYMENT_REQUIRED_INVALID: 402 response had no decodable payment-required header or JSON body", { cause: error });
  }
  if (!isPaymentRequired(value)) {
    throw new Error("VERITY_PAYMENT_REQUIRED_INVALID: 402 response did not match x402 v2");
  }
  return value;
}

function selectRequirements(paymentRequired: PaymentRequired, network: string, maxPrice?: string): PaymentRequirements {
  const requirements = paymentRequired.accepts.find((entry) => entry.network === network && entry.scheme === "exact");
  if (!requirements) {
    throw new Error(`VERITY_NO_ACCEPTED_PAYMENT: resource does not accept exact payments on ${network}`);
  }
  if (maxPrice !== undefined && BigInt(requirements.amount) > BigInt(maxPrice)) {
    throw new Error(`VERITY_PRICE_LIMIT: resource asks for ${requirements.amount}, maxPrice is ${maxPrice}`);
  }
  return requirements;
}

async function evaluateValue(evaluator: Evaluator, value: unknown, response: Response, requirements: PaymentRequirements): Promise<DeterministicVerdict> {
  const verdict = typeof evaluator === "function" ? await evaluator(value, response, requirements) : evaluateByRule(evaluator, value);
  if (verdict.ruleId !== (typeof evaluator === "function" ? verdict.ruleId : evaluator)) {
    throw new Error(`VERITY_RULE_MISMATCH: evaluator returned ${verdict.ruleId}`);
  }
  return verdict;
}

function evaluateByRule(rule: RuleId, value: unknown): DeterministicVerdict {
  if (!value || typeof value !== "object") {
    throw new Error(`VERITY_EVALUATION_INPUT: ${rule} requires a JSON object response`);
  }
  const record = value as Record<string, unknown>;
  if (rule === RULE_IDS.fxRate) {
    if (typeof record.expectedRate !== "string" || typeof record.rate !== "string" || typeof record.toleranceBps !== "number") {
      throw new Error("VERITY_EVALUATION_INPUT: fx-rate-v1 requires expectedRate, rate, and toleranceBps");
    }
    return evaluateFxRate({ expectedRate: record.expectedRate, actualRate: record.rate, toleranceBps: record.toleranceBps });
  }
  if (rule === RULE_IDS.entityCanonical) {
    if (typeof record.expected !== "string" || typeof record.entity !== "string") {
      throw new Error("VERITY_EVALUATION_INPUT: entity-canonical-v1 requires expected and entity");
    }
    return evaluateEntity({ expected: record.expected, actual: record.entity });
  }
  throw new Error(`VERITY_RULE_UNKNOWN: ${rule}`);
}

async function readResponseBody(response: Response): Promise<unknown> {
  const raw = await response.text();
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("json")) return raw;
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error("VERITY_RESPONSE_JSON: paid response advertised JSON but could not be decoded", { cause: error });
  }
}

function isPaymentRequired(value: unknown): value is PaymentRequired {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PaymentRequired>;
  return candidate.x402Version === 2 && typeof candidate.resource === "object" && Array.isArray(candidate.accepts);
}
