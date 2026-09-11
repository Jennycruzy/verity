import { createHash } from "node:crypto";
import { ContractExecuteTransaction, ContractFunctionParameters, Hbar, type Client } from "@hiero-ledger/sdk";

export interface EscrowCallResult {
  readonly transactionId: string;
}

export interface EscrowExecutor {
  execute(functionName: string, parameters: ContractFunctionParameters, payableTinybars?: string): Promise<EscrowCallResult>;
}

export class HederaEscrowExecutor implements EscrowExecutor {
  public constructor(
    private readonly client: Client,
    private readonly contractId: string,
    private readonly gas: number
  ) {
    if (!contractId.trim()) throw new Error("VERITY_ESCROW_CONTRACT_ID_MISSING: set the deployed contract ID");
    if (!Number.isSafeInteger(gas) || gas <= 0) throw new Error("VERITY_ESCROW_GAS_INVALID: use a positive safe integer gas limit");
  }

  public async execute(functionName: string, parameters: ContractFunctionParameters, payableTinybars?: string): Promise<EscrowCallResult> {
    const transaction = new ContractExecuteTransaction()
      .setContractId(this.contractId)
      .setGas(this.gas)
      .setFunction(functionName, parameters);
    if (payableTinybars !== undefined) {
      transaction.setPayableAmount(Hbar.fromTinybars(parseTinybars(payableTinybars)));
    }
    const response = await transaction.execute(this.client);
    await response.getReceipt(this.client);
    return { transactionId: response.transactionId.toString() };
  }
}

export class VerityEscrowClient {
  public constructor(private readonly executor: EscrowExecutor) {}

  public postBond(disputeId: string, providerRoot: string, amountTinybars: string): Promise<EscrowCallResult> {
    return this.executor.execute(
      "postBond",
      new ContractFunctionParameters()
        .addBytes32(toBytes32(disputeId))
        .addBytes32(toBytes32(providerRoot)),
      parseTinybars(amountTinybars)
    );
  }

  public stakeProvider(providerRoot: string, amountTinybars: string): Promise<EscrowCallResult> {
    return this.executor.execute(
      "stakeProvider",
      new ContractFunctionParameters().addBytes32(toBytes32(providerRoot)),
      parseTinybars(amountTinybars)
    );
  }

  public lockStake(disputeId: string, amountTinybars: string): Promise<EscrowCallResult> {
    return this.executor.execute(
      "lockStake",
      new ContractFunctionParameters()
        .addBytes32(toBytes32(disputeId))
        .addUint256(parseTinybars(amountTinybars))
    );
  }

  public resolveBond(
    disputeId: string,
    providerWasWrong: boolean,
    buyerAddress: string,
    providerAddress: string
  ): Promise<EscrowCallResult> {
    return this.executor.execute(
      "resolveBond",
      new ContractFunctionParameters()
        .addBytes32(toBytes32(disputeId))
        .addBool(providerWasWrong)
        .addAddress(normalizeEvmAddress(buyerAddress))
        .addAddress(normalizeEvmAddress(providerAddress))
    );
  }

  public anchorReputation(
    providerRoot: string,
    buyerRoot: string,
    providerWasCorrect: boolean,
    buyerWasHonest: boolean
  ): Promise<EscrowCallResult> {
    return this.executor.execute(
      "anchorReputation",
      new ContractFunctionParameters()
        .addBytes32(toBytes32(providerRoot))
        .addBytes32(toBytes32(buyerRoot))
        .addBool(providerWasCorrect)
        .addBool(buyerWasHonest)
    );
  }
}

export function createVerityEscrowClient(client: Client, contractId: string, gas: number): VerityEscrowClient {
  return new VerityEscrowClient(new HederaEscrowExecutor(client, contractId, gas));
}

export function toBytes32(value: string): Uint8Array {
  const normalized = value.trim();
  if (!normalized) throw new Error("VERITY_ESCROW_KEY_EMPTY: bytes32 keys cannot be empty");
  if (/^0x[0-9a-fA-F]{64}$/.test(normalized)) return Uint8Array.from(Buffer.from(normalized.slice(2), "hex"));
  return createHash("sha256").update(normalized, "utf8").digest();
}

function parseTinybars(value: string): string {
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized) || BigInt(normalized) <= 0n) {
    throw new Error("VERITY_ESCROW_AMOUNT_INVALID: use a positive integer in tinybars");
  }
  return normalized;
}

function normalizeEvmAddress(value: string): string {
  const normalized = value.trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(normalized)) {
    throw new Error("VERITY_ESCROW_ADDRESS_INVALID: resolveBond requires a 20-byte EVM address");
  }
  return normalized;
}
