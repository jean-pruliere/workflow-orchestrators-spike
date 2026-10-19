import type { ChainIn, ChainOut } from "../chain.ts";

export type Adapter = {
  start(input: ChainIn): Promise<ChainOut>;
  close(): Promise<void>;
};
