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
