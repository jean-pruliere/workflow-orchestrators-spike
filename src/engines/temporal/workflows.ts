import { proxyActivities } from "@temporalio/workflow";

import { runChain, type ChainIn, type ChainOut, type StepIn, type StepOut } from "../../chain.ts";

type Activities = { advance(input: StepIn): Promise<StepOut> };

const stepOptions = {
  startToCloseTimeout: "10 seconds",
  retry: { initialInterval: "1 second", maximumAttempts: 5, backoffCoefficient: 1 },
} as const;

const b = proxyActivities<Activities>({ ...stepOptions, taskQueue: "b" });
const c = proxyActivities<Activities>({ ...stepOptions, taskQueue: "c" });

export async function chainWorkflow(input: ChainIn): Promise<ChainOut> {
  return runChain(input, (target, step) => (target === "b" ? b : c).advance(step));
}
