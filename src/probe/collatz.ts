const M64 = (1n << 64n) - 1n;

export function* splitmix64(seed: bigint): Generator<bigint, never> {
  let s = seed & M64;
  while (true) {
    s = (s + 0x9e3779b97f4a7c15n) & M64;
    let z = s;
    z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & M64;
    z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & M64;
    yield z ^ (z >> 31n);
  }
}

export function starts(seed: number, n: number, bits: number): bigint[] {
  const g = splitmix64(BigInt(seed));
  const lo = 1n << BigInt(bits - 1);
  const m = 1n << BigInt(Math.min(bits - 1, 64));
  return Array.from({ length: n }, () => lo + (g.next().value % m));
}

export function advance(v: bigint, s: number, k: number): { v: bigint; s: number } {
  for (let j = 0; j < k && v !== 1n; j++) {
    v = v % 2n === 0n ? v / 2n : 3n * v + 1n;
    s++;
  }
  return { v, s };
}

export type Expected = {
  steps: number;
  messages: number;
  calls: number;
  perChain: number[];
};

export function expected(seed: number, n: number, bits: number, k: number): Expected {
  let steps = 0;
  let messages = 0;
  let calls = 0;
  const perChain: number[] = [];
  for (const start of starts(seed, n, bits)) {
    let v = start;
    let s = 0;
    while (v !== 1n) {
      messages++;
      if (v % 7n === 0n) calls++;
      ({ v, s } = advance(v, s, k));
    }
    steps += s;
    perChain.push(s);
  }
  return { steps, messages, calls, perChain };
}
