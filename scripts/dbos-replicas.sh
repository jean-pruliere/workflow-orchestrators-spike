#!/bin/sh
# Two B replicas on DBOS's default executor ID ("local"): restart one mid-run, then look for re-run work.
set -u
file=compose/dbos.yml
out=$(mktemp)
export STEP_DELAY_MS=100 DBOS_QUEUE_POLL_MS=100 DBOS_RESULT_POLL_MS=100 DBOS_EXECUTOR_ID_B=

compose() { docker compose -f "$file" "$@"; }
compose --profile driver down -v --remove-orphans >/dev/null 2>&1
compose up -d --scale b=2 >/dev/null 2>&1 || { echo "up failed"; exit 1; }
ready=0
for _ in $(seq 1 60); do
  if compose run --rm -e N=1 -e K=100 -e TIMEOUT_MS=20000 -e RECORD=0 driver >/dev/null 2>&1; then ready=1; break; fi
  sleep 2
done
[ "$ready" = 1 ] || { echo "not ready"; exit 1; }

compose run --rm -e N=10 -e K=1 -e TIMEOUT_MS=300000 -e LABEL=fault:restart-b-replica-shared-id driver >"$out" 2>&1 &
driver=$!
sleep 10
docker kill -s KILL wos-dbos-b-2 >/dev/null
sleep 10
docker start wos-dbos-b-2 >/dev/null
wait "$driver"

grep -E '"(completed|failed|checksum|stubCalls|dupKeys|dupCalls|wallMs)"' "$out" | tr -d ' \n'; echo
docker exec wos-dbos-pg-1 psql -U postgres -d dbos_sys -At -c \
  "select name, executor_id, status, count(*) from dbos.workflow_status group by 1, 2, 3 order by 1, 2, 3"
rm -f "$out"
compose --profile driver down -v --remove-orphans >/dev/null 2>&1
