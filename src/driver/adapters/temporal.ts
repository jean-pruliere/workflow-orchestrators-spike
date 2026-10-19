import { Client, Connection } from "@temporalio/client";

import type { chainWorkflow } from "../../engines/temporal/workflows.ts";
import type { Adapter } from "../adapter.ts";

export async function connect(): Promise<Adapter> {
  const connection = await Connection.connect({ address: process.env.TEMPORAL_ADDRESS ?? "temporal:7233" });
  const client = new Client({ connection, namespace: process.env.TEMPORAL_NAMESPACE ?? "bench" });
  return {
    start: input =>
      client.workflow.execute<typeof chainWorkflow>("chainWorkflow", {
        taskQueue: "a",
        workflowId: input.wf,
        args: [input],
      }),
    close: () => connection.close(),
  };
}
