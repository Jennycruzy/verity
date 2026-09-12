import { config as loadDotenv } from "dotenv";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  createErc8004Registration,
  Erc8004IdentityRegistryClient,
  normalizeErc8004AgentId,
  normalizeErc8004Registry,
  parseErc8004EvmRegistry
} from "@verity/indexer";

loadDotenv({ path: fileURLToPath(new URL("../.env", import.meta.url)) });

const role = readRole(process.argv[2]);
const fields = role === "provider"
  ? {
    agentId: "GRAPH_FEEDBACK_PROVIDER_AGENT_ID",
    privateKey: "GRAPH_FEEDBACK_PROVIDER_PRIVATE_KEY",
    endpoint: "GRAPH_FEEDBACK_PROVIDER_ENDPOINT",
    registrationTx: "GRAPH_FEEDBACK_PROVIDER_REGISTRATION_TX",
    agentUri: "GRAPH_FEEDBACK_PROVIDER_AGENT_URI",
    agentUriTx: "GRAPH_FEEDBACK_PROVIDER_AGENT_URI_TX"
  }
  : {
    agentId: "GRAPH_FEEDBACK_BUYER_AGENT_ID",
    privateKey: "GRAPH_FEEDBACK_BUYER_PRIVATE_KEY",
    endpoint: "GRAPH_FEEDBACK_BUYER_ENDPOINT",
    registrationTx: "GRAPH_FEEDBACK_BUYER_REGISTRATION_TX",
    agentUri: "GRAPH_FEEDBACK_BUYER_AGENT_URI",
    agentUriTx: "GRAPH_FEEDBACK_BUYER_AGENT_URI_TX"
  };

const envPath = fileURLToPath(new URL("../.env", import.meta.url));
const provider = parseErc8004EvmRegistry(required("GRAPH_FEEDBACK_IDENTITY_REGISTRY"));
const rpcUrl = requiredUrl("GRAPH_FEEDBACK_RPC_URL");
const endpoint = requiredUrl(fields.endpoint);
const privateKey = required(fields.privateKey);
const existingAgentId = optional(fields.agentId);
const existingRegistrationTx = optional(fields.registrationTx);
if (Boolean(existingAgentId) !== Boolean(existingRegistrationTx)) {
  throw new Error(`VERITY_GRAPH_AGENT_RESUME_INVALID: ${fields.agentId} and ${fields.registrationTx} must be set together`);
}

const client = new Erc8004IdentityRegistryClient({ rpcUrl, registry: provider.reference, privateKey });
try {
  let agentId = existingAgentId ? normalizeErc8004AgentId(existingAgentId) : undefined;
  let registrationTransactionId = existingRegistrationTx;
  if (!agentId) {
    const registered = await client.register();
    agentId = registered.agentId;
    registrationTransactionId = registered.transactionHash;
    await updateEnv({ [fields.agentId]: agentId, [fields.registrationTx]: registrationTransactionId });
  }

  const configuredUri = optional(fields.agentUri);
  const agentUri = configuredUri || createAgentUri(role, endpoint, provider.reference, agentId);
  const current = existingAgentId ? await client.readAgent(agentId) : undefined;
  let agentUriTransactionId = optional(fields.agentUriTx);
  if (current?.agentUri !== agentUri) {
    const updated = await client.setAgentUri(agentId, agentUri);
    agentUriTransactionId = updated.transactionHash;
    await updateEnv({ [fields.agentUri]: agentUri, [fields.agentUriTx]: agentUriTransactionId });
  } else if (!configuredUri) {
    await updateEnv({ [fields.agentUri]: agentUri });
  }

  const verified = await client.readAgent(agentId);
  if (verified.owner.toLowerCase() !== client.signerAddress.toLowerCase() || verified.agentUri !== agentUri) {
    throw new Error(`VERITY_GRAPH_AGENT_UNVERIFIED: ${role} identity did not match its signer and URI after registration`);
  }
  console.log(JSON.stringify({
    role,
    registry: provider.reference,
    chainId: provider.chainId,
    registryAddress: provider.address,
    agentId,
    signerAddress: client.signerAddress,
    endpoint,
    agentUri,
    registrationTransactionId,
    agentUriTransactionId,
    envPath
  }, null, 2));
} catch (error) {
  throw new Error(`VERITY_GRAPH_AGENT_REGISTRATION_FAILED: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
} finally {
  await client.close();
}

function createAgentUri(role: "provider" | "buyer", endpoint: string, registry: string, agentId: string): string {
  const registration = createErc8004Registration({
    name: role === "provider" ? `Verity Graph provider ${agentId}` : `Verity Graph buyer ${agentId}`,
    description: role === "provider"
      ? "A Verity provider whose objectively verifiable responses are scored from HCS dispute outcomes."
      : "A Verity buyer whose dispute honesty is scored from HCS adjudication outcomes.",
    services: [{ name: "web", endpoint, version: "1" }],
    x402Support: role === "provider",
    active: true,
    registrations: [{ agentRegistry: registry, agentId }],
    supportedTrust: ["reputation", "crypto-economic"]
  });
  return `data:application/json;base64,${Buffer.from(JSON.stringify(registration), "utf8").toString("base64")}`;
}

async function updateEnv(values: Readonly<Record<string, string>>): Promise<void> {
  const source = await readFile(envPath, "utf8");
  let updated = source;
  for (const [name, value] of Object.entries(values)) updated = replaceEnvValue(updated, name, value);
  await writeFile(envPath, updated, "utf8");
}

function readRole(value: string | undefined): "provider" | "buyer" {
  if (value === "provider" || value === "buyer") return value;
  throw new Error("Usage: npm run register:graph-agent -- <provider|buyer>");
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`VERITY_CONFIG_MISSING: ${name} is required; set it in .env`);
  return value;
}

function requiredUrl(name: string): string {
  const value = required(name);
  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    throw new Error(`VERITY_CONFIG_INVALID: ${name} must be an absolute URL`, { cause: error });
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`VERITY_CONFIG_INVALID: ${name} must use HTTP(S)`);
  return url.toString();
}

function optional(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function replaceEnvValue(source: string, name: string, value: string): string {
  const pattern = new RegExp(`^${name}=.*$`, "m");
  if (!pattern.test(source)) throw new Error(`VERITY_ENV_FIELD_MISSING: ${name} is missing from .env`);
  return source.replace(pattern, `${name}=${value}`);
}
