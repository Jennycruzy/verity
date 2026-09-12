# Public deployment

The Hedera settlement proof can run from a laptop. A public URL is needed for the explorer, content-addressed replay, and independent provider adoption. Verity's compose deployment uses Caddy for HTTPS and keeps credentials in the server's ignored `.env` file.

## 1. Prepare DNS and a small server

Use any Linux VPS with Docker Engine and the Compose plugin. Point these hostnames at its public IPv4 address before starting Caddy:

```text
content.<domain>
disputes.<domain>
fx.<domain>
fx-secondary.<domain>
bad-fx.<domain>
checker.<domain>
explorer.<domain>
reputation.<domain>
identity.<domain>
```

A wildcard DNS record is sufficient if the DNS provider supports it. Ports 80 and 443 must be reachable from the internet.

## 2. Install and configure

Run on the server:

```sh
git clone https://github.com/Jennycruzy/verity.git
cd verity
cp .env.example .env
chmod 600 .env
npm install
```

Set the deployment values in `.env` without committing the file:

```dotenv
VERITY_DOMAIN=<domain>
CONTENT_STORE_BASE_URL=https://content.<domain>
CONTENT_STORE_PUBLIC_URL=https://content.<domain>
CONTENT_STORE_WRITE_TOKEN=<long-random-upload-token>
VERITY_DISPUTE_URL=https://disputes.<domain>/disputes
VERITY_DISPUTE_HEALTH_URL=https://disputes.<domain>/health
VERITY_DEMO_PROVIDER_URL=https://fx.<domain>/fx
VERITY_DEMO_BAD_PROVIDER_URL=https://bad-fx.<domain>/fx
VERITY_PROVIDER_PUBLIC_URL=https://fx.<domain>

# Hosted Graph values copied from Graph Studio.
GRAPH_STUDIO_QUERY_URL=<hosted-studio-query-url>
GRAPH_GATEWAY_UPSTREAM_API_KEY=<hosted-graph-api-key>
GRAPH_GATEWAY_PRICE=<positive-tinybar-amount>
GRAPH_SUBGRAPH_URL=https://reputation.<domain>/query
GRAPH_API_KEY=<explorer-query-key-if-required>

# World values copied from the World Developer Portal.
WORLD_ID_APP_ID=<app_id>
WORLD_ID_RP_ID=<rp_id>
WORLD_ID_SIGNING_KEY=<local-world-signing-key>
WORLD_ID_VERIFY_URL=https://developer.world.org/api/v4/verify/<rp_id>
WORLD_ID_PROOF_MODE=session
WORLD_ID_PROVIDER_ACTION=verity-provider-registration
WORLD_ID_DISPUTE_ACTION=<configured-world-action>
WORLD_ID_ENVIRONMENT=production

# Provider-side refusal for low-honesty buyers.
VERITY_BUYER_REPUTATION_ENDPOINT=<hosted-studio-query-url>
VERITY_BUYER_REPUTATION_API_KEY=<hosted-graph-api-key>
VERITY_BUYER_REPUTATION_QUERY_FILE=docs/graph/agent0-buyer.query.json
VERITY_BUYER_REPUTATION_MIN_HONESTY=0.8
```

Copy the Hedera account credentials and the already-provisioned topic/contract values from the local `.env` only over a secure connection. Do not paste private keys into GitHub, Discord, or this repository. The Graph signer private keys are only needed by the local registration/feedback commands; they do not belong in the public image.

Before registering the two Agent0 identities, run `npm run graph:check-signers`. It prints only the two public addresses and reports whether either needs Base Sepolia ETH. No Hedera top-up is needed for this check.

After deploying the Subgraph in Studio, verify the hosted data source before starting the gateway:

```sh
npm run graph:check-hosted
```

This sends only the standard `_meta` read query, prints the indexed block number, and never prints the Graph credential. The public gateway exposes the same check at `/ready`; `npm run public:check` fails if the process is alive but the hosted index is unavailable.

The content service keeps replay reads public but protects object uploads when `CONTENT_STORE_WRITE_TOKEN` is set. Use a long random token on a public deployment and copy it only to the buyer machine's private `.env`.

The primary `fx` service uses the provider-side buyer policy when all six policy values are present. It verifies the World proof carried by `buy()` and queries the hosted buyer score before delivering the response. The checker and degraded processes explicitly disable this policy; they never share the primary provider's human or ERC-8004 identity.

## 3. Start and smoke-test

```sh
docker compose config --quiet
docker compose up -d --build
docker compose ps
```

Check every public service before running a paid request:

```sh
for host in content disputes fx fx-secondary bad-fx checker explorer reputation identity; do
  curl --fail --silent --show-error "https://${host}.<domain>/health"
  echo
done
curl --include "https://fx.<domain>/fx"
```

Open `https://identity.<domain>/` to obtain a Proof of Human. Select the configured action, enter the exact signal that the Verity command will submit, approve the request in World App or the simulator, and copy the complete proof JSON from the page. The page verifies the proof with the configured Developer Portal endpoint before showing it. Use `WORLD_ID_ENVIRONMENT=staging` with a staging app and simulator, or `production` with a production app and World App.

From the buyer checkout on a machine with the deployment domain in `.env`, the same check is reproducible with:

```sh
npm run public:check
```

The last request must return `402` and include a `payment-required` header. The service must not return a successful provider body before the x402 payment is verified.

## 4. Run the real flows

From a machine with the buyer `.env` configured:

```sh
npm run check:config
npm run demo
npm run dispute:demo
```

Use the public content URL when running replay on another machine:

```sh
CONTENT_STORE_BASE_URL=https://content.<domain> npx verity replay <dispute-id>
```

Replay should need only Mirror Node, the dispute topic ID, and the public content store. It must not need the VPS database or a Verity API key.

## 5. Updating safely

Keep `.env` on the server and out of Git. Pull a reviewed commit, rebuild, then inspect logs for terminal errors:

```sh
git pull --ff-only
docker compose up -d --build
docker compose logs --tail=100 disputes graph-query explorer
```

If Caddy cannot obtain a certificate, fix DNS or ports 80/443 first. Do not turn off TLS or replace a failed upstream with a local cache; a public URL that is not backed by the live service is not deployment evidence.
