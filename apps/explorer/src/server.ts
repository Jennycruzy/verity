import { config as loadDotenv } from "dotenv";
import { fileURLToPath } from "node:url";
import { GraphReputationClient } from "@verity/indexer";
import { createExplorerServer } from "./app.js";
import { readExplorerConfig, readQueryFile } from "./config.js";

loadDotenv({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });

const config = readExplorerConfig();
const client = new GraphReputationClient(
  config.graphEndpoint,
  { provider: await readQueryFile(config.providerQueryFile), buyer: await readQueryFile(config.buyerQueryFile) },
  fetch,
  config.graphApiKey
);
const server = createExplorerServer(client);
server.listen(config.port, () => console.log(JSON.stringify({ port: config.port, source: "graph" })));
