import { createHmac, randomUUID } from "node:crypto";
import type {
  RampProvider,
  RampQuoteInput,
  RampQuote,
  InitiateOnRampInput,
  InitiateOffRampInput,
  RampSession,
} from "../types";
import { RampSessionStatus } from "../types";

export interface MoonPayProviderOptions {
  /** Publishable key (pk_test_.../pk_live_...). */
  apiKey: string;
  /** Secret key (sk_test_.../sk_live_...) — signs widget URLs and authenticates REST calls. Never expose this to a browser. */
  secretKey: string;
  /** Defaults to true (sandbox). Set false once you have live keys. */
  sandbox?: boolean;
}

const API_BASE = "https://api.moonpay.com";

/**
 * MoonPayProvider
 *
 * A RampProvider backed by MoonPay's real widget + REST API — fiat on-ramp
 * (buy) and off-ramp (sell) in 160+ countries.
 *
 * **Server-side only.** `secretKey` signs widget URLs (HMAC-SHA256 over the
 * query string, per MoonPay's own documented Node.js example) and
 * authenticates REST calls (`X-Api-Key` header) — never construct this in a
 * browser context. In the Ankara dashboard this runs inside a Route
 * Handler, not a client page component (unlike StellarAnchorProvider, which
 * signs with the user's own wallet and has no shared secret to protect).
 *
 * `getQuote`/`getStatus`'s exact response field names follow MoonPay's
 * documented endpoints and status values as closely as could be confirmed
 * without a live sandbox call (no credentials were available at
 * implementation time) — verify against a real sandbox account before
 * depending on this in production, same caveat as StellarAnchorProvider.
 * Widget URL construction (initiateOnRamp/initiateOffRamp) is grounded in
 * MoonPay's documented, verbatim signing example and is higher-confidence.
 */
export class MoonPayProvider implements RampProvider {
  readonly name = "moonpay";

  private _apiKey: string;
  private _secretKey: string;
  private _sandbox: boolean;

  constructor(opts: MoonPayProviderOptions) {
    this._apiKey = opts.apiKey;
    this._secretKey = opts.secretKey;
    this._sandbox = opts.sandbox ?? true;
  }

  private _sign(query: URLSearchParams): string {
    const search = `?${query.toString()}`;
    return createHmac("sha256", this._secretKey).update(search).digest("base64");
  }

  private _widgetBase(kind: "buy" | "sell"): string {
    const domain = this._sandbox ? `${kind}-sandbox.moonpay.com` : `${kind}.moonpay.com`;
    return `https://${domain}`;
  }

