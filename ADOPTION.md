# Adoption tracker

No external service is represented as integrated until its operator has run the public SDK against its own process and supplied a reachable endpoint.

| Prospect | Operator | Endpoint | Status | Last checked |
|---|---|---|---|---|
| — | — | — | Not contacted | — |

The integration offer is intentionally simple: wrap an existing x402 handler with `protect`, keep the provider's own process and account, and receive a public reliability record once the service has completed real requests.

## Ready-to-send outreach

> Building Verity for ETHOnline: pay-per-correct-answer settlement for x402 services on Hedera. I am looking for one independently operated x402 endpoint to join the public registry. Integration is one `verity.protect(...)` call; you keep your server, wallet, pricing, and operation. I can do the integration with you. Verity adds deterministic verification, HCS receipts, and a public reliability score. SDK/repo: https://github.com/Jennycruzy/verity — live example: https://verity.54-154-121-30.sslip.io/provider/fx — reply here or DM me with your endpoint.

Post this in the ETHOnline builder channel and Hedera builder channel. Record each reply in the table above only after the operator responds; record an endpoint only after it is reachable from a separate network.

## Operator handoff

1. Install the package from the repository or npm after publication.
2. Add `verity.protect(app, { price, verifier, stake })` to the existing server.
3. Configure the operator's own Hedera account and public endpoint; never share its private key.
4. Complete the provider registration proof and publish the resulting identity record.
5. Run one honest paid request and send the request ID, settlement transaction ID, and endpoint for independent verification.
