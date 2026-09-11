import "dotenv/config";
import { Blocky402Client, discoverHederaCapability } from "@verity/hedera";
import { normalizeMirrorNodeBaseUrl } from "@verity/hcs";

type CheckState = "ready" | "missing" | "invalid" | "unavailable";
type CheckScope = "first-payment" | "provider" | "dispute" | "audit";

interface ConfigCheck {
  readonly key: string;
  readonly state: CheckState;
  readonly scope: CheckScope;
  readonly detail: string;
}

interface AccountStatus {
  readonly accountId: string;
  readonly state: CheckState;
  readonly detail: string;
  readonly tinybar?: number;
}

interface MirrorAccountResponse {
  readonly balance?: { readonly balance?: number };
}

const checks = inspectConfig(process.env);
const facilitator = await inspectFacilitator(process.env);
const accounts = await inspectAccounts(process.env);
const result = {
  checks,
  facilitator,
  accounts,
  next: nextActions(checks, facilitator, accounts)
};

console.log(JSON.stringify(result, null, 2));

if (checks.some((check) => check.state === "invalid" || (check.state === "missing" && check.scope === "first-payment"))
  || facilitator.state !== "ready") {
  process.exitCode = 1;
}

function inspectConfig(env: NodeJS.ProcessEnv): readonly ConfigCheck[] {
  const required = (key: string, scope: CheckScope, detail: string): ConfigCheck => {
    const value = env[key]?.trim();
    return value
      ? { key, state: "ready", scope, detail }
      : { key, state: "missing", scope, detail };
  };

  const checks: ConfigCheck[] = [
    required("BLOCKY402_URL", "first-payment", "hosted facilitator URL"),
    required("HEDERA_NETWORK", "first-payment", "runtime network name"),
    required("HEDERA_ASSET_ID", "first-payment", "settlement asset ID"),
    required("HEDERA_CLIENT_ACCOUNT_ID", "first-payment", "buyer account ID"),
    required("HEDERA_CLIENT_PRIVATE_KEY", "first-payment", "buyer signing key is set locally; value is never printed"),
    required("HEDERA_PAY_TO_ACCOUNT_ID", "first-payment", "provider treasury account ID"),
    required("MIRROR_NODE_BASE_URL", "audit", "read-only Mirror Node URL"),
    required("HCS_SETTLEMENT_TOPIC_ID", "audit", "settlement receipt topic"),
    required("HCS_DISPUTE_TOPIC_ID", "audit", "dispute receipt topic"),
    required("CONTENT_STORE_BASE_URL", "dispute", "content address used by dispute and replay"),
    required("VERITY_DISPUTE_URL", "dispute", "bonded dispute service URL"),
    required("VERITY_ESCROW_CONTRACT_ID", "dispute", "deployed bond escrow contract ID"),
    required("VERITY_ESCROW_GAS", "dispute", "escrow execution gas limit"),
    required("VERITY_PROVIDER_ID", "provider", "registered provider identity"),
    required("VERITY_PROVIDER_ROOT", "provider", "verified provider human root"),
    required("WORLD_ID_VERIFY_URL", "dispute", "World ID verification endpoint"),
    required("WORLD_ID_DISPUTE_ACTION", "dispute", "World ID dispute action")
  ];

  const contractId = env.VERITY_ESCROW_CONTRACT_ID?.trim();
  const gas = env.VERITY_ESCROW_GAS?.trim();
  if (Boolean(contractId) !== Boolean(gas)) {
    checks.push({
      key: "VERITY_ESCROW_CONTRACT_ID + VERITY_ESCROW_GAS",
      state: "invalid",
      scope: "dispute",
      detail: "set both escrow values together"
    });
  }

  const buyer = env.HEDERA_CLIENT_ACCOUNT_ID?.trim();
  const payTo = env.HEDERA_PAY_TO_ACCOUNT_ID?.trim();
  if (buyer && payTo && buyer === payTo) {
    checks.push({
      key: "HEDERA_PAY_TO_ACCOUNT_ID",
      state: "invalid",
      scope: "first-payment",
      detail: "use a distinct provider treasury account from the buyer account"
    });
  }

  return checks;
}

