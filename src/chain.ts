export type Target = "b" | "c";

export type ChainIn = { wf: string; i: number; v: string; k: number; t0: number };
export type ChainOut = { i: number; s: number; t0: number; n: number };
export type StepIn = { wf: string; n: number; v: string; s: number; k: number };
export type StepOut = { v: string; s: number };

export function targetOf(n: number): Target {
  return n % 2 === 0 ? "b" : "c";
}

// No Node imports in this file: Temporal bundles it into the deterministic workflow sandbox.
export async function runChain(
  input: ChainIn,
  step: (target: Target, input: StepIn) => Promise<StepOut>,
): Promise<ChainOut> {
  let v = input.v;
  let s = 0;
  let n = 0;
  while (v !== "1") {
    ({ v, s } = await step(targetOf(n), { wf: input.wf, n, v, s, k: input.k }));
    n++;
  }
  return { i: input.i, s, t0: input.t0, n };
}
