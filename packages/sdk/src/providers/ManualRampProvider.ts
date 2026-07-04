import type {
  RampProvider,
  RampQuoteInput,
  RampQuote,
  InitiateOnRampInput,
  InitiateOffRampInput,
  RampSession,
  RampDirection,
} from "../types";
import { RampSessionStatus } from "../types";

export interface ManualRampProviderOptions {
  /** fiatCurrency -> tokens per 1 unit of fiat, e.g. { NGN: 1 / 1500 } */
  exchangeRates?: Record<string, number>;
  /** Flat fee in basis points applied to the fiat amount. Defaults to 100 (1%). */
  feeBps?: number;
}

/**
 * ManualRampProvider
 *
 * Reference RampProvider implementation for local development and testing —
 * no real payment processing happens. Quotes are computed from exchange rates
 * you configure; sessions only change status when you call markSettled() or
 * markFailed() yourself, mirroring ManualOracle's manually-driven design for
 * the on-chain price-feed layer.
 *
 * Swap this out for a real provider adapter (Yellow Card, Flutterwave,
 * Transak, etc.) implementing the same RampProvider interface in production.
 */
export class ManualRampProvider implements RampProvider {
  readonly name = "manual";

  private _sessions = new Map<string, RampSession>();
  private _nextId = 1;
  private _exchangeRates: Map<string, number>;
  private _feeBps: number;

  constructor(opts: ManualRampProviderOptions = {}) {
    this._exchangeRates = new Map(
      Object.entries(opts.exchangeRates ?? { NGN: 1 / 1500, KES: 1 / 150, GHS: 1 / 15 })
    );
    this._feeBps = opts.feeBps ?? 100;
  }

  async getQuote(input: RampQuoteInput): Promise<RampQuote> {
    const rate = this._exchangeRates.get(input.fiatCurrency) ?? 1;

    let fiatAmount: number;
    let tokenAmount: number;

    if (input.fiatAmount != null) {
      fiatAmount = parseFloat(input.fiatAmount);
      tokenAmount = fiatAmount * rate;
    } else if (input.tokenAmount != null) {
      tokenAmount = parseFloat(input.tokenAmount);
      fiatAmount = tokenAmount / rate;
    } else {
      throw new Error("getQuote requires either fiatAmount or tokenAmount");
    }

    const feeFiat = (fiatAmount * this._feeBps) / 10_000;

    return {
      direction: input.direction,
      fiatCurrency: input.fiatCurrency,
      fiatAmount: fiatAmount.toFixed(2),
      tokenAmount: tokenAmount.toFixed(6),
      tokenSymbol: input.tokenSymbol,
      exchangeRate: rate.toString(),
      feeFiat: feeFiat.toFixed(2),
      expiresAt: Math.floor(Date.now() / 1000) + 300,
    };
  }

  async initiateOnRamp(_input: InitiateOnRampInput): Promise<RampSession> {
    return this._createSession("on-ramp");
  }

  async initiateOffRamp(_input: InitiateOffRampInput): Promise<RampSession> {
    return this._createSession("off-ramp");
  }

  async getStatus(sessionId: string): Promise<RampSessionStatus> {
    return this._get(sessionId).status;
  }

  /** Dev/test only — manually mark a session settled, as if the provider confirmed payment. */
  markSettled(sessionId: string): void {
    this._get(sessionId).status = RampSessionStatus.SETTLED;
  }

  /** Dev/test only — manually mark a session failed. */
  markFailed(sessionId: string): void {
    this._get(sessionId).status = RampSessionStatus.FAILED;
  }

  private _get(sessionId: string): RampSession {
    const session = this._sessions.get(sessionId);
    if (!session) throw new Error(`Unknown session: ${sessionId}`);
    return session;
  }

  private _createSession(direction: RampDirection): RampSession {
    const sessionId = `manual-${this._nextId++}`;
    const session: RampSession = {
      sessionId,
      direction,
      status: RampSessionStatus.PENDING,
      providerRef: sessionId,
      paymentUrl: direction === "on-ramp" ? `https://manual.local/pay/${sessionId}` : undefined,
      createdAt: Math.floor(Date.now() / 1000),
    };
    this._sessions.set(sessionId, session);
    return session;
  }
}
