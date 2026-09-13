import assert from "node:assert/strict";
import test from "node:test";
import { createErc8004Registration, erc8004AgentKey, normalizeErc8004AgentId, normalizeErc8004Registry } from "../src/erc8004.ts";
import { createErc8004AgentDataUri, parseErc8004AgentDataUri, parseErc8004EvmRegistry, resolveErc8004EvmRegistry } from "../src/identity-registry.ts";

test("canonicalizes an ERC-8004 registry and token identity", () => {
  const reference = { agentRegistry: "EIP155:001:0xABC", agentId: "00022" };
  assert.equal(normalizeErc8004Registry(reference.agentRegistry), "eip155:1:0xabc");
  assert.equal(normalizeErc8004AgentId(reference.agentId), "22");
  assert.equal(erc8004AgentKey(reference), "eip155:1:0xabc:22");
});

test("builds the standard registration file shape", () => {
  const registration = createErc8004Registration({
    name: "Verity FX",
    description: "Objectively verifiable FX responses",
    services: [{ name: "web", endpoint: "https://provider.invalid/fx", version: "x402-v2" }],
    x402Support: true,
    active: true,
    registrations: [{ agentRegistry: "eip155:11155111:0xabc", agentId: "7" }],
    supportedTrust: ["reputation", "crypto-economic"]
  });
  assert.equal(registration.type, "https://eips.ethereum.org/EIPS/eip-8004#registration-v1");
  assert.equal(registration.registrations[0]?.agentId, "7");
  assert.equal(registration.services[0]?.endpoint, "https://provider.invalid/fx");
});

test("rejects an incomplete standard identity", () => {
  assert.throws(() => normalizeErc8004Registry("eip155:1"), /VERITY_ERC8004_REGISTRY_INVALID/);
  assert.throws(() => normalizeErc8004Registry("eip155:1:0xregistry:extra"), /VERITY_ERC8004_REGISTRY_INVALID/);
  assert.throws(() => normalizeErc8004AgentId("-1"), /VERITY_ERC8004_AGENT_ID_INVALID/);
  assert.throws(() => createErc8004Registration({
    name: "agent",
    description: "description",
    services: [],
    x402Support: true,
    active: true,
    registrations: []
  }), /VERITY_ERC8004_SERVICES/);
});

test("parses a live EVM registry reference without changing its chain", () => {
  const parsed = parseErc8004EvmRegistry("EIP155:296:0x8004A818BFB912233c491871b3d84c89A494BD9e");
  assert.deepEqual(parsed, {
    reference: "eip155:296:0x8004a818bfb912233c491871b3d84c89a494bd9e",
    chainId: "296",
    address: "0x8004A818BFB912233c491871b3d84c89A494BD9e"
  });
  assert.throws(() => parseErc8004EvmRegistry("eip155:296:0xregistry"), /VERITY_ERC8004_REGISTRY_INVALID/);
});

test("resolves a raw registry address against the discovered chain", () => {
  assert.deepEqual(resolveErc8004EvmRegistry("0x8004A818BFB912233c491871b3d84c89A494BD9e", 84532n), {
    reference: "eip155:84532:0x8004a818bfb912233c491871b3d84c89a494bd9e",
    chainId: "84532",
    address: "0x8004A818BFB912233c491871b3d84c89A494BD9e"
  });
  assert.throws(() => resolveErc8004EvmRegistry("eip155:296:0x8004A818BFB912233c491871b3d84c89A494BD9e", 84532n), /VERITY_ERC8004_CHAIN_MISMATCH/);
});

test("creates a self-contained registration URI bound to its agent identity", () => {
  const registry = "eip155:296:0x8004a818bfb912233c491871b3d84c89a494bd9e";
  const uri = createErc8004AgentDataUri({
    name: "Verity FX",
    description: "Deterministic FX responses",
    publicUrl: "https://provider.example/api/",
    registry,
    agentId: "7",
    kind: "fx"
  });
  const registration = parseErc8004AgentDataUri(uri);
  assert.equal(registration.registrations[0]?.agentRegistry, registry);
  assert.equal(registration.registrations[0]?.agentId, "7");
  assert.equal(registration.services[0]?.name, "web");
  assert.equal(registration.services[0]?.endpoint, "https://provider.example/api/fx");
  assert.match(uri, /#verity-web-endpoint=https:\/\/provider\.example\/api\/fx$/);
  assert.throws(() => parseErc8004AgentDataUri("data:application/json;base64,not-json"), /VERITY_ERC8004_URI_INVALID/);
});
