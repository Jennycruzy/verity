import assert from "node:assert/strict";
import test from "node:test";
import { Blocky402Client } from "@verity/hedera";
import { protect } from "../src/index.ts";

class DiscoveryOnlyFacilitator extends Blocky402Client {
  public override async supported() {
    return {
      kinds: [{ x402Version: 2, scheme: "exact", network: "hedera:testnet", extra: { feePayer: "0.0.999" } }],
      extensions: [],
      signers: { "hedera:*": ["0.0.999"] }
    };
  }
}

test("protect returns a v2 payment challenge before invoking the application", async () => {
  process.env.BLOCKY402_URL = "https://facilitator.invalid";
  process.env.HEDERA_NETWORK = "hedera:testnet";
  process.env.HEDERA_ASSET_ID = "0.0.0";
  process.env.HEDERA_PAY_TO_ACCOUNT_ID = "0.0.1";

  let applicationCalled = false;
  const handler = protect(
    async () => {
      applicationCalled = true;
    },
    { price: "1", verifier: "fx-rate-v1", facilitator: new DiscoveryOnlyFacilitator("https://facilitator.invalid") }
  );

  const headers = new Map<string, string>();
  let body = "";
  const response = {
    statusCode: 200,
    setHeader(name: string, value: string) {
      headers.set(name.toLowerCase(), value);
    },
    end(value: string) {
      body = value;
    }
  } as never;

  await handler({ method: "GET", url: "/fx", headers: {} }, response);

  assert.equal(applicationCalled, false);
  assert.equal((response as { statusCode: number }).statusCode, 402);
  assert.ok(headers.get("payment-required"));
  assert.match(body, /"x402Version":2/);
});
