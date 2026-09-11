import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

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
    if (body.action !== this.config.action) {
      throw new Error(`VERITY_WORLD_ID_ACTION_MISMATCH: expected ${this.config.action}, received ${body.action}`);
    }
    const root = body.nullifier ?? body.nullifierHash ?? body.sessionId ?? body.session_id;
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

export class FileRootStore implements RootStore {
  public constructor(private readonly path: string) {
    if (!path.trim()) throw new Error("VERITY_ROOT_STORE_PATH_MISSING: set a path for verified roots");
  }

  public async has(action: string, root: string): Promise<boolean> {
    const values = await this.read();
    return values[storeKey(action, root)] === true;
  }

  public async add(action: string, root: string): Promise<void> {
    const values = await this.read();
    const key = storeKey(action, root);
    if (values[key] === true) throw new Error("VERITY_WORLD_ID_REPLAY: root already exists");
    values[key] = true;
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, JSON.stringify(values), "utf8");
  }

  private async read(): Promise<Record<string, boolean>> {
    try {
      const raw = await readFile(this.path, "utf8");
      let value: unknown;
      try {
        value = JSON.parse(raw);
      } catch (error) {
        throw new Error(`VERITY_ROOT_STORE_JSON: ${this.path} was not valid JSON`, { cause: error });
      }
      if (!isRootMap(value)) throw new Error(`VERITY_ROOT_STORE_SCHEMA: ${this.path} did not contain a root map`);
      return { ...value };
    } catch (error) {
      if (isFileNotFound(error)) return {};
      throw error;
    }
  }
}

function storeKey(action: string, root: string): string {
  if (!action.trim() || !root.trim()) throw new Error("VERITY_ROOT_STORE_KEY_INVALID: action and root are required");
  return `${action}:${root}`;
}

function isRootMap(value: unknown): value is Record<string, boolean> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value).every((entry) => entry === true);
}

function isFileNotFound(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function isVerifiedResponse(value: unknown): value is { action: string; nullifier?: string; nullifierHash?: string; sessionId?: string; session_id?: string; success: boolean } {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { action?: unknown; nullifier?: unknown; nullifierHash?: unknown; sessionId?: unknown; session_id?: unknown; success?: unknown; verified?: unknown };
  return typeof candidate.action === "string"
    && (candidate.success === true || candidate.verified === true)
    && (typeof candidate.nullifier === "string" || typeof candidate.nullifierHash === "string" || typeof candidate.sessionId === "string" || typeof candidate.session_id === "string");
}
