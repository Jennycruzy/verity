export interface ContentServiceConfig {
  readonly port: number;
  readonly directory: string;
  readonly publicUrl: string;
  readonly maxBytes: number;
  readonly writeToken?: string;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`VERITY_CONTENT_CONFIG_MISSING: ${name} is required`);
  return value;
}

function positiveInteger(env: NodeJS.ProcessEnv, name: string): number {
  const value = Number(required(env, name));
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`VERITY_CONTENT_CONFIG_INVALID: ${name} must be a positive integer`);
  return value;
}

export function readContentServiceConfig(env: NodeJS.ProcessEnv = process.env): ContentServiceConfig {
  const writeToken = env.CONTENT_STORE_WRITE_TOKEN?.trim();
  if (env.CONTENT_STORE_WRITE_TOKEN !== undefined && !writeToken) {
    throw new Error("VERITY_CONTENT_CONFIG_INVALID: CONTENT_STORE_WRITE_TOKEN must be omitted or non-empty");
  }
  return {
    port: positiveInteger(env, "CONTENT_STORE_PORT"),
    directory: required(env, "CONTENT_STORE_DIR"),
    publicUrl: required(env, "CONTENT_STORE_PUBLIC_URL").replace(/\/$/, ""),
    maxBytes: positiveInteger(env, "CONTENT_STORE_MAX_BYTES"),
    ...(writeToken ? { writeToken } : {})
  };
}
