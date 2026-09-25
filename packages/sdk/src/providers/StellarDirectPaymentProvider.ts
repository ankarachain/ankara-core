import { Asset, BASE_FEE, Horizon, Memo, Networks, Operation, StellarToml, TransactionBuilder } from "@stellar/stellar-sdk";
import type {
  RampProvider,
  RampQuoteInput,
  RampQuote,
  InitiateOnRampInput,
  InitiateOffRampInput,
  RampSession,
  RampPaymentInstructions,
  StellarExternalSigner,
} from "../types";
import { RampSessionStatus } from "../types";
import { authenticateSep10 } from "./sep10";

export interface StellarDirectPaymentProviderOptions {
  /** Receiving anchor's home domain, e.g. "receiving-anchor.example" — used to fetch its stellar.toml. */
  homeDomain: string;
  /** The sending account: signs SEP-10 and (with `autoPay`) the on-chain payment to the receiving anchor. */
  signer: StellarExternalSigner;
  /** SEP-12 customer ID of the sender (your business / the paying customer), already registered with the receiving anchor. */
  senderId: string;
  /**
   * When true (default), `initiateOffRamp` also submits the Stellar payment
   * to the anchor's `stellar_account_id` with the required memo, making the
   * whole flow non-interactive. Set false to only create the transaction and
   * return `paymentInstructions` for the caller to pay (e.g. from a custody
   * system or the on-chain `ramp-settlement` contract).
   */
  autoPay?: boolean;
  /** Defaults to the public Testnet passphrase; override for a mainnet anchor. */
  networkPassphrase?: string;
  /** Defaults to SDF's public Horizon for the selected network. */
  horizonUrl?: string;
  /**
   * Extra SEP-12 fields the receiving anchor requires for the receiver
   * (e.g. `{ address: "...", date_of_birth: "..." }`), merged over the
   * fields derived from `payoutAccount`. Check the anchor's `GET /info`.
   */
  receiverFields?: (input: InitiateOffRampInput) => Record<string, string>;
  /** A pre-obtained SEP-10 JWT (e.g. from a server-side auth service); skips SEP-10. */
  authToken?: string;
}

interface Sep31Toml {
  WEB_AUTH_ENDPOINT?: string;
  DIRECT_PAYMENT_SERVER?: string;
  KYC_SERVER?: string;
  TRANSFER_SERVER?: string;
  ANCHOR_QUOTE_SERVER?: string;
  CURRENCIES?: Array<{ code?: string; issuer?: string }>;
}

interface Sep31Transaction {
  id: string;
  status: string;
  stellar_account_id?: string;
  stellar_memo?: string;
  stellar_memo_type?: "text" | "id" | "hash";
}

/**
 * StellarDirectPaymentProvider
 *
 * A `RampProvider` for **direct, non-interactive anchor-to-anchor
 * payments** (SEP-31 cross-border payments, with SEP-10 auth, SEP-12
 * receiver KYC and optional SEP-38 quotes). The sender pays a receiving
 * anchor in a Stellar asset (e.g. USDC) and the anchor pays the receiver
 * out in local fiat to a bank account or mobile-money wallet — no hosted
 * page for anyone to click through.
 *
 * Slots into `RampManager` like any other provider. SEP-31 is send-side
 * only, so it's an **off-ramp** provider: `initiateOnRamp` throws. Pair it
 * with an interactive provider for deposits:
 *
 * ```typescript
 * const ramp = RampManager.withProviders({
 *   onRamp:  new StellarAnchorProvider({ homeDomain: "anchor-a.example", signer }),
 *   offRamp: new StellarDirectPaymentProvider({ homeDomain: "anchor-b.example", signer, senderId }),
 * });
 * const session = await ramp.initiateOffRamp({
 *   tokenAmount: "250", tokenSymbol: "USDC", fiatCurrency: "KES", countryCode: "KE",
 *   payoutAccount: { type: "mobile-money", accountNumber: "+254700000000", provider: "M-PESA", accountName: "Wanjiru Kamau" },
 * });
 * ```
 *
 * `getStatus` is a single-shot poll of `GET /transactions/:id`.
 *
 * NOTE: request/response shapes follow the SEP-31/SEP-12/SEP-38 specs.
 * Receiving anchors differ in which SEP-12 fields they require — use
 * `receiverFields` for anchor-specific extras, and verify against the
 * target anchor's testnet before production use.
 */
