import "dotenv/config";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createHederaClient, HederaHcsPublisher } from "@verity/hcs";
import { MirrorStakeVerifier } from "@verity/disputes";
import { readTopicRecords } from "@verity/hcs";

const network = required("HEDERA_NETWORK");
const mirrorNodeBaseUrl = required("MIRROR_NODE_BASE_URL");
const providerTopicId = required("HCS_SETTLEMENT_TOPIC_ID");
const escrowContractId = required("VERITY_ESCROW_CONTRACT_ID");
const providerAccountId = required("HEDERA_PROVIDER_ACCOUNT_ID");
const providerPrivateKey = required("HEDERA_PROVIDER_PRIVATE_KEY");
const baseProviderId = required("VERITY_PROVIDER_ID");
const endpointProviderId = required("VERITY_DEMO_BAD_PROVIDER_ID");
const registryPath = required("VERITY_PROVIDER_REGISTRY_FILE");

if (baseProviderId === endpointProviderId) {
  throw new Error("VERITY_PROVIDER_ENDPOINT_ID_CONFLICT: degraded endpoint ID must differ from VERITY_PROVIDER_ID");
}

const registry = await readRegistry(registryPath);
const base = registry.find((entry) => entry.providerId === baseProviderId);
if (!base) throw new Error(`VERITY_PROVIDER_REGISTRY_MISSING: ${baseProviderId} is not present in ${registryPath}`);
if (!base.stakeTransactionId) throw new Error(`VERITY_PROVIDER_STAKE_TRANSACTION_MISSING: ${baseProviderId} has no stake transaction ID`);

const hcsRecords = await readTopicRecords(mirrorNodeBaseUrl, providerTopicId);
const existing = hcsRecords.find((record) => record.kind === "provider" && record.id === endpointProviderId);
if (existing) {
  throw new Error(`VERITY_PROVIDER_ENDPOINT_ALREADY_REGISTERED: ${endpointProviderId} already exists on HCS`);
}

await new MirrorStakeVerifier(mirrorNodeBaseUrl, escrowContractId).verify({
  transactionId: base.stakeTransactionId,
  providerRoot: base.providerRoot,
  providerAddress: base.providerAddress,
  amountTinybars: base.providerStakeAmount
});

const client = createHederaClient(network, providerAccountId, providerPrivateKey);
try {
  const hcsTransactionId = await new HederaHcsPublisher(client).publish(providerTopicId, {
    schema: "verity/hcs/v1",
    kind: "provider",
    id: endpointProviderId,
    recordedAt: new Date().toISOString(),
    payload: {
      providerId: endpointProviderId,
      providerRoot: base.providerRoot,
      providerStakeAmount: base.providerStakeAmount,
      providerAddress: base.providerAddress,
      stakeTransactionId: base.stakeTransactionId
    }
  });
  const next = [...registry, { ...base, providerId: endpointProviderId }];
  await mkdir(dirname(registryPath), { recursive: true });
  await writeFile(registryPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    providerId: endpointProviderId,
    backedByProviderId: baseProviderId,
    stakeTransactionId: base.stakeTransactionId,
    hcsTransactionId
  }, null, 2));
} catch (error) {
  throw new Error(`VERITY_PROVIDER_ENDPOINT_REGISTRATION_FAILED: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
} finally {
  client.close();
}

interface RegistryEntry {
  readonly providerId: string;
  readonly providerRoot: string;
  readonly providerStakeAmount: string;
  readonly providerAddress: string;
  readonly stakeTransactionId?: string;
}

async function readRegistry(path: string): Promise<RegistryEntry[]> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    throw new Error(`VERITY_PROVIDER_REGISTRY_READ_FAILED: could not read ${path}`, { cause: error });
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new Error(`VERITY_PROVIDER_REGISTRY_JSON: ${path} was not valid JSON`, { cause: error });
  }
  if (!Array.isArray(value)) throw new Error(`VERITY_PROVIDER_REGISTRY_SCHEMA: ${path} must contain an array`);
  return value as RegistryEntry[];
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`VERITY_CONFIG_MISSING: ${name} is required; set it in .env`);
  return value;
}
