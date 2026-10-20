import * as restate from "@restatedev/restate-sdk";

import { runChain, type ChainIn, type StepIn } from "../../chain.ts";
import { encryptionEnabled, open, seal } from "../../crypto.ts";
import { flows, type FlowName, type Ports, type Scenario } from "../../scenarios/flows.ts";
import { charge, flaky, InsufficientFunds, mark, slow } from "../../scenarios/steps.ts";
import { step } from "../../step.ts";

const stepRetry = { maxRetryAttempts: 5, initialRetryInterval: 1000, retryIntervalFactor: 1 };

const stepService = (name: string) =>
  restate.service({
    name,
    handlers: {
      advance: async (ctx: restate.Context, input: StepIn) => ctx.run("advance", () => step(input), stepRetry),
      mark: async (ctx: restate.Context, input: { key: string }) => ctx.run("mark", () => mark(input), stepRetry),
      flaky: async (ctx: restate.Context, input: { key: string; succeedOn: number }) =>
        ctx.run("flaky", () => flaky(input), stepRetry),
      slow: restate.handlers.handler(
        { inactivityTimeout: 10_000, abortTimeout: 1_000 },
        async (ctx: restate.Context, input: { key: string; firstAttemptMs: number }) =>
          ctx.run("slow", () => slow(input), stepRetry),
      ),
      charge: async (ctx: restate.Context, input: { key: string }) =>
        ctx.run(
          "charge",
          async () => {
            try {
              await charge(input);
            } catch (error) {
              if (!(error instanceof InsufficientFunds)) throw error;
              throw new restate.TerminalError(error.message, {
                errorCode: 422,
                metadata: { type: error.name, accountId: error.accountId },
              });
            }
          },
          stepRetry,
        ),
    },
  });

const stepB = stepService("stepB");
const stepC = stepService("stepC");

function portsFor(ctx: restate.WorkflowContext): Ports {
  const remote = (service: "b" | "c") =>
    ctx.serviceClient<typeof stepB>({ name: service === "b" ? "stepB" : "stepC" });
  return {
    mark: async (service, key) =>
      service === "a" ? ctx.run("mark", () => mark({ key }), stepRetry) : remote(service).mark({ key }),
    charge: async key => remote("c").charge({ key }),
    businessError: error =>
      error instanceof restate.TerminalError
        ? { type: error.metadata?.type ?? null, message: error.message, details: error.metadata ?? null }
        : { type: null, message: String(error), details: null },
    flaky: async (key, succeedOn) => remote("b").flaky({ key, succeedOn }),
    slow: async (key, firstAttemptMs) => remote("b").slow({ key, firstAttemptMs }),
    sleep: async ms => ctx.sleep(ms),
    useV2: async () => process.env.WORKFLOW_VERSION === "2",
  };
}

const chain = restate.workflow({
  name: "chain",
  handlers: {
    run: async (ctx: restate.WorkflowContext, input: ChainIn) =>
      runChain(input, (target, s) =>
        ctx.serviceClient<typeof stepB>({ name: target === "b" ? "stepB" : "stepC" }).advance(s),
      ),
  },
});

const scenario = (name: FlowName) =>
  restate.workflow({
    name,
    handlers: {
      run: async (ctx: restate.WorkflowContext, input: Scenario) =>
        (flows[name] as (input: Scenario, ports: Ports) => Promise<unknown>)(input, portsFor(ctx)),
    },
  });

const role = process.env.ROLE ?? "a";
const endpoint = restate.endpoint();
if (role === "a") {
  endpoint.bind(chain);
  for (const name of Object.keys(flows) as FlowName[]) endpoint.bind(scenario(name));
} else {
  endpoint.bind(role === "b" ? stepB : stepC);
}
if (encryptionEnabled) {
  endpoint.journalValueCodecProvider(async () => ({ encode: buf => seal(buf), decode: async buf => open(buf) }));
}

await endpoint.listen(9080);
console.log(`restate/${role} endpoint on 9080, version ${process.env.WORKFLOW_VERSION ?? "1"}`);
