import { appendFile, mkdir } from "node:fs/promises";

import type { ChainOut } from "../chain.ts";
import { get, postJson } from "../http.ts";
import { checksum } from "../probe/checksum.ts";
import { expected, starts } from "../probe/collatz.ts";
import type { Adapter } from "./adapter.ts";
import { diff, snapshot } from "./pg-stats.ts";

const num = (name: string, fallback: number) => Number(process.env[name] ?? fallback);
const engine = process.env.ENGINE;
if (!engine) throw new Error("ENGINE is required");
const seed = num("SEED", 1);
const n = num("N", 3);
const bits = num("BITS", 41);
const k = num("K", 1);
const timeoutMs = num("TIMEOUT_MS", 600_000);
const staggerMs = num("STAGGER_MS", 0);
const label = process.env.LABEL ?? "smoke";
const stubUrl = process.env.STUB_URL ?? "http://stub:8080";
const pgUrl = process.env.PG_URL;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`no result after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function quantiles(values: number[]) {
  const sorted = [...values].sort((x, y) => x - y);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? null;
  return { p50: at(0.5), p95: at(0.95), p99: at(0.99), max: sorted.at(-1) ?? null };
}

const exp = expected(seed, n, bits, k);
const expSum = checksum(exp.perChain);
const { connect } = (await import(`./adapters/${engine}.ts`)) as { connect(): Promise<Adapter> };
const adapter = await connect();

await postJson(`${stubUrl}/reset`, {});
const pgBefore = pgUrl ? await snapshot(pgUrl) : undefined;
const runId = `${engine}-${Date.now().toString(36)}`;
const startedAt = Date.now();

const settled = await Promise.allSettled(
  starts(seed, n, bits).map(async (v, i) => {
    if (staggerMs > 0) await new Promise(resolve => setTimeout(resolve, i * staggerMs));
    const t0 = Date.now();
    const wf = `${runId}-${i}`;
    const out = await withTimeout(adapter.call<ChainOut>("chain", wf, { wf, i, v: v.toString(), k, t0 }), timeoutMs);
    return { ...out, latencyMs: Date.now() - t0 };
  }),
);
const wallMs = Date.now() - startedAt;

await new Promise(resolve => setTimeout(resolve, 1000));
const pg = pgUrl && pgBefore ? await diff(pgUrl, pgBefore) : undefined;
const stub = JSON.parse((await get(`${stubUrl}/stats?prefix=${encodeURIComponent(runId)}`)).text) as {
  calls: number;
  dupKeys: number;
  dupCalls: number;
};

const perChain = new Array<number>(n).fill(-1);
const latencies: number[] = [];
const stepLatencies: number[] = [];
const errors: string[] = [];
let messages = 0;
for (const result of settled) {
  if (result.status === "fulfilled") {
    perChain[result.value.i] = result.value.s;
    latencies.push(result.value.latencyMs);
    stepLatencies.push(result.value.latencyMs / Math.max(1, result.value.n));
    messages += result.value.n;
  } else {
    errors.push(String(result.reason).slice(0, 300));
  }
}
const completed = latencies.length;
const sum = completed === n ? checksum(perChain) : null;

const summary = {
  at: new Date().toISOString(),
  engine,
  label,
  runId,
  params: { seed, n, bits, k, staggerMs },
  expected: { messages: exp.messages, calls: exp.calls, checksum: expSum },
  got: {
    completed,
    failed: n - completed,
    messages,
    checksum: sum,
    stubCalls: stub.calls,
    dupKeys: stub.dupKeys,
    dupCalls: stub.dupCalls,
  },
  ok: sum === expSum && messages === exp.messages && stub.calls === exp.calls && stub.dupCalls === 0,
  wallMs,
  stepsPerSec: Math.round((messages / wallMs) * 1000 * 10) / 10,
  latencyMs: quantiles(latencies),
  stepLatencyMs: quantiles(stepLatencies),
  pg: pg && { ...pg, walBytesPerStep: messages > 0 ? Math.round(pg.walBytes / messages) : null },
  errors: [...new Set(errors)].slice(0, 5),
};

console.log(JSON.stringify(summary, null, 2));
if (process.env.RECORD !== "0") {
  await mkdir("results", { recursive: true });
  await appendFile("results/runs.jsonl", `${JSON.stringify(summary)}\n`);
}
await adapter.close();
process.exit(summary.ok ? 0 : 1);
