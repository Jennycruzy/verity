import { ContractCreateFlow, ContractFunctionParameters, type Client } from "@hiero-ledger/sdk";

export interface ContractDeploymentResult {
  readonly contractId: string;
  readonly transactionId: string;
}

export async function deployVerityEscrow(
  client: Client,
  bytecode: Uint8Array,
  minimumBond: number,
  gas: number
): Promise<ContractDeploymentResult> {
  if (bytecode.length === 0) throw new Error("VERITY_CONTRACT_BYTECODE_EMPTY: compile the escrow contract before deployment");
  if (!Number.isSafeInteger(minimumBond) || minimumBond <= 0) {
    throw new Error("VERITY_CONTRACT_MINIMUM_BOND_INVALID: use a positive safe integer in the asset's smallest unit");
  }
  if (!Number.isSafeInteger(gas) || gas <= 0) {
    throw new Error("VERITY_CONTRACT_GAS_INVALID: use a positive safe integer gas limit");
  }

  const response = await new ContractCreateFlow()
    .setBytecode(bytecode)
    .setGas(gas)
    .setConstructorParameters(new ContractFunctionParameters().addUint256(minimumBond))
    .setContractMemo("verity/bond-escrow/v1")
    .execute(client);
  const receipt = await response.getReceipt(client);
  if (!receipt.contractId) {
    throw new Error("VERITY_CONTRACT_DEPLOY_FAILED: deployment returned no contract ID");
  }
  return { contractId: receipt.contractId.toString(), transactionId: response.transactionId.toString() };
}
