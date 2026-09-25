import { describe, it, expect, vi } from "vitest";
import { RevenueDistributor } from "./RevenueDistributor";
import { RfqMarket } from "./RfqMarket";
import { AssetRegistry } from "./AssetRegistry";
import type { StellarAdapter } from "../adapters/stellar";
import type { IAdapter } from "../adapters/IAdapter";

const ADDR = "CCONTRACT";

function mockAdapter(results: Record<string, unknown> = {}) {
  const invokeContract = vi.fn(async (_id: string, method: string, _args?: Record<string, unknown>) => ({ result: results[method], txHash: `tx-${method}` }));
  const readContract = vi.fn(async (_id: string, method: string, _args?: Record<string, unknown>) => results[method]);
  const adapter = { invokeContract, readContract, getSignerAddress: vi.fn(async () => "GSIGNER") } as unknown as StellarAdapter;
  return { adapter, invokeContract, readContract };
}

describe("RevenueDistributor", () => {
  it("creates distributions as the signer with defaults", async () => {
    const { adapter, invokeContract } = mockAdapter({ create_distribution: 4n });
    const out = await new RevenueDistributor(adapter, ADDR).createDistribution({ assetToken: "CBLDG", payoutToken: "CUSDC", amount: 10_000n });
    expect(out).toEqual({ distributionId: 4, txHash: "tx-create_distribution" });
    expect(invokeContract).toHaveBeenCalledWith(ADDR, "create_distribution", {
      creator: "GSIGNER", asset_token: "CBLDG", payout_token: "CUSDC", amount: 10_000n, claim_window_secs: 0n, memo: "",
    });
  });

  it("claims, claims many (capped) and reclaims", async () => {
    const { adapter, invokeContract } = mockAdapter({ claim: 500n, claim_many: 900n, reclaim: 10n });
    const d = new RevenueDistributor(adapter, ADDR);
    expect(await d.claim(1)).toEqual({ amount: 500n, txHash: "tx-claim" });
    expect((await d.claimMany([1, 2])).amount).toBe(900n);
    expect(invokeContract).toHaveBeenCalledWith(ADDR, "claim_many", { holder: "GSIGNER", distribution_ids: [1n, 2n] });
    await expect(d.claimMany(Array.from({ length: 21 }, (_, i) => i))).rejects.toThrow(/at most 20/);
    expect((await d.reclaim(1)).amount).toBe(10n);
  });

  it("decodes distributions", async () => {
    const raw = {
      id: 1n, asset_token: "CB", payout_token: "CU", snapshot_id: 3, total_amount: 100n, supply_at_snapshot: 1000n,
      claimed_amount: 40n, creator: "GI", created_at: 5n, claim_deadline: 0n, reclaimed: false, memo: "Rent",
    };
    const d = new RevenueDistributor(mockAdapter({ get_distribution: raw, claimable: 7n, distributions_for: [0n, 1n] }).adapter, ADDR);
    expect(await d.getDistribution(1)).toEqual({
      id: 1, assetToken: "CB", payoutToken: "CU", snapshotId: 3, totalAmount: 100n, supplyAtSnapshot: 1000n,
      claimedAmount: 40n, creator: "GI", createdAt: 5n, claimDeadline: 0n, reclaimed: false, memo: "Rent",
    });
    expect(await d.claimable(1, "GH")).toBe(7n);
    expect(await d.distributionsFor("CB")).toEqual([0, 1]);
  });
});

