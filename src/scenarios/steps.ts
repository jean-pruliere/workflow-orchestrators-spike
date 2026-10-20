import { get } from "../http.ts";

const stubUrl = process.env.STUB_URL ?? "http://stub:8080";

export class InsufficientFunds extends Error {
  readonly accountId: string;
  constructor(accountId: string) {
    super(`account ${accountId} has insufficient funds`);
    this.name = "InsufficientFunds";
    this.accountId = accountId;
  }
}

export async function mark({ key }: { key: string }): Promise<number> {
  const res = await get(`${stubUrl}/call?key=${encodeURIComponent(key)}`);
  if (res.status !== 200) throw new Error(`stub answered ${res.status}`);
  return Number(res.text);
}

export async function charge({ key }: { key: string }): Promise<void> {
  throw new InsufficientFunds(key);
}

export async function flaky({ key, succeedOn }: { key: string; succeedOn: number }): Promise<number> {
  const attempt = await mark({ key });
  if (attempt < succeedOn) throw new Error(`transient failure on attempt ${attempt}`);
  return attempt;
}

export async function slow({ key, firstAttemptMs }: { key: string; firstAttemptMs: number }): Promise<number> {
  const attempt = await mark({ key });
  if (attempt === 1) await new Promise(resolve => setTimeout(resolve, firstAttemptMs));
  return attempt;
}
