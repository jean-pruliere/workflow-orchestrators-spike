import { patched } from "@temporalio/workflow";

import { makeWorkflows } from "./workflows-impl.ts";

export const {
  chainWorkflow,
  typedErrorWorkflow,
  sagaWorkflow,
  timerWorkflow,
  retryWorkflow,
  versionedWorkflow,
  sealedWorkflow,
} = makeWorkflows(change => patched(change));
