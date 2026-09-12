import { config as loadDotenv } from "dotenv";
import { fileURLToPath } from "node:url";
import { createGraphGatewayServer } from "./app.js";
import { readGraphGatewayConfig } from "./config.js";

loadDotenv({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });

const config = readGraphGatewayConfig();
createGraphGatewayServer(config).listen(config.port, () => {
  process.stdout.write(`Verity Graph gateway listening on ${config.port}\n`);
});
