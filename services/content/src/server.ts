import "dotenv/config";
import { createContentServer } from "./app.js";
import { readContentServiceConfig } from "./config.js";

const config = readContentServiceConfig();
const server = createContentServer(config);
server.listen(config.port, () => console.log(JSON.stringify({ port: config.port, source: "content-store" })));
