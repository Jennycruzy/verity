import { config as loadDotenv } from "dotenv";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { HttpContentStore } from "@verity/content";
import { createSettlementCoordinator, type SettlementCoordinator } from "@verity/settlement";
import { buy } from "@verity/sdk";
import { RULE_IDS, type ContentReference, type RuleId } from "@verity/types";
import type { PaymentPayload, PaymentRequirements, SettleResponse } from "@x402/core/types";

loadDotenv({ path: fileURLToPath(new URL("../.env", import.meta.url)) });

const rule = readRule(required("VERITY_DEMO_RULE"));
const badProviderUrl = required("VERITY_DEMO_BAD_PROVIDER_URL");
const referenceProviderUrls = readUrls(required("VERITY_DEMO_REFERENCE_PROVIDER_URLS"));
const checkerIds = readCheckerIds(required("DISPUTE_CHECKERS_JSON"));
if (referenceProviderUrls.length !== checkerIds.length) {
  throw new Error(`VERITY_DISPUTE_DEMO_PROVIDER_COUNT: provide ${checkerIds.length} reference provider URLs for the configured checker set`);
}

const disputeUrl = required("VERITY_DISPUTE_URL");
const disputeHealthUrl = process.env.VERITY_DISPUTE_HEALTH_URL?.trim() || deriveHealthUrl(disputeUrl);
const contentStore = new HttpContentStore(required("CONTENT_STORE_BASE_URL"), fetch, {
  ...(process.env.CONTENT_STORE_WRITE_TOKEN?.trim() ? { writeToken: process.env.CONTENT_STORE_WRITE_TOKEN.trim() } : {})
});
const providerId = requiredAny(["VERITY_DEMO_BAD_PROVIDER_ID", "VERITY_DEMO_PROVIDER_ID", "VERITY_PROVIDER_ID"]);
const buyerId = requiredAny(["VERITY_DEMO_BUYER_ID", "HEDERA_CLIENT_ACCOUNT_ID"]);
const buyerHumanRoot = process.env.VERITY_DEMO_BUYER_ROOT?.trim();
const providerRoot = requiredAny(["VERITY_DEMO_PROVIDER_ROOT", "VERITY_PROVIDER_ROOT"]);
const bond = required("VERITY_DEMO_BOND");
const identityProof = parseJsonObject(required("VERITY_DEMO_IDENTITY_PROOF_JSON"), "VERITY_DEMO_IDENTITY_PROOF_JSON");
const identitySignal = required("VERITY_DEMO_IDENTITY_SIGNAL");
const maxPrice = process.env.VERITY_DEMO_MAX_PRICE?.trim() || undefined;

await assertHealthy(disputeHealthUrl, "dispute service");
await assertHealthy(badProviderUrl, "degraded provider");
for (const [index, url] of referenceProviderUrls.entries()) {
  await assertHealthy(url, `reference provider ${index + 1}`);
}

const coordinator = createSettlementCoordinator();
try {
  const providerResponses: ContentReference[] = [];
  for (const [index, url] of referenceProviderUrls.entries()) {
    const requestId = randomUUID();
    const providerResponse = await buy(url, {
      evaluate: rule,
      ...(maxPrice ? { maxPrice } : {}),
      requestId,
      settle: (paymentPayload, paymentRequirements) => settleReference(
        coordinator,
        requestId,
        `verity-reference-${index + 1}`,
        paymentPayload,
        paymentRequirements
      )
    });
    if (providerResponse.verdict.verdict !== "accept") {
      throw new Error(`VERITY_DISPUTE_DEMO_REFERENCE_REJECTED: ${url} returned ${providerResponse.verdict.reasonCode}`);
    }
    const reference = await contentStore.putJson(providerResponse.data);
    providerResponses.push(reference);
    console.log(JSON.stringify({
      kind: "reference",
      index: index + 1,
      requestId,
      providerUrl: url,
      responseHash: reference.sha256,
      settlement: providerResponse.settlement
    }));
  }

  const disputeId = randomUUID();
  const requestId = randomUUID();
  const result = await buy(badProviderUrl, {
    evaluate: rule,
    ...(maxPrice ? { maxPrice } : {}),
    bond,
    disputeUrl,
    disputeId,
    requestId,
    providerId,
    buyerId,
    ...(buyerHumanRoot ? { humanRoot: buyerHumanRoot } : {}),
    providerRoot,
    identityProof,
    identitySignal,
    providerResponses,
    contentStore,
    settle: async () => {
      throw new Error("VERITY_DISPUTE_DEMO_PROVIDER_ACCEPTED: degraded provider returned a response accepted by the published rule");
    }
  });

  if (result.verdict.verdict !== "reject" || !result.disputeId || !result.bondTransactionId) {
    throw new Error("VERITY_DISPUTE_DEMO_RESULT_INVALID: dispute submission did not return a rejected bonded result");
  }
  console.log(JSON.stringify({
    kind: "dispute",
    disputeId: result.disputeId,
    requestId,
    verdict: result.verdict,
    bondTransactionId: result.bondTransactionId,
    dispute: result.dispute
  }, null, 2));
} finally {
  coordinator.close();
}

