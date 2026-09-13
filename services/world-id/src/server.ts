import { config as loadDotenv } from "dotenv";
import { fileURLToPath } from "node:url";
import { createWorldIdServer } from "./app.js";
import { readWorldIdServiceConfig } from "./config.js";

loadDotenv({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });
const config = readWorldIdServiceConfig();
const host = process.env.WORLD_ID_HOST?.trim() || "0.0.0.0";

createWorldIdServer(config).listen(config.port, host, () => {
  process.stdout.write(`Verity World ID service listening on http://${host}:${config.port}\n`);
});
