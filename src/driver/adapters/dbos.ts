import { DBOSClient } from "@dbos-inc/dbos-sdk";

import { serializer } from "../../engines/dbos/serializer.ts";
import type { Adapter } from "../adapter.ts";

export async function connect(): Promise<Adapter> {
  const client = await DBOSClient.create({ systemDatabaseUrl: process.env.DBOS_SYSTEM_DATABASE_URL!, serializer });
  const pollMs = process.env.DBOS_RESULT_POLL_MS;
  return {
    call: async <T>(workflow: string, id: string, input: unknown) => {
      const handle = await client.enqueue<(input: unknown) => Promise<T>>(
        { queueName: "a", workflowName: workflow, applicationName: "a", workflowID: id },
        input,
      );
      return handle.getResult(pollMs ? { pollingIntervalMs: Number(pollMs) } : undefined);
    },
    close: () => client.destroy(),
  };
}
