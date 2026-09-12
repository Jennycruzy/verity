import { assertCompactMessage, stableJson } from "@verity/types";

export const HCS_MESSAGE_MAX_BYTES = 1024;
export const HCS_SCHEMA = "verity/hcs/v1";

export type HcsRecordKind = "settlement" | "dispute" | "verdict" | "bond" | "provider";

export interface HcsRecord<TPayload extends Record<string, unknown> = Record<string, unknown>> {
  readonly schema: typeof HCS_SCHEMA;
  readonly kind: HcsRecordKind;
  readonly id: string;
  readonly recordedAt: string;
  readonly payload: TPayload;
}

export function encodeHcsRecord<TPayload extends Record<string, unknown>>(record: HcsRecord<TPayload>): Uint8Array {
  if (record.schema !== HCS_SCHEMA) {
    throw new Error(`VERITY_HCS_SCHEMA: expected ${HCS_SCHEMA}`);
  }
  if (typeof record.id !== "string" || !record.id.trim() || typeof record.recordedAt !== "string" || !record.recordedAt.trim()) {
    throw new Error("VERITY_HCS_RECORD_INVALID: id and recordedAt are required");
  }
  const serialized = stableJson(record);
  assertCompactMessage(serialized, HCS_MESSAGE_MAX_BYTES);
  return new TextEncoder().encode(serialized);
}

export function decodeHcsRecord(value: Uint8Array | string): HcsRecord {
  const serialized = typeof value === "string" ? value : new TextDecoder().decode(value);
  const byteLength = Buffer.byteLength(serialized, "utf8");
  if (byteLength > HCS_MESSAGE_MAX_BYTES) {
    throw new Error(`VERITY_HCS_RECORD_TOO_LARGE: message is ${byteLength} bytes; maximum is ${HCS_MESSAGE_MAX_BYTES}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch (error) {
    throw new Error("VERITY_HCS_JSON: topic message was not valid JSON", { cause: error });
  }
  if (!isHcsRecord(parsed)) {
    throw new Error("VERITY_HCS_RECORD_INVALID: topic message did not match the Verity schema");
  }
  return parsed;
}

function isHcsRecord(value: unknown): value is HcsRecord {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<HcsRecord>;
  return candidate.schema === HCS_SCHEMA
    && (candidate.kind === "settlement" || candidate.kind === "dispute" || candidate.kind === "verdict" || candidate.kind === "bond" || candidate.kind === "provider")
    && typeof candidate.id === "string"
    && candidate.id.trim().length > 0
    && typeof candidate.recordedAt === "string"
    && candidate.recordedAt.trim().length > 0
    && typeof candidate.payload === "object"
    && candidate.payload !== null
    && !Array.isArray(candidate.payload);
}
