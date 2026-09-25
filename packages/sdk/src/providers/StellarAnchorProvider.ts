import { StellarToml, Networks } from "@stellar/stellar-sdk";
import { authenticateSep10 } from "./sep10";
import type {
  RampProvider,
  RampQuoteInput,
  RampQuote,
  InitiateOnRampInput,
  InitiateOffRampInput,
  RampSession,
  StellarExternalSigner,
} from "../types";
import { RampSessionStatus } from "../types";

export interface StellarAnchorProviderOptions {
  /** e.g. "cowrie.exchange" — used to fetch the anchor's stellar.toml. */
  homeDomain: string;
  /** Signs the SEP-10 challenge and (for off-ramp) the withdrawal payment — usually a wallet like Freighter. */
  signer: StellarExternalSigner;
  /** Defaults to the public Testnet passphrase; override for a mainnet anchor. */
  networkPassphrase?: string;
}

interface StellarTomlCurrency {
  code?: string;
  issuer?: string;
}

interface StellarTomlInfo {
  WEB_AUTH_ENDPOINT?: string;
  TRANSFER_SERVER_SEP0024?: string;
  ANCHOR_QUOTE_SERVER?: string;
  SIGNING_KEY?: string;
  CURRENCIES?: StellarTomlCurrency[];
  DOCUMENTATION?: { ORG_NAME?: string };
}

/**
 * StellarAnchorProvider
 *
 * A `RampProvider` backed by a real Stellar anchor's SEP-24 interactive
 * deposit/withdrawal flow (SEP-10 for auth, SEP-38 for quotes where the
 * anchor supports it) — this is what "any Stellar anchor becomes compatible
 * with Ankara Chain" actually means: Cowrie, MoneyGram, Bitso, or any other
 * anchor listed in Stellar's directory, addressed purely by home domain.
 *
 * Unlike `ManualRampProvider`'s in-memory map, every method here makes a
 * real HTTP call to the anchor. `getStatus` is a plain single-shot poll —
 * callers are responsible for polling it themselves; this class adds no
 * polling/webhook infrastructure of its own.
 *
 * NOTE: request/response shapes here follow the SEP-10/SEP-24/SEP-38 specs
 * as documented, but have not yet been exercised against a live anchor.
 * Verify against a real testnet anchor before depending on this in
 * production — see the implementation plan for specifics to watch for
 * (SEP-38 asset-identifier format, `client_domain`, anchor-specific status
 * strings beyond the SEP-24 spec's defined set).
 */
export class StellarAnchorProvider implements RampProvider {
  readonly name: string;

  private _homeDomain: string;
  private _signer: StellarExternalSigner;
  private _networkPassphrase: string;
  private _toml?: StellarTomlInfo;
  private _jwt?: { token: string; expiresAt: number };

  constructor(opts: StellarAnchorProviderOptions) {
    this._homeDomain = opts.homeDomain;
    this._signer = opts.signer;
    this._networkPassphrase = opts.networkPassphrase ?? Networks.TESTNET;
    // ORG_NAME would be nicer, but resolving the toml is async and `name` is
    // a synchronous readonly property (same constraint ManualRampProvider's
    // static "manual" name sidesteps) — home domain is a fine stand-in.
    this.name = opts.homeDomain;
  }

  // ─── SEP-1: stellar.toml ────────────────────────────────────────────────

  private async _resolveToml(): Promise<StellarTomlInfo> {
    if (!this._toml) {
      this._toml = (await StellarToml.Resolver.resolve(this._homeDomain)) as StellarTomlInfo;
    }
    return this._toml;
  }

  private _findIssuer(assetCode: string): string | undefined {
    return this._toml?.CURRENCIES?.find((c) => c.code === assetCode)?.issuer;
  }

  // ─── SEP-10: auth ───────────────────────────────────────────────────────

  private async _authenticate(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    if (this._jwt && this._jwt.expiresAt > now + 30) {
      return this._jwt.token;
    }

    const toml = await this._resolveToml();
    if (!toml.WEB_AUTH_ENDPOINT) {
      throw new Error(`Anchor ${this._homeDomain} does not advertise a WEB_AUTH_ENDPOINT (SEP-10) in its stellar.toml`);
    }

    this._jwt = await authenticateSep10({
      webAuthEndpoint: toml.WEB_AUTH_ENDPOINT,
      homeDomain: this._homeDomain,
      signer: this._signer,
      networkPassphrase: this._networkPassphrase,
    });
    return this._jwt.token;
  }

  // ─── SEP-38: quotes (optional — not every anchor implements this) ───────

