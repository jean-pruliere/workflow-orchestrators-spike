import type { StepIn, StepOut } from "./chain.ts";
import { get } from "./http.ts";
import { advance } from "./probe/collatz.ts";

const stubUrl = process.env.STUB_URL ?? "http://stub:8080";

export async function step(input: StepIn): Promise<StepOut> {
  const v = BigInt(input.v);
  if (v % 7n === 0n) {
    const key = encodeURIComponent(`${input.wf}:${input.n}`);
    const res = await get(`${stubUrl}/call?key=${key}`);
    if (res.status !== 200) throw new Error(`stub answered ${res.status}`);
  }
  const out = advance(v, input.s, input.k);
  return { v: out.v.toString(), s: out.s };
}
