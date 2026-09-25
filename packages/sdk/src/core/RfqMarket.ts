import type { StellarAdapter } from "../adapters/stellar";
import type { PostIntentInput, RfqIntent, RfqIntentStatus, RfqQuote, RfqQuoteStatus } from "../types/rwa";
import { enumTag, optional, toBigInt, toNumber } from "../utils/soroban";

interface RawIntent {
  id: bigint; seller: string; asset_token: string; amount: bigint; quote_token: string;
  min_total_price: bigint; expires_at: bigint; status: unknown; created_at: bigint; accepted_quote?: bigint | null;
}
interface RawQuote {
  id: bigint; intent_id: bigint; buyer: string; total_price: bigint; expires_at: bigint; status: unknown; created_at: bigint;
}

/**
 * RfqMarket
 *
 * Drives a deployed `rfq-market` Soroban contract — request-for-quote / OTC
 * secondary trading for illiquid RWA tokens (a single farm, invoice or
 * building, which will never have AMM depth). The seller escrows tokens in an
 * intent, buyers post fully-funded quotes, and the seller accepts one;
 * settlement is atomic.
 *
 * Stellar-only — pass a `StellarAdapter`; the signer acts as seller or buyer.
 *
 * @example
 * ```typescript
 * const rfq = new RfqMarket(sellerAdapter, "CRFQ...");
 * const { intentId } = await rfq.postIntent({ assetToken: farmToken, amount: 400n, quoteToken: usdcSac, expiresAt: inOneWeek });
 * // buyer:  await new RfqMarket(buyerAdapter, "CRFQ...").submitQuote(intentId, 15_000_0000000n, inOneDay);
 * const quotes = await rfq.getQuotes(intentId);
 * await rfq.acceptQuote(intentId, quotes[0].id);
 * ```
 */
export class RfqMarket {
  constructor(private readonly _adapter: StellarAdapter, private readonly _address: string) {}

  get address(): string { return this._address; }

  // ─── Seller ───────────────────────────────────────────────────────────

  async postIntent(input: PostIntentInput): Promise<{ intentId: number; txHash: string }> {
    if (input.amount <= 0n) throw new Error("amount must be positive");
    const seller = await this._adapter.getSignerAddress();
    const { result, txHash } = await this._adapter.invokeContract<bigint>(this._address, "post_intent", {
      seller,
      asset_token: input.assetToken,
      amount: input.amount,
      quote_token: input.quoteToken,
      min_total_price: input.minTotalPrice ?? 0n,
      expires_at: input.expiresAt,
    });
    return { intentId: toNumber(result), txHash };
  }

  async acceptQuote(intentId: number, quoteId: number): Promise<string> {
    const seller = await this._adapter.getSignerAddress();
    return (await this._adapter.invokeContract(this._address, "accept_quote", {
      seller, intent_id: BigInt(intentId), quote_id: BigInt(quoteId),
    })).txHash;
  }

  async cancelIntent(intentId: number): Promise<string> {
    const seller = await this._adapter.getSignerAddress();
    return (await this._adapter.invokeContract(this._address, "cancel_intent", { seller, intent_id: BigInt(intentId) })).txHash;
  }

  // ─── Buyer ────────────────────────────────────────────────────────────

  /** Escrows `totalPrice` of the intent's quote token with the quote. */
  async submitQuote(intentId: number, totalPrice: bigint, expiresAt: bigint): Promise<{ quoteId: number; txHash: string }> {
    const buyer = await this._adapter.getSignerAddress();
    const { result, txHash } = await this._adapter.invokeContract<bigint>(this._address, "submit_quote", {
      buyer, intent_id: BigInt(intentId), total_price: totalPrice, expires_at: expiresAt,
    });
    return { quoteId: toNumber(result), txHash };
  }

  async withdrawQuote(quoteId: number): Promise<string> {
    const buyer = await this._adapter.getSignerAddress();
    return (await this._adapter.invokeContract(this._address, "withdraw_quote", { buyer, quote_id: BigInt(quoteId) })).txHash;
  }

  // ─── Reads ────────────────────────────────────────────────────────────

  async getIntent(intentId: number): Promise<RfqIntent> {
    const r = await this._adapter.readContract<RawIntent>(this._address, "get_intent", { intent_id: BigInt(intentId) });
    const accepted = optional(r.accepted_quote);
    return {
      id: toNumber(r.id),
      seller: r.seller,
      assetToken: r.asset_token,
      amount: toBigInt(r.amount),
      quoteToken: r.quote_token,
      minTotalPrice: toBigInt(r.min_total_price),
      expiresAt: toBigInt(r.expires_at),
      status: enumTag(r.status).toLowerCase() as RfqIntentStatus,
      createdAt: toBigInt(r.created_at),
      acceptedQuote: accepted === null ? null : toNumber(accepted),
    };
  }

  async getQuote(quoteId: number): Promise<RfqQuote> {
    return decodeQuote(await this._adapter.readContract<RawQuote>(this._address, "get_quote", { quote_id: BigInt(quoteId) }));
  }

  /** All quotes ever posted on an intent, with their current status. */
  async getQuotes(intentId: number): Promise<RfqQuote[]> {
    const ids = await this._adapter.readContract<bigint[]>(this._address, "quotes_for", { intent_id: BigInt(intentId) });
    return Promise.all(ids.map((id) => this.getQuote(toNumber(id))));
  }

  async intentsForToken(assetToken: string): Promise<number[]> {
    return (await this._adapter.readContract<bigint[]>(this._address, "intents_for_token", { asset_token: assetToken })).map(toNumber);
  }

  async getFee(): Promise<{ feeBps: number; feeRecipient: string }> {
    const [feeBps, feeRecipient] = await Promise.all([
      this._adapter.readContract(this._address, "fee_bps", {}),
      this._adapter.readContract<string>(this._address, "fee_recipient", {}),
    ]);
    return { feeBps: toNumber(feeBps), feeRecipient };
  }

  // ─── Admin ────────────────────────────────────────────────────────────

  async setFee(feeBps: number, feeRecipient: string): Promise<string> {
    if (feeBps < 0 || feeBps > 500) throw new Error("feeBps must be 0-500");
    return (await this._adapter.invokeContract(this._address, "set_fee", { fee_bps: feeBps, fee_recipient: feeRecipient })).txHash;
  }
}

function decodeQuote(r: RawQuote): RfqQuote {
  return {
    id: toNumber(r.id),
    intentId: toNumber(r.intent_id),
    buyer: r.buyer,
    totalPrice: toBigInt(r.total_price),
    expiresAt: toBigInt(r.expires_at),
    status: enumTag(r.status).toLowerCase() as RfqQuoteStatus,
    createdAt: toBigInt(r.created_at),
  };
}
