import { normalizeWorldProofMode, type WorldIdProofMode } from "@verity/agent";
import { readProviderConfig, type ProviderConfig } from "@verity/hedera";

export type ProviderKind = "fx" | "entity";

export interface BuyerReputationPolicyConfig {
  readonly endpoint: string;
  readonly apiKey: string;
  readonly queryFile: string;
  readonly minimumHonesty: number;
  readonly verifyUrl: string;
  readonly action: string;
  readonly proofMode: WorldIdProofMode;
}

export interface ProviderServiceConfig extends ProviderConfig {
  readonly kind: ProviderKind;
  readonly port: number;
  readonly fxPrice: string;
  readonly fxPair: string;
  readonly fxReferenceRate: string;
  readonly fxToleranceBps: number;
  readonly degradedFxRate?: string;
  readonly entityCachedPrice: string;
  readonly entityFreshPrice: string;
  readonly degradeMode: boolean;
  readonly erc8004?: {
    readonly publicUrl: string;
    readonly registry: string;
    readonly agentId: string;
  };
  readonly buyerReputation?: BuyerReputationPolicyConfig;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`VERITY_PROVIDER_CONFIG_MISSING: ${name} is required`);
  return value;
}

function positiveInteger(env: NodeJS.ProcessEnv, name: string): number {
  const value = Number(required(env, name));
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`VERITY_PROVIDER_CONFIG_INVALID: ${name} must be a positive integer`);
  return value;
}

function nonNegativeInteger(env: NodeJS.ProcessEnv, name: string): number {
  const value = Number(required(env, name));
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`VERITY_PROVIDER_CONFIG_INVALID: ${name} must be a non-negative integer`);
  return value;
}

function booleanValue(env: NodeJS.ProcessEnv, name: string): boolean {
  const value = required(env, name).toLowerCase();
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`VERITY_PROVIDER_CONFIG_INVALID: ${name} must be true or false`);
}

function amount(env: NodeJS.ProcessEnv, name: string): string {
  const value = required(env, name);
  if (!/^\d+$/.test(value) || BigInt(value) <= 0n) throw new Error(`VERITY_PROVIDER_CONFIG_INVALID: ${name} must be a positive integer amount`);
  return value;
}

export function readProviderServiceConfig(env: NodeJS.ProcessEnv = process.env): ProviderServiceConfig {
  const kind = required(env, "PROVIDER_KIND");
  if (kind !== "fx" && kind !== "entity") throw new Error("VERITY_PROVIDER_CONFIG_INVALID: PROVIDER_KIND must be fx or entity");
  const degradeMode = booleanValue(env, "DEGRADE_MODE");
  const degradedFxRate = env.DEGRADED_FX_RATE?.trim();
  if (degradeMode && !degradedFxRate) throw new Error("VERITY_PROVIDER_CONFIG_MISSING: DEGRADED_FX_RATE is required when DEGRADE_MODE is true");
  const publicUrl = env.VERITY_PROVIDER_PUBLIC_URL?.trim();
  const registry = env.VERITY_ERC8004_REGISTRY?.trim();
  const agentId = env.VERITY_ERC8004_AGENT_ID?.trim();
  const identityValues = [publicUrl, registry, agentId].filter(Boolean).length;
  if (identityValues !== 0 && identityValues !== 3) {
    throw new Error("VERITY_PROVIDER_CONFIG_INVALID: VERITY_PROVIDER_PUBLIC_URL, VERITY_ERC8004_REGISTRY, and VERITY_ERC8004_AGENT_ID must be set together");
  }
  if (publicUrl) {
    try {
      new URL(publicUrl);
    } catch (error) {
      throw new Error("VERITY_PROVIDER_CONFIG_INVALID: VERITY_PROVIDER_PUBLIC_URL must be an absolute URL", { cause: error });
    }
  }

  const buyerReputationFields = [
    env.VERITY_BUYER_REPUTATION_ENDPOINT?.trim(),
    env.VERITY_BUYER_REPUTATION_API_KEY?.trim(),
    env.VERITY_BUYER_REPUTATION_QUERY_FILE?.trim(),
    env.VERITY_BUYER_REPUTATION_MIN_HONESTY?.trim(),
    env.WORLD_ID_VERIFY_URL?.trim(),
    env.WORLD_ID_DISPUTE_ACTION?.trim()
  ].filter(Boolean).length;
  if (buyerReputationFields !== 0 && buyerReputationFields !== 6) {
    throw new Error("VERITY_PROVIDER_CONFIG_INVALID: buyer reputation admission requires endpoint, API key, query file, honesty threshold, World verify URL, and World action");
  }
  const buyerReputation = buyerReputationFields === 6 ? readBuyerReputationConfig(env) : undefined;

  return {
    ...readProviderConfig(env),
    kind,
    port: positiveInteger(env, "PORT"),
    fxPrice: amount(env, "FX_PRICE"),
    fxPair: required(env, "FX_PAIR"),
    fxReferenceRate: required(env, "FX_REFERENCE_RATE"),
    fxToleranceBps: nonNegativeInteger(env, "FX_TOLERANCE_BPS"),
    ...(degradedFxRate ? { degradedFxRate } : {}),
    entityCachedPrice: amount(env, "ENTITY_CACHED_PRICE"),
    entityFreshPrice: amount(env, "ENTITY_FRESH_PRICE"),
    degradeMode,
    ...(publicUrl && registry && agentId ? { erc8004: { publicUrl, registry, agentId } } : {}),
    ...(buyerReputation ? { buyerReputation } : {})
  };
}

function readBuyerReputationConfig(env: NodeJS.ProcessEnv): BuyerReputationPolicyConfig {
  const endpoint = requiredHttpUrl(env, "VERITY_BUYER_REPUTATION_ENDPOINT");
  const apiKey = required(env, "VERITY_BUYER_REPUTATION_API_KEY");
  const queryFile = required(env, "VERITY_BUYER_REPUTATION_QUERY_FILE");
  const minimumHonesty = Number(required(env, "VERITY_BUYER_REPUTATION_MIN_HONESTY"));
  if (!Number.isFinite(minimumHonesty) || minimumHonesty < 0 || minimumHonesty > 1) {
    throw new Error("VERITY_PROVIDER_CONFIG_INVALID: VERITY_BUYER_REPUTATION_MIN_HONESTY must be between 0 and 1");
  }
  const verifyUrl = requiredHttpUrl(env, "WORLD_ID_VERIFY_URL");
  const action = required(env, "WORLD_ID_DISPUTE_ACTION");
  return { endpoint, apiKey, queryFile, minimumHonesty, verifyUrl, action, proofMode: normalizeWorldProofMode(env.WORLD_ID_PROOF_MODE) };
}

function requiredHttpUrl(env: NodeJS.ProcessEnv, name: string): string {
  const value = required(env, name);
  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    throw new Error(`VERITY_PROVIDER_CONFIG_INVALID: ${name} must be an absolute HTTP(S) URL`, { cause: error });
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`VERITY_PROVIDER_CONFIG_INVALID: ${name} must be an absolute HTTP(S) URL`);
  }
  return url.toString();
}
