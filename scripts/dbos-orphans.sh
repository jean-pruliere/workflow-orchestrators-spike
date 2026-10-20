#!/bin/sh
set -u
file=compose/dbos.yml
out=$(mktemp)
export STEP_DELAY_MS=100 DBOS_QUEUE_POLL_MS=100 DBOS_RESULT_POLL_MS=100

compose() { docker compose -f "$file" "$@"; }
compose --profile driver down -v --remove-orphans >/dev/null 2>&1
compose up -d >/dev/null 2>&1 || { echo "up failed"; exit 1; }
ready=0
for _ in $(seq 1 60); do
  if compose run --rm -e N=1 -e K=100 -e TIMEOUT_MS=20000 -e RECORD=0 driver >/dev/null 2>&1; then ready=1; break; fi
  sleep 2
done
[ "$ready" = 1 ] || { echo "not ready"; exit 1; }

compose run --rm -e N=10 -e K=1 -e TIMEOUT_MS=90000 -e RECORD=0 driver >"$out" 2>&1 &
driver=$!
sleep 10
docker kill -s KILL wos-dbos-a-1 >/dev/null
sleep 10
DBOS_EXECUTOR_ID_A=a-replacement compose up -d --no-deps --force-recreate a >/dev/null 2>&1
wait "$driver"

grep -E '"(completed|failed)"' "$out" | tr -d ' \n'; echo
docker exec wos-dbos-pg-1 psql -U postgres -d dbos_sys -At -c \
  "select name, executor_id, status, count(*) from dbos.workflow_status group by 1, 2, 3 order by 1, 2, 3"
rm -f "$out"
compose --profile driver down -v --remove-orphans >/dev/null 2>&1
