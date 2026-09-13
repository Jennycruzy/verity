import "dotenv/config";

const domain = required("VERITY_DOMAIN");
const scheme = process.env.VERITY_PUBLIC_SCHEME?.trim() || "https";
if (scheme !== "http" && scheme !== "https") {
  throw new Error("VERITY_PUBLIC_SCHEME_INVALID: use http or https");
}

const checks = [
  ["content", "content", "/health"],
  ["disputes", "disputes", "/health"],
  ["fx-health", "fx", "/health"],
  ["bad-fx", "bad-fx", "/health"],
  ["fx-secondary", "fx-secondary", "/health"],
  ["entity", "entity", "/health"],
  ["checker", "checker", "/health"],
  ["explorer", "explorer", "/health"],
  ["reputation", "reputation", "/health"],
  ["reputation-ready", "reputation", "/ready"],
  ["identity", "identity", "/health"]
] as const;

const healthResults = await Promise.all(checks.map(([name, service, path]) => checkHealth(name, publicUrl(service, path))));
const [fxChallenge, entityChallenge] = await Promise.all([
  checkChallenge("fx-payment-challenge", publicUrl("fx", "/fx")),
  checkChallenge("entity-payment-challenge", publicUrl("entity", "/entity?name=Acme%20Corporation&fresh=true"))
]);
const results = [...healthResults, fxChallenge, entityChallenge];
console.log(JSON.stringify({ domain, results }, null, 2));
if (results.some((result) => result.state === "failed")) process.exitCode = 1;

async function checkHealth(name: string, url: string): Promise<SmokeResult> {
  try {
    const response = await fetchWithTimeout(url);
    const body = await boundedText(response);
    if (!response.ok) return { name, url, state: "failed", detail: `HTTP ${response.status}: ${body}` };
    return { name, url, state: "ready", status: response.status };
  } catch (error) {
    return { name, url, state: "failed", detail: errorMessage(error) };
  }
}

async function checkChallenge(name: string, url: string): Promise<SmokeResult> {
  try {
    const response = await fetchWithTimeout(url);
    const hasChallenge = Boolean(response.headers.get("payment-required"));
    const body = await boundedText(response);
    if (response.status !== 402 || !hasChallenge) {
      return { name, url, state: "failed", detail: `expected HTTP 402 with payment-required; received HTTP ${response.status}: ${body}` };
    }
    return { name, url, state: "ready", status: response.status };
  } catch (error) {
    return { name, url, state: "failed", detail: errorMessage(error) };
  }
}

function publicUrl(service: string, path: string): string {
  return `${scheme}://${service}.${domain}${path}`;
}

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function boundedText(response: Response): Promise<string> {
  const body = await response.text();
  return body.length > 256 ? `${body.slice(0, 256)}…` : body;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`VERITY_CONFIG_MISSING: ${name} is required; set it in .env`);
  if (/[/?#]/.test(value)) throw new Error(`VERITY_CONFIG_INVALID: ${name} must be a hostname without a scheme or path`);
  return value;
}

interface SmokeResult {
  readonly name: string;
  readonly url: string;
  readonly state: "ready" | "failed";
  readonly status?: number;
  readonly detail?: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
