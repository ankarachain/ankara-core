/** On-chain `VerificationRecord` from `whitelist-verifier`. */
export interface VerificationRecord {
  /** Ledger timestamp (seconds) the account was verified at. */
  verifiedAt: bigint;
  /** Ledger timestamp (seconds) the verification lapses at; `0n` = never. */
  expiresAt: bigint;
}

/**
 * What an attestation is about. `asset` takes the same human-readable asset
 * ID string passed to `TokenFactory.deploy*({ assetId })` (hashed the same
 * way), or a raw `0x`-prefixed 32-byte hex asset ID.
 */
export type AttestationSubject =
  | { kind: "account"; address: string }
  | { kind: "asset"; assetId: string };

/** On-chain `Attestation` from `attestation-registry`. */
export interface Attestation {
  id: number;
  /** Asset subjects come back with `assetId` as `0x` hex (the on-chain bytes). */
  subject: AttestationSubject;
  /** e.g. `"KYC"`, `"TITLE"`, `"DELIVERY"`, `"CREDIT"`. */
  claimType: string;
  attestor: string;
  value: bigint;
  data: string;
  timestamp: bigint;
  /** `0n` = never expires. */
  expiresAt: bigint;
  revoked: boolean;
}

export interface AttestInput {
  subject: AttestationSubject;
  /** Soroban `Symbol`: up to 32 chars of `[a-zA-Z0-9_]`. */
  claimType: string;
  value: bigint;
  /** Free-form payload — a document hash, registry reference, URI, or small JSON blob. */
  data?: string;
  /** Unix seconds; omit or `0n` for "never expires". */
  expiresAt?: bigint;
}
