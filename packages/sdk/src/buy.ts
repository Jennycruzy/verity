import { randomUUID } from "node:crypto";
import { decodePaymentRequiredHeader, encodePaymentSignatureHeader } from "@x402/core/http";
import type { Network, PaymentPayload, PaymentRequired, PaymentRequirements, SettleResponse } from "@x402/core/types";
import { HttpContentStore, type ContentStore } from "@verity/content";
import { Blocky402Client, discoverHederaCapability, readBuyerConfig } from "@verity/hedera";
import { createHederaClient, createVerityEscrowClient } from "@verity/hcs";
import { evaluateEntity, evaluateFxRate, RULE_IDS, type ContentReference, type DeterministicVerdict, type RuleId } from "@verity/types";

export type Evaluator = RuleId | ((value: unknown, response: Response, requirements: PaymentRequirements) => DeterministicVerdict | Promise<DeterministicVerdict>);
export type EvaluationInputResolver = (value: unknown, response: Response, requirements: PaymentRequirements) => unknown | Promise<unknown>;

export interface BondPostResult {
  readonly transactionId: string;
  readonly scheduleId?: string;
}

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
  readonly buyerAddress?: string;
  readonly providerRoot?: string;
  readonly identityProof?: Readonly<Record<string, unknown>>;
  readonly identitySignal?: string;
  readonly evaluationInput?: unknown | EvaluationInputResolver;
  readonly providerResponses?: readonly ContentReference[];
  readonly contentStore?: ContentStore;
  readonly postBond?: (disputeId: string, providerRoot: string, amountTinybars: string, expiresAt?: Date) => Promise<BondPostResult>;
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
  readonly bondScheduleId?: string;
}

export async function buy(url: string, options: BuyOptions): Promise<BuyResult> {
  const config = readBuyerConfig();
  const fetchImpl = options.fetchImpl ?? fetch;
  const facilitator = options.facilitator ?? new Blocky402Client(config.facilitatorUrl, { requestTimeoutMs: config.requestTimeoutMs });
  const capability = await discoverHederaCapability(facilitator, config.network);
  const unpaidResponse = await fetchImpl(url, { method: "GET" });
  if (unpaidResponse.status !== 402) {
    throw new Error(`VERITY_PAYMENT_REQUIRED_EXPECTED: ${url} returned ${unpaidResponse.status} without a payment challenge`);
  }

  const paymentRequired = await parsePaymentRequired(unpaidResponse);
  const requirements = selectRequirements(paymentRequired, config.network, options.maxPrice);
  assertPaymentCapability(requirements, capability.feePayer);
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
    if (!settlement.success || !settlement.transaction) {
      const detail = settlement.success ? "transaction missing" : `${settlement.errorReason ?? "unknown"} ${settlement.errorMessage ?? ""}`.trim();
      throw new Error(`VERITY_SETTLEMENT_FAILED: ${detail}`);
    }
    return { data, verdict, paymentPayload, requirements, settlement };
  }

  if (!options.bond) {
    throw new Error("VERITY_NO_BOND: reject() requires a bond; call buy() with { bond } or see docs/BONDS.md");
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
  const bondExpiry = resolveBondExpiry(options.bondExpiry);
  const identityProof = options.identityProof;
  if (!identityProof) throw new Error("VERITY_IDENTITY_PROOF_MISSING: provide a verified World ID proof before rejecting a response");
  const identitySignal = requiredOption(options.identitySignal, "VERITY_IDENTITY_SIGNAL_MISSING: provide the signal bound to the dispute");
  const providerResponses = options.providerResponses;
  if (!Array.isArray(providerResponses) || providerResponses.length < 3 || providerResponses.length % 2 === 0) {
    throw new Error("VERITY_PROVIDER_RESPONSES_MISSING: provide an odd number of at least three independent provider response references");
  }
  providerResponses.forEach((reference, index) => assertContentReference(reference, `providerResponses[${index}]`));

  const contentStore = options.contentStore ?? new HttpContentStore(requiredEnvironment("CONTENT_STORE_BASE_URL"));
  const replayValue = options.evaluationInput === undefined
    ? replayInput(options.evaluate, data)
    : typeof options.evaluationInput === "function"
      ? await options.evaluationInput(data, paidResponse, requirements)
      : options.evaluationInput;
  const evaluationInput = await contentStore.putJson(replayValue);
  const buyerResponse = await contentStore.putJson(data);
  assertContentReference(evaluationInput, "evaluationInput");
  assertContentReference(buyerResponse, "buyerResponse");
  const disputeId = options.disputeId ?? randomUUID();
  const requestId = options.requestId ?? randomUUID();
  const bond = options.postBond ?? createBondPoster(config, buyerAddress);
  let bondResult: BondPostResult;
  try {
    bondResult = await bond(disputeId, providerRoot, options.bond, bondExpiry);
    if (!bondResult.transactionId.trim()) throw new Error("bond poster returned no transaction ID");
    if (bondExpiry && !bondResult.scheduleId?.trim()) {
      throw new Error("bond poster returned no schedule ID for the configured expiry");
    }
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
      bondTransactionId: bondResult.transactionId,
      ...(bondResult.scheduleId ? { bondScheduleId: bondResult.scheduleId } : {}),
      evaluationInput,
      buyerResponse,
      providerResponses
    })
  });
  const disputeBody = await readResponseBody(disputeResponse);
  if (!disputeResponse.ok) {
    throw new Error(`VERITY_DISPUTE_FAILED: ${disputeResponse.status} ${JSON.stringify(disputeBody)}`);
  }
  return {
    data,
    verdict,
    paymentPayload,
    requirements,
    dispute: disputeBody,
    disputeId,
    bondTransactionId: bondResult.transactionId,
    ...(bondResult.scheduleId ? { bondScheduleId: bondResult.scheduleId } : {})
  };
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

