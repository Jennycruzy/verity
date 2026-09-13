import { config as loadDotenv } from "dotenv";
import { execFile } from "node:child_process";
import { access, readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const root = fileURLToPath(new URL("..", import.meta.url));
const cli = fileURLToPath(new URL("../graph/subgraph/node_modules/.bin/graph", import.meta.url));
const manifest = fileURLToPath(new URL("../graph/subgraph/subgraph.yaml", import.meta.url));
const envPath = fileURLToPath(new URL("../.env", import.meta.url));

loadDotenv({ path: fileURLToPath(new URL("../.env", import.meta.url)) });

const name = required("GRAPH_STUDIO_SUBGRAPH");
const deployKey = required("GRAPH_STUDIO_DEPLOY_KEY");
const version = required("GRAPH_STUDIO_VERSION_LABEL");
await access(manifest);

let output: string;
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
  output = `${result.stdout}${result.stderr}`;
} catch (error) {
  const output = commandOutput(error);
  throw new Error(`VERITY_GRAPH_DEPLOY_FAILED: ${redact(output, deployKey)}`, { cause: error });
}

const queryEndpoint = readQueryEndpoint(output);
try {
  await updateEnvQueryEndpoint(queryEndpoint);
} catch (error) {
  throw new Error(`VERITY_GRAPH_ENV_UPDATE_FAILED: deployed Graph manifest, but could not persist GRAPH_STUDIO_QUERY_URL: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
}
process.stdout.write(redact(output, deployKey));

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

function readQueryEndpoint(output: string): string {
  const match = /Queries \(HTTP\):\s+(https?:\/\/\S+)/.exec(output);
  if (!match?.[1]) throw new Error("VERITY_GRAPH_DEPLOY_ENDPOINT_MISSING: Graph CLI did not return a Studio query endpoint");
  return stripAnsi(match[1]).trim();
}

function stripAnsi(value: string): string {
  return value.replace(/[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g, "");
}

async function updateEnvQueryEndpoint(endpoint: string): Promise<void> {
  const source = await readFile(envPath, "utf8");
  const pattern = /^GRAPH_STUDIO_QUERY_URL=.*$/m;
  if (!pattern.test(source)) throw new Error("VERITY_ENV_FIELD_MISSING: GRAPH_STUDIO_QUERY_URL is missing from .env");
  await writeFile(envPath, source.replace(pattern, `GRAPH_STUDIO_QUERY_URL=${endpoint}`), "utf8");
}
