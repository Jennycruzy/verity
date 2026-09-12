import { config as loadDotenv } from "dotenv";
import { fileURLToPath } from "node:url";
import { createWorldIdServer } from "./app.js";
import { readWorldIdServiceConfig } from "./config.js";

loadDotenv({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });
const config = readWorldIdServiceConfig();
createWorldIdServer(config).listen(config.port, () => {
  process.stdout.write(`Verity World ID service listening on ${config.port}\n`);
});
