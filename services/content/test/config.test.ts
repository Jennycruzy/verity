import assert from "node:assert/strict";
import test from "node:test";
import { readContentServiceConfig } from "../src/config.ts";

const base = {
  CONTENT_STORE_PORT: "8090",
  CONTENT_STORE_DIR: "artifacts/content",
  CONTENT_STORE_PUBLIC_URL: "https://content.example",
  CONTENT_STORE_MAX_BYTES: "262144"
};

test("treats an empty upload token as the documented local default", () => {
  assert.deepEqual(readContentServiceConfig({ ...base, CONTENT_STORE_WRITE_TOKEN: "" }), {
    port: 8090,
    directory: "artifacts/content",
    publicUrl: "https://content.example",
    maxBytes: 262144
  });
});

test("preserves a non-empty upload token for protected public writes", () => {
  assert.equal(readContentServiceConfig({ ...base, CONTENT_STORE_WRITE_TOKEN: "write-token" }).writeToken, "write-token");
});
