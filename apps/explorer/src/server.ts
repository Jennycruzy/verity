import { config as loadDotenv } from "dotenv";
import { fileURLToPath } from "node:url";
import { isAbsolute, resolve } from "node:path";
import { GraphReputationClient } from "@verity/indexer";
import { createExplorerServer } from "./app.js";
import { readExplorerConfig, readQueryFile } from "./config.js";

loadDotenv({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });

const config = readExplorerConfig();
const projectRoot = fileURLToPath(new URL("../../../", import.meta.url));
const client = new GraphReputationClient(
  config.graphEndpoint,
  {
    provider: await readQueryFile(resolveProjectPath(config.providerQueryFile)),
    buyer: await readQueryFile(resolveProjectPath(config.buyerQueryFile))
  },
  fetch,
  config.graphApiKey
);
const server = createExplorerServer(client);
server.listen(config.port, () => console.log(JSON.stringify({ port: config.port, source: "graph" })));

function resolveProjectPath(value: string): string {
  return isAbsolute(value) ? value : resolve(projectRoot, value);
}
