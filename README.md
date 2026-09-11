# Verity

Verity is a pay-per-correct-answer settlement layer for objectively verifiable x402 services on Hedera.

The repository is intentionally starting with the smallest trustworthy foundation:

- runtime discovery of the Blocky402 capability contract;
- strict shared types for deterministic evaluation;
- no embedded accounts, keys, prices, or endpoints;
- a build that fails loudly when required runtime configuration is absent.

The current packages include the two-entry SDK, a real HTTP provider process, compact HCS publishing and Mirror Node reads, deterministic dispute replay, settlement state transitions, verified-root eligibility, majority adjudication, a Graph-backed reputation client, and a database-free explorer API.

## Current status

The live Blocky402 capability check is implemented. Product flows are not claimed complete until they have a real Hedera transaction ID and an independently readable HCS receipt.

## Local setup

```sh
cp .env.example .env
npm install
npm run build
npm test
npm run discover
```

`npm run discover` calls the configured facilitator's `/supported` endpoint and writes the observed response to `artifacts/capabilities.json`. The command rejects a facilitator that does not advertise the configured Hedera network, `exact` scheme, protocol version, and fee-payer signer.

## Run a reference provider

Set the provider variables from `.env.example`, then choose `PROVIDER_KIND=fx` or `PROVIDER_KIND=entity` and run:

```sh
npm --workspace @verity/providers start
```

The provider returns a real x402 v2 challenge before delivery. `DEGRADE_MODE=true` requires `DEGRADED_FX_RATE` and changes the FX output on the real server path; it is not a test-only branch.

## Replay

After a dispute record and its content references exist on the configured topic and content store:

```sh
npx verity replay <disputeId>
```

The command reads only Mirror Node and the configured content store, then exits non-zero if the locally recomputed verdict differs from the recorded verdict.

## Live demo command

With funded Hedera credentials, configured HCS topics, and a running provider:

```sh
npm run demo
```

The demo uses the SDK buyer, evaluates the delivered response locally, settles only an accepted verdict, and records the accepted settlement through the HCS-backed coordinator. Missing credentials or topics fail loudly.

The bond/stake escrow contract is tested with `npm run contracts:test`. It accepts funds only through explicit payable methods; a plain native transfer reverts because it would not execute contract logic on Hedera.

## Design constraints

- Settlement is conditional on a deterministic verdict. A model may produce an input claim, but it cannot decide whether money moves.
- HCS records contain compact hashes and identifiers, never response bodies.
- Every network-facing value comes from configuration or runtime discovery.
- An error includes the corrective action. A missing environment variable is not replaced with a default.

## Scope

The first reference services are an FX-rate lookup and an entity-resolution lookup. Both have a mechanical comparison rule. Subjective prose generation is deliberately excluded.

## Honest status

No live settlement transaction, escrow contract, production World ID root registry, hosted Graph deployment, or external provider integration is claimed by this repository yet. Those claims require their corresponding testnet transaction IDs, hosted query evidence, or named third-party endpoint before they belong in the README.
