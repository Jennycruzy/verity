import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Interface } from "ethers";
import test from "node:test";
import { encodeHcsRecord, toBytes32 } from "@verity/hcs";
import { readProviderRegistry, readProviderRegistryFromHcs } from "../src/registry.ts";

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

test("loads provider records from the settlement HCS topic", async () => {
  const stakeAddress = `0x${"01".repeat(20)}`;
  const stakeParameters = new Interface(["function stakeProvider(bytes32 providerRoot) payable"])
    .encodeFunctionData("stakeProvider", [bytes32("root-1")]);
  const message = encodeHcsRecord({
    schema: "verity/hcs/v1",
    kind: "provider",
    id: "provider-1",
    recordedAt: "2026-09-11T00:00:00.000Z",
    payload: {
      providerId: "provider-1",
      providerRoot: "root-1",
      providerStakeAmount: "20",
      providerAddress: `0x${"01".repeat(20)}`,
      stakeTransactionId: "0.0.7@1.000000000"
    }
  });
  const registry = await readProviderRegistryFromHcs(
    "https://mirror.invalid/api/v1",
    "0.0.9",
    {
      escrowContractId: contractId,
      fetchImpl: async (input) => {
        if (String(input).includes("/topics/")) {
          return new Response(JSON.stringify({
            messages: [{ consensus_timestamp: "1.000000000", sequence_number: 1, message: Buffer.from(message).toString("base64") }],
            links: {}
          }), { status: 200 });
        }
        return new Response(JSON.stringify({
          contract_id: contractId,
          from: stakeAddress,
          amount: "20",
          function_parameters: stakeParameters,
          result: "SUCCESS"
        }), { status: 200 });
      }
    }
  );
  assert.deepEqual(await registry.get("provider-1"), {
    providerRoot: "root-1",
    providerStakeAmount: "20",
    providerAddress: `0x${"01".repeat(20)}`,
    stakeTransactionId: "0.0.7@1.000000000"
  });
});

const contractId = "0.0.10";

function bytes32(value: string): string {
  return `0x${Buffer.from(toBytes32(value)).toString("hex")}`;
}
