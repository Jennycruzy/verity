import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import { handleWorldIdRequest } from "../src/app.ts";
import type { WorldIdServiceConfig } from "../src/config.ts";

const config: WorldIdServiceConfig = {
  port: 8093,
  appId: "app_test",
  rpId: "rp_test",
  signingKeyHex: `0x${"11".repeat(32)}`,
  verifyUrl: "https://developer.world.org/api/v4/verify/rp_test",
  allowedActions: ["verity-provider-registration", "verity-dispute"],
  environment: "staging",
  proofMode: "uniqueness"
};

test("issues an RP signature only for an allowed action", async () => {
  const result = responseForTest();
  await handleWorldIdRequest(requestForTest("/rp-signature", JSON.stringify({ action: "verity-dispute" })), result.response, config);
  assert.equal(result.status(), 200);
  const body = JSON.parse(result.body()) as Record<string, unknown>;
  assert.equal(body.app_id, "app_test");
  assert.equal(body.rp_id, "rp_test");
  assert.equal(body.action, "verity-dispute");
  assert.equal(body.environment, "staging");
  assert.match(String(body.sig), /^0x/);
  assert.match(String(body.nonce), /^0x/);
});

test("issues an action-free RP signature for session proofs", async () => {
  const result = responseForTest();
  await handleWorldIdRequest(
    requestForTest("/rp-signature", JSON.stringify({}), "POST"),
    result.response,
    { ...config, proofMode: "session" }
  );
  assert.equal(result.status(), 200);
  const body = JSON.parse(result.body()) as Record<string, unknown>;
  assert.equal(body.proof_mode, "session");
  assert.equal(body.action, undefined);
  assert.match(String(body.sig), /^0x/);
});

test("forwards the IDKit payload unchanged to the configured verifier", async () => {
  let forwarded = "";
  const fetchImpl: typeof fetch = async (_input, init) => {
    forwarded = String(init?.body);
    return new Response(JSON.stringify({ success: true, action: "verity-dispute", nullifier: "0x01" }), { status: 200 });
  };
  const proof = { protocol_version: "4.0", action: "verity-dispute", responses: [{ proof: ["0x01"] }] };
  const result = responseForTest();
  await handleWorldIdRequest(requestForTest("/verify-proof", JSON.stringify({ idkitResponse: proof })), result.response, config, fetchImpl);
  assert.equal(result.status(), 200);
  assert.deepEqual(JSON.parse(forwarded), proof);
});

test("rejects an action outside the configured allow-list", async () => {
  const result = responseForTest();
  await assert.rejects(
    handleWorldIdRequest(requestForTest("/rp-signature", JSON.stringify({ action: "other" })), result.response, config),
    /VERITY_WORLD_ACTION_FORBIDDEN/
  );
});

test("serves an operator proof page without exposing the signing key", async () => {
  const result = responseForTest();
  await handleWorldIdRequest(requestForTest("/", "", "GET"), result.response, config);
  assert.equal(result.status(), 200);
  assert.match(result.body(), /IDKit\.proofOfHuman/);
  assert.match(result.body(), /@worldcoin\/idkit-core@4\.2\.4\/dist\/idkit\.global\.js/);
  assert.match(result.body(), /qrcode@1\.5\.4\/build\/qrcode\.min\.js/);
  assert.match(result.body(), /World ID request QR code/);
  assert.doesNotMatch(result.body(), /1111111111111111111111111111111111111111111111111111111111111111/);
});

test("serves the configured session proof workflow", async () => {
  const result = responseForTest();
  await handleWorldIdRequest(requestForTest("/", "", "GET"), result.response, { ...config, proofMode: "session" });
  assert.match(result.body(), /IDKit\.createSession/);
  assert.match(result.body(), /IDKit\.proveSession/);
  assert.match(result.body(), /session commitment becomes the durable human root/);
});

function requestForTest(path: string, body: string, method = "POST"): Readable & { method: string; url: string; headers: Record<string, string> } {
  const request = Readable.from(body ? [Buffer.from(body)] : []) as Readable & { method: string; url: string; headers: Record<string, string> };
  request.method = method;
  request.url = path;
  request.headers = { "content-type": "application/json" };
  return request;
}

function responseForTest() {
  const chunks: Buffer[] = [];
  let statusCode = 0;
  const response = {
    get statusCode() { return statusCode; },
    set statusCode(value: number) { statusCode = value; },
    setHeader() {},
    end(value?: string | Uint8Array) {
      if (value !== undefined) chunks.push(Buffer.from(value));
    }
  } as never;
  return { response, status: () => statusCode, body: () => Buffer.concat(chunks).toString("utf8") };
}
