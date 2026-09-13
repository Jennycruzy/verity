import { Contract, Interface, JsonRpcProvider, Wallet, getAddress } from "ethers";
import { createErc8004Registration, normalizeErc8004AgentId, normalizeErc8004Registry, type Erc8004Registration } from "./erc8004.js";

const IDENTITY_REGISTRY_ABI = [
  "event Registered(uint256 indexed agentId, string agentURI, address indexed owner)",
  "function register() returns (uint256 agentId)",
  "function setAgentURI(uint256 agentId, string newURI)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "function getVersion() pure returns (string)"
] as const;

const IDENTITY_REGISTRY_INTERFACE = new Interface(IDENTITY_REGISTRY_ABI);

export interface Erc8004EvmRegistry {
  readonly reference: string;
  readonly chainId: string;
  readonly address: string;
}

export interface Erc8004AgentState {
  readonly agentId: string;
  readonly owner: string;
  readonly agentUri: string;
}

export interface Erc8004RegistrationTransaction {
  readonly agentId: string;
  readonly transactionHash: string;
}

export interface Erc8004UriTransaction {
  readonly agentId: string;
  readonly transactionHash: string;
  readonly agentUri: string;
}

export interface Erc8004RegistrationFileInput {
  readonly name: string;
  readonly description: string;
  readonly publicUrl: string;
  readonly registry: string;
  readonly agentId: string;
  readonly kind: "fx" | "entity";
}

export function parseErc8004EvmRegistry(value: string): Erc8004EvmRegistry {
  const reference = normalizeErc8004Registry(value);
  const [namespace, chainId, address] = reference.split(":");
  if (namespace !== "eip155" || !chainId || !address || !/^0x[0-9a-f]{40}$/.test(address)) {
    throw new Error("VERITY_ERC8004_REGISTRY_INVALID: live EVM registration requires eip155:chainId:0x<40-hex-address>");
  }
  return { reference, chainId, address: getAddress(address) };
}

export function resolveErc8004EvmRegistry(value: string, chainId: bigint | string): Erc8004EvmRegistry {
  const normalizedChainId = BigInt(chainId).toString(10);
  const normalized = value.trim();
  if (/^0x[0-9a-fA-F]{40}$/.test(normalized)) {
    const address = getAddress(normalized);
    return {
      reference: normalizeErc8004Registry(`eip155:${normalizedChainId}:${address}`),
      chainId: normalizedChainId,
      address
    };
  }
  const parsed = parseErc8004EvmRegistry(normalized);
  if (parsed.chainId !== normalizedChainId) {
    throw new Error(`VERITY_ERC8004_CHAIN_MISMATCH: registry expects eip155:${parsed.chainId}, RPC reported eip155:${normalizedChainId}`);
  }
  return parsed;
}

export function createErc8004AgentDataUri(input: Erc8004RegistrationFileInput): string {
  const registration = createErc8004Registration({
    name: input.name,
    description: input.description,
    services: [
      { name: "web", endpoint: appendPath(input.publicUrl, input.kind === "fx" ? "fx" : "entity"), version: "1" },
      { name: "cross-checker", endpoint: appendPath(input.publicUrl, "check"), version: "1" },
      { name: "agent-registration", endpoint: appendPath(input.publicUrl, ".well-known/agent-registration.json"), version: "1" }
    ],
    x402Support: true,
    active: true,
    registrations: [{ agentRegistry: input.registry, agentId: input.agentId }],
    supportedTrust: ["reputation", "crypto-economic"]
  });
  const encoded = Buffer.from(JSON.stringify(registration), "utf8").toString("base64");
  return `data:application/json;base64,${encoded}#verity-web-endpoint=${appendPath(input.publicUrl, input.kind === "fx" ? "fx" : "entity")}`;
}

export function parseErc8004AgentDataUri(uri: string): Erc8004Registration {
  const prefix = "data:application/json;base64,";
  if (!uri.startsWith(prefix)) throw new Error("VERITY_ERC8004_URI_INVALID: expected a base64 application/json data URI");
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(uri.slice(prefix.length), "base64").toString("utf8"));
  } catch (error) {
    throw new Error("VERITY_ERC8004_URI_INVALID: data URI did not contain valid JSON", { cause: error });
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("VERITY_ERC8004_URI_INVALID: data URI JSON must be an object");
  }
  return value as Erc8004Registration;
}

export class Erc8004IdentityRegistryClient {
  private readonly provider: JsonRpcProvider;
  private readonly wallet: Wallet;
  private readonly contract: Contract;
  private readonly registry: Erc8004EvmRegistry;

