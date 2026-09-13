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
| Public explorer | `apps/explorer/` |

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
  headers: request.headers,
  raw: request
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

If the provider account and payout account are blank, set an explicit starting balance and create both from the funded buyer account:

```sh
HEDERA_ACCOUNT_INITIAL_BALANCE_HBAR=1 npm run provision:accounts
```

The command creates two fresh ECDSA accounts, writes the provider credentials and payout account ID to the ignored `.env`, and prints only their public IDs, EVM addresses, and creation transaction IDs. It refuses to overwrite an existing provider or payout configuration. Run `npm run check:config` again afterward; fund only an account that the report identifies as below the required balance.

The operator account needs testnet HBAR before running the following command. It creates or verifies both HCS topics and writes the IDs to `.env`:

```sh
npm run provision:topics
```

No account ID, key, topic ID, price, or URL is embedded in the source. Values come from `.env` or the facilitator response.

The settlement asset can remain native HBAR, or an operator can provision an HTS fungible token with an explicit treasury and same-token protocol fee:

```sh
npm run provision:token
```

Set the `HEDERA_TOKEN_*` fields first. The command writes the created token ID to `HEDERA_ASSET_ID`, validates the token metadata and fee schedule through the Hedera SDK, and associates every credential listed in `HEDERA_TOKEN_ASSOCIATIONS_JSON` before any optional initial transfer. The token settlement asset and the escrow bond asset are separate; `VERITY_BOND_ASSET_ID=0.0.0` keeps bonds in HBAR while a token is used for paid responses.

## Run the reference services

For a public deployment, point the base domain and the service subdomains in `deploy/Caddyfile` at a server, set `VERITY_DOMAIN`, and run `docker compose up -d --build`. Caddy obtains TLS certificates automatically. The compose file runs honest FX, degradable FX, secondary FX, and entity-resolution providers separately, includes the independent Go checker, persists content and dispute records in named volumes, and does not copy `.env` into an image. A small server is operational hosting, not a blockchain funding requirement. See [docs/PUBLIC-DEPLOY.md](docs/PUBLIC-DEPLOY.md) for the secure copy-paste runbook.

For a short-lived review session, `npm run public:start` starts one ingress on port `8080`. It exposes `/provider`, `/content`, `/disputes`, and `/reputation` to their separate local processes and serves the explorer at `/`. Put that single port behind an HTTPS tunnel, then set the corresponding public environment URLs. This is useful for live verification but has no uptime claim; the Caddy deployment remains the durable path.

