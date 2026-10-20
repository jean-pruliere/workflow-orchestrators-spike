#!/bin/sh
# usage: scripts/perf.sh <engine> <steps-per-second> [load-seconds]   (run from the repo root)
set -u
engine=$1
rate=$2
load_s=${3:-180}
file=compose/$engine.yml
run=perf-$engine-$rate-$(date +%s)
mkdir -p results/samples
samples=results/samples/$run.jsonl
summary=results/samples/$run.summary.txt
now() { node -e 'console.log(Date.now())'; }

export STEP_DELAY_MS=0 POLL_MS=100 DBOS_QUEUE_POLL_MS=100 DBOS_RESULT_POLL_MS=100
# 292.3 steps per chain on average at BITS=41, K=1 (reference vector seed=42 n=10000).
n=$(python3 -I -c "print(max(1, round($rate * $load_s / 292.3)))")
stagger=$(python3 -I -c "print(round(292.3 / $rate * 1000))")

compose() { docker compose -f "$file" "$@"; }
compose --profile driver down -v --remove-orphans >/dev/null 2>&1
compose up -d >/dev/null 2>&1 || { echo "$engine: up failed"; exit 1; }
ready=0
for _ in $(seq 1 60); do
  if compose run --rm -e N=1 -e K=100 -e TIMEOUT_MS=20000 -e RECORD=0 driver >/dev/null 2>&1; then ready=1; break; fi
  sleep 2
done
[ "$ready" = 1 ] || { echo "$engine: not ready"; exit 1; }

targets=""
for service in $(compose ps --services); do
  [ "$service" = stub ] && continue
  targets="$targets$service=$(compose ps -q "$service"),"
done
docker rm -f wos-sampler >/dev/null 2>&1
docker run -d --rm --name wos-sampler --privileged -v /sys/fs/cgroup:/sys/fs/cgroup:ro \
  -v "$PWD/results:/app/results" -e TARGETS="$targets" -e OUT="$samples" wos-app:dev node src/sampler/main.ts >/dev/null

idle_from=$(now)
sleep 45
load_from=$(now)
compose run --rm -e N="$n" -e K=1 -e STAGGER_MS="$stagger" -e TIMEOUT_MS=900000 -e RECORD=0 \
  -e LABEL="$run" driver >"$summary" 2>/dev/null
load_to=$(now)
sleep 2
docker stop wos-sampler >/dev/null

node src/perf/analyze.ts "$engine" "$rate" "$samples" "$summary" "$idle_from" "$load_from" "$load_to" | tee -a results/perf.jsonl
compose --profile driver down -v --remove-orphans >/dev/null 2>&1
