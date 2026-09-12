export interface SupportedKind {
  readonly x402Version: number;
  readonly scheme: string;
  readonly network: string;
  readonly extra?: Readonly<Record<string, string>>;
}

export interface SupportedResponse {
  readonly kinds: readonly SupportedKind[];
  readonly extensions: readonly unknown[];
  readonly signers: Readonly<Record<string, readonly string[]>>;
}

export type PaymentRequirements = X402PaymentRequirements;
export type PaymentPayload = X402PaymentPayload;

export interface VerificationResult {
  readonly isValid: boolean;
  readonly payer?: string;
  readonly invalidReason?: string;
  readonly invalidMessage?: string;
}

export type SettlementResult = SettleResponse;

export interface HederaCapability {
  readonly x402Version: number;
  readonly scheme: "exact";
  readonly network: string;
  readonly feePayer: string;
}

type FetchLike = typeof fetch;

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("VERITY_FACILITATOR_URL_EMPTY: set BLOCKY402_URL");
  if (!URL.canParse(trimmed)) throw new Error("VERITY_FACILITATOR_URL_INVALID: use an absolute HTTP(S) URL");
  const parsed = new URL(trimmed);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("VERITY_FACILITATOR_URL_INVALID: use an absolute HTTP(S) URL");
  }
  return trimmed.replace(/\/$/, "");
}

export class Blocky402Client {
  private readonly baseUrl: string;
  private readonly requestTimeoutMs: number;
  private readonly fetchImpl: FetchLike;

  public constructor(baseUrl: string, options: { requestTimeoutMs?: number; fetchImpl?: FetchLike } = {}) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.requestTimeoutMs = options.requestTimeoutMs ?? 10_000;
    if (!Number.isSafeInteger(this.requestTimeoutMs) || this.requestTimeoutMs <= 0) {
      throw new Error("VERITY_FACILITATOR_TIMEOUT_INVALID: requestTimeoutMs must be a positive integer");
    }
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  public async supported(): Promise<SupportedResponse> {
    const response = await this.request("/supported", { method: "GET" });
    if (!isSupportedResponse(response)) {
      throw new Error("VERITY_FACILITATOR_SCHEMA: /supported response did not match the expected shape");
    }
    return response;
  }

  public async verify(paymentPayload: PaymentPayload, paymentRequirements: PaymentRequirements): Promise<VerificationResult> {
    const response = await this.request("/verify", {
      method: "POST",
      body: JSON.stringify({ x402Version: 2, paymentPayload, paymentRequirements })
    });
    if (!isVerificationResult(response)) {
      throw new Error("VERITY_FACILITATOR_SCHEMA: /verify response did not match the expected shape");
    }
    return response;
  }

  public async settle(paymentPayload: PaymentPayload, paymentRequirements: PaymentRequirements): Promise<SettlementResult> {
    const response = await this.request("/settle", {
      method: "POST",
      body: JSON.stringify({ x402Version: 2, paymentPayload, paymentRequirements })
    });
    if (!isSettlementResult(response)) {
      throw new Error("VERITY_FACILITATOR_SCHEMA: /settle response did not match the expected shape");
    }
    return response;
  }

  private async request(path: string, init: RequestInit): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: { "content-type": "application/json", ...(init.headers ?? {}) }
      });
      const raw = await response.text();
      let body: unknown;
      try {
        body = raw.length === 0 ? null : JSON.parse(raw);
      } catch (error) {
        throw new Error(`VERITY_FACILITATOR_JSON: response from ${path} was not JSON`, { cause: error });
      }
      if (!response.ok) {
        throw new Error(`VERITY_FACILITATOR_HTTP_${response.status}: ${JSON.stringify(body)}`);
      }
      return body;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`VERITY_FACILITATOR_TIMEOUT: ${path} exceeded ${this.requestTimeoutMs}ms`, { cause: error });
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export async function discoverHederaCapability(client: Blocky402Client, network: string): Promise<HederaCapability> {
  const supported = await client.supported();
  const kind = supported.kinds.find((entry) => entry.network === network && entry.scheme === "exact");
  if (!kind) {
    throw new Error(`VERITY_UNSUPPORTED_NETWORK: facilitator does not advertise exact payments on ${network}`);
  }
  if (kind.x402Version !== 2) {
    throw new Error(`VERITY_UNSUPPORTED_VERSION: facilitator advertises x402 v${kind.x402Version}; Verity requires v2`);
  }

  const feePayer = kind.extra?.feePayer;
  const signers = supported.signers["hedera:*"];
  if (!feePayer || !signers?.includes(feePayer)) {
    throw new Error("VERITY_FEE_PAYER_MISMATCH: Hedera capability must publish extra.feePayer and the same hedera signer");
  }

  return { x402Version: kind.x402Version, scheme: "exact", network, feePayer };
}

function isSupportedResponse(value: unknown): value is SupportedResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<SupportedResponse>;
  return Array.isArray(candidate.kinds)
    && candidate.kinds.every(isSupportedKind)
    && typeof candidate.signers === "object"
    && candidate.signers !== null
    && !Array.isArray(candidate.signers)
    && Object.values(candidate.signers).every((entries) => Array.isArray(entries) && entries.every((entry) => typeof entry === "string" && entry.trim().length > 0));
}

function isSupportedKind(value: unknown): value is SupportedKind {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<SupportedKind>;
  return typeof candidate.x402Version === "number"
    && Number.isSafeInteger(candidate.x402Version)
    && candidate.x402Version > 0
    && typeof candidate.scheme === "string"
    && candidate.scheme.trim().length > 0
    && typeof candidate.network === "string"
    && candidate.network.trim().length > 0
    && (candidate.extra === undefined || isStringRecord(candidate.extra));
}

function isStringRecord(value: unknown): value is Readonly<Record<string, string>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value).every((entry) => typeof entry === "string" && entry.trim().length > 0);
}

function isVerificationResult(value: unknown): value is VerificationResult {
  return Boolean(value && typeof value === "object" && typeof (value as VerificationResult).isValid === "boolean");
}

function isSettlementResult(value: unknown): value is SettlementResult {
  return Boolean(value && typeof value === "object" && typeof (value as SettlementResult).success === "boolean");
}
import type { PaymentPayload as X402PaymentPayload, PaymentRequirements as X402PaymentRequirements, SettleResponse } from "@x402/core/types";
