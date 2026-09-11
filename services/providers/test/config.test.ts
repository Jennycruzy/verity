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
