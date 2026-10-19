import type { IncomingMessage } from "node:http";

import { Agent, request } from "undici";

const agent = new Agent({ headersTimeout: 0, bodyTimeout: 0, connections: 512, keepAliveTimeout: 30_000 });

export async function postJson<T>(url: string, body: unknown, headers: Record<string, string> = {}): Promise<T> {
  const res = await request(url, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", ...headers },
    dispatcher: agent,
  });
  const text = await res.body.text();
  if (res.statusCode >= 300) throw new Error(`POST ${url} answered ${res.statusCode}: ${text.slice(0, 300)}`);
  return JSON.parse(text) as T;
}

export async function get(url: string): Promise<{ status: number; text: string }> {
  const res = await request(url, { dispatcher: agent });
  return { status: res.statusCode, text: await res.body.text() };
}

export async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}
