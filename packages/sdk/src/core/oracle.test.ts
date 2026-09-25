import { describe, it, expect, vi } from "vitest";
import { Sep40OracleAdapter, encodeAsset } from "./Sep40OracleAdapter";
import type { StellarAdapter } from "../adapters/stellar";

const ADDR = "CADAPTER";

function mockAdapter(results: Record<string, unknown> = {}) {
  const invokeContract = vi.fn(async (_id: string, method: string, _args?: Record<string, unknown>) => ({ result: results[method], txHash: `tx-${method}` }));
  const readContract = vi.fn(async (_id: string, method: string, _args?: Record<string, unknown>) => results[method]);
  const adapter = { invokeContract, readContract, getSignerAddress: vi.fn(async () => "GSIGNER") } as unknown as StellarAdapter;
  return { adapter, invokeContract, readContract };
}

describe("Sep40OracleAdapter", () => {
  it("encodes SEP-40 assets as Soroban enum variants", () => {
    expect(encodeAsset({ kind: "stellar", address: "CSAC" })).toEqual({ tag: "Stellar", values: ["CSAC"] });
    expect(encodeAsset({ kind: "other", symbol: "XAU" })).toEqual({ tag: "Other", values: ["XAU"] });
  });

  it("sets and clears token feed mappings", async () => {
    const { adapter, invokeContract } = mockAdapter();
    const o = new Sep40OracleAdapter(adapter, ADDR);
    await o.setTokenFeed("CGOLD", { asset: { kind: "other", symbol: "XAU" }, twapRecords: 5 });
    await o.setTokenFeed("CGOLD", null);
    expect(invokeContract).toHaveBeenCalledWith(ADDR, "set_token_feed", {
      token: "CGOLD", config: { asset: { tag: "Other", values: ["XAU"] }, twap_records: 5 },
    });
    expect(invokeContract).toHaveBeenCalledWith(ADDR, "set_token_feed", { token: "CGOLD", config: undefined });
  });

  it("validates the TWAP window client-side", async () => {
    const { adapter, invokeContract } = mockAdapter();
    await expect(new Sep40OracleAdapter(adapter, ADDR).setTokenFeed("C", { asset: { kind: "stellar", address: "C" }, twapRecords: 21 }))
      .rejects.toThrow(/twapRecords/);
    expect(invokeContract).not.toHaveBeenCalled();
  });

  it("decodes prices, mappings and config", async () => {
    const { adapter } = mockAdapter({
      get_price: [10n ** 18n, 100n],
      feed_price: [0n, 0n],
      is_stale: false,
      is_using_fallback: true,
      token_feed: { asset: { tag: "Stellar", values: ["CTOKEN"] }, twap_records: 0 },
      feed: "CFEED",
      feed_decimals: 14,
      fallback: undefined,
      staleness_threshold: 3600n,
    });
    const o = new Sep40OracleAdapter(adapter, ADDR);
    expect(await o.getPrice("CTOKEN")).toEqual({ priceUSD: 10n ** 18n, timestamp: 100n });
    expect(await o.getFeedPrice("CTOKEN")).toEqual({ priceUSD: 0n, timestamp: 0n });
    expect(await o.isUsingFallback("CTOKEN")).toBe(true);
    expect(await o.getTokenFeed("CTOKEN")).toEqual({ asset: { kind: "stellar", address: "CTOKEN" }, twapRecords: 0 });
    expect(await o.getFeed()).toBe("CFEED");
    expect(await o.getFeedDecimals()).toBe(14);
    expect(await o.getFallback()).toBeNull();
    expect(await o.getStalenessThreshold()).toBe(3600n);
  });

  it("sets and clears the fallback", async () => {
    const { adapter, invokeContract } = mockAdapter();
    const o = new Sep40OracleAdapter(adapter, ADDR);
    await o.setFallback("CMANUAL");
    await o.setFallback(null);
    expect(invokeContract).toHaveBeenCalledWith(ADDR, "set_fallback", { fallback: "CMANUAL" });
    expect(invokeContract).toHaveBeenCalledWith(ADDR, "set_fallback", { fallback: undefined });
  });
});
