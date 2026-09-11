# Verity

Verity is a pay-per-correct-answer settlement layer for objectively verifiable x402 services on Hedera.

The buyer receives the provider response before settlement. A deterministic evaluator then either settles the payment or submits a bonded dispute. Disputes require a verified human root, are checked by an odd set of HTTP checkers, resolve through the escrow contract, and are recorded as compact HCS receipts. The replay command recomputes the recorded rule from Mirror Node and content storage.

The supported reference services are:

- FX rate lookup: a fixed lookup price and numeric tolerance rule.
- Entity resolution: cached and fresh prices based on observed request usage, with canonical-form equality.

Subjective prose quality is outside the product scope.

## Repository map

| Concern | Location |
| --- | --- |
| Two-entry SDK (`protect`, `buy`) | `packages/sdk/src/` |
| Hedera and facilitator discovery | `packages/hedera/src/` |
| HCS codec, topics, Mirror Node, escrow calls | `packages/hcs/src/` |
| Deterministic rules and shared records | `packages/types/src/` |
| Human-root verification and majority adjudication | `packages/agent/src/` |
| File-backed content addressed by SHA-256 | `packages/content/` and `services/content/` |
| Bonded dispute intake and Mirror verification | `services/disputes/` |
| Reference providers and checker endpoint | `services/providers/` |
| Settlement state and HCS receipts | `services/settlement/src/service.ts` |
| Independent replay | `packages/replay/` |
| Graph client and routing | `packages/indexer/` |
| Public explorer HTTP API | `apps/explorer/` |

## SDK quickstart

Protect an existing Node HTTP handler by wrapping it once. The handler still owns its response body; Verity owns the 402 challenge and facilitator verification.

```ts
import { createServer } from "node:http";
import { protect } from "@verity/sdk";

const app = async (_request, response) => {
  response.statusCode = 200;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify({ expectedRate: "1.08", rate: "1.08", toleranceBps: 25 }));
};

const protectedApp = protect(app, { price: "100", verifier: "fx-rate-v1" });
createServer((request, response) => protectedApp({
  method: request.method ?? "GET",
  url: request.url ?? "/fx",
  headers: request.headers
}, response)).listen(3000);
```

The buyer receives the response before settlement:

```ts
import { buy } from "@verity/sdk";

const result = await buy("http://127.0.0.1:3000/fx", {
  evaluate: "fx-rate-v1",
  maxPrice: "100"
});
console.log(result.verdict, result.settlement?.transaction);
```

Run the example from the repository after `npm install`, with the provider variables from `.env.example` set. A rejected response additionally needs a bond, verified World ID proof, content store, checker responses, and dispute service configuration; the buyer never settles a rejected response directly.

## Local checks

Requirements: Node.js 22+, npm, and Foundry only for Solidity commands.

```sh
cp .env.example .env
npm install
npm run build
npm test
npm run typecheck
npm run check:config
```

The repository has no testnet dependency for these checks. A funded Hedera account is needed only for commands that create topics, deploy escrow, stake, post bonds, or settle a real payment.

## Configure runtime discovery

`npm run discover` calls the configured facilitator `/supported` endpoint. It records the observed x402 version, Hedera network, scheme, and fee payer in the ignored `artifacts/capabilities.json` file and fails if the required capability is absent.

```sh
npm run discover
```

`npm run check:config` performs the same capability check, reports missing settings by use case, and reads public account balances from Mirror Node without printing secret values. It is the quickest way to see whether the next action is configuration or funding.

The operator account needs testnet HBAR before running the following command. It creates or verifies both HCS topics and writes the IDs to `.env`:

```sh
npm run provision:topics
```

No account ID, key, topic ID, price, or URL is embedded in the source. Values come from `.env` or the facilitator response.

## Run the reference services

Set `CONTENT_STORE_PUBLIC_URL` and `CONTENT_STORE_BASE_URL` to the reachable URL of the content process, then start it:

```sh
npm run content:start
```

The content service stores canonical JSON at `PUT /content/<sha256>` and serves it at `GET /content/<sha256>`. It writes the bytes to `CONTENT_STORE_DIR`, verifies the hash on every read, and never writes response bodies to HCS.

The provider process serves the paid endpoint and an unauthenticated deterministic checker endpoint. Start one process per provider or checker, with separate ports and processes:

```sh
PROVIDER_KIND=fx PORT=3101 npm --workspace @verity/providers start
PROVIDER_KIND=fx PORT=3102 DEGRADE_MODE=true DEGRADED_FX_RATE=0.50 npm --workspace @verity/providers start
PROVIDER_KIND=fx PORT=3103 npm --workspace @verity/providers start
```

The paid FX endpoint is `/fx`; the entity endpoint is `/entity`. The checker endpoint is `POST /check` with `{ "ruleId": "...", "value": { ... } }`. The provider process validates inputs and returns the same deterministic verdict used by the buyer.

When `VERITY_PROVIDER_PUBLIC_URL`, `VERITY_ERC8004_REGISTRY`, and `VERITY_ERC8004_AGENT_ID` are set, the provider also serves `GET /.well-known/agent-registration.json` with its x402 resource, checker, and registry references.

The dispute service requires three or another odd number of checker URLs, a deployed escrow contract, a World ID verification URL/action, the provider registry, and the Mirror Node URL. For three local FX checker processes, set:

```sh
DISPUTE_CHECKERS_JSON='[{"id":"fx-a","url":"http://127.0.0.1:3101/check"},{"id":"fx-b","url":"http://127.0.0.1:3102/check"},{"id":"fx-c","url":"http://127.0.0.1:3103/check"}]'
npm run disputes:start
```

