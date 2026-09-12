import { config as loadDotenv } from "dotenv";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { getAddress, JsonRpcProvider } from "ethers";

const execFileAsync = promisify(execFile);
const envPath = fileURLToPath(new URL("../.env", import.meta.url));
const templatePath = fileURLToPath(new URL("../graph/subgraph/subgraph.yaml.template", import.meta.url));
const outputPath = fileURLToPath(new URL("../graph/subgraph/subgraph.yaml", import.meta.url));
const substreamsTemplatePath = fileURLToPath(new URL("../graph/substreams/substreams.yaml.template", import.meta.url));
const substreamsBuildPath = fileURLToPath(new URL("../graph/substreams/build", import.meta.url));
const substreamsManifestPath = fileURLToPath(new URL("../graph/substreams/build/substreams.yaml", import.meta.url));
const substreamsPackagePath = fileURLToPath(new URL("../graph/substreams/build/verity-agent-feedback-v0.1.0.spkg", import.meta.url));
const configTemplatePath = fileURLToPath(new URL("../graph/subgraph/src/config.ts.template", import.meta.url));
const configOutputPath = fileURLToPath(new URL("../graph/subgraph/src/config.ts", import.meta.url));

loadDotenv({ path: envPath });

const network = required("GRAPH_SUBGRAPH_NETWORK");
if (network !== "base-sepolia") {
  throw new Error(`VERITY_GRAPH_NETWORK_UNSUPPORTED: ${network} is not the network used by the committed Agent0 Substreams package; set GRAPH_SUBGRAPH_NETWORK=base-sepolia`);
}

const rpcUrl = requiredUrl("GRAPH_FEEDBACK_RPC_URL");
const identityRegistry = requiredAddress("GRAPH_FEEDBACK_IDENTITY_REGISTRY");
const reputationRegistry = requiredAddress("GRAPH_FEEDBACK_REPUTATION_REGISTRY");
const startBlock = optionalDecimal("GRAPH_SUBSTREAM_START_BLOCK") ?? "0";
const provider = new JsonRpcProvider(rpcUrl, undefined, { staticNetwork: false });

try {
  const chain = await provider.getNetwork();
  const identityCode = await provider.getCode(identityRegistry);
  const reputationCode = await provider.getCode(reputationRegistry);
  if (identityCode === "0x") {
    throw new Error(`VERITY_GRAPH_IDENTITY_REGISTRY_NOT_DEPLOYED: no bytecode at ${identityRegistry}`);
  }
  if (reputationCode === "0x") {
    throw new Error(`VERITY_GRAPH_REPUTATION_REGISTRY_NOT_DEPLOYED: no bytecode at ${reputationRegistry}`);
  }

  const packageTemplate = await readFile(substreamsTemplatePath, "utf8");
  const packageManifest = replaceTokens(packageTemplate, {
    GRAPH_SUBGRAPH_NETWORK: network,
    GRAPH_SUBSTREAM_START_BLOCK: startBlock,
    GRAPH_FEEDBACK_IDENTITY_REGISTRY: identityRegistry,
    GRAPH_FEEDBACK_REPUTATION_REGISTRY: reputationRegistry
  });
  await mkdir(substreamsBuildPath, { recursive: true });
  await writeFile(substreamsManifestPath, packageManifest, "utf8");
  try {
    await execFileAsync("substreams", ["pack", substreamsManifestPath, "--output-file", substreamsPackagePath], {
      cwd: substreamsBuildPath
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`VERITY_GRAPH_SUBSTREAM_PACK_FAILED: ${detail}`, { cause: error });
  }

  const template = await readFile(templatePath, "utf8");
  const rendered = replaceTokens(template, {
    GRAPH_SUBGRAPH_NETWORK: network
  });
  await writeFile(outputPath, rendered, "utf8");
  const configTemplate = await readFile(configTemplatePath, "utf8");
  await writeFile(configOutputPath, replaceTokens(configTemplate, {
    GRAPH_AGENT0_CHAIN_ID: chain.chainId.toString()
  }), "utf8");
  console.log(JSON.stringify({
    network,
    chainId: chain.chainId.toString(),
    identityRegistry,
    reputationRegistry,
    manifest: outputPath,
    sourcePackage: substreamsPackagePath,
    startBlock
  }, null, 2));
} finally {
  provider.destroy();
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`VERITY_CONFIG_MISSING: ${name} is required; set it in .env`);
  return value;
}

function requiredUrl(name: string): string {
  const value = required(name);
  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    throw new Error(`VERITY_CONFIG_INVALID: ${name} must be an absolute HTTP(S) URL`, { cause: error });
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`VERITY_CONFIG_INVALID: ${name} must use HTTP(S)`);
  }
  return url.toString();
}

function requiredAddress(name: string): string {
  const value = required(name);
  try {
    return getAddress(value);
  } catch (error) {
    throw new Error(`VERITY_CONFIG_INVALID: ${name} must be a 20-byte EVM address`, { cause: error });
  }
}

function optionalDecimal(name: string): string | undefined {
  const value = process.env[name]?.trim();
  if (!value) return undefined;
  if (!/^\d+$/.test(value)) throw new Error(`VERITY_CONFIG_INVALID: ${name} must be a non-negative integer`);
  return BigInt(value).toString(10);
}

function replaceTokens(source: string, values: Readonly<Record<string, string>>): string {
  let rendered = source;
  for (const [name, value] of Object.entries(values)) {
    const token = `\${${name}}`;
    if (!rendered.includes(token)) throw new Error(`VERITY_GRAPH_TEMPLATE_TOKEN_MISSING: ${token}`);
    rendered = rendered.split(token).join(value);
  }
  const unresolved = /\$\{[A-Z0-9_]+\}/.exec(rendered);
  if (unresolved) throw new Error(`VERITY_GRAPH_TEMPLATE_UNRESOLVED: ${unresolved[0]}`);
  return rendered;
}
