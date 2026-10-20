import { ActivityFailure, ApplicationFailure, proxyActivities, sleep } from "@temporalio/workflow";

import { runChain, type ChainIn, type ChainOut, type StepIn, type StepOut } from "../../chain.ts";
import { flows, type Ports, type Scenario } from "../../scenarios/flows.ts";

type Activities = {
  advance(input: StepIn): Promise<StepOut>;
  mark(input: { key: string }): Promise<number>;
  charge(input: { key: string }): Promise<void>;
  flaky(input: { key: string; succeedOn: number }): Promise<number>;
  slow(input: { key: string; firstAttemptMs: number }): Promise<number>;
};

const stepOptions = {
  startToCloseTimeout: "10 seconds",
  retry: { initialInterval: "1 second", maximumAttempts: 5, backoffCoefficient: 1 },
} as const;

const on = {
  a: proxyActivities<Activities>({ ...stepOptions, taskQueue: "a" }),
  b: proxyActivities<Activities>({ ...stepOptions, taskQueue: "b" }),
  c: proxyActivities<Activities>({ ...stepOptions, taskQueue: "c" }),
};

export function makeWorkflows(useV2: (change: string) => boolean) {
  const ports: Ports = {
    mark: (service, key) => on[service].mark({ key }),
    charge: key => on.c.charge({ key }),
    businessError: error =>
      error instanceof ActivityFailure && error.cause instanceof ApplicationFailure
        ? { type: error.cause.type ?? null, message: error.cause.message, details: error.cause.details ?? null }
        : { type: null, message: String(error), details: null },
    flaky: (key, succeedOn) => on.b.flaky({ key, succeedOn }),
    slow: (key, firstAttemptMs) => on.b.slow({ key, firstAttemptMs }),
    sleep: ms => sleep(ms),
    useV2: async change => useV2(change),
  };

  return {
    chainWorkflow: (input: ChainIn): Promise<ChainOut> =>
      runChain(input, (target, step) => on[target].advance(step)),
    typedErrorWorkflow: (input: Scenario) => flows.typedError(input, ports),
    sagaWorkflow: (input: Scenario) => flows.saga(input, ports),
    timerWorkflow: (input: Scenario) => flows.timer(input, ports),
    retryWorkflow: (input: Scenario) => flows.retry(input, ports),
    versionedWorkflow: (input: Scenario) => flows.versioned(input, ports),
    sealedWorkflow: (input: Scenario) => flows.sealed(input, ports),
  };
}
