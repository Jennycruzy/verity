import "dotenv/config";
import { readFile, writeFile } from "node:fs/promises";
import { createEcdsaAccount, createHederaClient } from "@verity/hcs";

const envPath = ".env";
const targetFields = [
  "HEDERA_PROVIDER_ACCOUNT_ID",
  "HEDERA_PROVIDER_PRIVATE_KEY",
  "HEDERA_PROVIDER_EVM_ADDRESS",
  "HEDERA_PAY_TO_ACCOUNT_ID"
] as const;
const configuredTargets = targetFields.filter((name) => process.env[name]?.trim());
if (configuredTargets.length > 0) {
  throw new Error(`VERITY_ACCOUNT_PROVISION_ALREADY_CONFIGURED: clear ${configuredTargets.join(", ")} only for a deliberate replacement`);
}

const network = required("HEDERA_NETWORK");
const payerAccountId = required("HEDERA_CLIENT_ACCOUNT_ID");
const payerPrivateKey = required("HEDERA_CLIENT_PRIVATE_KEY");
const initialBalance = required("HEDERA_ACCOUNT_INITIAL_BALANCE_HBAR");
const client = createHederaClient(network, payerAccountId, payerPrivateKey);
let provider: Awaited<ReturnType<typeof createEcdsaAccount>> | undefined;
let treasury: Awaited<ReturnType<typeof createEcdsaAccount>> | undefined;

try {
  provider = await createEcdsaAccount(client, initialBalance, "verity/provider/stake");
  treasury = await createEcdsaAccount(client, initialBalance, "verity/provider/treasury");
  let envText = await readFile(envPath, "utf8");
  envText = replaceEnvValue(envText, "HEDERA_PROVIDER_ACCOUNT_ID", provider.accountId);
  envText = replaceEnvValue(envText, "HEDERA_PROVIDER_PRIVATE_KEY", provider.privateKey);
  envText = replaceEnvValue(envText, "HEDERA_PROVIDER_EVM_ADDRESS", provider.evmAddress);
  envText = replaceEnvValue(envText, "HEDERA_PAY_TO_ACCOUNT_ID", treasury.accountId);
  await writeFile(envPath, envText, "utf8");
  console.log(JSON.stringify({
    network,
    provider: { accountId: provider.accountId, evmAddress: provider.evmAddress, transactionId: provider.transactionId },
    treasury: { accountId: treasury.accountId, evmAddress: treasury.evmAddress, transactionId: treasury.transactionId },
    envPath
  }, null, 2));
} catch (error) {
  const created = [
    provider ? `provider ${provider.accountId} in ${provider.transactionId}` : undefined,
    treasury ? `treasury ${treasury.accountId} in ${treasury.transactionId}` : undefined
  ].filter((value): value is string => Boolean(value));
  const context = created.length > 0 ? `; already-created accounts: ${created.join(", ")}` : "";
  throw new Error(`VERITY_ACCOUNT_PROVISION_FAILED${context}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
} finally {
  client.close();
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
