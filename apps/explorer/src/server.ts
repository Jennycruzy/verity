import { config as loadDotenv } from "dotenv";
import { fileURLToPath } from "node:url";
import { isAbsolute, resolve } from "node:path";
import { GraphReputationClient } from "@verity/indexer";
import { createExplorerServer } from "./app.js";
import { ProcessDemoRunner } from "./demo-runner.js";
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
const demoCooldownMs = optionalPositiveInteger("EXPLORER_DEMO_COOLDOWN_MS");
const demoTimeoutMs = optionalPositiveInteger("EXPLORER_DEMO_TIMEOUT_MS");
const demo = process.env.EXPLORER_INTERACTIVE_DEMO?.trim() === "true"
  ? new ProcessDemoRunner({
      projectRoot,
      ...(demoCooldownMs !== undefined ? { cooldownMs: demoCooldownMs } : {}),
      ...(demoTimeoutMs !== undefined ? { timeoutMs: demoTimeoutMs } : {})
    })
  : undefined;
const server = createExplorerServer(client, demo);
const host = process.env.EXPLORER_HOST?.trim() || process.env.VERITY_BIND_HOST?.trim() || "0.0.0.0";
server.listen(config.port, host, () => console.log(JSON.stringify({ host, port: config.port, source: "graph" })));

function resolveProjectPath(value: string): string {
  return isAbsolute(value) ? value : resolve(projectRoot, value);
}

function optionalPositiveInteger(name: string): number | undefined {
  const raw = process.env[name]?.trim();
  if (!raw) return undefined;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`VERITY_CONFIG_INVALID: ${name} must be a positive integer`);
  return value;
}
