# Verity feedback Substreams package

This package selects the standard ERC-8004 `NewFeedback` event from the
Ethereum common Substreams module. It is intentionally address-agnostic at the
stream layer: the downstream Subgraph mapping receives the event address and
stores it with the feedback record, so the deployment can be configured with
the current Agent0 Reputation Registry without changing the package source.

The package is consumed by `../subgraph/subgraph.yaml` as a
Substreams-powered Subgraph. The package does not contain payment or
reputation fixtures.

## Validate and pack

Install the official Substreams CLI (`substreams --version` should report
1.7.2 or newer), then run:

```sh
cd graph/substreams
substreams pack
```

The generated `.spkg` is a build artifact and is intentionally ignored. The
deployment manifest references that local package after packing.