export class StellarDirectPaymentProvider implements RampProvider {
  readonly name: string;

  private _opts: StellarDirectPaymentProviderOptions;
  private _networkPassphrase: string;
  private _toml?: Sep31Toml;
  private _jwt?: { token: string; expiresAt: number };

  constructor(opts: StellarDirectPaymentProviderOptions) {
    this._opts = opts;
    this._networkPassphrase = opts.networkPassphrase ?? Networks.TESTNET;
    this.name = `${opts.homeDomain} (SEP-31)`;
    if (opts.authToken) this._jwt = { token: opts.authToken, expiresAt: Number.MAX_SAFE_INTEGER };
  }

  // ─── SEP-1 / SEP-10 ─────────────────────────────────────────────────────

  private async _resolveToml(): Promise<Sep31Toml> {
    if (!this._toml) {
      this._toml = (await StellarToml.Resolver.resolve(this._opts.homeDomain)) as Sep31Toml;
    }
    return this._toml;
  }

  private async _directPaymentServer(): Promise<string> {
    const toml = await this._resolveToml();
    if (!toml.DIRECT_PAYMENT_SERVER) {
      throw new Error(`Anchor ${this._opts.homeDomain} does not advertise a DIRECT_PAYMENT_SERVER (SEP-31) in its stellar.toml`);
    }
    return toml.DIRECT_PAYMENT_SERVER.replace(/\/$/, "");
  }

  private async _authenticate(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    if (this._jwt && this._jwt.expiresAt > now + 30) return this._jwt.token;
    const toml = await this._resolveToml();
    if (!toml.WEB_AUTH_ENDPOINT) {
      throw new Error(`Anchor ${this._opts.homeDomain} does not advertise a WEB_AUTH_ENDPOINT (SEP-10) in its stellar.toml`);
    }
    this._jwt = await authenticateSep10({
      webAuthEndpoint: toml.WEB_AUTH_ENDPOINT,
      homeDomain: this._opts.homeDomain,
      signer: this._opts.signer,
      networkPassphrase: this._networkPassphrase,
    });
    return this._jwt.token;
  }

  private async _fetchJson<T>(url: string, init: RequestInit, what: string): Promise<T> {
    const jwt = await this._authenticate();
    const res = await fetch(url, {
      ...init,
      headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
    });
    if (!res.ok) {
      throw new Error(`${what} to ${this._opts.homeDomain} failed: ${res.status} ${await res.text()}`);
    }
    return (await res.json()) as T;
  }

  private _issuer(assetCode: string): string | undefined {
    return this._toml?.CURRENCIES?.find((c) => c.code === assetCode)?.issuer;
  }

  // ─── SEP-38 quotes (context=sep31) ──────────────────────────────────────

  async getQuote(input: RampQuoteInput): Promise<RampQuote> {
    if (input.direction !== "off-ramp") {
      throw new Error("SEP-31 direct payments are send-side only — quote an off-ramp, or use an on-ramp provider for deposits.");
    }
    const toml = await this._resolveToml();
    if (!toml.ANCHOR_QUOTE_SERVER) {
      throw new Error(`Anchor ${this._opts.homeDomain} does not advertise a SEP-38 ANCHOR_QUOTE_SERVER — getQuote() isn't supported here.`);
    }
    const amount = input.tokenAmount ?? input.fiatAmount;
    if (!amount) throw new Error("getQuote requires either fiatAmount or tokenAmount");
    const issuer = this._issuer(input.tokenSymbol);
    const sellAsset = issuer ? `stellar:${input.tokenSymbol}:${issuer}` : `stellar:${input.tokenSymbol}`;
    const params = new URLSearchParams({
      context: "sep31",
      sell_asset: sellAsset,
      buy_asset: `iso4217:${input.fiatCurrency}`,
      ...(input.tokenAmount ? { sell_amount: input.tokenAmount } : { buy_amount: input.fiatAmount! }),
    });
    const data = await this._fetchJson<{ price: string; sell_amount: string; buy_amount: string; fee?: { total?: string } }>(
      `${toml.ANCHOR_QUOTE_SERVER.replace(/\/$/, "")}/price?${params.toString()}`, { method: "GET" }, "SEP-38 price request"
    );
    return {
      direction: "off-ramp",
      fiatCurrency: input.fiatCurrency,
      fiatAmount: data.buy_amount,
      tokenAmount: data.sell_amount,
      tokenSymbol: input.tokenSymbol,
      exchangeRate: data.price,
      feeFiat: data.fee?.total ?? "0",
      expiresAt: Math.floor(Date.now() / 1000) + 300,
    };
  }

