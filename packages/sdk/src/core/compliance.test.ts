import { describe, it, expect, vi } from "vitest";
import { ReserveAttestation } from "./ReserveAttestation";
import { CompliancePolicy } from "./CompliancePolicy";
import { AssetRegistry } from "./AssetRegistry";
import type { StellarAdapter } from "../adapters/stellar";
import type { IAdapter } from "../adapters/IAdapter";

const ADDR = "CCONTRACT";
const HASH = "0x" + "11".repeat(32);

function mockAdapter(results: Record<string, unknown> = {}) {
  const invokeContract = vi.fn(async (_id: string, method: string, _args?: Record<string, unknown>) => ({ result: results[method], txHash: `tx-${method}` }));
  const readContract = vi.fn(async (_id: string, method: string, _args?: Record<string, unknown>) => results[method]);
  const adapter = { invokeContract, readContract, getSignerAddress: vi.fn(async () => "GSIGNER") } as unknown as StellarAdapter;
  return { adapter, invokeContract, readContract };
}

describe("ReserveAttestation", () => {
  it("submits as the signer with the report hash as 32 raw bytes", async () => {
    const { adapter, invokeContract } = mockAdapter({ submit: true });
    const out = await new ReserveAttestation(adapter, ADDR).submit(500n, HASH);
    expect(out).toEqual({ finalized: true, txHash: "tx-submit" });
    const args = invokeContract.mock.calls[0][2] as Record<string, unknown>;
    expect(args.attestor).toBe("GSIGNER");
    expect(args.amount).toBe(500n);
    expect(Buffer.from(args.report_hash as Buffer).toString("hex")).toBe("11".repeat(32));
  });

  it("rejects malformed report hashes before sending", async () => {
    const { adapter, invokeContract } = mockAdapter();
    await expect(new ReserveAttestation(adapter, ADDR).submit(1n, "0x1234")).rejects.toThrow(/32 bytes/);
    expect(invokeContract).not.toHaveBeenCalled();
  });

  it("decodes reports, reserve tuple and pending rounds", async () => {
    const report = { round: 4n, amount: 900n, timestamp: 77n, attestor_count: 2, report_hash: Buffer.alloc(32, 0xab) };
    const { adapter } = mockAdapter({
      latest_report: report,
      get_reserve: [900n, 77n],
      is_fully_backed: false,
      collateralization_bps: 9000,
      pending_round: { round: 5n, opened_at: 80n, submissions: new Map([["GA", { amount: 1n, report_hash: Buffer.alloc(32, 1) }]]) },
      asset: "CTOKEN", attestors: ["GA", "GB"], quorum: 2, staleness_threshold: 86400n,
    });
    const r = new ReserveAttestation(adapter, ADDR);
    expect(await r.latestReport()).toEqual({ round: 4, amount: 900n, timestamp: 77n, attestorCount: 2, reportHash: "0x" + "ab".repeat(32) });
    expect(await r.getReserve()).toEqual({ amount: 900n, timestamp: 77n });
    expect(await r.isFullyBacked()).toBe(false);
    expect(await r.collateralizationBps()).toBe(9000);
    expect(await r.pendingRound()).toEqual({
      round: 5, openedAt: 80n, submissions: [{ attestor: "GA", amount: 1n, reportHash: "0x" + "01".repeat(32) }],
    });
    expect(await r.getConfig()).toEqual({ asset: "CTOKEN", attestors: ["GA", "GB"], quorum: 2, stalenessThreshold: 86400n });
  });

  it("returns null when no report exists", async () => {
    expect(await new ReserveAttestation(mockAdapter({ latest_report: undefined }).adapter, ADDR).latestReport()).toBeNull();
  });
});

describe("CompliancePolicy", () => {
  it("routes freeze/clawback with the right args", async () => {
    const { adapter, invokeContract } = mockAdapter();
    const p = new CompliancePolicy(adapter, ADDR);
    await p.freeze("GBAD", "court-order-1");
    await p.clawback("CTOKEN", "GBAD", 10n);
    await p.clawback("CTOKEN", "GBAD", 5n, "GRECOVERY");
    await p.setMaxTransferAmount(0n);
    expect(invokeContract).toHaveBeenCalledWith(ADDR, "freeze", { account: "GBAD", reason: "court-order-1" });
    expect(invokeContract).toHaveBeenCalledWith(ADDR, "clawback", { token: "CTOKEN", from: "GBAD", amount: 10n, to: undefined });
    expect(invokeContract).toHaveBeenCalledWith(ADDR, "clawback", { token: "CTOKEN", from: "GBAD", amount: 5n, to: "GRECOVERY" });
    expect(invokeContract).toHaveBeenCalledWith(ADDR, "set_max_transfer_amount", { amount: 0n });
  });

  it("decodes freeze records", async () => {
    const { adapter } = mockAdapter({ freeze_record: { frozen_at: 9n, reason: "x" }, is_frozen: true });
    const p = new CompliancePolicy(adapter, ADDR);
    expect(await p.getFreezeRecord("G")).toEqual({ frozenAt: 9n, reason: "x" });
    expect(await p.isFrozen("G")).toBe(true);
    expect(await new CompliancePolicy(mockAdapter({ freeze_record: undefined }).adapter, ADDR).getFreezeRecord("G")).toBeNull();
  });
});

describe("AssetRegistry compliance methods", () => {
  it("attach/detach/read the policy on Stellar", async () => {
    const { adapter, invokeContract } = mockAdapter({ compliance_policy: "CPOLICY" });
    const reg = new AssetRegistry(adapter as unknown as IAdapter, "CTOKEN", "invoice");
    await reg.setCompliancePolicy("CPOLICY");
    await reg.setCompliancePolicy(null);
    expect(invokeContract).toHaveBeenCalledWith("CTOKEN", "set_compliance_policy", { new_policy: "CPOLICY" });
    expect(invokeContract).toHaveBeenCalledWith("CTOKEN", "set_compliance_policy", { new_policy: undefined });
    expect(await reg.getCompliancePolicy()).toBe("CPOLICY");
  });

  it("throws on adapters without generic invocation (EVM) and on NFT templates", async () => {
    const evmLike = {} as IAdapter;
    await expect(new AssetRegistry(evmLike, "0x1", "farmland").setCompliancePolicy("0x2")).rejects.toThrow(/only available on Stellar/);
    const { adapter } = mockAdapter();
    await expect(new AssetRegistry(adapter as unknown as IAdapter, "C", "farmland-nft").getCompliancePolicy()).rejects.toThrow(/fungible/);
  });
});
