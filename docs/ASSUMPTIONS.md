# Runtime observations

Recorded 2026-09-11 from the configured public testnet facilitator.

`GET /supported` returned:

- x402 version `2`;
- scheme `exact`;
- network `hedera:testnet`;
- fee payer `0.0.7162784`, also present in `signers["hedera:*"]`.

The response is saved by `npm run discover` as an ignored local artifact. The source code never embeds the observed account ID; it validates the runtime response against the configured network.

The current repository still needs a funded buyer account to measure the signed-transfer hold window and produce a real settlement transaction. No timing or on-chain success is inferred from the capability response.
