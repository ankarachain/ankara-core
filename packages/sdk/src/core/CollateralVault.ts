import type { IAdapter } from "../adapters/IAdapter";
import type { Loan } from "../types";

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

  get address(): string { return this._address; }
}
