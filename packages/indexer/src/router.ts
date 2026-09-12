import type { ProviderReputation, ReputationClient } from "./client.js";

export interface ProviderCandidate {
  readonly agentId: string;
  readonly endpoint: string;
}

export interface RoutedProvider extends ProviderCandidate {
  readonly reputation: ProviderReputation;
}

export class ReputationRouter {
  public constructor(private readonly reputation: ReputationClient, private readonly minimumReliability: number) {
    if (!Number.isFinite(minimumReliability) || minimumReliability < 0 || minimumReliability > 1) {
      throw new Error("VERITY_ROUTER_THRESHOLD: minimum reliability must be between 0 and 1");
    }
  }

  public async choose(candidates: readonly ProviderCandidate[]): Promise<RoutedProvider> {
    if (candidates.length === 0) throw new Error("VERITY_ROUTER_EMPTY: no provider candidates were supplied");
    const ranked = await Promise.all(candidates.map(async (candidate) => ({ ...candidate, reputation: await this.reputation.provider(candidate.agentId) })));
    const eligible = ranked.filter((candidate) => candidate.reputation.reliabilityScore >= this.minimumReliability);
    if (eligible.length === 0) throw new Error("VERITY_ROUTER_NO_ELIGIBLE_PROVIDER: queried reputation rejected every candidate");
    eligible.sort((left, right) => {
      const score = right.reputation.reliabilityScore - left.reputation.reliabilityScore;
      if (score !== 0) return score;
      return left.agentId < right.agentId ? -1 : left.agentId > right.agentId ? 1 : 0;
    });
    return eligible[0] as RoutedProvider;
  }
}
