import { hash } from "@stellar/stellar-sdk";

/**
 * Small encode/decode helpers shared by the Stellar-only SDK classes that
 * drive contracts through `StellarAdapter.invokeContract`/`readContract`
 * (identity, reserve attestation, payments, lending, insurance, ...).
 *
 * The dynamic `contract.Client` encodes/decodes values from the on-chain
 * spec, so most arguments pass straight through (addresses as strings,
 * i128/u64 as bigint, u32 as number, `Symbol`/`String` as string). These
 * helpers only cover the shapes that need massaging.
 */

/** Encodes a Soroban `#[contracttype] enum` variant: `{ tag, values }` for tuple variants, `{ tag }` for unit ones. */
export function sorobanEnum(tag: string, ...values: unknown[]): { tag: string; values?: unknown[] } {
  return values.length ? { tag, values } : { tag };
}

/** Reads the variant name off a decoded Soroban enum (`{ tag: "Open" }` -> `"Open"`). */
export function enumTag(raw: unknown): string {
  if (typeof raw === "object" && raw !== null && "tag" in raw) return String((raw as { tag: unknown }).tag);
  return String(raw);
}

/** Reads the tuple payload off a decoded Soroban enum variant. */
export function enumValues(raw: unknown): unknown[] {
  if (typeof raw === "object" && raw !== null && "values" in raw) {
    return ((raw as { values?: unknown[] }).values ?? []) as unknown[];
  }
  return [];
}

/** `0x`-prefixed lowercase hex of a decoded `Bytes`/`BytesN` value. */
export function toHex(bytes: unknown): string {
  return "0x" + Buffer.from(bytes as ArrayLike<number>).toString("hex");
}

/** Decodes a `0x`-prefixed (or bare) 64-char hex string into 32 raw bytes. */
export function hexToBytes32(hex: string): Buffer {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (!/^[0-9a-fA-F]{64}$/.test(clean)) {
    throw new Error(`Expected 32 bytes of hex, got "${hex}"`);
  }
  return Buffer.from(clean, "hex");
}

/**
 * Same derivation `StellarAdapter` uses for template `asset_id`s (SHA-256 of
 * the UTF-8 asset ID string), so a claim/record keyed by asset lines up with
 * the asset deployed under that ID. A value that is already 32 bytes of hex
 * (`0x` + 64 hex chars) is used as-is.
 */
export function assetIdToBytes32(assetId: string): Buffer {
  if (/^0x[0-9a-fA-F]{64}$/.test(assetId)) return hexToBytes32(assetId);
  return hash(Buffer.from(assetId, "utf-8"));
}

/** Soroban `Option<T>` decodes to `undefined` (or `null`); normalizes both to `null`. */
export function optional<T>(raw: T | null | undefined): T | null {
  return raw === undefined || raw === null ? null : raw;
}

/** u32/u64/i128 values may come back as number or bigint depending on width. */
export function toBigInt(raw: unknown): bigint {
  return typeof raw === "bigint" ? raw : BigInt(raw as number | string);
}

export function toNumber(raw: unknown): number {
  return typeof raw === "bigint" ? Number(raw) : Number(raw as number | string);
}
