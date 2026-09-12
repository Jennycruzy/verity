import { decodePaymentRequiredHeader, encodePaymentSignatureHeader } from "@x402/core/http";
import type { Network, PaymentRequired, PaymentRequirements } from "@x402/core/types";
import { Blocky402Client, discoverHederaCapability } from "@verity/hedera";
import { normalizeAgent0Id, parseAgent0Buyer, parseAgent0Provider } from "./agent0.js";

export interface ProviderReputation {
  readonly agentId: string;
  readonly endpoint: string;
  readonly reliabilityScore: number;
  readonly completedRequests: number;
}

export interface BuyerReputation {
  readonly root: string;
  readonly honestyScore: number;
  readonly disputes: number;
}

export interface ReputationQuery {
  readonly query: string;
  readonly variables: Readonly<Record<string, unknown>>;
  readonly format?: "verity-v1" | "agent0-v1";
}

export interface ReputationClient {
  provider(agentId: string): Promise<ProviderReputation>;
  buyer(root: string): Promise<BuyerReputation>;
}

type FetchLike = typeof fetch;

export interface GraphQueryTransport {
  request(input: string, init: RequestInit): Promise<Response>;
}

export class GraphReputationClient implements ReputationClient {
  public constructor(
    private readonly endpoint: string,
    private readonly queries: { provider: ReputationQuery; buyer: ReputationQuery },
    private readonly fetchImpl: FetchLike = fetch,
    private readonly apiKey?: string,
    private readonly transport?: GraphQueryTransport
  ) {}

  public async provider(agentId: string): Promise<ProviderReputation> {
    const queryAgentId = this.queries.provider.format === "agent0-v1" ? normalizeAgent0Id(agentId) : agentId;
    const body = await this.execute(this.queries.provider, { agentId: queryAgentId });
    return this.queries.provider.format === "agent0-v1"
      ? parseAgent0Provider(body, queryAgentId)
      : parseProvider(body, agentId);
  }

  public async buyer(root: string): Promise<BuyerReputation> {
    const queryAgentId = this.queries.buyer.format === "agent0-v1" ? normalizeAgent0Id(root) : undefined;
    const body = await this.execute(this.queries.buyer, { root, ...(queryAgentId ? { agentId: queryAgentId } : {}) });
    return this.queries.buyer.format === "agent0-v1"
      ? parseAgent0Buyer(body, root)
      : parseBuyer(body, root);
  }

  private async execute(query: ReputationQuery, variables: Readonly<Record<string, unknown>>): Promise<unknown> {
    const init: RequestInit = {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {})
      },
      body: JSON.stringify({ query: query.query, variables: { ...query.variables, ...variables } })
    };
    const response = await (this.transport ? this.transport.request(this.endpoint, init) : this.fetchImpl(this.endpoint, init));
    const raw = await response.text();
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch (error) {
      throw new Error("VERITY_GRAPH_JSON: reputation query returned invalid JSON", { cause: error });
    }
    if (!response.ok) throw new Error(`VERITY_GRAPH_HTTP_${response.status}: ${raw}`);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("VERITY_GRAPH_SCHEMA: response was not an object");
    const errors = (value as { errors?: unknown }).errors;
    if (Array.isArray(errors) && errors.length > 0) throw new Error(`VERITY_GRAPH_QUERY: ${JSON.stringify(errors)}`);
    return (value as { data?: unknown }).data;
  }
}

export interface X402GraphPaymentConfig {
  readonly network: string;
  readonly accountId: string;
  readonly privateKey: string;
  readonly maxPrice?: string;
  readonly requirePayment?: boolean;
}

export class X402GraphPayment implements GraphQueryTransport {
  public constructor(
    private readonly facilitator: Blocky402Client,
    private readonly config: X402GraphPaymentConfig,
    private readonly fetchImpl: FetchLike = fetch
  ) {}

  public async request(input: string, init: RequestInit): Promise<Response> {
    const capability = await discoverHederaCapability(this.facilitator, this.config.network);
    const unpaid = await this.fetchImpl(input, init);
    if (unpaid.status !== 402) {
      if (this.config.requirePayment !== false) {
        throw new Error(`VERITY_GRAPH_PAYMENT_REQUIRED: ${input} did not return an x402 challenge`);
      }
      return unpaid;
    }

    const paymentRequired = await parsePaymentRequired(unpaid);
    const requirements = selectPaymentRequirements(paymentRequired, capability.network, this.config.maxPrice, capability.feePayer);
    const [{ x402Client }, { ExactHederaScheme, PrivateKey, createClientHederaSigner }] = await Promise.all([
      import("@x402/core/client"),
      import("@x402/hedera")
    ]);
    const signer = createClientHederaSigner(
      this.config.accountId,
      PrivateKey.fromStringECDSA(this.config.privateKey),
      { network: this.config.network }
    );
    const client = new x402Client().setSpendControls(false).register(
      this.config.network as Network,
      new ExactHederaScheme(signer)
    );
    const paymentPayload = await client.createPaymentPayload(paymentRequired);
    const headers = new Headers(init.headers);
    headers.set("payment-signature", encodePaymentSignatureHeader(paymentPayload));
    const paid = await this.fetchImpl(input, { ...init, headers });
    if (!paid.ok) return paid;

    const settled = await this.facilitator.settle(paymentPayload, requirements);
    if (!settled.success || !settled.transaction) {
      throw new Error(`VERITY_GRAPH_SETTLEMENT_FAILED: ${settled.errorReason ?? "transaction missing"} ${settled.errorMessage ?? ""}`.trim());
    }
    return paid;
  }
}

