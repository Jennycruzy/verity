import type { BuyerReputation, ProviderReputation } from "./client.js";
import { VERITY_BUYER_FEEDBACK_TAG, VERITY_PROVIDER_FEEDBACK_TAG } from "./reputation-registry.js";

interface Agent0Feedback {
  readonly value: unknown;
  readonly tag1?: unknown;
  readonly isRevoked?: unknown;
  readonly endpoint?: unknown;
}

interface Agent0Agent {
  readonly id?: unknown;
  readonly humanRoot?: unknown;
  readonly registrationFile?: unknown;
  readonly feedback?: unknown;
}

export function normalizeAgent0Id(value: string): string {
  const normalized = value.trim();
  const direct = /^(\d+):(\d+)$/.exec(normalized);
  if (direct) return `${BigInt(direct[1] as string).toString(10)}:${BigInt(direct[2] as string).toString(10)}`;
  const registryReference = /^eip155:(\d+):0x[0-9a-fA-F]{40}:(\d+)$/.exec(normalized);
  if (registryReference) return `${BigInt(registryReference[1] as string).toString(10)}:${BigInt(registryReference[2] as string).toString(10)}`;
  throw new Error("VERITY_AGENT0_ID_INVALID: expected chainId:agentId or eip155:chainId:registry:agentId");
}

export function parseAgent0Provider(value: unknown, requestedAgentId: string): ProviderReputation {
  const agentId = normalizeAgent0Id(requestedAgentId);
  const agent = unwrapAgent(value);
  if (agent.id !== agentId) throw new Error(`VERITY_AGENT0_PROVIDER_SCHEMA: response identified ${String(agent.id)} instead of ${agentId}`);
  const feedback = readFeedback(agent.feedback);
  const relevant = feedback.filter((entry) => entry.tag1 === VERITY_PROVIDER_FEEDBACK_TAG && entry.isRevoked === false);
  const endpoint = readEndpoint(agent.registrationFile, relevant);
  if (!endpoint) throw new Error(`VERITY_AGENT0_PROVIDER_SCHEMA: ${agentId} has no HTTP endpoint in registrationFile.webEndpoint or feedback.endpoint`);
  const reliabilityScore = averageFeedback(relevant, agentId, "provider");
  return { agentId, endpoint, reliabilityScore, completedRequests: relevant.length };
}

export function parseAgent0Buyer(value: unknown, requestedRoot: string): BuyerReputation {
  const agent = unwrapBuyerAgent(value, requestedRoot);
  const feedback = readFeedback(agent.feedback);
  const relevant = feedback.filter((entry) => entry.tag1 === VERITY_BUYER_FEEDBACK_TAG && entry.isRevoked === false);
  const scoreKey = typeof agent.id === "string" ? agent.id : requestedRoot.trim();
  return {
    root: requestedRoot.trim(),
    honestyScore: averageFeedback(relevant, scoreKey, "buyer"),
    disputes: relevant.length
  };
}

function unwrapBuyerAgent(value: unknown, requestedRoot: string): Agent0Agent {
  if (!isRecord(value)) throw new Error("VERITY_AGENT0_BUYER_SCHEMA: response data must be an object");
  if (Array.isArray(value.agents)) {
    if (value.agents.length !== 1 || !isRecord(value.agents[0])) {
      throw new Error(`VERITY_AGENT0_BUYER_SCHEMA: no Agent is indexed for human root ${requestedRoot}`);
    }
    const agent = value.agents[0] as Agent0Agent;
    if (agent.humanRoot !== requestedRoot) {
      throw new Error(`VERITY_AGENT0_BUYER_SCHEMA: response root ${String(agent.humanRoot)} does not match ${requestedRoot}`);
    }
    return agent;
  }

  const agentId = normalizeAgent0Id(requestedRoot);
  const agent = unwrapAgent(value);
  if (agent.id !== agentId) throw new Error(`VERITY_AGENT0_BUYER_SCHEMA: response identified ${String(agent.id)} instead of ${agentId}`);
  return agent;
}

function unwrapAgent(value: unknown): Agent0Agent {
  if (!isRecord(value)) throw new Error("VERITY_AGENT0_PROVIDER_SCHEMA: response data must be an object");
  const candidate = isRecord(value.agent) ? value.agent : value;
  if (!isRecord(candidate)) throw new Error("VERITY_AGENT0_PROVIDER_SCHEMA: response did not contain an Agent entity");
  return candidate as Agent0Agent;
}

function readFeedback(value: unknown): readonly Agent0Feedback[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("VERITY_AGENT0_PROVIDER_SCHEMA: Agent.feedback must be an array");
  return value.map((entry, index) => {
    if (!isRecord(entry)) throw new Error(`VERITY_AGENT0_PROVIDER_SCHEMA: feedback[${index}] must be an object`);
    return entry as unknown as Agent0Feedback;
  });
}

function readEndpoint(registrationFile: unknown, feedback: readonly Agent0Feedback[]): string | undefined {
  const registered = isRecord(registrationFile) && typeof registrationFile.webEndpoint === "string"
    ? registrationFile.webEndpoint.trim()
    : "";
  if (registered) return requireHttpUrl(registered, "registrationFile.webEndpoint");
  for (const entry of feedback) {
    if (typeof entry.endpoint !== "string" || !entry.endpoint.trim()) continue;
    return requireHttpUrl(entry.endpoint.trim(), "feedback.endpoint");
  }
  return undefined;
}

function averageFeedback(feedback: readonly Agent0Feedback[], agentId: string, subject: "provider" | "buyer"): number {
  if (feedback.length === 0) return 0;
  const scale = 10n ** 18n;
  let total = 0n;
  for (const [index, entry] of feedback.entries()) {
    const raw = entry.value;
    const text = typeof raw === "string" || typeof raw === "number" ? String(raw) : "";
    const scaled = decimalToScaled(text, `feedback[${index}].value`);
    if (scaled < 0n || scaled > scale) {
      throw new Error(`VERITY_AGENT0_${subject.toUpperCase()}_SCHEMA: ${agentId} feedback values must be between 0 and 1`);
    }
    total += scaled;
  }
  const average = Number(total / BigInt(feedback.length)) / Number(scale);
  if (!Number.isFinite(average) || average < 0 || average > 1) {
    throw new Error(`VERITY_AGENT0_${subject.toUpperCase()}_SCHEMA: ${agentId} reputation average was outside 0 through 1`);
  }
  return average;
}

function decimalToScaled(value: string, path: string): bigint {
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) {
    throw new Error(`VERITY_AGENT0_PROVIDER_SCHEMA: ${path} must be a non-negative decimal`);
  }
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > 18) throw new Error(`VERITY_AGENT0_PROVIDER_SCHEMA: ${path} has more than 18 fractional digits`);
  return BigInt(whole as string) * 10n ** 18n + BigInt(fraction.padEnd(18, "0") || "0");
}

function requireHttpUrl(value: string, path: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    throw new Error(`VERITY_AGENT0_PROVIDER_SCHEMA: ${path} must be an absolute HTTP(S) URL`, { cause: error });
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`VERITY_AGENT0_PROVIDER_SCHEMA: ${path} must be an absolute HTTP(S) URL`);
  }
  return url.toString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
