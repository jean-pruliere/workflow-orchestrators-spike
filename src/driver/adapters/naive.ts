import pg from "pg";

import type { ChainOut } from "../../chain.ts";
import type { Adapter } from "../adapter.ts";

export async function connect(): Promise<Adapter> {
  const pool = new pg.Pool({ connectionString: process.env.PG_URL, max: 4 });
  const waiting = new Map<string, (out: ChainOut) => void>();

  const collect = async () => {
    const { rows } = await pool.query<{ wf_id: string; payload: ChainOut }>(
      "update task set status = 'Success', updated_at = now() where target = 'done' and status = 'Pending' returning wf_id, payload",
    );
    for (const row of rows) {
      waiting.get(row.wf_id)?.(row.payload);
      waiting.delete(row.wf_id);
    }
  };
  const timer = setInterval(() => collect().catch(error => console.error("collect failed", error)), 200);

  return {
    start: async input => {
      const done = new Promise<ChainOut>(resolve => waiting.set(input.wf, resolve));
      await pool.query("insert into task (wf_id, target, type, payload) values ($1, 'a', 'start', $2)", [input.wf, input]);
      return done;
    },
    close: async () => {
      clearInterval(timer);
      await pool.end();
    },
  };
}
