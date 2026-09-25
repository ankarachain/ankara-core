import { describe, it, expect, vi } from "vitest";
import { hash } from "@stellar/stellar-sdk";
import { RiskPool, encodeTrigger } from "./RiskPool";
import type { StellarAdapter } from "../adapters/stellar";

const ADDR = "CPOOL";

function mockAdapter(results: Record<string, unknown> = {}) {
  const invokeContract = vi.fn(async (_id: string, method: string, _args?: Record<string, unknown>) => ({ result: results[method], txHash: `tx-${method}` }));
  const readContract = vi.fn(async (_id: string, method: string, _args?: Record<string, unknown>) => results[method]);
  const adapter = { invokeContract, readContract, getSignerAddress: vi.fn(async () => "GSIGNER") } as unknown as StellarAdapter;
  return { adapter, invokeContract, readContract };
}

describe("RiskPool", () => {
  it("encodes all trigger kinds", () => {
    expect(encodeTrigger({ kind: "oracle-below", oracle: "CO", key: "GK", threshold: 5n })).toEqual({ tag: "OracleBelow", values: ["CO", "GK", 5n] });
    expect(encodeTrigger({ kind: "oracle-above", oracle: "CO", key: "GK", threshold: 5n }).tag).toBe("OracleAbove");
    const missing = encodeTrigger({ kind: "claim-missing", registry: "CR", subject: { kind: "asset", assetId: "SHIP-1" }, claimType: "DELIVERY", deadline: 9n });
    expect(missing.tag).toBe("ClaimMissing");
    const subject = missing.values![1] as { tag: string; values: Buffer[] };
    expect(subject.tag).toBe("Asset");
    expect(Buffer.from(subject.values[0]).equals(hash(Buffer.from("SHIP-1")))).toBe(true);
  });

  it("creates asset-linked and plain products", async () => {
    const { adapter, invokeContract } = mockAdapter({ create_product: 2n });
    const pool = new RiskPool(adapter, ADDR);
    const trigger = { kind: "oracle-below" as const, oracle: "CO", key: "GK", threshold: 300n };
    await pool.createProduct({ trigger, coverageStart: 1n, coverageEnd: 2n, premiumBps: 500, asset: { token: "CFARM", coveragePerUnit: 500n, unitScale: 10n } });
    expect(invokeContract).toHaveBeenCalledWith(ADDR, "create_product", {
      trigger: { tag: "OracleBelow", values: ["CO", "GK", 300n] }, coverage_start: 1n, coverage_end: 2n, premium_bps: 500,
      asset_token: "CFARM", coverage_per_unit: 500n, unit_scale: 10n,
    });
    await pool.createProduct({ trigger, coverageStart: 1n, coverageEnd: 2n, premiumBps: 500 });
    expect(invokeContract).toHaveBeenLastCalledWith(ADDR, "create_product", expect.objectContaining({ asset_token: undefined, coverage_per_unit: 0n, unit_scale: 1n }));
    await expect(pool.createProduct({ trigger, coverageStart: 2n, coverageEnd: 1n, premiumBps: 500 })).rejects.toThrow(/before/);
  });

  it("buys policies as the signer and chunks settle_many", async () => {
    const { adapter, invokeContract } = mockAdapter({ buy_policy_for_holding: 7n, settle_many: 10n });
    const pool = new RiskPool(adapter, ADDR);
    expect((await pool.buyPolicyForHolding(2)).policyId).toBe(7);
    expect(invokeContract).toHaveBeenCalledWith(ADDR, "buy_policy_for_holding", { holder: "GSIGNER", product_id: 2n });
    const out = await pool.settleMany(Array.from({ length: 30 }, (_, i) => i));
    expect(out.txHashes).toHaveLength(2);
    expect(out.paid).toBe(20n);
  });

  it("decodes products (incl. claim-missing trigger) and policies", async () => {
    const { adapter } = mockAdapter({
      get_product: {
        id: 1n, trigger: { tag: "ClaimMissing", values: ["CR", { tag: "Asset", values: [Buffer.alloc(32, 6)] }, "DELIVERY", 99n] },
        coverage_start: 1n, coverage_end: 2n, premium_bps: 300, asset_token: undefined, coverage_per_unit: 0n, unit_scale: 1n,
        status: { tag: "Triggered" }, exposure: 1000n, triggered_at: 100n, observed_value: 0n,
      },
      get_policy: {
        id: 3n, product_id: 1n, holder: "GH", coverage: 1000n, premium: 30n, insured_units: 0n, status: { tag: "Paid" }, purchased_at: 5n, paid_amount: 1000n,
      },
      free_capital: 5n, total_exposure: 6n,
    });
    const pool = new RiskPool(adapter, ADDR);
    const p = await pool.getProduct(1);
    expect(p.status).toBe("triggered");
    expect(p.assetToken).toBeNull();
    expect(p.trigger).toEqual({ kind: "claim-missing", registry: "CR", subject: { kind: "asset", assetId: "0x" + "06".repeat(32) }, claimType: "DELIVERY", deadline: 99n });
    expect((await pool.getPolicy(3)).status).toBe("paid");
    expect(await pool.getCapital()).toEqual({ freeCapital: 5n, totalExposure: 6n });
  });
});
