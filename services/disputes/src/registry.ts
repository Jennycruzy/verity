import { readFile } from "node:fs/promises";
import { readTopicRecords } from "@verity/hcs";
import { MemoryProviderRegistry, type ProviderRecord } from "./service.js";

export async function readProviderRegistry(path: string): Promise<MemoryProviderRegistry> {
  const raw = await readFile(path, "utf8");
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new Error(`VERITY_PROVIDER_REGISTRY_JSON: ${path} was not valid JSON`, { cause: error });
  }
  if (!Array.isArray(value)) throw new Error(`VERITY_PROVIDER_REGISTRY_SCHEMA: ${path} must contain an array`);
  const records = new Map<string, ProviderRecord>();
  for (const [index, entry] of value.entries()) {
    const parsed = parseProviderRecord(entry, `entry ${index}`);
    if (records.has(parsed.providerId)) throw new Error(`VERITY_PROVIDER_REGISTRY_SCHEMA: duplicate provider ${parsed.providerId}`);
    records.set(parsed.providerId, parsed.record);
  }
  return new MemoryProviderRegistry(records);
}

export async function readProviderRegistryFromHcs(
  mirrorNodeBaseUrl: string,
  topicId: string,
  fetchImpl: typeof fetch = fetch
): Promise<MemoryProviderRegistry> {
  const records = await readTopicRecords(mirrorNodeBaseUrl, topicId, { fetchImpl });
  const providers = new Map<string, ProviderRecord>();
  for (const record of records) {
    if (record.kind !== "provider") continue;
    const parsed = parseProviderRecord(record.payload, `HCS record ${record.id}`);
    if (record.id !== parsed.providerId) throw new Error(`VERITY_PROVIDER_REGISTRY_SCHEMA: HCS record ${record.id} does not match providerId ${parsed.providerId}`);
    if (providers.has(parsed.providerId)) throw new Error(`VERITY_PROVIDER_REGISTRY_SCHEMA: duplicate provider ${parsed.providerId} on HCS`);
    providers.set(parsed.providerId, parsed.record);
  }
  return new MemoryProviderRegistry(providers);
}

function parseProviderRecord(value: unknown, name: string): { providerId: string; record: ProviderRecord } {
  if (!value || typeof value !== "object") throw new Error(`VERITY_PROVIDER_REGISTRY_SCHEMA: ${name} is not an object`);
  const candidate = value as { providerId?: unknown; providerRoot?: unknown; providerStakeAmount?: unknown; providerAddress?: unknown };
  if (typeof candidate.providerId !== "string" || !candidate.providerId.trim()
    || typeof candidate.providerRoot !== "string" || !candidate.providerRoot.trim()
    || typeof candidate.providerStakeAmount !== "string" || !/^\d+$/.test(candidate.providerStakeAmount)
    || BigInt(candidate.providerStakeAmount) <= 0n
    || typeof candidate.providerAddress !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(candidate.providerAddress)) {
    throw new Error(`VERITY_PROVIDER_REGISTRY_SCHEMA: ${name} is invalid`);
  }
  return {
    providerId: candidate.providerId,
    record: {
      providerRoot: candidate.providerRoot,
      providerStakeAmount: candidate.providerStakeAmount,
      providerAddress: candidate.providerAddress
    }
  };
}
