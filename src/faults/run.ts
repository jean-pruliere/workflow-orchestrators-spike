import { execFileSync, spawn } from "node:child_process";
import { appendFile, mkdir } from "node:fs/promises";

type Fault = { outageS: number; inject(): void; restore(): void };

const [engine, faultName] = process.argv.slice(2);
if (!engine || !faultName) throw new Error("usage: node src/faults/run.ts <engine> <fault> [--check]");
const check = process.argv.includes("--check");
const n = Number(process.env.N ?? 10);
const k = Number(process.env.K ?? 1);
const atS = Number(process.env.AT_S ?? 10);
const timeoutMs = Number(process.env.TIMEOUT_MS ?? 300_000);
// Chains started together move in lockstep, so a fault on B would hit either every chain or none.
const staggerMs = Number(process.env.STAGGER_MS ?? 137);

const project = `wos-${engine}`;
const file = `compose/${engine}.yml`;
const container = (service: string) => `${project}-${service}-1`;
const docker = (...args: string[]) => execFileSync("docker", args, { stdio: ["ignore", "pipe", "pipe"] }).toString();

const engineServer: string | undefined = { temporal: "temporal", restate: "restate" }[engine];
const store: string | undefined = { temporal: "pg", dbos: "pg", naive: "pg", restate: "restate" }[engine];

function outage(service: string, seconds: number, kind: "kill" | "pause"): Fault {
  return kind === "kill"
    ? {
        outageS: seconds,
        inject: () => docker("kill", "-s", "KILL", container(service)),
        restore: () => docker("start", container(service)),
      }
    : {
        outageS: seconds,
        inject: () => docker("pause", container(service)),
        restore: () => docker("unpause", container(service)),
      };
}

// A replaced container comes back under a new name, so DBOS gets a new executor ID.
function replace(service: string): Fault {
  return {
    outageS: 10,
    inject: () => docker("kill", "-s", "KILL", container(service)),
    restore: () =>
      execFileSync("docker", ["compose", "-f", file, "up", "-d", "--no-deps", "--force-recreate", service], {
        stdio: "ignore",
        env: { ...process.env, [`DBOS_EXECUTOR_ID_${service.toUpperCase()}`]: `${service}-${Date.now().toString(36)}` },
      }),
  };
}

const faults: Record<string, () => Fault | null> = {
  baseline: () => ({ outageS: 0, inject() {}, restore() {} }),
  "replace-a": () => replace("a"),
  "replace-b": () => replace("b"),
  "restart-b-same-id": () => (engine === "dbos" ? outage("b", 10, "kill") : null),
  "kill-engine": () => (engineServer ? outage(engineServer, 10, "kill") : null),
  "pause-store-5": () => (store ? outage(store, 5, "pause") : null),
  "pause-store-60": () => (store ? outage(store, 60, "pause") : null),
  "rolling-restart": () => ({
    outageS: 0,
    inject: () => {
      for (const service of ["a", "b", "c"]) docker("restart", container(service));
    },
    restore() {},
  }),
  "partition-b": () => ({
    outageS: 30,
    inject: () => docker("network", "disconnect", `${project}_default`, container("b")),
    restore: () => docker("network", "connect", "--alias", "b", `${project}_default`, container("b")),
  }),
};

const make = faults[faultName];
if (!make) throw new Error(`unknown fault ${faultName}; known: ${Object.keys(faults).join(", ")}`);
const fault = make();
if (!fault) {
  console.log(`${engine} ${faultName}: n/a`);
  process.exit(check ? 3 : 0);
}
if (check) process.exit(0);

const driver = spawn(
  "docker",
  [
    "compose", "-f", file, "run", "--rm",
    "-e", `N=${n}`, "-e", `K=${k}`, "-e", `TIMEOUT_MS=${timeoutMs}`, "-e", `STAGGER_MS=${staggerMs}`,
    "-e", `LABEL=fault:${faultName}`,
    "driver",
  ],
  { stdio: ["ignore", "pipe", "ignore"] },
);
let stdout = "";
driver.stdout.on("data", chunk => (stdout += chunk));

const startedAt = Date.now();
const timeline: string[] = [];
const elapsed = () => ((Date.now() - startedAt) / 1000).toFixed(1);
const safely = (what: string, fn: () => void) => {
  try {
    fn();
    timeline.push(`${elapsed()}s ${what}`);
  } catch (error) {
    timeline.push(`${elapsed()}s ${what} failed: ${String(error).slice(0, 200)}`);
  }
};

let restored = fault.outageS === 0;
let restoreTimer: NodeJS.Timeout | undefined;
const injectTimer = setTimeout(() => {
  safely("inject", () => fault.inject());
  if (restored) return;
  restoreTimer = setTimeout(() => {
    safely("restore", () => fault.restore());
    restored = true;
  }, fault.outageS * 1000);
}, atS * 1000);

const exitCode = await new Promise<number>(resolve => driver.on("exit", code => resolve(code ?? -1)));
clearTimeout(injectTimer);
if (!restored) {
  clearTimeout(restoreTimer);
  safely("restore after driver exit", () => fault.restore());
}

const start = stdout.indexOf('{\n  "at"');
const summary = start >= 0 ? JSON.parse(stdout.slice(start)) : undefined;
const record = {
  at: new Date().toISOString(),
  engine,
  fault: faultName,
  params: { n, k, atS, outageS: fault.outageS, timeoutMs, staggerMs, stepDelayMs: Number(process.env.STEP_DELAY_MS ?? 0) },
  timeline,
  driverExit: exitCode,
  completed: summary?.got.completed ?? null,
  lost: summary ? summary.got.failed : n,
  checksumOk: summary ? summary.got.checksum === summary.expected.checksum : false,
  stubCalls: summary?.got.stubCalls ?? null,
  expectedCalls: summary?.expected.calls ?? null,
  dupKeys: summary?.got.dupKeys ?? null,
  dupCalls: summary?.got.dupCalls ?? null,
  wallMs: summary?.wallMs ?? null,
  latencyMaxMs: summary?.latencyMs.max ?? null,
  finishedBeforeFault: summary ? summary.wallMs < atS * 1000 : null,
  errors: summary?.errors ?? [stdout.slice(-300)],
};

await mkdir("results", { recursive: true });
await appendFile("results/faults.jsonl", `${JSON.stringify(record)}\n`);
console.log(
  `${engine} ${faultName}: completed ${record.completed}/${n}, lost ${record.lost}, dup calls ${record.dupCalls}, ` +
    `wall ${record.wallMs} ms, checksum ${record.checksumOk ? "ok" : "KO"} | ${timeline.join("; ")}` +
    (record.errors.length > 0 ? ` | ${record.errors[0]}` : ""),
);
