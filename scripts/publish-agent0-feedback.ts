import { config as loadDotenv } from "dotenv";
import { JsonRpcProvider } from "ethers";
import { readTopicRecords, normalizeMirrorNodeBaseUrl } from "@verity/hcs";
import {
  Erc8004ReputationRegistryClient,
  canonicalHumanRoot,
  createVerityFeedbackEvidence,
  resolveErc8004EvmRegistry,
  type Erc8004FeedbackTransaction
} from "@verity/indexer";
import { RULE_IDS, type RuleId, type Verdict } from "@verity/types";
import { fileURLToPath } from "node:url";

loadDotenv({ path: fileURLToPath(new URL("../.env", import.meta.url)) });

const disputeId = process.argv[2]?.trim();
if (!disputeId) {
  console.error("Usage: npm run publish:agent0-feedback -- <disputeId>");
  process.exitCode = 2;
} else {
  await publish(disputeId);
}

async function publish(disputeId: string): Promise<void> {
  const mirrorNodeBaseUrl = required("MIRROR_NODE_BASE_URL");
  const topicId = required("HCS_DISPUTE_TOPIC_ID");
  const records = await readTopicRecords(mirrorNodeBaseUrl, topicId);
  const matches = records.filter((record) => record.kind === "dispute" && record.id === disputeId);
  if (matches.length === 0) throw new Error(`VERITY_AGENT0_FEEDBACK_NOT_FOUND: no dispute ${disputeId} was found on topic ${topicId}`);
  if (matches.length > 1) throw new Error(`VERITY_AGENT0_FEEDBACK_AMBIGUOUS: ${disputeId} appears ${matches.length} times on topic ${topicId}`);
  const record = matches[0];
  if (!record) throw new Error(`VERITY_AGENT0_FEEDBACK_NOT_FOUND: no dispute ${disputeId} was found on topic ${topicId}`);
  const dispute = parseDispute(record.payload, disputeId);

  const rpcUrl = required("GRAPH_FEEDBACK_RPC_URL");
  const identityRegistryInput = required("GRAPH_FEEDBACK_IDENTITY_REGISTRY");
  const reputationRegistryInput = required("GRAPH_FEEDBACK_REPUTATION_REGISTRY");
  const providerAgentId = required("GRAPH_FEEDBACK_PROVIDER_AGENT_ID");
  const buyerAgentId = required("GRAPH_FEEDBACK_BUYER_AGENT_ID");
  const buyerSignerKey = required("GRAPH_FEEDBACK_BUYER_PRIVATE_KEY");
  const providerSignerKey = required("GRAPH_FEEDBACK_PROVIDER_PRIVATE_KEY");
  const providerEndpoint = required("GRAPH_FEEDBACK_PROVIDER_ENDPOINT");
  const buyerEndpoint = optional("GRAPH_FEEDBACK_BUYER_ENDPOINT");
  const registryRpc = new JsonRpcProvider(rpcUrl, undefined, { staticNetwork: false });
  let identityRegistry: string;
  let reputationRegistry: string;
  try {
    const network = await registryRpc.getNetwork();
    identityRegistry = resolveErc8004EvmRegistry(identityRegistryInput, network.chainId).reference;
    reputationRegistry = resolveErc8004EvmRegistry(reputationRegistryInput, network.chainId).reference;
  } finally {
    registryRpc.destroy();
  }

  let buyerClient: Erc8004ReputationRegistryClient | undefined;
  let providerClient: Erc8004ReputationRegistryClient | undefined;
  try {
    buyerClient = new Erc8004ReputationRegistryClient({ rpcUrl, identityRegistry, reputationRegistry, privateKey: buyerSignerKey });
    providerClient = new Erc8004ReputationRegistryClient({ rpcUrl, identityRegistry, reputationRegistry, privateKey: providerSignerKey });
    if (buyerClient.signerAddress.toLowerCase() === providerClient.signerAddress.toLowerCase()) {
      throw new Error("VERITY_AGENT0_FEEDBACK_SIGNERS: buyer and provider feedback signers must be different accounts");
    }

    const providerWasCorrect = dispute.verdict === "accept";
    const buyerWasHonest = dispute.verdict === "reject";
    const providerEvidence = createVerityFeedbackEvidence({
      disputeId,
      disputeTopicId: topicId,
      recordedAt: record.recordedAt,
      ruleId: dispute.ruleId,
      verdict: dispute.verdict,
      subject: "provider",
      agentRegistry: identityRegistry,
      agentId: providerAgentId,
      outcome: providerWasCorrect,
      humanRoot: dispute.providerRoot
    });
    const buyerEvidence = createVerityFeedbackEvidence({
      disputeId,
      disputeTopicId: topicId,
      recordedAt: record.recordedAt,
      ruleId: dispute.ruleId,
      verdict: dispute.verdict,
      subject: "buyer",
      agentRegistry: identityRegistry,
      agentId: buyerAgentId,
      outcome: buyerWasHonest,
      humanRoot: dispute.buyerRoot
    });

    const providerFeedback = await buyerClient.giveProviderFeedback({
      agentId: providerAgentId,
      providerWasCorrect,
      endpoint: providerEndpoint,
      feedbackURI: providerEvidence.feedbackURI,
      feedbackHash: providerEvidence.feedbackHash
    });
    const buyerFeedback = await providerClient.giveBuyerFeedback({
      agentId: buyerAgentId,
      buyerWasHonest,
      ...(buyerEndpoint ? { endpoint: buyerEndpoint } : {}),
      feedbackURI: buyerEvidence.feedbackURI,
      feedbackHash: buyerEvidence.feedbackHash
    });

    console.log(JSON.stringify({
      disputeId,
      disputeTopicId: topicId,
      mirrorNode: `${normalizeMirrorNodeBaseUrl(mirrorNodeBaseUrl)}/topics/${topicId}/messages`,
      registry: { identity: identityRegistry, reputation: reputationRegistry },
      provider: feedbackSummary(providerFeedback),
      buyer: feedbackSummary(buyerFeedback)
    }, null, 2));
  } finally {
    await buyerClient?.close();
    await providerClient?.close();
  }
}

