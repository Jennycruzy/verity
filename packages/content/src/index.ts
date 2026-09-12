import { sha256, stableJson, type ContentReference } from "@verity/types";

export interface ContentStore {
  putJson(value: unknown): Promise<ContentReference>;
  readJson(reference: ContentReference): Promise<unknown>;
}

type FetchLike = typeof fetch;

export interface HttpContentStoreOptions {
  readonly writeToken?: string;
}

export class HttpContentStore implements ContentStore {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly writeToken?: string;

  public constructor(baseUrl: string, fetchImpl: FetchLike = fetch, options: HttpContentStoreOptions = {}) {
    const normalized = baseUrl.trim().replace(/\/$/, "");
    if (!normalized) throw new Error("VERITY_CONTENT_URL_EMPTY: set CONTENT_STORE_BASE_URL");
    this.baseUrl = normalized;
    this.fetchImpl = fetchImpl;
    const writeToken = options.writeToken?.trim();
    if (writeToken === "") throw new Error("VERITY_CONTENT_WRITE_TOKEN_EMPTY: omit writeToken or provide a non-empty token");
    if (writeToken) this.writeToken = writeToken;
  }

  public async putJson(value: unknown): Promise<ContentReference> {
    const body = stableJson(value);
    const hash = sha256(body);
    const uri = `${this.baseUrl}/content/${hash}`;
    const response = await this.fetchImpl(uri, {
      method: "PUT",
      headers: {
        "content-type": "application/json; charset=utf-8",
        ...(this.writeToken ? { authorization: `Bearer ${this.writeToken}` } : {})
      },
      body
    });
    const raw = await response.text();
    if (!response.ok) throw new Error(`VERITY_CONTENT_PUT_HTTP_${response.status}: ${raw}`);
    const parsed = parseReference(raw, uri);
    if (parsed.sha256 !== hash || parsed.byteLength !== Buffer.byteLength(body, "utf8")) {
      throw new Error("VERITY_CONTENT_PUT_INTEGRITY: content service returned a mismatched reference");
    }
    return parsed;
  }

  public async readJson(reference: ContentReference): Promise<unknown> {
    const uri = reference.uri ?? `${this.baseUrl}/content/${encodeURIComponent(reference.sha256)}`;
    const response = await this.fetchImpl(uri);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!response.ok) {
      throw new Error(`VERITY_CONTENT_GET_HTTP_${response.status}: ${new TextDecoder().decode(bytes)}`);
    }
    if (bytes.byteLength !== reference.byteLength) {
      throw new Error(`VERITY_CONTENT_LENGTH_MISMATCH: expected ${reference.byteLength}, received ${bytes.byteLength}`);
    }
    const actualHash = sha256(bytes);
    if (actualHash !== reference.sha256) {
      throw new Error(`VERITY_CONTENT_HASH_MISMATCH: expected ${reference.sha256}, received ${actualHash}`);
    }
    try {
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch (error) {
      throw new Error(`VERITY_CONTENT_JSON: ${uri} was not valid JSON`, { cause: error });
    }
  }
}

function parseReference(raw: string, fallbackUri: string): ContentReference {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new Error("VERITY_CONTENT_REFERENCE_JSON: content service returned invalid JSON", { cause: error });
  }
  if (!value || typeof value !== "object") throw new Error("VERITY_CONTENT_REFERENCE_SCHEMA: response must be an object");
  const candidate = value as Partial<ContentReference>;
  if (typeof candidate.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(candidate.sha256)
    || typeof candidate.mediaType !== "string" || typeof candidate.byteLength !== "number"
    || !Number.isSafeInteger(candidate.byteLength) || candidate.byteLength < 0) {
    throw new Error("VERITY_CONTENT_REFERENCE_SCHEMA: response did not contain a valid content reference");
  }
  return {
    sha256: candidate.sha256,
    mediaType: candidate.mediaType,
    byteLength: candidate.byteLength,
    uri: typeof candidate.uri === "string" ? candidate.uri : fallbackUri
  };
}
