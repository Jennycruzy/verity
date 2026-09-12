import "dotenv/config";
import { formatEther, JsonRpcProvider, Wallet } from "ethers";
import { resolveErc8004EvmRegistry } from "@verity/indexer";

const rpcUrl = requiredUrl("GRAPH_FEEDBACK_RPC_URL");
const registryInput = required("GRAPH_FEEDBACK_IDENTITY_REGISTRY");
const providerKey = required("GRAPH_FEEDBACK_PROVIDER_PRIVATE_KEY");
const buyerKey = required("GRAPH_FEEDBACK_BUYER_PRIVATE_KEY");
const rpc = new JsonRpcProvider(rpcUrl, undefined, { staticNetwork: false });

try {
  const network = await rpc.getNetwork();
  const registry = resolveErc8004EvmRegistry(registryInput, network.chainId);
  if (network.chainId !== BigInt(registry.chainId)) {
    throw new Error(`VERITY_GRAPH_SIGNER_CHAIN_MISMATCH: registry expects eip155:${registry.chainId}, RPC reported eip155:${network.chainId}`);
  }
  const signers = await Promise.all([
    readSigner(rpc, "provider", providerKey),
    readSigner(rpc, "buyer", buyerKey)
  ]);
  console.log(JSON.stringify({ network: `eip155:${network.chainId}`, registry: registry.reference, signers }, null, 2));
  if (signers.some((signer) => signer.balanceWei === "0")) process.exitCode = 1;
} finally {
  rpc.destroy();
}

async function readSigner(rpc: JsonRpcProvider, role: "provider" | "buyer", privateKey: string): Promise<SignerStatus> {
  const wallet = new Wallet(privateKey);
  const balance = await rpc.getBalance(wallet.address);
  return {
    role,
    address: wallet.address,
    balanceWei: balance.toString(),
    balanceEth: formatEther(balance),
    state: balance > 0n ? "ready" : "funding-required"
  };
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
    throw new Error(`VERITY_CONFIG_INVALID: ${name} must be an absolute URL`, { cause: error });
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error(`VERITY_CONFIG_INVALID: ${name} must use HTTP(S)`);
  return value;
}

interface SignerStatus {
  readonly role: "provider" | "buyer";
  readonly address: string;
  readonly balanceWei: string;
  readonly balanceEth: string;
  readonly state: "ready" | "funding-required";
}
