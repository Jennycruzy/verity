# Ownership notes

This repository is new. The boundaries below are intentional:

- `packages/types/` contains shared protocol types and deterministic rules.
- `packages/hedera/` contains facilitator discovery and Hedera-facing primitives.
- `packages/hcs/`, `services/settlement/`, and `packages/replay/` are the settlement-side boundary.
- `packages/sdk/`, `services/providers/`, `packages/agent/`, `packages/indexer/`, `apps/explorer/`, and `docs/` are the product-side boundary.

Shared type changes require an entry here explaining the migration. No account IDs, keys, prices, or service URLs belong in source code.

The dispute record now carries an `evaluationInput` content reference. Replay uses that immutable off-chain object together with the recorded rule identifier; existing records are not expected before this schema is published.

The shared dispute schema now uses `CrossCheckerVerdict` for compact checker identity, rule, verdict, and reason fields. Full evaluator evidence remains off-chain so HCS records stay within the message limit; replay continues to use the immutable evaluation input and rule.

Dispute records may carry the buyer's `bondTransactionId`. SDK callers that post a bond must pass this transaction ID through the dispute intake so the HCS audit can link the bond movement to the adjudication.

HCS dispute receipts use hash-only content references and compact checker receipts. The full content metadata stays with the content service; replay reconstructs the content URL from the configured base and verifies the returned bytes against the recorded hash.

World ID roots are durable identity registry keys. The root store rejects reuse of the same action/nullifier pair, so a punished buyer cannot replay the proof from a fresh address; a registered provider can still attach multiple endpoints to its existing root.

Provider eligibility is now anchored as `provider` records on the settlement HCS topic with the provider root, stake amount, payout address, and stake transaction ID. The dispute server reads those records through Mirror Node; `VERITY_PROVIDER_REGISTRY_FILE` remains an operator cache written by the staking command.
