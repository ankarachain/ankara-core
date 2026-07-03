import type { ContractTransactionResponse } from "ethers";
import { EVMAdapter } from "../adapters/evm";
import type { Milestone } from "../types";
import { MilestoneStatus } from "../types";

/**
 * EscrowManager
 *
 * Read and drive the lifecycle of a deployed MilestoneEscrow contract —
 * funding, marking milestones delivered, approvals, disputes, and cancellation.
 *
 * @example
 * ```typescript
 * const escrow = new EscrowManager(adapter, "0xEscrowAddress");
 *
 * await escrow.fund();                      // payer only
 * await escrow.markDelivered(0);             // payee only
 * await escrow.approveMilestone(0);          // payer only — releases funds
 * ```
 */
export class EscrowManager {
  private _adapter: EVMAdapter;
  private _address: string;

  constructor(adapter: EVMAdapter, escrowAddress: string) {
    this._adapter = adapter;
    this._address = escrowAddress;
  }

  // ─── Reads ────────────────────────────────────────────────────────────────

  async getPayer(): Promise<string> {
    return this._escrow().payer();
  }

  async getPayee(): Promise<string> {
    return this._escrow().payee();
  }

  async getArbiter(): Promise<string> {
    return this._escrow().arbiter();
  }

  async getToken(): Promise<string> {
    return this._escrow().token();
  }

  async getTotalAmount(): Promise<bigint> {
    return this._escrow().totalAmount();
  }

  async isFunded(): Promise<boolean> {
    return this._escrow().funded();
  }

  async isCancelled(): Promise<boolean> {
    return this._escrow().cancelled();
  }

  async milestoneCount(): Promise<number> {
    const n = await this._escrow().milestoneCount();
    return Number(n);
  }

  async getMilestone(milestoneId: number): Promise<Milestone> {
    const m = await this._escrow().getMilestone(milestoneId);
    return {
      amount:          m.amount,
      descriptionHash: m.descriptionHash,
      status:          Number(m.status) as MilestoneStatus,
      deliveredAt:     m.deliveredAt,
    };
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
    return this._escrow().remainingBalance();
  }

  // ─── Lifecycle writes ───────────────────────────────────────────────────────

  /** Deposit the full agreed amount. Payer only. Requires prior ERC-20 approval. */
  async fund(): Promise<string> {
    return this._sendAndWait(this._escrow().fund());
  }

  /** Flag a milestone as complete. Payee only. */
  async markDelivered(milestoneId: number): Promise<string> {
    return this._sendAndWait(this._escrow().markDelivered(milestoneId));
  }

  /** Approve a delivered milestone, releasing funds to the payee. Payer only. */
  async approveMilestone(milestoneId: number): Promise<string> {
    return this._sendAndWait(this._escrow().approveMilestone(milestoneId));
  }

  /** Freeze a delivered milestone pending arbiter review. Payer or payee only. */
  async raiseDispute(milestoneId: number): Promise<string> {
    return this._sendAndWait(this._escrow().raiseDispute(milestoneId));
  }

  /** Resolve a disputed milestone. Arbiter only. */
  async resolveDispute(milestoneId: number, releaseToPayee: boolean): Promise<string> {
    return this._sendAndWait(this._escrow().resolveDispute(milestoneId, releaseToPayee));
  }

  /** Force-release a delivered, non-disputed milestone once the timelock has elapsed. */
  async claimTimelockRelease(milestoneId: number): Promise<string> {
    return this._sendAndWait(this._escrow().claimTimelockRelease(milestoneId));
  }

  /** Vote to cancel the deal. Requires both payer and payee to call this. */
  async voteCancel(): Promise<string> {
    return this._sendAndWait(this._escrow().voteCancel());
  }

  // ─── Admin ──────────────────────────────────────────────────────────────

  /** Assign or rotate the dispute arbiter. MANAGER_ROLE. */
  async setArbiter(newArbiter: string): Promise<string> {
    return this._sendAndWait(this._escrow().setArbiter(newArbiter));
  }

  /** Swap the identity verifier. MANAGER_ROLE. Pass the zero address to disable KYC gating. */
  async setIdentityVerifier(verifierAddress: string): Promise<string> {
    return this._sendAndWait(this._escrow().setIdentityVerifier(verifierAddress));
  }

  async pause(): Promise<string> {
    return this._sendAndWait(this._escrow().pause());
  }

  async unpause(): Promise<string> {
    return this._sendAndWait(this._escrow().unpause());
  }

  // ─── Internal ───────────────────────────────────────────────────────────

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _escrow(): any {
    return this._adapter.milestoneEscrow(this._address);
  }

  private async _sendAndWait(txPromise: Promise<ContractTransactionResponse>): Promise<string> {
    const tx      = await txPromise;
    const receipt = await tx.wait();
    if (!receipt) throw new Error("Transaction receipt unavailable");
    return receipt.hash;
  }

  get address(): string { return this._address; }
}
