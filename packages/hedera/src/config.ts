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
}

export interface ProviderConfig {
  readonly facilitatorUrl: string;
  readonly network: string;
  readonly assetId: string;
  readonly payToAccountId: string;
  readonly requestTimeoutMs: number;
}

export interface BuyerConfig {
  readonly facilitatorUrl: string;
  readonly network: string;
  readonly clientAccountId: string;
  readonly clientPrivateKey: string;
  readonly requestTimeoutMs: number;
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

export function readRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  return {
    facilitatorUrl: required(env, "BLOCKY402_URL"),
    network: required(env, "HEDERA_NETWORK"),
    assetId: required(env, "HEDERA_ASSET_ID"),
    payToAccountId: required(env, "HEDERA_PAY_TO_ACCOUNT_ID"),
    clientAccountId: required(env, "HEDERA_CLIENT_ACCOUNT_ID"),
    clientPrivateKey: required(env, "HEDERA_CLIENT_PRIVATE_KEY"),
    mirrorNodeBaseUrl: required(env, "MIRROR_NODE_BASE_URL"),
    settlementTopicId: required(env, "HCS_SETTLEMENT_TOPIC_ID"),
    disputeTopicId: required(env, "HCS_DISPUTE_TOPIC_ID"),
    contentStoreBaseUrl: required(env, "CONTENT_STORE_BASE_URL"),
    hashscanBaseUrl: required(env, "HASHSCAN_BASE_URL"),
    requestTimeoutMs: positiveInteger(env, "BLOCKY402_TIMEOUT_MS", 10_000)
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
    assetId: required(env, "HEDERA_ASSET_ID"),
    payToAccountId: required(env, "HEDERA_PAY_TO_ACCOUNT_ID"),
    requestTimeoutMs: positiveInteger(env, "BLOCKY402_TIMEOUT_MS", 10_000)
  };
}

export function readBuyerConfig(env: NodeJS.ProcessEnv = process.env): BuyerConfig {
  return {
    facilitatorUrl: required(env, "BLOCKY402_URL"),
    network: required(env, "HEDERA_NETWORK"),
    clientAccountId: required(env, "HEDERA_CLIENT_ACCOUNT_ID"),
    clientPrivateKey: required(env, "HEDERA_CLIENT_PRIVATE_KEY"),
    requestTimeoutMs: positiveInteger(env, "BLOCKY402_TIMEOUT_MS", 10_000)
  };
}

export function readSettlementConfig(env: NodeJS.ProcessEnv = process.env): SettlementConfig {
  return {
    facilitatorUrl: required(env, "BLOCKY402_URL"),
    network: required(env, "HEDERA_NETWORK"),
    assetId: required(env, "HEDERA_ASSET_ID"),
    operatorAccountId: required(env, "HEDERA_CLIENT_ACCOUNT_ID"),
    operatorPrivateKey: required(env, "HEDERA_CLIENT_PRIVATE_KEY"),
    settlementTopicId: required(env, "HCS_SETTLEMENT_TOPIC_ID"),
    disputeTopicId: required(env, "HCS_DISPUTE_TOPIC_ID"),
    requestTimeoutMs: positiveInteger(env, "BLOCKY402_TIMEOUT_MS", 10_000)
  };
}
