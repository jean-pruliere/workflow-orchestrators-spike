# Workflow orchestrators spike

Is Temporal the right engine for a process that spans several services, compared with Restate and DBOS, and
do we need an engine at all? This repository holds the harness and its raw results. The rule they were
judged against, written before the first run, and the verdict it gave come first.

## Rule

Written on 2026-10-19, before the first run. The scenarios and faults it names were fixed the same day, before
any of them ran: only two Temporal runs had checked that the fault runner works.

Temporal, the incumbent, stays unless a contender meets all four conditions:

1. **It passes every gate.** It can be self-hosted with no mandatory SaaS, a step runs in the process of the
   service that owns it, what it stores can be encrypted with our own keys, and its licence allows internal use.
2. **It passes every must-pass scenario.** A business error raised in C reaches A with a type A can branch on
   (`typedError`). A failure in C undoes B's and A's work in reverse order (`saga`). A 30 s timer survives a
   restart of A (`timer`). Retries and a timeout are set and enforced per step (`retry`). A changed workflow
   deploys while runs are in flight, and old and new runs both finish (`versioned`). What the engine stores is
   ciphertext (`sealed`).
3. **It is no worse than Temporal on durability.** Under every fault, every chain finishes with the right
   checksum within 5 minutes of its start, without a human. A side effect that runs twice is recorded, not
   failed, as long as the engine's documentation says it can happen.
4. **It is clearly better on at least one of:** fewer stateful components to run; at least 30% lower CPU,
   memory and database writes per step at 50 steps/s; recovering from a fault on its own where Temporal needs a
   human.

Cost comparisons start with 3 paired runs and add pairs, up to 8, until the 95% interval sits on one side of the
threshold. If it still doesn't, the result is inconclusive.

## Verdict: keep Temporal

Reached on 2026-10-20. No contender meets conditions 1 to 3, so condition 4 is never checked.

| Engine | Where it stops |
| --- | --- |
| Trigger.dev 4.7.4 | Condition 1, checked on paper: its tasks run only in containers it starts itself, and nothing lets it encrypt what it stores. |
| Hatchet 0.110.8 | Condition 1, checked on paper: nothing lets it encrypt payloads, which it stores as plain JSON in Postgres. Encrypting each input by hand in every step doesn't count. |
| DBOS 5.3.0 | Condition 3: a replaced container's runs are never picked up again, 6 chains of 10 lost on `replace-b` and all 10 on `replace-a`. Recovering them takes DBOS Conductor, which is proprietary and checks its licence online at startup, so it fails condition 1. `restart-b-same-id` recovers everything, but DBOS's deployment guide never describes a stable id per replica. |
| Restate 1.8.0 | Condition 2: its codec doesn't cover failures, so error messages and their metadata stay in plaintext; in `sealed`, that is the test error's account id. The codec API is marked `@experimental`. It passes every fault. |
| Temporal 1.32.1 | Passes every gate, scenario and fault. |

The baselines don't have to pass the gates. `naive` lost 7 chains of 10 on `replace-b`: a task in `Processing`
when its process dies stays there for good. `none` lost every chain whenever a service was killed or restarted,
which shows the fault runs do see lost work.

**One reading decides Restate.** Encryption is read strictly: the engine has to guarantee it, rather than every
caller keeping business data out of error messages. The same reading rules out hand-rolled encryption for
Hatchet. Read leniently, Restate passes conditions 1 to 3, and condition 4 then turns on a second reading: as
CPU, memory and database writes together it fails, because Restate's memory was not 30% lower; as CPU alone it
passes.

For context, at 50 steps/s Restate used about a fifth of Temporal's CPU per step, and DBOS about a third.

**What would reopen it:** Restate's codec covering failures and leaving `@experimental`, or DBOS recovering a
replaced container's runs without Conductor. Re-running the harness against new versions takes a few hours.

### Reading the results

- `results/faults.jsonl` keeps every run. The verdict rests on the campaign that starts on 2026-10-20 at 03:11
  UTC, whose lines carry `staggerMs`. The one before it was redone for two reasons. The host slept from
  2026-10-19 15:49 UTC, which voids every `naive` and `none` run after that time. And chains that started
  together moved in lockstep, so a fault on B hit every chain or none: that is how `naive` passed `replace-b`
  on 2026-10-20 at 01:25.
- Restate's `kill-engine` on 2026-10-19 at 15:26 lost all 10 because the driver didn't re-attach to its runs
  when the server dropped the connection; the runs themselves survived. Temporal, Restate and DBOS pass and fail
  the same faults in both campaigns, Restate's `kill-engine` once the driver re-attached.
- In `results/scenarios.jsonl`, `versioned` with variant `unversioned` or `in-place` is a control: without each
  engine's versioning mechanism, runs in flight get stuck, on all three engines.
- `sealed` prints its scan of the store to the terminal rather than recording it. To see where the marker lands,
  run `scripts/scenario.sh <engine> sealed default`, then `encrypted`.

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

## Faults and scenarios

Run from the repo root, on a host kept awake: a host that sleeps mid-run delays every timer and voids the run.

```sh
scripts/fault-campaign.sh <engine> [fault...]   # fresh stack per fault → results/faults.jsonl
scripts/scenario.sh <engine> <scenario> [variant]  # → results/scenarios.jsonl
scripts/scenario-campaign.sh                    # every scenario on temporal, restate, dbos
```

- Faults: `baseline`, `replace-a`, `replace-b`, `restart-b-same-id` (DBOS only), `kill-engine`, `pause-store-5`,
  `pause-store-60`, `rolling-restart`, `partition-b`. Chains start 137 ms apart: started together they move in
  lockstep, and a fault on B then hits every chain or none.
- Scenarios: `typedError`, `saga`, `timer`, `retry`, `versioned` (variants `patched` / `unversioned` on Temporal and
  DBOS, `blue-green` / `in-place` on Restate), `sealed` (`default` is the control, `encrypted` uses each engine's hook).
- Diagnostics: `scripts/dbos-orphans.sh`, `scripts/dbos-replicas.sh`, `scripts/naive-kill.sh`.

## Before a performance run

- Docker: fixed CPUs and memory for its VM. Stop every other stack, listed first and restored after.
- Host: on mains power, power saving off, background indexing and backups paused, other applications closed.
- Images pinned by digest, recorded with the run.
- Check that Restate's durability matches Postgres' `fsync=on` before comparing them.
- Report ratios against Temporal from randomised pairs, never absolute numbers. Kernel time is not interpreted:
  everything runs inside Docker's VM.
