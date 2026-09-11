import "dotenv/config";
import { readFile, writeFile } from "node:fs/promises";
import { createHederaClient, ensureTopic } from "@verity/hcs";

const envPath = ".env";
const network = required("HEDERA_NETWORK");
const accountId = required("HEDERA_CLIENT_ACCOUNT_ID");
const privateKey = required("HEDERA_CLIENT_PRIVATE_KEY");
const client = createHederaClient(network, accountId, privateKey);

try {
  let envText = await readFile(envPath, "utf8");
  const settlement = await ensureTopic(client, optional("HCS_SETTLEMENT_TOPIC_ID"), "verity/settlements/v1");
  envText = replaceEnvValue(envText, "HCS_SETTLEMENT_TOPIC_ID", settlement.topicId);
  await writeFile(envPath, envText, "utf8");

  const dispute = await ensureTopic(client, optional("HCS_DISPUTE_TOPIC_ID"), "verity/disputes/v1");
  envText = replaceEnvValue(envText, "HCS_DISPUTE_TOPIC_ID", dispute.topicId);

  await writeFile(envPath, envText, "utf8");
  console.log(JSON.stringify({ network, settlement, dispute, envPath }, null, 2));
} finally {
  client.close();
}

function optional(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
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