  // ─── SEP-31 ─────────────────────────────────────────────────────────────

  async initiateOnRamp(_input: InitiateOnRampInput): Promise<RampSession> {
    throw new Error(
      "StellarDirectPaymentProvider is send-side only (SEP-31 has no deposit flow). " +
      "Use RampManager.withProviders({ onRamp: <interactive provider>, offRamp: this }) to combine it with an on-ramp provider."
    );
  }

  /**
   * Registers the receiver with the anchor (SEP-12), creates the SEP-31
   * transaction, and — with `autoPay` — sends the Stellar payment with the
   * anchor's memo. No hosted UI at any step.
   */
  async initiateOffRamp(input: InitiateOffRampInput): Promise<RampSession> {
    const dps = await this._directPaymentServer();
    await this._resolveToml();
    const receiverId = await this.registerReceiver(input);

    const assetIssuer = this._issuer(input.tokenSymbol);
    const created = await this._fetchJson<Partial<Sep31Transaction>>(`${dps}/transactions`, {
      method: "POST",
      body: JSON.stringify({
        amount: input.tokenAmount,
        asset_code: input.tokenSymbol,
        ...(assetIssuer ? { asset_issuer: assetIssuer } : {}),
        destination_asset: `iso4217:${input.fiatCurrency}`,
        sender_id: this._opts.senderId,
        receiver_id: receiverId,
        ...(input.customerReference ? { refund_memo: input.customerReference, refund_memo_type: "text" } : {}),
      }),
    }, "SEP-31 POST /transactions");
    if (!created.id) throw new Error(`SEP-31 POST /transactions to ${this._opts.homeDomain} returned no transaction id`);

    // Newer SEP-31 versions return payment details only from GET /transactions/:id.
    const tx = created.stellar_account_id ? created as Sep31Transaction : await this._getTransaction(created.id);
    if (!tx.stellar_account_id) {
      throw new Error(`Anchor ${this._opts.homeDomain} did not provide a stellar_account_id for transaction ${created.id}`);
    }
    const instructions: RampPaymentInstructions = {
      destination: tx.stellar_account_id,
      memo: tx.stellar_memo,
      memoType: tx.stellar_memo_type,
      amount: input.tokenAmount,
      assetCode: input.tokenSymbol,
      assetIssuer,
    };

    const session: RampSession = {
      sessionId: created.id,
      direction: "off-ramp",
      status: RampSessionStatus.PENDING,
      providerRef: created.id,
      paymentInstructions: instructions,
      createdAt: Math.floor(Date.now() / 1000),
    };
    if (this._opts.autoPay ?? true) {
      session.paymentTxHash = await this.sendPayment(instructions);
      session.status = RampSessionStatus.PROCESSING;
    }
    return session;
  }

  async getStatus(sessionId: string): Promise<RampSessionStatus> {
    return mapSep31Status((await this._getTransaction(sessionId)).status);
  }

