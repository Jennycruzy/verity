import "dotenv/config";
import { readFile, writeFile } from "node:fs/promises";
import { FileRootStore, normalizeWorldProofMode, WorldIdVerifier } from "@verity/agent";

const envPath = ".env";
const providerId = required("VERITY_PROVIDER_ID");
const verifyUrl = required("WORLD_ID_VERIFY_URL");
const action = required("WORLD_ID_PROVIDER_ACTION");
const proofMode = normalizeWorldProofMode(process.env.WORLD_ID_PROOF_MODE);
const signal = required("VERITY_PROVIDER_IDENTITY_SIGNAL");
const proof = parseProof(required("VERITY_PROVIDER_IDENTITY_PROOF_JSON"));
const rootStorePath = required("VERITY_PROVIDER_ROOT_STORE_PATH");
if (process.env.VERITY_PROVIDER_ROOT?.trim()) {
  throw new Error("VERITY_PROVIDER_ROOT_ALREADY_CONFIGURED: clear the provider root only if a new registration is intentional");
}

const verifier = new WorldIdVerifier({ verifyUrl, action, proofMode }, new FileRootStore(rootStorePath));
const verified = await verifier.verify(proof, signal);
const envText = await readFile(envPath, "utf8");
await writeFile(envPath, replaceEnvValue(envText, "VERITY_PROVIDER_ROOT", verified.root), "utf8");
console.log(JSON.stringify({ providerId, action, proofMode, root: verified.root, envPath }, null, 2));

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`VERITY_CONFIG_MISSING: ${name} is required; set it in .env`);
  return value;
}

function parseProof(raw: string): Readonly<Record<string, unknown>> {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new Error("VERITY_WORLD_ID_PROOF_JSON: provider proof was not valid JSON", { cause: error });
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("VERITY_WORLD_ID_PROOF_SCHEMA: provider proof must be a JSON object");
  }
  return value as Readonly<Record<string, unknown>>;
}

function replaceEnvValue(source: string, name: string, value: string): string {
  const pattern = new RegExp(`^${name}=.*$`, "m");
  if (!pattern.test(source)) throw new Error(`VERITY_ENV_FIELD_MISSING: ${name} is missing from .env`);
  return source.replace(pattern, `${name}=${value}`);
}
