import type { StellarAdapter } from "../adapters/stellar";
import type { VerificationRecord } from "../types/identity";
import { optional, toBigInt } from "../utils/soroban";

/**
 * WhitelistVerifier
 *
 * Drives a deployed `whitelist-verifier` Soroban contract — the reference,
 * deployable implementation of the `IdentityVerifierInterface` every
 * template's `identity_verifier` slot calls. Point a token at it with
 * `AssetRegistry.setIdentityVerifier(verifier.address)` (or pass it as
 * `verifierAddress` at deploy time), then manage the allow-list here.
 *
 * Stellar-only — pass a `StellarAdapter` whose signer holds the verifier's
 * admin role for the write methods.
 *
 * @example
 * ```typescript
 * const verifier = new WhitelistVerifier(adapter, "CVERIFIER...");
 * await verifier.verify("GALICE...");
 * await verifier.verifyUntil("GBOB...", BigInt(Math.floor(Date.now() / 1000) + 365 * 86400));
 * await verifier.isVerified("GALICE..."); // true
 * ```
 */
export class WhitelistVerifier {
  static readonly MAX_BATCH = 50;

  constructor(private readonly _adapter: StellarAdapter, private readonly _address: string) {}

  get address(): string { return this._address; }

  // ─── Writes (verifier admin) ──────────────────────────────────────────

  async verify(account: string): Promise<string> {
    return (await this._adapter.invokeContract(this._address, "verify", { account })).txHash;
  }

  /** Verifies `account` until `expiresAt` (unix seconds). */
  async verifyUntil(account: string, expiresAt: bigint): Promise<string> {
    return (await this._adapter.invokeContract(this._address, "verify_until", {
      account, expires_at: expiresAt,
    })).txHash;
  }

  async revoke(account: string): Promise<string> {
    return (await this._adapter.invokeContract(this._address, "revoke", { account })).txHash;
  }

  /** Up to 50 accounts per call (the contract rejects larger batches). */
  async batchVerify(accounts: string[]): Promise<string> {
    this._checkBatch(accounts);
    return (await this._adapter.invokeContract(this._address, "batch_verify", { accounts })).txHash;
  }

  async batchRevoke(accounts: string[]): Promise<string> {
    this._checkBatch(accounts);
    return (await this._adapter.invokeContract(this._address, "batch_revoke", { accounts })).txHash;
  }

  async transferAdmin(newAdmin: string): Promise<string> {
    return (await this._adapter.invokeContract(this._address, "transfer_admin", { new_admin: newAdmin })).txHash;
  }

  // ─── Reads ────────────────────────────────────────────────────────────

  async isVerified(account: string): Promise<boolean> {
    return this._adapter.readContract<boolean>(this._address, "is_verified", { account });
  }

  async getRecord(account: string): Promise<VerificationRecord | null> {
    const raw = optional(await this._adapter.readContract<{ verified_at: bigint; expires_at: bigint } | null>(
      this._address, "get_record", { account }
    ));
    return raw ? { verifiedAt: toBigInt(raw.verified_at), expiresAt: toBigInt(raw.expires_at) } : null;
  }

  async getAdmin(): Promise<string> {
    return this._adapter.readContract<string>(this._address, "admin", {});
  }

  async verifierName(): Promise<string> {
    return this._adapter.readContract<string>(this._address, "verifier_name", {});
  }

  private _checkBatch(accounts: string[]): void {
    if (accounts.length > WhitelistVerifier.MAX_BATCH) {
      throw new Error(`Batch of ${accounts.length} exceeds the contract's limit of ${WhitelistVerifier.MAX_BATCH} accounts per call`);
    }
  }
}
