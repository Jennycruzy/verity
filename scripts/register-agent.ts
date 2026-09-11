import "dotenv/config";
import { readFile, writeFile } from "node:fs/promises";
import { createHederaClient, createVerityEscrowClient } from "@verity/hcs";
import { erc8004AgentKey, normalizeErc8004AgentId, normalizeErc8004Registry } from "@verity/indexer";

const envPath = ".env";
const existingTransactionId = process.env.VERITY_PROVIDER_AGENT_REGISTRATION_TX?.trim();
if (existingTransactionId) {
  throw new Error("VERITY_AGENT_ALREADY_REGISTERED: clear VERITY_PROVIDER_AGENT_REGISTRATION_TX only for a deliberate new contract deployment");
}

const network = required("HEDERA_NETWORK");
const accountId = required("HEDERA_CLIENT_ACCOUNT_ID");
const privateKey = required("HEDERA_CLIENT_PRIVATE_KEY");
const providerId = required("VERITY_PROVIDER_ID");
const providerRoot = required("VERITY_PROVIDER_ROOT");
const endpoint = requiredUrl("VERITY_PROVIDER_PUBLIC_URL");
const agentRegistry = normalizeErc8004Registry(required("VERITY_ERC8004_REGISTRY"));
const agentId = normalizeErc8004AgentId(required("VERITY_ERC8004_AGENT_ID"));
const agentKey = erc8004AgentKey({ agentRegistry, agentId });
const contractId = required("VERITY_ESCROW_CONTRACT_ID");
const gas = positiveInteger("VERITY_ESCROW_GAS");

const client = createHederaClient(network, accountId, privateKey);
try {
  const result = await createVerityEscrowClient(client, contractId, gas).registerAgent(agentKey, providerRoot, endpoint);
  const envText = await readFile(envPath, "utf8");
  await writeFile(envPath, replaceEnvValue(envText, "VERITY_PROVIDER_AGENT_REGISTRATION_TX", result.transactionId), "utf8");
  console.log(JSON.stringify({ providerId, agentRegistry, agentId, agentKey, endpoint, transactionId: result.transactionId, envPath }, null, 2));
} catch (error) {
  throw new Error(`VERITY_AGENT_REGISTRATION_FAILED: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
} finally {
  client.close();
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`VERITY_CONFIG_MISSING: ${name} is required; set it in .env`);
  return value;
}

function requiredUrl(name: string): string {
  const value = required(name);
  try {
    new URL(value);
  } catch (error) {
    throw new Error(`VERITY_CONFIG_INVALID: ${name} must be an absolute URL`, { cause: error });
  }
  return value;
}

function positiveInteger(name: string): number {
  const value = Number(required(name));
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`VERITY_CONFIG_INVALID: ${name} must be a positive safe integer`);
  return value;
}

function replaceEnvValue(source: string, name: string, value: string): string {
  const pattern = new RegExp(`^${name}=.*$`, "m");
  if (!pattern.test(source)) throw new Error(`VERITY_ENV_FIELD_MISSING: ${name} is missing from .env`);
  return source.replace(pattern, `${name}=${value}`);
}
