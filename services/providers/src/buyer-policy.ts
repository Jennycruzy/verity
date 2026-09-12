import { readFile } from "node:fs/promises";
import { MemoryRootStore, WorldIdVerifier, type WorldIdProof } from "@verity/agent";
import { GraphReputationClient, type ReputationClient, type ReputationQuery } from "@verity/indexer";
import type { ProtectedRequest } from "@verity/sdk";
import { VERITY_HUMAN_ROOT_HEADER, VERITY_WORLD_PROOF_HEADER, VERITY_WORLD_SIGNAL_HEADER } from "@verity/types";
import type { BuyerReputationPolicyConfig } from "./config.js";

export class BuyerAdmissionError extends Error {
  public readonly statusCode = 403;

  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "BuyerAdmissionError";
  }
}

export class BuyerReputationUnavailableError extends Error {
  public readonly statusCode = 503;

  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "BuyerReputationUnavailableError";
  }
}

export class BuyerReputationPolicy {
  public constructor(
    private readonly identity: Pick<WorldIdVerifier, "verify">,
    private readonly reputation: Pick<ReputationClient, "buyer">,
    private readonly minimumHonesty: number
  ) {
    if (!Number.isFinite(minimumHonesty) || minimumHonesty < 0 || minimumHonesty > 1) {
      throw new Error("VERITY_BUYER_REPUTATION_THRESHOLD: minimum honesty must be between 0 and 1");
    }
  }

  public async assertEligible(request: ProtectedRequest): Promise<void> {
    const root = requiredHeader(request, VERITY_HUMAN_ROOT_HEADER, "VERITY_BUYER_HUMAN_ROOT_REQUIRED");
    if (!/^\d+$/.test(root)) throw new BuyerAdmissionError("VERITY_BUYER_HUMAN_ROOT_INVALID: human root must be a canonical decimal World identity commitment");
    const signal = requiredHeader(request, VERITY_WORLD_SIGNAL_HEADER, "VERITY_BUYER_SIGNAL_REQUIRED");
    const proof = parseProof(requiredHeader(request, VERITY_WORLD_PROOF_HEADER, "VERITY_BUYER_PROOF_REQUIRED"));

    let verified;
    try {
      verified = await this.identity.verify(proof, signal);
    } catch (error) {
      throw new BuyerAdmissionError(`VERITY_BUYER_PROOF_REJECTED: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
    if (verified.root !== root) {
      throw new BuyerAdmissionError("VERITY_BUYER_ROOT_MISMATCH: proof root does not match the claimed human root");
    }

    let buyer;
    try {
      buyer = await this.reputation.buyer(root);
    } catch (error) {
      throw new BuyerReputationUnavailableError(`VERITY_BUYER_REPUTATION_UNAVAILABLE: could not read the hosted buyer score for ${root}`, { cause: error });
    }
    if (buyer.root !== root) throw new BuyerReputationUnavailableError("VERITY_BUYER_REPUTATION_SCHEMA: hosted score was keyed to another root");
    if (buyer.honestyScore < this.minimumHonesty) {
      throw new BuyerAdmissionError(`VERITY_BUYER_REPUTATION_REJECTED: human root ${root} has honesty ${buyer.honestyScore}, minimum is ${this.minimumHonesty}`);
    }
  }
}

export async function createBuyerReputationPolicy(
  config: BuyerReputationPolicyConfig | undefined,
  fetchImpl: typeof fetch = fetch
): Promise<BuyerReputationPolicy | undefined> {
  if (!config) return undefined;
  const query = await readQueryFile(config.queryFile);
  const reputation = new GraphReputationClient(
    config.endpoint,
    { provider: query, buyer: query },
    fetchImpl,
    config.apiKey
  );
  const identity = new WorldIdVerifier(
    { verifyUrl: config.verifyUrl, action: config.action, proofMode: config.proofMode },
    new MemoryRootStore(),
    fetchImpl
  );
  return new BuyerReputationPolicy(identity, reputation, config.minimumHonesty);
}

async function readQueryFile(path: string): Promise<ReputationQuery> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    throw new Error(`VERITY_BUYER_REPUTATION_QUERY_FILE: could not read ${path}`, { cause: error });
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new Error(`VERITY_BUYER_REPUTATION_QUERY_FILE: ${path} was not valid JSON`, { cause: error });
  }
  if (!isRecord(value) || typeof value.query !== "string" || !value.query.trim()) {
    throw new Error(`VERITY_BUYER_REPUTATION_QUERY_FILE: ${path} must contain a non-empty query string`);
  }
  const variables = value.variables ?? {};
  if (!isRecord(variables)) throw new Error(`VERITY_BUYER_REPUTATION_QUERY_FILE: ${path}.variables must be an object`);
  if (value.format !== undefined && value.format !== "verity-v1" && value.format !== "agent0-v1") {
    throw new Error(`VERITY_BUYER_REPUTATION_QUERY_FILE: ${path}.format must be verity-v1 or agent0-v1`);
  }
  return { query: value.query, variables, ...(value.format === undefined ? {} : { format: value.format }) };
}

function requiredHeader(request: ProtectedRequest, name: string, code: string): string {
  const value = request.headers[name];
  const normalized = (Array.isArray(value) ? value[0] : value)?.trim();
  if (!normalized) throw new BuyerAdmissionError(`${code}: send a World proof, signal, and matching human root with the paid request`);
  return normalized;
}

function parseProof(encoded: string): WorldIdProof {
  if (encoded.length > 16_384 || !/^[A-Za-z0-9_-]+$/.test(encoded)) {
    throw new BuyerAdmissionError("VERITY_BUYER_PROOF_INVALID: proof header must be unpadded base64url JSON");
  }
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch (error) {
    throw new BuyerAdmissionError("VERITY_BUYER_PROOF_INVALID: proof header did not contain valid JSON", { cause: error });
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BuyerAdmissionError("VERITY_BUYER_PROOF_INVALID: decoded World proof must be an object");
  }
  return value as WorldIdProof;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
