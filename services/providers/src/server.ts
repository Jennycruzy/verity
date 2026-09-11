import "dotenv/config";
import { readProviderServiceConfig } from "./config.js";
import { startProvider } from "./app.js";

startProvider(readProviderServiceConfig());
