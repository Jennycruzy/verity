import { config as loadDotenv } from "dotenv";
import { fileURLToPath } from "node:url";
import { readProviderServiceConfig } from "./config.js";
import { startProvider } from "./app.js";

loadDotenv({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });

startProvider(readProviderServiceConfig());
