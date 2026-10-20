import { encryptionEnabled, open, seal } from "../../crypto.ts";
import { HttpError, sendBytes } from "../../http.ts";
import type { Adapter } from "../adapter.ts";

const encode = (value: unknown) => {
  const json = Buffer.from(JSON.stringify(value));
  return encryptionEnabled ? seal(json) : json;
};
const decode = <T>(bytes: Buffer): T => JSON.parse((encryptionEnabled ? open(bytes) : bytes).toString("utf8")) as T;

export async function connect(): Promise<Adapter> {
  const ingress = process.env.RESTATE_INGRESS ?? "http://restate:8080";
  return {
    call: async <T>(workflow: string, id: string, input: unknown) => {
      const key = encodeURIComponent(id);
      const run = () => sendBytes("POST", `${ingress}/${workflow}/${key}/run`, encode(input)).then(decode<T>);
      const attach = () => sendBytes("GET", `${ingress}/restate/workflow/${workflow}/${key}/attach`).then(decode<T>);
      try {
        return await run();
      } catch (error) {
        if (error instanceof HttpError) throw error;
      }
      // The ingress connection died with the server; a workflow keyed by `id` can still be running, so attach to it.
      for (;;) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        try {
          return await attach();
        } catch (error) {
          if (error instanceof HttpError && error.status === 404) {
            try {
              return await run();
            } catch (retry) {
              if (retry instanceof HttpError && retry.status !== 409) throw retry;
            }
          } else if (error instanceof HttpError) {
            throw error;
          }
        }
      }
    },
    close: async () => {},
  };
}
