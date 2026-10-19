import assert from "node:assert/strict";
import { test } from "node:test";

import { checksum } from "./checksum.ts";
import { expected, splitmix64, starts } from "./collatz.ts";

test("splitmix64 seeded with 0 matches the reference debug value", () => {
  assert.equal(splitmix64(0n).next().value, 0xe220a8397b1dcdafn);
});

test("seed 1 gives the three reference starts", () => {
  assert.deepEqual(starts(1, 3, 41), [2115422543041n, 1792705227879n, 2125928224094n]);
});

const vectors = [
  { seed: 1, n: 3, bits: 41, k: 1, steps: 953, messages: 953, calls: 117, sum: "aebb72677b08ab3e" },
  { seed: 42, n: 1000, bits: 41, k: 1, steps: 288682, messages: 288682, calls: 39940, sum: "a0809d08cfec1f88" },
  { seed: 42, n: 1000, bits: 41, k: 100, steps: 288682, messages: 3382, calls: 495, sum: "a0809d08cfec1f88" },
  { seed: 42, n: 10000, bits: 41, k: 1, steps: 2922938, messages: 2922938, calls: 405609, sum: "ffb586769c62c1bc" },
  { seed: 42, n: 1000, bits: 300, k: 1, steps: 2151031, messages: 2151031, calls: 297996, sum: "a12cbf3748a8adfc" },
  { seed: 42, n: 1000, bits: 300, k: 100, steps: 2151031, messages: 21927, calls: 2039, sum: "a12cbf3748a8adfc" },
];

for (const v of vectors) {
  test(`reference vector seed=${v.seed} n=${v.n} bits=${v.bits} k=${v.k}`, () => {
    const e = expected(v.seed, v.n, v.bits, v.k);
    assert.equal(e.steps, v.steps);
    assert.equal(e.messages, v.messages);
    assert.equal(e.calls, v.calls);
    assert.equal(checksum(e.perChain), v.sum);
  });
}

test("seed 1 per-chain steps match the reference vectors", () => {
  assert.deepEqual(expected(1, 3, 41, 1).perChain, [266, 395, 292]);
});
