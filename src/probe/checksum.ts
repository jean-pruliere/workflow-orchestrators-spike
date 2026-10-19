import { createHash } from "node:crypto";

export function checksum(stepsByChain: ReadonlyArray<number>): string {
  const text = stepsByChain.map((s, i) => `${i}:${s}\n`).join("");
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}
