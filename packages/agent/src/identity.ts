import { mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { keccak_256 } from "@noble/hashes/sha3";

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
  claim(action: string, root: string): Promise<boolean>;
  add(action: string, root: string): Promise<void>;
}

export interface WorldIdVerifierConfig {
  readonly verifyUrl: string;
  readonly action: string;
}

type FetchLike = typeof fetch;

/**
 * World ID's signal binding is keccak-256 interpreted as a big-endian integer,
 * shifted right by eight bits and encoded as a 32-byte hex value.
 */
export function hashWorldSignal(signal: string): string {
  if (!signal) throw new Error("VERITY_WORLD_ID_SIGNAL_MISSING: signal must be non-empty");
  const digest = keccak_256(new TextEncoder().encode(signal));
  let value = 0n;
  for (const byte of digest) value = (value << 8n) | BigInt(byte);
  return `0x${(value >> 8n).toString(16).padStart(64, "0")}`;
}

export function normalizeWorldRoot(value: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error("VERITY_WORLD_ID_ROOT_MISSING: verifier returned an empty durable root");
  if (!/^0x[0-9a-f]+$/i.test(normalized)) return normalized;
  const decimal = BigInt(normalized).toString(10);
  if (decimal === "0") throw new Error("VERITY_WORLD_ID_ROOT_INVALID: verifier returned a zero root");
  return decimal;
}

export class WorldIdVerifier {
  public constructor(
    private readonly config: WorldIdVerifierConfig,
    private readonly roots: RootStore,
    private readonly fetchImpl: FetchLike = fetch
  ) {}

  public async verify(proof: WorldIdProof, signal: string): Promise<VerifiedRoot> {
    if (!signal) throw new Error("VERITY_WORLD_ID_SIGNAL_MISSING: proof must bind to a non-empty signal");
    assertWorldSignalBinding(proof, signal);
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
    const rootValue = extractWorldRoot(body);
    if (!rootValue) throw new Error("VERITY_WORLD_ID_ROOT_MISSING: verifier returned no durable root");
    const root = normalizeWorldRoot(rootValue);
    if (!await this.roots.claim(this.config.action, root)) {
      throw new Error("VERITY_WORLD_ID_REPLAY: this root has already been used for the configured action");
    }
    return { root, action: this.config.action, verifiedAt: new Date().toISOString(), provider: "world-id" };
  }
}

export class MemoryRootStore implements RootStore {
  private readonly values = new Set<string>();

  public async has(action: string, root: string): Promise<boolean> {
    return this.values.has(`${action}:${root}`);
  }

  public async claim(action: string, root: string): Promise<boolean> {
    const key = `${action}:${root}`;
    if (this.values.has(key)) return false;
    this.values.add(key);
    return true;
  }

  public async add(action: string, root: string): Promise<void> {
    if (!await this.claim(action, root)) throw new Error("VERITY_WORLD_ID_REPLAY: root already exists");
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

  public async claim(action: string, root: string): Promise<boolean> {
    const key = storeKey(action, root);
    const lock = await this.acquireLock();
    let temporaryPath: string | undefined;
    try {
      const values = await this.read();
      if (values[key] === true) return false;
      values[key] = true;
      temporaryPath = `${this.path}.${process.pid}.tmp`;
      await writeFile(temporaryPath, JSON.stringify(values), "utf8");
      await rename(temporaryPath, this.path);
      temporaryPath = undefined;
      return true;
    } finally {
      if (temporaryPath) await unlink(temporaryPath).catch((error: unknown) => {
        if (!isFileNotFound(error)) throw error;
      });
      await this.releaseLock(lock);
    }
  }

  public async add(action: string, root: string): Promise<void> {
    if (!await this.claim(action, root)) throw new Error("VERITY_WORLD_ID_REPLAY: root already exists");
  }

  private async acquireLock(): Promise<import("node:fs/promises").FileHandle> {
    const lockPath = `${this.path}.lock`;
    await mkdir(dirname(this.path), { recursive: true });
    for (let attempt = 0; attempt < 80; attempt += 1) {
      try {
        return await open(lockPath, "wx");
      } catch (error) {
        if (!isFileExists(error)) throw error;
        await wait(25);
      }
    }
    throw new Error(`VERITY_ROOT_STORE_LOCK_TIMEOUT: could not acquire ${lockPath}`);
  }

  private async releaseLock(lock: import("node:fs/promises").FileHandle): Promise<void> {
    const lockPath = `${this.path}.lock`;
    try {
      await lock.close();
      await unlink(lockPath);
    } catch (error) {
      throw new Error(`VERITY_ROOT_STORE_LOCK_RELEASE_FAILED: could not release ${lockPath}`, { cause: error });
    }
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

function isFileExists(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}

async function wait(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function assertWorldSignalBinding(proof: WorldIdProof, signal: string): void {
  const claimedHashes = extractWorldSignalHashes(proof);
  if (claimedHashes.length === 0) {
    throw new Error("VERITY_WORLD_ID_SIGNAL_UNBOUND: proof contained no signal_hash");
  }
  const expectedHash = hashWorldSignal(signal).toLowerCase();
  if (!claimedHashes.some((hash) => hash.toLowerCase() === expectedHash)) {
    throw new Error("VERITY_WORLD_ID_SIGNAL_MISMATCH: proof is not bound to the supplied signal");
  }
}

function extractWorldSignalHashes(proof: WorldIdProof): string[] {
  const hashes: string[] = [];
  appendSignalHash(hashes, proof.signal_hash);
  appendSignalHash(hashes, proof.signalHash);
  if (Array.isArray(proof.responses)) {
    for (const response of proof.responses) {
      if (!isRecord(response)) continue;
      appendSignalHash(hashes, response.signal_hash);
      appendSignalHash(hashes, response.signalHash);
    }
  }
  return hashes;
}

function appendSignalHash(target: string[], value: unknown): void {
  if (typeof value === "string" && value.length > 0) target.push(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isVerifiedResponse(value: unknown): value is WorldVerifyResponse {
  if (!value || typeof value !== "object") return false;
  const candidate = value as WorldVerifyResponse;
  return typeof candidate.action === "string"
    && (candidate.success === true || candidate.verified === true)
    && Boolean(extractWorldRoot(candidate));
}

interface WorldVerifyResponse {
  readonly action?: unknown;
  readonly success?: unknown;
  readonly verified?: unknown;
  readonly nullifier?: unknown;
  readonly nullifierHash?: unknown;
  readonly nullifier_hash?: unknown;
  readonly results?: readonly unknown[];
}

function extractWorldRoot(value: WorldVerifyResponse): string | undefined {
  const direct = [value.nullifier, value.nullifierHash, value.nullifier_hash].find(isNonEmptyString);
  if (direct) return direct;
  if (!Array.isArray(value.results)) return undefined;
  for (const result of value.results) {
    if (!isRecord(result)) continue;
    const nested = [result.nullifier, result.nullifierHash, result.nullifier_hash].find(isNonEmptyString);
    if (nested) return nested;
  }
  return undefined;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
