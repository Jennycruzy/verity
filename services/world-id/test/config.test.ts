import assert from "node:assert/strict";
import test from "node:test";
import { readWorldIdServiceConfig } from "../src/config.ts";

const baseEnvironment: NodeJS.ProcessEnv = {
  WORLD_ID_PORT: "8093",
  WORLD_ID_APP_ID: "app_staging_example",
  WORLD_ID_RP_ID: "rp_staging_example",
  WORLD_ID_SIGNING_KEY: `0x${"11".repeat(32)}`,
  WORLD_ID_VERIFY_URL: "https://developer.world.org/api/v4/verify/rp_staging_example",
  WORLD_ID_ALLOWED_ACTIONS: "verity-provider-registration,verity-dispute"
};

test("defaults the World ID browser environment to production", () => {
  assert.equal(readWorldIdServiceConfig(baseEnvironment).environment, "production");
});

test("accepts an explicit staging environment", () => {
  assert.equal(readWorldIdServiceConfig({ ...baseEnvironment, WORLD_ID_ENVIRONMENT: "staging" }).environment, "staging");
});

test("rejects an unknown World ID environment", () => {
  assert.throws(
    () => readWorldIdServiceConfig({ ...baseEnvironment, WORLD_ID_ENVIRONMENT: "testnet" }),
    /VERITY_WORLD_CONFIG_INVALID: WORLD_ID_ENVIRONMENT/
  );
});
