import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { Blocky402Client, discoverHederaCapability, readBuyerConfig } from "@verity/hedera";
import type { Network, PaymentRequired, PaymentRequirements } from "@x402/core/types";

const config = readBuyerConfig();
const amount = required("HOLD_WINDOW_AMOUNT");
const payTo = required("HOLD_WINDOW_PAY_TO");
const resourceUrl = required("HOLD_WINDOW_RESOURCE_URL");
const maximumDelaySeconds = positiveInteger("HOLD_WINDOW_MAX_DELAY_SECONDS");
const timeoutSeconds = positiveInteger("HOLD_WINDOW_PAYMENT_TIMEOUT_SECONDS");
const facilitator = new Blocky402Client(config.facilitatorUrl, { requestTimeoutMs: config.requestTimeoutMs });
const capability = await discoverHederaCapability(facilitator, config.network);

const records: Attempt[] = [];
let lowerSuccessfulDelay = -1;
let upperFailedDelay = maximumDelaySeconds + 1;

while (upperFailedDelay - lowerSuccessfulDelay > 1) {
  const delaySeconds = Math.floor((lowerSuccessfulDelay + upperFailedDelay) / 2);
  const attempt = await settleAfterDelay(delaySeconds);
  records.push(attempt);
  if (attempt.success) {
    lowerSuccessfulDelay = delaySeconds;
  } else {
    upperFailedDelay = delaySeconds;
  }
}

const result = {
  measuredAt: new Date().toISOString(),
  network: config.network,
  x402Version: capability.x402Version,
  feePayer: capability.feePayer,
  lowerSuccessfulDelay,
  upperFailedDelay: upperFailedDelay > maximumDelaySeconds ? null : upperFailedDelay,
  safetyMarginSeconds: positiveInteger("HOLD_WINDOW_SAFETY_MARGIN_SECONDS"),
  recommendedMaximumHoldSeconds: upperFailedDelay > maximumDelaySeconds ? null : Math.max(0, upperFailedDelay - positiveInteger("HOLD_WINDOW_SAFETY_MARGIN_SECONDS")),
  attempts: records
};

await mkdir("artifacts", { recursive: true });
await writeFile("artifacts/hold-window.json", `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(JSON.stringify(result, null, 2));

async function settleAfterDelay(delaySeconds: number): Promise<Attempt> {
  const requirements: PaymentRequirements = {
    scheme: capability.scheme,
    network: capability.network as Network,
    amount,
    payTo,
    maxTimeoutSeconds: timeoutSeconds,
    asset: required("HEDERA_ASSET_ID"),
    extra: { feePayer: capability.feePayer }
  };
  const [{ x402Client }, { ExactHederaScheme, PrivateKey, createClientHederaSigner }] = await Promise.all([
    import("@x402/core/client"),
    import("@x402/hedera")
  ]);
  const signer = createClientHederaSigner(config.clientAccountId, PrivateKey.fromString(config.clientPrivateKey), { network: config.network });
  const client = new x402Client().setSpendControls(false).register(config.network as Network, new ExactHederaScheme(signer));
  const paymentRequired: PaymentRequired = { x402Version: 2, resource: { url: resourceUrl, description: "Verity hold-window measurement", mimeType: "application/json" }, accepts: [requirements] };
  const paymentPayload = await client.createPaymentPayload(paymentRequired);
  const verified = await facilitator.verify(paymentPayload, requirements);
  if (!verified.isValid) throw new Error(`VERITY_HOLD_VERIFY_FAILED: ${verified.invalidReason ?? "unknown"}`);
  await wait(delaySeconds);
  const settled = await facilitator.settle(paymentPayload, requirements);
  if (!settled.success && !isExpiryFailure(settled.errorReason, settled.errorMessage)) {
    throw new Error(`VERITY_HOLD_UNRELATED_FAILURE: ${settled.errorReason ?? "unknown"} ${settled.errorMessage ?? ""}`.trim());
  }
  return {
    delaySeconds,
    success: settled.success,
    transactionId: settled.transaction,
    errorReason: settled.errorReason,
    errorMessage: settled.errorMessage
  };
}

function isExpiryFailure(reason: string | undefined, message: string | undefined): boolean {
  return /expir|valid.*(start|before)|transaction.*(id|expired)/i.test(`${reason ?? ""} ${message ?? ""}`);
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`VERITY_CONFIG_MISSING: ${name} is required; see docs/HOLD-WINDOW.md`);
  return value;
}

function positiveInteger(name: string): number {
  const value = Number(required(name));
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`VERITY_CONFIG_INVALID: ${name} must be a positive integer`);
  return value;
}

async function wait(seconds: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, seconds * 1000));
}

interface Attempt {
  readonly delaySeconds: number;
  readonly success: boolean;
  readonly transactionId?: string;
  readonly errorReason?: string;
  readonly errorMessage?: string;
}
