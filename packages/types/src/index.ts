import { createHash } from "node:crypto";

export const RULE_IDS = {
  fxRate: "fx-rate-v1",
  entityCanonical: "entity-canonical-v1"
} as const;

export const VERITY_HUMAN_ROOT_HEADER = "x-verity-human-root" as const;
export const VERITY_WORLD_PROOF_HEADER = "x-verity-world-proof" as const;
export const VERITY_WORLD_SIGNAL_HEADER = "x-verity-world-signal" as const;

export type RuleId = (typeof RULE_IDS)[keyof typeof RULE_IDS];
export type Verdict = "accept" | "reject";

export interface DeterministicVerdict {
  readonly verdict: Verdict;
  readonly ruleId: RuleId;
  readonly reasonCode: string;
  readonly evidence: Readonly<Record<string, string | number | boolean>>;
}

export interface CrossCheckerVerdict {
  readonly checkerId: string;
  readonly ruleId: RuleId;
  readonly verdict: Verdict;
  readonly reasonCode: string;
}

export interface CrossCheckerReceipt {
  readonly checkerId: string;
  readonly verdict: Verdict;
}

export interface FxRateObservation {
  readonly expectedRate: string;
  readonly actualRate: string;
  readonly toleranceBps: number;
}

export interface EntityObservation {
  readonly expected: string;
  readonly actual: string;
}

export interface ContentReference {
  readonly sha256: string;
  readonly mediaType: string;
  readonly byteLength: number;
  readonly uri?: string;
}

export interface ContentHashReference {
  readonly sha256: string;
}

export interface PaymentReceipt {
  readonly requestId: string;
  readonly providerId: string;
  readonly buyerId: string;
  readonly amount: string;
  readonly assetId: string;
  readonly network: string;
  readonly transactionId: string;
  readonly response: ContentReference;
  readonly ruleId: RuleId;
  readonly verdict: Verdict;
  readonly recordedAt: string;
}

export interface DisputeRecord {
  readonly disputeId: string;
  readonly requestId: string;
  readonly ruleId: RuleId;
  readonly buyerRoot: string;
  readonly providerRoot: string;
  readonly evaluationInput: ContentHashReference;
  readonly buyerResponse: ContentHashReference;
  readonly providerResponses: readonly ContentHashReference[];
  readonly crossCheckerVerdicts: readonly CrossCheckerReceipt[];
  readonly verdict: Verdict;
  readonly buyerBondAmount: string;
  readonly bondTransactionId?: string;
  readonly bondScheduleId?: string;
  readonly providerStakeAmount: string;
  readonly resolutionTransactionId?: string;
  readonly recordedAt: string;
}

const DECIMAL_SCALE = 18;
const DECIMAL_BASE = 10n ** BigInt(DECIMAL_SCALE);

function decimalToScaled(value: string): bigint {
  if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) {
    throw new Error(`Invalid decimal value: ${value}`);
  }

  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [whole, fraction = ""] = unsigned.split(".");
  if (!whole) {
    throw new Error(`Invalid decimal value: ${value}`);
  }
  if (fraction.length > DECIMAL_SCALE) {
    throw new Error(`Decimal value has more than ${DECIMAL_SCALE} fractional digits: ${value}`);
  }

  const scaled = BigInt(whole) * DECIMAL_BASE + BigInt(fraction.padEnd(DECIMAL_SCALE, "0") || "0");
  return negative ? -scaled : scaled;
}

