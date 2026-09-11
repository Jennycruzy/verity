# Ownership notes

This repository is new. The boundaries below are intentional:

- `packages/types/` contains shared protocol types and deterministic rules.
- `packages/hedera/` contains facilitator discovery and Hedera-facing primitives.
- `packages/hcs/`, `services/settlement/`, and `packages/replay/` are the settlement-side boundary.
- `packages/sdk/`, `services/providers/`, `packages/agent/`, `packages/indexer/`, `apps/explorer/`, and `docs/` are the product-side boundary.

Shared type changes require an entry here explaining the migration. No account IDs, keys, prices, or service URLs belong in source code.