describe("RfqMarket", () => {
  it("posts intents, quotes, accepts", async () => {
    const { adapter, invokeContract } = mockAdapter({ post_intent: 2n, submit_quote: 9n });
    const rfq = new RfqMarket(adapter, ADDR);
    expect((await rfq.postIntent({ assetToken: "CF", amount: 400n, quoteToken: "CU", expiresAt: 100n })).intentId).toBe(2);
    expect(invokeContract).toHaveBeenCalledWith(ADDR, "post_intent", {
      seller: "GSIGNER", asset_token: "CF", amount: 400n, quote_token: "CU", min_total_price: 0n, expires_at: 100n,
    });
    expect((await rfq.submitQuote(2, 15_000n, 50n)).quoteId).toBe(9);
    await rfq.acceptQuote(2, 9);
    expect(invokeContract).toHaveBeenCalledWith(ADDR, "accept_quote", { seller: "GSIGNER", intent_id: 2n, quote_id: 9n });
  });

  it("decodes intents and quotes", async () => {
    const intent = { id: 2n, seller: "GS", asset_token: "CF", amount: 400n, quote_token: "CU", min_total_price: 0n, expires_at: 100n, status: { tag: "Filled" }, created_at: 1n, accepted_quote: 9n };
    const quote = { id: 9n, intent_id: 2n, buyer: "GB", total_price: 15n, expires_at: 50n, status: { tag: "Accepted" }, created_at: 2n };
    const rfq = new RfqMarket(mockAdapter({ get_intent: intent, get_quote: quote, quotes_for: [9n] }).adapter, ADDR);
    const i = await rfq.getIntent(2);
    expect(i.status).toBe("filled");
    expect(i.acceptedQuote).toBe(9);
    const qs = await rfq.getQuotes(2);
    expect(qs).toEqual([{ id: 9, intentId: 2, buyer: "GB", totalPrice: 15n, expiresAt: 50n, status: "accepted", createdAt: 2n }]);
    const open = new RfqMarket(mockAdapter({ get_intent: { ...intent, status: { tag: "Open" }, accepted_quote: undefined } }).adapter, ADDR);
    expect((await open.getIntent(2)).acceptedQuote).toBeNull();
  });

  it("validates fee range", async () => {
    await expect(new RfqMarket(mockAdapter().adapter, ADDR).setFee(501, "G")).rejects.toThrow(/0-500/);
  });
});

describe("AssetRegistry RWA extensions (Stellar)", () => {
  it("snapshots and historical balances on fungible templates", async () => {
    const { adapter, invokeContract, readContract } = mockAdapter({ snapshot: 3, balance_of_at: 40n, total_supply_at: 100n, current_snapshot_id: 3 });
    const reg = new AssetRegistry(adapter as unknown as IAdapter, "CT", "real-estate");
    expect(await reg.snapshot()).toEqual({ snapshotId: 3, txHash: "tx-snapshot" });
    expect(await reg.getBalanceOfAt("GH", 3)).toBe(40n);
    expect(readContract).toHaveBeenCalledWith("CT", "balance_of_at", { id: "GH", snapshot_id: 3 });
    expect(await reg.getTotalSupplyAt(3)).toBe(100n);
    expect(await reg.getCurrentSnapshotId()).toBe(3);
    expect(invokeContract).toHaveBeenCalledTimes(1);
  });

  it("title flags + custody on title NFTs only", async () => {
    const { adapter, invokeContract } = mockAdapter({
      append_custody: 2,
      title_flags: { disputed: true, dispute_ref: "case", liened: false, lien_ref: "", updated_at: 9n },
      custody_log: [{ owner: "A", reference: "deed", effective_at: 1n, recorded_at: 2n, recorded_by: "GM" }],
    });
    const nft = new AssetRegistry(adapter as unknown as IAdapter, "CN", "farmland-nft");
    await nft.setDispute(1, "case");
    await nft.setLien(1, null);
    expect(invokeContract).toHaveBeenCalledWith("CN", "set_dispute", { token_id: 1n, reference: "case" });
    expect(invokeContract).toHaveBeenCalledWith("CN", "set_lien", { token_id: 1n, reference: undefined });
    expect((await nft.appendCustody(1, "A", "deed", 1n)).index).toBe(2);
    expect(await nft.getTitleFlags(1)).toEqual({ disputed: true, disputeRef: "case", liened: false, lienRef: "", updatedAt: 9n });
    expect(await nft.getCustodyLog(1)).toEqual([{ owner: "A", reference: "deed", effectiveAt: 1n, recordedAt: 2n, recordedBy: "GM" }]);

    await expect(new AssetRegistry(adapter as unknown as IAdapter, "C", "mining-rights-nft").setDispute(1, "x")).rejects.toThrow(/farmland-nft/);
    await expect(nft.snapshot()).rejects.toThrow(/fungible/);
  });

  it("carbon registry refs", async () => {
    const { adapter, invokeContract } = mockAdapter();
    const reg = new AssetRegistry(adapter as unknown as IAdapter, "CC", "carbon-credit");
    await reg.retireWithRegistryRef(5n, "Acme", "Q3", "VCS-1");
    await reg.setRetirementRegistryRef(0, "GS-2");
    expect(invokeContract).toHaveBeenCalledWith("CC", "retire_with_registry_ref", {
      retired_by: "GSIGNER", amount: 5n, beneficiary: "Acme", note: "Q3", external_registry_id: "VCS-1",
    });
    expect(invokeContract).toHaveBeenCalledWith("CC", "set_retirement_registry_ref", { index: 0, external_registry_id: "GS-2" });
    await expect(new AssetRegistry({} as IAdapter, "0x", "carbon-credit").setRetirementRegistryRef(0, "x")).rejects.toThrow(/only available on Stellar/);
  });
});