function assertContentReference(value: unknown, name: string): asserts value is ContentReference {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`VERITY_CONTENT_REFERENCE_INVALID: ${name} must be an object`);
  }
  const candidate = value as Partial<ContentReference>;
  if (typeof candidate.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(candidate.sha256)
    || typeof candidate.mediaType !== "string" || !candidate.mediaType.trim()
    || typeof candidate.byteLength !== "number" || !Number.isSafeInteger(candidate.byteLength) || candidate.byteLength < 0
    || (candidate.uri !== undefined && (typeof candidate.uri !== "string" || !candidate.uri.trim()))) {
    throw new Error(`VERITY_CONTENT_REFERENCE_INVALID: ${name} is not a valid content reference`);
  }
}

function createBondPoster(config: ReturnType<typeof readBuyerConfig>, buyerAddress: string) {
  if (config.bondAssetId !== "0.0.0") {
    throw new Error("VERITY_ESCROW_ASSET_UNSUPPORTED: bond escrow currently accepts HBAR only; set VERITY_BOND_ASSET_ID=0.0.0");
  }
  const contractId = requiredEnvironment("VERITY_ESCROW_CONTRACT_ID");
  const gas = Number(requiredEnvironment("VERITY_ESCROW_GAS"));
  if (!Number.isSafeInteger(gas) || gas <= 0) throw new Error("VERITY_ESCROW_GAS_INVALID: use a positive integer gas limit");
  return async (disputeId: string, providerRoot: string, amountTinybars: string, expiresAt?: Date): Promise<BondPostResult> => {
    const client = createHederaClient(config.network, config.clientAccountId, config.clientPrivateKey);
    try {
      const escrow = createVerityEscrowClient(client, contractId, gas);
      const posted = expiresAt
        ? await escrow.postBondWithExpiry(disputeId, providerRoot, amountTinybars, expiresAt)
        : await escrow.postBond(disputeId, providerRoot, amountTinybars);
      if (!expiresAt) return posted;
      let scheduled;
      try {
        scheduled = await escrow.scheduleBondExpiry(disputeId, buyerAddress, expiresAt);
      } catch (error) {
        throw new Error(`bond transaction ${posted.transactionId} succeeded but expiry scheduling failed`, { cause: error });
      }
      return { transactionId: posted.transactionId, scheduleId: scheduled.scheduleId };
    } finally {
      client.close();
    }
  };
}

