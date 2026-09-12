import assert from "node:assert/strict";
import test from "node:test";
import { readBuyerConfig, readProviderConfig, readSettlementConfig } from "../src/index.ts";

const base = {
  BLOCKY402_URL: "https://facilitator.invalid",
  HEDERA_NETWORK: "hedera:testnet",
  HEDERA_ASSET_ID: "0.0.2",
  HEDERA_PAY_TO_ACCOUNT_ID: "0.0.3",
  HEDERA_CLIENT_ACCOUNT_ID: "0.0.4",
  HEDERA_CLIENT_PRIVATE_KEY: "private-key",
  HCS_SETTLEMENT_TOPIC_ID: "0.0.5",
  HCS_DISPUTE_TOPIC_ID: "0.0.6"
};

test("validates account, asset, bond, and escrow identifiers", () => {
  assert.equal(readProviderConfig(base).payToAccountId, "0.0.3");
  assert.equal(readBuyerConfig(base).bondAssetId, "0.0.0");
  assert.equal(readSettlementConfig({ ...base, VERITY_ESCROW_CONTRACT_ID: "0.0.7", VERITY_ESCROW_GAS: "100000" }).escrowContractId, "0.0.7");
  assert.throws(() => readProviderConfig({ ...base, HEDERA_PAY_TO_ACCOUNT_ID: "provider" }), /VERITY_CONFIG_INVALID: HEDERA_PAY_TO_ACCOUNT_ID/);
  assert.throws(() => readProviderConfig({ ...base, HEDERA_ASSET_ID: "token" }), /VERITY_CONFIG_INVALID: HEDERA_ASSET_ID/);
  assert.throws(() => readBuyerConfig({ ...base, VERITY_BOND_ASSET_ID: "asset" }), /VERITY_CONFIG_INVALID: VERITY_BOND_ASSET_ID/);
  assert.throws(() => readSettlementConfig({ ...base, VERITY_ESCROW_CONTRACT_ID: "contract", VERITY_ESCROW_GAS: "100000" }), /VERITY_CONFIG_INVALID: VERITY_ESCROW_CONTRACT_ID/);
});
