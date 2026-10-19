#!/bin/sh
# usage: scripts/fault-campaign.sh <engine> [fault...]   (run from the repo root)
set -u
engine=$1
shift
faults=${*:-baseline replace-b replace-a restart-b-same-id kill-engine pause-store-5 pause-store-60 rolling-restart partition-b}
file=compose/$engine.yml

export STEP_DELAY_MS=${STEP_DELAY_MS:-100} POLL_MS=${POLL_MS:-100}
export DBOS_QUEUE_POLL_MS=${DBOS_QUEUE_POLL_MS:-100} DBOS_RESULT_POLL_MS=${DBOS_RESULT_POLL_MS:-100}

reset() { docker compose -f "$file" --profile driver down -v --remove-orphans >/dev/null 2>&1; }

for fault in $faults; do
  node src/faults/run.ts "$engine" "$fault" --check || continue
  reset
  docker compose -f "$file" up -d >/dev/null 2>&1 || { echo "$engine: up failed"; exit 1; }
  ready=0
  for _ in $(seq 1 60); do
    if docker compose -f "$file" run --rm -e N=1 -e K=100 -e TIMEOUT_MS=20000 -e RECORD=0 driver >/dev/null 2>&1; then
      ready=1
      break
    fi
    sleep 2
  done
  [ "$ready" = 1 ] || { echo "$engine: not ready for $fault"; exit 1; }
  node src/faults/run.ts "$engine" "$fault"
done
reset