async function parsePaymentRequired(response: Response): Promise<PaymentRequired> {
  const encoded = response.headers.get("payment-required");
  if (encoded) return decodePaymentRequiredHeader(encoded);
  const raw = await response.text();
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new Error("VERITY_GRAPH_PAYMENT_REQUIRED: 402 response was not valid JSON", { cause: error });
  }
  if (!isPaymentRequired(value)) throw new Error("VERITY_GRAPH_PAYMENT_REQUIRED: 402 response did not match x402 v2");
  return value;
}

function selectPaymentRequirements(
  paymentRequired: PaymentRequired,
  network: string,
  maxPrice: string | undefined,
  feePayer: string
): PaymentRequirements {
  const requirements = paymentRequired.accepts.find((entry) => entry.network === network && entry.scheme === "exact");
  if (!requirements) throw new Error(`VERITY_GRAPH_PAYMENT_UNSUPPORTED: no exact payment on ${network}`);
  if (!/^\d+$/.test(requirements.amount) || BigInt(requirements.amount) <= 0n) {
    throw new Error("VERITY_GRAPH_PAYMENT_AMOUNT_INVALID: query payment amount must be a positive integer");
  }
  const normalizedMaxPrice = maxPrice?.trim();
  if (normalizedMaxPrice && (!/^\d+$/.test(normalizedMaxPrice) || BigInt(normalizedMaxPrice) <= 0n)) {
    throw new Error("VERITY_GRAPH_MAX_PRICE_INVALID: maxPrice must be a positive integer");
  }
  if (normalizedMaxPrice && BigInt(requirements.amount) > BigInt(normalizedMaxPrice)) {
    throw new Error(`VERITY_GRAPH_PRICE_LIMIT: query asks for ${requirements.amount}, maxPrice is ${normalizedMaxPrice}`);
  }
  if (requirements.extra?.feePayer !== feePayer) {
    throw new Error("VERITY_FEE_PAYER_MISMATCH: graph payment requirements do not match the facilitator capability");
  }
  return requirements;
}

function isPaymentRequired(value: unknown): value is PaymentRequired {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PaymentRequired>;
  return candidate.x402Version === 2 && typeof candidate.resource === "object" && Array.isArray(candidate.accepts);
}

function parseProvider(value: unknown, agentId: string): ProviderReputation {
  if (!value || typeof value !== "object") throw new Error("VERITY_GRAPH_PROVIDER_SCHEMA: missing data");
  const record = value as Partial<ProviderReputation>;
  if (record.agentId !== agentId || typeof record.endpoint !== "string" || typeof record.reliabilityScore !== "number" || typeof record.completedRequests !== "number") {
    throw new Error(`VERITY_GRAPH_PROVIDER_SCHEMA: incomplete provider record for ${agentId}`);
  }
  if (!Number.isFinite(record.reliabilityScore) || record.reliabilityScore < 0 || record.reliabilityScore > 1
    || !Number.isSafeInteger(record.completedRequests) || record.completedRequests < 0) {
    throw new Error(`VERITY_GRAPH_PROVIDER_SCHEMA: invalid score or request count for ${agentId}`);
  }
  return record as ProviderReputation;
}

function parseBuyer(value: unknown, root: string): BuyerReputation {
  if (!value || typeof value !== "object") throw new Error("VERITY_GRAPH_BUYER_SCHEMA: missing data");
  const record = value as Partial<BuyerReputation>;
  if (record.root !== root || typeof record.honestyScore !== "number" || typeof record.disputes !== "number") {
    throw new Error(`VERITY_GRAPH_BUYER_SCHEMA: incomplete buyer record for ${root}`);
  }
  if (!Number.isFinite(record.honestyScore) || record.honestyScore < 0 || record.honestyScore > 1
    || !Number.isSafeInteger(record.disputes) || record.disputes < 0) {
    throw new Error(`VERITY_GRAPH_BUYER_SCHEMA: invalid score or dispute count for ${root}`);
  }
  return record as BuyerReputation;
}
