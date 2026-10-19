import { DBOS } from "@dbos-inc/dbos-sdk";

import { runChain, type ChainIn, type StepIn, type StepOut } from "../../chain.ts";
import { step } from "../../step.ts";

const role = process.env.ROLE ?? "a";
const queuePollMs = process.env.DBOS_QUEUE_POLL_MS ? Number(process.env.DBOS_QUEUE_POLL_MS) : undefined;
const resultPollMs = process.env.DBOS_RESULT_POLL_MS ? Number(process.env.DBOS_RESULT_POLL_MS) : undefined;

DBOS.setConfig({
  name: role,
  systemDatabaseUrl: process.env.DBOS_SYSTEM_DATABASE_URL,
  executorID: process.env.DBOS_EXECUTOR_ID,
  listenQueues: [role],
});

if (role === "a") {
  DBOS.registerWorkflow(
    async (input: ChainIn) =>
      runChain(input, async (target, s) => {
        const handle = await DBOS.enqueueWorkflowWithOptions<StepOut>(
          { queueName: target, workflowName: "advance", applicationName: target, workflowID: `${s.wf}:${s.n}` },
          s,
        );
        return handle.getResult(resultPollMs ? { pollingIntervalMs: resultPollMs } : undefined);
      }),
    { name: "chain" },
  );
} else {
  DBOS.registerWorkflow(
    async (input: StepIn) =>
      DBOS.runStep(() => step(input), {
        name: "advance",
        retriesAllowed: true,
        maxAttempts: 5,
        intervalSeconds: 1,
        backoffRate: 1,
        timeoutMS: 10_000,
      }),
    { name: "advance" },
  );
}

await DBOS.launch();
await DBOS.registerQueue(role, { onConflict: "always_update", minPollingIntervalMs: queuePollMs });
console.log(`dbos/${role} launched, queue ${role}, queue poll ${queuePollMs ?? "default"} ms, result poll ${resultPollMs ?? "default"} ms`);
