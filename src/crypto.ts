import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export const encryptionEnabled = process.env.ENCRYPT === "1";

const key = Buffer.from(process.env.PAYLOAD_KEY ?? "", "hex");
if (encryptionEnabled && key.length !== 32) throw new Error("ENCRYPT=1 needs PAYLOAD_KEY as 64 hex characters");

export function seal(plain: Uint8Array): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}

export function open(sealed: Uint8Array): Buffer {
  const buf = Buffer.from(sealed);
  const decipher = createDecipheriv("aes-256-gcm", key, buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]);
}
