import { fileURLToPath } from "node:url";

import { NativeConnection, Worker } from "@temporalio/worker";

import { step } from "../../step.ts";

const role = process.env.ROLE ?? "a";
const connection = await NativeConnection.connect({ address: process.env.TEMPORAL_ADDRESS ?? "temporal:7233" });
const namespace = process.env.TEMPORAL_NAMESPACE ?? "bench";

const worker =
  role === "a"
    ? await Worker.create({
        connection,
        namespace,
        taskQueue: "a",
        workflowsPath: fileURLToPath(new URL("./workflows.ts", import.meta.url)),
      })
    : await Worker.create({ connection, namespace, taskQueue: role, activities: { advance: step } });

console.log(`temporal/${role} worker on task queue ${role}`);
await worker.run();
