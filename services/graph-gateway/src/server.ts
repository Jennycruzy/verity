import { config as loadDotenv } from "dotenv";
import { fileURLToPath } from "node:url";
import { createGraphGatewayServer } from "./app.js";
import { readGraphGatewayConfig } from "./config.js";

loadDotenv({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });

const config = readGraphGatewayConfig();
const host = process.env.GRAPH_GATEWAY_HOST?.trim() || process.env.VERITY_BIND_HOST?.trim() || "0.0.0.0";

createGraphGatewayServer(config).listen(config.port, host, () => {
  process.stdout.write(`Verity Graph gateway listening on http://${host}:${config.port}\n`);
});
