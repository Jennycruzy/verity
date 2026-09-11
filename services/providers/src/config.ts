import { readProviderConfig, type ProviderConfig } from "@verity/hedera";

export type ProviderKind = "fx" | "entity";

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

  return {
    ...readProviderConfig(env),
    kind,
    port: positiveInteger(env, "PORT"),
    fxPrice: amount(env, "FX_PRICE"),
    fxPair: required(env, "FX_PAIR"),
    fxReferenceRate: required(env, "FX_REFERENCE_RATE"),
    fxToleranceBps: positiveInteger(env, "FX_TOLERANCE_BPS"),
    ...(degradedFxRate ? { degradedFxRate } : {}),
    entityCachedPrice: amount(env, "ENTITY_CACHED_PRICE"),
    entityFreshPrice: amount(env, "ENTITY_FRESH_PRICE"),
    degradeMode
  };
}
