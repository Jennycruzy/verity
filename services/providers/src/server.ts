import { config as loadDotenv } from "dotenv";
import { fileURLToPath } from "node:url";
import { isAbsolute, resolve } from "node:path";
import { createBuyerReputationPolicy } from "./buyer-policy.js";
import { readProviderServiceConfig } from "./config.js";
import { startProvider } from "./app.js";

loadDotenv({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });

const projectRoot = fileURLToPath(new URL("../../../", import.meta.url));
const config = readProviderServiceConfig();
const buyerReputation = await createBuyerReputationPolicy(
  config.buyerReputation
    ? { ...config.buyerReputation, queryFile: resolveProjectPath(config.buyerReputation.queryFile) }
    : undefined
);
startProvider(config, buyerReputation);

function resolveProjectPath(value: string): string {
  return isAbsolute(value) ? value : resolve(projectRoot, value);
}