  public constructor(config: { readonly rpcUrl: string; readonly registry: string; readonly privateKey: string }) {
    const rpcUrl = config.rpcUrl.trim();
    if (!/^https?:\/\//.test(rpcUrl)) throw new Error("VERITY_ERC8004_RPC_INVALID: use an HTTP(S) JSON-RPC URL");
    this.registry = parseErc8004EvmRegistry(config.registry);
    this.provider = new JsonRpcProvider(rpcUrl, undefined, { staticNetwork: false });
    try {
      this.wallet = new Wallet(config.privateKey.trim(), this.provider);
    } catch (error) {
      throw new Error("VERITY_ERC8004_SIGNER_INVALID: HEDERA_PROVIDER_PRIVATE_KEY is not a usable ECDSA key", { cause: error });
    }
    this.contract = new Contract(this.registry.address, IDENTITY_REGISTRY_ABI, this.wallet);
  }

  public get registryReference(): string {
    return this.registry.reference;
  }

  public get signerAddress(): string {
    return this.wallet.address;
  }

  public async register(): Promise<Erc8004RegistrationTransaction> {
    await this.assertReady();
    const transaction = await this.contract.getFunction("register()")();
    const receipt = await transaction.wait();
    if (!receipt) throw new Error("VERITY_ERC8004_REGISTER_UNCONFIRMED: registration transaction was dropped before a receipt was returned");
    return {
      agentId: registeredAgentId(receipt.logs),
      transactionHash: receipt.hash
    };
  }

  public async setAgentUri(agentId: string, agentUri: string): Promise<Erc8004UriTransaction> {
    const normalizedAgentId = normalizeErc8004AgentId(agentId);
    const normalizedUri = requiredUri(agentUri);
    await this.assertReady();
    const owner = await this.contract.getFunction("ownerOf(uint256)")(normalizedAgentId) as string;
    if (owner.toLowerCase() !== this.wallet.address.toLowerCase()) {
      throw new Error(`VERITY_ERC8004_OWNER_MISMATCH: agent ${normalizedAgentId} is owned by ${owner}, not the configured provider signer`);
    }
    const transaction = await this.contract.getFunction("setAgentURI(uint256,string)")(normalizedAgentId, normalizedUri);
    const receipt = await transaction.wait();
    if (!receipt) throw new Error("VERITY_ERC8004_URI_UNCONFIRMED: URI transaction was dropped before a receipt was returned");
    const state = await this.readAgent(normalizedAgentId);
    if (state.agentUri !== normalizedUri) {
      throw new Error(`VERITY_ERC8004_URI_MISMATCH: registry returned ${state.agentUri} after setting ${normalizedUri}`);
    }
    return { agentId: normalizedAgentId, transactionHash: receipt.hash, agentUri: normalizedUri };
  }

  public async readAgent(agentId: string): Promise<Erc8004AgentState> {
    await this.assertReady();
    const normalizedAgentId = normalizeErc8004AgentId(agentId);
    const owner = await this.contract.getFunction("ownerOf(uint256)")(normalizedAgentId) as string;
    const agentUri = await this.contract.getFunction("tokenURI(uint256)")(normalizedAgentId) as string;
    return { agentId: normalizedAgentId, owner: getAddress(owner), agentUri };
  }

  public async close(): Promise<void> {
    this.provider.destroy();
  }

  private async assertReady(): Promise<void> {
    const network = await this.provider.getNetwork();
    if (network.chainId !== BigInt(this.registry.chainId)) {
      throw new Error(`VERITY_ERC8004_CHAIN_MISMATCH: registry expects eip155:${this.registry.chainId}, RPC reported eip155:${network.chainId}`);
    }
    const code = await this.provider.getCode(this.registry.address);
    if (code === "0x") throw new Error(`VERITY_ERC8004_REGISTRY_NOT_DEPLOYED: no contract bytecode at ${this.registry.address}`);
    const balance = await this.provider.getBalance(this.wallet.address);
    if (balance === 0n) throw new Error(`VERITY_ERC8004_FUNDS_REQUIRED: provider signer ${this.wallet.address} has no balance on eip155:${this.registry.chainId}; fund it before registration`);
    const version = await this.contract.getFunction("getVersion()")() as string;
    if (!version.trim()) throw new Error("VERITY_ERC8004_VERSION_MISSING: identity registry returned an empty protocol version");
  }
}

function registeredAgentId(logs: readonly unknown[]): string {
  for (const log of logs) {
    if (!isLogLike(log)) continue;
    try {
      const parsed = IDENTITY_REGISTRY_INTERFACE.parseLog({ topics: log.topics, data: log.data });
      if (parsed?.name === "Registered") return normalizeErc8004AgentId(String(parsed.args[0]));
    } catch {
      // Receipt logs from other contracts are expected; only the registry event matters.
    }
  }
  throw new Error("VERITY_ERC8004_AGENT_ID_MISSING: registration receipt contained no Registered event");
}

function isLogLike(value: unknown): value is { readonly topics: readonly string[]; readonly data: string } {
  return Boolean(value && typeof value === "object" && Array.isArray((value as { topics?: unknown }).topics) && typeof (value as { data?: unknown }).data === "string");
}

function requiredUri(value: string): string {
  const normalized = value.trim();
  if (!normalized || (!/^(https?|ipfs|data):/.test(normalized))) {
    throw new Error("VERITY_ERC8004_URI_INVALID: use an https, http, ipfs, or data URI");
  }
  return normalized;
}

function appendPath(base: string, path: string): string {
  const normalized = base.trim();
  let url: URL;
  try {
    url = new URL(normalized.endsWith("/") ? normalized : `${normalized}/`);
  } catch (error) {
    throw new Error("VERITY_ERC8004_PUBLIC_URL_INVALID: publicUrl must be an absolute URL", { cause: error });
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("VERITY_ERC8004_PUBLIC_URL_INVALID: publicUrl must use HTTP(S)");
  return new URL(path.replace(/^\//, ""), url).toString();
}
