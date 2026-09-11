import type { IncomingMessage, ServerResponse } from "node:http";
import { decodePaymentSignatureHeader, encodePaymentRequiredHeader } from "@x402/core/http";
import type { Network, PaymentRequired, PaymentRequirements } from "@x402/core/types";
import { Blocky402Client, discoverHederaCapability, readProviderConfig } from "@verity/hedera";
import type { RuleId } from "@verity/types";

export interface ProtectedRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: IncomingMessage["headers"];
}

export type ProtectedApplication = (request: ProtectedRequest, response: ServerResponse) => void | Promise<void>;
export type PriceResolver = string | ((request: ProtectedRequest) => string | Promise<string>);

export interface ProtectOptions {
  readonly price: PriceResolver;
  readonly verifier: RuleId;
  readonly stake?: string;
  readonly description?: string;
  readonly maxTimeoutSeconds?: number;
  readonly facilitator?: Blocky402Client;
}

const DEFAULT_TIMEOUT_SECONDS = 30;

export function protect(application: ProtectedApplication, options: ProtectOptions): ProtectedApplication {
  const config = readProviderConfig();
  const facilitator = options.facilitator ?? new Blocky402Client(config.facilitatorUrl, { requestTimeoutMs: config.requestTimeoutMs });
  const capabilityPromise = discoverHederaCapability(facilitator, config.network);

  return async (request, response) => {
    const protectedRequest: ProtectedRequest = {
      method: request.method ?? "GET",
      url: request.url ?? "/",
      headers: request.headers
    };
    const capability = await capabilityPromise;
    const amount = await resolvePrice(options.price, protectedRequest);
    const requirements: PaymentRequirements = {
      scheme: capability.scheme,
      network: capability.network as Network,
      amount,
      payTo: config.payToAccountId,
      maxTimeoutSeconds: options.maxTimeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS,
      asset: config.assetId,
      extra: { feePayer: capability.feePayer }
    };

    const paymentHeader = headerValue(request.headers["payment-signature"]) ?? headerValue(request.headers["x-payment"]);
    if (!paymentHeader) {
      sendPaymentRequired(response, protectedRequest, requirements, options);
      return;
    }

    let paymentPayload;
    try {
      paymentPayload = decodePaymentSignatureHeader(paymentHeader);
    } catch (error) {
      sendPaymentRequired(response, protectedRequest, requirements, options, "VERITY_INVALID_PAYMENT_HEADER", error);
      return;
    }

    const verification = await facilitator.verify(paymentPayload, requirements);
    if (!verification.isValid) {
      sendPaymentRequired(
        response,
        protectedRequest,
        requirements,
        options,
        verification.invalidReason ?? "VERITY_PAYMENT_INVALID",
        verification.invalidMessage
      );
      return;
    }

    response.setHeader("verity-payment-verifier", options.verifier);
    if (options.stake) response.setHeader("verity-provider-stake", options.stake);
    await application(protectedRequest, response);
  };
}

async function resolvePrice(price: PriceResolver, request: ProtectedRequest): Promise<string> {
  const value = typeof price === "function" ? await price(request) : price;
  if (!/^\d+$/.test(value) || BigInt(value) <= 0n) {
    throw new Error("VERITY_PRICE_INVALID: price must be a positive integer in the configured asset's smallest unit");
  }
  return value;
}

function sendPaymentRequired(
  response: ServerResponse,
  request: ProtectedRequest,
  requirements: PaymentRequirements,
  options: ProtectOptions,
  error?: string,
  detail?: unknown
): void {
  const paymentRequired: PaymentRequired = {
    x402Version: 2,
    ...(error ? { error } : {}),
    resource: {
      url: request.url,
      description: options.description ?? "Verity protected resource",
      mimeType: "application/json"
    },
    accepts: [requirements]
  };
  response.statusCode = 402;
  response.setHeader("content-type", "application/json");
  response.setHeader("cache-control", "private, no-store");
  response.setHeader("payment-required", encodePaymentRequiredHeader(paymentRequired));
  response.end(JSON.stringify({ ...paymentRequired, ...(detail instanceof Error ? { detail: detail.message } : {}) }));
}

function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}
