import "dotenv/config";
import { readFile, writeFile } from "node:fs/promises";
import { createHederaClient, deployVerityEscrow } from "@verity/hcs";

const envPath = ".env";
const network = required("HEDERA_NETWORK");
const accountId = required("HEDERA_CLIENT_ACCOUNT_ID");
const privateKey = required("HEDERA_CLIENT_PRIVATE_KEY");
const artifactPath = process.env.VERITY_ESCROW_ARTIFACT_PATH?.trim()
  || "artifacts/forge/VerityBondEscrow.sol/VerityBondEscrow.json";
const minimumBond = positiveSafeInteger("VERITY_ESCROW_MINIMUM_BOND");
const gas = positiveSafeInteger("VERITY_ESCROW_GAS");
if (process.env.VERITY_ESCROW_CONTRACT_ID?.trim()) {
  throw new Error("VERITY_CONTRACT_ALREADY_CONFIGURED: remove VERITY_ESCROW_CONTRACT_ID only if a new deployment is intentional");
}

const artifact = await readArtifact(artifactPath);
const bytecode = hexBytes(artifact.bytecode.object);
const client = createHederaClient(network, accountId, privateKey);

try {
  const deployment = await deployVerityEscrow(client, bytecode, minimumBond, gas);
  const envText = await readFile(envPath, "utf8");
  await writeFile(envPath, replaceEnvValue(envText, "VERITY_ESCROW_CONTRACT_ID", deployment.contractId), "utf8");
  console.log(JSON.stringify({ network, deployment, envPath }, null, 2));
} finally {
  client.close();
}

async function readArtifact(path: string): Promise<{ bytecode: { object: string } }> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`VERITY_CONTRACT_ARTIFACT_INVALID: cannot read ${path}`, { cause: error });
  }
  if (!value || typeof value !== "object") throw new Error(`VERITY_CONTRACT_ARTIFACT_SCHEMA: ${path} is not an object`);
  const bytecode = (value as { bytecode?: unknown }).bytecode;
  if (!bytecode || typeof bytecode !== "object" || typeof (bytecode as { object?: unknown }).object !== "string") {
    throw new Error(`VERITY_CONTRACT_ARTIFACT_SCHEMA: ${path} has no bytecode.object`);
  }
  return { bytecode: bytecode as { object: string } };
}

function hexBytes(value: string): Uint8Array {
  const normalized = value.startsWith("0x") ? value.slice(2) : value;
  if (normalized.length === 0 || normalized.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(normalized)) {
    throw new Error("VERITY_CONTRACT_BYTECODE_INVALID: bytecode must be an even-length hexadecimal string");
  }
  const bytes = new Uint8Array(normalized.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(normalized.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function positiveSafeInteger(name: string): number {
  const value = Number(required(name));
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`VERITY_CONFIG_INVALID: ${name} must be a positive safe integer`);
  return value;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`VERITY_CONFIG_MISSING: ${name} is required; set it in .env`);
  return value;
}

function replaceEnvValue(source: string, name: string, value: string): string {
  const pattern = new RegExp(`^${name}=.*$`, "m");
  if (!pattern.test(source)) throw new Error(`VERITY_ENV_FIELD_MISSING: ${name} is missing from .env`);
  return source.replace(pattern, `${name}=${value}`);
}
