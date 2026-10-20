export type Service = "a" | "b" | "c";

export type Seen = { type: string | null; message: string; details: unknown };

export type Ports = {
  mark(service: Service, key: string): Promise<number>;
  charge(key: string): Promise<void>;
  businessError(error: unknown): Seen;
  flaky(key: string, succeedOn: number): Promise<number>;
  slow(key: string, firstAttemptMs: number): Promise<number>;
  sleep(ms: number): Promise<void>;
  useV2(change: string): Promise<boolean>;
};

export type Scenario = { run: string; sleepMs?: number; marker?: string };

export async function typedError({ run }: Scenario, p: Ports) {
  try {
    await p.charge(`${run}:charge`);
    return { threw: false, branchable: false, seen: null };
  } catch (error) {
    const seen = p.businessError(error);
    return { threw: true, branchable: seen.type === "InsufficientFunds", seen };
  }
}

export async function saga({ run }: Scenario, p: Ports) {
  const undo: Array<() => Promise<unknown>> = [];
  try {
    await p.mark("a", `${run}:reserve`);
    undo.unshift(() => p.mark("a", `${run}:release`));
    await p.mark("b", `${run}:debit`);
    undo.unshift(() => p.mark("b", `${run}:credit`));
    await p.charge(`${run}:charge`);
    return "charged";
  } catch {
    for (const step of undo) await step();
    return "compensated";
  }
}

export async function timer({ run, sleepMs = 30_000 }: Scenario, p: Ports) {
  await p.mark("a", `${run}:before`);
  await p.sleep(sleepMs);
  await p.mark("a", `${run}:after`);
  return "woke";
}

export async function retry({ run }: Scenario, p: Ports) {
  const flakyAttempts = await p.flaky(`${run}:flaky`, 3);
  const slowAttempts = await p.slow(`${run}:slow`, 15_000);
  return { flakyAttempts, slowAttempts };
}

export async function versioned({ run, sleepMs = 20_000 }: Scenario, p: Ports) {
  if (await p.useV2("audit")) await p.mark("c", `${run}:audit`);
  await p.mark("b", `${run}:step1`);
  await p.sleep(sleepMs);
  await p.mark("b", `${run}:step2`);
  return "done";
}

export async function sealed({ run, marker = "MARKER" }: Scenario, p: Ports) {
  await p.mark("b", `${run}:${marker}`);
  const error = await typedError({ run: `${run}:${marker}` }, p);
  return { marker, error };
}

export const flows = { typedError, saga, timer, retry, versioned, sealed };
export type FlowName = keyof typeof flows;
