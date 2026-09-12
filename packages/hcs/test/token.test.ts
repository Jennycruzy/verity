import assert from "node:assert/strict";
import test from "node:test";
import { createHtsCustomFee, validateHtsSettlementTokenConfig } from "../src/token.ts";

const config = {
  tokenName: "Verity Settlement",
  tokenSymbol: "VRTY",
  decimals: 6,
  initialSupply: "1000000000",
  treasuryAccountId: "0.0.100",
  feeCollectorAccountId: "0.0.101",
  feeAmount: "10"
} as const;

test("validates an HTS settlement token definition", () => {
  assert.doesNotThrow(() => validateHtsSettlementTokenConfig(config));
  const fee = createHtsCustomFee(config);
  assert.equal(fee.amount?.toString(), "10");
  assert.equal(fee.feeCollectorAccountId?.toString(), "0.0.101");
  assert.equal(fee.denominatingTokenId?.toString(), "0.0.0");
});

test("rejects an invalid token definition before a client is used", () => {
  assert.throws(() => validateHtsSettlementTokenConfig({ ...config, tokenSymbol: "verity" }), /VERITY_HTS_TOKEN_SYMBOL_INVALID/);
  assert.throws(() => validateHtsSettlementTokenConfig({ ...config, decimals: 19 }), /VERITY_HTS_TOKEN_DECIMALS_INVALID/);
  assert.throws(() => validateHtsSettlementTokenConfig({ ...config, initialSupply: "0" }), /VERITY_HTS_AMOUNT_INVALID/);
  assert.throws(() => validateHtsSettlementTokenConfig({ ...config, treasuryAccountId: "0.0.abc" }), /VERITY_HTS_ACCOUNT_ID_INVALID/);
});

test("rejects invalid HTS fee configuration", () => {
  assert.throws(() => createHtsCustomFee({ feeCollectorAccountId: "0.0.101", feeAmount: "0" }), /VERITY_HTS_AMOUNT_INVALID/);
  assert.throws(() => createHtsCustomFee({ feeCollectorAccountId: "0.0.abc", feeAmount: "10" }), /VERITY_HTS_ACCOUNT_ID_INVALID/);
});
