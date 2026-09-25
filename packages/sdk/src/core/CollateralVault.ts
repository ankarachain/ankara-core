import type { IAdapter } from "../adapters/IAdapter";
import type { Loan } from "../types";
import type { ScoreConfig, ScoredTerms } from "../types/lending";

/** The generic-invocation surface of `StellarAdapter`, duck-typed so this file doesn't import the Stellar SDK. */
interface StellarInvoker {
  invokeContract<T = unknown>(contractId: string, method: string, args?: Record<string, unknown>): Promise<{ result: T; txHash: string }>;
  readContract<T = unknown>(contractId: string, method: string, args?: Record<string, unknown>): Promise<T>;
  getSignerAddress(): Promise<string>;
}

/**
 * CollateralVault
 *
 * Read and drive the lifecycle of a deployed CollateralVault contract —
 * pledge any Ankara RWA token as collateral to borrow the vault's configured
 * asset (e.g. USDC), repay, or liquidate an undercollateralized loan.
 *
 * Stellar-only in v1 — pass a `StellarAdapter`. There is no
 * `CollateralVault.sol` yet, so `EVMAdapter`'s methods throw. Unlike
 * `EscrowManager`/`RampManager`, there's no `deployXxx` factory method here:
 * `CollateralVault` is a singleton per network (one instance, many loans),
 * provisioned once via `contracts-stellar/scripts/deploy-testnet.sh`, not
 * deployed per-relationship through an on-chain factory.
 *
 * @example
 * ```typescript
 * const vault = new CollateralVault(adapter, "CVaultAddress...");
 *
 * const { loanId } = await vault.openLoan(farmlandTokenAddress, 1_000n, 600n);
 * await vault.repayLoan(loanId);
 * ```
 */
export class CollateralVault {
  private _adapter: IAdapter;
  private _address: string;

  constructor(adapter: IAdapter, vaultAddress: string) {
    this._adapter = adapter;
    this._address = vaultAddress;
  }

  // ─── Borrower lifecycle ─────────────────────────────────────────────────

  /** Pledges `collateralAmount` of `collateralToken` and borrows up to the vault's configured LTV against its live oracle price. */
  async openLoan(
    collateralToken: string,
    collateralAmount: bigint,
    borrowAmount: bigint
  ): Promise<{ loanId: number; txHash: string }> {
    return this._adapter.vaultOpenLoan(this._address, collateralToken, collateralAmount, borrowAmount);
  }

  /** Repays the full borrowed amount and releases the collateral back to the borrower. */
  async repayLoan(loanId: number): Promise<string> {
    return this._adapter.vaultRepayLoan(this._address, loanId);
  }

  /** Callable by anyone once a loan's live oracle-priced LTV has crossed the liquidation threshold. */
  async liquidate(loanId: number): Promise<string> {
    return this._adapter.vaultLiquidate(this._address, loanId);
  }

  // ─── Admin ──────────────────────────────────────────────────────────────

  async setLtvBps(newLtvBps: number): Promise<string> {
    return this._adapter.vaultSetLtvBps(this._address, newLtvBps);
  }

  async setLiquidationThresholdBps(newThresholdBps: number): Promise<string> {
    return this._adapter.vaultSetLiquidationThresholdBps(this._address, newThresholdBps);
  }

  async setOracle(oracleAddress: string): Promise<string> {
    return this._adapter.vaultSetOracle(this._address, oracleAddress);
  }

  async pause(): Promise<string> {
    return this._adapter.vaultPause(this._address);
  }

  async unpause(): Promise<string> {
    return this._adapter.vaultUnpause(this._address);
  }

  // ─── Reads ──────────────────────────────────────────────────────────────

  async getLoan(loanId: number): Promise<Loan> {
    return this._adapter.vaultGetLoan(this._address, loanId);
  }

  /** Defaults to the connected signer's own loans if `borrower` is omitted. */
  async getBorrowerLoans(borrower?: string): Promise<number[]> {
    return this._adapter.vaultGetBorrowerLoans(this._address, borrower);
  }

  /** Live, oracle-priced current LTV of an open loan, in bps — not the same as the loan's locked-in LTV at open time. */
  async currentLtvBps(loanId: number): Promise<number> {
    return this._adapter.vaultCurrentLtvBps(this._address, loanId);
  }

  async isLiquidatable(loanId: number): Promise<boolean> {
    return this._adapter.vaultIsLiquidatable(this._address, loanId);
  }

  /** The vault's own static config — not a per-loan value. */
  async getBorrowedToken(): Promise<string> {
    return this._adapter.vaultGetBorrowedToken(this._address);
  }

  async getOracle(): Promise<string> {
    return this._adapter.vaultGetOracle(this._address);
  }

  async getLtvBps(): Promise<number> {
    return this._adapter.vaultGetLtvBps(this._address);
  }

