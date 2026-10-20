#!/bin/sh
# usage: scripts/scenario.sh <engine> <scenario> [variant]   (run from the repo root)
set -u
engine=$1
scenario=$2
variant=${3:-default}
file=compose/$engine.yml
project=wos-$engine
out=$(mktemp)

export STEP_DELAY_MS=0 POLL_MS=100 DBOS_QUEUE_POLL_MS=100 DBOS_RESULT_POLL_MS=100
export ENCRYPT=0 PAYLOAD_KEY="$(openssl rand -hex 32)" MARKER="SECRET$(openssl rand -hex 4)"
export WORKFLOWS=workflows WORKFLOW_VERSION=1 VERSIONING=none APP_VERSION=
count=1
second_wave=0
case "$scenario:$variant" in
  sealed:encrypted) ENCRYPT=1 ;;
  versioned:*) count=3 second_wave=15 ;;
esac
[ "$engine:$scenario:$variant" = "dbos:versioned:patched" ] && VERSIONING=patched
[ "$engine:$scenario:$variant" = "dbos:versioned:unversioned" ] && APP_VERSION=v1

compose() { docker compose -f "$file" "$@"; }
compose --profile driver --profile v2 down -v --remove-orphans >/dev/null 2>&1
compose up -d >/dev/null 2>&1 || { echo "$engine: up failed"; exit 1; }
ready=0
for _ in $(seq 1 60); do
  if compose run --rm -e N=1 -e K=100 -e TIMEOUT_MS=20000 -e RECORD=0 driver >/dev/null 2>&1; then ready=1; break; fi
  sleep 2
done
[ "$ready" = 1 ] || { echo "$engine: not ready"; exit 1; }

compose run --rm -e SCENARIO="$scenario" -e VARIANT="$variant" -e COUNT="$count" \
  -e SECOND_WAVE_AFTER_S="$second_wave" driver node src/scenarios/run.ts >"$out" 2>&1 &
runner=$!

redeploy() {
  case "$engine:$variant" in
    temporal:patched) WORKFLOWS=workflows-v2 compose up -d --no-deps --force-recreate a ;;
    temporal:unversioned) WORKFLOWS=workflows-v2-unversioned compose up -d --no-deps --force-recreate a ;;
    dbos:patched) WORKFLOW_VERSION=2 compose up -d --no-deps --force-recreate a ;;
    dbos:unversioned) WORKFLOW_VERSION=2 APP_VERSION=v2 compose up -d --no-deps --force-recreate a ;;
    restate:in-place)
      WORKFLOW_VERSION=2 compose up -d --no-deps --force-recreate a
      compose run --rm --no-deps -e TARGETS=a restate-register ;;
    restate:blue-green)
      WORKFLOW_VERSION=2 compose --profile v2 up -d --no-deps a-v2
      compose run --rm --no-deps -e TARGETS=a-v2 restate-register ;;
  esac
}

case "$scenario" in
  timer)
    sleep 8
    docker kill -s KILL "$project-a-1" >/dev/null
    sleep 10
    docker start "$project-a-1" >/dev/null ;;
  versioned)
    sleep 6
    redeploy >"$out.redeploy" 2>&1; sed "s/^/redeploy: /" "$out.redeploy"; rm -f "$out.redeploy" ;;
esac
wait "$runner"

if [ "$scenario" = sealed ]; then
  hex=$(printf %s "$MARKER" | xxd -p | tr -d '\n')
  case "$engine" in
    temporal) dbs="temporal temporal_visibility" ;;
    dbos) dbs="dbos_sys" ;;
    *) dbs="" ;;
  esac
  for db in $dbs; do
    dump=$(docker exec "$project-pg-1" pg_dump -U postgres "$db")
    echo "scan $db: plain $(printf %s "$dump" | grep -c "$MARKER"), hex $(printf %s "$dump" | grep -ci "$hex")"
  done
  if [ "$engine" = restate ]; then
    echo "scan restate-data: $(docker exec "$project-restate-1" sh -c "grep -rac '$MARKER' /restate-data 2>/dev/null | awk -F: '{s+=\$NF} END {print s+0}'" 2>&1)"
  fi
fi

grep -E '"(pass|scenario|variant|engine)"' "$out" | tr -d ' \n'; echo
grep -E '^\{' -A1000 "$out" | grep -E '"detail"' -A12 | head -14
rm -f "$out"
compose --profile driver --profile v2 down -v --remove-orphans >/dev/null 2>&1
