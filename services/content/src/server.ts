import { config as loadDotenv } from "dotenv";
import { fileURLToPath } from "node:url";
import { createContentServer } from "./app.js";
import { readContentServiceConfig } from "./config.js";

loadDotenv({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });

const config = readContentServiceConfig();
const server = createContentServer(config);
const host = process.env.CONTENT_STORE_HOST?.trim() || process.env.VERITY_BIND_HOST?.trim() || "0.0.0.0";
server.listen(config.port, host, () => console.log(JSON.stringify({ host, port: config.port, source: "content-store" })));