async function inspectFacilitator(env: NodeJS.ProcessEnv): Promise<{ readonly state: CheckState; readonly detail: string; readonly capability?: unknown }> {
  const url = env.BLOCKY402_URL?.trim();
  const network = env.HEDERA_NETWORK?.trim();
  if (!url || !network) return { state: "missing", detail: "set BLOCKY402_URL and HEDERA_NETWORK first" };
  try {
    const capability = await discoverHederaCapability(new Blocky402Client(url), network);
    return { state: "ready", detail: "facilitator advertises the required exact Hedera capability", capability };
  } catch (error) {
    return { state: "unavailable", detail: errorMessage(error) };
  }
}

async function inspectAccounts(env: NodeJS.ProcessEnv): Promise<readonly AccountStatus[]> {
  const mirrorUrl = env.MIRROR_NODE_BASE_URL?.trim();
  if (!mirrorUrl) return [];
  const accountIds = [...new Set([
    env.HEDERA_CLIENT_ACCOUNT_ID?.trim(),
    env.HEDERA_PROVIDER_ACCOUNT_ID?.trim(),
    env.HEDERA_PAY_TO_ACCOUNT_ID?.trim()
  ].filter((value): value is string => Boolean(value)))];
  return Promise.all(accountIds.map((accountId) => readAccountBalance(mirrorUrl, accountId)));
}

async function readAccountBalance(mirrorUrl: string, accountId: string): Promise<AccountStatus> {
  if (!/^0\.0\.\d+$/.test(accountId)) return { accountId, state: "invalid", detail: "account ID must use Hedera 0.0.N format" };
  try {
    const response = await fetch(`${normalizeMirrorNodeBaseUrl(mirrorUrl)}/accounts/${encodeURIComponent(accountId)}`);
    const raw = await response.text();
    if (!response.ok) return { accountId, state: "unavailable", detail: `Mirror Node returned HTTP ${response.status}` };
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch (error) {
      return { accountId, state: "unavailable", detail: `Mirror Node returned invalid JSON: ${errorMessage(error)}` };
    }
    if (!isMirrorAccount(body)) return { accountId, state: "unavailable", detail: "Mirror Node response omitted a numeric tinybar balance" };
    const hbar = (body.balance?.balance ?? 0) / 100_000_000;
    return {
      accountId,
      state: "ready",
      tinybar: body.balance?.balance,
      detail: `${hbar.toFixed(8)} HBAR visible on Mirror Node`
    };
  } catch (error) {
    return { accountId, state: "unavailable", detail: errorMessage(error) };
  }
}

function nextActions(
  checks: readonly ConfigCheck[],
  facilitator: { readonly state: CheckState },
  accounts: readonly AccountStatus[]
): readonly string[] {
  const actions = checks
    .filter((check) => check.state === "missing" && check.scope === "first-payment")
    .map((check) => `set ${check.key} (${check.detail})`);
  if (facilitator.state !== "ready") actions.push("run npm run discover after the facilitator URL and network are set");
  const buyer = accounts.find((account) => account.accountId === process.env.HEDERA_CLIENT_ACCOUNT_ID?.trim());
  if (buyer?.state === "ready" && (buyer.tinybar ?? 0) > 0 && !process.env.HEDERA_CLIENT_PRIVATE_KEY?.trim()) {
    actions.push("no extra buyer funding is indicated; set the local buyer signing key before the first payment");
  }
  if (accounts.some((account) => account.state === "ready" && (account.tinybar ?? 0) < 100_000_000)) {
    actions.push("fund any account below 1 HBAR before it signs a transaction");
  }
  return actions;
}

function isMirrorAccount(value: unknown): value is MirrorAccountResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const balance = (value as MirrorAccountResponse).balance;
  return Boolean(balance && typeof balance.balance === "number" && Number.isSafeInteger(balance.balance) && balance.balance >= 0);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
