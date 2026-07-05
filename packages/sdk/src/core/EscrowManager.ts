import type { IAdapter } from "../adapters/IAdapter";
import type { Milestone, EscrowActivityEvent } from "../types";

/**
 * EscrowManager
 *
 * Read and drive the lifecycle of a deployed MilestoneEscrow contract —
 * funding, marking milestones delivered, approvals, disputes, and cancellation.
 * Works against a deployed escrow on either chain: pass an `EVMAdapter` for
 * an EVM-deployed `MilestoneEscrow`, or a `StellarAdapter` for a
 * Soroban-deployed `milestone-escrow` contract — both implement `IAdapter`.
 *
 * @example
 * ```typescript
 * const escrow = new EscrowManager(adapter, "0xEscrowAddress");
 *
 * await escrow.fund(0);                      // payer only — funds milestone 0
 * await escrow.markDelivered(0);             // payee only
 * await escrow.approveMilestone(0);          // payer only — releases funds
 * ```
 */
export class EscrowManager {
  private _adapter: IAdapter;
  private _address: string;

  constructor(adapter: IAdapter, escrowAddress: string) {
    this._adapter = adapter;
    this._address = escrowAddress;
  }

  // ─── Reads ────────────────────────────────────────────────────────────────

  async getPayer(): Promise<string> {
    return this._adapter.escrowGetPayer(this._address);
  }

  async getPayee(): Promise<string> {
    return this._adapter.escrowGetPayee(this._address);
  }

  async getArbiter(): Promise<string> {
    return this._adapter.escrowGetArbiter(this._address);
  }

  async getToken(): Promise<string> {
    return this._adapter.escrowGetToken(this._address);
  }

  async getTotalAmount(): Promise<bigint> {
    return this._adapter.escrowGetTotalAmount(this._address);
  }

  async isFunded(): Promise<boolean> {
    return this._adapter.escrowIsFunded(this._address);
  }

  async isCancelled(): Promise<boolean> {
    return this._adapter.escrowIsCancelled(this._address);
  }

  async milestoneCount(): Promise<number> {
    return this._adapter.escrowMilestoneCount(this._address);
  }

  async getMilestone(milestoneId: number): Promise<Milestone> {
    return this._adapter.escrowGetMilestone(this._address, milestoneId);
  }

  async getAllMilestones(): Promise<Milestone[]> {
    const count = await this.milestoneCount();
    const milestones: Milestone[] = [];
    for (let i = 0; i < count; i++) {
      milestones.push(await this.getMilestone(i));
    }
    return milestones;
  }

  async remainingBalance(): Promise<bigint> {
    return this._adapter.escrowRemainingBalance(this._address);
  }

  /** Full on-chain event history for this deal, oldest first. */
  async getActivity(): Promise<EscrowActivityEvent[]> {
    return this._adapter.escrowGetActivity(this._address);
  }

  // ─── Lifecycle writes ───────────────────────────────────────────────────────

  /** Deposit the full agreed amount. Payer only. Requires prior token approval (EVM) — Stellar's nested transfer is authorized in the same call. */
  /** Funds a single milestone — milestones are funded independently, so the payer can pay in installments. */
  async fund(milestoneId: number): Promise<string> {
    return this._adapter.escrowFund(this._address, milestoneId);
  }

  /** Flag a milestone as complete. Payee only. */
  async markDelivered(milestoneId: number): Promise<string> {
    return this._adapter.escrowMarkDelivered(this._address, milestoneId);
  }

  /** Approve a delivered milestone, releasing funds to the payee. Payer only. */
  async approveMilestone(milestoneId: number): Promise<string> {
    return this._adapter.escrowApproveMilestone(this._address, milestoneId);
  }

  /** Freeze a delivered milestone pending arbiter review. Payer or payee only. */
  async raiseDispute(milestoneId: number): Promise<string> {
    return this._adapter.escrowRaiseDispute(this._address, milestoneId);
  }

  /** Resolve a disputed milestone. Arbiter only. */
  async resolveDispute(milestoneId: number, releaseToPayee: boolean): Promise<string> {
    return this._adapter.escrowResolveDispute(this._address, milestoneId, releaseToPayee);
  }

  /** Force-release a delivered, non-disputed milestone once the timelock has elapsed. */
  async claimTimelockRelease(milestoneId: number): Promise<string> {
    return this._adapter.escrowClaimTimelockRelease(this._address, milestoneId);
  }

  /** Vote to cancel the deal. Requires both payer and payee to call this. */
  async voteCancel(): Promise<string> {
    return this._adapter.escrowVoteCancel(this._address);
  }

  // ─── Admin ──────────────────────────────────────────────────────────────

  /** Assign or rotate the dispute arbiter. MANAGER_ROLE. */
  async setArbiter(newArbiter: string): Promise<string> {
    return this._adapter.escrowSetArbiter(this._address, newArbiter);
  }

  /** Swap the identity verifier. MANAGER_ROLE. Pass the zero address to disable KYC gating. */
  async setIdentityVerifier(verifierAddress: string): Promise<string> {
    return this._adapter.escrowSetIdentityVerifier(this._address, verifierAddress);
  }

  async pause(): Promise<string> {
    return this._adapter.escrowPause(this._address);
  }

  async unpause(): Promise<string> {
    return this._adapter.escrowUnpause(this._address);
  }

  get address(): string { return this._address; }
}