  async getLiquidationThresholdBps(): Promise<number> {
    return this._adapter.vaultGetLiquidationThresholdBps(this._address);
  }

  async isPaused(): Promise<boolean> {
    return this._adapter.vaultIsPaused(this._address);
  }

  // ─── Score-based (undercollateralized) lending ─────────────────────────

  /**
   * Opens a loan sized against the signer's credit score (from the vault's
   * configured score source) plus any optional collateral:
   * `limit = tier.creditLimit + collateralValue × LTV`. Must be repaid —
   * principal + the tier fee — within `termSecs`, or anyone can
   * `markDefaulted` it.
   */
  async openScoredLoan(opts: {
    borrowAmount: bigint;
    termSecs: bigint;
    collateralToken?: string;
    collateralAmount?: bigint;
  }): Promise<{ loanId: number; txHash: string }> {
    const stellar = this._stellar("openScoredLoan");
    const caller = await stellar.getSignerAddress();
    const { result, txHash } = await stellar.invokeContract<bigint>(this._address, "open_scored_loan", {
      caller,
      collateral_token: opts.collateralToken ?? undefined,
      collateral_amount: opts.collateralAmount ?? 0n,
      borrow_amount: opts.borrowAmount,
      term_secs: opts.termSecs,
    });
    return { loanId: Number(result), txHash };
  }

  /** Anyone, once a score-based loan is past due. Collateral (if any) goes to the vault Manager. */
  async markDefaulted(loanId: number): Promise<string> {
    return (await this._stellar("markDefaulted").invokeContract(this._address, "mark_defaulted", { loan_id: BigInt(loanId) })).txHash;
  }

  /** Principal plus fee owed to close the loan now. */
  async amountDue(loanId: number): Promise<bigint> {
    return BigInt(await this._stellar("amountDue").readContract<bigint>(this._address, "amount_due", { loan_id: BigInt(loanId) }));
  }

  /** What `borrower` could open with `openScoredLoan` right now; `0n` if they don't qualify. */
  async scoredBorrowLimit(borrower: string, collateralToken?: string, collateralAmount = 0n): Promise<bigint> {
    return BigInt(await this._stellar("scoredBorrowLimit").readContract<bigint>(this._address, "scored_borrow_limit", {
      borrower, collateral_token: collateralToken ?? undefined, collateral_amount: collateralAmount,
    }));
  }

  /** `null` for ordinary collateral-only loans. */
  async getScoredTerms(loanId: number): Promise<ScoredTerms | null> {
    const raw = await this._stellar("getScoredTerms").readContract<{
      score: number; unsecured_amount: bigint; fee_bps: number; due_at: bigint;
    } | null | undefined>(this._address, "get_scored_terms", { loan_id: BigInt(loanId) });
    if (!raw) return null;
    return { score: Number(raw.score), unsecuredAmount: BigInt(raw.unsecured_amount), feeBps: Number(raw.fee_bps), dueAt: BigInt(raw.due_at) };
  }

  /** Manager: configure (or with `null`, disable) score-based lending. */
  async setScoreConfig(config: ScoreConfig | null): Promise<string> {
    if (config) {
      config.tiers.forEach((t, i) => {
        if (i > 0 && t.minScore <= config.tiers[i - 1].minScore) {
          throw new Error("Score tiers must be strictly ascending by minScore");
        }
      });
    }
    return (await this._stellar("setScoreConfig").invokeContract(this._address, "set_score_config", {
      config: config ? {
        source: config.source,
        tiers: config.tiers.map((t) => ({
          min_score: t.minScore, credit_limit: t.creditLimit, fee_bps: t.feeBps, max_term_secs: t.maxTermSecs,
        })),
        max_score_age: config.maxScoreAge,
      } : undefined,
    })).txHash;
  }

  async getScoreConfig(): Promise<ScoreConfig | null> {
    const raw = await this._stellar("getScoreConfig").readContract<{
      source: string;
      tiers: Array<{ min_score: number; credit_limit: bigint; fee_bps: number; max_term_secs: bigint }>;
      max_score_age: bigint;
    } | null | undefined>(this._address, "score_config", {});
    if (!raw) return null;
    return {
      source: raw.source,
      tiers: raw.tiers.map((t) => ({
        minScore: Number(t.min_score), creditLimit: BigInt(t.credit_limit), feeBps: Number(t.fee_bps), maxTermSecs: BigInt(t.max_term_secs),
      })),
      maxScoreAge: BigInt(raw.max_score_age),
    };
  }

  private _stellar(method: string): StellarInvoker {
    const adapter = this._adapter as unknown as Partial<StellarInvoker>;
    if (typeof adapter.invokeContract !== "function" || typeof adapter.readContract !== "function") {
      throw new Error(`${method}() needs a StellarAdapter — score-based lending is Stellar-only`);
    }
    return adapter as StellarInvoker;
  }

  get address(): string { return this._address; }
}
