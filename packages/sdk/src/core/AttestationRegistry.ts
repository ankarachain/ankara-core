import type { StellarAdapter } from "../adapters/stellar";
import type { Attestation, AttestationSubject, AttestInput } from "../types/identity";
import {
  assetIdToBytes32, enumTag, enumValues, optional, sorobanEnum, toBigInt, toHex, toNumber,
} from "../utils/soroban";

interface RawAttestation {
  id: bigint;
  subject: unknown;
  claim_type: string;
  attestor: string;
  value: bigint;
  data: string;
  timestamp: bigint;
  expires_at: bigint;
  revoked: boolean;
}

const SYMBOL_RE = /^[a-zA-Z0-9_]{1,32}$/;

/**
 * AttestationRegistry
 *
 * Drives a deployed `attestation-registry` Soroban contract: trusted
 * attestors record typed claims about an account or an asset, and anyone can
 * read the current or historical claims. One primitive for KYC status,
 * land-title chain of custody, delivery/harvest confirmations and
 * credit/reputation signals.
 *
 * The registry also implements the identity-verifier interface, so its
 * address can be used directly as a template's `identity_verifier`: an
 * account is verified when its latest valid `KYC` claim (configurable via
 * `setVerifierClaimType`) has `value > 0`.
 *
 * Stellar-only — pass a `StellarAdapter`.
 *
 * @example
 * ```typescript
 * const registry = new AttestationRegistry(adapter, "CREGISTRY...");
 * await registry.addAttestor("GKYCPROVIDER...");            // admin
 *
 * // as the attestor:
 * const { attestationId } = await registry.attest({
 *   subject: { kind: "asset", assetId: "FARM-OYO-2024-001" },
 *   claimType: "TITLE",
 *   value: 0n,
 *   data: "owner=GBUYER... deed=0xabc...",
 * });
 * const latest = await registry.latest({ kind: "asset", assetId: "FARM-OYO-2024-001" }, "TITLE");
 * ```
 */
export class AttestationRegistry {
  static readonly MAX_PAGE = 50;

  constructor(private readonly _adapter: StellarAdapter, private readonly _address: string) {}

  get address(): string { return this._address; }

  // ─── Admin ────────────────────────────────────────────────────────────

  async addAttestor(attestor: string): Promise<string> {
    return (await this._adapter.invokeContract(this._address, "add_attestor", { attestor })).txHash;
  }

  async removeAttestor(attestor: string): Promise<string> {
    return (await this._adapter.invokeContract(this._address, "remove_attestor", { attestor })).txHash;
  }

  async setVerifierClaimType(claimType: string): Promise<string> {
    checkSymbol(claimType);
    return (await this._adapter.invokeContract(this._address, "set_verifier_claim_type", { claim_type: claimType })).txHash;
  }

  // ─── Attestor actions (signer = attestor) ─────────────────────────────

  async attest(input: AttestInput): Promise<{ attestationId: number; txHash: string }> {
    checkSymbol(input.claimType);
    const attestor = await this._adapter.getSignerAddress();
    const { result, txHash } = await this._adapter.invokeContract<bigint>(this._address, "attest", {
      attestor,
      subject: encodeSubject(input.subject),
      claim_type: input.claimType,
      value: input.value,
      data: input.data ?? "",
      expires_at: input.expiresAt ?? 0n,
    });
    return { attestationId: toNumber(result), txHash };
  }

  /** Revokes a claim — the signer must be the claim's attestor or the registry admin. */
  async revoke(attestationId: number): Promise<string> {
    const caller = await this._adapter.getSignerAddress();
    return (await this._adapter.invokeContract(this._address, "revoke", {
      caller, attestation_id: BigInt(attestationId),
    })).txHash;
  }

  // ─── Reads ────────────────────────────────────────────────────────────

  async getAttestation(attestationId: number): Promise<Attestation> {
    const raw = await this._adapter.readContract<RawAttestation>(this._address, "get_attestation", {
      attestation_id: BigInt(attestationId),
    });
    return decodeAttestation(raw);
  }

  /** Newest claim of this type that is neither revoked nor expired, or `null`. */
  async latest(subject: AttestationSubject, claimType: string): Promise<Attestation | null> {
    const raw = optional(await this._adapter.readContract<RawAttestation | null>(this._address, "latest", {
      subject: encodeSubject(subject), claim_type: claimType,
    }));
    return raw ? decodeAttestation(raw) : null;
  }

  async hasValidClaim(subject: AttestationSubject, claimType: string): Promise<boolean> {
    return this._adapter.readContract<boolean>(this._address, "has_valid_claim", {
      subject: encodeSubject(subject), claim_type: claimType,
    });
  }

  /** Oldest-first page of every claim of this type for the subject, revoked/expired included. */
  async history(subject: AttestationSubject, claimType: string, start = 0, limit = AttestationRegistry.MAX_PAGE): Promise<Attestation[]> {
    if (limit > AttestationRegistry.MAX_PAGE) {
      throw new Error(`limit ${limit} exceeds the contract's page size of ${AttestationRegistry.MAX_PAGE}`);
    }
    const raw = await this._adapter.readContract<RawAttestation[]>(this._address, "history", {
      subject: encodeSubject(subject), claim_type: claimType, start, limit,
    });
    return raw.map(decodeAttestation);
  }

  async claimCount(subject: AttestationSubject, claimType: string): Promise<number> {
    return toNumber(await this._adapter.readContract(this._address, "claim_count", {
      subject: encodeSubject(subject), claim_type: claimType,
    }));
  }

  async attestationCount(): Promise<number> {
    return toNumber(await this._adapter.readContract(this._address, "attestation_count", {}));
  }

  async isAttestor(address: string): Promise<boolean> {
    return this._adapter.readContract<boolean>(this._address, "is_attestor", { attestor: address });
  }

  /** Identity-verifier view: latest valid claim of the verifier claim type has `value > 0`. */
  async isVerified(account: string): Promise<boolean> {
    return this._adapter.readContract<boolean>(this._address, "is_verified", { account });
  }

  async verifierClaimType(): Promise<string> {
    return this._adapter.readContract<string>(this._address, "verifier_claim_type", {});
  }

  async getAdmin(): Promise<string> {
    return this._adapter.readContract<string>(this._address, "admin", {});
  }
}

function checkSymbol(claimType: string): void {
  if (!SYMBOL_RE.test(claimType)) {
    throw new Error(`Invalid claim type "${claimType}" — must be 1-32 chars of [a-zA-Z0-9_]`);
  }
}

export function encodeSubject(subject: AttestationSubject): { tag: string; values?: unknown[] } {
  return subject.kind === "account"
    ? sorobanEnum("Account", subject.address)
    : sorobanEnum("Asset", assetIdToBytes32(subject.assetId));
}

function decodeSubject(raw: unknown): AttestationSubject {
  const [value] = enumValues(raw);
  return enumTag(raw) === "Account"
    ? { kind: "account", address: String(value) }
    : { kind: "asset", assetId: toHex(value) };
}

function decodeAttestation(raw: RawAttestation): Attestation {
  return {
    id: toNumber(raw.id),
    subject: decodeSubject(raw.subject),
    claimType: String(raw.claim_type),
    attestor: raw.attestor,
    value: toBigInt(raw.value),
    data: raw.data,
    timestamp: toBigInt(raw.timestamp),
    expiresAt: toBigInt(raw.expires_at),
    revoked: raw.revoked,
  };
}
