/** A finalized proof-of-reserve report from `reserve-attestation`. */
export interface ReserveReport {
  round: number;
  /** Off-chain reserve in the asset's smallest unit (same decimals as the token). */
  amount: bigint;
  timestamp: bigint;
  attestorCount: number;
  /** `0x` hex hash of the underlying report document. */
  reportHash: string;
}

export interface ReserveSubmission {
  attestor: string;
  amount: bigint;
  reportHash: string;
}

export interface PendingReserveRound {
  round: number;
  /** `0n` until the first submission of the round. */
  openedAt: bigint;
  submissions: ReserveSubmission[];
}

export interface ReserveConfig {
  asset: string;
  attestors: string[];
  quorum: number;
  stalenessThreshold: bigint;
}

/** Why and when an account was frozen by a `compliance-policy`. */
export interface FreezeRecord {
  frozenAt: bigint;
  reason: string;
}
