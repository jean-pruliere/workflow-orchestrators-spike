import { DBOS } from "@dbos-inc/dbos-sdk";

import { runChain, type ChainIn, type StepIn, type StepOut } from "../../chain.ts";
import { flows, type FlowName, type Ports, type Scenario } from "../../scenarios/flows.ts";
import { charge, flaky, InsufficientFunds, mark, slow } from "../../scenarios/steps.ts";
import { step } from "../../step.ts";
import { serializer } from "./serializer.ts";

const role = process.env.ROLE ?? "a";
const queuePollMs = process.env.DBOS_QUEUE_POLL_MS ? Number(process.env.DBOS_QUEUE_POLL_MS) : undefined;
const resultPollMs = process.env.DBOS_RESULT_POLL_MS ? Number(process.env.DBOS_RESULT_POLL_MS) : undefined;
const patching = process.env.VERSIONING === "patched";

const stepRetry = { retriesAllowed: true, maxAttempts: 5, intervalSeconds: 1, backoffRate: 1, timeoutMS: 10_000 };

DBOS.setConfig({
  name: role,
  systemDatabaseUrl: process.env.DBOS_SYSTEM_DATABASE_URL,
  executorID: process.env.DBOS_EXECUTOR_ID,
  // Version names must be unique across apps sharing a system database; patching alone gives every app "PATCHING_ENABLED".
  applicationVersion: process.env.APP_VERSION ? `${role}-${process.env.APP_VERSION}` : patching ? `${role}-patching` : undefined,
  enablePatching: patching,
  listenQueues: [role],
  serializer,
});

function portsForExecution(): Ports {
  let call = 0;
  const remote = async <T>(service: string, workflowName: string, input: unknown): Promise<T> => {
    const workflowID = `${DBOS.workflowID}:${service}:${call++}`;
    const handle = await DBOS.enqueueWorkflowWithOptions<T>(
      { queueName: service, workflowName, applicationName: service, workflowID },
      input,
    );
    return handle.getResult(resultPollMs ? { pollingIntervalMs: resultPollMs } : undefined);
  };
  return {
    mark: (service, key) =>
      service === "a"
        ? DBOS.runStep(() => mark({ key }), { name: "mark", ...stepRetry })
        : remote(service, "mark", { key }),
    charge: key => remote("c", "charge", { key }),
    businessError: error => {
      const e = error as { name?: string; message?: string; accountId?: string };
      return {
        type: e?.name ?? null,
        message: String(e?.message ?? error),
        details: e?.accountId ? { accountId: e.accountId } : null,
      };
    },
    flaky: (key, succeedOn) => remote("b", "flaky", { key, succeedOn }),
    slow: (key, firstAttemptMs) => remote("b", "slow", { key, firstAttemptMs }),
    sleep: ms => DBOS.sleep(ms),
    useV2: async change => {
      if (process.env.WORKFLOW_VERSION !== "2") return false;
      return patching ? DBOS.patch(change) : true;
    },
  };
}

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
  for (const name of Object.keys(flows) as FlowName[]) {
    const flow = flows[name] as (input: Scenario, ports: Ports) => Promise<unknown>;
    DBOS.registerWorkflow(async (input: Scenario) => flow(input, portsForExecution()), { name });
  }
} else {
  type StepOptions = NonNullable<Parameters<typeof DBOS.runStep>[1]>;
  const asWorkflow = <I, O>(name: string, fn: (input: I) => Promise<O>, retries: StepOptions = stepRetry) =>
    DBOS.registerWorkflow(async (input: I) => DBOS.runStep(() => fn(input), { ...retries, name }), { name });
  asWorkflow("advance", (input: StepIn) => step(input));
  asWorkflow("mark", mark);
  asWorkflow("flaky", flaky);
  asWorkflow("slow", slow);
  asWorkflow("charge", charge, { ...stepRetry, shouldRetry: error => !(error instanceof InsufficientFunds) });
}

await DBOS.launch();
await DBOS.registerQueue(role, { onConflict: "always_update", minPollingIntervalMs: queuePollMs });
console.log(
  `dbos/${role} launched, queue ${role}, queue poll ${queuePollMs ?? "default"} ms, ` +
    `result poll ${resultPollMs ?? "default"} ms, version ${process.env.WORKFLOW_VERSION ?? "1"}, patching ${patching}`,
);
