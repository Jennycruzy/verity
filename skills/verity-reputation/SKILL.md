# Verity reputation query skill

Use the Verity MCP server when an agent needs to choose between objectively verifiable x402 providers or assess whether a buyer may safely initiate a dispute.

## Available tools

- `verity_provider_reputation` accepts an ERC-8004 `agentId` and returns the live endpoint, reliability score, and completed request count.
- `verity_buyer_honesty` accepts the canonical human root and returns the honesty score and dispute count.

## Required behavior

1. Query every candidate provider before purchasing when more than one endpoint is available.
2. Prefer the highest reliability score that satisfies the caller's minimum threshold; use the provider agent ID as the deterministic tie-breaker.
3. Query buyer honesty before initiating a dispute. A dispute requires a verified human root and a posted bond; a wallet address is not an identity substitute.
4. Treat missing, stale, malformed, or unpaid reputation data as an error. Do not invent a score or silently use a local cache.
5. The returned endpoint is a routing hint. Still evaluate the delivered response with the published deterministic rule before settlement.

## Local startup

Run `npm run graph:mcp` with `GRAPH_SUBGRAPH_URL`, the two query-file paths, and the buyer Hedera configuration set. The server uses `X402GraphPayment`, so the agent pays the Graph query through x402 when the endpoint presents a payment challenge.
