import type { StellarAdapter } from "../adapters/stellar";
import type { RevenueDistribution } from "../types/rwa";
import { toBigInt, toNumber } from "../utils/soroban";

interface RawDistribution {
  id: bigint;
  asset_token: string;
  payout_token: string;
  snapshot_id: number;
  total_amount: bigint;
  supply_at_snapshot: bigint;
  claimed_amount: bigint;
  creator: string;
  created_at: bigint;
  claim_deadline: bigint;
  reclaimed: boolean;
  memo: string;
}

/**
 * RevenueDistributor
 *
 * Drives a deployed `revenue-distributor` Soroban contract: pays income an
 * asset generates (rent, royalties, coupons, harvest proceeds) to the
 * holders of its RWA token, pro-rata to their balance at a snapshot taken
 * when the distribution is created. Works with any Ankara fungible template.
 *
 * Stellar-only — pass a `StellarAdapter`. `createDistribution` must be
 * signed by the asset token's Manager (the snapshot requires it); holders
 * sign their own `claim`.
 *
 * @example
 * ```typescript
 * const distributor = new RevenueDistributor(issuerAdapter, "CDIST...");
 * const { distributionId } = await distributor.createDistribution({
 *   assetToken: buildingToken, payoutToken: usdcSac, amount: 25_000_0000000n,
 *   claimWindowSecs: 180n * 86400n, memo: "Rent Q3 2026",
 * });
 *
 * // each holder:
 * await new RevenueDistributor(holderAdapter, "CDIST...").claim(distributionId);
 * ```
 */
export class RevenueDistributor {
  static readonly MAX_CLAIM_MANY = 20;

  constructor(private readonly _adapter: StellarAdapter, private readonly _address: string) {}

  get address(): string { return this._address; }

  async createDistribution(input: {
    assetToken: string;
    payoutToken: string;
    amount: bigint;
    /** `0n`/omitted = no deadline (and no reclaim). */
    claimWindowSecs?: bigint;
    memo?: string;
  }): Promise<{ distributionId: number; txHash: string }> {
    if (input.amount <= 0n) throw new Error("amount must be positive");
    const creator = await this._adapter.getSignerAddress();
    const { result, txHash } = await this._adapter.invokeContract<bigint>(this._address, "create_distribution", {
      creator,
      asset_token: input.assetToken,
      payout_token: input.payoutToken,
      amount: input.amount,
      claim_window_secs: input.claimWindowSecs ?? 0n,
      memo: input.memo ?? "",
    });
    return { distributionId: toNumber(result), txHash };
  }

  async claim(distributionId: number): Promise<{ amount: bigint; txHash: string }> {
    const holder = await this._adapter.getSignerAddress();
    const { result, txHash } = await this._adapter.invokeContract<bigint>(this._address, "claim", {
      holder, distribution_id: BigInt(distributionId),
    });
    return { amount: toBigInt(result), txHash };
  }

  /** Claims up to 20 distributions in one tx, skipping ones with nothing owed. */
  async claimMany(distributionIds: number[]): Promise<{ amount: bigint; txHash: string }> {
    if (distributionIds.length > RevenueDistributor.MAX_CLAIM_MANY) {
      throw new Error(`claimMany takes at most ${RevenueDistributor.MAX_CLAIM_MANY} distributions per call`);
    }
    const holder = await this._adapter.getSignerAddress();
    const { result, txHash } = await this._adapter.invokeContract<bigint>(this._address, "claim_many", {
      holder, distribution_ids: distributionIds.map((id) => BigInt(id)),
    });
    return { amount: toBigInt(result), txHash };
  }

  /** After the claim deadline, returns what's unclaimed to the creator (signer). */
  async reclaim(distributionId: number): Promise<{ amount: bigint; txHash: string }> {
    const creator = await this._adapter.getSignerAddress();
    const { result, txHash } = await this._adapter.invokeContract<bigint>(this._address, "reclaim", {
      creator, distribution_id: BigInt(distributionId),
    });
    return { amount: toBigInt(result), txHash };
  }

  async getDistribution(distributionId: number): Promise<RevenueDistribution> {
    const r = await this._adapter.readContract<RawDistribution>(this._address, "get_distribution", {
      distribution_id: BigInt(distributionId),
    });
    return {
      id: toNumber(r.id),
      assetToken: r.asset_token,
      payoutToken: r.payout_token,
      snapshotId: toNumber(r.snapshot_id),
      totalAmount: toBigInt(r.total_amount),
      supplyAtSnapshot: toBigInt(r.supply_at_snapshot),
      claimedAmount: toBigInt(r.claimed_amount),
      creator: r.creator,
      createdAt: toBigInt(r.created_at),
      claimDeadline: toBigInt(r.claim_deadline),
      reclaimed: r.reclaimed,
      memo: r.memo,
    };
  }

  /** Defaults to the signer. */
  async claimable(distributionId: number, holder?: string): Promise<bigint> {
    const addr = holder ?? await this._adapter.getSignerAddress();
    return toBigInt(await this._adapter.readContract(this._address, "claimable", { holder: addr, distribution_id: BigInt(distributionId) }));
  }

  async hasClaimed(distributionId: number, holder?: string): Promise<boolean> {
    const addr = holder ?? await this._adapter.getSignerAddress();
    return this._adapter.readContract<boolean>(this._address, "has_claimed", { holder: addr, distribution_id: BigInt(distributionId) });
  }

  async distributionsFor(assetToken: string): Promise<number[]> {
    return (await this._adapter.readContract<bigint[]>(this._address, "distributions_for", { asset_token: assetToken })).map(toNumber);
  }
}
