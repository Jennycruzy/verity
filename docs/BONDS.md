# Verity bonds

A rejected response is not free. The buyer posts a bond in the configured asset's smallest unit before Verity accepts a dispute. For the current escrow contract, that asset is HBAR and the unit is tinybars.

```js
const result = await buy(url, {
  evaluate: "fx-rate-v1",
  bond: "1000000"
});
```

The bond transaction ID is sent with the dispute. The dispute service checks that transaction through Mirror Node before it reads the response or runs the checkers. A missing, failed, mismatched, or already-used bond is rejected.

If the checkers uphold the buyer's rejection, the buyer receives the bond and the provider stake is slashed according to the escrow call. If the checkers overturn the rejection, the provider receives the bond and the buyer's honesty score is marked down. Both outcomes are anchored in the dispute HCS topic.

For recovery after a buyer process stops after posting, set `VERITY_BOND_EXPIRY_SECONDS`. The SDK posts `postBondWithExpiry` and creates a Hedera Scheduled Transaction that calls `releaseExpiredBond`. The scheduled release only applies while the bond is unresolved and after its expiry.

The bond amount must be positive and must be affordable by the buyer account. Use `npm run check:config` to confirm the buyer balance before a live request.
