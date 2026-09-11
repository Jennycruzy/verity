import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readProviderRegistry } from "../src/registry.ts";

test("loads provider roots and stake amounts from the configured registry", async () => {
  const directory = await mkdtemp(join(tmpdir(), "verity-registry-"));
  const path = join(directory, "providers.json");
  try {
    await writeFile(path, JSON.stringify([{ providerId: "provider-1", providerRoot: "root-1", providerStakeAmount: "20", providerAddress: `0x${"01".repeat(20)}` }]));
    const registry = await readProviderRegistry(path);
    assert.deepEqual(await registry.get("provider-1"), { providerRoot: "root-1", providerStakeAmount: "20", providerAddress: `0x${"01".repeat(20)}` });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects duplicate provider records", async () => {
  const directory = await mkdtemp(join(tmpdir(), "verity-registry-"));
  const path = join(directory, "providers.json");
  try {
    await writeFile(path, JSON.stringify([
      { providerId: "provider-1", providerRoot: "root-1", providerStakeAmount: "20", providerAddress: `0x${"01".repeat(20)}` },
      { providerId: "provider-1", providerRoot: "root-2", providerStakeAmount: "20", providerAddress: `0x${"02".repeat(20)}` }
    ]));
    await assert.rejects(readProviderRegistry(path), /VERITY_PROVIDER_REGISTRY_SCHEMA/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
