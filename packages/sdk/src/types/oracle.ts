/** A SEP-40 asset identifier: a Stellar asset contract, or an off-chain ticker (`"XAU"`, `"NGN"`). */
export type Sep40Asset =
  | { kind: "stellar"; address: string }
  | { kind: "other"; symbol: string };

/** How one Ankara token is priced on the external feed. */
export interface OracleFeedConfig {
  asset: Sep40Asset;
  /** `0` = spot `lastprice`; `n > 0` = average of the last `n` feed records. */
  twapRecords: number;
}

/** USD price at 1e18 scale and its timestamp (unix seconds) — the `IAnkaraOracle` shape. */
export interface OraclePrice {
  priceUSD: bigint;
  timestamp: bigint;
}
