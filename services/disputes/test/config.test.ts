import assert from "node:assert/strict";
import test from "node:test";
import { readDisputeServiceConfig } from "../src/config.ts";

const baseEnv = {
  DISPUTE_PORT: "8091",
  DISPUTE_MAX_BODY_BYTES: "65536",
  DISPUTE_CHECKER_TIMEOUT_MS: "10000",
  DISPUTE_CHECKERS_JSON: JSON.stringify([
    { id: "a", url: "https://a.invalid/check" },
    { id: "b", url: "https://b.invalid/check" },
    { id: "c", url: "https://c.invalid/check" }
  ]),
  CONTENT_STORE_BASE_URL: "https://content.invalid",
  VERITY_ROOT_STORE_PATH: "artifacts/roots.json",
  VERITY_PROVIDER_REGISTRY_FILE: "artifacts/providers.json",
  DISPUTE_STORE_DIR: "artifacts/disputes",
  WORLD_ID_VERIFY_URL: "https://world.invalid/verify",
  WORLD_ID_DISPUTE_ACTION: "verity-dispute",
  MIRROR_NODE_BASE_URL: "https://mirror.invalid/api/v1",
  VERITY_ESCROW_CONTRACT_ID: "0.0.10"
};

test("loads checker and dispute service configuration", () => {
  const config = readDisputeServiceConfig(baseEnv);
  assert.equal(config.port, 8091);
  assert.deepEqual(config.checkers, [
    { id: "a", url: "https://a.invalid/check" },
    { id: "b", url: "https://b.invalid/check" },
    { id: "c", url: "https://c.invalid/check" }
  ]);
});

test("rejects an even checker set", () => {
  assert.throws(() => readDisputeServiceConfig({ ...baseEnv, DISPUTE_CHECKERS_JSON: JSON.stringify([{ id: "a", url: "https://a.invalid" }, { id: "b", url: "https://b.invalid" }]) }), /VERITY_DISPUTE_CHECKERS_CONFIG/);
});
