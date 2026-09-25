import type { StellarAdapter } from "../adapters/stellar";
import type { FreezeRecord } from "../types/compliance";
import { optional, toBigInt } from "../utils/soroban";

/**
 * CompliancePolicy
 *
 * Drives a deployed `compliance-policy` Soroban contract: issuer-controlled
 * freeze, clawback, and a per-transfer cap for any Ankara fungible token the
 * policy is attached to. Attach it to a token with
 * `AssetRegistry.setCompliancePolicy(policy.address)`.
 *
 * Stellar-only — pass a `StellarAdapter` whose signer is the policy admin.
 *
 * @example
 * ```typescript
 * const policy = new CompliancePolicy(adapter, "CPOLICY...");
 * await new AssetRegistry(adapter, tokenAddress, "invoice").setCompliancePolicy(policy.address);
 *
 * await policy.freeze("GSUSPECT...", "court-order-2026-117");
 * await policy.clawback(tokenAddress, "GSUSPECT...", 5_000n);            // burn
 * await policy.clawback(tokenAddress, "GLOSTKEY...", 100n, "GRECOVERY..."); // move
 * ```
 */
export class CompliancePolicy {
  constructor(private readonly _adapter: StellarAdapter, private readonly _address: string) {}

  get address(): string { return this._address; }

  async freeze(account: string, reason: string): Promise<string> {
    return (await this._adapter.invokeContract(this._address, "freeze", { account, reason })).txHash;
  }

  async unfreeze(account: string): Promise<string> {
    return (await this._adapter.invokeContract(this._address, "unfreeze", { account })).txHash;
  }

  /** `0n` removes the cap. Mints and burns are never capped. */
  async setMaxTransferAmount(amount: bigint): Promise<string> {
    return (await this._adapter.invokeContract(this._address, "set_max_transfer_amount", { amount })).txHash;
  }

  /**
   * Claws `amount` of `token` back from `from`. Burned when `to` is omitted,
   * otherwise moved to `to`. The token must have this policy attached.
   */
  async clawback(token: string, from: string, amount: bigint, to?: string): Promise<string> {
    return (await this._adapter.invokeContract(this._address, "clawback", {
      token, from, amount, to: to ?? undefined,
    })).txHash;
  }

  async isFrozen(account: string): Promise<boolean> {
    return this._adapter.readContract<boolean>(this._address, "is_frozen", { account });
  }

  async getFreezeRecord(account: string): Promise<FreezeRecord | null> {
    const raw = optional(await this._adapter.readContract<{ frozen_at: bigint; reason: string } | null>(
      this._address, "freeze_record", { account }
    ));
    return raw ? { frozenAt: toBigInt(raw.frozen_at), reason: raw.reason } : null;
  }

  async getMaxTransferAmount(): Promise<bigint> {
    return toBigInt(await this._adapter.readContract(this._address, "max_transfer_amount", {}));
  }

  /** Dry-run the policy check a token would make (`from`/`to` `null` = mint/burn). */
  async canTransfer(token: string, from: string | null, to: string | null, amount: bigint): Promise<boolean> {
    return this._adapter.readContract<boolean>(this._address, "can_transfer", {
      token, from: from ?? undefined, to: to ?? undefined, amount,
    });
  }

  async getAdmin(): Promise<string> {
    return this._adapter.readContract<string>(this._address, "admin", {});
  }
}
