export interface WorldIdProof {
  readonly [key: string]: unknown;
}

export interface VerifiedRoot {
  readonly root: string;
  readonly action: string;
  readonly verifiedAt: string;
  readonly provider: "world-id";
}

export interface RootStore {
  has(action: string, root: string): Promise<boolean>;
  add(action: string, root: string): Promise<void>;
}

export interface WorldIdVerifierConfig {
  readonly verifyUrl: string;
  readonly action: string;
}

type FetchLike = typeof fetch;

export class WorldIdVerifier {
  public constructor(
    private readonly config: WorldIdVerifierConfig,
    private readonly roots: RootStore,
    private readonly fetchImpl: FetchLike = fetch
  ) {}

  public async verify(proof: WorldIdProof, signal: string): Promise<VerifiedRoot> {
    if (!signal) throw new Error("VERITY_WORLD_ID_SIGNAL_MISSING: proof must bind to a non-empty signal");
    const response = await this.fetchImpl(this.config.verifyUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(proof)
    });
    const raw = await response.text();
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch (error) {
      throw new Error("VERITY_WORLD_ID_JSON: verifier returned invalid JSON", { cause: error });
    }
    if (!response.ok || !isVerifiedResponse(body)) {
      throw new Error(`VERITY_WORLD_ID_REJECTED: ${response.status} ${JSON.stringify(body)}`);
    }
    const root = body.nullifier ?? body.sessionId;
    if (!root) throw new Error("VERITY_WORLD_ID_ROOT_MISSING: verifier returned no durable root");
    if (await this.roots.has(this.config.action, root)) {
      throw new Error("VERITY_WORLD_ID_REPLAY: this root has already been used for the configured action");
    }
    await this.roots.add(this.config.action, root);
    return { root, action: this.config.action, verifiedAt: new Date().toISOString(), provider: "world-id" };
  }
}

export class MemoryRootStore implements RootStore {
  private readonly values = new Set<string>();

  public async has(action: string, root: string): Promise<boolean> {
    return this.values.has(`${action}:${root}`);
  }

  public async add(action: string, root: string): Promise<void> {
    const key = `${action}:${root}`;
    if (this.values.has(key)) throw new Error("VERITY_WORLD_ID_REPLAY: root already exists");
    this.values.add(key);
  }
}

function isVerifiedResponse(value: unknown): value is { nullifier?: string; sessionId?: string; success: boolean } {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { nullifier?: unknown; sessionId?: unknown; success?: unknown; verified?: unknown };
  return (candidate.success === true || candidate.verified === true)
    && (typeof candidate.nullifier === "string" || typeof candidate.sessionId === "string");
}