export function evaluateFxRate(observation: FxRateObservation): DeterministicVerdict {
  if (!Number.isInteger(observation.toleranceBps) || observation.toleranceBps < 0 || observation.toleranceBps > 10_000) {
    throw new Error("toleranceBps must be an integer from 0 through 10000");
  }

  const expected = decimalToScaled(observation.expectedRate);
  const actual = decimalToScaled(observation.actualRate);
  const difference = expected >= actual ? expected - actual : actual - expected;
  const reference = expected < 0n ? -expected : expected;
  const withinTolerance = difference * 10_000n <= reference * BigInt(observation.toleranceBps);

  return {
    verdict: withinTolerance ? "accept" : "reject",
    ruleId: RULE_IDS.fxRate,
    reasonCode: withinTolerance ? "RATE_WITHIN_TOLERANCE" : "RATE_OUTSIDE_TOLERANCE",
    evidence: {
      expectedRate: observation.expectedRate,
      actualRate: observation.actualRate,
      toleranceBps: observation.toleranceBps
    }
  };
}

export function canonicalizeEntity(value: string): string {
  if (value.length === 0) {
    throw new Error("Entity value cannot be empty");
  }

  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function evaluateEntity(observation: EntityObservation): DeterministicVerdict {
  const expected = canonicalizeEntity(observation.expected);
  const actual = canonicalizeEntity(observation.actual);
  const matches = expected === actual;

  return {
    verdict: matches ? "accept" : "reject",
    ruleId: RULE_IDS.entityCanonical,
    reasonCode: matches ? "CANONICAL_MATCH" : "CANONICAL_MISMATCH",
    evidence: { expectedCanonical: expected, actualCanonical: actual }
  };
}

export function resolveDisputeVerdict(
  ruleId: RuleId,
  buyerVerdict: Verdict,
  checkerMajority: Verdict,
  checkerCount: number
): DeterministicVerdict {
  if (buyerVerdict !== "reject") {
    throw new Error("VERITY_DISPUTE_BUYER_VERDICT_INVALID: only a rejected buyer response can enter adjudication");
  }
  if (checkerCount < 3 || checkerCount % 2 === 0) {
    throw new Error("VERITY_CHECKER_QUORUM: provide an odd number of at least three cross-checkers");
  }
  const providerWasWrong = checkerMajority === "accept";
  return {
    verdict: providerWasWrong ? "reject" : "accept",
    ruleId,
    reasonCode: providerWasWrong ? "CHECKER_MAJORITY_UPHOLDS_REJECTION" : "CHECKER_MAJORITY_OVERTURNS_REJECTION",
    evidence: {
      buyerVerdict,
      checkerMajority,
      checkerCount,
      majorityRule: "strict-majority"
    }
  };
}

export function stableJson(value: unknown): string {
  return stableJsonValue(value, "$", new WeakSet<object>());
}

function stableJsonValue(value: unknown, path: string, ancestors: WeakSet<object>): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`VERITY_JSON_UNSUPPORTED: ${path} must be a finite number`);
    return JSON.stringify(value);
  }
  if (typeof value !== "object") {
    throw new Error(`VERITY_JSON_UNSUPPORTED: ${path} cannot be serialized as canonical JSON`);
  }
  if (ancestors.has(value)) throw new Error(`VERITY_JSON_CYCLE: ${path} contains a circular reference`);
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const entries: string[] = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(value, index)) {
          throw new Error(`VERITY_JSON_SPARSE_ARRAY: ${path}[${index}] is missing`);
        }
        entries.push(stableJsonValue(value[index], `${path}[${index}]`, ancestors));
      }
      return `[${entries.join(",")}]`;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error(`VERITY_JSON_UNSUPPORTED: ${path} must be a plain object`);
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new Error(`VERITY_JSON_UNSUPPORTED: ${path} contains symbol keys`);
    }
    const objectValue = value as Record<string, unknown>;
    const keys = Object.keys(objectValue).filter((key) => objectValue[key] !== undefined).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableJsonValue(objectValue[key], `${path}.${key}`, ancestors)}`).join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}

export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function assertCompactMessage(value: string, maxBytes: number): void {
  const byteLength = Buffer.byteLength(value, "utf8");
  if (byteLength > maxBytes) {
    throw new Error(`Message is ${byteLength} bytes; maximum is ${maxBytes} bytes`);
  }
}