The service accepts `POST /disputes` and requires an idempotency key matching `disputeId`. It verifies the bond through Mirror Node before reading content or running adjudication.

## Escrow and provider stake

Compile and deploy the contract only after setting the minimum bond and gas in `.env`:

```sh
npm run contracts:test
npm run contracts:build
npm run contracts:deploy
```

The deploy command writes the returned Hedera contract ID to `VERITY_ESCROW_CONTRACT_ID`. Fund the separate provider account before staking, then run:

```sh
npm run register:provider
npm run stake:provider
```

`register:provider` forwards the complete IDKit result to `WORLD_ID_VERIFY_URL`, checks the proof signal against `VERITY_PROVIDER_IDENTITY_SIGNAL`, and writes the verified root to `VERITY_PROVIDER_ROOT`. Use the same `WORLD_ID_DISPUTE_ACTION` for provider registration and disputes so the root is comparable across both roles. The provider proof JSON and signal are local inputs and are never written to HCS.

The script writes a provider record to `VERITY_PROVIDER_REGISTRY_FILE` containing `providerId`, the verified human root, the staked amount, and the provider EVM address. A provider record is not accepted by the dispute service unless all four values validate.

## Paid request and replay

Configure `VERITY_DEMO_PROVIDER_URL`, the matching rule and expected value, provider/buyer IDs, and the HCS topics. Then run:

```sh
npm run demo
```

The buyer calls the provider, receives the response, evaluates it locally, and settles an accepted response through the settlement coordinator. A successful run prints the facilitator transaction ID and HCS transaction ID. Those IDs can be opened using the configured HashScan testnet base URL.

For a rejected response, the buyer additionally needs a World ID proof, `VERITY_DISPUTE_URL`, a positive bond, one content reference per configured checker response, the escrow contract settings, and a running dispute service. The rejection path posts the bond before it sends the dispute request. There is no local identity substitute in the live path.

After a dispute receipt is visible on the configured topic:

```sh
npx verity replay <disputeId>
```

Replay reads the dispute record from Mirror Node, fetches the evaluation input, delivered response, and every competing provider response by recorded SHA-256, verifies each byte stream, recomputes each checker vote and the strict majority locally, prints the recorded and replayed result, and exits non-zero on any mismatch. It does not use the dispute database or a Verity service.

## Public records

The settlement topic is configured by `HCS_SETTLEMENT_TOPIC_ID`; the dispute topic is configured by `HCS_DISPUTE_TOPIC_ID`. Each disputed result produces three compact HCS messages with the same timestamp:

1. `dispute`: parties, roots, rule, content hashes, votes, amounts, and final resolution.
2. `verdict`: the rule and compact checker votes.
3. `bond`: bond, stake, reputation, and payment transaction IDs.

No live contract address, topic ID, or replayable dispute ID is claimed in this repository yet. Once testnet deployment is run, add the returned IDs and direct HashScan links here before presenting the project.

## Hedera-specific rationale

The resource server delivers before settlement, so the payment hold must survive evaluation inside a live HTTP request. Hedera's fast consensus and predictable low fees are important because the evaluator and checker quorum must finish before the signed transfer expires, while false-rejection adjudication must cost less than the trade. HCS provides an independently readable receipt stream, HTS is reserved for a future settlement-asset path, and Mirror Node is the read authority for reconciliation and replay. The mechanism is not merely an API wrapper: removing fast finality, low fixed fees, or the HCS audit stream weakens the economic and trust model.

## Extra capability map

| Capability | Evidence in this repository | Current status |
| --- | --- | --- |
| Live x402 resource path | `services/providers/src/app.ts:1` and `packages/sdk/src/protect.ts:1` | Implemented; needs a live testnet run |
| HCS payment/dispute audit | `packages/hcs/src/` and `services/settlement/src/service.ts:1` | Implemented; needs provisioned topics |
| Mirror Node replay | `packages/replay/src/index.ts:1` | Implemented and tested |
| Bond and provider stake | `contracts/src/VerityBondEscrow.sol:1` and `packages/hcs/src/escrow.ts:1` | Implemented; needs deployment and funded accounts |
| Proof of Human root | `packages/agent/src/identity.ts:1` | Adapter implemented; World credentials/config required |
| Two-sided reputation anchor | `contracts/src/VerityBondEscrow.sol:1` | On-chain anchor implemented; public score indexing remains |
| Graph composition and MCP/SKILL tooling | `packages/indexer/src/client.ts:1` and `packages/indexer/src/router.ts:1` | Paid Graph transport and reputation routing implemented; hosted Subgraph/Substreams deployment remains |
| Scheduled transactions | — | Not implemented |
| HTS custom fee settlement asset | — | Not implemented |
| ERC-8004/HCS-14 registry | `packages/indexer/src/erc8004.ts:1` | Standard identity primitives implemented; live Hedera registry is not available in the current target deployment |

## Limitations

Verity applies only where a ground-truth rule can be written and replayed. The reference market is small, the checker quorum is small, content storage is file-backed, and the Graph client has no hosted Subgraph or Substreams deployment in this repository. Paid Graph queries require a live Graph endpoint that returns an x402 challenge. The current Agent0 deployment does not list an ERC-8004 registry on Hedera testnet, so this repository does not claim one. World ID verification requires the operator's configured endpoint and action. External provider adoption, live contract IDs, HCS IDs, and real dispute IDs are intentionally absent until they are produced by testnet runs rather than documentation.

## Adoption

`ADOPTION.md` tracks third-party services only after their operators run their own process with the SDK and provide a reachable endpoint. No external team is represented as integrated yet.
