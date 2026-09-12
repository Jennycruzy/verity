# Signed-transfer hold measurement

The timing boundary must be measured with a funded buyer account before choosing a production request timeout. The measurement script creates a fresh partially signed Hedera transfer for every trial, verifies it immediately, waits, then asks the facilitator to settle it.

Set these values in a private `.env` before running it:

```sh
HOLD_WINDOW_AMOUNT=
HOLD_WINDOW_PAY_TO=
HOLD_WINDOW_RESOURCE_URL=
HOLD_WINDOW_MAX_DELAY_SECONDS=
HOLD_WINDOW_PAYMENT_TIMEOUT_SECONDS=
HOLD_WINDOW_SAFETY_MARGIN_SECONDS=
```

The script treats only an expiry/validity failure as a timing boundary. Balance, association, signature, network, and facilitator errors stop the run because they do not measure the requested property. Successful attempts contain a Hedera transaction ID in `artifacts/hold-window.json`.

Use an amount small enough for testnet experimentation. Every successful trial is a real transfer.

## Observed testnet result

On 2026-09-12, the configured buyer created and settled fresh HBAR transfers through Blocky402 on `hedera:testnet`. The facilitator advertised x402 v2 and fee payer `0.0.7162784`. A transfer settled after a 100-second delay; the next boundary attempt at 101 seconds failed with `TRANSACTION_EXPIRED`. The measured bracket is therefore 100 seconds successful to 101 seconds expired.

The configured safety margin is 10 seconds, so Verity's recommended maximum hold is 91 seconds. The SDK's default payment requirement timeout is 30 seconds and remains below that ceiling. Evaluators and any future checker quorum must finish within the 91-second ceiling; the x402 `maxTimeoutSeconds` setting does not extend the signed transfer's validity.

Successful measurement transactions:

- [90 seconds](https://hashscan.io/testnet/transaction/0.0.7162784@1789223300.907709068)
- [95 seconds](https://hashscan.io/testnet/transaction/0.0.7162784@1789223749.547693169)
- [98 seconds](https://hashscan.io/testnet/transaction/0.0.7162784@1789223850.949646605)
- [99 seconds](https://hashscan.io/testnet/transaction/0.0.7162784@1789223951.846843844)
- [100 seconds](https://hashscan.io/testnet/transaction/0.0.7162784@1789224054.629001290)

The full machine-readable attempt record is written to the ignored local file `artifacts/hold-window.json`.

`VERITY_BOND_EXPIRY_SECONDS` is a separate recovery timer for an unresolved escrow bond. It does not extend the signed x402 transfer validity window and cannot make a slow evaluator safe; the evaluator still has to finish inside the measured payment hold.
