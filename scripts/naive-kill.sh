#!/bin/sh
set -u
file=compose/naive.yml
out=$(mktemp)
export STEP_DELAY_MS=${STEP_DELAY_MS:-100} POLL_MS=100

compose() { docker compose -f "$file" "$@"; }
compose --profile driver down -v --remove-orphans >/dev/null 2>&1
compose up -d >/dev/null 2>&1 || { echo "up failed"; exit 1; }
for _ in $(seq 1 60); do
  compose run --rm -e N=1 -e K=100 -e TIMEOUT_MS=20000 -e RECORD=0 driver >/dev/null 2>&1 && break
  sleep 2
done

compose run --rm -e N=10 -e K=1 -e TIMEOUT_MS=90000 -e RECORD=0 driver >"$out" 2>&1 &
driver=$!
sleep 10
docker exec wos-naive-pg-1 psql -U postgres -At -c \
  "select 'at kill: ' || target || ' ' || status || ' ' || count(*) from task where status in ('Pending', 'Processing') group by target, status order by 1"
docker kill -s KILL wos-naive-b-1 >/dev/null
sleep 10
compose up -d --no-deps --force-recreate b >/dev/null 2>&1
wait "$driver"

grep -E '"(completed|failed)"' "$out" | tr -d ' \n'; echo
docker exec wos-naive-pg-1 psql -U postgres -At -c \
  "select 'at end: ' || target || ' ' || status || ' ' || count(*) from task group by target, status order by 1"
rm -f "$out"
compose --profile driver down -v --remove-orphans >/dev/null 2>&1
