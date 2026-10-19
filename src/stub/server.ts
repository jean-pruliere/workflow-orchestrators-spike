import { createServer, type ServerResponse } from "node:http";

const delayMs = Number(process.env.STUB_DELAY_MS ?? 0);
const counts = new Map<string, number>();
let calls = 0;

function json(res: ServerResponse, body: unknown): void {
  res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(body));
}

createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://stub");
  if (url.pathname === "/call") {
    const key = url.searchParams.get("key") ?? "";
    counts.set(key, (counts.get(key) ?? 0) + 1);
    calls++;
    const reply = () => res.writeHead(200, { "content-type": "text/plain" }).end("hello world");
    if (delayMs > 0) setTimeout(reply, delayMs);
    else reply();
    return;
  }
  if (url.pathname === "/stats") {
    let dupKeys = 0;
    let dupCalls = 0;
    for (const c of counts.values()) {
      if (c > 1) {
        dupKeys++;
        dupCalls += c - 1;
      }
    }
    json(res, { calls, keys: counts.size, dupKeys, dupCalls });
    return;
  }
  if (url.pathname === "/reset" && req.method === "POST") {
    counts.clear();
    calls = 0;
    json(res, { ok: true });
    return;
  }
  res.writeHead(404).end();
}).listen(8080);
