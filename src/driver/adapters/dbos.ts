import { DBOSClient } from "@dbos-inc/dbos-sdk";

import type { ChainIn, ChainOut } from "../../chain.ts";
import type { Adapter } from "../adapter.ts";

export async function connect(): Promise<Adapter> {
  const client = await DBOSClient.create({ systemDatabaseUrl: process.env.DBOS_SYSTEM_DATABASE_URL! });
  return {
    start: async input => {
      const handle = await client.enqueue<(input: ChainIn) => Promise<ChainOut>>(
        { queueName: "a", workflowName: "chain", applicationName: "a", workflowID: input.wf },
        input,
      );
      const pollMs = process.env.DBOS_RESULT_POLL_MS;
      return handle.getResult(pollMs ? { pollingIntervalMs: Number(pollMs) } : undefined);
    },
    close: () => client.destroy(),
  };
}
