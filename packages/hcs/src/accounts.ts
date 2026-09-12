import { AccountCreateTransaction, Hbar, PrivateKey, type Client } from "@hiero-ledger/sdk";

export interface HederaAccountCreation {
  readonly accountId: string;
  readonly privateKey: string;
  readonly evmAddress: string;
  readonly transactionId: string;
}

export function parsePositiveHbar(value: string, name = "HEDERA_ACCOUNT_INITIAL_BALANCE_HBAR"): Hbar {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d{1,8})?$/.test(normalized)) {
    throw new Error(`VERITY_ACCOUNT_BALANCE_INVALID: ${name} must be a positive HBAR amount with at most 8 decimals`);
  }
  let amount: Hbar;
  try {
    amount = Hbar.fromString(normalized);
  } catch (error) {
    throw new Error(`VERITY_ACCOUNT_BALANCE_INVALID: ${name} is not a valid HBAR amount`, { cause: error });
  }
  if (amount.toTinybars().toString() === "0") {
    throw new Error(`VERITY_ACCOUNT_BALANCE_INVALID: ${name} must be greater than zero`);
  }
  return amount;
}

export async function createEcdsaAccount(client: Client, initialBalance: string, memo: string): Promise<HederaAccountCreation> {
  const amount = parsePositiveHbar(initialBalance);
  if (!memo.trim()) throw new Error("VERITY_ACCOUNT_MEMO_MISSING: account creation requires a non-empty memo");

  const privateKey = PrivateKey.generateECDSA();
  const response = await new AccountCreateTransaction()
    .setECDSAKeyWithAlias(privateKey)
    .setInitialBalance(amount)
    .setAccountMemo(memo.trim())
    .execute(client);
  const receipt = await response.getReceipt(client);
  const accountId = receipt.accountId?.toString();
  if (!accountId || !/^0\.0\.\d+$/.test(accountId)) {
    throw new Error(`VERITY_ACCOUNT_CREATE_FAILED: transaction ${response.transactionId.toString()} returned no numeric account ID`);
  }

  return {
    accountId,
    privateKey: privateKey.toStringRaw(),
    evmAddress: normalizeEvmAddress(privateKey.publicKey.toEvmAddress()),
    transactionId: response.transactionId.toString()
  };
}

function normalizeEvmAddress(value: string): string {
  const normalized = value.startsWith("0x") ? value : `0x${value}`;
  if (!/^0x[0-9a-fA-F]{40}$/.test(normalized)) {
    throw new Error("VERITY_ACCOUNT_EVM_ADDRESS_INVALID: generated key did not produce a 20-byte EVM address");
  }
  return normalized;
}
