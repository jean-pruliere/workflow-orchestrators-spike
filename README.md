# Workflow orchestrators spike

Is Temporal the right engine for a process that spans several services, compared with Restate and DBOS, and
do we need an engine at all? This repository holds the harness and its raw results. The rule they were
judged against was written before the first run.

## What runs

One workflow is one Collatz chain from a deterministic probe. Service **A** owns the workflow; each step advances
the chain `K` times and runs alternately in service **B** and service **C**. When the value is divisible by 7,
the step calls an HTTP stub with the idempotency key `<workflowId>:<step>`.

- The checksum over every chain's step count proves an engine did exactly the work the probe's reference vectors predict.
- The stub's per-key counts expose duplicated side effects.
- Postgres deltas (`pg_stat_database`, WAL bytes) give the database cost per step.

| Engine | Version | How a step reaches B | Settings |
| --- | --- | --- | --- |
| `none` | — | A calls B over plain HTTP, no durability | positive control, latency floor |
| `naive` | — | a task table shared by every service: poller per service under an advisory lock, `Pending → Processing → Success \| Failure`, no retry, no recovery | `POLL_MS` (default 5000) |
| `temporal` | server 1.32.1, TS SDK 1.24.0 | activity on B's task queue in namespace `bench` | Helm chart defaults: postgres12, 512 shards, 20 conns |
| `restate` | server 1.8.0, TS SDK 1.17.3 | server calls B's registered endpoint; step wrapped in `ctx.run` | single node, defaults |
| `dbos` | 5.3.0 | A enqueues workflow `advance` on B's queue (`applicationName: b`) and awaits it | `DBOS_QUEUE_POLL_MS`, `DBOS_RESULT_POLL_MS` (defaults ~1 s) |

Same step code (`src/step.ts`) and same orchestration (`src/chain.ts`) everywhere; vendor SDKs only.
Postgres is `postgres:14.20`.

## Run

```sh
pnpm install && pnpm test          # the probe's reference vectors must pass first
docker build -t wos-app:dev .
docker compose -f compose/<engine>.yml up -d
docker compose -f compose/<engine>.yml run --rm -e SEED=1 -e N=3 -e K=1 driver
docker compose -f compose/<engine>.yml down -v
```

Driver settings: `SEED`, `N`, `BITS`, `K` (the probe's), `TIMEOUT_MS` per chain, `LABEL`. Every run appends one
JSON line to `results/runs.jsonl`; `ok` is true only when checksum, step count and stub calls match the vectors
with zero duplicates. No compose project publishes a host port.

## Before a performance run

- Docker: fixed CPUs and memory for its VM. Stop every other stack, listed first and restored after.
- Host: on mains power, power saving off, background indexing and backups paused, other applications closed.
- Images pinned by digest, recorded with the run.
- Check that Restate's durability matches Postgres' `fsync=on` before comparing them.
- Report ratios against Temporal from randomised pairs, never absolute numbers. Kernel time is not interpreted:
  everything runs inside Docker's VM.
