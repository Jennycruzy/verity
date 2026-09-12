# Runtime observations

Recorded 2026-09-11 from the configured public testnet facilitator.

`GET /supported` returned:

- x402 version `2`;
- scheme `exact`;
- network `hedera:testnet`;
- fee payer `0.0.7162784`, also present in `signers["hedera:*"]`.

The response is saved by `npm run discover` as an ignored local artifact. The source code never embeds the observed account ID; it validates the runtime response against the configured network.

At the 2026-09-12 configuration check, the buyer account showed 1016.27789033 HBAR on Mirror Node, so no additional buyer funding was indicated. The settlement topic `0.0.10501385`, dispute topic `0.0.10501386`, and bond escrow `0.0.10502300` are live on Hedera Testnet. The signed-transfer hold measurement is now live evidence: a fresh payment settled at 100 seconds and expired at 101 seconds, producing a 91-second recommended maximum hold with a 10-second safety margin. The honest FX request `1302814f-dcff-4653-8a64-4964cb0e975c` also settled through Blocky402 in `0.0.7162784@1789225308.975547656` and published its receipt in `0.0.10472838@1789225312.834478783`. The optional HTS token and scheduled-bond paths are implemented but are not represented as live until their transaction IDs exist.

The installed SDK's `ContractCreateFlow` uploads bytecode files as hexadecimal text. Passing decoded bytes produced `ERROR_DECODING_BYTESTRING`; the deployment helper now validates the artifact and passes normalized hex text. A 10 HBAR transaction fee cap was insufficient for the final contract creation. The successful creation transaction used a 100 HBAR maximum fee budget and was charged 15.74163033 HBAR.

As of 2026-09-12, the [The Graph supported-network list](https://thegraph.com/docs/en/supported-networks/) does not list Hedera. This repository therefore keeps the Graph transport, query schema, routing, MCP server, and reusable skill behind configuration without claiming a hosted Hedera Subgraph or Substreams deployment. The deployment decision must be revisited if hosted support changes; self-hosting is not presented as equivalent to the required hosted data path.
