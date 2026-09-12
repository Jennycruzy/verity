import { config as loadDotenv } from "dotenv";
import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const root = fileURLToPath(new URL("..", import.meta.url));
const cli = fileURLToPath(new URL("../graph/subgraph/node_modules/.bin/graph", import.meta.url));
const manifest = fileURLToPath(new URL("../graph/subgraph/subgraph.yaml", import.meta.url));

loadDotenv({ path: fileURLToPath(new URL("../.env", import.meta.url)) });

const name = required("GRAPH_STUDIO_SUBGRAPH");
const deployKey = required("GRAPH_STUDIO_DEPLOY_KEY");
const version = required("GRAPH_STUDIO_VERSION_LABEL");
await access(manifest);

try {
  const result = await execFileAsync(cli, [
    "deploy",
    name,
    manifest,
    "--studio",
    "--deploy-key",
    deployKey,
    "--version-label",
    version
  ], { cwd: root, maxBuffer: 1024 * 1024 });
  process.stdout.write(redact(`${result.stdout}${result.stderr}`, deployKey));
} catch (error) {
  const output = commandOutput(error);
  throw new Error(`VERITY_GRAPH_DEPLOY_FAILED: ${redact(output, deployKey)}`, { cause: error });
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`VERITY_CONFIG_MISSING: ${name} is required; set it in .env`);
  return value;
}

function commandOutput(error: unknown): string {
  if (!error || typeof error !== "object") return "Graph CLI failed without diagnostic output";
  const candidate = error as { stdout?: unknown; stderr?: unknown };
  const output = `${typeof candidate.stdout === "string" ? candidate.stdout : ""}${typeof candidate.stderr === "string" ? candidate.stderr : ""}`.trim();
  return output || "Graph CLI failed without diagnostic output";
}

function redact(value: string, secret: string): string {
  return value.split(secret).join("[REDACTED]");
}
