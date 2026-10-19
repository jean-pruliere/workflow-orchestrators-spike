import { proxyActivities } from "@temporalio/workflow";

import { runChain, type ChainIn, type ChainOut, type StepIn, type StepOut } from "../../chain.ts";

type Activities = { advance(input: StepIn): Promise<StepOut> };

const b = proxyActivities<Activities>({ taskQueue: "b", startToCloseTimeout: "30s" });
const c = proxyActivities<Activities>({ taskQueue: "c", startToCloseTimeout: "30s" });

export async function chainWorkflow(input: ChainIn): Promise<ChainOut> {
  return runChain(input, (target, step) => (target === "b" ? b : c).advance(step));
}
