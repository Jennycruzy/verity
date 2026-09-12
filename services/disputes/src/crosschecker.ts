import type { CrossCheckInput, CrossChecker } from "@verity/agent";
import type { DeterministicVerdict } from "@verity/types";

export class HttpCrossChecker implements CrossChecker {
  public readonly id: string;

  public constructor(
    id: string,
    url: string,
    private readonly requestTimeoutMs = 10_000,
    private readonly fetchImpl: typeof fetch = fetch
  ) {
    this.id = id.trim();
    const normalizedUrl = url.trim();
    if (!this.id) throw new Error("VERITY_CHECKER_ID_MISSING: every checker needs an ID");
    if (!normalizedUrl) throw new Error(`VERITY_CHECKER_URL_MISSING: ${this.id} has no URL`);
    if (!URL.canParse(normalizedUrl) || !["http:", "https:"].includes(new URL(normalizedUrl).protocol)) {
      throw new Error(`VERITY_CHECKER_URL_INVALID: ${this.id} needs an absolute HTTP(S) URL`);
    }
    this.url = normalizedUrl;
    if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs <= 0) throw new Error("VERITY_CHECKER_TIMEOUT_INVALID: use a positive integer");
  }

  private readonly url: string;

  public async check(input: CrossCheckInput): Promise<DeterministicVerdict> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      const response = await this.fetchImpl(this.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ruleId: input.ruleId, value: input.value }),
        signal: controller.signal
      });
      const raw = await response.text();
      let body: unknown;
      try {
        body = JSON.parse(raw);
      } catch (error) {
        throw new Error(`VERITY_CHECKER_JSON: ${this.id} returned invalid JSON`, { cause: error });
      }
      if (!response.ok) throw new Error(`VERITY_CHECKER_HTTP_${response.status}: ${this.id} ${JSON.stringify(body)}`);
      if (!isDeterministicVerdict(body)) throw new Error(`VERITY_CHECKER_SCHEMA: ${this.id} returned an invalid verdict`);
      return body;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`VERITY_CHECKER_TIMEOUT: ${this.id} exceeded ${this.requestTimeoutMs}ms`, { cause: error });
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function isDeterministicVerdict(value: unknown): value is DeterministicVerdict {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<DeterministicVerdict>;
  return (candidate.verdict === "accept" || candidate.verdict === "reject")
    && typeof candidate.ruleId === "string"
    && typeof candidate.reasonCode === "string"
    && Boolean(candidate.evidence && typeof candidate.evidence === "object" && !Array.isArray(candidate.evidence));
}
