import type { StellarAdapter } from "../adapters/stellar";
import type { CreditScore } from "../types/lending";
import { optional, toBigInt, toNumber } from "../utils/soroban";

/**
 * ManualCreditScorer
 *
 * Drives a deployed `manual-credit-scorer` — the reference credit-score
 * source for `CollateralVault`'s score-based lending (one trusted Manager
 * posts scores, like `manual-oracle` does for prices). Any contract exposing
 * `credit_score(borrower) -> Option<CreditScore>` can replace it.
 *
 * Stellar-only — pass a `StellarAdapter` (scorer admin for writes).
 */
export class ManualCreditScorer {
  static readonly MAX_BATCH = 50;

  constructor(private readonly _adapter: StellarAdapter, private readonly _address: string) {}

  get address(): string { return this._address; }

  async setScore(borrower: string, score: number): Promise<string> {
    return (await this._adapter.invokeContract(this._address, "set_score", { borrower, score })).txHash;
  }

  async batchSetScores(entries: Array<{ borrower: string; score: number }>): Promise<string> {
    if (entries.length > ManualCreditScorer.MAX_BATCH) {
      throw new Error(`At most ${ManualCreditScorer.MAX_BATCH} scores per call`);
    }
    return (await this._adapter.invokeContract(this._address, "batch_set_scores", { entries })).txHash;
  }

  async removeScore(borrower: string): Promise<string> {
    return (await this._adapter.invokeContract(this._address, "remove_score", { borrower })).txHash;
  }

  async getScore(borrower: string): Promise<CreditScore | null> {
    const raw = optional(await this._adapter.readContract<{ score: number; updated_at: bigint } | null>(
      this._address, "credit_score", { borrower }
    ));
    return raw ? { score: toNumber(raw.score), updatedAt: toBigInt(raw.updated_at) } : null;
  }
}
