import { decodePaymentRequiredHeader, encodePaymentSignatureHeader } from "@x402/core/http";
import type { Network, PaymentPayload, PaymentRequired, PaymentRequirements, SettleResponse } from "@x402/core/types";
import { Blocky402Client, readBuyerConfig } from "@verity/hedera";
import { evaluateEntity, evaluateFxRate, RULE_IDS, type DeterministicVerdict, type RuleId } from "@verity/types";

export type Evaluator = RuleId | ((value: unknown, response: Response, requirements: PaymentRequirements) => DeterministicVerdict | Promise<DeterministicVerdict>);

export interface BuyOptions {
  readonly evaluate: Evaluator;
  readonly bond?: string;
  readonly maxPrice?: string;
  readonly disputeUrl?: string;
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
    PrivateKey.fromString(config.clientPrivateKey),
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

  const disputeResponse = await fetchImpl(disputeUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ paymentPayload, requirements, bond: options.bond, verdict })
  });
  const disputeBody = await readResponseBody(disputeResponse);
  if (!disputeResponse.ok) {
    throw new Error(`VERITY_DISPUTE_FAILED: ${disputeResponse.status} ${JSON.stringify(disputeBody)}`);
  }
  return { data, verdict, paymentPayload, requirements, dispute: disputeBody };
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
