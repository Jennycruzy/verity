import "dotenv/config";
import { Blocky402Client, discoverHederaCapability } from "@verity/hedera";
import { normalizeMirrorNodeBaseUrl } from "@verity/hcs";

type CheckState = "ready" | "missing" | "invalid" | "unavailable";
type CheckScope = "first-payment" | "provider" | "dispute" | "audit" | "graph";

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
    required("HEDERA_PROVIDER_ACCOUNT_ID", "provider", "provider staking account ID"),
    required("HEDERA_PROVIDER_PRIVATE_KEY", "provider", "provider staking key is set locally; value is never printed"),
    required("HEDERA_PROVIDER_EVM_ADDRESS", "provider", "provider escrow payout address"),
    required("VERITY_PROVIDER_ID", "provider", "registered provider identity"),
    required("VERITY_PROVIDER_ROOT", "provider", "verified provider human root"),
    required("VERITY_PROVIDER_STAKE", "provider", "provider stake amount in tinybars"),
    required("VERITY_PROVIDER_PUBLIC_URL", "provider", "public provider URL for identity registration"),
    required("VERITY_ERC8004_REGISTRY", "provider", "normalized ERC-8004 registry reference"),
    required("VERITY_ERC8004_AGENT_ID", "provider", "ERC-8004 agent ID"),
    required("VERITY_ERC8004_RPC_URL", "provider", "EVM JSON-RPC URL for ERC-8004 registration"),
    required("WORLD_ID_VERIFY_URL", "dispute", "World ID verification endpoint"),
    required("WORLD_ID_DISPUTE_ACTION", "dispute", "World ID dispute action"),
    required("WORLD_ID_APP_ID", "dispute", "World ID app ID for the public proof service"),
    required("WORLD_ID_RP_ID", "dispute", "World ID relying-party ID"),
    required("WORLD_ID_SIGNING_KEY", "dispute", "World ID request-signing key is set locally; value is never printed"),
    required("GRAPH_SUBGRAPH_URL", "graph", "paid public Graph query endpoint"),
    required("GRAPH_STUDIO_QUERY_URL", "graph", "hosted Graph Studio query endpoint"),
    required("GRAPH_GATEWAY_PRICE", "graph", "paid Graph query amount in tinybars"),
    required("GRAPH_GATEWAY_UPSTREAM_API_KEY", "graph", "server-side hosted Graph credential"),
    required("GRAPH_PROVIDER_QUERY_FILE", "graph", "Agent0 provider query file"),
    required("GRAPH_BUYER_QUERY_FILE", "graph", "human-root buyer query file"),
    required("GRAPH_FEEDBACK_RPC_URL", "graph", "EVM RPC for Agent0 identity and feedback"),
    required("GRAPH_FEEDBACK_IDENTITY_REGISTRY", "graph", "Agent0 identity registry"),
    required("GRAPH_FEEDBACK_REPUTATION_REGISTRY", "graph", "Agent0 reputation registry"),
    required("GRAPH_FEEDBACK_PROVIDER_AGENT_ID", "graph", "registered provider Agent0 identity"),
    required("GRAPH_FEEDBACK_BUYER_AGENT_ID", "graph", "registered buyer Agent0 identity"),
    required("GRAPH_FEEDBACK_PROVIDER_PRIVATE_KEY", "graph", "provider feedback signer is set locally; value is never printed"),
    required("GRAPH_FEEDBACK_BUYER_PRIVATE_KEY", "graph", "buyer feedback signer is set locally; value is never printed"),
    required("GRAPH_FEEDBACK_PROVIDER_ENDPOINT", "graph", "provider endpoint recorded in Agent0 feedback"),
    required("GRAPH_ROUTE_CANDIDATES_JSON", "graph", "provider candidates used by reputation routing"),
    required("GRAPH_STUDIO_SUBGRAPH", "graph", "Graph Studio subgraph name"),
    required("GRAPH_STUDIO_DEPLOY_KEY", "graph", "Graph Studio deploy key is set locally; value is never printed"),
    required("GRAPH_STUDIO_VERSION_LABEL", "graph", "Graph Studio deployment version label")
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

  const identityFields = [
    env.VERITY_PROVIDER_PUBLIC_URL?.trim(),
    env.VERITY_ERC8004_REGISTRY?.trim(),
    env.VERITY_ERC8004_AGENT_ID?.trim()
  ].filter(Boolean).length;
  if (identityFields !== 0 && identityFields !== 3) {
    checks.push({
      key: "VERITY_PROVIDER_PUBLIC_URL + VERITY_ERC8004_REGISTRY + VERITY_ERC8004_AGENT_ID",
      state: "invalid",
      scope: "provider",
      detail: "set all three identity registration values together"
    });
  }

  const worldFields = [
    env.WORLD_ID_APP_ID?.trim(),
    env.WORLD_ID_RP_ID?.trim(),
    env.WORLD_ID_SIGNING_KEY?.trim(),
    env.WORLD_ID_VERIFY_URL?.trim(),
    env.WORLD_ID_DISPUTE_ACTION?.trim()
  ].filter(Boolean).length;
  if (worldFields !== 0 && worldFields !== 5) {
    checks.push({
      key: "WORLD_ID_APP_ID + WORLD_ID_RP_ID + WORLD_ID_SIGNING_KEY + WORLD_ID_VERIFY_URL + WORLD_ID_DISPUTE_ACTION",
      state: "invalid",
      scope: "dispute",
      detail: "set all World ID service values together"
    });
  }

  const graphSignerFields = [
    env.GRAPH_FEEDBACK_PROVIDER_PRIVATE_KEY?.trim(),
    env.GRAPH_FEEDBACK_BUYER_PRIVATE_KEY?.trim()
  ].filter(Boolean).length;
  if (graphSignerFields !== 0 && graphSignerFields !== 2) {
    checks.push({
      key: "GRAPH_FEEDBACK_PROVIDER_PRIVATE_KEY + GRAPH_FEEDBACK_BUYER_PRIVATE_KEY",
      state: "invalid",
      scope: "graph",
      detail: "use two separate feedback signer keys"
    });
  }

  const graphUrls = [env.GRAPH_SUBGRAPH_URL?.trim(), env.GRAPH_STUDIO_QUERY_URL?.trim()].filter(Boolean);
  if (graphUrls.length === 2 && graphUrls[0] === graphUrls[1]) {
    checks.push({
      key: "GRAPH_SUBGRAPH_URL",
      state: "invalid",
      scope: "graph",
      detail: "point the buying agent at the paid gateway URL, not directly at the Studio upstream"
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
    const tinybar = body.balance?.balance;
    if (tinybar === undefined) return { accountId, state: "unavailable", detail: "Mirror Node response omitted a numeric tinybar balance" };
    const hbar = tinybar / 100_000_000;
    return {
      accountId,
      state: "ready",
      tinybar,
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
    .filter((check) => check.state === "missing" || check.state === "invalid")
    .map((check) => `${check.state === "invalid" ? "fix" : "set"} ${check.key} (${check.detail})`);
  if (facilitator.state !== "ready") actions.push("run npm run discover after the facilitator URL and network are set");
  const buyer = accounts.find((account) => account.accountId === process.env.HEDERA_CLIENT_ACCOUNT_ID?.trim());
  if (buyer?.state === "ready" && (buyer.tinybar ?? 0) > 0 && !process.env.HEDERA_CLIENT_PRIVATE_KEY?.trim()) {
    actions.push("no extra buyer funding is indicated; set the local buyer signing key before the first payment");
  }
  const provider = accounts.find((account) => account.accountId === process.env.HEDERA_PROVIDER_ACCOUNT_ID?.trim());
  if (provider?.state === "ready" && (provider.tinybar ?? 0) === 0 && process.env.HEDERA_PROVIDER_PRIVATE_KEY?.trim()) {
    actions.push("fund the provider staking account before npm run stake:provider");
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
