import { mkdir, open, readFile, rename, unlink, writeFile, type FileHandle } from "node:fs/promises";
import { join } from "node:path";
import { sha256 } from "@verity/types";
import type { DisputeResult } from "./service.js";

export interface StoredDispute {
  readonly requestHash: string;
  readonly result: DisputeResult;
}

export interface DisputeStore {
  get(disputeId: string): Promise<StoredDispute | undefined>;
  put(disputeId: string, value: StoredDispute): Promise<void>;
}

export class MemoryDisputeStore implements DisputeStore {
  private readonly values = new Map<string, StoredDispute>();

  public async get(disputeId: string): Promise<StoredDispute | undefined> {
    return this.values.get(disputeId);
  }

  public async put(disputeId: string, value: StoredDispute): Promise<void> {
    const existing = this.values.get(disputeId);
    if (existing && existing.requestHash !== value.requestHash) {
      throw new Error(`VERITY_DISPUTE_IDEMPOTENCY_CONFLICT: ${disputeId} already has a different request`);
    }
    this.values.set(disputeId, value);
  }
}

export class FileDisputeStore implements DisputeStore {
  public constructor(private readonly directory: string) {}

  public async get(disputeId: string): Promise<StoredDispute | undefined> {
    try {
      const raw = await readFile(this.pathFor(disputeId), "utf8");
      const value: unknown = JSON.parse(raw);
      if (!isStoredDispute(value)) throw new Error(`VERITY_DISPUTE_STORE_SCHEMA: ${disputeId} has an invalid stored record`);
      return value;
    } catch (error) {
      if (isFileNotFound(error)) return undefined;
      if (error instanceof SyntaxError) throw new Error(`VERITY_DISPUTE_STORE_JSON: ${disputeId} is not valid JSON`, { cause: error });
      throw error;
    }
  }

  public async put(disputeId: string, value: StoredDispute): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const path = this.pathFor(disputeId);
    const lock = await this.acquireLock(path);
    let temporaryPath: string | undefined;
    try {
      const existing = await this.get(disputeId);
      if (existing && existing.requestHash !== value.requestHash) {
        throw new Error(`VERITY_DISPUTE_IDEMPOTENCY_CONFLICT: ${disputeId} already has a different request`);
      }
      temporaryPath = `${path}.${process.pid}.tmp`;
      await writeFile(temporaryPath, JSON.stringify(value), "utf8");
      await rename(temporaryPath, path);
      temporaryPath = undefined;
    } finally {
      if (temporaryPath) await unlink(temporaryPath).catch((error: unknown) => {
        if (!isFileNotFound(error)) throw error;
      });
      await this.releaseLock(lock, path);
    }
  }

  private pathFor(disputeId: string): string {
    return join(this.directory, `${sha256(disputeId)}.json`);
  }

  private async acquireLock(path: string): Promise<FileHandle> {
    const lockPath = `${path}.lock`;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      try {
        return await open(lockPath, "wx");
      } catch (error) {
        if (!isFileExists(error)) throw error;
        await wait(25);
      }
    }
    throw new Error(`VERITY_DISPUTE_STORE_LOCK_TIMEOUT: could not acquire ${lockPath}`);
  }

  private async releaseLock(lock: FileHandle, path: string): Promise<void> {
    const lockPath = `${path}.lock`;
    try {
      await lock.close();
      await unlink(lockPath);
    } catch (error) {
      throw new Error(`VERITY_DISPUTE_STORE_LOCK_RELEASE_FAILED: could not release ${lockPath}`, { cause: error });
    }
  }
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

function isStoredDispute(value: unknown): value is StoredDispute {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<StoredDispute>;
  return typeof candidate.requestHash === "string" && Boolean(candidate.result && typeof candidate.result === "object");
}