After DNS and TLS are ready, `npm run public:check` probes every public health endpoint and asserts that the FX resource returns an x402 `402` challenge with a `payment-required` header. It exits non-zero if any service is unreachable or if the resource accidentally becomes free.

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
PROVIDER_KIND=entity PORT=3104 npm --workspace @verity/providers start
```

The paid FX endpoint is `/fx`; the entity endpoint is `/entity`. Entity lookups use `?name=...` and charge the cached or fresh configured amount based on the observed `fresh=true` request. The checker endpoint is `POST /check` with `{ "ruleId": "...", "value": { ... } }`. The provider process validates inputs and returns the same deterministic verdict used by the buyer.

The quorum can include the separate Go implementation in `services/checker-go`, which does not import the Node provider or Verity rule package. Configure `CHECKER_PORT`, `CHECKER_ID`, and `CHECKER_MAX_BODY_BYTES`, then run `npm run checker:go`. Its `/check` endpoint uses exact rational arithmetic for `fx-rate-v1` and returns the same published verdict schema.

The public compose deployment keeps the degradable `bad-fx` process out of adjudication. It runs a second honest FX process plus the separate Go checker, so the three votes are produced by two independently started Node processes and a different implementation. The entity service is a separate paid reference market with variable cached/fresh pricing; it is not used as an FX checker. The Go service must receive `CHECKER_ID=fx-independent-go` in deployment configuration.

Provider operators can enable buyer admission with `VERITY_BUYER_REPUTATION_ENDPOINT`, `VERITY_BUYER_REPUTATION_API_KEY`, `VERITY_BUYER_REPUTATION_QUERY_FILE`, `VERITY_BUYER_REPUTATION_ROOT_STORE_PATH`, `VERITY_BUYER_REPUTATION_MIN_HONESTY`, `WORLD_ID_VERIFY_URL`, and `WORLD_ID_DISPUTE_ACTION`. The provider verifies the buyer's World proof from the request headers, compares the proof-derived identity commitment to the claimed human root, persists proof replay protection, queries the hosted Agent0 score, and refuses delivery when the score is below policy. `buy()` sends those headers when `humanRoot`, `identityProof`, and `identitySignal` are supplied. Missing proof and unavailable Graph data fail closed; no local score is substituted.

When `VERITY_PROVIDER_PUBLIC_URL`, `VERITY_ERC8004_REGISTRY`, and `VERITY_ERC8004_AGENT_ID` are set, the provider also serves `GET /.well-known/agent-registration.json` with its x402 resource, checker, and registry references.

The reusable agent skill is in `skills/verity-reputation/SKILL.md`. With a live Graph endpoint and query files configured, `npm run graph:mcp` exposes provider reliability and buyer honesty as MCP tools. The Graph transport requires an x402 challenge and settles the query before returning data.

The Graph data path has two independently buildable products over the same Agent0-compatible ERC-8004 event schema: an address-filtered Substreams package for Graph Market, and a standard EVM Subgraph for Studio. Studio currently rejects Substreams-powered Subgraphs, so the hosted deployment uses the standard EVM event sources while the Substreams package remains the high-throughput stream artifact. Provider reputation is keyed by the standard Agent ID; buyer reputation is looked up by the World human identity commitment through the small `Agent.humanRoot` extension, populated from the signed feedback evidence. Both provider and buyer roots are included in the hashed feedback document and URI fragment, so a changed root changes the published evidence rather than only changing indexer metadata. This preserves a portable ERC-8004 Agent/Feedback model without pretending a wallet address is a human identity. Configure the Base Sepolia RPC and current ERC-8004 identity and reputation registries, then build both artifacts:

```sh
npm run graph:build
```

`graph:build` verifies live registry bytecode, discovers the chain ID and registry deployment block, packs the filtered stream, generates the standard EVM Subgraph manifest, and compiles its mapping. Create the Subgraph in Studio, then set `GRAPH_STUDIO_SUBGRAPH`, `GRAPH_STUDIO_DEPLOY_KEY`, and `GRAPH_STUDIO_VERSION_LABEL`. Run `npm run graph:deploy`; it persists the returned Studio query endpoint to the ignored `.env` and prints the deployment CID. The deploy key is passed only to the official CLI and is redacted from command errors. No blockchain funding is needed to deploy the Subgraph; Graph Studio access is required.

The hosted Studio deployment has two recorded versions. Version `0.1.1` ([deployment page](https://thegraph.com/studio/subgraph/verity), CID `QmQePELuMWViBC3wxwKxu1LdqNuDtJpzxeN2MvdW6pA1L9`, [query endpoint](https://api.studio.thegraph.com/query/1760236/verity/0.1.1)) established the first live identity records. Version `0.1.2` is the corrected, synced mapping ([CID `QmTu4kXTxkcPUfrSrW367NZSWfmDTR2niznbE6WntWGxDM`](https://ipfs.io/ipfs/QmTu4kXTxkcPUfrSrW367NZSWfmDTR2niznbE6WntWGxDM), [query endpoint](https://api.studio.thegraph.com/query/1760236/verity/0.1.2)); a live readiness query reached block `46759345` on 2026-09-13. It returned provider Agent0 identity `9221`, buyer identity `9222`, and the provider web endpoint decoded from the standard registration URI. The provider was registered in [Base Sepolia transaction 0xca1fcd45](https://sepolia.basescan.org/tx/0xca1fcd45e24a3f68348d93e23323f27f69e80b3bbd9c9756caae1269d21c58b7), and its latest public-endpoint update is [transaction 0x9da1d0a5](https://sepolia.basescan.org/tx/0x9da1d0a5da1f1ec7c006ed2ef78ac9bb0ef3ae797b3ae05bdccfe11b7cf86ec8). The buyer was registered in [Base Sepolia transaction 0x1af6f8c0](https://sepolia.basescan.org/tx/0x1af6f8c0ea8b1191c40f8257e28ca3413f4a53aad94ac6e1c42bf24d4ef1d44b). Agent0 feedback events still need to be written by the adjudication run before Verity reliability and honesty scores can be claimed. The endpoint is rate-limited Studio infrastructure, not a production Graph Network publication.

Verify the hosted Graph endpoint independently before wiring the gateway or explorer to it:

```sh
npm run graph:check-hosted
```

The check runs the standard Graph `_meta` query, validates a live indexed block, and never prints the API credential. A public deployment also exposes this check as `GET /ready` on the reputation hostname.

The Graph feedback publisher needs separate Base Sepolia signers for the provider and buyer. Generate them locally once with `npm run provision:graph-signers`; only public addresses are printed and the keys are written to ignored `.env`. Run `npm run graph:check-signers` to print both public addresses and their live balances without printing keys. Fund any signer reported as `funding-required` with a small amount of Base Sepolia ETH before `npm run register:graph-agent -- provider` and `npm run register:graph-agent -- buyer`.

The paid query service keeps the hosted Graph credential on the server and exposes a read-only x402 resource at `POST /query`:

```sh
npm run graph:gateway
```

Set `GRAPH_GATEWAY_PRICE` and `GRAPH_STUDIO_QUERY_URL` first. `GRAPH_GATEWAY_UPSTREAM_API_KEY` is optional for the live `api.studio.thegraph.com` endpoint because anonymous readiness and query requests have been verified; it remains required for every other upstream host. The service rejects mutations, subscriptions, oversized bodies, invalid upstream JSON, and upstream timeouts. Point the buying agent's `GRAPH_SUBGRAPH_URL` at this public `/query` URL so reputation lookup is a real paid dependency rather than decorative data access. The explorer uses `GRAPH_STUDIO_QUERY_URL` directly with `GRAPH_API_KEY`; it never points at the paid gateway or bypasses its own server-side query credential.

For a public content service, set `CONTENT_STORE_WRITE_TOKEN`. Replay reads remain public by hash, while buyer uploads require `Authorization: Bearer <token>`; the SDK reads the token from the ignored environment file.

The routing proof uses that paid transport directly. Set `GRAPH_MIN_RELIABILITY`, `GRAPH_ROUTE_CANDIDATES_JSON`, and the two Agent0 query files, then run `npm run graph:route`. It prints the selected endpoint and queried score. Changing the indexed score changes the selected provider; deleting the Subgraph or removing the x402 resource causes the command to fail instead of silently using a local cache. Set `GRAPH_ROUTE_BUYER_ROOT` after the buyer has a published Agent0 history to make the same route decision query buyer honesty and refuse a root below `GRAPH_MIN_HONESTY`; the buyer key is the World human identity commitment, never a wallet address.

With the same Graph configuration, start the public explorer with `npm --workspace @verity/explorer start`. Open `http://127.0.0.1:8787/` to query provider reliability or buyer honesty. The browser page and JSON routes both call `GraphReputationClient`; there is no parallel local reputation database.

