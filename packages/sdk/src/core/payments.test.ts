import { describe, it, expect, vi } from "vitest";
import { PaymentStream } from "./PaymentStream";
import { BatchDisburser, chunkPayments, parseDisbursementCsv } from "./BatchDisburser";
import type { StellarAdapter } from "../adapters/stellar";

const ADDR = "CCONTRACT";

function mockAdapter(results: Record<string, unknown> = {}) {
  const invokeContract = vi.fn(async (_id: string, method: string, _args?: Record<string, unknown>) => ({ result: results[method], txHash: `tx-${method}` }));
  const readContract = vi.fn(async (_id: string, method: string, _args?: Record<string, unknown>) => results[method]);
  const adapter = { invokeContract, readContract, getSignerAddress: vi.fn(async () => "GSIGNER") } as unknown as StellarAdapter;
  return { adapter, invokeContract, readContract };
}

describe("PaymentStream", () => {
  it("creates linear streams, defaulting cliff to start", async () => {
    const { adapter, invokeContract } = mockAdapter({ create_stream: 7n });
    const out = await new PaymentStream(adapter, ADDR).createLinear({
      recipient: "GR", token: "CT", totalAmount: 1000n, start: 10n, end: 20n,
    });
    expect(out).toEqual({ streamId: 7, txHash: "tx-create_stream" });
    expect(invokeContract).toHaveBeenCalledWith(ADDR, "create_stream", {
      sender: "GSIGNER", recipient: "GR", token: "CT", total_amount: 1000n,
      start: 10n, cliff: 10n, end: 20n, cancelable: false,
    });
  });

  it("validates linear schedules client-side", async () => {
    const { adapter, invokeContract } = mockAdapter();
    const s = new PaymentStream(adapter, ADDR);
    await expect(s.createLinear({ recipient: "G", token: "C", totalAmount: 1n, start: 20n, end: 10n })).rejects.toThrow(/Invalid schedule/);
    await expect(s.createLinear({ recipient: "G", token: "C", totalAmount: 1n, start: 10n, end: 20n, cliff: 30n })).rejects.toThrow(/Invalid schedule/);
    expect(invokeContract).not.toHaveBeenCalled();
  });

  it("creates tranche schedules with snake_case tranche fields", async () => {
    const { adapter, invokeContract } = mockAdapter({ create_schedule: 1n });
    await new PaymentStream(adapter, ADDR).createSchedule({
      recipient: "GR", token: "CT", tranches: [{ unlockTime: 5n, amount: 10n }], cancelable: true,
    });
    expect(invokeContract).toHaveBeenCalledWith(ADDR, "create_schedule", {
      sender: "GSIGNER", recipient: "GR", token: "CT", tranches: [{ unlock_time: 5n, amount: 10n }], cancelable: true,
    });
  });

  it("withdraws (all or partial) and cancels as the signer", async () => {
    const { adapter, invokeContract } = mockAdapter({ withdraw: 250n, cancel: [300n, 600n] });
    const s = new PaymentStream(adapter, ADDR);
    expect(await s.withdraw(3)).toEqual({ amount: 250n, txHash: "tx-withdraw" });
    await s.withdraw(3, 100n);
    expect(invokeContract).toHaveBeenCalledWith(ADDR, "withdraw", { recipient: "GSIGNER", stream_id: 3n, amount: undefined });
    expect(invokeContract).toHaveBeenCalledWith(ADDR, "withdraw", { recipient: "GSIGNER", stream_id: 3n, amount: 100n });
    expect(await s.cancel(3)).toEqual({ paidToRecipient: 300n, refundedToSender: 600n, txHash: "tx-cancel" });
  });

  it("decodes both schedule kinds", async () => {
    const base = { id: 1n, sender: "GS", recipient: "GR", token: "CT", total_amount: 100n, withdrawn: 0n, cancelable: false, cancelled_at: 0n, refunded: 0n, created_at: 9n };
    const linear = new PaymentStream(mockAdapter({ get_stream: { ...base, schedule: { tag: "Linear", values: [1n, 2n, 3n] } } }).adapter, ADDR);
    expect((await linear.getStream(1)).schedule).toEqual({ kind: "linear", start: 1n, cliff: 2n, end: 3n });
    const steps = new PaymentStream(mockAdapter({ get_stream: { ...base, schedule: { tag: "Tranches", values: [[{ unlock_time: 5n, amount: 100n }]] } } }).adapter, ADDR);
    const info = await steps.getStream(1);
    expect(info.schedule).toEqual({ kind: "tranches", tranches: [{ unlockTime: 5n, amount: 100n }] });
    expect(info.totalAmount).toBe(100n);
  });
});

describe("BatchDisburser", () => {
  it("chunks lists over 100 into consecutive transactions", async () => {
    const { adapter, invokeContract } = mockAdapter({ disburse: 100n });
    const payments = Array.from({ length: 250 }, (_, i) => ({ recipient: `G${i}`, amount: 1n }));
    const out = await new BatchDisburser(adapter, ADDR).disburse("CT", payments, "payroll");
    expect(out.batches).toBe(3);
    expect(invokeContract).toHaveBeenCalledTimes(3);
    const sizes = invokeContract.mock.calls.map((c) => ((c[2] as Record<string, unknown>).payments as unknown[]).length);
    expect(sizes).toEqual([100, 100, 50]);
    expect((invokeContract.mock.calls[0][2] as Record<string, unknown>).reference).toBe("payroll");
  });

  it("rejects empty lists and non-positive amounts before sending", async () => {
    const { adapter, invokeContract } = mockAdapter();
    const d = new BatchDisburser(adapter, ADDR);
    await expect(d.disburse("CT", [])).rejects.toThrow(/No payments/);
    await expect(d.disburse("CT", [{ recipient: "G", amount: 0n }])).rejects.toThrow(/non-positive/);
    expect(invokeContract).not.toHaveBeenCalled();
  });

  it("chunkPayments preserves order", () => {
    const p = Array.from({ length: 5 }, (_, i) => ({ recipient: `G${i}`, amount: BigInt(i + 1) }));
    expect(chunkPayments(p, 2).map((c) => c.map((x) => x.recipient))).toEqual([["G0", "G1"], ["G2", "G3"], ["G4"]]);
  });

  it("parses CSV with header and comments", () => {
    expect(parseDisbursementCsv("recipient,amount\n# june\nGA,100\n\nGB, 250\n")).toEqual([
      { recipient: "GA", amount: 100n },
      { recipient: "GB", amount: 250n },
    ]);
    expect(() => parseDisbursementCsv("GA,100\nGB,1.5")).toThrow(/Line 2/);
  });
});
