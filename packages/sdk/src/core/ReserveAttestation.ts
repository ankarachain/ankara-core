import type { StellarAdapter } from "../adapters/stellar";
import type { PendingReserveRound, ReserveConfig, ReserveReport } from "../types/compliance";
import { hexToBytes32, optional, toBigInt, toHex, toNumber } from "../utils/soroban";

interface RawReport {
  round: bigint;
  amount: bigint;
  timestamp: bigint;
  attestor_count: number;
  report_hash: unknown;
}

/**
 * ReserveAttestation
 *
 * Drives a deployed `reserve-attestation` Soroban contract — on-chain proof
 * of reserve for a reserve-backed asset. Designated attestors post the
 * off-chain reserve balance; once `quorum` of them have submitted for a
 * round, the lowest amount is published. Anyone can check backing before
 * transacting.
 *
 * Stellar-only — pass a `StellarAdapter`.
 *
 * @example
 * ```typescript
 * const reserve = new ReserveAttestation(adapter, "CRESERVE...");
 *
 * // as an attestor:
 * await reserve.submit(1_000_000n * 10n ** 18n, "0x" + sha256OfBankStatement);
 *
 * // anyone:
 * if (!(await reserve.isFullyBacked())) throw new Error("reserve below supply or stale");
 * const bps = await reserve.collateralizationBps(); // 10_000 = exactly 1:1
 * ```
 */
export class ReserveAttestation {
  constructor(private readonly _adapter: StellarAdapter, private readonly _address: string) {}

  get address(): string { return this._address; }

  // ─── Attestor ─────────────────────────────────────────────────────────

  /**
   * Submits the reserve amount for the current round as the signer.
   * `reportHash` is a 32-byte `0x` hex hash of the underlying report.
   * `finalized` is true if this submission reached quorum.
   */
  async submit(amount: bigint, reportHash: string): Promise<{ finalized: boolean; txHash: string }> {
    const attestor = await this._adapter.getSignerAddress();
    const { result, txHash } = await this._adapter.invokeContract<boolean>(this._address, "submit", {
      attestor, amount, report_hash: hexToBytes32(reportHash),
    });
    return { finalized: Boolean(result), txHash };
  }

  // ─── Admin ────────────────────────────────────────────────────────────

  async addAttestor(attestor: string): Promise<string> {
    return (await this._adapter.invokeContract(this._address, "add_attestor", { attestor })).txHash;
  }

  async removeAttestor(attestor: string): Promise<string> {
    return (await this._adapter.invokeContract(this._address, "remove_attestor", { attestor })).txHash;
  }

  async setQuorum(quorum: number): Promise<string> {
    return (await this._adapter.invokeContract(this._address, "set_quorum", { new_quorum: quorum })).txHash;
  }

  async setStalenessThreshold(seconds: bigint): Promise<string> {
    return (await this._adapter.invokeContract(this._address, "set_staleness_threshold", { new_threshold: seconds })).txHash;
  }

  // ─── Reads ────────────────────────────────────────────────────────────

  async latestReport(): Promise<ReserveReport | null> {
    const raw = optional(await this._adapter.readContract<RawReport | null>(this._address, "latest_report", {}));
    return raw ? decodeReport(raw) : null;
  }

  async getReport(round: number): Promise<ReserveReport> {
    return decodeReport(await this._adapter.readContract<RawReport>(this._address, "get_report", { round: BigInt(round) }));
  }

  /** `{ amount, timestamp }`, both `0n` if nothing has been reported yet. */
  async getReserve(): Promise<{ amount: bigint; timestamp: bigint }> {
    const [amount, timestamp] = await this._adapter.readContract<[bigint, bigint]>(this._address, "get_reserve", {});
    return { amount: toBigInt(amount), timestamp: toBigInt(timestamp) };
  }

  async isStale(): Promise<boolean> {
    return this._adapter.readContract<boolean>(this._address, "is_stale", {});
  }

  /** Fresh report AND reserve >= the asset's live total supply. */
  async isFullyBacked(): Promise<boolean> {
    return this._adapter.readContract<boolean>(this._address, "is_fully_backed", {});
  }

  /** Reserve / supply in bps (10_000 = 1:1); `4294967295` when supply is zero. Ignores staleness. */
  async collateralizationBps(): Promise<number> {
    return toNumber(await this._adapter.readContract(this._address, "collateralization_bps", {}));
  }

  async outstandingSupply(): Promise<bigint> {
    return toBigInt(await this._adapter.readContract(this._address, "outstanding_supply", {}));
  }

  async pendingRound(): Promise<PendingReserveRound> {
    const raw = await this._adapter.readContract<{
      round: bigint;
      opened_at: bigint;
      submissions: Map<string, { amount: bigint; report_hash: unknown }> | Record<string, { amount: bigint; report_hash: unknown }>;
    }>(this._address, "pending_round", {});
    const entries = raw.submissions instanceof Map ? [...raw.submissions.entries()] : Object.entries(raw.submissions ?? {});
    return {
      round: toNumber(raw.round),
      openedAt: toBigInt(raw.opened_at),
      submissions: entries.map(([attestor, sub]) => ({
        attestor, amount: toBigInt(sub.amount), reportHash: toHex(sub.report_hash),
      })),
    };
  }

  async getConfig(): Promise<ReserveConfig> {
    const [asset, attestors, quorum, stalenessThreshold] = await Promise.all([
      this._adapter.readContract<string>(this._address, "asset", {}),
      this._adapter.readContract<string[]>(this._address, "attestors", {}),
      this._adapter.readContract<number>(this._address, "quorum", {}),
      this._adapter.readContract<bigint>(this._address, "staleness_threshold", {}),
    ]);
    return { asset, attestors, quorum: toNumber(quorum), stalenessThreshold: toBigInt(stalenessThreshold) };
  }
}

function decodeReport(raw: RawReport): ReserveReport {
  return {
    round: toNumber(raw.round),
    amount: toBigInt(raw.amount),
    timestamp: toBigInt(raw.timestamp),
    attestorCount: toNumber(raw.attestor_count),
    reportHash: toHex(raw.report_hash),
  };
}
