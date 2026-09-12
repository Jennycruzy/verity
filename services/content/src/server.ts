import { config as loadDotenv } from "dotenv";
import { fileURLToPath } from "node:url";
import { createContentServer } from "./app.js";
import { readContentServiceConfig } from "./config.js";

loadDotenv({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });

const config = readContentServiceConfig();
const server = createContentServer(config);
server.listen(config.port, () => console.log(JSON.stringify({ port: config.port, source: "content-store" })));
