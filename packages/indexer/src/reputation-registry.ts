import { Contract, Interface, JsonRpcProvider, Wallet, getAddress } from "ethers";
import { normalizeErc8004AgentId } from "./erc8004.js";
import { parseErc8004EvmRegistry, type Erc8004EvmRegistry } from "./identity-registry.js";

const REPUTATION_REGISTRY_ABI = [
  "event NewFeedback(uint256 indexed agentId,address indexed clientAddress,uint64 feedbackIndex,int128 value,uint8 valueDecimals,string indexed indexedTag1,string tag1,string tag2,string endpoint,string feedbackURI,bytes32 feedbackHash)",
  "function getIdentityRegistry() view returns (address)",
  "function giveFeedback(uint256 agentId,int128 value,uint8 valueDecimals,string tag1,string tag2,string endpoint,string feedbackURI,bytes32 feedbackHash)"
] as const;

const REPUTATION_REGISTRY_INTERFACE = new Interface(REPUTATION_REGISTRY_ABI);

export const VERITY_PROVIDER_FEEDBACK_TAG = "verity-provider" as const;
export const VERITY_BUYER_FEEDBACK_TAG = "verity-buyer" as const;
export const VERITY_PROVIDER_FEEDBACK_DECIMALS = 2 as const;

export interface VerityAgentFeedback {
  readonly agentId: string;
  readonly value: "0" | "100";
  readonly valueDecimals: typeof VERITY_PROVIDER_FEEDBACK_DECIMALS;
  readonly tag1: typeof VERITY_PROVIDER_FEEDBACK_TAG | typeof VERITY_BUYER_FEEDBACK_TAG;
  readonly tag2: "correct" | "incorrect" | "honest" | "dishonest";
  readonly endpoint: string;
  readonly feedbackURI: string;
  readonly feedbackHash: string;
}

export type VerityProviderFeedback = VerityAgentFeedback & {
  readonly tag1: typeof VERITY_PROVIDER_FEEDBACK_TAG;
  readonly tag2: "correct" | "incorrect";
};

export type VerityBuyerFeedback = VerityAgentFeedback & {
  readonly tag1: typeof VERITY_BUYER_FEEDBACK_TAG;
  readonly tag2: "honest" | "dishonest";
};

export interface Erc8004FeedbackTransaction extends VerityAgentFeedback {
  readonly transactionHash: string;
  readonly feedbackIndex: string;
  readonly clientAddress: string;
}

export function createVerityProviderFeedback(input: {
  readonly agentId: string;
  readonly providerWasCorrect: boolean;
  readonly endpoint: string;
  readonly feedbackURI?: string;
  readonly feedbackHash?: string;
}): VerityProviderFeedback {
  return createVerityFeedback({
    agentId: input.agentId,
    outcome: input.providerWasCorrect,
    subject: "provider",
    endpoint: input.endpoint,
    ...(input.feedbackURI === undefined ? {} : { feedbackURI: input.feedbackURI }),
    ...(input.feedbackHash === undefined ? {} : { feedbackHash: input.feedbackHash })
  });
}

export function createVerityBuyerFeedback(input: {
  readonly agentId: string;
  readonly buyerWasHonest: boolean;
  readonly endpoint?: string;
  readonly feedbackURI?: string;
  readonly feedbackHash?: string;
}): VerityBuyerFeedback {
  return createVerityFeedback({
    agentId: input.agentId,
    outcome: input.buyerWasHonest,
    subject: "buyer",
    ...(input.endpoint === undefined ? {} : { endpoint: input.endpoint }),
    ...(input.feedbackURI === undefined ? {} : { feedbackURI: input.feedbackURI }),
    ...(input.feedbackHash === undefined ? {} : { feedbackHash: input.feedbackHash })
  });
}

interface ProviderFeedbackInput {
  readonly agentId: string;
  readonly outcome: boolean;
  readonly subject: "provider";
  readonly endpoint: string;
  readonly feedbackURI?: string;
  readonly feedbackHash?: string;
}

interface BuyerFeedbackInput {
  readonly agentId: string;
  readonly outcome: boolean;
  readonly subject: "buyer";
  readonly endpoint?: string;
  readonly feedbackURI?: string;
  readonly feedbackHash?: string;
}

