import type { StellarAdapter } from "../adapters/stellar";
import type {
  CircleMemberState, CircleMode, CircleStatus, CreateCircleInput, SavingsCircleInfo,
} from "../types/lending";
import { enumTag, optional, sorobanEnum, toBigInt, toNumber } from "../utils/soroban";

/**
 * SavingsCircle
 *
 * Drives a deployed `savings-circle` Soroban contract — on-chain group
 * savings and lending (ajo / esusu / chama / tontine / VSLA):
 *
 * - **rotating** — each round every member contributes and one member (in
 *   join order) receives the pot.
 * - **pooled** — members save each period, borrow from the pool up to a
 *   multiple of their own savings (repaying a flat fee into the pool), and
 *   withdraw savings plus a share of fees at the end.
 *
 * Stellar-only — pass a `StellarAdapter`; the signer is the member acting.
 *
 * @example
 * ```typescript
 * const circles = new SavingsCircle(adapter, "CCIRCLE...");
 * const { circleId } = await circles.createCircle({
 *   token: usdcSac, mode: "rotating", contribution: 50_0000000n, periodSecs: 7n * 86400n, maxMembers: 10,
 * });
 * // members: await circles.join(circleId); await circles.contribute(circleId);
 * // anyone:  await circles.disburse(circleId);
 * ```
 */
export class SavingsCircle {
  constructor(private readonly _adapter: StellarAdapter, private readonly _address: string) {}

  get address(): string { return this._address; }

  async createCircle(input: CreateCircleInput): Promise<{ circleId: number; txHash: string }> {
    if (input.mode === "pooled" && !input.rounds) throw new Error("Pooled circles need `rounds` (number of saving periods)");
    const organizer = await this._adapter.getSignerAddress();
    const { result, txHash } = await this._adapter.invokeContract<bigint>(this._address, "create_circle", {
      organizer,
      token: input.token,
      mode: sorobanEnum(input.mode === "rotating" ? "Rotating" : "Pooled"),
      contribution: input.contribution,
      period_secs: input.periodSecs,
      max_members: input.maxMembers,
      rounds: input.rounds ?? 0,
      borrow_multiple_bps: input.borrowMultipleBps ?? 0,
      loan_fee_bps: input.loanFeeBps ?? 0,
    });
    return { circleId: toNumber(result), txHash };
  }

  async join(circleId: number): Promise<string> {
    return this._asMember("join", circleId);
  }

  /** Organizer: start with the members joined so far (≥ 2). */
  async startCircle(circleId: number): Promise<string> {
    const organizer = await this._adapter.getSignerAddress();
    return (await this._adapter.invokeContract(this._address, "start_circle", { organizer, circle_id: BigInt(circleId) })).txHash;
  }

  async contribute(circleId: number): Promise<string> {
    return this._asMember("contribute", circleId);
  }

  /** Rotating: pay out the current round (everyone contributed, or deadline passed). */
  async disburse(circleId: number): Promise<{ amount: bigint; txHash: string }> {
    const { result, txHash } = await this._adapter.invokeContract<bigint>(this._address, "disburse", { circle_id: BigInt(circleId) });
    return { amount: toBigInt(result), txHash };
  }

  /** Pooled: borrow against own savings. */
  async borrow(circleId: number, amount: bigint): Promise<string> {
    const member = await this._adapter.getSignerAddress();
    return (await this._adapter.invokeContract(this._address, "borrow", { member, circle_id: BigInt(circleId), amount })).txHash;
  }

  /** Pooled: repay principal + fee. */
  async repay(circleId: number): Promise<{ amount: bigint; txHash: string }> {
    const member = await this._adapter.getSignerAddress();
    const { result, txHash } = await this._adapter.invokeContract<bigint>(this._address, "repay", { member, circle_id: BigInt(circleId) });
    return { amount: toBigInt(result), txHash };
  }

  /** Pooled, after the last period: withdraw savings + fee share. */
  async withdraw(circleId: number): Promise<{ amount: bigint; txHash: string }> {
    const member = await this._adapter.getSignerAddress();
    const { result, txHash } = await this._adapter.invokeContract<bigint>(this._address, "withdraw", { member, circle_id: BigInt(circleId) });
    return { amount: toBigInt(result), txHash };
  }

  async getCircle(circleId: number): Promise<SavingsCircleInfo> {
    const r = await this._adapter.readContract<Record<string, unknown>>(this._address, "get_circle", { circle_id: BigInt(circleId) });
    return {
      id: toNumber(r.id),
      organizer: String(r.organizer),
      token: String(r.token),
      mode: enumTag(r.mode).toLowerCase() as CircleMode,
      contribution: toBigInt(r.contribution),
      periodSecs: toBigInt(r.period_secs),
      maxMembers: toNumber(r.max_members),
      rounds: toNumber(r.rounds),
      members: (r.members as string[]) ?? [],
      status: enumTag(r.status).toLowerCase() as CircleStatus,
      startedAt: toBigInt(r.started_at),
      currentRound: toNumber(r.current_round),
      pot: toBigInt(r.pot),
      borrowMultipleBps: toNumber(r.borrow_multiple_bps),
      loanFeeBps: toNumber(r.loan_fee_bps),
      poolCash: toBigInt(r.pool_cash),
      totalSavings: toBigInt(r.total_savings),
      totalFees: toBigInt(r.total_fees),
      closed: Boolean(r.closed),
    };
  }

  /** Defaults to the signer. */
  async getMember(circleId: number, member?: string): Promise<CircleMemberState> {
    const addr = member ?? await this._adapter.getSignerAddress();
    const r = await this._adapter.readContract<{
      saved: bigint; missed: number; paid_out: boolean; withdrawn: boolean;
      loan: { principal: bigint; fee: bigint; taken_at: bigint };
    }>(this._address, "get_member", { circle_id: BigInt(circleId), member: addr });
    const principal = toBigInt(r.loan?.principal ?? 0n);
    return {
      saved: toBigInt(r.saved),
      missed: toNumber(r.missed),
      paidOut: r.paid_out,
      loan: principal > 0n ? { principal, fee: toBigInt(r.loan.fee), takenAt: toBigInt(r.loan.taken_at) } : null,
      withdrawn: r.withdrawn,
    };
  }

  async currentRecipient(circleId: number): Promise<string | null> {
    return optional(await this._adapter.readContract<string | null>(this._address, "current_recipient", { circle_id: BigInt(circleId) }));
  }

  async borrowLimit(circleId: number, member?: string): Promise<bigint> {
    const addr = member ?? await this._adapter.getSignerAddress();
    return toBigInt(await this._adapter.readContract(this._address, "borrow_limit", { circle_id: BigInt(circleId), member: addr }));
  }

  async currentPeriod(circleId: number): Promise<number> {
    return toNumber(await this._adapter.readContract(this._address, "current_period", { circle_id: BigInt(circleId) }));
  }

  private async _asMember(method: "join" | "contribute", circleId: number): Promise<string> {
    const member = await this._adapter.getSignerAddress();
    return (await this._adapter.invokeContract(this._address, method, { member, circle_id: BigInt(circleId) })).txHash;
  }
}