function parseDispute(value: Record<string, unknown>, disputeId: string): { readonly ruleId: RuleId; readonly verdict: Verdict; readonly buyerRoot: string; readonly providerRoot: string } {
  if (typeof value.ruleId !== "string" || !isRuleId(value.ruleId)) {
    throw new Error(`VERITY_AGENT0_FEEDBACK_SCHEMA: dispute ${disputeId} has an unsupported rule`);
  }
  if (value.verdict !== "accept" && value.verdict !== "reject") {
    throw new Error(`VERITY_AGENT0_FEEDBACK_SCHEMA: dispute ${disputeId} has no final verdict`);
  }
  if (typeof value.buyerRoot !== "string") {
    throw new Error(`VERITY_AGENT0_FEEDBACK_SCHEMA: dispute ${disputeId} has no canonical buyer root`);
  }
  if (typeof value.providerRoot !== "string") {
    throw new Error(`VERITY_AGENT0_FEEDBACK_SCHEMA: dispute ${disputeId} has no canonical provider root`);
  }
  return {
    ruleId: value.ruleId,
    verdict: value.verdict,
    buyerRoot: canonicalHumanRoot(value.buyerRoot),
    providerRoot: canonicalHumanRoot(value.providerRoot)
  };
}

function feedbackSummary(value: Erc8004FeedbackTransaction): Record<string, string> {
  return {
    agentId: value.agentId,
    tag1: value.tag1,
    tag2: value.tag2,
    value: value.value,
    valueDecimals: String(value.valueDecimals),
    endpoint: value.endpoint,
    transactionHash: value.transactionHash,
    feedbackIndex: value.feedbackIndex,
    clientAddress: value.clientAddress
  };
}

function isRuleId(value: string): value is RuleId {
  return value === RULE_IDS.fxRate || value === RULE_IDS.entityCanonical;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`VERITY_CONFIG_MISSING: ${name} is required; set it in .env`);
  return value;
}

function optional(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}
