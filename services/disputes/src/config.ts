export interface CheckerConfig {
  readonly id: string;
  readonly url: string;
}

export interface DisputeServiceConfig {
  readonly port: number;
  readonly maxBodyBytes: number;
  readonly checkerTimeoutMs: number;
  readonly checkers: readonly CheckerConfig[];
  readonly contentStoreBaseUrl: string;
  readonly rootStorePath: string;
  readonly providerTopicId: string;
  readonly disputeStoreDirectory: string;
  readonly worldVerifyUrl: string;
  readonly worldAction: string;
  readonly mirrorNodeBaseUrl: string;
  readonly escrowContractId: string;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`VERITY_DISPUTE_CONFIG_MISSING: ${name} is required`);
  return value;
}

function positiveInteger(env: NodeJS.ProcessEnv, name: string): number {
  const value = Number(required(env, name));
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`VERITY_DISPUTE_CONFIG_INVALID: ${name} must be a positive integer`);
  return value;
}

export function readDisputeServiceConfig(env: NodeJS.ProcessEnv = process.env): DisputeServiceConfig {
  const checkers = readCheckers(required(env, "DISPUTE_CHECKERS_JSON"));
  return {
    port: positiveInteger(env, "DISPUTE_PORT"),
    maxBodyBytes: positiveInteger(env, "DISPUTE_MAX_BODY_BYTES"),
    checkerTimeoutMs: positiveInteger(env, "DISPUTE_CHECKER_TIMEOUT_MS"),
    checkers,
    contentStoreBaseUrl: required(env, "CONTENT_STORE_BASE_URL"),
    rootStorePath: required(env, "VERITY_ROOT_STORE_PATH"),
    providerTopicId: required(env, "HCS_SETTLEMENT_TOPIC_ID"),
    disputeStoreDirectory: required(env, "DISPUTE_STORE_DIR"),
    worldVerifyUrl: required(env, "WORLD_ID_VERIFY_URL"),
    worldAction: required(env, "WORLD_ID_DISPUTE_ACTION"),
    mirrorNodeBaseUrl: required(env, "MIRROR_NODE_BASE_URL"),
    escrowContractId: required(env, "VERITY_ESCROW_CONTRACT_ID")
  };
}

function readCheckers(raw: string): readonly CheckerConfig[] {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new Error("VERITY_DISPUTE_CHECKERS_JSON: DISPUTE_CHECKERS_JSON was not valid JSON", { cause: error });
  }
  if (!Array.isArray(value) || value.length < 3 || value.length % 2 === 0) {
    throw new Error("VERITY_DISPUTE_CHECKERS_CONFIG: provide an odd number of at least three checkers");
  }
  const checkers = value.map((entry, index) => {
    if (!entry || typeof entry !== "object") throw new Error(`VERITY_DISPUTE_CHECKERS_CONFIG: checker ${index} is not an object`);
    const candidate = entry as { id?: unknown; url?: unknown };
    if (typeof candidate.id !== "string" || !candidate.id.trim() || typeof candidate.url !== "string" || !candidate.url.trim()) {
      throw new Error(`VERITY_DISPUTE_CHECKERS_CONFIG: checker ${index} requires id and url`);
    }
    return { id: candidate.id.trim(), url: candidate.url.trim() };
  });
  if (new Set(checkers.map((checker) => checker.id)).size !== checkers.length) {
    throw new Error("VERITY_DISPUTE_CHECKERS_CONFIG: checker IDs must be unique");
  }
  return checkers;
}
