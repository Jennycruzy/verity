import "dotenv/config";
import { Wallet } from "ethers";
import { readFile, writeFile } from "node:fs/promises";

const envPath = ".env";
const providerKeyName = "GRAPH_FEEDBACK_PROVIDER_PRIVATE_KEY";
const buyerKeyName = "GRAPH_FEEDBACK_BUYER_PRIVATE_KEY";
const source = await readFile(envPath, "utf8");
const existingProvider = process.env[providerKeyName]?.trim();
const existingBuyer = process.env[buyerKeyName]?.trim();
if (existingProvider || existingBuyer) {
  throw new Error(`VERITY_GRAPH_SIGNERS_EXIST: ${providerKeyName} and ${buyerKeyName} are one-time local credentials; refuse to overwrite them`);
}

const provider = Wallet.createRandom();
const buyer = Wallet.createRandom();
let updated = replaceEnvValue(source, providerKeyName, provider.privateKey);
updated = replaceEnvValue(updated, buyerKeyName, buyer.privateKey);
await writeFile(envPath, updated, "utf8");

console.log(JSON.stringify({
  providerAddress: provider.address,
  buyerAddress: buyer.address,
  envPath,
  next: "check these two public addresses on Base Sepolia, then fund each before registration"
}, null, 2));

function replaceEnvValue(value: string, name: string, replacement: string): string {
  const pattern = new RegExp(`^${name}=.*$`, "m");
  if (!pattern.test(value)) throw new Error(`VERITY_ENV_FIELD_MISSING: ${name} is missing from .env`);
  return value.replace(pattern, `${name}=${replacement}`);
}