The dispute service requires three or another odd number of checker URLs, a deployed escrow contract, a World ID verification URL/action, the settlement HCS topic, and the Mirror Node URL. It loads provider eligibility from `provider` records on that topic; the local provider JSON is only an operator cache. A local FX quorum can combine two independently started Node checkers with the separate Go checker:

```sh
DISPUTE_CHECKERS_JSON='[{"id":"fx-node-a","url":"http://127.0.0.1:3101/check"},{"id":"fx-node-b","url":"http://127.0.0.1:3103/check"},{"id":"fx-independent-go","url":"http://127.0.0.1:3201/check"}]'
npm run disputes:start
```

The service accepts `POST /disputes` and requires an idempotency key matching `disputeId`. It verifies the bond through Mirror Node before reading content or running adjudication. Settlement outcomes are also journaled under `VERITY_SETTLEMENT_STORE_DIR`, so a restart can return a completed result without submitting the same payment again.

## Escrow and provider stake

Compile and deploy the contract only after setting the minimum bond, gas, and bytecode-upload fee budget in `.env`:

```sh
npm run contracts:test
npm run contracts:build
npm run contracts:deploy
```

The deploy command writes the returned Hedera contract ID to `VERITY_ESCROW_CONTRACT_ID`. Fund the separate provider account before staking, then run:

