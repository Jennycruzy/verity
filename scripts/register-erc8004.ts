import { config as loadDotenv } from "dotenv";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  createErc8004AgentDataUri,
  Erc8004IdentityRegistryClient,
  normalizeErc8004AgentId,
  parseErc8004EvmRegistry
} from "@verity/indexer";

loadDotenv({ path: fileURLToPath(new URL("../.env", import.meta.url)) });

const envPath = fileURLToPath(new URL("../.env", import.meta.url));
const providerId = required("VERITY_PROVIDER_ID");
const rpcUrl = required("VERITY_ERC8004_RPC_URL");
const registry = parseErc8004EvmRegistry(required("VERITY_ERC8004_REGISTRY"));
const privateKey = required("HEDERA_PROVIDER_PRIVATE_KEY");
const publicUrl = requiredUrl("VERITY_PROVIDER_PUBLIC_URL");
const kind = readKind(process.env.PROVIDER_KIND?.trim() || "fx");
const customUri = process.env.VERITY_ERC8004_AGENT_URI?.trim();
const existingAgentId = process.env.VERITY_ERC8004_AGENT_ID?.trim();
const existingRegistrationTx = process.env.VERITY_ERC8004_REGISTRATION_TX?.trim();

if (Boolean(existingAgentId) !== Boolean(existingRegistrationTx)) {
  throw new Error("VERITY_ERC8004_RESUME_INVALID: VERITY_ERC8004_AGENT_ID and VERITY_ERC8004_REGISTRATION_TX must be set together");
}

const client = new Erc8004IdentityRegistryClient({ rpcUrl, registry: registry.reference, privateKey });
try {
  if (client.registryReference !== registry.reference) {
    throw new Error("VERITY_ERC8004_REGISTRY_NORMALIZATION: registry reference changed during client setup");
  }

  let agentId = existingAgentId ? normalizeErc8004AgentId(existingAgentId) : undefined;
  let registrationTransactionId = existingRegistrationTx;
  if (!agentId) {
    const registered = await client.register();
    agentId = registered.agentId;
    registrationTransactionId = registered.transactionHash;
    await updateEnv({
      VERITY_ERC8004_REGISTRY: registry.reference,
      VERITY_ERC8004_AGENT_ID: agentId,
      VERITY_ERC8004_REGISTRATION_TX: registrationTransactionId
    });
  }

  const agentUri = customUri || createErc8004AgentDataUri({
    name: `Verity ${kind} provider ${providerId}`,
    description: kind === "fx" ? "An objectively verifiable foreign-exchange rate service." : "An objectively verifiable entity-resolution service.",
    publicUrl,
    registry: registry.reference,
    agentId,
    kind
  });
  const current = existingAgentId
    ? await client.readAgent(agentId)
    : { agentUri: "" };
  let uriTransactionId = process.env.VERITY_ERC8004_AGENT_URI_TX?.trim() || undefined;
  if (current.agentUri !== agentUri) {
    const updated = await client.setAgentUri(agentId, agentUri);
    uriTransactionId = updated.transactionHash;
    await updateEnv({ VERITY_ERC8004_AGENT_URI: agentUri, VERITY_ERC8004_AGENT_URI_TX: uriTransactionId });
  } else if (process.env.VERITY_ERC8004_AGENT_URI?.trim() !== agentUri) {
    await updateEnv({ VERITY_ERC8004_AGENT_URI: agentUri });
  }

  const verified = await client.readAgent(agentId);
  if (verified.owner.toLowerCase() !== client.signerAddress.toLowerCase() || verified.agentUri !== agentUri) {
    throw new Error("VERITY_ERC8004_REGISTRATION_UNVERIFIED: post-transaction registry state did not match the signer and URI");
  }
  console.log(JSON.stringify({
    providerId,
    registry: registry.reference,
    chainId: registry.chainId,
    registryAddress: registry.address,
    agentId,
    signerAddress: client.signerAddress,
    agentUri,
    registrationTransactionId,
    uriTransactionId,
    envPath
  }, null, 2));
} catch (error) {
  throw new Error(`VERITY_ERC8004_REGISTRATION_FAILED: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
} finally {
  await client.close();
}

async function updateEnv(values: Readonly<Record<string, string>>): Promise<void> {
  const source = await readFile(envPath, "utf8");
  let updated = source;
  for (const [name, value] of Object.entries(values)) updated = replaceEnvValue(updated, name, value);
  await writeFile(envPath, updated, "utf8");
}

function readKind(value: string): "fx" | "entity" {
  if (value === "fx" || value === "entity") return value;
  throw new Error("VERITY_PROVIDER_KIND_INVALID: PROVIDER_KIND must be fx or entity");
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
  return value;
}

function replaceEnvValue(source: string, name: string, value: string): string {
  const pattern = new RegExp(`^${name}=.*$`, "m");
  if (!pattern.test(source)) throw new Error(`VERITY_ENV_FIELD_MISSING: ${name} is missing from .env`);
  return source.replace(pattern, `${name}=${value}`);
}
