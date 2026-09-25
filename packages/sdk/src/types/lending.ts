/** One rung of a collateral-vault's score → credit mapping. */
export interface ScoreTier {
  minScore: number;
  /** Unsecured amount this tier may borrow, on top of any collateral allowance. */
  creditLimit: bigint;
  /** Flat fee on principal, charged at repayment. */
  feeBps: number;
  maxTermSecs: bigint;
}

export interface ScoreConfig {
  /** Any contract exposing `credit_score(borrower) -> Option<CreditScore>`. */
  source: string;
  /** Strictly ascending by `minScore`. */
  tiers: ScoreTier[];
  maxScoreAge: bigint;
}

/** Extra terms on a loan opened through `openScoredLoan`. */
export interface ScoredTerms {
  score: number;
  unsecuredAmount: bigint;
  feeBps: number;
  dueAt: bigint;
}

export interface CreditScore {
  score: number;
  updatedAt: bigint;
}

export type CircleMode = "rotating" | "pooled";
export type CircleStatus = "forming" | "active" | "completed";

export interface SavingsCircleInfo {
  id: number;
  organizer: string;
  token: string;
  mode: CircleMode;
  contribution: bigint;
  periodSecs: bigint;
  maxMembers: number;
  rounds: number;
  members: string[];
  status: CircleStatus;
  startedAt: bigint;
  currentRound: number;
  pot: bigint;
  borrowMultipleBps: number;
  loanFeeBps: number;
  poolCash: bigint;
  totalSavings: bigint;
  totalFees: bigint;
  closed: boolean;
}

export interface CircleMemberState {
  saved: bigint;
  missed: number;
  paidOut: boolean;
  /** `null` when no loan is outstanding. */
  loan: { principal: bigint; fee: bigint; takenAt: bigint } | null;
  withdrawn: boolean;
}

export interface CreateCircleInput {
  token: string;
  mode: CircleMode;
  contribution: bigint;
  periodSecs: bigint;
  maxMembers: number;
  /** Pooled only: number of saving periods. */
  rounds?: number;
  /** Pooled only: max borrowing as a multiple of own savings, in bps (20_000 = 2x). */
  borrowMultipleBps?: number;
  /** Pooled only: flat loan fee paid into the pool. */
  loanFeeBps?: number;
}
