import type { ChainOut } from "../../chain.ts";
import { postJson } from "../../http.ts";
import type { Adapter } from "../adapter.ts";

export async function connect(): Promise<Adapter> {
  const ingress = process.env.RESTATE_INGRESS ?? "http://restate:8080";
  return {
    start: input => postJson<ChainOut>(`${ingress}/owner/${encodeURIComponent(input.wf)}/run`, input),
    close: async () => {},
  };
}
