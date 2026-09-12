import type { BuyerReputation, ProviderReputation, ReputationClient } from "./client.js";

export interface ProviderCandidate {
  readonly agentId: string;
  readonly endpoint: string;
}

export interface RoutedProvider extends ProviderCandidate {
  readonly reputation: ProviderReputation;
  readonly buyerReputation?: BuyerReputation;
}

export interface RouteOptions {
  readonly buyerRoot?: string;
}

export class ReputationRouter {
  public constructor(
    private readonly reputation: ReputationClient,
    private readonly minimumReliability: number,
    private readonly minimumHonesty = 0.8
  ) {
    if (!Number.isFinite(minimumReliability) || minimumReliability < 0 || minimumReliability > 1) {
      throw new Error("VERITY_ROUTER_THRESHOLD: minimum reliability must be between 0 and 1");
    }
    if (!Number.isFinite(minimumHonesty) || minimumHonesty < 0 || minimumHonesty > 1) {
      throw new Error("VERITY_ROUTER_HONESTY_THRESHOLD: minimum honesty must be between 0 and 1");
    }
  }

  public async choose(candidates: readonly ProviderCandidate[], options: RouteOptions = {}): Promise<RoutedProvider> {
    if (candidates.length === 0) throw new Error("VERITY_ROUTER_EMPTY: no provider candidates were supplied");
    const buyerReputation = options.buyerRoot === undefined
      ? undefined
      : await this.readBuyerReputation(options.buyerRoot);
    const ranked = await Promise.all(candidates.map(async (candidate) => ({ ...candidate, reputation: await this.reputation.provider(candidate.agentId) })));
    const eligible = ranked.filter((candidate) => candidate.reputation.reliabilityScore >= this.minimumReliability);
    if (eligible.length === 0) throw new Error("VERITY_ROUTER_NO_ELIGIBLE_PROVIDER: queried reputation rejected every candidate");
    eligible.sort((left, right) => {
      const score = right.reputation.reliabilityScore - left.reputation.reliabilityScore;
      if (score !== 0) return score;
      return left.agentId < right.agentId ? -1 : left.agentId > right.agentId ? 1 : 0;
    });
    const selected = eligible[0] as RoutedProvider;
    return buyerReputation ? { ...selected, buyerReputation } : selected;
  }

  private async readBuyerReputation(root: string): Promise<BuyerReputation> {
    const normalized = root.trim();
    if (!normalized) throw new Error("VERITY_ROUTER_BUYER_ROOT: provide a non-empty human root");
    const buyerReputation = await this.reputation.buyer(normalized);
    if (buyerReputation.honestyScore < this.minimumHonesty) {
      throw new Error(`VERITY_ROUTER_BUYER_INELIGIBLE: human root ${normalized} has honesty ${buyerReputation.honestyScore}, minimum is ${this.minimumHonesty}`);
    }
    return buyerReputation;
  }
}
