import { mkdir, open, readFile, rename, unlink, writeFile, type FileHandle } from "node:fs/promises";
import { join } from "node:path";
import { sha256 } from "@verity/types";
import type { SettlementOutcome } from "./service.js";

export type SettlementOperation = "accepted" | "adjudication";

export interface StoredSettlement {
  readonly requestHash: string;
  readonly outcome: SettlementOutcome;
}

export interface SettlementStore {
  get(operation: SettlementOperation, key: string): Promise<StoredSettlement | undefined>;
  put(operation: SettlementOperation, key: string, value: StoredSettlement): Promise<void>;
}

export class MemorySettlementStore implements SettlementStore {
  private readonly values = new Map<string, StoredSettlement>();

  public async get(operation: SettlementOperation, key: string): Promise<StoredSettlement | undefined> {
    return this.values.get(storeKey(operation, key));
  }

  public async put(operation: SettlementOperation, key: string, value: StoredSettlement): Promise<void> {
    const storageKey = storeKey(operation, key);
    const existing = this.values.get(storageKey);
    if (existing && existing.requestHash !== value.requestHash) {
      throw new Error(`VERITY_SETTLEMENT_IDEMPOTENCY_CONFLICT: ${key} already has a different request`);
    }
    this.values.set(storageKey, value);
  }
}

export class FileSettlementStore implements SettlementStore {
  public constructor(private readonly directory: string) {
    if (!directory.trim()) throw new Error("VERITY_SETTLEMENT_STORE_DIRECTORY_MISSING: set a settlement journal directory");
  }

  public async get(operation: SettlementOperation, key: string): Promise<StoredSettlement | undefined> {
    try {
      const raw = await readFile(this.pathFor(operation, key), "utf8");
      let value: unknown;
      try {
        value = JSON.parse(raw);
      } catch (error) {
        throw new Error(`VERITY_SETTLEMENT_STORE_JSON: ${operation}/${key} is not valid JSON`, { cause: error });
      }
      if (!isStoredSettlement(value)) {
        throw new Error(`VERITY_SETTLEMENT_STORE_SCHEMA: ${operation}/${key} has an invalid stored record`);
      }
      return value;
    } catch (error) {
      if (isFileNotFound(error)) return undefined;
      throw error;
    }
  }

  public async put(operation: SettlementOperation, key: string, value: StoredSettlement): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const path = this.pathFor(operation, key);
    const lock = await this.acquireLock(path);
    let temporaryPath: string | undefined;
    try {
      const existing = await this.get(operation, key);
      if (existing && existing.requestHash !== value.requestHash) {
        throw new Error(`VERITY_SETTLEMENT_IDEMPOTENCY_CONFLICT: ${key} already has a different request`);
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

  private pathFor(operation: SettlementOperation, key: string): string {
    storeKey(operation, key);
    return join(this.directory, `${sha256(`${operation}:${key}`)}.json`);
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
    throw new Error(`VERITY_SETTLEMENT_STORE_LOCK_TIMEOUT: could not acquire ${lockPath}`);
  }

  private async releaseLock(lock: FileHandle, path: string): Promise<void> {
    const lockPath = `${path}.lock`;
    try {
      await lock.close();
      await unlink(lockPath);
    } catch (error) {
      throw new Error(`VERITY_SETTLEMENT_STORE_LOCK_RELEASE_FAILED: could not release ${lockPath}`, { cause: error });
    }
  }
}

function storeKey(operation: SettlementOperation, key: string): string {
  if (!operation || !key.trim()) throw new Error("VERITY_SETTLEMENT_STORE_KEY_INVALID: operation and key are required");
  return `${operation}:${key}`;
}

function isStoredSettlement(value: unknown): value is StoredSettlement {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<StoredSettlement>;
  return typeof candidate.requestHash === "string" && /^[0-9a-f]{64}$/.test(candidate.requestHash)
    && isSettlementOutcome(candidate.outcome);
}

function isSettlementOutcome(value: unknown): value is SettlementOutcome {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<SettlementOutcome>;
  return (candidate.state === "settled" || candidate.state === "void")
    && typeof candidate.hcsTransactionId === "string"
    && candidate.hcsTransactionId.trim().length > 0
    && (candidate.transactionId === undefined || typeof candidate.transactionId === "string")
    && (candidate.stakeLockTransactionId === undefined || typeof candidate.stakeLockTransactionId === "string")
    && (candidate.bondResolutionTransactionId === undefined || typeof candidate.bondResolutionTransactionId === "string")
    && (candidate.reputationTransactionId === undefined || typeof candidate.reputationTransactionId === "string")
    && (candidate.hcsTransactionIds === undefined || Array.isArray(candidate.hcsTransactionIds));
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
