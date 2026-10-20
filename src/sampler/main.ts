import { appendFileSync, existsSync, readFileSync } from "node:fs";

const root = process.env.CGROUP_ROOT ?? "/sys/fs/cgroup";
const out = process.env.OUT ?? "results/samples.jsonl";
const intervalMs = Number(process.env.INTERVAL_MS ?? 1000);
const targets = (process.env.TARGETS ?? "")
  .split(",")
  .filter(Boolean)
  .map(pair => {
    const [name, id] = pair.split("=");
    return { name, dir: [`${root}/docker/${id}`, `${root}/system.slice/docker-${id}.scope`].find(existsSync) };
  });

for (const target of targets) {
  if (!target.dir) throw new Error(`no cgroup directory for ${target.name}`);
}

function keyValues(file: string): Record<string, number> {
  const values: Record<string, number> = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const [key, value] = line.split(" ");
    if (key && value !== undefined) values[key] = Number(value);
  }
  return values;
}

function io(file: string): { rbytes: number; wbytes: number } {
  let rbytes = 0;
  let wbytes = 0;
  for (const match of readFileSync(file, "utf8").matchAll(/rbytes=(\d+) wbytes=(\d+)/g)) {
    rbytes += Number(match[1]);
    wbytes += Number(match[2]);
  }
  return { rbytes, wbytes };
}

function sample(): void {
  const t = Date.now();
  for (const { name, dir } of targets) {
    try {
      const cpu = keyValues(`${dir}/cpu.stat`);
      const mem = keyValues(`${dir}/memory.stat`);
      const current = Number(readFileSync(`${dir}/memory.current`, "utf8"));
      const peak = existsSync(`${dir}/memory.peak`) ? Number(readFileSync(`${dir}/memory.peak`, "utf8")) : null;
      appendFileSync(
        out,
        `${JSON.stringify({
          t,
          name,
          cpuUsec: cpu.usage_usec,
          userUsec: cpu.user_usec,
          systemUsec: cpu.system_usec,
          throttled: cpu.nr_throttled,
          workingSet: current - (mem.inactive_file ?? 0),
          anon: mem.anon,
          peak,
          ...io(`${dir}/io.stat`),
        })}\n`,
      );
    } catch {
      appendFileSync(out, `${JSON.stringify({ t, name, gone: true })}\n`);
    }
  }
}

sample();
setInterval(sample, intervalMs);
