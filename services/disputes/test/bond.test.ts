import assert from "node:assert/strict";
import { Interface } from "ethers";
import test from "node:test";
import { toBytes32 } from "@verity/hcs";
import { MirrorBondVerifier, MirrorStakeVerifier, toMirrorTransactionId } from "../src/bond.ts";

const contractId = "0.0.10";
const buyerAddress = `0x${"02".repeat(20)}`;
const providerAddress = `0x${"03".repeat(20)}`;
const providerRoot = "provider-root";

test("verifies a successful postBond contract result from Mirror Node", async () => {
  const abi = new Interface(["function postBond(bytes32 disputeId, bytes32 providerRoot) payable"]);
  const parameters = abi.encodeFunctionData("postBond", [bytes32("dispute-1"), bytes32(providerRoot)]);
  const verifier = new MirrorBondVerifier("https://mirror.invalid/api/v1", contractId, async (input) => {
    assert.equal(String(input), "https://mirror.invalid/api/v1/contracts/results/0.0.9-1-000000000");
    return new Response(JSON.stringify({ contract_id: contractId, from: buyerAddress, amount: "10", function_parameters: parameters, result: "SUCCESS" }), { status: 200 });
  });
  await verifier.verify({ transactionId: "0.0.9@1.000000000", disputeId: "dispute-1", providerRoot, buyerAddress, amountTinybars: "10" });
});

test("verifies a successful postBondWithExpiry contract result from Mirror Node", async () => {
  const abi = new Interface(["function postBondWithExpiry(bytes32 disputeId, bytes32 providerRoot, uint256 expiresAt) payable"]);
  const parameters = abi.encodeFunctionData("postBondWithExpiry", [bytes32("dispute-1"), bytes32(providerRoot), 1_800_000_000n]);
  const verifier = new MirrorBondVerifier("https://mirror.invalid/api/v1", contractId, async () => {
    return new Response(JSON.stringify({ contract_id: contractId, from: buyerAddress, amount: "10", function_parameters: parameters, result: "SUCCESS" }), { status: 200 });
  });
  await verifier.verify({ transactionId: "0.0.9@1.000000000", disputeId: "dispute-1", providerRoot, buyerAddress, amountTinybars: "10" });
});

test("verifies a provider stake transaction from Mirror Node", async () => {
  const abi = new Interface(["function stakeProvider(bytes32 providerRoot) payable"]);
  const parameters = abi.encodeFunctionData("stakeProvider", [bytes32(providerRoot)]);
  const verifier = new MirrorStakeVerifier("https://mirror.invalid/api/v1", contractId, async () => {
    return new Response(JSON.stringify({ contract_id: contractId, from: providerAddress, amount: "20", function_parameters: parameters, result: "SUCCESS" }), { status: 200 });
  });
  await verifier.verify({ transactionId: "0.0.9@1.000000000", providerRoot, providerAddress, amountTinybars: "20" });
});

test("accepts the left-padded EVM caller returned by Hedera Mirror Node", async () => {
  const abi = new Interface(["function stakeProvider(bytes32 providerRoot) payable"]);
  const parameters = abi.encodeFunctionData("stakeProvider", [bytes32(providerRoot)]);
  const paddedProvider = `0x${"0".repeat(24)}${providerAddress.slice(2)}`;
  const verifier = new MirrorStakeVerifier("https://mirror.invalid/api/v1", contractId, async () => {
    return new Response(JSON.stringify({ contract_id: contractId, from: paddedProvider, amount: "20", function_parameters: parameters, result: "SUCCESS" }), { status: 200 });
  });
  await verifier.verify({ transactionId: "0.0.9@1.000000000", providerRoot, providerAddress, amountTinybars: "20" });
});

test("resolves an ECDSA alias to the same Hedera long-zero caller", async () => {
  const abi = new Interface(["function stakeProvider(bytes32 providerRoot) payable"]);
  const parameters = abi.encodeFunctionData("stakeProvider", [bytes32(providerRoot)]);
  const alias = `0x${"11".repeat(20)}`;
  const longZero = `0x${"0".repeat(39)}9`;
  let requests = 0;
  const verifier = new MirrorStakeVerifier("https://mirror.invalid/api/v1", contractId, async (input) => {
    requests += 1;
    if (String(input).includes("/contracts/results/")) {
      return new Response(JSON.stringify({ contract_id: contractId, from: longZero, amount: "20", function_parameters: parameters, result: "SUCCESS" }), { status: 200 });
    }
    assert.equal(String(input), `https://mirror.invalid/api/v1/accounts/${alias}`);
    return new Response(JSON.stringify({ account: "0.0.9", evm_address: alias }), { status: 200 });
  });
  await verifier.verify({ transactionId: "0.0.9@1.000000000", providerRoot, providerAddress: alias, amountTinybars: "20" });
  assert.equal(requests, 2);
});

test("rejects a bond result with the wrong amount", async () => {
  const abi = new Interface(["function postBond(bytes32 disputeId, bytes32 providerRoot) payable"]);
  const parameters = abi.encodeFunctionData("postBond", [bytes32("dispute-1"), bytes32(providerRoot)]);
  const verifier = new MirrorBondVerifier("https://mirror.invalid/api/v1", contractId, async () => new Response(JSON.stringify({ contract_id: contractId, from: buyerAddress, amount: "9", function_parameters: parameters, result: "SUCCESS" }), { status: 200 }));
  await assert.rejects(verifier.verify({ transactionId: "0.0.9@1.000000000", disputeId: "dispute-1", providerRoot, buyerAddress, amountTinybars: "10" }), /VERITY_BOND_AMOUNT_MISMATCH/);
});

test("normalizes the Hedera transaction ID accepted by Mirror Node", () => {
  assert.equal(toMirrorTransactionId("0.0.9@1.000000000"), "0.0.9-1-000000000");
  assert.equal(toMirrorTransactionId("0.0.9-1-000000000"), "0.0.9-1-000000000");
  assert.throws(() => toMirrorTransactionId("not-a-transaction"), /VERITY_BOND_TRANSACTION_ID_INVALID/);
});

test("rejects a malformed escrow contract ID before reading Mirror Node", () => {
  assert.throws(() => new MirrorBondVerifier("https://mirror.invalid", "contract"), /VERITY_ESCROW_CONTRACT_ID_INVALID/);
});

test("adds the Mirror Node API path when the root URL is configured", async () => {
  const verifier = new MirrorBondVerifier("https://mirror.invalid", contractId, async (input) => {
    assert.equal(String(input), "https://mirror.invalid/api/v1/contracts/results/0.0.9-1-000000000");
    return new Response(JSON.stringify({ contract_id: contractId, from: buyerAddress, amount: "10", function_parameters: "0x", result: "SUCCESS" }), { status: 200 });
  });
  await assert.rejects(verifier.verify({ transactionId: "0.0.9@1.000000000", disputeId: "dispute-1", providerRoot, buyerAddress, amountTinybars: "10" }), /VERITY_BOND_FUNCTION_MISMATCH/);
});

function bytes32(value: string): string {
  return `0x${Buffer.from(toBytes32(value)).toString("hex")}`;
}
