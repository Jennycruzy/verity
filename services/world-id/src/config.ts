import { normalizeWorldProofMode, type WorldIdProofMode } from "@verity/agent";

export interface WorldIdServiceConfig {
  readonly port: number;
  readonly appId: string;
  readonly rpId: string;
  readonly signingKeyHex: string;
  readonly verifyUrl: string;
  readonly allowedActions: readonly string[];
  readonly environment: "production" | "staging" | "sandbox";
  readonly proofMode: WorldIdProofMode;
}

export function readWorldIdServiceConfig(env: NodeJS.ProcessEnv = process.env): WorldIdServiceConfig {
  const allowedActions = required(env, "WORLD_ID_ALLOWED_ACTIONS").split(",").map((value) => value.trim()).filter(Boolean);
  if (allowedActions.length === 0) throw new Error("VERITY_WORLD_CONFIG_INVALID: WORLD_ID_ALLOWED_ACTIONS must contain an action");
  const environment = env.WORLD_ID_ENVIRONMENT?.trim() || "production";
  if (environment !== "production" && environment !== "staging" && environment !== "sandbox") {
    throw new Error("VERITY_WORLD_CONFIG_INVALID: WORLD_ID_ENVIRONMENT must be production, staging, or sandbox");
  }
  const signingKeyHex = required(env, "WORLD_ID_SIGNING_KEY");
  if (!/^0x[0-9a-fA-F]{64}$/.test(signingKeyHex)) throw new Error("VERITY_WORLD_CONFIG_INVALID: WORLD_ID_SIGNING_KEY must be a 32-byte 0x-prefixed hex key");
  const appId = required(env, "WORLD_ID_APP_ID");
  const rpId = required(env, "WORLD_ID_RP_ID");
  if (!/^app_/.test(appId) || !/^rp_/.test(rpId)) throw new Error("VERITY_WORLD_CONFIG_INVALID: WORLD_ID_APP_ID and WORLD_ID_RP_ID must use their portal prefixes");
  const verifyUrl = requiredUrl(env, "WORLD_ID_VERIFY_URL");
  return {
    port: positiveInteger(env, "WORLD_ID_PORT"),
    appId,
    rpId,
    signingKeyHex,
    verifyUrl,
    allowedActions,
    environment,
    proofMode: normalizeWorldProofMode(env.WORLD_ID_PROOF_MODE)
  };
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`VERITY_WORLD_CONFIG_MISSING: ${name} is required`);
  return value;
}

function positiveInteger(env: NodeJS.ProcessEnv, name: string): number {
  const value = Number(required(env, name));
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`VERITY_WORLD_CONFIG_INVALID: ${name} must be a positive integer`);
  return value;
}

function requiredUrl(env: NodeJS.ProcessEnv, name: string): string {
  const value = required(env, name);
  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    throw new Error(`VERITY_WORLD_CONFIG_INVALID: ${name} must be an absolute HTTP(S) URL`, { cause: error });
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error(`VERITY_WORLD_CONFIG_INVALID: ${name} must be an absolute HTTP(S) URL`);
  return url.toString();
}
