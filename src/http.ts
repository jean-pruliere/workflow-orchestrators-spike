import type { IncomingMessage } from "node:http";

import { Agent, request } from "undici";

const agent = new Agent({ headersTimeout: 0, bodyTimeout: 0, connections: 512, keepAliveTimeout: 30_000 });

export class HttpError extends Error {
  readonly status: number;
  constructor(method: string, url: string, status: number, body: string) {
    super(`${method} ${url} answered ${status}: ${body.slice(0, 300)}`);
    this.status = status;
  }
}

export async function sendBytes(method: "GET" | "POST", url: string, body?: Uint8Array): Promise<Buffer> {
  const res = await request(url, {
    method,
    body,
    headers: body ? { "content-type": "application/json" } : {},
    dispatcher: agent,
  });
  const bytes = Buffer.from(await res.body.arrayBuffer());
  if (res.statusCode >= 300) throw new HttpError(method, url, res.statusCode, bytes.toString());
  return bytes;
}

export async function postJson<T>(url: string, body: unknown, headers: Record<string, string> = {}): Promise<T> {
  const res = await request(url, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", ...headers },
    dispatcher: agent,
  });
  const text = await res.body.text();
  if (res.statusCode >= 300) throw new HttpError("POST", url, res.statusCode, text);
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
