import pg from "pg";

import type { Adapter } from "../adapter.ts";

export async function connect(): Promise<Adapter> {
  const pool = new pg.Pool({ connectionString: process.env.PG_URL, max: 4 });
  const waiting = new Map<string, (out: unknown) => void>();

  const collect = async () => {
    const { rows } = await pool.query<{ wf_id: string; payload: unknown }>(
      "update task set status = 'Success', updated_at = now() where target = 'done' and status = 'Pending' returning wf_id, payload",
    );
    for (const row of rows) {
      waiting.get(row.wf_id)?.(row.payload);
      waiting.delete(row.wf_id);
    }
  };
  const timer = setInterval(() => collect().catch(error => console.error("collect failed", error)), 200);

  return {
    call: async <T>(workflow: string, id: string, input: unknown) => {
      if (workflow !== "chain") throw new Error(`the naive engine only runs the chain, not ${workflow}`);
      const done = new Promise<T>(resolve => waiting.set(id, out => resolve(out as T)));
      await pool.query("insert into task (wf_id, target, type, payload) values ($1, 'a', 'start', $2)", [id, input]);
      return done;
    },
    close: async () => {
      clearInterval(timer);
      await pool.end();
    },
  };
}
