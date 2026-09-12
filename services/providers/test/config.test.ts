import assert from "node:assert/strict";
import test from "node:test";
import { readProviderServiceConfig } from "../src/config.ts";

const baseEnvironment = {
  BLOCKY402_URL: "https://facilitator.invalid",
  HEDERA_NETWORK: "hedera:testnet",
  HEDERA_ASSET_ID: "0.0.0",
  HEDERA_PAY_TO_ACCOUNT_ID: "0.0.1",
  BLOCKY402_TIMEOUT_MS: "1000",
  PROVIDER_KIND: "entity",
  PORT: "3000",
  FX_PRICE: "10",
  FX_PAIR: "EUR/USD",
  FX_REFERENCE_RATE: "1.08",
  FX_TOLERANCE_BPS: "25",
  ENTITY_CACHED_PRICE: "10",
  ENTITY_FRESH_PRICE: "30",
  DEGRADE_MODE: "false"
};

test("requires a degraded rate when degradation is enabled", () => {
  assert.throws(
    () => readProviderServiceConfig({ ...baseEnvironment, DEGRADE_MODE: "true" }),
    /DEGRADED_FX_RATE is required/
  );
});

test("reads usage prices without applying hidden defaults", () => {
  const config = readProviderServiceConfig(baseEnvironment);
  assert.equal(config.entityCachedPrice, "10");
  assert.equal(config.entityFreshPrice, "30");
  assert.equal(config.degradeMode, false);
});

test("accepts an exact FX comparison with zero tolerance", () => {
  const config = readProviderServiceConfig({ ...baseEnvironment, FX_TOLERANCE_BPS: "0" });
  assert.equal(config.fxToleranceBps, 0);
});

test("requires all ERC-8004 publication fields together", () => {
  assert.throws(
    () => readProviderServiceConfig({ ...baseEnvironment, VERITY_PROVIDER_PUBLIC_URL: "https://provider.invalid" }),
    /must be set together/
  );
});

test("reads an ERC-8004 publication configuration", () => {
  const config = readProviderServiceConfig({
    ...baseEnvironment,
    VERITY_PROVIDER_PUBLIC_URL: "https://provider.invalid",
    VERITY_ERC8004_REGISTRY: "eip155:296:0xregistry",
    VERITY_ERC8004_AGENT_ID: "7"
  });
  assert.deepEqual(config.erc8004, {
    publicUrl: "https://provider.invalid",
    registry: "eip155:296:0xregistry",
    agentId: "7"
  });
});

test("requires complete provider-side buyer admission configuration", () => {
  assert.throws(
    () => readProviderServiceConfig({ ...baseEnvironment, VERITY_BUYER_REPUTATION_ENDPOINT: "https://graph.invalid/query" }),
    /buyer reputation admission requires/
  );
});

test("reads provider-side buyer admission configuration", () => {
  const config = readProviderServiceConfig({
    ...baseEnvironment,
    VERITY_BUYER_REPUTATION_ENDPOINT: "https://graph.invalid/query",
    VERITY_BUYER_REPUTATION_API_KEY: "graph-key",
    VERITY_BUYER_REPUTATION_QUERY_FILE: "docs/graph/agent0-buyer.query.json",
    VERITY_BUYER_REPUTATION_MIN_HONESTY: "0.8",
    WORLD_ID_PROOF_MODE: "session",
    WORLD_ID_VERIFY_URL: "https://world.invalid/verify",
    WORLD_ID_DISPUTE_ACTION: "verity-dispute"
  });
  assert.deepEqual(config.buyerReputation, {
    endpoint: "https://graph.invalid/query",
    apiKey: "graph-key",
    queryFile: "docs/graph/agent0-buyer.query.json",
    minimumHonesty: 0.8,
    verifyUrl: "https://world.invalid/verify",
    action: "verity-dispute",
    proofMode: "session"
  });
});
