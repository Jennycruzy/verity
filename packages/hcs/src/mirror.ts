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
  let nextUrl: string | null = `${trimTrailingSlash(mirrorNodeBaseUrl)}/api/v1/topics/${encodeURIComponent(topicId)}/messages`;

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

function trimTrailingSlash(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("VERITY_MIRROR_URL_EMPTY: set MIRROR_NODE_BASE_URL");
  return trimmed.replace(/\/$/, "");
}

function isMirrorPage(value: unknown): value is MirrorPage {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<MirrorPage>;
  return Array.isArray(candidate.messages);
}
