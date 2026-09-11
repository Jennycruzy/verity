import { readFile } from "node:fs/promises";
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
    if (!entry || typeof entry !== "object") throw new Error(`VERITY_PROVIDER_REGISTRY_SCHEMA: entry ${index} is not an object`);
    const candidate = entry as { providerId?: unknown; providerRoot?: unknown; providerStakeAmount?: unknown };
    if (typeof candidate.providerId !== "string" || !candidate.providerId.trim()
      || typeof candidate.providerRoot !== "string" || !candidate.providerRoot.trim()
      || typeof candidate.providerStakeAmount !== "string" || !/^\d+$/.test(candidate.providerStakeAmount)
      || BigInt(candidate.providerStakeAmount) <= 0n) {
      throw new Error(`VERITY_PROVIDER_REGISTRY_SCHEMA: entry ${index} is invalid`);
    }
    if (records.has(candidate.providerId)) throw new Error(`VERITY_PROVIDER_REGISTRY_SCHEMA: duplicate provider ${candidate.providerId}`);
    records.set(candidate.providerId, { providerRoot: candidate.providerRoot, providerStakeAmount: candidate.providerStakeAmount });
  }
  return new MemoryProviderRegistry(records);
}