  /** SEP-12 `PUT /customer` for the receiver — returns the anchor's customer id. */
  async registerReceiver(input: InitiateOffRampInput): Promise<string> {
    const toml = await this._resolveToml();
    const kycServer = toml.KYC_SERVER ?? toml.TRANSFER_SERVER;
    if (!kycServer) {
      throw new Error(`Anchor ${this._opts.homeDomain} does not advertise a KYC_SERVER (SEP-12) in its stellar.toml`);
    }
    const fields = { ...receiverFieldsFromPayout(input), ...(this._opts.receiverFields?.(input) ?? {}) };
    const { id } = await this._fetchJson<{ id: string }>(`${kycServer.replace(/\/$/, "")}/customer`, {
      method: "PUT",
      body: JSON.stringify({ type: "sep31-receiver", ...fields }),
    }, "SEP-12 PUT /customer");
    return id;
  }

  /** Submits the on-chain leg: pays `destination` in the anchor's asset with the required memo. */
  async sendPayment(instructions: RampPaymentInstructions): Promise<string> {
    const horizon = new Horizon.Server(this._opts.horizonUrl ?? defaultHorizon(this._networkPassphrase));
    const account = await horizon.loadAccount(this._opts.signer.publicKey);
    const asset = instructions.assetIssuer ? new Asset(instructions.assetCode, instructions.assetIssuer) : Asset.native();
    const builder = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: this._networkPassphrase })
      .addOperation(Operation.payment({ destination: instructions.destination, asset, amount: instructions.amount }))
      .setTimeout(180);
    const memo = toMemo(instructions);
    if (memo) builder.addMemo(memo);
    const tx = builder.build();

    const { signedTxXdr, error } = await this._opts.signer.signTransaction(tx.toXDR(), { networkPassphrase: this._networkPassphrase });
    if (error) throw new Error(`Wallet failed to sign the SEP-31 payment: ${JSON.stringify(error)}`);
    const result = await horizon.submitTransaction(TransactionBuilder.fromXDR(signedTxXdr, this._networkPassphrase));
    return result.hash;
  }

  private async _getTransaction(id: string): Promise<Sep31Transaction> {
    const dps = await this._directPaymentServer();
    const { transaction } = await this._fetchJson<{ transaction: Sep31Transaction }>(
      `${dps}/transactions/${encodeURIComponent(id)}`, { method: "GET" }, "SEP-31 GET /transactions/:id"
    );
    return transaction;
  }
}

function defaultHorizon(passphrase: string): string {
  return passphrase === Networks.PUBLIC ? "https://horizon.stellar.org" : "https://horizon-testnet.stellar.org";
}

/** SEP-31 sends hash memos base64-encoded. */
function toMemo(i: RampPaymentInstructions): Memo | undefined {
  if (!i.memo) return undefined;
  switch (i.memoType ?? "text") {
    case "id": return Memo.id(i.memo);
    case "hash": return Memo.hash(Buffer.from(i.memo, "base64").toString("hex"));
    default: return Memo.text(i.memo);
  }
}

/** Standard SEP-9 field names for the payout destination. */
export function receiverFieldsFromPayout(input: InitiateOffRampInput): Record<string, string> {
  const a = input.payoutAccount;
  const fields: Record<string, string> = {};
  if (a.accountName) {
    const [first, ...rest] = a.accountName.trim().split(/\s+/);
    fields.first_name = first;
    if (rest.length) fields.last_name = rest.join(" ");
  }
  if (a.type === "bank") {
    fields.bank_account_number = a.accountNumber;
    if (a.bankCode) fields.bank_number = a.bankCode;
  } else {
    fields.mobile_money_number = a.accountNumber;
    if (a.provider) fields.mobile_money_provider = a.provider;
  }
  if (input.countryCode) fields.address_country_code = input.countryCode;
  return fields;
}

/** Maps SEP-31 transaction statuses to `RampSessionStatus`. Unknown non-terminal statuses read as PROCESSING. */
export function mapSep31Status(status: string): RampSessionStatus {
  switch (status) {
    case "pending_sender":
      return RampSessionStatus.PENDING;
    case "completed":
      return RampSessionStatus.SETTLED;
    case "refunded":
      return RampSessionStatus.REFUNDED;
    case "error":
    case "expired":
      return RampSessionStatus.FAILED;
    default:
      return RampSessionStatus.PROCESSING;
  }
}
