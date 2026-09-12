import "dotenv/config";
import { readFile, writeFile } from "node:fs/promises";
import {
  assertHtsSettlementToken,
  assertHtsTokenAssociation,
  createHederaClient,
  createHtsSettlementToken,
  ensureHtsTokenAssociation,
  transferHtsTokens,
  type HtsSettlementTokenConfig,
  type HtsTransferResult
} from "@verity/hcs";

const existingAsset = process.env.HEDERA_ASSET_ID?.trim();
if (existingAsset && existingAsset !== "0.0.0") {
  throw new Error(`VERITY_HTS_ALREADY_CONFIGURED: HEDERA_ASSET_ID is already ${existingAsset}`);
}

const network = required("HEDERA_NETWORK");
const treasuryAccountId = process.env.HEDERA_TOKEN_TREASURY_ACCOUNT_ID?.trim() || required("HEDERA_CLIENT_ACCOUNT_ID");
const treasuryPrivateKey = process.env.HEDERA_TOKEN_TREASURY_PRIVATE_KEY?.trim() || required("HEDERA_CLIENT_PRIVATE_KEY");
const tokenConfig: HtsSettlementTokenConfig = {
  tokenName: required("HEDERA_TOKEN_NAME"),
  tokenSymbol: required("HEDERA_TOKEN_SYMBOL"),
  decimals: safeInteger("HEDERA_TOKEN_DECIMALS"),
  initialSupply: required("HEDERA_TOKEN_INITIAL_SUPPLY"),
  treasuryAccountId,
  feeCollectorAccountId: process.env.HEDERA_TOKEN_FEE_COLLECTOR_ACCOUNT_ID?.trim() || treasuryAccountId,
  feeAmount: required("HEDERA_TOKEN_FEE_AMOUNT"),
  ...(process.env.HEDERA_TOKEN_MEMO?.trim() ? { tokenMemo: process.env.HEDERA_TOKEN_MEMO.trim() } : {})
};
const associations = readCredentials("HEDERA_TOKEN_ASSOCIATIONS_JSON");
const distributions = readDistributions("HEDERA_TOKEN_DISTRIBUTIONS_JSON");
const treasuryClient = createHederaClient(network, treasuryAccountId, treasuryPrivateKey);
let createdToken: { tokenId: string; transactionId: string } | undefined;

try {
  createdToken = await createHtsSettlementToken(treasuryClient, tokenConfig);
  await assertHtsSettlementToken(treasuryClient, createdToken.tokenId, tokenConfig);
  await assertHtsTokenAssociation(treasuryClient, createdToken.tokenId, treasuryAccountId);

  const envPath = ".env";
  const envText = await readFile(envPath, "utf8");
  await writeFile(envPath, replaceEnvValue(envText, "HEDERA_ASSET_ID", createdToken.tokenId), "utf8");

  const associationResults = [];
  for (const credential of associations) {
    if (credential.accountId === treasuryAccountId) {
      associationResults.push({ accountId: credential.accountId, associated: true, skipped: true });
      continue;
    }
    const client = createHederaClient(network, credential.accountId, credential.privateKey);
    try {
      associationResults.push(await ensureHtsTokenAssociation(client, createdToken.tokenId));
    } finally {
      client.close();
    }
  }

  const distributionResults: HtsTransferResult[] = [];
  for (const distribution of distributions) {
    distributionResults.push(await transferHtsTokens(treasuryClient, createdToken.tokenId, distribution.accountId, distribution.amount));
  }
  console.log(JSON.stringify({
    network,
    token: { ...createdToken, treasuryAccountId, feeCollectorAccountId: tokenConfig.feeCollectorAccountId },
    associations: associationResults,
    distributions: distributionResults,
    envPath
  }, null, 2));
} catch (error) {
  const context = createdToken ? `; token ${createdToken.tokenId} was created in ${createdToken.transactionId}` : "";
  throw new Error(`VERITY_HTS_PROVISION_FAILED${context}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
} finally {
  treasuryClient.close();
}

interface TokenCredential {
  readonly accountId: string;
  readonly privateKey: string;
}

interface TokenDistribution {
  readonly accountId: string;
  readonly amount: string;
}

function readCredentials(name: string): readonly TokenCredential[] {
  const raw = process.env[name]?.trim();
  if (!raw) return [];
  const value = parseJson(raw, name);
  if (!Array.isArray(value)) throw new Error(`VERITY_CONFIG_INVALID: ${name} must contain a JSON array`);
  const seen = new Set<string>();
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`VERITY_CONFIG_INVALID: ${name}[${index}] must be an object`);
    }
    const candidate = entry as { accountId?: unknown; privateKey?: unknown };
    if (typeof candidate.accountId !== "string" || typeof candidate.privateKey !== "string") {
      throw new Error(`VERITY_CONFIG_INVALID: ${name}[${index}] requires accountId and privateKey`);
    }
    const accountId = candidate.accountId.trim();
    const privateKey = candidate.privateKey.trim();
    if (!accountId || !privateKey) throw new Error(`VERITY_CONFIG_INVALID: ${name}[${index}] contains an empty credential`);
    if (seen.has(accountId)) throw new Error(`VERITY_CONFIG_INVALID: ${name} contains duplicate account ${accountId}`);
    seen.add(accountId);
    return { accountId, privateKey };
  });
}

function readDistributions(name: string): readonly TokenDistribution[] {
  const raw = process.env[name]?.trim();
  if (!raw) return [];
  const value = parseJson(raw, name);
  if (!Array.isArray(value)) throw new Error(`VERITY_CONFIG_INVALID: ${name} must contain a JSON array`);
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`VERITY_CONFIG_INVALID: ${name}[${index}] must be an object`);
    }
    const candidate = entry as { accountId?: unknown; amount?: unknown };
    if (typeof candidate.accountId !== "string" || typeof candidate.amount !== "string") {
      throw new Error(`VERITY_CONFIG_INVALID: ${name}[${index}] requires accountId and amount`);
    }
    return { accountId: candidate.accountId.trim(), amount: candidate.amount.trim() };
  });
}

function parseJson(raw: string, name: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`VERITY_CONFIG_INVALID: ${name} must contain valid JSON`, { cause: error });
  }
}

function safeInteger(name: string): number {
  const value = Number(required(name));
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`VERITY_CONFIG_INVALID: ${name} must be a non-negative safe integer`);
  return value;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`VERITY_CONFIG_MISSING: ${name} is required; set it in .env`);
  return value;
}

function replaceEnvValue(source: string, name: string, value: string): string {
  const pattern = new RegExp(`^${name}=.*$`, "m");
  if (!pattern.test(source)) throw new Error(`VERITY_ENV_FIELD_MISSING: ${name} is missing from .env`);
  return source.replace(pattern, `${name}=${value}`);
}
