import { postJson } from "../../http.ts";
import type { Adapter } from "../adapter.ts";

export async function connect(): Promise<Adapter> {
  return {
    call: (workflow, _id, input) => postJson(`http://a:8080/${workflow}`, input),
    close: async () => {},
  };
}
