import {
  AccountInfoQuery,
  CustomFixedFee,
  TokenAssociateTransaction,
  TokenCreateTransaction,
  TokenId,
  TokenInfoQuery,
  TransferTransaction,
  type Client
} from "@hiero-ledger/sdk";

export interface HtsSettlementTokenConfig {
  readonly tokenName: string;
  readonly tokenSymbol: string;
  readonly decimals: number;
  readonly initialSupply: string;
  readonly treasuryAccountId: string;
  readonly feeCollectorAccountId: string;
  readonly feeAmount: string;
  readonly tokenMemo?: string;
}

export interface HtsTokenCreateResult {
  readonly tokenId: string;
  readonly transactionId: string;
}

export interface HtsAssociationResult {
  readonly accountId: string;
  readonly tokenId: string;
  readonly associated: boolean;
  readonly transactionId?: string;
}

export interface HtsTransferResult {
  readonly tokenId: string;
  readonly senderAccountId: string;
  readonly recipientAccountId: string;
  readonly amount: string;
  readonly transactionId: string;
}

export interface HtsSettlementTokenExpectation {
  readonly tokenName: string;
  readonly tokenSymbol: string;
  readonly decimals: number;
  readonly initialSupply: string;
  readonly treasuryAccountId: string;
  readonly feeCollectorAccountId: string;
  readonly feeAmount: string;
}

export function validateHtsSettlementTokenConfig(config: HtsSettlementTokenConfig): void {
  assertText(config.tokenName, "tokenName", 100);
  if (!/^[A-Z][A-Z0-9._-]*$/.test(config.tokenSymbol) || Buffer.byteLength(config.tokenSymbol, "utf8") > 100) {
    throw new Error("VERITY_HTS_TOKEN_SYMBOL_INVALID: tokenSymbol must be uppercase ASCII and at most 100 bytes");
  }
  if (!Number.isSafeInteger(config.decimals) || config.decimals < 0 || config.decimals > 18) {
    throw new Error("VERITY_HTS_TOKEN_DECIMALS_INVALID: decimals must be an integer from 0 through 18");
  }
  parsePositiveAmount(config.initialSupply, "initialSupply");
  parsePositiveAmount(config.feeAmount, "feeAmount");
  assertAccountId(config.treasuryAccountId, "treasuryAccountId");
  assertAccountId(config.feeCollectorAccountId, "feeCollectorAccountId");
  if (config.tokenMemo !== undefined) assertText(config.tokenMemo, "tokenMemo", 100);
}

export function createHtsCustomFee(config: Pick<HtsSettlementTokenConfig, "feeCollectorAccountId" | "feeAmount">): CustomFixedFee {
  parsePositiveAmount(config.feeAmount, "feeAmount");
  assertAccountId(config.feeCollectorAccountId, "feeCollectorAccountId");
  return new CustomFixedFee()
    .setAmount(BigInt(config.feeAmount))
    .setDenominatingTokenToSameToken()
    .setFeeCollectorAccountId(config.feeCollectorAccountId);
}

export async function createHtsSettlementToken(client: Client, config: HtsSettlementTokenConfig): Promise<HtsTokenCreateResult> {
  validateHtsSettlementTokenConfig(config);
  const operator = client.operatorAccountId?.toString();
  if (!operator) throw new Error("VERITY_HTS_OPERATOR_MISSING: the Hedera client has no operator account");
  if (operator !== config.treasuryAccountId) {
    throw new Error("VERITY_HTS_TREASURY_OPERATOR_MISMATCH: token treasury must be the configured Hedera operator");
  }
  const feeScheduleKey = client.operatorPublicKey;
  if (!feeScheduleKey) throw new Error("VERITY_HTS_FEE_KEY_MISSING: the Hedera client has no operator public key");

  const response = await new TokenCreateTransaction()
    .setTokenName(config.tokenName)
    .setTokenSymbol(config.tokenSymbol)
    .setDecimals(config.decimals)
    .setInitialSupply(BigInt(config.initialSupply))
    .setTreasuryAccountId(config.treasuryAccountId)
    .setFeeScheduleKey(feeScheduleKey)
    .setCustomFees([createHtsCustomFee(config)])
    .setTokenMemo(config.tokenMemo ?? "verity/settlement-token/v1")
    .execute(client);
  const receipt = await response.getReceipt(client);
  if (!receipt.tokenId) throw new Error("VERITY_HTS_CREATE_FAILED: token creation returned no token ID");
  return { tokenId: receipt.tokenId.toString(), transactionId: response.transactionId.toString() };
}

