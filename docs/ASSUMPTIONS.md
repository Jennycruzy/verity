# Runtime observations

Recorded 2026-09-11 from the configured public testnet facilitator.

`GET /supported` returned:

- x402 version `2`;
- scheme `exact`;
- network `hedera:testnet`;
- fee payer `0.0.7162784`, also present in `signers["hedera:*"]`.

The response is saved by `npm run discover` as an ignored local artifact. The source code never embeds the observed account ID; it validates the runtime response against the configured network.

The configured buyer account currently shows 1100 HBAR on Mirror Node, so no additional buyer funding is indicated. A real settlement and the signed-transfer hold measurement still require the local buyer signing key; no timing or on-chain success is inferred from the capability response. The optional HTS token and scheduled-bond paths are implemented but have not been represented as live until their transaction IDs exist.

As of 2026-09-12, the [The Graph supported-network list](https://thegraph.com/docs/en/supported-networks/) does not list Hedera. This repository therefore keeps the Graph transport, query schema, routing, MCP server, and reusable skill behind configuration without claiming a hosted Hedera Subgraph or Substreams deployment. The deployment decision must be revisited if hosted support changes; self-hosting is not presented as equivalent to the required hosted data path.
