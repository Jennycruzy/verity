# Verity feedback Substreams package

This package selects the standard ERC-8004 identity registration, feedback,
and feedback-revocation events from the official Ethereum common Substreams
module. The committed manifest is generic for source review. `npm run
graph:prepare` renders an ignored deployment manifest with the configured
identity and reputation registry addresses, then packs that filtered source.

The package is consumed by `../subgraph/subgraph.yaml` as a
Substreams-powered Subgraph. The package does not contain payment or
reputation fixtures.

## Validate and pack

Install the official Substreams CLI (`substreams --version` should report
1.7.2 or newer), then run:

```sh
npm run graph:build
```

The generated `.spkg` is a build artifact and is intentionally ignored. The
deployment manifest references that local package after packing.
