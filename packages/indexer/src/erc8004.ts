export const ERC8004_REGISTRATION_TYPE = "https://eips.ethereum.org/EIPS/eip-8004#registration-v1" as const;

export interface Erc8004AgentRef {
  readonly agentRegistry: string;
  readonly agentId: string;
}

export interface Erc8004Service {
  readonly name: string;
  readonly endpoint: string;
  readonly version?: string;
}

export interface Erc8004Registration {
  readonly type: typeof ERC8004_REGISTRATION_TYPE;
  readonly name: string;
  readonly description: string;
  readonly image?: string;
  readonly services: readonly Erc8004Service[];
  readonly x402Support: boolean;
  readonly active: boolean;
  readonly registrations: readonly Erc8004AgentRef[];
  readonly supportedTrust?: readonly string[];
}

export function createErc8004Registration(input: {
  readonly name: string;
  readonly description: string;
  readonly image?: string;
  readonly services: readonly Erc8004Service[];
  readonly x402Support: boolean;
  readonly active: boolean;
  readonly registrations: readonly Erc8004AgentRef[];
  readonly supportedTrust?: readonly string[];
}): Erc8004Registration {
  const name = requiredText(input.name, "name");
  const description = requiredText(input.description, "description");
  if (input.services.length === 0) throw new Error("VERITY_ERC8004_SERVICES: at least one service is required");
  const services = input.services.map((service, index) => ({
    name: requiredText(service.name, `services[${index}].name`),
    endpoint: requiredText(service.endpoint, `services[${index}].endpoint`),
    ...(service.version === undefined ? {} : { version: requiredText(service.version, `services[${index}].version`) })
  }));
  const registrations = input.registrations.map((registration, index) => ({
    agentRegistry: normalizeErc8004Registry(registration.agentRegistry),
    agentId: normalizeErc8004AgentId(registration.agentId, `registrations[${index}].agentId`)
  }));
  if (registrations.length === 0) throw new Error("VERITY_ERC8004_REGISTRATIONS: at least one registry reference is required");
  return {
    type: ERC8004_REGISTRATION_TYPE,
    name,
    description,
    ...(input.image === undefined ? {} : { image: requiredText(input.image, "image") }),
    services,
    x402Support: input.x402Support,
    active: input.active,
    registrations,
    ...(input.supportedTrust === undefined ? {} : { supportedTrust: input.supportedTrust.map((trust, index) => requiredText(trust, `supportedTrust[${index}]`)) })
  };
}

export function normalizeErc8004Registry(value: string): string {
  const normalized = value.trim().toLowerCase();
  const segments = normalized.split(":");
  const [namespace, chainId, identityRegistry] = segments;
  if (segments.length !== 3 || !namespace || !chainId || !identityRegistry || !/^[a-z][a-z0-9-]*$/.test(namespace) || !/^\d+$/.test(chainId)) {
    throw new Error("VERITY_ERC8004_REGISTRY_INVALID: expected namespace:chainId:identityRegistry");
  }
  return `${namespace}:${BigInt(chainId).toString(10)}:${identityRegistry}`;
}

export function normalizeErc8004AgentId(value: string, name = "agentId"): string {
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) throw new Error(`VERITY_ERC8004_AGENT_ID_INVALID: ${name} must be a non-negative integer`);
  return BigInt(normalized).toString(10);
}

export function erc8004AgentKey(reference: Erc8004AgentRef): string {
  return `${normalizeErc8004Registry(reference.agentRegistry)}:${normalizeErc8004AgentId(reference.agentId)}`;
}

function requiredText(value: string, name: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`VERITY_ERC8004_FIELD_INVALID: ${name} must be non-empty`);
  return normalized;
}