```sh
npm run register:provider
npm run register:erc8004
npm run register:agent
npm run stake:provider
```

`register:provider` forwards the complete IDKit result to `WORLD_ID_VERIFY_URL`, checks the proof signal against `VERITY_PROVIDER_IDENTITY_SIGNAL`, and writes the verified root to `VERITY_PROVIDER_ROOT`. Set `WORLD_ID_PROOF_MODE=session` (the default) so the stable session commitment is comparable across provider registration and disputes; `uniqueness` remains available for an action-scoped deployment. Set `WORLD_ID_PROVIDER_ACTION` for action-scoped provider registration and keep `WORLD_ID_DISPUTE_ACTION` for disputes. The provider proof JSON and signal are local inputs and are never written to HCS.

For the current World ID 4.x flow, create an app and RP in the [World Developer Portal](https://developer.world.org), then use IDKit 4.x with the simulator's staging environment or production World App. Set `WORLD_ID_APP_ID`, `WORLD_ID_RP_ID`, `WORLD_ID_SIGNING_KEY`, `WORLD_ID_ENVIRONMENT`, `WORLD_ID_PROOF_MODE`, `WORLD_ID_PROVIDER_ACTION`, and `WORLD_ID_ALLOWED_ACTIONS`, then start `npm --workspace @verity/world-id-service start`. With the default `WORLD_ID_PROOF_MODE=session`, open the service root at `/`, leave the session ID blank to create a session, enter the exact signal, approve it in World App or the simulator, and save the returned session ID with the complete IDKit result. Use that saved session ID on the next visit to prove the same human again. The page calls `POST /rp-signature` and verifies the result through `POST /verify-proof` before displaying it. The backend gives the client a signed request context and forwards the complete IDKit response unchanged to `WORLD_ID_VERIFY_URL`. Set that URL to `https://developer.world.org/api/v4/verify/<rp_id>`. The proof's `responses[].signal_hash` must be generated from the exact signal supplied to `register:provider` or `dispute:demo`; the verifier derives the durable human root from the session commitment and consumes each session proof's replay-protection value once. For `uniqueness` mode, the verifier stores the returned action-scoped nullifier instead. See the [IDKit integration guide](https://docs.world.org/world-id/idkit/integrate) for the proof request and RP context.

The environment distinction is enforced in the operator page: `staging` is only for the World simulator and is not production human-uniqueness evidence. Production Proof of Human is an Orb-issued credential; there is no legitimate software bypass when that credential is unavailable in a country. The Developer Portal configures the relying party and verifies the proof after World App or the simulator returns it. Selfie Check can be enabled separately as a medium-assurance step-up, but it is not a substitute for the durable anti-sybil root.

The script publishes a compact `provider` record to the settlement HCS topic containing `providerId`, the verified human root, the staked amount, the provider EVM address, and the stake transaction ID. It also writes the same data to `VERITY_PROVIDER_REGISTRY_FILE` as an operator cache. The dispute service reads eligibility from Mirror Node and does not depend on that cache; it replays the recorded `stakeProvider` call and refuses a provider record unless the contract, caller, amount, root, and successful transaction all match.

`register:erc8004` performs the real ERC-8004 Identity Registry transaction through the configured EVM JSON-RPC endpoint. It discovers the chain ID, requires registry bytecode and a non-zero signer balance, mints the agent ID, sets a self-contained standard registration URI, verifies owner and URI through the registry, and writes both transaction hashes to `.env`. It resumes safely if the mint succeeds but the URI update needs another run. Set `VERITY_ERC8004_AGENT_URI` to use an externally hosted registration file; otherwise the command uses a data URI and still records the standardized identity on-chain. The [official ERC-8004 deployment list](https://github.com/erc-8004/erc-8004-contracts#contract-addresses) includes a Hedera Testnet Identity Registry; copy the current address into `VERITY_ERC8004_REGISTRY` rather than hardcoding it in the application.

`register:agent` normalizes that ERC-8004 registry reference, anchors the provider's human root and public endpoint in the escrow contract's `AgentRegistered` event, and writes the Hedera transaction ID to `VERITY_PROVIDER_AGENT_REGISTRATION_TX`. The contract rejects a second registration for the same normalized agent reference.

To protect a bonded rejection from a process crash after the bond is posted, set `VERITY_BOND_EXPIRY_SECONDS` to a positive duration. The buyer then calls `postBondWithExpiry` and creates a Hedera Scheduled Transaction for `releaseExpiredBond`; the returned schedule ID is carried through the dispute request and HCS receipts. Leave it blank for the ordinary dispute path. A scheduled release only returns an unresolved bond after its expiry, so it cannot override a completed adjudication.

## Paid request and replay

Configure `VERITY_DEMO_PROVIDER_URL`, the matching rule and expected value, provider/buyer IDs, and the HCS topics. `VERITY_DEMO_BUYER_ID` is only the receipt label; the dispute service derives the authoritative human root from the verified proof, so `VERITY_DEMO_BUYER_ROOT` is optional unless the paid provider itself enforces a root header. Then run:

```sh
npm run demo
```

The buyer calls the provider, receives the response, evaluates it locally, and settles an accepted response through the settlement coordinator. A successful run prints the facilitator transaction ID and HCS transaction ID. Those IDs can be opened using the configured HashScan testnet base URL.

Live honest-path evidence from 2026-09-12:

- Request `9cd9993d-c4f5-4445-a14e-6cb23ef74d5a` evaluated `RATE_WITHIN_TOLERANCE` for EUR/USD at `1.08` on 2026-09-13.
- [Blocky402 settlement](https://hashscan.io/testnet/transaction/0.0.7162784@1789283686.210609392) and [HCS settlement receipt](https://hashscan.io/testnet/transaction/0.0.10472838@1789283687.523085878) are independently resolvable.

- Request `0721bd9e-332c-416f-8cde-4d091164e8a6` evaluated `RATE_WITHIN_TOLERANCE` for EUR/USD at `1.08` after the deployment hardening changes.
- [Blocky402 settlement](https://hashscan.io/testnet/transaction/0.0.7162784@1789252458.310034075) transferred the configured amount to the provider treasury.
- [HCS settlement receipt](https://hashscan.io/testnet/transaction/0.0.10472838@1789252461.678940522) is readable from settlement topic `0.0.10501385`.

- Request `a7353260-8829-445e-ad23-d6f23baa3bae` evaluated `RATE_WITHIN_TOLERANCE` for EUR/USD at `1.08`.
- [Blocky402 settlement](https://hashscan.io/testnet/transaction/0.0.7162784@1789245767.729586729) transferred the configured amount to the provider treasury.
- [HCS settlement receipt](https://hashscan.io/testnet/transaction/0.0.10472838@1789245772.571672131) is readable from settlement topic `0.0.10501385`.

- Request `1302814f-dcff-4653-8a64-4964cb0e975c` evaluated `RATE_WITHIN_TOLERANCE` for EUR/USD at `1.08`.
- [Blocky402 settlement](https://hashscan.io/testnet/transaction/0.0.7162784@1789225308.975547656) transferred `0.01 HBAR` to the configured provider treasury.
- [HCS settlement receipt](https://hashscan.io/testnet/transaction/0.0.10472838@1789225312.834478783) is readable from settlement topic `0.0.10501385`.

For a rejected response, the buyer additionally needs a World ID proof, `VERITY_DISPUTE_URL`, a positive bond, one content reference per configured checker response, the escrow contract settings, and a running dispute service. The rejection path posts the bond before it sends the dispute request. There is no local identity substitute in the live path.

Adjudication scores the competing provider responses, not the buyer's claim directly. A strict majority of `accept` votes means the competitors agree with the published rule, so the buyer's rejection is upheld and the delivered provider is marked wrong. A strict majority of `reject` votes means the competitors also fail the published rule, so the buyer's rejection is overturned and the payment is settled. The deterministic mapping is shared by the service and replay tool in `packages/types/src/index.ts`.

`HEDERA_CLIENT_EVM_ADDRESS` may remain blank: the SDK derives the buyer address from `HEDERA_CLIENT_PRIVATE_KEY` and rejects a configured address that does not match that key.

After a dispute receipt is visible on the configured topic:

```sh
npx verity replay <disputeId>
```

Replay reads the dispute record from Mirror Node, fetches the evaluation input, delivered response, and every competing provider response by recorded SHA-256, verifies each byte stream, recomputes each checker vote and the strict majority locally, prints the recorded and replayed result, and exits non-zero on any mismatch. It does not use the dispute database or a Verity service.

The complete live rejection run is `npm run dispute:demo`. Set `VERITY_DEMO_BAD_PROVIDER_URL` and `VERITY_DEMO_BAD_PROVIDER_ID` to the degradable provider, provide three distinct paid reference provider URLs in `VERITY_DEMO_REFERENCE_PROVIDER_URLS`, and make their count match `DISPUTE_CHECKERS_JSON`. The command health-checks the dispute service and providers first, pays each reference lookup, uploads the observed responses to the content store, posts the configured bond, and submits the rejected response with the World ID proof. It prints the bond, settlement, resolution, and HCS transaction IDs needed for replay. It never fabricates provider responses or uses a local identity substitute.

The signed-transfer hold has been measured on Hedera Testnet rather than inferred from the facilitator timeout. A fresh transfer settled after 100 seconds and expired after 101 seconds; with a 10-second safety margin, the recommended maximum hold is 91 seconds. See [docs/HOLD-WINDOW.md](docs/HOLD-WINDOW.md) for the run record and HashScan transactions.

## Public records

The settlement topic is configured by `HCS_SETTLEMENT_TOPIC_ID`; the dispute topic is configured by `HCS_DISPUTE_TOPIC_ID`. Each disputed result produces three compact HCS messages with the same timestamp:

1. `dispute`: parties, roots, rule, content hashes, votes, amounts, and final resolution.
2. `verdict`: the rule and compact checker votes.
3. `bond`: bond, stake, reputation, and payment transaction IDs.

Live Hedera Testnet records:

| Resource | ID | Evidence |
| --- | --- | --- |
| Settlement topic | `0.0.10501385` | [HashScan](https://hashscan.io/testnet/topic/0.0.10501385) |
| Dispute topic | `0.0.10501386` | [HashScan](https://hashscan.io/testnet/topic/0.0.10501386) |
| Bond escrow | `0.0.10502300` | [Contract](https://hashscan.io/testnet/contract/0.0.10502300) · [Creation transaction](https://hashscan.io/testnet/transaction/0.0.10472838@1789221045.369240725) |
| Honest FX settlement | `1302814f-dcff-4653-8a64-4964cb0e975c` | [Payment](https://hashscan.io/testnet/transaction/0.0.7162784@1789225308.975547656) · [HCS receipt](https://hashscan.io/testnet/transaction/0.0.10472838@1789225312.834478783) |
| Latest honest FX settlement | `a7353260-8829-445e-ad23-d6f23baa3bae` | [Payment](https://hashscan.io/testnet/transaction/0.0.7162784@1789245767.729586729) · [HCS receipt](https://hashscan.io/testnet/transaction/0.0.10472838@1789245772.571672131) |
| Post-hardening honest FX settlement | `0721bd9e-332c-416f-8cde-4d091164e8a6` | [Payment](https://hashscan.io/testnet/transaction/0.0.7162784@1789252458.310034075) · [HCS receipt](https://hashscan.io/testnet/transaction/0.0.10472838@1789252461.678940522) |
| Signed-transfer measurement | 100 seconds settled; 101 seconds expired | [100-second settlement](https://hashscan.io/testnet/transaction/0.0.7162784@1789224054.629001290) · [run record](docs/HOLD-WINDOW.md) |

A replayable dispute ID will be added only after a complete live rejection is recorded.

## Hedera-specific rationale

The resource server delivers before settlement, so the payment hold must survive evaluation inside a live HTTP request. Hedera's fast consensus and predictable low fees are important because the evaluator and checker quorum must finish before the signed transfer expires, while false-rejection adjudication must cost less than the trade. HCS provides an independently readable receipt stream, HTS can provide the settlement token and automatic protocol fee, and Mirror Node is the read authority for reconciliation and replay. The mechanism is not merely an API wrapper: removing fast finality, low fixed fees, or the HCS audit stream weakens the economic and trust model.

## Extra capability map

| Capability | Evidence in this repository | Current status |
| --- | --- | --- |
| Live x402 resource path | `services/providers/src/app.ts:1` and `packages/sdk/src/protect.ts:1` | Implemented; honest FX request settled on testnet with linked evidence |
| Independent checker implementation | `services/checker-go/main.go:1` | Go checker tested independently and verified over live local HTTP |
| HCS payment/dispute audit | `packages/hcs/src/` and `services/settlement/src/service.ts:1` | Implemented; settlement and dispute topics live on testnet |
| Mirror Node replay | `packages/replay/src/index.ts:1` | Implemented and tested |
| Bond and provider stake | `contracts/src/VerityBondEscrow.sol:1` and `packages/hcs/src/escrow.ts:1` | Escrow deployed on testnet; provider stake remains to be posted |
| Proof of Human root | `packages/agent/src/identity.ts:1` | Session and uniqueness proof verification implemented; World credentials/config required |
| Two-sided reputation anchor | `contracts/src/VerityBondEscrow.sol:1` | On-chain anchor deployed; public score indexing remains |
| Graph composition and MCP/SKILL tooling | `graph/substreams/substreams.yaml.template:1`, `graph/subgraph/subgraph.yaml.template:1`, `services/graph-gateway/src/app.ts:1`, `packages/indexer/src/mcp.ts:1`, and `skills/verity-reputation/SKILL.md:1` | Standard EVM Subgraph deployed to Studio; v0.1.1 has live provider/buyer Agent0 identities indexed and v0.1.2 contains the endpoint projection fix; Substreams package, paid query service, routing, MCP handler, and reusable skill implemented; Graph Market publication and feedback-backed scores remain |
| Scheduled transactions | `contracts/src/VerityBondEscrow.sol:88`, `packages/hcs/src/escrow.ts:42`, and `packages/sdk/src/buy.ts:1` | Expiring bonds, wait-for-expiry scheduling, and SDK wiring implemented; needs a live testnet run |
| HTS custom fee settlement asset | `packages/hcs/src/token.ts:1` and `scripts/provision-token.ts:1` | Optional provisioning, association assertions, metadata checks, and same-token fee implemented; needs a live testnet run |
| ERC-8004/HCS-14 registry | `packages/indexer/src/identity-registry.ts:1` and `scripts/register-erc8004.ts:1` | Live EVM registration, URI verification, and resumable transaction recording implemented; requires operator RPC/config and one real registry transaction |

## Limitations

Verity applies only where a ground-truth rule can be written and replayed. The reference market is small, the checker quorum is small, and content storage is file-backed. The standard EVM Subgraph is hosted in Studio on Base Sepolia; v0.1.1 contains live provider and buyer Agent0 registration entities, while corrected v0.1.2 is syncing the endpoint projection fix. Feedback-backed scores still require the real adjudication run; the separate Substreams package has not yet been published through Graph Market. ERC-8004 registration is wired to the published EVM registry interface and the Base Sepolia provider/buyer identities are live. World ID verification requires the operator's configured app, RP, signing key, and proof; session mode is the durable-root path, while uniqueness mode is action-scoped. The HTS token command and scheduled bond expiry are optional and each require a live testnet transaction. External provider adoption, a real replayable dispute, public hosting, the demo video, and the Harness PR remain outstanding.

## Adoption

`ADOPTION.md` tracks third-party services only after their operators run their own process with the SDK and provide a reachable endpoint. No external team is represented as integrated yet.
