import { fileURLToPath } from "node:url";

import { ApplicationFailure } from "@temporalio/common";
import { NativeConnection, Worker } from "@temporalio/worker";

import { encryptionEnabled } from "../../crypto.ts";
import { charge, flaky, InsufficientFunds, mark, slow } from "../../scenarios/steps.ts";
import { step } from "../../step.ts";
import { payloadCodecs } from "./codec.ts";

const role = process.env.ROLE ?? "a";
const connection = await NativeConnection.connect({ address: process.env.TEMPORAL_ADDRESS ?? "temporal:7233" });
const namespace = process.env.TEMPORAL_NAMESPACE ?? "bench";
const workflows = process.env.WORKFLOWS ?? "workflows";

const dataConverter = {
  payloadCodecs,
  failureConverterPath: encryptionEnabled
    ? fileURLToPath(new URL("./failure-converter.ts", import.meta.url))
    : undefined,
};

const activities = {
  advance: step,
  mark,
  flaky,
  slow,
  charge: async (input: { key: string }) => {
    try {
      await charge(input);
    } catch (error) {
      if (!(error instanceof InsufficientFunds)) throw error;
      throw ApplicationFailure.create({
        type: error.name,
        message: error.message,
        nonRetryable: true,
        details: [{ accountId: error.accountId }],
      });
    }
  },
};

const worker = await Worker.create({
  connection,
  namespace,
  taskQueue: role,
  dataConverter,
  activities: role === "a" ? { mark } : activities,
  workflowsPath: role === "a" ? fileURLToPath(new URL(`./${workflows}.ts`, import.meta.url)) : undefined,
});

console.log(`temporal/${role} worker on task queue ${role}, workflows ${role === "a" ? workflows : "-"}`);
await worker.run();
