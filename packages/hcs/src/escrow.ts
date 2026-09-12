import { createHash } from "node:crypto";
import { ContractExecuteTransaction, ContractFunctionParameters, Hbar, ScheduleCreateTransaction, Timestamp, type Client } from "@hiero-ledger/sdk";
import BigNumber from "bignumber.js";

export interface EscrowCallResult {
  readonly transactionId: string;
}

export interface EscrowScheduleResult extends EscrowCallResult {
  readonly scheduleId: string;
}

export interface EscrowExecutor {
  execute(functionName: string, parameters: ContractFunctionParameters, payableTinybars?: string): Promise<EscrowCallResult>;
}

export interface EscrowScheduler {
  schedule(functionName: string, parameters: ContractFunctionParameters, expirationTime: Date, memo: string): Promise<EscrowScheduleResult>;
}

export class HederaEscrowExecutor implements EscrowExecutor, EscrowScheduler {
  private readonly contractId: string;

  public constructor(
    private readonly client: Client,
    contractId: string,
    private readonly gas: number
  ) {
    const normalizedContractId = contractId.trim();
    if (!normalizedContractId) throw new Error("VERITY_ESCROW_CONTRACT_ID_MISSING: set the deployed contract ID");
    if (!/^0\.0\.\d+$/.test(normalizedContractId)) throw new Error("VERITY_ESCROW_CONTRACT_ID_INVALID: use a Hedera contract ID in 0.0.N format");
    this.contractId = normalizedContractId;
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

  public async schedule(
    functionName: string,
    parameters: ContractFunctionParameters,
    expirationTime: Date,
    memo: string
  ): Promise<EscrowScheduleResult> {
    assertFuture(expirationTime);
    if (!memo.trim()) throw new Error("VERITY_ESCROW_SCHEDULE_MEMO_MISSING: scheduled calls require a non-empty memo");
    const scheduledCall = new ContractExecuteTransaction()
      .setContractId(this.contractId)
      .setGas(this.gas)
      .setFunction(functionName, parameters);
    const response = await new ScheduleCreateTransaction()
      .setScheduledTransaction(scheduledCall)
      .setExpirationTime(Timestamp.fromDate(expirationTime))
      .setWaitForExpiry(true)
      .setScheduleMemo(memo)
      .execute(this.client);
    const receipt = await response.getReceipt(this.client);
    if (!receipt.scheduleId) throw new Error("VERITY_ESCROW_SCHEDULE_FAILED: schedule creation returned no schedule ID");
    return { transactionId: response.transactionId.toString(), scheduleId: receipt.scheduleId.toString() };
  }
}

export class VerityEscrowClient {
  public constructor(private readonly executor: EscrowExecutor) {}

  public registerAgent(agentId: string, humanRoot: string, endpoint: string): Promise<EscrowCallResult> {
    return this.executor.execute(
      "registerAgent",
      new ContractFunctionParameters()
        .addBytes32(toBytes32(agentId))
        .addBytes32(toBytes32(humanRoot))
        .addBytes32(toBytes32(endpoint))
    );
  }

  public postBond(disputeId: string, providerRoot: string, amountTinybars: string): Promise<EscrowCallResult> {
    return this.executor.execute(
      "postBond",
      new ContractFunctionParameters()
        .addBytes32(toBytes32(disputeId))
        .addBytes32(toBytes32(providerRoot)),
      parseTinybars(amountTinybars)
    );
  }

  public postBondWithExpiry(disputeId: string, providerRoot: string, amountTinybars: string, expiresAt: Date): Promise<EscrowCallResult> {
    return this.executor.execute(
      "postBondWithExpiry",
      new ContractFunctionParameters()
        .addBytes32(toBytes32(disputeId))
        .addBytes32(toBytes32(providerRoot))
        .addUint256(new BigNumber(toUnixSeconds(expiresAt))),
      parseTinybars(amountTinybars)
    );
  }

  public scheduleBondExpiry(
    disputeId: string,
    buyerAddress: string,
    expiresAt: Date,
    memo = `verity/bond-expiry/${disputeId}`
  ): Promise<EscrowScheduleResult> {
    assertFuture(expiresAt);
    if (!memo.trim()) throw new Error("VERITY_ESCROW_SCHEDULE_MEMO_MISSING: scheduled calls require a non-empty memo");
    const scheduler = this.executor as EscrowExecutor & Partial<EscrowScheduler>;
    if (typeof scheduler.schedule !== "function") {
      throw new Error("VERITY_ESCROW_SCHEDULER_UNAVAILABLE: use HederaEscrowExecutor to schedule bond expiry");
    }
    return scheduler.schedule(
      "releaseExpiredBond",
      new ContractFunctionParameters()
        .addBytes32(toBytes32(disputeId))
        .addAddress(normalizeEvmAddress(buyerAddress)),
      expiresAt,
      memo
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
        .addUint256(new BigNumber(parseTinybars(amountTinybars)))
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

function toUnixSeconds(value: Date): number {
  assertFuture(value);
  const seconds = Math.floor(value.getTime() / 1000);
  if (!Number.isSafeInteger(seconds) || seconds <= 0) throw new Error("VERITY_ESCROW_EXPIRY_INVALID: expiry must fit a positive Unix timestamp");
  return seconds;
}

function assertFuture(value: Date): void {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime()) || value.getTime() <= Date.now()) {
    throw new Error("VERITY_ESCROW_EXPIRY_INVALID: expiry must be a future date");
  }
}

function normalizeEvmAddress(value: string): string {
  const normalized = value.trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(normalized)) {
    throw new Error("VERITY_ESCROW_ADDRESS_INVALID: resolveBond requires a 20-byte EVM address");
  }
  return normalized;
}
