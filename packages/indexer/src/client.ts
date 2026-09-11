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
}

export interface ReputationClient {
  provider(agentId: string): Promise<ProviderReputation>;
  buyer(root: string): Promise<BuyerReputation>;
}

type FetchLike = typeof fetch;

export class GraphReputationClient implements ReputationClient {
  public constructor(
    private readonly endpoint: string,
    private readonly queries: { provider: ReputationQuery; buyer: ReputationQuery },
    private readonly fetchImpl: FetchLike = fetch,
    private readonly apiKey?: string
  ) {}

  public async provider(agentId: string): Promise<ProviderReputation> {
    const body = await this.execute(this.queries.provider, { agentId });
    return parseProvider(body, agentId);
  }

  public async buyer(root: string): Promise<BuyerReputation> {
    const body = await this.execute(this.queries.buyer, { root });
    return parseBuyer(body, root);
  }

  private async execute(query: ReputationQuery, variables: Readonly<Record<string, unknown>>): Promise<unknown> {
    const response = await this.fetchImpl(this.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {})
      },
      body: JSON.stringify({ query: query.query, variables: { ...query.variables, ...variables } })
    });
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

function parseProvider(value: unknown, agentId: string): ProviderReputation {
  if (!value || typeof value !== "object") throw new Error("VERITY_GRAPH_PROVIDER_SCHEMA: missing data");
  const record = value as Partial<ProviderReputation>;
  if (record.agentId !== agentId || typeof record.endpoint !== "string" || typeof record.reliabilityScore !== "number" || typeof record.completedRequests !== "number") {
    throw new Error(`VERITY_GRAPH_PROVIDER_SCHEMA: incomplete provider record for ${agentId}`);
  }
  return record as ProviderReputation;
}

function parseBuyer(value: unknown, root: string): BuyerReputation {
  if (!value || typeof value !== "object") throw new Error("VERITY_GRAPH_BUYER_SCHEMA: missing data");
  const record = value as Partial<BuyerReputation>;
  if (record.root !== root || typeof record.honestyScore !== "number" || typeof record.disputes !== "number") {
    throw new Error(`VERITY_GRAPH_BUYER_SCHEMA: incomplete buyer record for ${root}`);
  }
  return record as BuyerReputation;
}