function createVerityFeedback(input: ProviderFeedbackInput): VerityProviderFeedback;
function createVerityFeedback(input: BuyerFeedbackInput): VerityBuyerFeedback;
function createVerityFeedback(input: ProviderFeedbackInput | BuyerFeedbackInput): VerityProviderFeedback | VerityBuyerFeedback {
  const agentId = normalizeErc8004AgentId(input.agentId);
  const endpoint = input.subject === "provider"
    ? requiredHttpUrl(input.endpoint ?? "", "endpoint")
    : input.endpoint === undefined ? "" : requiredHttpUrl(input.endpoint, "endpoint");
  const feedbackURI = input.feedbackURI?.trim() ?? "";
  if (feedbackURI && !/^(https?|ipfs|data):/.test(feedbackURI)) {
    throw new Error("VERITY_ERC8004_FEEDBACK_URI_INVALID: use an HTTP(S), IPFS, or data URI");
  }
  const feedbackHash = input.feedbackHash?.trim() || zeroHash();
  if (!/^0x[0-9a-fA-F]{64}$/.test(feedbackHash)) {
    throw new Error("VERITY_ERC8004_FEEDBACK_HASH_INVALID: feedbackHash must be a 32-byte hex value");
  }
  if (!feedbackURI && feedbackHash !== zeroHash()) {
    throw new Error("VERITY_ERC8004_FEEDBACK_HASH_WITHOUT_URI: feedbackHash requires feedbackURI");
  }
  if (input.subject === "provider") {
    return {
      agentId,
      value: input.outcome ? "100" : "0",
      valueDecimals: VERITY_PROVIDER_FEEDBACK_DECIMALS,
      tag1: VERITY_PROVIDER_FEEDBACK_TAG,
      tag2: input.outcome ? "correct" : "incorrect",
      endpoint,
      feedbackURI,
      feedbackHash
    };
  }
  return {
    agentId,
    value: input.outcome ? "100" : "0",
    valueDecimals: VERITY_PROVIDER_FEEDBACK_DECIMALS,
    tag1: VERITY_BUYER_FEEDBACK_TAG,
    tag2: input.outcome ? "honest" : "dishonest",
    endpoint,
    feedbackURI,
    feedbackHash
  };
}

export class Erc8004ReputationRegistryClient {
  private readonly provider: JsonRpcProvider;
  private readonly wallet: Wallet;
  private readonly contract: Contract;
  private readonly identityContract: Contract;
  private readonly reputationRegistry: Erc8004EvmRegistry;
  private readonly identityRegistry: Erc8004EvmRegistry;

