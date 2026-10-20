import { appendFile, mkdir } from "node:fs/promises";

import type { Adapter } from "../driver/adapter.ts";
import { get, postJson } from "../http.ts";
import type { FlowName } from "./flows.ts";

type Outcome = { run: string; wave: string; ok: boolean; value?: any; error?: string };
type LogEntry = { key: string; at: number; count: number };

const num = (name: string, fallback: number) => Number(process.env[name] || fallback);
const engine = process.env.ENGINE!;
const scenario = process.env.SCENARIO as FlowName;
const variant = process.env.VARIANT ?? "default";
const count = num("COUNT", 1);
const secondWaveAfterS = num("SECOND_WAVE_AFTER_S", 0);
const timeoutMs = num("TIMEOUT_MS", 120_000);
const sleepMs = num("SLEEP_MS", scenario === "timer" ? 30_000 : 20_000);
const marker = process.env.MARKER ?? "MARKER";
const stubUrl = process.env.STUB_URL ?? "http://stub:8080";
const runId = `${scenario}-${Date.now().toString(36)}`;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`no result after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const { connect } = (await import(`../driver/adapters/${engine}.ts`)) as { connect(): Promise<Adapter> };
const adapter = await connect();
await postJson(`${stubUrl}/reset`, {});

const wave = (name: string): Array<Promise<Outcome>> =>
  Array.from({ length: count }, (_, i) => {
    const run = `${runId}-${name}${i}`;
    return withTimeout(adapter.call(scenario, run, { run, sleepMs, marker }), timeoutMs).then(
      value => ({ run, wave: name, ok: true, value }),
      error => ({ run, wave: name, ok: false, error: String(error).slice(0, 400) }),
    );
  });

const pending = wave("w1");
if (secondWaveAfterS > 0) {
  await new Promise(resolve => setTimeout(resolve, secondWaveAfterS * 1000));
  pending.push(...wave("w2"));
}
const outcomes = await Promise.all(pending);
const log = JSON.parse((await get(`${stubUrl}/log?prefix=${encodeURIComponent(runId)}`)).text) as LogEntry[];

const marksOf = (run: string) =>
  log.filter(entry => entry.key.startsWith(`${run}:`)).map(entry => ({ ...entry, step: entry.key.slice(run.length + 1) }));
const allOk = outcomes.every(outcome => outcome.ok);

function evaluate(): { pass: boolean | null; detail: unknown } {
  switch (scenario) {
    case "typedError":
      return {
        pass: allOk && outcomes.every(o => o.value.threw && o.value.branchable),
        detail: outcomes[0].value ?? outcomes[0].error,
      };
    case "saga": {
      const orders = outcomes.map(o => marksOf(o.run).map(m => m.step));
      const expected = "reserve,debit,credit,release";
      return {
        pass: allOk && outcomes.every(o => o.value === "compensated") && orders.every(order => order.join() === expected),
        detail: { results: outcomes.map(o => o.value ?? o.error), orders },
      };
    }
    case "timer": {
      const gaps = outcomes.map(o => {
        const marks = marksOf(o.run);
        const before = marks.find(m => m.step === "before")?.at;
        const after = marks.find(m => m.step === "after")?.at;
        return before && after ? after - before : null;
      });
      return {
        pass: allOk && gaps.every(gap => gap !== null && gap >= sleepMs && gap <= sleepMs + 5_000),
        detail: { sleepMs, gapsMs: gaps, errors: outcomes.filter(o => !o.ok).map(o => o.error) },
      };
    }
    case "retry":
      return {
        pass: allOk && outcomes.every(o => o.value.flakyAttempts === 3 && o.value.slowAttempts === 2),
        detail: outcomes.map(o => o.value ?? o.error),
      };
    case "versioned": {
      const audited = (o: Outcome) => marksOf(o.run).some(m => m.step === "audit");
      const old = outcomes.filter(o => o.wave === "w1");
      const fresh = outcomes.filter(o => o.wave === "w2");
      return {
        pass: allOk && old.every(o => !audited(o)) && fresh.every(audited),
        detail: {
          old: old.map(o => ({ ok: o.ok, audited: audited(o), error: o.error })),
          fresh: fresh.map(o => ({ ok: o.ok, audited: audited(o), error: o.error })),
        },
      };
    }
    case "sealed":
      return { pass: null, detail: { completed: allOk, value: outcomes[0].value ?? outcomes[0].error } };
  }
}

async function scanRestate(): Promise<Record<string, Record<string, number>>> {
  const admin = process.env.RESTATE_ADMIN ?? "http://restate:9070";
  const hexMarker = Buffer.from(marker).toString("hex");
  const hits: Record<string, Record<string, number>> = {};
  for (const table of ["sys_journal", "sys_invocation", "sys_promise", "state"]) {
    try {
      const reply = await postJson<{ rows: Array<Record<string, unknown>> }>(
        `${admin}/query`,
        { query: `SELECT * FROM ${table}` },
        { accept: "application/json" },
      );
      const byKind: Record<string, number> = {};
      for (const row of reply.rows ?? []) {
        const text = JSON.stringify(row);
        if (!text.includes(marker) && !text.toLowerCase().includes(hexMarker)) continue;
        const kind = String(row.entry_type ?? row.status ?? "row");
        byKind[kind] = (byKind[kind] ?? 0) + 1;
      }
      hits[table] = byKind;
    } catch (error) {
      hits[table] = { scanFailed: 1 };
      console.error(`scan ${table} failed: ${String(error).slice(0, 200)}`);
    }
  }
  return hits;
}

const verdict = evaluate();
const summary = {
  at: new Date().toISOString(),
  engine,
  scenario,
  variant,
  runId,
  pass: verdict.pass,
  detail: verdict.detail,
  errors: outcomes.filter(o => !o.ok).map(o => o.error),
  restateScan: engine === "restate" && scenario === "sealed" ? await scanRestate() : undefined,
};

console.log(JSON.stringify(summary, null, 2));
await mkdir("results", { recursive: true });
await appendFile("results/scenarios.jsonl", `${JSON.stringify(summary)}\n`);
await adapter.close();
process.exit(0);
