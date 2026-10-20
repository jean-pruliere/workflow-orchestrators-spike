import type { Payload, PayloadCodec } from "@temporalio/common";
import proto from "@temporalio/proto";

import { encryptionEnabled, open, seal } from "../../crypto.ts";

const { temporal } = proto;

const encoding = "binary/sealed";

class SealCodec implements PayloadCodec {
  async encode(payloads: Payload[]): Promise<Payload[]> {
    return payloads.map(payload => ({
      metadata: { encoding: Buffer.from(encoding) },
      data: seal(temporal.api.common.v1.Payload.encode(payload).finish()),
    }));
  }

  async decode(payloads: Payload[]): Promise<Payload[]> {
    return payloads.map(payload =>
      Buffer.from(payload.metadata?.encoding ?? []).toString() === encoding && payload.data
        ? (temporal.api.common.v1.Payload.decode(open(payload.data)) as Payload)
        : payload,
    );
  }
}

export const payloadCodecs = encryptionEnabled ? [new SealCodec()] : [];
