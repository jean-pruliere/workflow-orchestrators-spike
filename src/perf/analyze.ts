import { readFileSync } from "node:fs";

type Sample = { t: number; name: string; cpuUsec: number; workingSet: number; wbytes: number; gone?: boolean };

const [engine, rate, samplesFile, summaryFile, idleFrom, loadFrom, loadTo] = process.argv.slice(2);
const window = { idleFrom: Number(idleFrom), loadFrom: Number(loadFrom), loadTo: Number(loadTo) };

const samples = readFileSync(samplesFile, "utf8")
  .split("\n")
  .filter(Boolean)
  .map(line => JSON.parse(line) as Sample)
  .filter(sample => !sample.gone);
const summaryText = readFileSync(summaryFile, "utf8");
const summary = JSON.parse(summaryText.slice(summaryText.indexOf('{\n  "at"')));

const byName = new Map<string, Sample[]>();
for (const sample of samples) byName.set(sample.name, [...(byName.get(sample.name) ?? []), sample]);

function at(series: Sample[], t: number): Sample {
  let best = series[0];
  for (const sample of series) if (sample.t <= t) best = sample;
  return best;
}

function mean(series: Sample[], from: number, to: number, field: "workingSet"): number {
  const inside = series.filter(sample => sample.t >= from && sample.t <= to);
  return inside.reduce((sum, sample) => sum + sample[field], 0) / Math.max(1, inside.length);
}

const groupOf = (name: string): string => {
  if (["a", "b", "c"].includes(name)) return "workers";
  if (name === "pg") return "store";
  if (name === "temporal" || name === "restate") return "engine";
  return "other";
};

const steps: number = summary.got.messages;
const loadMs = window.loadTo - window.loadFrom;
const groups: Record<string, { cpuMsPerStep: number; idleCpuMilli: number; workingSetMiB: number; diskKiBPerStep: number }> = {};

for (const [name, series] of byName) {
  const group = groupOf(name);
  if (group === "other") continue;
  const idleStart = at(series, window.idleFrom);
  const idleEnd = at(series, window.loadFrom);
  const loadEnd = at(series, window.loadTo);
  const idleRate = (idleEnd.cpuUsec - idleStart.cpuUsec) / Math.max(1, idleEnd.t - idleStart.t);
  const netCpuUsec = loadEnd.cpuUsec - idleEnd.cpuUsec - idleRate * (loadEnd.t - idleEnd.t);
  const entry = (groups[group] ??= { cpuMsPerStep: 0, idleCpuMilli: 0, workingSetMiB: 0, diskKiBPerStep: 0 });
  entry.cpuMsPerStep += netCpuUsec / 1000 / steps;
  entry.idleCpuMilli += idleRate;
  entry.workingSetMiB += mean(series, window.loadFrom, window.loadTo, "workingSet") / 2 ** 20;
  entry.diskKiBPerStep += (loadEnd.wbytes - idleEnd.wbytes) / 1024 / steps;
}

const round = (value: number, digits = 2) => Math.round(value * 10 ** digits) / 10 ** digits;
const total = Object.values(groups).reduce(
  (sum, g) => ({
    cpuMsPerStep: sum.cpuMsPerStep + g.cpuMsPerStep,
    idleCpuMilli: sum.idleCpuMilli + g.idleCpuMilli,
    workingSetMiB: sum.workingSetMiB + g.workingSetMiB,
    diskKiBPerStep: sum.diskKiBPerStep + g.diskKiBPerStep,
  }),
  { cpuMsPerStep: 0, idleCpuMilli: 0, workingSetMiB: 0, diskKiBPerStep: 0 },
);
const rounded = (g: typeof total) => ({
  cpuMsPerStep: round(g.cpuMsPerStep, 3),
  idleCpuMilli: round(g.idleCpuMilli, 0),
  workingSetMiB: round(g.workingSetMiB, 0),
  diskKiBPerStep: round(g.diskKiBPerStep),
});

console.log(
  JSON.stringify({
    at: new Date().toISOString(),
    engine,
    targetStepsPerSec: Number(rate),
    ok: summary.ok,
    steps,
    stepsPerSecOverRun: round(steps / (loadMs / 1000), 1),
    loadSeconds: round(loadMs / 1000, 0),
    stepLatencyMs: summary.stepLatencyMs,
    pgPerStep: summary.pg
      ? { commits: round(summary.pg.commits / steps), walBytes: summary.pg.walBytesPerStep }
      : null,
    total: rounded(total),
    groups: Object.fromEntries(Object.entries(groups).map(([name, g]) => [name, rounded(g)])),
  }),
);
