export const DEFAULT_MAX_HOLD_SECONDS = 91;

export interface RuntimeConfig {
  readonly facilitatorUrl: string;
  readonly network: string;
  readonly assetId: string;
  readonly payToAccountId: string;
  readonly clientAccountId: string;
  readonly clientPrivateKey: string;
  readonly mirrorNodeBaseUrl: string;
  readonly settlementTopicId: string;
  readonly disputeTopicId: string;
  readonly contentStoreBaseUrl: string;
  readonly hashscanBaseUrl: string;
  readonly requestTimeoutMs: number;
  readonly maxHoldSeconds: number;
}

export interface ProviderConfig {
  readonly facilitatorUrl: string;
  readonly network: string;
  readonly assetId: string;
  readonly payToAccountId: string;
  readonly requestTimeoutMs: number;
  readonly maxHoldSeconds: number;
}

export interface BuyerConfig {
  readonly facilitatorUrl: string;
  readonly network: string;
  readonly clientAccountId: string;
  readonly clientPrivateKey: string;
  readonly bondAssetId: string;
  readonly requestTimeoutMs: number;
  readonly maxHoldSeconds: number;
}

export interface SettlementConfig {
  readonly facilitatorUrl: string;
  readonly network: string;
  readonly assetId: string;
  readonly operatorAccountId: string;
  readonly operatorPrivateKey: string;
  readonly settlementTopicId: string;
  readonly disputeTopicId: string;
  readonly requestTimeoutMs: number;
  readonly maxHoldSeconds: number;
  readonly escrowContractId?: string;
  readonly escrowGas?: number;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`VERITY_CONFIG_MISSING: ${name} is required; set it in .env`);
  }
  return value;
}

function positiveInteger(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`VERITY_CONFIG_INVALID: ${name} must be a positive integer`);
  }
  return value;
}

function optionalPositiveInteger(env: NodeJS.ProcessEnv, name: string): number | undefined {
  const raw = env[name]?.trim();
  if (!raw) return undefined;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`VERITY_CONFIG_INVALID: ${name} must be a positive integer`);
  return value;
}

export function readRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  return {
    facilitatorUrl: required(env, "BLOCKY402_URL"),
    network: required(env, "HEDERA_NETWORK"),
    assetId: requiredHederaId(env, "HEDERA_ASSET_ID"),
    payToAccountId: requiredHederaId(env, "HEDERA_PAY_TO_ACCOUNT_ID"),
    clientAccountId: requiredHederaId(env, "HEDERA_CLIENT_ACCOUNT_ID"),
    clientPrivateKey: required(env, "HEDERA_CLIENT_PRIVATE_KEY"),
    mirrorNodeBaseUrl: required(env, "MIRROR_NODE_BASE_URL"),
    settlementTopicId: required(env, "HCS_SETTLEMENT_TOPIC_ID"),
    disputeTopicId: required(env, "HCS_DISPUTE_TOPIC_ID"),
    contentStoreBaseUrl: required(env, "CONTENT_STORE_BASE_URL"),
    hashscanBaseUrl: required(env, "HASHSCAN_BASE_URL"),
    requestTimeoutMs: positiveInteger(env, "BLOCKY402_TIMEOUT_MS", 10_000),
    maxHoldSeconds: readMaxHoldSeconds(env)
  };
}

export function readDiscoveryConfig(env: NodeJS.ProcessEnv = process.env): Pick<RuntimeConfig, "facilitatorUrl" | "network"> {
  return {
    facilitatorUrl: required(env, "BLOCKY402_URL"),
    network: required(env, "HEDERA_NETWORK")
  };
}

export function readProviderConfig(env: NodeJS.ProcessEnv = process.env): ProviderConfig {
  return {
    facilitatorUrl: required(env, "BLOCKY402_URL"),
    network: required(env, "HEDERA_NETWORK"),
    assetId: requiredHederaId(env, "HEDERA_ASSET_ID"),
    payToAccountId: requiredHederaId(env, "HEDERA_PAY_TO_ACCOUNT_ID"),
    requestTimeoutMs: positiveInteger(env, "BLOCKY402_TIMEOUT_MS", 10_000),
    maxHoldSeconds: readMaxHoldSeconds(env)
  };
}

export function readBuyerConfig(env: NodeJS.ProcessEnv = process.env): BuyerConfig {
  const bondAssetId = env.VERITY_BOND_ASSET_ID?.trim() || "0.0.0";
  assertHederaId(bondAssetId, "VERITY_BOND_ASSET_ID");
  return {
    facilitatorUrl: required(env, "BLOCKY402_URL"),
    network: required(env, "HEDERA_NETWORK"),
    clientAccountId: requiredHederaId(env, "HEDERA_CLIENT_ACCOUNT_ID"),
    clientPrivateKey: required(env, "HEDERA_CLIENT_PRIVATE_KEY"),
    bondAssetId,
    requestTimeoutMs: positiveInteger(env, "BLOCKY402_TIMEOUT_MS", 10_000),
    maxHoldSeconds: readMaxHoldSeconds(env)
  };
}

export function readSettlementConfig(env: NodeJS.ProcessEnv = process.env): SettlementConfig {
  const escrowContractId = optionalHederaId(env, "VERITY_ESCROW_CONTRACT_ID");
  const escrowGas = optionalPositiveInteger(env, "VERITY_ESCROW_GAS");
  if (Boolean(escrowContractId) !== (escrowGas !== undefined)) {
    throw new Error("VERITY_CONFIG_INVALID: VERITY_ESCROW_CONTRACT_ID and VERITY_ESCROW_GAS must be set together");
  }
  return {
    facilitatorUrl: required(env, "BLOCKY402_URL"),
    network: required(env, "HEDERA_NETWORK"),
    assetId: requiredHederaId(env, "HEDERA_ASSET_ID"),
    operatorAccountId: requiredHederaId(env, "HEDERA_CLIENT_ACCOUNT_ID"),
    operatorPrivateKey: required(env, "HEDERA_CLIENT_PRIVATE_KEY"),
    settlementTopicId: required(env, "HCS_SETTLEMENT_TOPIC_ID"),
    disputeTopicId: required(env, "HCS_DISPUTE_TOPIC_ID"),
    requestTimeoutMs: positiveInteger(env, "BLOCKY402_TIMEOUT_MS", 10_000),
    maxHoldSeconds: readMaxHoldSeconds(env),
    ...(escrowContractId && escrowGas !== undefined ? { escrowContractId, escrowGas } : {})
  };
}

export function readMaxHoldSeconds(env: NodeJS.ProcessEnv = process.env): number {
  return positiveInteger(env, "VERITY_MAX_HOLD_SECONDS", DEFAULT_MAX_HOLD_SECONDS);
}

function requiredHederaId(env: NodeJS.ProcessEnv, name: string): string {
  const value = required(env, name);
  assertHederaId(value, name);
  return value;
}

function optionalHederaId(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name]?.trim();
  if (!value) return undefined;
  assertHederaId(value, name);
  return value;
}

function assertHederaId(value: string, name: string): void {
  if (!/^0\.0\.\d+$/.test(value)) throw new Error(`VERITY_CONFIG_INVALID: ${name} must use Hedera 0.0.N format`);
}
