# Verity

Verity is a pay-per-correct-answer settlement layer for objectively verifiable x402 services on Hedera.

The repository is intentionally starting with the smallest trustworthy foundation:

- runtime discovery of the Blocky402 capability contract;
- strict shared types for deterministic evaluation;
- no embedded accounts, keys, prices, or endpoints;
- a build that fails loudly when required runtime configuration is absent.

## Current status

The live Blocky402 capability check is implemented. Product flows are not claimed complete until they have a real Hedera transaction ID and an independently readable HCS receipt.

## Local setup

```sh
cp .env.example .env
npm install
npm run build
npm run discover
```

`npm run discover` calls the configured facilitator's `/supported` endpoint and writes the observed response to `artifacts/capabilities.json`. The command rejects a facilitator that does not advertise the configured Hedera network, `exact` scheme, protocol version, and fee-payer signer.

## Design constraints

- Settlement is conditional on a deterministic verdict. A model may produce an input claim, but it cannot decide whether money moves.
- HCS records contain compact hashes and identifiers, never response bodies.
- Every network-facing value comes from configuration or runtime discovery.
- An error includes the corrective action. A missing environment variable is not replaced with a default.

## Scope

The first reference services are an FX-rate lookup and an entity-resolution lookup. Both have a mechanical comparison rule. Subjective prose generation is deliberately excluded.
