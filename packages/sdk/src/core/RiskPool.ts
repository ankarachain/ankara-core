import type { StellarAdapter } from "../adapters/stellar";
import type {
  CreateProductInput, InsurancePolicy, InsuranceProduct, InsuranceSubject, InsuranceTrigger, PolicyStatus, ProductStatus,
} from "../types/insurance";
import {
  assetIdToBytes32, enumTag, enumValues, optional, sorobanEnum, toBigInt, toHex, toNumber,
} from "../utils/soroban";

/**
 * RiskPool
 *
 * Drives a deployed `risk-pool` Soroban contract — parametric insurance for
 * RWA holders: policies pay out automatically when a verifiable threshold is
 * crossed (rainfall below X, temperature above Y, a delivery confirmation
 * missing after a deadline), with no claims adjuster in the loop.
 *
 * Stellar-only — pass a `StellarAdapter`. `createProduct`/`withdrawCapital`
 * need the pool Manager; `trigger`/`settle`/`expire` can be called by anyone
 * (e.g. a keeper), and payouts always go to the policyholder.
 *
 * @example
 * ```typescript
 * const pool = new RiskPool(insurerAdapter, "CPOOL...");
 * await pool.fund(100_000_0000000n);
 * const { productId } = await pool.createProduct({
 *   trigger: { kind: "oracle-below", oracle: ORACLE, key: RAIN_INDEX_KEY, threshold: 300n * 10n ** 18n },
 *   coverageStart: seasonStart, coverageEnd: seasonEnd, premiumBps: 500,
 *   asset: { token: FARMLAND_TOKEN, coveragePerUnit: 500_0000000n, unitScale: 10n ** 18n },
 * });
 * // a farmland token holder:
 * await new RiskPool(holderAdapter, "CPOOL...").buyPolicyForHolding(productId);
 * ```
 */
export class RiskPool {
  static readonly MAX_SETTLE_BATCH = 25;

  constructor(private readonly _adapter: StellarAdapter, private readonly _address: string) {}

  get address(): string { return this._address; }

  // ─── Capital ──────────────────────────────────────────────────────────

  async fund(amount: bigint): Promise<string> {
    const from = await this._adapter.getSignerAddress();
    return (await this._adapter.invokeContract(this._address, "fund", { from, amount })).txHash;
  }

  async withdrawCapital(to: string, amount: bigint): Promise<string> {
    return (await this._adapter.invokeContract(this._address, "withdraw_capital", { to, amount })).txHash;
  }

  // ─── Products ─────────────────────────────────────────────────────────

  async createProduct(input: CreateProductInput): Promise<{ productId: number; txHash: string }> {
    if (input.coverageStart >= input.coverageEnd) throw new Error("coverageStart must be before coverageEnd");
    if (input.premiumBps <= 0 || input.premiumBps > 10_000) throw new Error("premiumBps must be 1-10000");
    const { result, txHash } = await this._adapter.invokeContract<bigint>(this._address, "create_product", {
      trigger: encodeTrigger(input.trigger),
      coverage_start: input.coverageStart,
      coverage_end: input.coverageEnd,
      premium_bps: input.premiumBps,
      asset_token: input.asset?.token ?? undefined,
      coverage_per_unit: input.asset?.coveragePerUnit ?? 0n,
      unit_scale: input.asset?.unitScale ?? 1n,
    });
    return { productId: toNumber(result), txHash };
  }

  // ─── Policies ─────────────────────────────────────────────────────────

  async buyPolicy(productId: number, coverage: bigint): Promise<{ policyId: number; txHash: string }> {
    const holder = await this._adapter.getSignerAddress();
    const { result, txHash } = await this._adapter.invokeContract<bigint>(this._address, "buy_policy", {
      holder, product_id: BigInt(productId), coverage,
    });
    return { policyId: toNumber(result), txHash };
  }

  /** Asset-linked products: coverage sized from the signer's token balance. */
  async buyPolicyForHolding(productId: number): Promise<{ policyId: number; txHash: string }> {
    const holder = await this._adapter.getSignerAddress();
    const { result, txHash } = await this._adapter.invokeContract<bigint>(this._address, "buy_policy_for_holding", {
      holder, product_id: BigInt(productId),
    });
    return { policyId: toNumber(result), txHash };
  }

  // ─── Keeper actions (permissionless) ──────────────────────────────────

  async trigger(productId: number): Promise<string> {
    return (await this._adapter.invokeContract(this._address, "trigger", { product_id: BigInt(productId) })).txHash;
  }

  async settle(policyId: number): Promise<{ paid: bigint; txHash: string }> {
    const { result, txHash } = await this._adapter.invokeContract<bigint>(this._address, "settle", { policy_id: BigInt(policyId) });
    return { paid: toBigInt(result), txHash };
  }

