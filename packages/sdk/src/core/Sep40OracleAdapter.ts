import type { StellarAdapter } from "../adapters/stellar";
import type { OracleFeedConfig, OraclePrice, Sep40Asset } from "../types/oracle";
import { enumTag, enumValues, optional, sorobanEnum, toBigInt, toNumber } from "../utils/soroban";

/**
 * Sep40OracleAdapter
 *
 * Drives a deployed `sep40-oracle-adapter` Soroban contract — an
 * `IAnkaraOracle`-compatible wrapper over an external, decentralized SEP-40
 * price feed such as Reflector, with an optional `manual-oracle` fallback for
 * assets the feed doesn't cover. Give its address to
 * `CollateralVault.setOracle()` or a pool vault's `set_oracle` in place of a
 * `manual-oracle` — no contract changes needed.
 *
 * Stellar-only — pass a `StellarAdapter` (admin signer for the setters).
 *
 * @example
 * ```typescript
 * const oracle = new Sep40OracleAdapter(adapter, "CADAPTER...");
 * // price a gold-backed commodity token off the feed's XAU ticker, 5-record TWAP
 * await oracle.setTokenFeed(goldToken, { asset: { kind: "other", symbol: "XAU" }, twapRecords: 5 });
 * const { priceUSD } = await oracle.getPrice(goldToken); // 1e18-scaled USD
 * await new CollateralVault(adapter, vaultAddress).setOracle(oracle.address);
 * ```
 */
export class Sep40OracleAdapter {
  static readonly MAX_TWAP_RECORDS = 20;

  constructor(private readonly _adapter: StellarAdapter, private readonly _address: string) {}

  get address(): string { return this._address; }

  // ─── Admin ────────────────────────────────────────────────────────────

  async setFeed(feedAddress: string): Promise<string> {
    return (await this._adapter.invokeContract(this._address, "set_feed", { feed: feedAddress })).txHash;
  }

  /** `null` removes the fallback. */
  async setFallback(fallbackOracle: string | null): Promise<string> {
    return (await this._adapter.invokeContract(this._address, "set_fallback", { fallback: fallbackOracle ?? undefined })).txHash;
  }

  async setStalenessThreshold(seconds: bigint): Promise<string> {
    return (await this._adapter.invokeContract(this._address, "set_staleness_threshold", { new_threshold: seconds })).txHash;
  }

  /** `null` clears the mapping (token is then looked up as `Stellar(token)`). */
  async setTokenFeed(token: string, config: OracleFeedConfig | null): Promise<string> {
    if (config && (config.twapRecords < 0 || config.twapRecords > Sep40OracleAdapter.MAX_TWAP_RECORDS)) {
      throw new Error(`twapRecords must be 0-${Sep40OracleAdapter.MAX_TWAP_RECORDS}`);
    }
    return (await this._adapter.invokeContract(this._address, "set_token_feed", {
      token,
      config: config ? { asset: encodeAsset(config.asset), twap_records: config.twapRecords } : undefined,
    })).txHash;
  }

  // ─── Reads ────────────────────────────────────────────────────────────

  /** Feed price when fresh, else the fallback's, else whatever the feed has. */
  async getPrice(token: string): Promise<OraclePrice> {
    return decodePrice(await this._adapter.readContract(this._address, "get_price", { token }));
  }

  /** The external feed's own price, ignoring the fallback. */
  async getFeedPrice(token: string): Promise<OraclePrice> {
    return decodePrice(await this._adapter.readContract(this._address, "feed_price", { token }));
  }

  async isStale(token: string): Promise<boolean> {
    return this._adapter.readContract<boolean>(this._address, "is_stale", { token });
  }

  async isUsingFallback(token: string): Promise<boolean> {
    return this._adapter.readContract<boolean>(this._address, "is_using_fallback", { token });
  }

  async getTokenFeed(token: string): Promise<OracleFeedConfig> {
    const raw = await this._adapter.readContract<{ asset: unknown; twap_records: number }>(this._address, "token_feed", { token });
    return { asset: decodeAsset(raw.asset), twapRecords: toNumber(raw.twap_records) };
  }

  async getFeed(): Promise<string> {
    return this._adapter.readContract<string>(this._address, "feed", {});
  }

  async getFeedDecimals(): Promise<number> {
    return toNumber(await this._adapter.readContract(this._address, "feed_decimals", {}));
  }

  async getFallback(): Promise<string | null> {
    return optional(await this._adapter.readContract<string | null>(this._address, "fallback", {}));
  }

  async getStalenessThreshold(): Promise<bigint> {
    return toBigInt(await this._adapter.readContract(this._address, "staleness_threshold", {}));
  }
}

export function encodeAsset(asset: Sep40Asset): { tag: string; values?: unknown[] } {
  return asset.kind === "stellar" ? sorobanEnum("Stellar", asset.address) : sorobanEnum("Other", asset.symbol);
}

function decodeAsset(raw: unknown): Sep40Asset {
  const [value] = enumValues(raw);
  return enumTag(raw) === "Stellar" ? { kind: "stellar", address: String(value) } : { kind: "other", symbol: String(value) };
}

function decodePrice(raw: unknown): OraclePrice {
  const [price, timestamp] = raw as [unknown, unknown];
  return { priceUSD: toBigInt(price), timestamp: toBigInt(timestamp) };
}