  async getQuote(input: RampQuoteInput): Promise<RampQuote> {
    const toml = await this._resolveToml();
    if (!toml.ANCHOR_QUOTE_SERVER) {
      throw new Error(
        `Anchor ${this._homeDomain} does not advertise a SEP-38 ANCHOR_QUOTE_SERVER — getQuote() isn't supported here. ` +
        `initiateOnRamp/initiateOffRamp still work; the anchor's own interactive flow will show final pricing.`
      );
    }
    const amount = input.tokenAmount ?? input.fiatAmount;
    if (!amount) {
      throw new Error("getQuote requires either fiatAmount or tokenAmount");
    }
    const jwt = await this._authenticate();
    const issuer = this._findIssuer(input.tokenSymbol);
    const stellarAsset = issuer ? `stellar:${input.tokenSymbol}:${issuer}` : `stellar:${input.tokenSymbol}`;
    const fiatAsset = `iso4217:${input.fiatCurrency}`;
    const [sellAsset, buyAsset] = input.direction === "off-ramp"
      ? [stellarAsset, fiatAsset]
      : [fiatAsset, stellarAsset];

    // `context` is a required SEP-38 param (confirmed against a real anchor,
    // which 400s without it — not documented as required-feeling from the
    // spec text alone) identifying which downstream flow the quote feeds
    // into; "sep24" matches this provider's own interactive flow below.
    // Anchors that don't support sep24-context quotes will 400 with their
    // own message naming what they do support — surfaced as-is, not guessed
    // around.
    const params = new URLSearchParams({ context: "sep24", sell_asset: sellAsset, buy_asset: buyAsset, sell_amount: amount });
    const res = await fetch(`${toml.ANCHOR_QUOTE_SERVER}/price?${params.toString()}`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    if (!res.ok) {
      throw new Error(`SEP-38 price request to ${this._homeDomain} failed: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as { price: string; sell_amount: string; buy_amount: string };

    const fiatAmount = input.direction === "off-ramp" ? data.buy_amount : data.sell_amount;
    const tokenAmount = input.direction === "off-ramp" ? data.sell_amount : data.buy_amount;
    return {
      direction: input.direction,
      fiatCurrency: input.fiatCurrency,
      fiatAmount,
      tokenAmount,
      tokenSymbol: input.tokenSymbol,
      exchangeRate: data.price,
      feeFiat: "0", // SEP-38 fees are embedded in `price`, not broken out separately
      expiresAt: Math.floor(Date.now() / 1000) + 300,
    };
  }

  // ─── SEP-24: interactive deposit/withdrawal ─────────────────────────────

  async initiateOnRamp(input: InitiateOnRampInput): Promise<RampSession> {
    return this._interactive("deposit", {
      asset_code: input.tokenSymbol,
      account: input.recipientAddress,
      amount: input.fiatAmount,
    });
  }

  async initiateOffRamp(input: InitiateOffRampInput): Promise<RampSession> {
    return this._interactive("withdraw", {
      asset_code: input.tokenSymbol,
      account: this._signer.publicKey,
      amount: input.tokenAmount,
    });
  }

  /** Single-shot poll of the anchor's `/transaction` endpoint — callers own any polling loop. */
  async getStatus(sessionId: string): Promise<RampSessionStatus> {
    const toml = await this._resolveToml();
    if (!toml.TRANSFER_SERVER_SEP0024) {
      throw new Error(`Anchor ${this._homeDomain} does not advertise a TRANSFER_SERVER_SEP0024 endpoint in its stellar.toml`);
    }
    const jwt = await this._authenticate();
    const res = await fetch(`${toml.TRANSFER_SERVER_SEP0024}/transaction?id=${encodeURIComponent(sessionId)}`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    if (!res.ok) {
      throw new Error(`SEP-24 status request to ${this._homeDomain} failed: ${res.status} ${await res.text()}`);
    }
    const { transaction } = (await res.json()) as { transaction: { status: string } };
    return mapAnchorStatus(transaction.status);
  }

  private async _interactive(
    kind: "deposit" | "withdraw",
    params: Record<string, string | undefined>
  ): Promise<RampSession> {
    const toml = await this._resolveToml();
    if (!toml.TRANSFER_SERVER_SEP0024) {
      throw new Error(`Anchor ${this._homeDomain} does not advertise a TRANSFER_SERVER_SEP0024 endpoint in its stellar.toml`);
    }
    const jwt = await this._authenticate();

    // SEP-24's interactive endpoints require multipart/form-data (confirmed
    // against a real anchor, which 500s on urlencoded bodies with a message
    // naming the expected content type) — not urlencoded, unlike the rest of
    // this file's plain JSON/urlencoded requests. Fetch sets the multipart
    // boundary itself from the FormData body; don't set Content-Type manually.
    const body = new FormData();
    for (const [key, value] of Object.entries(params)) {
      if (value != null) body.set(key, value);
    }
    const res = await fetch(`${toml.TRANSFER_SERVER_SEP0024}/transactions/${kind}/interactive`, {
      method: "POST",
      headers: { Authorization: `Bearer ${jwt}` },
      body,
    });
    if (!res.ok) {
      throw new Error(`SEP-24 ${kind} request to ${this._homeDomain} failed: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as { type: string; url: string; id: string };

    return {
      sessionId: data.id,
      direction: kind === "deposit" ? "on-ramp" : "off-ramp",
      status: RampSessionStatus.PENDING,
      providerRef: data.id,
      paymentUrl: data.url,
      createdAt: Math.floor(Date.now() / 1000),
    };
  }
}

/**
 * Maps the SEP-24 spec's defined transaction status strings to
 * `RampSessionStatus`. Individual anchors sometimes add extra statuses
 * beyond the spec's defined set — those fall through to PROCESSING as a
 * safe default rather than throwing, since "still in progress" is the
 * correct interpretation for an unrecognized-but-non-terminal status.
 */
function mapAnchorStatus(status: string): RampSessionStatus {
  switch (status) {
    case "incomplete":
    case "pending_user_transfer_start":
      return RampSessionStatus.PENDING;
    case "completed":
      return RampSessionStatus.SETTLED;
    case "refunded":
      return RampSessionStatus.REFUNDED;
    case "error":
    case "expired":
    case "no_market":
    case "too_small":
    case "too_large":
      return RampSessionStatus.FAILED;
    default:
      return RampSessionStatus.PROCESSING;
  }
}
