import pg from "pg";

export type PgSnapshot = { lsn: string; commits: number; inserted: number; updated: number; deleted: number };
export type PgDiff = Omit<PgSnapshot, "lsn"> & { walBytes: number };

async function withClient<T>(url: string, fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export function snapshot(url: string): Promise<PgSnapshot> {
  return withClient(url, async client => {
    const { rows } = await client.query(
      `select pg_current_wal_lsn()::text as lsn,
              sum(xact_commit)::float8 as commits,
              sum(tup_inserted)::float8 as inserted,
              sum(tup_updated)::float8 as updated,
              sum(tup_deleted)::float8 as deleted
       from pg_stat_database`,
    );
    return rows[0] as PgSnapshot;
  });
}

export async function diff(url: string, before: PgSnapshot): Promise<PgDiff> {
  const after = await snapshot(url);
  const walBytes = await withClient(url, async client => {
    const { rows } = await client.query("select pg_wal_lsn_diff($1, $2)::float8 as bytes", [after.lsn, before.lsn]);
    return rows[0].bytes as number;
  });
  return {
    walBytes,
    commits: after.commits - before.commits,
    inserted: after.inserted - before.inserted,
    updated: after.updated - before.updated,
    deleted: after.deleted - before.deleted,
  };
}
