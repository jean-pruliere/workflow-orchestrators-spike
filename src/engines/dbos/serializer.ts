import { encryptionEnabled, open, seal } from "../../crypto.ts";

export const serializer = encryptionEnabled
  ? {
      name: () => "sealed-json",
      stringify: (value: unknown) => seal(Buffer.from(JSON.stringify(value) ?? "null")).toString("base64"),
      parse: (text: string | null | undefined) =>
        text === null || text === undefined ? text : JSON.parse(open(Buffer.from(text, "base64")).toString("utf8")),
    }
  : undefined;
