import * as restate from "@restatedev/restate-sdk";

import { runChain, type ChainIn, type StepIn } from "../../chain.ts";
import { step } from "../../step.ts";

const stepService = (name: string) =>
  restate.service({
    name,
    handlers: {
      advance: async (ctx: restate.Context, input: StepIn) =>
        ctx.run("advance", () => step(input), { maxRetryAttempts: 5, initialRetryInterval: 1000, retryIntervalFactor: 1 }),
    },
  });

const stepB = stepService("stepB");
const stepC = stepService("stepC");

const owner = restate.workflow({
  name: "owner",
  handlers: {
    run: async (ctx: restate.WorkflowContext, input: ChainIn) =>
      runChain(input, (target, s) =>
        ctx.serviceClient<typeof stepB>({ name: target === "b" ? "stepB" : "stepC" }).advance(s),
      ),
  },
});

const role = process.env.ROLE ?? "a";
const bound = { a: owner, b: stepB, c: stepC }[role as "a" | "b" | "c"];

await restate.endpoint().bind(bound).listen(9080);
console.log(`restate/${role} endpoint on 9080`);
