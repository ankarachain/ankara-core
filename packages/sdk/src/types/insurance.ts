/** What a `ClaimMissing` trigger watches — same as an attestation subject. */
export type InsuranceSubject =
  | { kind: "account"; address: string }
  | { kind: "asset"; assetId: string };

/** The verifiable condition that pays out a risk-pool product. */
export type InsuranceTrigger =
  /** Fires when the oracle's fresh value for `key` is below `threshold` (rainfall, NDVI, price). */
  | { kind: "oracle-below"; oracle: string; key: string; threshold: bigint }
  /** Fires when the value is above `threshold` (temperature, flood gauge). */
  | { kind: "oracle-above"; oracle: string; key: string; threshold: bigint }
  /** Fires when no valid `claimType` claim about `subject` exists after `deadline` (e.g. missed delivery). */
  | { kind: "claim-missing"; registry: string; subject: InsuranceSubject; claimType: string; deadline: bigint };

export type ProductStatus = "active" | "triggered" | "expired";
export type PolicyStatus = "active" | "paid" | "expired";

export interface InsuranceProduct {
  id: number;
  trigger: InsuranceTrigger;
  coverageStart: bigint;
  coverageEnd: bigint;
  premiumBps: number;
  assetToken: string | null;
  coveragePerUnit: bigint;
  unitScale: bigint;
  status: ProductStatus;
  exposure: bigint;
  triggeredAt: bigint;
  observedValue: bigint;
}

export interface InsurancePolicy {
  id: number;
  productId: number;
  holder: string;
  coverage: bigint;
  premium: bigint;
  insuredUnits: bigint;
  status: PolicyStatus;
  purchasedAt: bigint;
  paidAmount: bigint;
}

export interface CreateProductInput {
  trigger: InsuranceTrigger;
  coverageStart: bigint;
  coverageEnd: bigint;
  premiumBps: number;
  /** Asset-linked cover: size policies from holders' balance of this token. */
  asset?: { token: string; coveragePerUnit: bigint; unitScale: bigint };
}
