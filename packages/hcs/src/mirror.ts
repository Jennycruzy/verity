import { decodeHcsRecord, type HcsRecord } from "./codec.js";

export interface MirrorTopicMessage {
  readonly consensus_timestamp: string;
  readonly sequence_number: number;
  readonly message: string;
}

interface MirrorPage {
  readonly messages: readonly MirrorTopicMessage[];
  readonly links?: { next?: string | null };
}

type FetchLike = typeof fetch;

export async function readTopicRecords(
  mirrorNodeBaseUrl: string,
  topicId: string,
  options: { fetchImpl?: FetchLike } = {}
): Promise<readonly HcsRecord[]> {
  if (!/^0\.0\.\d+$/.test(topicId)) {
    throw new Error(`VERITY_TOPIC_ID_INVALID: ${topicId}`);
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const records: HcsRecord[] = [];
  let nextUrl: string | null = `${normalizeMirrorNodeBaseUrl(mirrorNodeBaseUrl)}/topics/${encodeURIComponent(topicId)}/messages`;

  while (nextUrl) {
    const response = await fetchImpl(nextUrl);
    const raw = await response.text();
    if (!response.ok) {
      throw new Error(`VERITY_MIRROR_HTTP_${response.status}: ${raw}`);
    }
    let page: unknown;
    try {
      page = JSON.parse(raw);
    } catch (error) {
      throw new Error("VERITY_MIRROR_JSON: Mirror Node returned invalid JSON", { cause: error });
    }
    if (!isMirrorPage(page)) {
      throw new Error("VERITY_MIRROR_SCHEMA: Mirror Node response did not contain messages");
    }
    for (const message of page.messages) {
      const bytes = Buffer.from(message.message, "base64");
      records.push(decodeHcsRecord(bytes));
    }
    nextUrl = page.links?.next ?? null;
  }

  return records;
}

export function normalizeMirrorNodeBaseUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("VERITY_MIRROR_URL_EMPTY: set MIRROR_NODE_BASE_URL");
  const withoutTrailingSlash = trimmed.replace(/\/$/, "");
  return withoutTrailingSlash.endsWith("/api/v1") ? withoutTrailingSlash : `${withoutTrailingSlash}/api/v1`;
}

function isMirrorPage(value: unknown): value is MirrorPage {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<MirrorPage>;
  return Array.isArray(candidate.messages)
    && candidate.messages.every(isMirrorTopicMessage)
    && (candidate.links === undefined || isMirrorLinks(candidate.links));
}

function isMirrorTopicMessage(value: unknown): value is MirrorTopicMessage {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<MirrorTopicMessage>;
  return typeof candidate.consensus_timestamp === "string"
    && candidate.consensus_timestamp.trim().length > 0
    && typeof candidate.sequence_number === "number"
    && Number.isSafeInteger(candidate.sequence_number)
    && candidate.sequence_number > 0
    && typeof candidate.message === "string"
    && candidate.message.length > 0
    && isBase64(candidate.message);
}

function isMirrorLinks(value: unknown): value is NonNullable<MirrorPage["links"]> {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { next?: unknown };
  return candidate.next === undefined || candidate.next === null || (typeof candidate.next === "string" && candidate.next.trim().length > 0);
}

function isBase64(value: string): boolean {
  return value.length % 4 === 0 && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value);
}
