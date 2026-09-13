#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
mkdir -p artifacts/content artifacts/disputes artifacts/settlement

pids=()
start() {
  "$@" &
  pids+=("$!")
}
stop() {
  trap - EXIT INT TERM
  if ((${#pids[@]})); then kill "${pids[@]}" 2>/dev/null || true; fi
  wait || true
}
trap stop EXIT INT TERM

start env PROVIDER_KIND=fx PORT=3101 DEGRADE_MODE=false node services/providers/dist/server.js
start env PROVIDER_KIND=fx PORT=3102 DEGRADE_MODE=true node services/providers/dist/server.js
start env PROVIDER_KIND=fx PORT=3103 DEGRADE_MODE=false node services/providers/dist/server.js
start env PROVIDER_KIND=entity PORT=3104 DEGRADE_MODE=false node services/providers/dist/server.js
start env PROVIDER_KIND=fx PORT=3105 DEGRADE_MODE=false node services/providers/dist/server.js
start env CHECKER_PORT=3201 CHECKER_ID=fx-independent-go CHECKER_MAX_BODY_BYTES=65536 ./bin/checker-go
start node services/content/dist/server.js
start node services/disputes/dist/server.js
start node services/graph-gateway/dist/server.js
start env EXPLORER_INTERACTIVE_DEMO=true EXPLORER_DEMO_COOLDOWN_MS=30000 EXPLORER_DEMO_TIMEOUT_MS=80000 node apps/explorer/dist/server.js
start env PUBLIC_INGRESS_PORT=18080 node --import tsx scripts/public-ingress.ts

wait -n
exit 1