  public constructor(config: {
    readonly rpcUrl: string;
    readonly reputationRegistry: string;
    readonly identityRegistry: string;
    readonly privateKey: string;
  }) {
    const rpcUrl = config.rpcUrl.trim();
    if (!/^https?:\/\//.test(rpcUrl)) throw new Error("VERITY_ERC8004_RPC_INVALID: use an HTTP(S) JSON-RPC URL");
    this.reputationRegistry = parseErc8004EvmRegistry(config.reputationRegistry);
    this.identityRegistry = parseErc8004EvmRegistry(config.identityRegistry);
    if (this.reputationRegistry.chainId !== this.identityRegistry.chainId) {
      throw new Error("VERITY_ERC8004_REGISTRY_CHAIN_MISMATCH: identity and reputation registries must use the same chain");
    }
    this.provider = new JsonRpcProvider(rpcUrl, undefined, { staticNetwork: false });
    try {
      this.wallet = new Wallet(config.privateKey.trim(), this.provider);
    } catch (error) {
      throw new Error("VERITY_ERC8004_SIGNER_INVALID: configured private key is not a usable ECDSA key", { cause: error });
    }
    this.contract = new Contract(this.reputationRegistry.address, REPUTATION_REGISTRY_ABI, this.wallet);
    this.identityContract = new Contract(this.identityRegistry.address, [
      "function ownerOf(uint256 tokenId) view returns (address)"
    ], this.provider);
  }

  public get signerAddress(): string {
    return this.wallet.address;
  }

  public get reputationRegistryReference(): string {
    return this.reputationRegistry.reference;
  }

  public async giveProviderFeedback(input: {
    readonly agentId: string;
    readonly providerWasCorrect: boolean;
    readonly endpoint: string;
    readonly feedbackURI?: string;
    readonly feedbackHash?: string;
  }): Promise<Erc8004FeedbackTransaction> {
    return this.giveFeedback({
      agentId: input.agentId,
      outcome: input.providerWasCorrect,
      subject: "provider",
      endpoint: input.endpoint,
      ...(input.feedbackURI === undefined ? {} : { feedbackURI: input.feedbackURI }),
      ...(input.feedbackHash === undefined ? {} : { feedbackHash: input.feedbackHash })
    });
  }

  public async giveBuyerFeedback(input: {
    readonly agentId: string;
    readonly buyerWasHonest: boolean;
    readonly endpoint?: string;
    readonly feedbackURI?: string;
    readonly feedbackHash?: string;
  }): Promise<Erc8004FeedbackTransaction> {
    return this.giveFeedback({
      agentId: input.agentId,
      outcome: input.buyerWasHonest,
      subject: "buyer",
      ...(input.endpoint === undefined ? {} : { endpoint: input.endpoint }),
      ...(input.feedbackURI === undefined ? {} : { feedbackURI: input.feedbackURI }),
      ...(input.feedbackHash === undefined ? {} : { feedbackHash: input.feedbackHash })
    });
  }

  private async giveFeedback(input: ProviderFeedbackInput): Promise<Erc8004FeedbackTransaction>;
  private async giveFeedback(input: BuyerFeedbackInput): Promise<Erc8004FeedbackTransaction>;
  private async giveFeedback(input: ProviderFeedbackInput | BuyerFeedbackInput): Promise<Erc8004FeedbackTransaction> {
    const normalized = input.subject === "provider"
      ? createVerityFeedback(input)
      : createVerityFeedback(input);
    await this.assertReady();
    await this.assertAgentExists(normalized.agentId);
    const transaction = await this.contract.getFunction("giveFeedback(uint256,int128,uint8,string,string,string,string,bytes32)")(
      normalized.agentId,
      normalized.value,
      normalized.valueDecimals,
      normalized.tag1,
      normalized.tag2,
      normalized.endpoint,
      normalized.feedbackURI,
      normalized.feedbackHash
    );
    const receipt = await transaction.wait();
    if (!receipt) throw new Error("VERITY_ERC8004_FEEDBACK_UNCONFIRMED: transaction was dropped before a receipt was returned");
    const event = feedbackEvent(receipt.logs, normalized.agentId, this.wallet.address);
    return { ...normalized, transactionHash: receipt.hash, feedbackIndex: event.feedbackIndex, clientAddress: event.clientAddress };
  }

  public async close(): Promise<void> {
    this.provider.destroy();
  }

  private async assertReady(): Promise<void> {
    const network = await this.provider.getNetwork();
    if (network.chainId !== BigInt(this.reputationRegistry.chainId)) {
      throw new Error(`VERITY_ERC8004_CHAIN_MISMATCH: registry expects eip155:${this.reputationRegistry.chainId}, RPC reported eip155:${network.chainId}`);
    }
    const reputationCode = await this.provider.getCode(this.reputationRegistry.address);
    if (reputationCode === "0x") throw new Error(`VERITY_ERC8004_REPUTATION_REGISTRY_NOT_DEPLOYED: no contract bytecode at ${this.reputationRegistry.address}`);
    const identityCode = await this.provider.getCode(this.identityRegistry.address);
    if (identityCode === "0x") throw new Error(`VERITY_ERC8004_IDENTITY_REGISTRY_NOT_DEPLOYED: no contract bytecode at ${this.identityRegistry.address}`);
    const configuredIdentity = await this.contract.getFunction("getIdentityRegistry()")() as string;
    if (configuredIdentity.toLowerCase() !== this.identityRegistry.address.toLowerCase()) {
      throw new Error(`VERITY_ERC8004_IDENTITY_REGISTRY_MISMATCH: reputation registry points to ${configuredIdentity}, expected ${this.identityRegistry.address}`);
    }
    const balance = await this.provider.getBalance(this.wallet.address);
    if (balance === 0n) throw new Error(`VERITY_ERC8004_FUNDS_REQUIRED: feedback signer ${this.wallet.address} has no balance on eip155:${this.reputationRegistry.chainId}`);
  }

  private async assertAgentExists(agentId: string): Promise<void> {
    try {
      await this.identityContract.getFunction("ownerOf(uint256)")(agentId);
    } catch (error) {
      throw new Error(`VERITY_ERC8004_AGENT_NOT_FOUND: agent ${agentId} is not registered in ${this.identityRegistry.reference}`, { cause: error });
    }
  }
}

function feedbackEvent(logs: readonly unknown[], agentId: string, signer: string): { readonly feedbackIndex: string; readonly clientAddress: string } {
  for (const log of logs) {
    if (!isLogLike(log)) continue;
    let parsed;
    try {
      parsed = REPUTATION_REGISTRY_INTERFACE.parseLog({ topics: log.topics, data: log.data });
    } catch (error) {
      if (error instanceof Error && /no matching event|insufficient data|types\/values length mismatch/i.test(error.message)) continue;
      throw new Error("VERITY_ERC8004_FEEDBACK_EVENT_INVALID: could not decode a receipt log", { cause: error });
    }
    if (parsed?.name !== "NewFeedback") continue;
    const eventAgentId = normalizeErc8004AgentId(String(parsed.args[0]));
    const clientAddress = getAddress(String(parsed.args[1]));
    if (eventAgentId !== agentId) throw new Error(`VERITY_ERC8004_FEEDBACK_AGENT_MISMATCH: receipt recorded agent ${eventAgentId}, expected ${agentId}`);
    if (clientAddress.toLowerCase() !== signer.toLowerCase()) throw new Error("VERITY_ERC8004_FEEDBACK_CLIENT_MISMATCH: receipt client was not the configured signer");
    return { feedbackIndex: String(parsed.args[2]), clientAddress };
  }
  throw new Error("VERITY_ERC8004_FEEDBACK_EVENT_MISSING: receipt contained no NewFeedback event");
}

function isLogLike(value: unknown): value is { readonly topics: readonly string[]; readonly data: string } {
  return Boolean(value && typeof value === "object" && Array.isArray((value as { topics?: unknown }).topics) && typeof (value as { data?: unknown }).data === "string");
}

function requiredHttpUrl(value: string, name: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch (error) {
    throw new Error(`VERITY_ERC8004_FEEDBACK_${name.toUpperCase()}_INVALID: use an absolute HTTP(S) URL`, { cause: error });
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`VERITY_ERC8004_FEEDBACK_${name.toUpperCase()}_INVALID: use an absolute HTTP(S) URL`);
  return url.toString();
}

function zeroHash(): string {
  return `0x${"0".repeat(64)}`;
}
