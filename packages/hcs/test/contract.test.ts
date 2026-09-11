import assert from "node:assert/strict";
import test from "node:test";
import type { Client } from "@hiero-ledger/sdk";
import { deployVerityEscrow } from "../src/contract.ts";

const unusedClient = undefined as unknown as Client;

test("rejects escrow deployment without bytecode", async () => {
  await assert.rejects(
    deployVerityEscrow(unusedClient, new Uint8Array(), 1, 100_000),
    /VERITY_CONTRACT_BYTECODE_EMPTY/
  );
});

test("rejects an invalid escrow minimum bond", async () => {
  await assert.rejects(
    deployVerityEscrow(unusedClient, new Uint8Array([1]), 0, 100_000),
    /VERITY_CONTRACT_MINIMUM_BOND_INVALID/
  );
});

test("rejects an invalid escrow gas limit", async () => {
  await assert.rejects(
    deployVerityEscrow(unusedClient, new Uint8Array([1]), 1, 0),
    /VERITY_CONTRACT_GAS_INVALID/
  );
});
