import { fileURLToPath } from "node:url";

import { Client, Connection } from "@temporalio/client";

import { encryptionEnabled } from "../../crypto.ts";
import { payloadCodecs } from "../../engines/temporal/codec.ts";
import type { Adapter } from "../adapter.ts";

export async function connect(): Promise<Adapter> {
  const connection = await Connection.connect({ address: process.env.TEMPORAL_ADDRESS ?? "temporal:7233" });
  const failureConverterPath = fileURLToPath(new URL("../../engines/temporal/failure-converter.ts", import.meta.url));
  const client = new Client({
    connection,
    namespace: process.env.TEMPORAL_NAMESPACE ?? "bench",
    dataConverter: { payloadCodecs, failureConverterPath: encryptionEnabled ? failureConverterPath : undefined },
  });
  return {
    call: (workflow, id, input) =>
      client.workflow.execute(`${workflow}Workflow`, { taskQueue: "a", workflowId: id, args: [input] }),
    close: () => connection.close(),
  };
}