  /** Settles up to 25 policies per tx (longer lists are chunked). */
  async settleMany(policyIds: number[]): Promise<{ paid: bigint; txHashes: string[] }> {
    let paid = 0n;
    const txHashes: string[] = [];
    for (let i = 0; i < policyIds.length; i += RiskPool.MAX_SETTLE_BATCH) {
      const chunk = policyIds.slice(i, i + RiskPool.MAX_SETTLE_BATCH).map((id) => BigInt(id));
      const { result, txHash } = await this._adapter.invokeContract<bigint>(this._address, "settle_many", { policy_ids: chunk });
      paid += toBigInt(result);
      txHashes.push(txHash);
    }
    return { paid, txHashes };
  }

  async expire(productId: number): Promise<string> {
    return (await this._adapter.invokeContract(this._address, "expire", { product_id: BigInt(productId) })).txHash;
  }

  // ─── Reads ────────────────────────────────────────────────────────────

  async isTriggerable(productId: number): Promise<boolean> {
    return this._adapter.readContract<boolean>(this._address, "is_triggerable", { product_id: BigInt(productId) });
  }

  async quotePremium(productId: number, coverage: bigint): Promise<bigint> {
    return toBigInt(await this._adapter.readContract(this._address, "quote_premium", { product_id: BigInt(productId), coverage }));
  }

  async getProduct(productId: number): Promise<InsuranceProduct> {
    const r = await this._adapter.readContract<Record<string, unknown>>(this._address, "get_product", { product_id: BigInt(productId) });
    return {
      id: toNumber(r.id),
      trigger: decodeTrigger(r.trigger),
      coverageStart: toBigInt(r.coverage_start),
      coverageEnd: toBigInt(r.coverage_end),
      premiumBps: toNumber(r.premium_bps),
      assetToken: optional(r.asset_token as string | null | undefined),
      coveragePerUnit: toBigInt(r.coverage_per_unit),
      unitScale: toBigInt(r.unit_scale),
      status: enumTag(r.status).toLowerCase() as ProductStatus,
      exposure: toBigInt(r.exposure),
      triggeredAt: toBigInt(r.triggered_at),
      observedValue: toBigInt(r.observed_value),
    };
  }

  async getPolicy(policyId: number): Promise<InsurancePolicy> {
    const r = await this._adapter.readContract<Record<string, unknown>>(this._address, "get_policy", { policy_id: BigInt(policyId) });
    return {
      id: toNumber(r.id),
      productId: toNumber(r.product_id),
      holder: String(r.holder),
      coverage: toBigInt(r.coverage),
      premium: toBigInt(r.premium),
      insuredUnits: toBigInt(r.insured_units),
      status: enumTag(r.status).toLowerCase() as PolicyStatus,
      purchasedAt: toBigInt(r.purchased_at),
      paidAmount: toBigInt(r.paid_amount),
    };
  }

  async productPolicies(productId: number): Promise<number[]> {
    return (await this._adapter.readContract<bigint[]>(this._address, "product_policies", { product_id: BigInt(productId) })).map(toNumber);
  }

  /** Defaults to the signer. */
  async holderPolicies(holder?: string): Promise<number[]> {
    const addr = holder ?? await this._adapter.getSignerAddress();
    return (await this._adapter.readContract<bigint[]>(this._address, "holder_policies", { holder: addr })).map(toNumber);
  }

  async getCapital(): Promise<{ freeCapital: bigint; totalExposure: bigint }> {
    const [free, exposure] = await Promise.all([
      this._adapter.readContract(this._address, "free_capital", {}),
      this._adapter.readContract(this._address, "total_exposure", {}),
    ]);
    return { freeCapital: toBigInt(free), totalExposure: toBigInt(exposure) };
  }
}

function encodeSubject(s: InsuranceSubject) {
  return s.kind === "account" ? sorobanEnum("Account", s.address) : sorobanEnum("Asset", assetIdToBytes32(s.assetId));
}

export function encodeTrigger(t: InsuranceTrigger): { tag: string; values?: unknown[] } {
  switch (t.kind) {
    case "oracle-below": return sorobanEnum("OracleBelow", t.oracle, t.key, t.threshold);
    case "oracle-above": return sorobanEnum("OracleAbove", t.oracle, t.key, t.threshold);
    case "claim-missing": return sorobanEnum("ClaimMissing", t.registry, encodeSubject(t.subject), t.claimType, t.deadline);
  }
}

function decodeTrigger(raw: unknown): InsuranceTrigger {
  const v = enumValues(raw);
  switch (enumTag(raw)) {
    case "OracleBelow": return { kind: "oracle-below", oracle: String(v[0]), key: String(v[1]), threshold: toBigInt(v[2]) };
    case "OracleAbove": return { kind: "oracle-above", oracle: String(v[0]), key: String(v[1]), threshold: toBigInt(v[2]) };
    default: {
      const subjectRaw = v[1];
      const [sv] = enumValues(subjectRaw);
      const subject: InsuranceSubject = enumTag(subjectRaw) === "Account"
        ? { kind: "account", address: String(sv) }
        : { kind: "asset", assetId: toHex(sv) };
      return { kind: "claim-missing", registry: String(v[0]), subject, claimType: String(v[2]), deadline: toBigInt(v[3]) };
    }
  }
}
