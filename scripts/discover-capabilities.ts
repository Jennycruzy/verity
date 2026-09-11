import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { Blocky402Client, discoverHederaCapability } from "@verity/hedera";
import { readDiscoveryConfig } from "@verity/hedera";

const config = readDiscoveryConfig();
const client = new Blocky402Client(config.facilitatorUrl);
const supported = await client.supported();
const capability = await discoverHederaCapability(client, config.network);

await mkdir("artifacts", { recursive: true });
await writeFile(
  "artifacts/capabilities.json",
  `${JSON.stringify({ observedAt: new Date().toISOString(), capability, supported }, null, 2)}\n`,
  "utf8"
);

console.log(JSON.stringify({ capability, supported }, null, 2));