function resolveBondExpiry(explicit?: Date): Date | undefined {
  if (explicit !== undefined) {
    assertFutureDate(explicit);
    return explicit;
  }
  const raw = process.env.VERITY_BOND_EXPIRY_SECONDS?.trim();
  if (!raw) return undefined;
  if (!/^\d+$/.test(raw) || BigInt(raw) <= 0n) {
    throw new Error("VERITY_BOND_EXPIRY_INVALID: VERITY_BOND_EXPIRY_SECONDS must be a positive integer");
  }
  const seconds = Number(raw);
  if (!Number.isSafeInteger(seconds) || seconds > Number.MAX_SAFE_INTEGER / 1000) {
    throw new Error("VERITY_BOND_EXPIRY_INVALID: expiry duration is too large");
  }
  const expiry = new Date(Date.now() + seconds * 1000);
  assertFutureDate(expiry);
  return expiry;
}

function assertFutureDate(value: Date): void {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime()) || value.getTime() <= Date.now()) {
    throw new Error("VERITY_BOND_EXPIRY_INVALID: bond expiry must be a future date");
  }
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
  if (!/^\d+$/.test(requirements.amount) || BigInt(requirements.amount) <= 0n) {
    throw new Error("VERITY_PAYMENT_AMOUNT_INVALID: resource payment amount must be a positive integer");
  }
  const normalizedMaxPrice = maxPrice?.trim();
  if (normalizedMaxPrice && (!/^\d+$/.test(normalizedMaxPrice) || BigInt(normalizedMaxPrice) <= 0n)) {
    throw new Error("VERITY_MAX_PRICE_INVALID: maxPrice must be a positive integer");
  }
  if (normalizedMaxPrice && BigInt(requirements.amount) > BigInt(normalizedMaxPrice)) {
    throw new Error(`VERITY_PRICE_LIMIT: resource asks for ${requirements.amount}, maxPrice is ${normalizedMaxPrice}`);
  }
  return requirements;
}

function assertPaymentCapability(requirements: PaymentRequirements, feePayer: string): void {
  const advertisedFeePayer = requirements.extra?.feePayer;
  if (typeof advertisedFeePayer !== "string" || advertisedFeePayer !== feePayer) {
    throw new Error("VERITY_FEE_PAYER_MISMATCH: payment requirements do not match the facilitator capability");
  }
}

async function evaluateValue(evaluator: Evaluator, value: unknown, response: Response, requirements: PaymentRequirements): Promise<DeterministicVerdict> {
  const verdict = typeof evaluator === "function" ? await evaluator(value, response, requirements) : evaluateByRule(evaluator, value);
  if (!isDeterministicVerdict(verdict)) {
    throw new Error("VERITY_EVALUATOR_SCHEMA: evaluate must return a deterministic verdict with verdict, ruleId, reasonCode, and evidence");
  }
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

function isDeterministicVerdict(value: unknown): value is DeterministicVerdict {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<DeterministicVerdict>;
  return (candidate.verdict === "accept" || candidate.verdict === "reject")
    && (candidate.ruleId === RULE_IDS.fxRate || candidate.ruleId === RULE_IDS.entityCanonical)
    && typeof candidate.reasonCode === "string"
    && candidate.reasonCode.trim().length > 0
    && Boolean(candidate.evidence && typeof candidate.evidence === "object" && !Array.isArray(candidate.evidence));
}
