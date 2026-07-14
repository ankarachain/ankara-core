import { describe, it, expect } from "vitest";
import { nativeToScVal, xdr } from "@stellar/stellar-sdk";
import { decodeEvent } from "./poller";

describe("decodeEvent", () => {
  it("uses topic[0] (a Symbol) as the event type, keeps the rest as extra topics, and decodes the value", () => {
    const event = decodeEvent({
      id: "0000000001-0000000000",
      contractId: "CABC123",
      ledger: 100,
      ledgerClosedAt: "2026-01-01T00:00:00Z",
      txHash: "deadbeef",
      topic: [nativeToScVal("opened", { type: "symbol" }), nativeToScVal(7, { type: "u32" })],
      value: nativeToScVal(600, { type: "i128" }),
    } as never);

    expect(event.eventType).toBe("opened");
    expect(event.contract).toBe("CABC123");
    expect(event.ledger).toBe(100);
    expect(event.txHash).toBe("deadbeef");
    expect(event.timestamp).toBe(Math.floor(new Date("2026-01-01T00:00:00Z").getTime() / 1000));
    expect((event.data as { topics: unknown[] }).topics).toEqual([7]);
    expect((event.data as { value: unknown }).value).toBe(600n);
  });

  it("falls back to \"unknown\" when topic[0] isn't a Symbol", () => {
    const event = decodeEvent({
      id: "0000000002-0000000000",
      contractId: "CABC123",
      ledger: 101,
      ledgerClosedAt: "2026-01-01T00:00:00Z",
      txHash: "beadfeed",
      topic: [nativeToScVal(1, { type: "u32" })],
      value: xdr.ScVal.scvVoid(),
    } as never);

    expect(event.eventType).toBe("unknown");
  });
});