async function settleReference(
  coordinator: SettlementCoordinator,
  requestId: string,
  providerId: string,
  paymentPayload: PaymentPayload,
  paymentRequirements: PaymentRequirements
): Promise<SettleResponse> {
  const outcome = await coordinator.settleAccepted({
    requestId,
    providerId,
    buyerId,
    ruleId: rule,
    paymentPayload,
    paymentRequirements
  });
  if (!outcome.transactionId) throw new Error(`VERITY_DISPUTE_DEMO_SETTLEMENT_MISSING: ${requestId} returned no transaction ID`);
  return { success: true, transaction: outcome.transactionId, network: paymentRequirements.network };
}

function readRule(value: string): RuleId {
  if (value === RULE_IDS.fxRate || value === RULE_IDS.entityCanonical) return value;
  throw new Error(`VERITY_DISPUTE_DEMO_RULE_UNKNOWN: ${value}`);
}

function readUrls(raw: string): readonly string[] {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new Error("VERITY_DISPUTE_DEMO_URLS_JSON: VERITY_DEMO_REFERENCE_PROVIDER_URLS was not valid JSON", { cause: error });
  }
  if (!Array.isArray(value) || value.length < 3 || value.length % 2 === 0 || value.some((entry) => typeof entry !== "string")) {
    throw new Error("VERITY_DISPUTE_DEMO_URLS_SCHEMA: provide an odd JSON array of at least three provider URLs");
  }
  const urls = value.map((entry) => validateUrl(entry, "VERITY_DISPUTE_DEMO_PROVIDER_URL_INVALID"));
  if (new Set(urls).size !== urls.length) throw new Error("VERITY_DISPUTE_DEMO_URLS_DUPLICATE: reference provider URLs must be unique");
  return urls;
}

function readCheckerIds(raw: string): readonly string[] {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new Error("VERITY_DISPUTE_DEMO_CHECKERS_JSON: DISPUTE_CHECKERS_JSON was not valid JSON", { cause: error });
  }
  if (!Array.isArray(value) || value.length < 3 || value.length % 2 === 0) {
    throw new Error("VERITY_DISPUTE_DEMO_CHECKERS_SCHEMA: provide an odd checker array of at least three entries");
  }
  const ids = value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`VERITY_DISPUTE_DEMO_CHECKERS_SCHEMA: checker ${index} is not an object`);
    }
    const id = (entry as { id?: unknown }).id;
    if (typeof id !== "string" || !id.trim()) throw new Error(`VERITY_DISPUTE_DEMO_CHECKERS_SCHEMA: checker ${index} has no ID`);
    return id.trim();
  });
  if (new Set(ids).size !== ids.length) throw new Error("VERITY_DISPUTE_DEMO_CHECKERS_DUPLICATE: checker IDs must be unique");
  return ids;
}

async function assertHealthy(url: string, label: string): Promise<void> {
  const healthUrl = label === "dispute service" ? validateUrl(url, "VERITY_DISPUTE_HEALTH_URL_INVALID") : deriveHealthUrl(validateUrl(url, "VERITY_DISPUTE_DEMO_PROVIDER_URL_INVALID"));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(healthUrl, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  } catch (error) {
    throw new Error(`VERITY_DISPUTE_DEMO_HEALTH_FAILED: ${label} is not healthy at ${healthUrl}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  } finally {
    clearTimeout(timeout);
  }
}

function deriveHealthUrl(value: string): string {
  const url = new URL(value);
  url.pathname = "/health";
  url.search = "";
  url.hash = "";
  return url.toString();
}

function validateUrl(value: string, code: string): string {
  const normalized = value.trim();
  try {
    const url = new URL(normalized);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("unsupported protocol");
  } catch (error) {
    throw new Error(`${code}: use an absolute HTTP(S) URL`, { cause: error });
  }
  return normalized;
}

function parseJsonObject(raw: string, name: string): Readonly<Record<string, unknown>> {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new Error(`VERITY_CONFIG_INVALID: ${name} must contain valid JSON`, { cause: error });
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`VERITY_CONFIG_INVALID: ${name} must contain a JSON object`);
  return value as Readonly<Record<string, unknown>>;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`VERITY_CONFIG_MISSING: ${name} is required; set it in .env`);
  return value;
}

function requiredAny(names: readonly string[]): string {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  throw new Error(`VERITY_CONFIG_MISSING: set one of ${names.join(", ")}`);
}
