import pg from "pg";

import { targetOf, type ChainIn, type StepIn, type StepOut } from "../../chain.ts";
import { step } from "../../step.ts";
import { schema } from "./schema.ts";

type Role = "a" | "b" | "c";
type Ctx = { wf: string; i: number; t0: number; k: number };
type Task =
  | { id: string; type: "start"; payload: ChainIn }
  | { id: string; type: "step"; payload: { ctx: Ctx; step: StepIn } }
  | { id: string; type: "result"; payload: { ctx: Ctx; n: number } & StepOut };
type Next = { wf: string; target: string; type: string; payload: unknown; result?: unknown };

const role = process.env.ROLE as Role;
const pollMs = Number(process.env.POLL_MS ?? 5000);
const batchSize = Number(process.env.BATCH_SIZE ?? 100);
const parallelism = Number(process.env.PARALLELISM ?? 10);
const lockKey = { a: 1001, b: 1002, c: 1003 }[role];

const pool = new pg.Pool({ connectionString: process.env.PG_URL, max: parallelism + 2 });

function dispatch(ctx: Ctx, n: number, v: string, s: number): Next {
  if (v === "1") return { wf: ctx.wf, target: "done", type: "done", payload: { i: ctx.i, s, t0: ctx.t0, n } };
  return { wf: ctx.wf, target: targetOf(n), type: "step", payload: { ctx, step: { wf: ctx.wf, n, v, s, k: ctx.k } } };
}

async function decide(task: Task): Promise<Next> {
  switch (task.type) {
    case "start": {
      const { wf, i, t0, k, v } = task.payload;
      return dispatch({ wf, i, t0, k }, 0, v, 0);
    }
    case "result":
      return dispatch(task.payload.ctx, task.payload.n, task.payload.v, task.payload.s);
    case "step": {
      const out = await step(task.payload.step);
      const { ctx, step: input } = task.payload;
      return { wf: ctx.wf, target: "a", type: "result", payload: { ctx, n: input.n + 1, ...out }, result: out };
    }
  }
}

async function handle(task: Task): Promise<void> {
  try {
    const next = await decide(task);
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("update task set status = 'Success', result = $2, updated_at = now() where id = $1", [
        task.id,
        next.result ?? null,
      ]);
      await client.query("insert into task (wf_id, target, type, payload) values ($1, $2, $3, $4)", [
        next.wf,
        next.target,
        next.type,
        next.payload,
      ]);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    await pool.query("update task set status = 'Failure', reason = $2, updated_at = now() where id = $1", [
      task.id,
      String(error),
    ]);
  }
}

async function pull(client: pg.PoolClient): Promise<Task[]> {
  await client.query("begin isolation level repeatable read");
  const { rows } = await client.query<Task>(
    `select id, type, payload from task
     where status = 'Pending' and target = $1 and due_at <= now()
     order by due_at, created_at limit $2`,
    [role, batchSize],
  );
  if (rows.length > 0) {
    await client.query("update task set status = 'Processing', updated_at = now() where id = any($1)", [
      rows.map(row => row.id),
    ]);
  }
  await client.query("commit");
  return rows;
}

async function cycle(): Promise<void> {
  const client = await pool.connect();
  try {
    const { rows } = await client.query<{ locked: boolean }>("select pg_try_advisory_lock($1) as locked", [lockKey]);
    if (!rows[0].locked) return;
    try {
      const tasks = await pull(client);
      for (let j = 0; j < tasks.length; j += parallelism) {
        await Promise.all(tasks.slice(j, j + parallelism).map(handle));
      }
    } finally {
      await client.query("select pg_advisory_unlock($1)", [lockKey]);
    }
  } finally {
    client.release();
  }
}

const init = await pool.connect();
try {
  await init.query("select pg_advisory_lock(1000)");
  await init.query(schema);
  await init.query("select pg_advisory_unlock(1000)");
} finally {
  init.release();
}

setInterval(() => cycle().catch(error => console.error("cycle failed", error)), pollMs);
console.log(`naive/${role} polling every ${pollMs} ms`);
