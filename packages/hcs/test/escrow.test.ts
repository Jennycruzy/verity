import assert from "node:assert/strict";
import { PrivateKey } from "@hiero-ledger/sdk";
import test from "node:test";
import { createHederaClient, toBytes32, VerityEscrowClient, type EscrowCallResult, type EscrowExecutor } from "../src/index.ts";

class ExecutorForTest implements EscrowExecutor {
  public readonly calls: { functionName: string; payableTinybars?: string }[] = [];

  public async execute(functionName: string, _parameters: never, payableTinybars?: string): Promise<EscrowCallResult> {
    this.calls.push({ functionName, ...(payableTinybars === undefined ? {} : { payableTinybars }) });
    return { transactionId: "0.0.7@1.000000000" };
  }
}

test("maps arbitrary dispute identities to stable bytes32 values", () => {
  assert.equal(Buffer.from(toBytes32("dispute-1")).toString("hex"), "cf4ede73026c48185e0ae2423af89405fa47fb5640fbe370ed6a2b7f130c4173");
  assert.equal(Buffer.from(toBytes32(`0x${"ab".repeat(32)}`)).toString("hex"), "ab".repeat(32));
});

test("creates Hedera clients with the configured ECDSA operator key", () => {
  const key = PrivateKey.generateECDSA();
  const client = createHederaClient("hedera:testnet", "0.0.1", key.toStringRaw());
  try {
    assert.equal(client.operatorPublicKey?.toString(), key.publicKey.toString());
  } finally {
    client.close();
  }
});

test("escrow calls preserve payable amounts and method names", async () => {
  const executor = new ExecutorForTest();
  const escrow = new VerityEscrowClient(executor);
  await escrow.registerAgent("7", "human-root", "https://provider.example/fx");
  await escrow.postBond("dispute-1", "buyer-root", "100");
  await escrow.stakeProvider("provider-root", "200");
  await escrow.lockStake("dispute-1", "50");
  await escrow.resolveBond("dispute-1", true, `0x${"01".repeat(20)}`, `0x${"02".repeat(20)}`);
  await escrow.anchorReputation("provider-root", "buyer-root", false, true);
  assert.deepEqual(executor.calls, [
    { functionName: "registerAgent" },
    { functionName: "postBond", payableTinybars: "100" },
    { functionName: "stakeProvider", payableTinybars: "200" },
    { functionName: "lockStake" },
    { functionName: "resolveBond" },
    { functionName: "anchorReputation" }
  ]);
});

test("rejects invalid escrow amounts and recipient addresses", async () => {
  const escrow = new VerityEscrowClient(new ExecutorForTest());
  assert.throws(() => escrow.postBond("dispute-1", "provider-root", "0"), /VERITY_ESCROW_AMOUNT_INVALID/);
  assert.throws(() => escrow.resolveBond("dispute-1", false, "0.0.1", `0x${"02".repeat(20)}`), /VERITY_ESCROW_ADDRESS_INVALID/);
});