  async getQuote(input: RampQuoteInput): Promise<RampQuote> {
    const currencyCode = input.tokenSymbol.toLowerCase();
    const endpoint = input.direction === "off-ramp" ? "sell_quote" : "buy_quote";
    const params = new URLSearchParams({ apiKey: this._apiKey });
    if (input.direction === "off-ramp") {
      params.set("quoteCurrencyCode", input.fiatCurrency.toLowerCase());
      if (input.tokenAmount) params.set("baseCurrencyAmount", input.tokenAmount);
    } else {
      params.set("baseCurrencyCode", input.fiatCurrency.toLowerCase());
      if (input.fiatAmount) params.set("baseCurrencyAmount", input.fiatAmount);
      if (input.tokenAmount) params.set("quoteCurrencyAmount", input.tokenAmount);
    }

    const res = await fetch(`${API_BASE}/v3/currencies/${currencyCode}/${endpoint}?${params.toString()}`, {
      headers: { "X-Api-Key": this._secretKey },
    });
    if (!res.ok) {
      throw new Error(`MoonPay ${endpoint} request failed: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as Record<string, unknown>;

    // Field names below follow MoonPay's documented quote shape as closely
    // as could be confirmed without a live sandbox call — see class doc.
    const quoteCurrencyAmount = String(data.quoteCurrencyAmount ?? data.baseCurrencyAmount ?? "0");
    const baseCurrencyAmount = String(data.baseCurrencyAmount ?? data.totalAmount ?? "0");
    const feeAmount = String(data.feeAmount ?? data.extraFeeAmount ?? "0");
    const rate = String(data.quoteCurrencyPrice ?? data.marketQuoteCurrencyPrice ?? "0");

    return {
      direction: input.direction,
      fiatCurrency: input.fiatCurrency,
      fiatAmount: input.direction === "off-ramp" ? quoteCurrencyAmount : baseCurrencyAmount,
      tokenAmount: input.direction === "off-ramp" ? baseCurrencyAmount : quoteCurrencyAmount,
      tokenSymbol: input.tokenSymbol,
      exchangeRate: rate,
      feeFiat: feeAmount,
      expiresAt: Math.floor(Date.now() / 1000) + 300,
    };
  }

  async initiateOnRamp(input: InitiateOnRampInput): Promise<RampSession> {
    const externalTransactionId = input.customerReference ?? randomUUID();
    const params = new URLSearchParams({
      apiKey: this._apiKey,
      currencyCode: input.tokenSymbol.toLowerCase(),
      walletAddress: input.recipientAddress,
      baseCurrencyCode: input.fiatCurrency.toLowerCase(),
      baseCurrencyAmount: input.fiatAmount,
      externalTransactionId,
    });
    const signature = this._sign(params);
    const url = `${this._widgetBase("buy")}?${params.toString()}&signature=${encodeURIComponent(signature)}`;

    return {
      sessionId: externalTransactionId,
      direction: "on-ramp",
      status: RampSessionStatus.PENDING,
      providerRef: externalTransactionId,
      paymentUrl: url,
      createdAt: Math.floor(Date.now() / 1000),
    };
  }

  async initiateOffRamp(input: InitiateOffRampInput): Promise<RampSession> {
    const externalTransactionId = input.customerReference ?? randomUUID();
    const params = new URLSearchParams({
      apiKey: this._apiKey,
      baseCurrencyCode: input.tokenSymbol.toLowerCase(),
      quoteCurrencyCode: input.fiatCurrency.toLowerCase(),
      baseCurrencyAmount: input.tokenAmount,
      externalTransactionId,
    });
    // input.payoutAccount (bank details) isn't passed through the widget
    // URL — MoonPay collects payout details in its own hosted flow for
    // compliance reasons; there's no documented param for pre-filling raw
    // account numbers.
    const signature = this._sign(params);
    const url = `${this._widgetBase("sell")}?${params.toString()}&signature=${encodeURIComponent(signature)}`;

    return {
      sessionId: externalTransactionId,
      direction: "off-ramp",
      status: RampSessionStatus.PENDING,
      providerRef: externalTransactionId,
      paymentUrl: url,
      createdAt: Math.floor(Date.now() / 1000),
    };
  }

  async getStatus(sessionId: string): Promise<RampSessionStatus> {
    // No stored record here of which direction this session was — try the
    // sell-by-external-id endpoint (a single confirmed direct lookup) first,
    // then fall back to the buy list-with-filter endpoint. RampManager (see
    // withProviders() in core/RampManager.ts) avoids this ambiguity by
    // tracking direction per session itself; this fallback only matters
    // when MoonPayProvider is used standalone, outside RampManager.
    const sellRes = await fetch(`${API_BASE}/v3/sell_transactions/ext/${encodeURIComponent(sessionId)}`, {
      headers: { "X-Api-Key": this._secretKey },
    });
    if (sellRes.ok) {
      const sellTxs = (await sellRes.json()) as Array<{ status: string }>;
      if (sellTxs.length > 0) return mapMoonPayStatus(sellTxs[0].status);
    }

    const buyRes = await fetch(`${API_BASE}/v1/transactions?externalTransactionId=${encodeURIComponent(sessionId)}`, {
      headers: { "X-Api-Key": this._secretKey },
    });
    if (!buyRes.ok) {
      throw new Error(`MoonPay status lookup for ${sessionId} failed: ${buyRes.status} ${await buyRes.text()}`);
    }
    const buyTxs = (await buyRes.json()) as Array<{ status: string }>;
    if (buyTxs.length === 0) {
      throw new Error(`No MoonPay transaction found for reference ${sessionId}`);
    }
    return mapMoonPayStatus(buyTxs[0].status);
  }
}

/** MoonPay's documented status values: waitingPayment, pending, waitingAuthorization, failed, completed. */
function mapMoonPayStatus(status: string): RampSessionStatus {
  switch (status) {
    case "completed":
      return RampSessionStatus.SETTLED;
    case "failed":
      return RampSessionStatus.FAILED;
    case "waitingPayment":
    case "waitingAuthorization":
      return RampSessionStatus.PENDING;
    case "pending":
      return RampSessionStatus.PROCESSING;
    default:
      return RampSessionStatus.PROCESSING;
  }
}
