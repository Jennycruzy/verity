import "dotenv/config";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createHederaClient, createVerityEscrowClient, HederaHcsPublisher } from "@verity/hcs";

const network = required("HEDERA_NETWORK");
const bondAssetId = process.env.VERITY_BOND_ASSET_ID?.trim() || "0.0.0";
if (bondAssetId !== "0.0.0") throw new Error("VERITY_PROVIDER_ASSET_UNSUPPORTED: provider stake currently accepts HBAR only; set VERITY_BOND_ASSET_ID=0.0.0");

const providerId = required("VERITY_PROVIDER_ID");
const providerRoot = required("VERITY_PROVIDER_ROOT");
const providerStakeAmount = positiveAmount("VERITY_PROVIDER_STAKE");
const providerAccountId = required("HEDERA_PROVIDER_ACCOUNT_ID");
const providerPrivateKey = required("HEDERA_PROVIDER_PRIVATE_KEY");
const providerAddress = required("HEDERA_PROVIDER_EVM_ADDRESS");
if (!/^0x[0-9a-fA-F]{40}$/.test(providerAddress)) throw new Error("VERITY_PROVIDER_ADDRESS_INVALID: use a 20-byte EVM address");
const settlementTopicId = required("HCS_SETTLEMENT_TOPIC_ID");
const contractId = required("VERITY_ESCROW_CONTRACT_ID");
const gas = positiveInteger("VERITY_ESCROW_GAS");
const registryPath = required("VERITY_PROVIDER_REGISTRY_FILE");
const registry = await readRegistry(registryPath);
const existing = registry.find((entry) => entry.providerId === providerId);
if (existing) throw new Error(`VERITY_PROVIDER_ALREADY_REGISTERED: ${providerId} already exists in ${registryPath}`);

const client = createHederaClient(network, providerAccountId, providerPrivateKey);
let stakeTransactionId: string | undefined;
try {
  const result = await createVerityEscrowClient(client, contractId, gas).stakeProvider(providerRoot, providerStakeAmount);
  stakeTransactionId = result.transactionId;
  const hcsTransactionId = await new HederaHcsPublisher(client).publish(settlementTopicId, {
    schema: "verity/hcs/v1",
    kind: "provider",
    id: providerId,
    recordedAt: new Date().toISOString(),
    payload: { providerId, providerRoot, providerStakeAmount, providerAddress, stakeTransactionId: result.transactionId }
  });
  registry.push({ providerId, providerRoot, providerStakeAmount, providerAddress, stakeTransactionId: result.transactionId });
  await mkdir(dirname(registryPath), { recursive: true });
  await writeFile(registryPath, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ providerId, providerRoot, providerStakeAmount, providerAddress, transactionId: result.transactionId, hcsTransactionId }, null, 2));
} catch (error) {
  const transactionContext = stakeTransactionId ? `; stake transaction ${stakeTransactionId} already succeeded` : "";
  throw new Error(`VERITY_PROVIDER_STAKE_FAILED${transactionContext}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
} finally {
  client.close();
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`VERITY_CONFIG_MISSING: ${name} is required; set it in .env`);
  return value;
}

function positiveAmount(name: string): string {
  const value = required(name);
  if (!/^\d+$/.test(value) || BigInt(value) <= 0n) throw new Error(`VERITY_CONFIG_INVALID: ${name} must be a positive integer`);
  return value;
}

function positiveInteger(name: string): number {
  const value = positiveAmount(name);
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new Error(`VERITY_CONFIG_INVALID: ${name} must be a safe integer`);
  return number;
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
    if (isFileNotFound(error)) return [];
    throw error;
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

function isFileNotFound(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
