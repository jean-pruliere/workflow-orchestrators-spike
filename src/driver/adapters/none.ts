import type { ChainOut } from "../../chain.ts";
import { postJson } from "../../http.ts";
import type { Adapter } from "../adapter.ts";

export async function connect(): Promise<Adapter> {
  return {
    start: input => postJson<ChainOut>("http://a:8080/start", input),
    close: async () => {},
  };
}
