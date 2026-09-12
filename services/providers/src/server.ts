import { config as loadDotenv } from "dotenv";
import { fileURLToPath } from "node:url";
import { createBuyerReputationPolicy } from "./buyer-policy.js";
import { readProviderServiceConfig } from "./config.js";
import { startProvider } from "./app.js";

loadDotenv({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });

const config = readProviderServiceConfig();
const buyerReputation = await createBuyerReputationPolicy(config.buyerReputation);
startProvider(config, buyerReputation);