export async function assertHtsTokenAssociation(client: Client, tokenId: string, accountId: string): Promise<void> {
  const token = parseTokenId(tokenId);
  const account = assertAccountId(accountId, "accountId");
  const info = await new AccountInfoQuery().setAccountId(account).execute(client);
  if (!info.tokenRelationships.get(token)) {
    throw new Error(`VERITY_HTS_ASSOCIATION_MISSING: ${accountId} is not associated with ${tokenId}`);
  }
}

export async function ensureHtsTokenAssociation(client: Client, tokenId: string): Promise<HtsAssociationResult> {
  const token = parseTokenId(tokenId);
  const accountId = client.operatorAccountId?.toString();
  if (!accountId) throw new Error("VERITY_HTS_OPERATOR_MISSING: the Hedera client has no operator account");
  const before = await new AccountInfoQuery().setAccountId(accountId).execute(client);
  if (before.tokenRelationships.get(token)) {
    return { accountId, tokenId, associated: true };
  }

  const response = await new TokenAssociateTransaction()
    .setAccountId(accountId)
    .setTokenIds([token])
    .execute(client);
  await response.getReceipt(client);
  await assertHtsTokenAssociation(client, tokenId, accountId);
  return { accountId, tokenId, associated: true, transactionId: response.transactionId.toString() };
}

export async function transferHtsTokens(
  client: Client,
  tokenId: string,
  recipientAccountId: string,
  amount: string
): Promise<HtsTransferResult> {
  const token = parseTokenId(tokenId);
  const senderAccountId = client.operatorAccountId?.toString();
  if (!senderAccountId) throw new Error("VERITY_HTS_OPERATOR_MISSING: the Hedera client has no operator account");
  const recipient = assertAccountId(recipientAccountId, "recipientAccountId");
  const quantity = parsePositiveAmount(amount, "amount");
  await assertHtsTokenAssociation(client, tokenId, senderAccountId);
  await assertHtsTokenAssociation(client, tokenId, recipient);

  const response = await new TransferTransaction()
    .addTokenTransfer(token, senderAccountId, -quantity)
    .addTokenTransfer(token, recipient, quantity)
    .execute(client);
  await response.getReceipt(client);
  return {
    tokenId,
    senderAccountId,
    recipientAccountId: recipient,
    amount,
    transactionId: response.transactionId.toString()
  };
}

export async function assertHtsSettlementToken(
  client: Client,
  tokenId: string,
  expectation: HtsSettlementTokenExpectation
): Promise<void> {
  parseTokenId(tokenId);
  validateHtsSettlementTokenConfig({ ...expectation, tokenMemo: undefined });
  const info = await new TokenInfoQuery().setTokenId(tokenId).execute(client);
  if (info.name !== expectation.tokenName
    || info.symbol !== expectation.tokenSymbol
    || info.decimals !== expectation.decimals
    || info.totalSupply.toString() !== expectation.initialSupply
    || info.treasuryAccountId?.toString() !== expectation.treasuryAccountId) {
    throw new Error(`VERITY_HTS_TOKEN_MISMATCH: ${tokenId} metadata does not match the configured settlement token`);
  }
  if (info.customFees.length !== 1) {
    throw new Error(`VERITY_HTS_FEE_MISMATCH: ${tokenId} must have exactly one custom fee`);
  }
  const fee = info.customFees[0];
  if (!(fee instanceof CustomFixedFee)
    || fee.amount?.toString() !== expectation.feeAmount
    || fee.feeCollectorAccountId?.toString() !== expectation.feeCollectorAccountId
    || fee.denominatingTokenId?.toString() !== "0.0.0") {
    throw new Error(`VERITY_HTS_FEE_MISMATCH: ${tokenId} custom fee is not a same-token fee for the configured collector`);
  }
}

function parseTokenId(value: string): TokenId {
  if (!/^0\.0\.\d+$/.test(value.trim())) throw new Error("VERITY_HTS_TOKEN_ID_INVALID: token ID must use Hedera 0.0.N format");
  return TokenId.fromString(value.trim());
}

function assertAccountId(value: string, name: string): string {
  const normalized = value.trim();
  if (!/^0\.0\.\d+$/.test(normalized)) throw new Error(`VERITY_HTS_ACCOUNT_ID_INVALID: ${name} must use Hedera 0.0.N format`);
  return normalized;
}

function parsePositiveAmount(value: string, name: string): bigint {
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized) || BigInt(normalized) <= 0n) {
    throw new Error(`VERITY_HTS_AMOUNT_INVALID: ${name} must be a positive integer in the token's smallest unit`);
  }
  return BigInt(normalized);
}

function assertText(value: string, name: string, maxBytes: number): void {
  const normalized = value.trim();
  if (!normalized || Buffer.byteLength(normalized, "utf8") > maxBytes) {
    throw new Error(`VERITY_HTS_TEXT_INVALID: ${name} must be non-empty and at most ${maxBytes} bytes`);
  }
}
